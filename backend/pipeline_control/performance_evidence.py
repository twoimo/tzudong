"""Performance evidence path separation and claim discipline (Requirement 3; design C1, D3).

Feature: platform-modernization, Task 45.

This module owns the pure-logic discipline that keeps every Rust_Component
performance claim tied to a retrievable, path-separated, frozen-tree
Performance_Evidence_Set. It carries no I/O and reads no environment: callers in
a Backend_Runtime worker inject any artifact resolver.

What each piece implements
--------------------------
* Canonical path confinement (Requirements 3.6, 3.9). Raw measurements,
  scorer/validator outputs, the artifact map, and budget inputs are retained
  ONLY under ``apps/web/performance/*``. The legacy ``backend/performance/*``
  split is rejected. Any artifact outside the canonical tree returns the bounded fixed code
  ``performance_evidence_path_violation``.

* Performance_Evidence_Set structure (Requirement 3.2, design D3). A set must
  carry an absolute budget, a relative budget, a noise budget, a baseline
  measurement id, a repetition count at or above the metric's canonical minimum
  (7 for backend metrics), the required summary statistic (``p75`` for backend
  metrics), an environment profile id, and the frozen-tree start/end commits
  with their clean flags.

* Noise judgment (Requirement 3.4). When the absolute value of the observed
  improvement is at or below the metric's noise budget, the result is
  ``no_admitted_slice`` — a VALID result, never a failure or rerun.

* Claim establishment (Requirements 3.1, 3.3, 3.5, 3.7, 3.8). A claim without a
  1:1 Performance_Evidence_Set identifier, a set whose artifacts are not
  retrievable, whose recorded artifact-map hash does not match, or whose frozen
  tree changed between start and end, is marked
  ``performance_claim_not_established``.

The three canonical backend metric budgets mirror
``apps/web/performance/performance-budgets.v1.json`` (design D3 table).

Discipline
----------
Every failure path carries one short, stable code from the closed set below. No
provider diagnostics, database error strings, exception messages, or free-form
error text ever leave this module. This source tree makes no claim that any
performance improvement was measured or established.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Canonical path prefix (Requirements 3.6, 3.9; repository evidence policy).
# ---------------------------------------------------------------------------

# Legacy location retained only as an explicit reject predicate.
BACKEND_PERFORMANCE_PREFIX = "backend/performance/"

# Every retained performance input and output lives only here.
WEB_PERFORMANCE_PREFIX = "apps/web/performance/"

# The single canonical budget input file (design D3 ``canonicalBudgetInputRef``).
CANONICAL_BUDGET_INPUT_REF = "apps/web/performance/performance-budgets.v1.json"

# ---------------------------------------------------------------------------
# Performance_Evidence_Set structural constants (Requirement 3.2, design D3).
# ---------------------------------------------------------------------------

# Minimum real repetition count for backend metrics (Requirement 3.2).
MIN_BACKEND_SAMPLE_COUNT = 7

# Required summary statistic for backend metrics (Requirement 3.2).
BACKEND_SUMMARY_STATISTIC = "p75"

# The three canonical backend metric budgets (design D3 table). Each mirrors the
# corresponding entry in ``apps/web/performance/performance-budgets.v1.json``.
BACKEND_METRIC_BUDGETS: dict[str, dict[str, Any]] = {
    "backend.delta_total_p75_ms": {
        "absoluteBudget": {"value": 3_600_000, "unit": "ms"},
        "relativeBudget": {"thresholdBasisPoints": 1_000, "unit": "basis_points"},
        "noiseBudget": {"value": 30_000, "unit": "ms"},
        "sampleMinimum": 7,
        "summaryStatistic": "p75",
    },
    "backend.no_work_p75_ms": {
        "absoluteBudget": {"value": 180_000, "unit": "ms"},
        "relativeBudget": {"thresholdBasisPoints": 1_000, "unit": "basis_points"},
        "noiseBudget": {"value": 30_000, "unit": "ms"},
        "sampleMinimum": 7,
        "summaryStatistic": "p75",
    },
    "backend.peak_rss_mib": {
        "absoluteBudget": {"value": 4_096, "unit": "mib"},
        "relativeBudget": {"thresholdBasisPoints": 1_000, "unit": "basis_points"},
        "noiseBudget": {"value": 128, "unit": "mib"},
        "sampleMinimum": 7,
        "summaryStatistic": "p75",
    },
}

# ---------------------------------------------------------------------------
# Closed set of bounded fixed codes / result markers.
# ---------------------------------------------------------------------------

# A performance artifact or canonical input was found outside the canonical
# web performance tree (Requirement 3.9). The evidence set is invalid.
CODE_PATH_VIOLATION = "performance_evidence_path_violation"

# A performance claim has no 1:1 evidence-set id, its artifacts are not
# retrievable, its artifact-map hash does not match, or its frozen tree changed
# between start and end (Requirements 3.3, 3.7, 3.8).
CODE_CLAIM_NOT_ESTABLISHED = "performance_claim_not_established"

# Not an error. The observed improvement's absolute value is at or below the
# metric noise budget; the scoring run is a valid result (Requirement 3.4).
RESULT_NO_ADMITTED_SLICE = "no_admitted_slice"

# The observed improvement exceeds the noise budget: a candidate admitted slice.
RESULT_ADMITTED_SLICE = "admitted_slice"

PERFORMANCE_FIXED_CODES = frozenset(
    {
        None,
        CODE_PATH_VIOLATION,
        CODE_CLAIM_NOT_ESTABLISHED,
    }
)

_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Small shared predicates.
# ---------------------------------------------------------------------------
def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _normalize_path(path: Any) -> str:
    """Return a forward-slash path stripped of a leading ``./`` for prefixing."""

    text = str(path).strip().replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text


def is_backend_performance_path(path: Any) -> bool:
    """True when ``path`` is under the backend-only performance tree."""

    return _normalize_path(path).startswith(BACKEND_PERFORMANCE_PREFIX)


def is_web_performance_path(path: Any) -> bool:
    """True when ``path`` is under the web canonical performance tree."""

    normalized = _normalize_path(path)
    parts = normalized.split("/")
    return (
        normalized.startswith(WEB_PERFORMANCE_PREFIX)
        and all(part not in {"", ".", ".."} for part in parts)
    )


def _ok() -> dict[str, Any]:
    return {"ok": True, "code": None}


def _reject(code: str) -> dict[str, Any]:
    return {"ok": False, "code": code}


# ---------------------------------------------------------------------------
# Path separation (Requirements 3.6, 3.9).
# ---------------------------------------------------------------------------
def check_evidence_path_separation(
    raw_artifact_paths: Sequence[Any],
    budget_input_paths: Sequence[Any],
) -> dict[str, Any]:
    """Enforce canonical performance evidence path confinement.

    Raw measurements and canonical budget inputs must both live under
    ``apps/web/performance/*``. This also rejects the superseded
    ``backend/performance/*`` location. Any artifact outside the canonical tree
    returns ``performance_evidence_path_violation`` (Requirements 3.6, 3.9).

    The function is pure: it inspects the path strings only and touches no
    filesystem.
    """

    for raw_path in raw_artifact_paths or ():
        if not is_web_performance_path(raw_path):
            return _reject(CODE_PATH_VIOLATION)

    for budget_path in budget_input_paths or ():
        if not is_web_performance_path(budget_path):
            return _reject(CODE_PATH_VIOLATION)

    return _ok()


# ---------------------------------------------------------------------------
# Frozen tree (Requirements 3.5, 3.8).
# ---------------------------------------------------------------------------
def is_frozen_tree_valid(frozen_tree: Any) -> bool:
    """True only when the measurement start and end trees are the same and clean.

    A Performance_Evidence_Set records the start and end commit identifiers with
    a clean/unchanged flag each (Requirement 3.5). The frozen tree is valid only
    when ``startCommit`` equals ``endCommit`` (both non-blank) and both
    ``startClean`` and ``endClean`` are true (Requirement 3.8).
    """

    if not isinstance(frozen_tree, Mapping):
        return False
    start_commit = frozen_tree.get("startCommit")
    end_commit = frozen_tree.get("endCommit")
    if not isinstance(start_commit, str) or not _GIT_SHA.fullmatch(start_commit):
        return False
    if not isinstance(end_commit, str) or not _GIT_SHA.fullmatch(end_commit):
        return False
    if start_commit != end_commit:
        return False
    return frozen_tree.get("startClean") is True and frozen_tree.get("endClean") is True


# ---------------------------------------------------------------------------
# Noise judgment (Requirement 3.4).
# ---------------------------------------------------------------------------
def judge_improvement(
    observed_value: Any,
    baseline_value: Any,
    noise_budget: Any,
) -> dict[str, Any]:
    """Classify a scoring run against the metric noise budget.

    The observed improvement is the baseline value minus the observed value. When
    the absolute value of that improvement is at or below ``noise_budget`` the
    judgment is ``no_admitted_slice`` — a VALID result that is never a failure or
    a rerun (Requirement 3.4). Otherwise the run is a candidate ``admitted_slice``.

    Returns ``{"judgment", "improvement", "isValidResult", "isFailure"}``.
    ``isValidResult`` is always ``True`` and ``isFailure`` is always ``False``
    for a completed scoring run; the noise budget only decides admission, not
    success (Requirement 3.4).
    """

    improvement = baseline_value - observed_value
    within_noise = abs(improvement) <= noise_budget
    judgment = RESULT_NO_ADMITTED_SLICE if within_noise else RESULT_ADMITTED_SLICE
    return {
        "judgment": judgment,
        "improvement": improvement,
        "isValidResult": True,
        "isFailure": False,
    }


# ---------------------------------------------------------------------------
# Performance_Evidence_Set structure (Requirement 3.2, design D3).
# ---------------------------------------------------------------------------
def validate_evidence_set_structure(evidence_set: Any) -> dict[str, Any]:
    """Validate a Performance_Evidence_Set's required fields and budgets.

    Checks the design D3 contract: a non-blank evidence-set id, slice id, and
    metric key; an absolute budget, relative budget, and noise budget; a baseline
    measurement id; a repetition count at or above the metric minimum (7 for
    backend metrics); the required summary statistic (``p75`` for backend
    metrics); and a non-blank environment profile id (Requirement 3.2).

    Path separation and frozen-tree checks are performed by their dedicated
    functions and by :func:`establish_claim`; this function returns
    ``performance_claim_not_established`` on any structural defect so a caller can
    treat a malformed set as an unestablished claim.
    """

    if not isinstance(evidence_set, Mapping):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    for field in ("evidenceSetId", "sliceId", "metricKey", "baselineMeasurementId", "environmentProfileId"):
        if _is_blank(evidence_set.get(field)):
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    metric_key = evidence_set.get("metricKey")
    metric = BACKEND_METRIC_BUDGETS.get(metric_key)
    if metric is None:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    for budget_field in ("absoluteBudget", "relativeBudget", "noiseBudget"):
        if evidence_set.get(budget_field) != metric[budget_field]:
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    sample_minimum = metric["sampleMinimum"]
    summary_required = metric["summaryStatistic"]

    rep = evidence_set.get("repetitionCount")
    if isinstance(rep, bool) or not isinstance(rep, int) or rep < sample_minimum:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    if evidence_set.get("summaryStatistic") != summary_required:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    raw_paths = evidence_set.get("rawArtifactPaths")
    if not isinstance(raw_paths, list) or not raw_paths:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    if evidence_set.get("canonicalBudgetInputRef") != CANONICAL_BUDGET_INPUT_REF:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    artifact_map_sha = evidence_set.get("artifactMapSha256")
    if not isinstance(artifact_map_sha, str) or not _SHA256.fullmatch(artifact_map_sha):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    return _ok()


# ---------------------------------------------------------------------------
# Artifact map retrieval / hash (Requirement 3.3).
# ---------------------------------------------------------------------------
def check_artifact_map(
    evidence_set: Mapping[str, Any],
    *,
    artifact_resolver: Callable[[Mapping[str, Any]], Mapping[str, Any]] | None,
) -> dict[str, Any]:
    """Verify a Performance_Evidence_Set's artifacts are retrievable and match.

    ``artifact_resolver`` is a Backend_Runtime-supplied callable that resolves the
    raw measurement artifacts, scorer output, validator output, and canonical
    budget input for the set, returning ``{"retrieved": bool, "artifactMapSha256":
    str}``. This module never fabricates connectivity: when ``artifact_resolver``
    is ``None`` the claim fails closed to ``performance_claim_not_established``.

    The claim is unestablished when the artifacts are not retrievable or the
    resolved artifact-map hash does not match the set's recorded
    ``artifactMapSha256`` (Requirement 3.3).
    """

    recorded_hash = evidence_set.get("artifactMapSha256")
    if (
        not isinstance(recorded_hash, str)
        or not _SHA256.fullmatch(recorded_hash)
        or artifact_resolver is None
    ):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    resolution = artifact_resolver(evidence_set)
    if not isinstance(resolution, Mapping):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    if resolution.get("retrieved") is not True:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    if resolution.get("artifactMapSha256") != recorded_hash:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    return _ok()


# ---------------------------------------------------------------------------
# Claim establishment (Requirements 3.1, 3.3, 3.7, 3.8, 3.9).
# ---------------------------------------------------------------------------
def establish_claim(
    claim: Mapping[str, Any],
    evidence_set: Mapping[str, Any] | None,
    *,
    artifact_resolver: Callable[[Mapping[str, Any]], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Decide whether a Rust_Component performance claim is established.

    A performance claim (a number written in a repo document, merge-candidate
    description, or change log) must carry a 1:1 Performance_Evidence_Set
    identifier in the same place (Requirement 3.1). This function runs the full
    admission chain and returns ``{"ok", "code"}`` with a bounded fixed code:

      * missing/blank ``evidenceSetId`` on the claim, or no evidence set, or an
        id mismatch between the claim and the set → ``performance_claim_not_established``
        (Requirements 3.1, 3.7);
      * a path-separation violation on the set's raw artifacts or budget input
        reference → ``performance_evidence_path_violation`` (Requirement 3.9);
      * a structural defect, frozen-tree change, non-retrievable artifacts, or
        artifact-map hash mismatch → ``performance_claim_not_established``
        (Requirements 3.2, 3.3, 3.8).

    The path check runs before the frozen-tree/hash checks so a path violation is
    reported with its own dedicated code (Requirement 3.9).
    """

    claim_set_id = claim.get("evidenceSetId") if isinstance(claim, Mapping) else None
    if _is_blank(claim_set_id) or not isinstance(evidence_set, Mapping):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)
    if evidence_set.get("evidenceSetId") != claim_set_id:
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    # Path separation first, so a path violation carries its own code (3.9).
    budget_ref = evidence_set.get("canonicalBudgetInputRef")
    budget_paths = [budget_ref] if not _is_blank(budget_ref) else []
    path_result = check_evidence_path_separation(
        evidence_set.get("rawArtifactPaths") or [], budget_paths
    )
    if not path_result["ok"]:
        return path_result

    structure_result = validate_evidence_set_structure(evidence_set)
    if not structure_result["ok"]:
        return structure_result

    if not is_frozen_tree_valid(evidence_set.get("frozenTree")):
        return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    artifact_result = check_artifact_map(
        evidence_set, artifact_resolver=artifact_resolver
    )
    if not artifact_result["ok"]:
        return artifact_result

    return _ok()


# ---------------------------------------------------------------------------
# Merge-candidate gate (Requirement 3.7).
# ---------------------------------------------------------------------------
def check_merge_candidate_claims(
    claims: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Gate a merge candidate that carries performance-improvement numbers.

    A merge candidate is rejected with ``performance_claim_not_established`` when
    any of its performance-improvement numbers has no Performance_Evidence_Set
    identifier or references a set already marked
    ``performance_claim_not_established`` (Requirement 3.7). Each claim is a
    mapping that may carry ``evidenceSetId`` and an ``established`` flag.

    Returns ``{"ok", "code"}``; ``ok`` is ``True`` only when every claim carries a
    non-blank evidence-set id and is not marked unestablished.
    """

    for claim in claims or ():
        if not isinstance(claim, Mapping):
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)
        if _is_blank(claim.get("evidenceSetId")):
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)
        if claim.get("established") is not True:
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)
        if claim.get("resultCode") == CODE_CLAIM_NOT_ESTABLISHED:
            return _reject(CODE_CLAIM_NOT_ESTABLISHED)

    return _ok()
