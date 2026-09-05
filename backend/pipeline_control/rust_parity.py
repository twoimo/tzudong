"""Parity_Harness — python-vs-rust behavioural parity evidence (Requirement 2; design C1, D2).

Feature: platform-modernization, Task 43.

This module owns the Parity_Harness that feeds one identical input to the
python implementation and the Rust_Component of a Migration_Slice, applies a
single pre-declared normalization rule to both outputs, compares them, and
produces exactly one Parity_Result. It also carries the pure-logic gate that
governs when the Implementation_Selector default may flip from python to rust,
and the readback / artifact-change discipline that surrounds that flip.

What each piece implements
--------------------------
* ``run_parity`` (Requirements 2.1, 2.2, 2.3, 2.9).
  Feeds ``payload`` to injected python and rust callables under a hard
  600-second budget, normalizes both outputs with normalization rule ``v1``
  (sort field names, drop the declared non-deterministic fields), and compares
  field-by-field to produce a Parity_Result. On a 600-second overrun or an
  abnormal termination of either implementation it returns ``matched=false``
  with the bounded fixed code ``parity_run_incomplete`` and produces no partial
  comparison. On a mismatch it records at most 50 mismatching field *names* plus
  the full mismatch count, and never records a field value.

* ``consecutive_matched_count`` / ``evaluate_default_switch`` (Requirements
  2.4, 2.5). The default may flip to rust only after three consecutive
  ``matched=true`` results that carry distinct input ids, share one
  Rust_Component artifact id, have no ``matched=false`` between them, and have a
  non-empty compared-field set. A Parity_Result whose compared-field set is
  empty is excluded from this N=3 count. Fewer than three yields
  ``parity_evidence_insufficient`` and the default stays python.

* ``apply_artifact_change`` (Requirement 2.10). When a slice's Rust_Component
  artifact id changes, the consecutive count resets to 0 and the default reverts
  to python.

* ``verify_switch_readback`` (Requirement 2.11). After a flip to rust, the
  three supporting results' input ids, the artifact id, and the post-switch
  active implementation are re-read from the ledger; if the readback differs
  from the recorded evidence the default reverts to python.

* ``check_python_removal_candidate`` (Requirement 2.6). Python removal is only
  performed as a separate explicit merge candidate that references either a
  Migration_Ledger entry proving the N=3 condition or an operator approval
  reference; a candidate lacking that reference is rejected.

Persistence boundary
--------------------
``local_analytics.parity_results`` is the recording target (design D2). This
module never fabricates a database connection: ``record_parity_result`` takes an
*injected* recorder callable that a Backend_Runtime worker supplies, and
``run_parity`` uses only bounded memory pipes, never a database or disk output. When no recorder is available the caller
fails closed rather than inventing connectivity.

Discipline
----------
Every failure path carries one short, stable code from the closed set below.
No provider diagnostics, database error strings, exception messages, or
free-form error text ever leave this module. Mismatch records hold field
*names* only — never field values or any Forbidden_Log_Field value.
"""

from __future__ import annotations

import hashlib
import importlib.machinery
import json
import math
import multiprocessing
import os
import selectors
import signal
import threading
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from backend.pipeline_control.impl_selector import (
    IMPL_PYTHON,
    IMPL_RUST,
    PARITY_GATE_COUNT,
)

# ---------------------------------------------------------------------------
# Public constants (design C1 interface).
# ---------------------------------------------------------------------------

# Pre-declared normalization rules. Rule ``v1`` sorts field names and drops the
# declared non-deterministic fields before comparison (Requirement 2.1).
NORMALIZATION_RULES: dict[str, dict[str, Any]] = {
    "v1": {
        "sort_keys": True,
        "excluded_fields": ("generated_at", "duration_ms", "host", "pid"),
    }
}
DEFAULT_NORMALIZATION_RULE_ID = "v1"

# A single input must return within 600 seconds from each implementation
# (Requirement 2.9).
RUN_TIMEOUT_SECONDS = 600.0

# Mismatch records are bounded to 50 field names (Requirement 2.3); this mirrors
# the ``parity_mismatch_bound`` check on ``local_analytics.parity_results``.
MAX_MISMATCH_FIELDS = 50

# ---------------------------------------------------------------------------
# Closed set of bounded fixed codes.
# ---------------------------------------------------------------------------

# A single input did not return within 600 seconds from an implementation, or an
# implementation terminated abnormally (Requirement 2.9). matched is false and
# no partial comparison is produced.
CODE_PARITY_RUN_INCOMPLETE = "parity_run_incomplete"

