#!/usr/bin/env python3
"""Tooling startup gate and install measurement (Requirement 11.5, 11.8, 11.9).

This is the runtime companion to the ``Tooling_Selection_Record`` created in
task 28 (``backend/deploy/tooling-selection.v1.json``, design section C7). It
does three separable things, each fail-closed with a bounded fixed code:

1. **Record coherence** (:func:`validate_record_coherence`, Requirement 11.9) —
   the record is only admitted when it enumerates exactly 12 categories, each
   with 2–6 candidates carrying unique candidate ids and pinned image
   tags / package versions (never ``latest``, a movable alias, or a version
   range), and when every current-asset compose / harbor path it references
   resolves on the current tree. Any single mismatch returns
   ``tooling_record_mismatch`` and the record is rejected as a whole.

2. **Startup gate** (:func:`startup_gate`, Requirement 11.5) — a category whose
   ``operatorApproval.status`` is not exactly ``"approved"`` is excluded from
   the default startup set and reported with ``tooling_approval_missing``. There
   is no partial startup of an unapproved category's service. Approval is a
   named human filling ``approverName`` in the record; this code never fills it.

3. **Install measurement** (:func:`install_verify`, Requirement 11.8) — runs
   each candidate's ``installVerifyCommand`` through an *injectable* command
   runner and fills ``macosLocalInstallSucceeded`` / ``installVerifyObservation``
   / ``residentMemoryMiBAt300s`` from the runner's real observation. When a
   candidate is not run, the three fields stay ``null`` — this module never
   estimates or fabricates a measurement. A category with zero
   macos-install-succeeded candidates is marked unresolved and reported with
   ``local_install_unverified``.

Everything is injectable — the record path, the tree root used for path
resolution, and the command runner — so the gate and validators are unit
testable with no live Docker, no network, and no operator secrets. The default
command runner ``_null_command_runner`` deliberately does **not** run anything;
running the real install-verify commands is a local operator step, not a thing
this module fabricates.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests. It records only the bounded fields enumerated in
design C7 and never emits a Forbidden_Log_Field (credentials, tokens, registry
secrets, cookies, headers, provider diagnostics, free-form error strings): the
one free-text field it keeps, ``installVerifyObservation``, is length-bounded.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Bounded fixed codes (design C7 / error-code table). ``None`` means accepted.
# ---------------------------------------------------------------------------

TOOLING_APPROVAL_MISSING = "tooling_approval_missing"  # 11.5
LOCAL_INSTALL_UNVERIFIED = "local_install_unverified"  # 11.8
TOOLING_RECORD_MISMATCH = "tooling_record_mismatch"  # 11.9

# The full closed set this gate may return. Any other value is a defect.
TOOLING_GATE_RESULT_CODES = frozenset(
    {
        None,
        TOOLING_APPROVAL_MISSING,
        LOCAL_INSTALL_UNVERIFIED,
        TOOLING_RECORD_MISMATCH,
    }
)

# ---------------------------------------------------------------------------
# Frozen constants (design C7; Requirement 11.1, 11.4, 11.5).
# ---------------------------------------------------------------------------

# 11 categories of Requirement 11.1 plus the added local-kubernetes category.
EXPECTED_CATEGORY_COUNT = 12

# Candidate cardinality per category (Requirement 11.1, Property 1).
MIN_CANDIDATES_PER_CATEGORY = 2
MAX_CANDIDATES_PER_CATEGORY = 6

# The single approval status that admits a category to the default startup set.
APPROVED_STATUS = "approved"

# Reference kinds a candidate may declare (design C7).
_REFERENCE_KIND_IMAGE_TAG = "image_tag"
_REFERENCE_KIND_PACKAGE_VERSION = "package_version"
_REFERENCE_KIND_ADDRESS_SCHEME = "registry_address_scheme"

# Movable alias tags that are never a pinned reference (Requirement 11.3, 12.10).
_FLOATING_TAGS = frozenset(
    {"latest", "stable", "edge", "nightly", "main", "master", "dev", "current"}
)

# Version-range / wildcard markers a pinned version string must not contain.
_RANGE_MARKERS = ("^", "~", "*", "x", " ", ">", "<", "=", "||", ",")

# The install-verify observation is the one free-text field; bound its length so
# a verbose provider line can never balloon the artifact (Requirement 11.10).
_MAX_OBSERVATION_CHARS = 512
_OBSERVATION_TRUNCATION_MARK = "…[truncated]"


# ---------------------------------------------------------------------------
# Pure result helper (mirrors backend/pipeline_control convention).
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


# Repo layout: backend/bin/tooling_gate.py -> bin -> backend -> <root>.
_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_RECORD_PATH = _ROOT / "backend" / "deploy" / "tooling-selection.v1.json"


def load_record(path: str | Path = _DEFAULT_RECORD_PATH) -> dict:
    """Load and JSON-parse the Tooling_Selection_Record at ``path``."""

    return json.loads(Path(path).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Pinned reference checks (Requirement 11.3).
# ---------------------------------------------------------------------------


def _is_pinned_image_tag(reference: str) -> bool:
    """True iff an image reference pins an exact tag or a sha256 digest.

    Accepts ``name:tag`` (tag taken from the final path segment) or
    ``name@sha256:<64 hex>``. Rejects untagged references, ``latest``, and
    movable alias tags. A registry ``host:port`` prefix is tolerated.
    """

    ref = reference.strip()
    if not ref:
        return False

    if "@" in ref:
        name, _, digest = ref.partition("@")
        if not name:
            return False
        algo, sep, hexpart = digest.partition(":")
        if algo != "sha256" or sep != ":":
            return False
        return len(hexpart) == 64 and all(c in "0123456789abcdef" for c in hexpart)

    last_segment = ref.rsplit("/", 1)[-1]
    if ":" not in last_segment:
        return False  # untagged
    _, _, tag = last_segment.rpartition(":")
    if not tag:
        return False
    return tag.lower() not in _FLOATING_TAGS


def _is_pinned_package_version(reference: str) -> bool:
    """True iff a package/CLI version string is an exact pin, not a range.

    Accepts e.g. ``4.2.4``, ``v5.5.0``, ``1.12.6``. Rejects empty values,
    movable aliases, and any range / wildcard notation.
    """

    ref = reference.strip()
    if not ref:
        return False
    if ref.lower() in _FLOATING_TAGS:
        return False
    lowered = ref.lower()
    return not any(marker in lowered for marker in _RANGE_MARKERS)


def _is_pinned_address_scheme(reference: str) -> bool:
    """True iff a registry address scheme is a concrete address, no wildcard."""

    ref = reference.strip()
    if not ref:
        return False
    if any(ch.isspace() for ch in ref):
        return False
    return "*" not in ref


def is_pinned_reference(reference: Any, reference_kind: Any) -> bool:
    """True iff ``reference`` is a pinned value for its ``reference_kind``.

    Dispatches by the candidate's declared ``referenceKind`` (design C7). An
    unknown kind or a non-string reference is never pinned, so the coherence
    check fails closed.
    """

    if not isinstance(reference, str):
        return False
    if reference_kind == _REFERENCE_KIND_IMAGE_TAG:
        return _is_pinned_image_tag(reference)
    if reference_kind == _REFERENCE_KIND_PACKAGE_VERSION:
        return _is_pinned_package_version(reference)
    if reference_kind == _REFERENCE_KIND_ADDRESS_SCHEME:
        return _is_pinned_address_scheme(reference)
    return False


# ---------------------------------------------------------------------------
# Record coherence (Requirement 11.9 -> tooling_record_mismatch).
# ---------------------------------------------------------------------------


def _referenced_tree_paths(record: Mapping[str, Any]) -> list[str]:
    """Collect the current-asset compose / harbor paths the record references.

    These are the ``composePath`` entries of ``currentAssetDecisions`` — the
    compose overlays and ``harbor-tags.md`` the record is anchored to
    (Requirement 11.9: "컴포즈 파일 경로가 현재 트리에서 해석되는지").
    """

    paths: list[str] = []
    for decision in record.get("currentAssetDecisions", []) or []:
        if isinstance(decision, Mapping):
            compose_path = decision.get("composePath")
            if isinstance(compose_path, str) and compose_path:
                paths.append(compose_path)
    return paths


def validate_record_coherence(
    record: Mapping[str, Any],
    *,
    root: str | Path = _ROOT,
) -> dict:
    """Validate the Tooling_Selection_Record's structural coherence (11.9).

    Rejects the record with ``tooling_record_mismatch`` and a bounded list of
    mismatch descriptors when any of the following holds:

      * the declared ``categoryCount`` is not 12, or the enumerated categories
        are not exactly 12;
      * a category declares fewer than 2 or more than 6 candidates;
      * candidate ids are not unique within a category;
      * a candidate's recorded image tag / package version is not pinned;
      * a referenced current-asset compose / harbor path does not resolve on the
        current tree.

    ``errorCode`` is ``None`` only when there are zero mismatches.
    """

    root_path = Path(root)
    mismatches: list[dict] = []

    categories = record.get("categories")
    if not isinstance(categories, list):
        mismatches.append({"kind": "categories_missing"})
        return _result(False, TOOLING_RECORD_MISMATCH, mismatches=mismatches)

    declared_count = record.get("categoryCount")
    if declared_count != EXPECTED_CATEGORY_COUNT:
        mismatches.append(
            {
                "kind": "declared_category_count",
                "expected": EXPECTED_CATEGORY_COUNT,
                "found": declared_count,
            }
        )
    if len(categories) != EXPECTED_CATEGORY_COUNT:
        mismatches.append(
            {
                "kind": "enumerated_category_count",
                "expected": EXPECTED_CATEGORY_COUNT,
                "found": len(categories),
            }
        )

    for index, category in enumerate(categories):
        if not isinstance(category, Mapping):
            mismatches.append({"kind": "category_not_object", "index": index})
            continue
        name = category.get("category")
        candidates = category.get("candidates")
        if not isinstance(candidates, list):
            mismatches.append({"kind": "candidates_missing", "category": name})
            continue

        count = len(candidates)
        if count < MIN_CANDIDATES_PER_CATEGORY or count > MAX_CANDIDATES_PER_CATEGORY:
            mismatches.append(
                {"kind": "candidate_count", "category": name, "found": count}
            )

        seen_ids: set[str] = set()
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                mismatches.append({"kind": "candidate_not_object", "category": name})
                continue
            candidate_id = candidate.get("candidateId")
            if candidate_id in seen_ids:
                mismatches.append(
                    {
                        "kind": "duplicate_candidate_id",
                        "category": name,
                        "candidateId": candidate_id,
                    }
                )
            elif isinstance(candidate_id, str):
                seen_ids.add(candidate_id)

            if not is_pinned_reference(
                candidate.get("imageTag"), candidate.get("referenceKind")
            ):
                mismatches.append(
                    {
                        "kind": "unpinned_reference",
                        "category": name,
                        "candidateId": candidate_id,
                    }
                )

    for referenced in _referenced_tree_paths(record):
        if not (root_path / referenced).exists():
            mismatches.append({"kind": "unresolved_path", "path": referenced})

    if mismatches:
        return _result(False, TOOLING_RECORD_MISMATCH, mismatches=mismatches)
    return _result(True, None, mismatches=[])


# ---------------------------------------------------------------------------
# Startup gate (Requirement 11.5 -> tooling_approval_missing).
# ---------------------------------------------------------------------------


def _category_approved(category: Mapping[str, Any]) -> bool:
    approval = category.get("operatorApproval")
    if not isinstance(approval, Mapping):
        return False
    approver = approval.get("approverName")
    return (
        approval.get("status") == APPROVED_STATUS
        and isinstance(approver, str)
        and bool(approver.strip())
    )


def startup_gate(record: Mapping[str, Any]) -> dict:
    """Partition categories into the default startup set by approval (11.5).

    A category is admitted to the default startup set only when its
    ``operatorApproval.status`` is exactly ``"approved"`` and its approver name
    is non-empty. Every other category
    is excluded and reported with ``tooling_approval_missing`` — there is no
    partial startup of an unapproved category's service.

    Returns ``{"ok", "errorCode", "admitted": [...], "excluded": [...]}`` where
    ``ok`` is true iff at least one category is admitted (the honest state today
    is zero admitted, since every ``approverName`` is ``null``).
    """

    categories = record.get("categories") or []
    admitted: list[str] = []
    excluded: list[dict] = []

    for category in categories:
        if not isinstance(category, Mapping):
            continue
        name = category.get("category")
        if _category_approved(category):
            admitted.append(name)
        else:
            excluded.append({"category": name, "errorCode": TOOLING_APPROVAL_MISSING})

    error_code = None if admitted else TOOLING_APPROVAL_MISSING
    return _result(bool(admitted), error_code, admitted=admitted, excluded=excluded)


# ---------------------------------------------------------------------------
# Install measurement (Requirement 11.8 -> local_install_unverified).
# ---------------------------------------------------------------------------


def _bounded_observation(observation: Any) -> str | None:
    """Return a length-bounded observation string, or ``None`` when absent."""

    if observation is None:
        return None
    text = str(observation)
    if len(text) <= _MAX_OBSERVATION_CHARS:
        return text
    keep = _MAX_OBSERVATION_CHARS - len(_OBSERVATION_TRUNCATION_MARK)
    return text[:keep] + _OBSERVATION_TRUNCATION_MARK


def _coerce_resident_memory(value: Any) -> int | None:
    """Coerce a resident-memory reading to a non-negative int, else ``None``."""

    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value >= 0:
        return int(value)
    return None


# A command runner receives the candidate's ``installVerifyCommand`` and returns
# a mapping describing the real observation. The contract:
#   {"ran": bool, "exitCode": int|None, "observation": str|None,
#    "residentMemoryMiBAt300s": int|None}
# When ``ran`` is falsy the candidate's three measurement fields stay ``null``.
CommandRunner = Callable[[str], Mapping[str, Any]]


def _null_command_runner(_command: str) -> Mapping[str, Any]:
    """Default runner that runs nothing and reports no measurement.

    This is intentional: install-verify commands are a local operator step. The
    module ships the runner contract but never fabricates a result, so with this
    default every candidate stays unmeasured (``null``) and every category is
    reported ``local_install_unverified``.
    """

    return {"ran": False}


def measure_candidate(
    candidate: Mapping[str, Any],
    command_runner: CommandRunner = _null_command_runner,
) -> dict:
    """Fill a candidate's measurement fields from a real runner observation.

    Returns a shallow copy of ``candidate`` with ``macosLocalInstallSucceeded``,
    ``installVerifyObservation``, and ``residentMemoryMiBAt300s`` set from the
    runner. When the runner reports it did not run the command, the three fields
    are left ``null`` — never estimated (Requirement 11.8, design C7).
    """

    measured = dict(candidate)
    command = candidate.get("installVerifyCommand")

    # Preserve nulls when we have no command to run or the runner did not run.
    measured.setdefault("macosLocalInstallSucceeded", None)
    measured.setdefault("installVerifyObservation", None)
    measured.setdefault("residentMemoryMiBAt300s", None)

    if not isinstance(command, str) or not command.strip():
        measured["macosLocalInstallSucceeded"] = None
        measured["installVerifyObservation"] = None
        measured["residentMemoryMiBAt300s"] = None
        return measured

    observation = command_runner(command)
    if not isinstance(observation, Mapping) or not observation.get("ran"):
        measured["macosLocalInstallSucceeded"] = None
        measured["installVerifyObservation"] = None
        measured["residentMemoryMiBAt300s"] = None
        return measured

    exit_code = observation.get("exitCode")
    measured["macosLocalInstallSucceeded"] = exit_code == 0
    measured["installVerifyObservation"] = _bounded_observation(
        observation.get("observation")
    )
    measured["residentMemoryMiBAt300s"] = _coerce_resident_memory(
        observation.get("residentMemoryMiBAt300s")
    )
    return measured


def install_verify(
    record: Mapping[str, Any],
    command_runner: CommandRunner = _null_command_runner,
) -> dict:
    """Run install-verify per candidate and resolve each category (11.8).

    For every category, each candidate is measured through ``command_runner``.
    A category with zero candidates whose ``macosLocalInstallSucceeded`` is
    ``True`` is marked unresolved and reported with ``local_install_unverified``
    and excluded from the default startup set.

    Returns ``{"ok", "errorCode", "categories": [...]}`` where ``ok`` is true
    iff every category has at least one macos-install-succeeded candidate. With
    the default null runner, ``ok`` is false and every category is unresolved —
    the honest state until an operator runs the commands locally.
    """

    categories_out: list[dict] = []
    any_unverified = False

    for category in record.get("categories") or []:
        if not isinstance(category, Mapping):
            continue
        name = category.get("category")
        candidates = category.get("candidates") or []
        measured = [
            measure_candidate(c, command_runner)
            for c in candidates
            if isinstance(c, Mapping)
        ]
        succeeded = sum(
            1 for c in measured if c.get("macosLocalInstallSucceeded") is True
        )
        resolved = succeeded > 0
        row: dict = {
            "category": name,
            "succeededCandidateCount": succeeded,
            "resolved": resolved,
            "errorCode": None if resolved else LOCAL_INSTALL_UNVERIFIED,
        }
        if not resolved:
            any_unverified = True
        categories_out.append(row)

    error_code = LOCAL_INSTALL_UNVERIFIED if any_unverified else None
    return _result(not any_unverified, error_code, categories=categories_out)


# ---------------------------------------------------------------------------
# Combined evaluation (design C7).
# ---------------------------------------------------------------------------


def evaluate(
    record: Mapping[str, Any],
    *,
    root: str | Path = _ROOT,
    command_runner: CommandRunner = _null_command_runner,
) -> dict:
    """Evaluate coherence, then startup gate + install measurement (C7).

    Fail-closed precedence: record coherence is checked first. On
    ``tooling_record_mismatch`` the gate refuses to proceed (a defective record
    admits nothing). Otherwise the startup gate and install measurement run and
    their results are combined into one bounded artifact.

    The default set is the intersection of *approved* and *install-verified*
    categories: a category must be both operator-approved (11.5) and have a
    macos-install-succeeded candidate (11.8) to be started by default.
    """

    artifact: dict[str, Any] = {
        "ok": False,
        "errorCode": None,
        "recordCoherent": False,
        "gate": None,
        "install": None,
        "defaultStartupSet": [],
    }

    coherence = validate_record_coherence(record, root=root)
    artifact["recordCoherent"] = coherence["ok"]
    if not coherence["ok"]:
        artifact["errorCode"] = coherence["errorCode"]
        artifact["mismatches"] = coherence["mismatches"]
        return artifact

    gate = startup_gate(record)
    install = install_verify(record, command_runner)
    artifact["gate"] = gate
    artifact["install"] = install

    approved = set(gate["admitted"])
    verified = {
        row["category"] for row in install["categories"] if row["resolved"]
    }
    default_set = sorted(approved & verified)
    artifact["defaultStartupSet"] = default_set

    # Surface the first blocking code (approval before install) for the caller.
    if not approved:
        artifact["errorCode"] = TOOLING_APPROVAL_MISSING
    elif not verified:
        artifact["errorCode"] = LOCAL_INSTALL_UNVERIFIED

    artifact["ok"] = bool(default_set)
    return artifact


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Tooling startup gate and install measurement (Requirement 11).",
    )
    parser.add_argument(
        "--record",
        default=str(_DEFAULT_RECORD_PATH),
        help="Path to the Tooling_Selection_Record JSON.",
    )
    parser.add_argument(
        "--artifact",
        default=str(
            _ROOT / "backend" / "log" / "tooling" / "tooling_gate-report.json"
        ),
        help="Path to write the gate artifact JSON.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    record = load_record(args.record)
    # The CLI uses the null runner: it never fabricates a local measurement.
    artifact = evaluate(record, root=_ROOT, command_runner=_null_command_runner)

    out_path = Path(args.artifact)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8"
    )

    return 0 if artifact.get("ok") else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
