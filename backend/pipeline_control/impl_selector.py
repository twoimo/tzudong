"""Implementation_Selector: python-vs-rust runtime switch for Migration_Slices.

Pure-logic control module for the platform-modernization feature (design C1,
"러스트 이행 바인딩과 Implementation_Selector"). It decides, for a single
``Migration_Slice``, whether the python implementation or the Rust_Component
runs, and it carries the bounded merge-candidate checks that gate a slice into
the repository.

Design intent and the requirement split it implements
-----------------------------------------------------
* ``resolve_implementation`` follows the opt-in contract of requirements 1.5
  and 1.11 and design Property 5 ("옵트인 명시 ⟺ rust"): a slice resolves to
  ``rust`` when — and only when — the ``TZUDONG_RUST_SLICES`` opt-in explicitly
  names it; every other execution runs python; a slice id absent from the
  Migration_Ledger raises ``migration_slice_unknown``. The opt-in is the
  pre-parity experimental switch that lets an operator *generate* parity
  evidence in the first place, so it deliberately does not require the N=3
  parity gate. (Requirements 1.5, 1.11)
* The N=3 parity gate that governs the *default* selection (requirements 2.4,
  2.5) lives in ``resolve_default_implementation`` /
  ``ledger_permits_rust_default``: the ledger may only mark a slice's
  ``activeImplementation`` as ``rust`` once ``consecutiveMatchedCount >= 3``.
* ``load_rust`` applies a 30-second initialization budget. On timeout or import
  failure it fails closed with ``rust_component_unavailable`` — it does not
  retry, does not fall back to python, and returns no partial result and writes
  nothing. (Requirement 1.6)
* ``check_merge_candidate`` runs the merge-candidate gate: it records the
  ledger-entry / field check (requirement 1.2), rejects a candidate whose
  long-running work classes were invoked under the Route_Handler_Boundary with
  ``boundary_violation`` (requirements 1.3, 1.4), rejects a missing or
  field-incomplete ledger entry with ``migration_ledger_entry_missing``
  (requirement 1.9), and rejects a candidate whose recorded regression suites
  carry any failure/error or exceed the 30-minute budget with
  ``regression_suite_failed`` (requirements 1.8, 1.10).

The module reuses the closed sets published by
``backend/pipeline_control/ledger_validation.py`` and follows the same bounded
fixed-code discipline as ``profiles.py`` and ``schedule.py``: every failure
path raises :class:`SelectorError` carrying one short, stable ``code`` — no
free-form error strings, no provider or database diagnostics.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from backend.pipeline_control.ledger_validation import (
    MIGRATION_ACTIVE_IMPLS,
    MIGRATION_REPLACEMENT_SCOPES,
)

# ---------------------------------------------------------------------------
# Public constants (design C1 interface).
# ---------------------------------------------------------------------------
SELECTOR_ENV = "TZUDONG_RUST_SLICES"  # comma-separated opt-in slice ids
DEFAULT_ENV = "TZUDONG_RUST_DEFAULT_SLICES"  # N=3-satisfied default slice ids
INIT_TIMEOUT_SECONDS = 30.0

IMPL_PYTHON = "python"
IMPL_RUST = "rust"

# Requirement 2.4/2.5: a slice's default may become rust only after three
# consecutive matched parity results are recorded in the ledger.
PARITY_GATE_COUNT = 3

# Requirement 1.8/1.10: the three python regression suites and the 30-minute
# completion budget applied to each suite.
REGRESSION_SUITES = (
    "backend.utils.tests.test_run_daily_regression",
    "backend.pipeline.test_validators_unittest",
    "backend.pipeline.test_data_contracts_unittest",
)
REGRESSION_TIME_BUDGET_SECONDS = 30.0 * 60.0

# Requirement 1.3: work classes that a Rust_Component may run only inside a
# Backend_Runtime worker entrypoint, never on a Route_Handler_Boundary request
# path. Any of these observed under the route boundary is a boundary violation.
LONG_RUNNING_WORK_CLASSES = frozenset(
    {
        "crawler_execution",
        "ffmpeg_processing",
        "gemini_bulk_evaluation",
        "gdrive_bulk_upload",
        "supabase_batch_insert",
    }
)

# Default committed Migration_Ledger location (created in Task 40).
_DEFAULT_LEDGER_PATH = (
    Path(__file__).resolve().parents[1] / "rust" / "migration-ledger.v1.json"
)

# ---------------------------------------------------------------------------
# Closed set of fixed rejection codes carried by SelectorError.
# ---------------------------------------------------------------------------
CODE_RUST_UNAVAILABLE = "rust_component_unavailable"
CODE_SLICE_UNKNOWN = "migration_slice_unknown"
CODE_BOUNDARY_VIOLATION = "boundary_violation"
CODE_LEDGER_ENTRY_MISSING = "migration_ledger_entry_missing"
CODE_REGRESSION_FAILED = "regression_suite_failed"

SELECTOR_ERROR_CODES = frozenset(
    {
        CODE_RUST_UNAVAILABLE,
        CODE_SLICE_UNKNOWN,
        CODE_BOUNDARY_VIOLATION,
        CODE_LEDGER_ENTRY_MISSING,
        CODE_REGRESSION_FAILED,
    }
)


class SelectorError(Exception):
    """Raised on any selector failure with a bounded fixed ``code``."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------------------