# A default-change request was made with fewer than three qualifying matched
# results for the current artifact id (Requirement 2.5). The default stays
# python.
CODE_PARITY_EVIDENCE_INSUFFICIENT = "parity_evidence_insufficient"

# A python-removal merge candidate lacked a Migration_Ledger reference proving
# the N=3 condition or an operator approval reference (Requirement 2.6).
CODE_PYTHON_REMOVAL_EVIDENCE_MISSING = "python_removal_evidence_missing"

# A python-removal candidate was not submitted as a separate explicit merge
# candidate, as required (Requirement 2.6).
CODE_PYTHON_REMOVAL_NOT_SEPARATE = "python_removal_not_separate"

PARITY_RESULT_CODES = frozenset(
    {
        None,
        CODE_PARITY_RUN_INCOMPLETE,
    }
)


# ---------------------------------------------------------------------------
# Normalization and comparison (Requirements 2.1, 2.2, 2.3).
# ---------------------------------------------------------------------------
def normalize_output(
    output: Mapping[str, Any], rule_id: str = DEFAULT_NORMALIZATION_RULE_ID
) -> dict[str, Any]:
    """Apply a pre-declared normalization rule to one implementation output.

    Rule ``v1`` drops the declared non-deterministic fields and returns a dict
    whose keys are field-name sorted (Requirement 2.1). Raises ``KeyError`` for
    an unknown rule id so a caller can never silently compare under an
    undeclared rule.
    """

    rule = NORMALIZATION_RULES[rule_id]
    excluded = set(rule.get("excluded_fields", ()))
    items = {
        key: output[key]
        for key in output
        if key not in excluded
    }
    if rule.get("sort_keys", True):
        return {key: items[key] for key in sorted(items)}
    return dict(items)


def compare_normalized(
    python_norm: Mapping[str, Any], rust_norm: Mapping[str, Any]
) -> dict[str, Any]:
    """Compare two normalized outputs field-by-field.

    The compared-field set is the union of the two normalized key sets. A field
    is a mismatch when it is present in only one output or when the two values
    differ. Returns ``matched``, the sorted ``compared_fields``, the sorted
    ``mismatch_fields`` bounded to :data:`MAX_MISMATCH_FIELDS` names, and the
    full ``mismatch_field_count`` (Requirements 2.2, 2.3).
    """

    compared = sorted(set(python_norm) | set(rust_norm))
    mismatches: list[str] = []
    for field in compared:
        in_py = field in python_norm
        in_rust = field in rust_norm
        if not (in_py and in_rust) or python_norm[field] != rust_norm[field]:
            mismatches.append(field)

    return {
        "matched": len(mismatches) == 0,
        "compared_fields": compared,
        "mismatch_fields": sorted(mismatches)[:MAX_MISMATCH_FIELDS],
        "mismatch_field_count": len(mismatches),
    }


# ---------------------------------------------------------------------------
# Artifact identity (Requirement 2.10). crate name + extension-module SHA-256.
# ---------------------------------------------------------------------------
def compute_artifact_id(
    crate_name: str,
    *,
    module_path: str | Path | None = None,
    module_bytes: bytes | None = None,
) -> str:
    """Return a Rust_Component artifact id from the crate name and module hash.

    The artifact id is ``"{crate_name}@sha256:{hex}"`` where the hex is the
    SHA-256 of the built extension-module bytes. Either ``module_bytes`` or a
    readable ``module_path`` must be supplied; both absent raises ``ValueError``
    rather than inventing a hash. (Requirement 2.10)
    """

    if module_bytes is None:
        if module_path is None:
            raise ValueError("module_bytes or module_path is required")
        artifact_path = Path(module_path)
        # maturin may expose a package-level ``__init__.py`` as
        # ``module.__file__`` while the actual PyO3 artifact is its sibling
        # extension. Never bind N=3 evidence to the Python shim bytes.
        if artifact_path.name == "__init__.py":
            candidates = sorted({
                path
                for suffix in importlib.machinery.EXTENSION_SUFFIXES
                for path in artifact_path.parent.glob(f"*{suffix}")
                if path.is_file()
            })
            if len(candidates) != 1:
                raise ValueError("extension module artifact is not unique")
            artifact_path = candidates[0]
        module_bytes = artifact_path.read_bytes()
    digest = hashlib.sha256(module_bytes).hexdigest()
    return f"{crate_name}@sha256:{digest}"


# ---------------------------------------------------------------------------
# The harness (Requirements 2.1, 2.2, 2.3, 2.9).
# ---------------------------------------------------------------------------
# Backend parity workers are POSIX processes. Fork is admitted only from a
# single-threaded worker; unsupported hosts/contexts fail closed. No raw output
# is persisted to disk, and each implementation receives a separate payload.
_MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def _json_output_value(value) -> bool:
    # Refuse coercions (tuple->list, non-string keys->strings) that could turn
    # an actual mismatch into a match. The normalizer declares no such rule.
    if value is None or type(value) in (str, int, bool):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) is list:
        return all(_json_output_value(item) for item in value)
    if type(value) is dict:
        return all(type(key) is str and _json_output_value(item) for key, item in value.items())
    return False


def _parity_child(fn, payload, read_fd: int, write_fd: int, reference: bool) -> None:
    os.close(read_fd)
    try:
        os.setsid()  # Descendants share a group that the parent always reaps.
        sink = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(sink, 1)
            os.dup2(sink, 2)
        finally:
            os.close(sink)
        if reference:
            from backend.pipeline_control.impl_selector import python_reference
            with python_reference():
                result = fn(payload)
        else:
            result = fn(payload)
        if not isinstance(result, Mapping):
            return
        result = dict(result)
        if not _json_output_value(result):
            return
        body = json.dumps(result, allow_nan=False).encode("utf-8")
        if len(body) > _MAX_OUTPUT_BYTES:
            return
        view = memoryview(body)
        while view:
            view = view[os.write(write_fd, view):]
    except BaseException:
        pass  # No implementation output or provider diagnostic is surfaced.
    finally:
        os.close(write_fd)


def _stop_parity_process(process) -> None:
    # Kill the private group even when the leader has exited: an implementation
    # may have left a descendant holding its pipe or doing delayed work.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        # Darwin may report EPERM for an already-exited empty process group.
        # An extant leader is still killed and synchronously reaped below.
        pass
    if process.is_alive():
        process.kill()
    process.join()
    process.close()


def _invoke_under_budget(
    python_impl: Callable[[Any], Any],
    rust_impl: Callable[[Any], Any],
    payload: Any,
    timeout_seconds: float,
) -> tuple[bool, Any, Any]:
    """Isolate both implementations and stop all workers before returning.

    The shared deadline includes startup and pipe transfer. Parent-side reads
    are nonblocking and bounded, so a stalled or oversized result cannot evade
    the timeout. Cleanup reaps both process groups before any subsequent input.
    """
    if (
        "fork" not in multiprocessing.get_all_start_methods()
        or threading.active_count() != 1
        or threading.current_thread() is not threading.main_thread()
        or not isinstance(timeout_seconds, (int, float))
        or not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0
    ):
        return False, None, None
    deadline = time.monotonic() + min(timeout_seconds, RUN_TIMEOUT_SECONDS)
    context = multiprocessing.get_context("fork")
    processes = []
    descriptors = set()
    buffers = {}
    try:
        with selectors.DefaultSelector() as selector:
            for name, fn in (("python", python_impl), ("rust", rust_impl)):
                read_fd, write_fd = os.pipe()
                descriptors.update((read_fd, write_fd))
                process = context.Process(target=_parity_child, args=(fn, payload, read_fd, write_fd, name == "python"))
                process.start()
                processes.append(process)
                os.close(write_fd)
                descriptors.remove(write_fd)
                os.set_blocking(read_fd, False)
                selector.register(read_fd, selectors.EVENT_READ, name)
                buffers[name] = bytearray()
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False, None, None
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fd, 65536)
                    if chunk:
                        buffers[key.data].extend(chunk)
                        if len(buffers[key.data]) > _MAX_OUTPUT_BYTES:
                            return False, None, None
                    else:
                        selector.unregister(key.fd)
                        os.close(key.fd)
                        descriptors.remove(key.fd)
            for process in processes:
                process.join(max(0, deadline - time.monotonic()))
                if process.is_alive() or process.exitcode != 0:
                    return False, None, None
            if time.monotonic() > deadline:
                return False, None, None
            results = [json.loads(buffers[name]) for name in ("python", "rust")]
            if time.monotonic() > deadline or not all(isinstance(result, dict) for result in results):
                return False, None, None
            return True, *results
    except (OSError, ValueError, TypeError, RuntimeError):
        return False, None, None
    finally:
        for process in processes:
            _stop_parity_process(process)
        for descriptor in descriptors:
            os.close(descriptor)