# Ledger loading and lookup helpers.
# ---------------------------------------------------------------------------
def load_ledger(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    """Load the Migration_Ledger document from ``path`` (default committed path).

    Raises :class:`SelectorError` (``migration_slice_unknown``) if the ledger
    cannot be read or parsed as an object, so a caller can never resolve a slice
    against a ledger that failed to load.
    """

    ledger_path = Path(path) if path is not None else _DEFAULT_LEDGER_PATH
    try:
        doc = json.loads(ledger_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise SelectorError(CODE_SLICE_UNKNOWN)
    if not isinstance(doc, dict):
        raise SelectorError(CODE_SLICE_UNKNOWN)
    return doc


def slice_ids(ledger: Mapping[str, Any]) -> frozenset[str]:
    """Return the set of slice ids declared in ``ledger``."""

    result: set[str] = set()
    for item in ledger.get("slices") or []:
        if isinstance(item, dict):
            slice_id = item.get("sliceId")
            if isinstance(slice_id, str) and slice_id.strip():
                result.add(slice_id)
    return frozenset(result)


def find_slice(ledger: Mapping[str, Any], slice_id: str) -> dict[str, Any] | None:
    """Return the ledger entry for ``slice_id`` or ``None`` when absent."""

    for item in ledger.get("slices") or []:
        if isinstance(item, dict) and item.get("sliceId") == slice_id:
            return item
    return None


def _resolve_ledger(
    ledger: Mapping[str, Any] | None,
    ledger_path: str | os.PathLike[str] | None,
) -> Mapping[str, Any]:
    return ledger if ledger is not None else load_ledger(ledger_path)


# ---------------------------------------------------------------------------
# Opt-in resolution (Requirements 1.5, 1.11 / Property 5).
# ---------------------------------------------------------------------------
def _opt_in_slices(environment: Mapping[str, str] | None) -> frozenset[str]:
    env = os.environ if environment is None else environment
    raw = env.get(SELECTOR_ENV, "") or ""
    return frozenset(token.strip() for token in raw.split(",") if token.strip())


def resolve_implementation(
    slice_id: str,
    *,
    environment: Mapping[str, str] | None = None,
    ledger: Mapping[str, Any] | None = None,
    ledger_path: str | os.PathLike[str] | None = None,
) -> str:
    """Resolve which implementation runs for ``slice_id``.

    Returns ``"rust"`` if and only if the ``TZUDONG_RUST_SLICES`` opt-in
    explicitly names ``slice_id``; returns ``"python"`` in every execution
    without the opt-in or that does not name the slice. A ``slice_id`` that is
    not present in the Migration_Ledger raises
    ``SelectorError(migration_slice_unknown)`` and neither implementation runs.

    This is the opt-in contract of requirements 1.5 and 1.11 (design Property
    5). It is intentionally independent of the N=3 parity gate — the opt-in is
    the pre-parity experimental switch used to collect parity evidence. The gate
    that governs the *default* selection lives in
    :func:`resolve_default_implementation`.
    """

    known = slice_ids(_resolve_ledger(ledger, ledger_path))
    if slice_id not in known:
        raise SelectorError(CODE_SLICE_UNKNOWN)
    return IMPL_RUST if slice_id in _opt_in_slices(environment) else IMPL_PYTHON


# ---------------------------------------------------------------------------
# Default selection gate (Requirements 2.4, 2.5).
# ---------------------------------------------------------------------------
def ledger_permits_rust_default(entry: Mapping[str, Any]) -> bool:
    """Whether the ledger permits ``rust`` as the *default* for this entry.

    True only when the entry's ``activeImplementation`` is ``rust`` and its
    ``consecutiveMatchedCount`` is at least :data:`PARITY_GATE_COUNT` (3). This
    enforces the requirement-2.4/2.5 invariant that the default may not flip to
    rust before three consecutive matched parity results.
    """

    if entry.get("activeImplementation") != IMPL_RUST:
        return False
    count = entry.get("consecutiveMatchedCount")
    if isinstance(count, bool) or not isinstance(count, int):
        return False
    return count >= PARITY_GATE_COUNT


def resolve_default_implementation(
    slice_id: str,
    *,
    ledger: Mapping[str, Any] | None = None,
    ledger_path: str | os.PathLike[str] | None = None,
) -> str:
    """Resolve the default implementation for ``slice_id`` with no opt-in.

    Returns ``rust`` only when the ledger entry passes
    :func:`ledger_permits_rust_default`; otherwise ``python``. An unknown slice
    raises ``SelectorError(migration_slice_unknown)``.
    """

    led = _resolve_ledger(ledger, ledger_path)
    entry = find_slice(led, slice_id)
    if entry is None:
        raise SelectorError(CODE_SLICE_UNKNOWN)
    return IMPL_RUST if ledger_permits_rust_default(entry) else IMPL_PYTHON


# ---------------------------------------------------------------------------
# Rust component initialization with a bounded budget (Requirement 1.6).
# ---------------------------------------------------------------------------
def _rust_module_name(entry: Mapping[str, Any]) -> str | None:
    """Derive the PyO3 extension module name from the ledger entry.

    The crate directory (e.g. ``tzudong-validators``) maps to the snake_case
    module name (``tzudong_validators``) declared in the crate ``[lib]`` section.
    """

    for raw in entry.get("rustArtifactPaths") or []:
        if not isinstance(raw, str):
            continue
        parts = Path(raw).parts
        try:
            idx = parts.index("rust")
        except ValueError:
            continue
        if idx + 1 < len(parts):
            return parts[idx + 1].replace("-", "_")
    return None


def _default_importer(module_name: str) -> Callable[[], Any]:
    def _import() -> Any:
        import importlib

        return importlib.import_module(module_name)

    return _import


def load_rust(
    slice_id: str,
    *,
    importer: Callable[[], Any] | None = None,
    ledger: Mapping[str, Any] | None = None,
    ledger_path: str | os.PathLike[str] | None = None,
    timeout_seconds: float = INIT_TIMEOUT_SECONDS,
) -> Any:
    """Import and initialize the Rust_Component for ``slice_id`` under a budget.

    Applies a hard initialization budget of ``timeout_seconds`` (default 30s).
    If initialization exceeds the budget or raises, this fails closed with
    ``SelectorError(rust_component_unavailable)``: it does **not** retry, does
    **not** fall back to the python implementation, and returns no partial
    result and writes nothing. On success it returns the imported extension
    module. (Requirement 1.6)

    An ``slice_id`` absent from the ledger raises
    ``SelectorError(migration_slice_unknown)``.
    """

    led = _resolve_ledger(ledger, ledger_path)
    entry = find_slice(led, slice_id)
    if entry is None:
        raise SelectorError(CODE_SLICE_UNKNOWN)

    if importer is None:
        module_name = _rust_module_name(entry)
        if not module_name:
            # No resolvable artifact means there is nothing to initialize.
            raise SelectorError(CODE_RUST_UNAVAILABLE)
        importer = _default_importer(module_name)

    holder: dict[str, Any] = {}

    def _run() -> None:
        try:
            holder["module"] = importer()
        except BaseException:  # noqa: BLE001 - any init failure fails closed
            holder["failed"] = True

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    worker.join(timeout_seconds)

    # Timeout (thread still running), an init exception, or no module produced
    # all collapse to the same bounded fixed code. No retry, no fallback.
    if worker.is_alive() or holder.get("failed") or "module" not in holder:
        raise SelectorError(CODE_RUST_UNAVAILABLE)
    return holder["module"]


# ---------------------------------------------------------------------------
# Merge-candidate gate (Requirements 1.2, 1.3, 1.4, 1.8, 1.9, 1.10).
# ---------------------------------------------------------------------------
def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _nonempty_str_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(not _is_blank(item) for item in value)
    )


def slice_entry_complete(entry: Any) -> bool:
    """Whether a ledger entry has all requirement-1.1 fields non-empty.

    Checks the five recorded fields: a non-blank ``sliceId``, at least one
    non-blank replaced python path, at least one non-blank rust artifact path,
    a ``replacementScope`` in the closed set, and an ``activeImplementation`` in
    the closed set. (Requirements 1.2, 1.9)
    """

    if not isinstance(entry, dict):
        return False
    if _is_blank(entry.get("sliceId")):
        return False
    if not _nonempty_str_list(entry.get("replacedPythonPaths")):
        return False
    if not _nonempty_str_list(entry.get("rustArtifactPaths")):
        return False
    if entry.get("replacementScope") not in MIGRATION_REPLACEMENT_SCOPES:
        return False
    if entry.get("activeImplementation") not in MIGRATION_ACTIVE_IMPLS:
        return False
    return True


def _boundary_violations(work_classes: Iterable[str] | None) -> list[str]:
    if not work_classes:
        return []
    seen: list[str] = []
    for item in work_classes:
        if isinstance(item, str) and item in LONG_RUNNING_WORK_CLASSES and item not in seen:
            seen.append(item)
    return seen


def _evaluate_regression(results: Any) -> tuple[bool, list[dict[str, Any]]]:
    """Normalize recorded regression results and decide pass/fail.

    ``results`` is the recorded outcome of the three python regression suites,
    keyed by suite name — either a mapping ``{suite: {...}}`` or a list of
    ``{"suite": ..., "failures": ..., "errors": ..., "elapsedSeconds": ...}``.

    A suite passes only when its ``failures`` and ``errors`` are integers equal
    to 0 and its ``elapsedSeconds`` is a number no greater than the 30-minute
    budget. A missing suite, a missing/negative count, or a missing/over-budget
    elapsed time fails closed (no recorded evidence is treated as not passed).
    Returns ``(ok, normalized_records)``. (Requirements 1.8, 1.10)
    """

    by_suite: dict[str, Any] = {}
    if isinstance(results, Mapping):
        by_suite = {str(k): v for k, v in results.items()}
    elif isinstance(results, list):
        for item in results:
            if isinstance(item, Mapping) and "suite" in item:
                by_suite[str(item["suite"])] = item

    ok = True
    normalized: list[dict[str, Any]] = []
    for suite in REGRESSION_SUITES:
        entry = by_suite.get(suite)
        failures = entry.get("failures") if isinstance(entry, Mapping) else None
        errors = entry.get("errors") if isinstance(entry, Mapping) else None
        elapsed = entry.get("elapsedSeconds") if isinstance(entry, Mapping) else None

        suite_ok = True
        if isinstance(failures, bool) or not isinstance(failures, int) or failures < 0:
            suite_ok = False
        elif isinstance(errors, bool) or not isinstance(errors, int) or errors < 0:
            suite_ok = False
        elif failures >= 1 or errors >= 1:
            suite_ok = False
        elif isinstance(elapsed, bool) or not isinstance(elapsed, (int, float)):
            suite_ok = False
        elif elapsed > REGRESSION_TIME_BUDGET_SECONDS:
            suite_ok = False

        ok = ok and suite_ok
        normalized.append(
            {
                "suite": suite,
                "failures": failures if isinstance(failures, int) and not isinstance(failures, bool) else None,
                "errors": errors if isinstance(errors, int) and not isinstance(errors, bool) else None,
                "elapsedSeconds": elapsed if isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool) else None,
                "ok": suite_ok,
            }
        )
    return ok, normalized