def run_parity(
    slice_id: str,
    input_id: str,
    payload: Any,
    *,
    python_impl: Callable[[Any], Any],
    rust_impl: Callable[[Any], Any],
    rust_artifact_id: str,
    normalization_rule_id: str = DEFAULT_NORMALIZATION_RULE_ID,
    timeout_seconds: float = RUN_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Run the Parity_Harness for one input and return a single Parity_Result.

    Feeds ``payload`` to ``python_impl`` and ``rust_impl`` under a 600-second
    budget (Requirement 2.9), normalizes both outputs with ``normalization_rule_id``
    (Requirement 2.1), and compares them (Requirements 2.2, 2.3).

    The returned Parity_Result carries ``matched``, one ``input_id``, the
    ``normalization_rule_id``, the compared ``rust_artifact_id``, a
    ``compared_fields`` set, a ``mismatch_fields`` list bounded to 50 names, the
    full ``mismatch_field_count``, and a bounded ``result_code``.

    On a 600-second overrun or abnormal termination of either implementation the
    result is ``matched=false`` with ``result_code == parity_run_incomplete``,
    an empty compared-field set, and no partial comparison (Requirement 2.9).
    Field values are never recorded — only field names (Requirement 2.3).
    """

    ok, py_output, rust_output = _invoke_under_budget(
        python_impl, rust_impl, payload, timeout_seconds
    )
    if not ok:
        return {
            "slice_id": slice_id,
            "input_id": input_id,
            "rust_artifact_id": rust_artifact_id,
            "normalization_rule_id": normalization_rule_id,
            "matched": False,
            "compared_fields": [],
            "mismatch_fields": [],
            "mismatch_field_count": 0,
            "result_code": CODE_PARITY_RUN_INCOMPLETE,
        }

    python_norm = normalize_output(py_output, normalization_rule_id)
    rust_norm = normalize_output(rust_output, normalization_rule_id)
    comparison = compare_normalized(python_norm, rust_norm)

    return {
        "slice_id": slice_id,
        "input_id": input_id,
        "rust_artifact_id": rust_artifact_id,
        "normalization_rule_id": normalization_rule_id,
        "matched": comparison["matched"],
        "compared_fields": comparison["compared_fields"],
        "mismatch_fields": comparison["mismatch_fields"],
        "mismatch_field_count": comparison["mismatch_field_count"],
        "result_code": None,
    }


# ---------------------------------------------------------------------------
# N=3 default-switch gate (Requirements 2.4, 2.5).
# ---------------------------------------------------------------------------
def _result_field(result: Mapping[str, Any], name: str, default: Any = None) -> Any:
    return result.get(name, default)


def consecutive_matched_count(
    results: Sequence[Mapping[str, Any]], rust_artifact_id: str
) -> int:
    """Count consecutive qualifying matched results for one artifact id.

    Walking the most recent results first, counts ``matched=true`` results that
    share ``rust_artifact_id``, carry distinct input ids, and have a non-empty
    compared-field set. A ``matched=false`` result for that artifact breaks the
    streak. A matched result whose compared-field set is empty is skipped — it
    neither counts nor breaks the streak (Requirement 2.4). Results recorded
    against a different artifact id are ignored.
    """

    seen_inputs: set[str] = set()
    count = 0
    for result in reversed(list(results)):
        if _result_field(result, "rust_artifact_id") != rust_artifact_id:
            continue
        if not bool(_result_field(result, "matched")):
            break
        compared = _result_field(result, "compared_fields") or []
        if len(compared) == 0:
            # Empty comparison: excluded from the count, does not break streak.
            continue
        input_id = _result_field(result, "input_id")
        if input_id in seen_inputs:
            # A repeated input id is not a new distinct data point.
            continue
        seen_inputs.add(input_id)
        count += 1
    return count


def evaluate_default_switch(
    slice_id: str,
    results: Sequence[Mapping[str, Any]],
    rust_artifact_id: str,
    *,
    evidence_ref: str | None = None,
    evidence_loader=None,
) -> dict[str, Any]:
    """Decide whether the Implementation_Selector default may flip to rust.

    Returns ``allowed=True`` with the supporting evidence (the input ids of the
    three qualifying matched results and the artifact id) only when
    :func:`consecutive_matched_count` reaches :data:`PARITY_GATE_COUNT` (3)
    AND retained live receipts, performance and operator approval verify.
    This authorizes a proposed ledger update only; default resolution remains
    Python until a separate post-apply receipt matches the actual ledger file.
    Otherwise the default stays python and the result carries
    ``code == parity_evidence_insufficient`` (Requirements 2.4, 2.5).
    """

    from backend.pipeline_control.rust_promotion_evidence import verified_live_proposal
    count = consecutive_matched_count(results, rust_artifact_id)
    if count >= PARITY_GATE_COUNT and verified_live_proposal(
        evidence_ref, slice_id, rust_artifact_id, results, loader=evidence_loader
    ):
        # The most recent PARITY_GATE_COUNT distinct qualifying input ids.
        evidence_inputs: list[str] = []
        seen: set[str] = set()
        for result in reversed(list(results)):
            if _result_field(result, "rust_artifact_id") != rust_artifact_id:
                continue
            if not bool(_result_field(result, "matched")):
                break
            if len(_result_field(result, "compared_fields") or []) == 0:
                continue
            input_id = _result_field(result, "input_id")
            if input_id in seen:
                continue
            seen.add(input_id)
            evidence_inputs.append(input_id)
            if len(evidence_inputs) == PARITY_GATE_COUNT:
                break
        return {
            "sliceId": slice_id,
            "allowed": True,
            "defaultImplementation": IMPL_PYTHON,
            "requiresReadback": True,
            "proposedLedgerUpdate": {
                "sliceId": slice_id, "activeImplementation": IMPL_RUST,
                "rustArtifactId": rust_artifact_id, "consecutiveMatchedCount": count,
                "promotionEvidenceRef": evidence_ref,
            },
            "consecutiveMatchedCount": count,
            "evidence": {
                "inputIds": evidence_inputs,
                "rustArtifactId": rust_artifact_id,
                "activeImplementation": IMPL_RUST,
                "promotionEvidenceRef": evidence_ref,
            },
            "code": None,
        }
    return {
        "sliceId": slice_id,
        "allowed": False,
        "defaultImplementation": IMPL_PYTHON,
        "consecutiveMatchedCount": count,
        "evidence": None,
        "code": CODE_PARITY_EVIDENCE_INSUFFICIENT,
    }


# ---------------------------------------------------------------------------
# Artifact-change reset (Requirement 2.10).
# ---------------------------------------------------------------------------
def apply_artifact_change(
    entry: Mapping[str, Any], new_artifact_id: str
) -> dict[str, Any]:
    """Return the ledger entry after a Rust_Component artifact-id change.

    When ``new_artifact_id`` differs from the entry's recorded ``rustArtifactId``
    the consecutive matched count resets to 0 and the active implementation
    reverts to python (Requirement 2.10). When it is unchanged the entry is
    returned as-is. Never mutates the input mapping.
    """

    updated = dict(entry)
    if entry.get("rustArtifactId") == new_artifact_id:
        return updated
    updated["rustArtifactId"] = new_artifact_id
    updated["consecutiveMatchedCount"] = 0
    updated["activeImplementation"] = IMPL_PYTHON
    return updated


# ---------------------------------------------------------------------------
# Post-switch readback verification (Requirement 2.11).
# ---------------------------------------------------------------------------
def verify_switch_readback(
    evidence: Mapping[str, Any], readback: Mapping[str, Any], *, evidence_loader=None
) -> dict[str, Any]:
    """Verify a rust-default flip against a fresh ledger readback.

    ``evidence`` is the recorded basis for the flip (the three input ids, the
    artifact id, and the post-switch active implementation). ``readback`` is the
    same shape re-read from the Migration_Ledger. When they agree the default
    stays rust; when the readback differs from the recorded evidence the default
    reverts to python (Requirement 2.11).
    """

    recorded_inputs = list(evidence.get("inputIds") or [])
    read_inputs = list(readback.get("inputIds") or [])
    matches = (
        recorded_inputs == read_inputs
        and evidence.get("rustArtifactId") == readback.get("rustArtifactId")
        and evidence.get("activeImplementation") == readback.get("activeImplementation")
        and readback.get("activeImplementation") == IMPL_RUST
    )
    from backend.pipeline_control.rust_promotion_evidence import read_receipt, verified_live_promotion
    reference = evidence.get('promotionEvidenceRef')
    retained = read_receipt(reference, evidence_loader)
    proposal = (evaluate_default_switch(retained.get('sliceId'), retained.get('parityResults'),
                evidence.get('rustArtifactId'), evidence_ref=reference, evidence_loader=evidence_loader)
                if retained else {})
    matches = matches and proposal.get('evidence') == dict(evidence)
    matches = bool(matches and retained and verified_live_promotion(
        reference, retained.get('sliceId'), evidence.get('rustArtifactId'),
        retained.get('parityResults'), loader=evidence_loader,
        readback_ref=readback.get('promotionReadbackRef')))
    return {
        "verified": matches,
        "defaultImplementation": IMPL_RUST if matches else IMPL_PYTHON,
    }


# ---------------------------------------------------------------------------
# Python-removal merge candidate (Requirement 2.6).
# ---------------------------------------------------------------------------
def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def check_python_removal_candidate(candidate: Mapping[str, Any], *, evidence_loader=None) -> dict[str, Any]:
    """Require verified live parity AND exact, separate removal approval.

    Both references resolve to retained, content-addressed receipts. Unresolved
    strings, a default-switch approval, or a different candidate cannot admit
    deletion of the Python fallback.
    """

    from backend.pipeline_control.rust_promotion_evidence import approved, read_receipt, verified_live_promotion
    if candidate.get("separateExplicitCandidate") is not True:
        return {"admitted": False, "code": CODE_PYTHON_REMOVAL_NOT_SEPARATE}
    evidence_ref = candidate.get('ledgerParityRef')
    evidence = read_receipt(evidence_ref, evidence_loader)
    approval = read_receipt(candidate.get('operatorApprovalRef'), evidence_loader)
    candidate_sha = candidate.get('candidateCommitSha')
    binding = {'candidateCommitSha': candidate_sha, 'sliceId': candidate.get('sliceId'),
               'rustArtifactId': candidate.get('rustArtifactId'), 'ledgerParityRef': evidence_ref,
               'promotionReadbackRef': candidate.get('promotionReadbackRef')}
    import re
    if (not isinstance(candidate_sha, str) or re.fullmatch(r'[0-9a-f]{40}', candidate_sha) is None
            or evidence is None
            or not verified_live_promotion(evidence_ref, candidate.get('sliceId'),
                candidate.get('rustArtifactId'), evidence.get('parityResults'), loader=evidence_loader,
                readback_ref=candidate.get('promotionReadbackRef'))
            or not approved(approval, purpose='python_removal', binding=binding)):
        return {"admitted": False, "code": CODE_PYTHON_REMOVAL_EVIDENCE_MISSING}
    return {"admitted": True, "code": None}


# ---------------------------------------------------------------------------
# Persistence boundary (design D2). Injected recorder; never fabricates a DB.
# ---------------------------------------------------------------------------
def build_parity_row(result: Mapping[str, Any]) -> dict[str, Any]:
    """Map a Parity_Result to a ``local_analytics.parity_results`` row.

    Carries field *names* only for ``mismatch_fields`` (bounded to 50, matching
    the table's ``parity_mismatch_bound`` check) and the full non-negative
    ``mismatch_field_count``. No field value or Forbidden_Log_Field is included
    (Requirement 2.3, design D2).
    """

    mismatch_fields = [
        str(name) for name in (result.get("mismatch_fields") or [])
    ][:MAX_MISMATCH_FIELDS]
    count = result.get("mismatch_field_count", 0)
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        count = len(mismatch_fields)
    return {
        "slice_id": result.get("slice_id"),
        "input_id": result.get("input_id"),
        "rust_artifact_id": result.get("rust_artifact_id"),
        "normalization_rule_id": result.get("normalization_rule_id"),
        "matched": bool(result.get("matched")),
        "compared_fields": [str(f) for f in (result.get("compared_fields") or [])],
        "mismatch_fields": mismatch_fields,
        "mismatch_field_count": count,
        "result_code": result.get("result_code"),
    }


def record_parity_result(
    result: Mapping[str, Any],
    *,
    recorder: Callable[[Mapping[str, Any]], Any] | None,
) -> dict[str, Any]:
    """Persist a Parity_Result through an injected recorder, or fail closed.

    ``recorder`` is a Backend_Runtime-supplied callable that writes one row to
    ``local_analytics.parity_results``. This module never fabricates a database
    connection: when ``recorder`` is ``None`` no row is written and the returned
    envelope reports ``recorded=False`` so the caller can fail closed rather
    than inventing connectivity. The built row carries field names only.
    """

    row = build_parity_row(result)
    if recorder is None:
        return {"recorded": False, "row": row}
    recorder(row)
    return {"recorded": True, "row": row}