def check_merge_candidate(
    slice_id: str,
    *,
    ledger: Mapping[str, Any] | None = None,
    ledger_path: str | os.PathLike[str] | None = None,
    route_handler_work_classes: Iterable[str] | None = None,
    regression_results: Any = None,
) -> dict[str, Any]:
    """Run the merge-candidate gate for ``slice_id`` and return the artifact.

    Records every check into a merge-candidate artifact (requirement 1.2) and
    sets ``resultCode`` to the first failing bounded fixed code, in priority
    order:

    1. ``boundary_violation`` — a requirement-1.3 long-running work class was
       invoked/executed under the Route_Handler_Boundary. (Requirement 1.4)
    2. ``migration_ledger_entry_missing`` — no ledger entry for the slice, or a
       requirement-1.1 field is empty. (Requirement 1.9)
    3. ``regression_suite_failed`` — a regression suite carries a failure/error
       or exceeded the 30-minute budget. (Requirements 1.8, 1.10)

    ``ok`` is ``True`` only when ``resultCode`` is ``None``. On any failure no
    artifact is merged — the caller must treat ``ok=False`` as "merge nothing".
    """

    led = _resolve_ledger(ledger, ledger_path)
    entry = find_slice(led, slice_id)

    violations = _boundary_violations(route_handler_work_classes)
    entry_present = entry is not None
    fields_complete = slice_entry_complete(entry)
    regression_ok, regression_records = _evaluate_regression(regression_results)

    if violations:
        result_code: str | None = CODE_BOUNDARY_VIOLATION
    elif not entry_present or not fields_complete:
        result_code = CODE_LEDGER_ENTRY_MISSING
    elif not regression_ok:
        result_code = CODE_REGRESSION_FAILED
    else:
        result_code = None

    return {
        "sliceId": slice_id,
        "ledgerEntryPresent": entry_present,
        "ledgerFieldsComplete": fields_complete,
        "boundaryCheck": {
            "routeHandlerViolations": len(violations),
            "violatingWorkClasses": violations,
            "ok": not violations,
        },
        "regressionSuites": regression_records,
        "regressionOk": regression_ok,
        "resultCode": result_code,
        "ok": result_code is None,
    }
