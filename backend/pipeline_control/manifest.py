"""Compatible current-summary.json writer and N=3 parity gate.

Deletion of run_daily.sh is refused until three consecutive control-plane
manifests match the last .sh baseline on policy/smart-skip fields.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Mapping

from backend.pipeline_control.schedule import utc_to_kst_minutes
from backend.utils.run_daily_helpers import (
    validate_summary_manifest_payload,
    write_json,
)
from backend.utils.supabase_rest import (
    PIPELINE_CONTEXT_ENV_NAMES,
    PIPELINE_HOSTED_APPLY_APPROVED_ENV,
    PIPELINE_HOSTED_APPLY_ENABLED,
    PIPELINE_HOSTED_PROJECT_REF_ENV,
    PROJECT_REF_RE,
    SupabaseRestConfigurationError,
    _loopback_url,
    _optional_pipeline_value,
    _parse_url,
    _production_url,
    _resolve_pipeline_data_sink,
    _resolve_pipeline_execution_mode,
)

REQUIRED_MATCH_COUNT = 3
LIVE_EVIDENCE_SCHEMA = "pipeline-live-evidence-v1"
PARITY_LEDGER_SCHEMA_VERSION = 2
# Eligibility is recomputed from receipt fields. FileStore remains the GET
# source of truth; overlay compose must not add Postgres for this gate.
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_GIT_SHA_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
LIVE_EVIDENCE_FIELDS = (
    "executionMode",
    "dataSink",
    "finalStatus",
    "finalExitCode",
    "noWorkShortCircuit",
    "jobId",
    "gitSha",
    "evidenceSchemaVersion",
    "sameRunIdVerified",
    "computeProfile",
    "target",
    "inputSha256",
    "outputSha256",
    "stepEvidenceSha256",
    "baselineSha256",
    "candidateSha256",
    "readbackSha256",
    "evidenceReceiptSha256",
    "baselineRowCount",
    "candidateRowCount",
    "readbackRowCount",
)
POLICY_COMPARE_FIELDS = (
    "finalStatus",
    "finalExitCode",
    "failedRequiredSteps",
    "optionalSkips",
    "downstreamSkips",
    "noWorkShortCircuit",
    "policyMode",
)


def is_live_execution_success(manifest: dict[str, Any]) -> bool:
    """Return whether this is a successful live execution, not a dry run."""

    job_id = manifest.get("jobId")
    git_sha = manifest.get("gitSha")
    return bool(
        manifest.get("executionMode") == "live"
        and manifest.get("dataSink") == "local_db"
        and manifest.get("finalStatus") == "OK"
        and manifest.get("finalExitCode") == 0
        and manifest.get("noWorkShortCircuit") is False
        and isinstance(job_id, str)
        and bool(job_id.strip())
        and isinstance(git_sha, str)
        and _GIT_SHA_RE.fullmatch(git_sha) is not None
    )


def is_live_evidence_eligible(manifest: dict[str, Any]) -> bool:
    """Recompute N=3 eligibility; never trust a manifest's claimed boolean."""

    sha_fields = (
        "inputSha256",
        "outputSha256",
        "stepEvidenceSha256",
        "baselineSha256",
        "candidateSha256",
        "readbackSha256",
        "evidenceReceiptSha256",
    )
    counts = (
        manifest.get("baselineRowCount"),
        manifest.get("candidateRowCount"),
        manifest.get("readbackRowCount"),
    )
    return bool(
        is_live_execution_success(manifest)
        and manifest.get("evidenceSchemaVersion") == LIVE_EVIDENCE_SCHEMA
        and manifest.get("sameRunIdVerified") is True
        and manifest.get("computeProfile") == "heavy_local"
        and isinstance(manifest.get("target"), str)
        and bool(manifest["target"].strip())
        and all(
            isinstance(manifest.get(field), str)
            and _SHA256_RE.fullmatch(manifest[field]) is not None
            for field in sha_fields
        )
        and manifest.get("baselineSha256") == manifest.get("candidateSha256")
        and manifest.get("candidateSha256") == manifest.get("readbackSha256")
        and all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in counts
        )
        and counts[0] == counts[1] == counts[2]
    )


def _evidence_cohort(manifest: dict[str, Any]) -> dict[str, Any] | None:
    if not is_live_evidence_eligible(manifest):
        return None
    return {
        "gitSha": manifest["gitSha"],
        "inputSha256": manifest["inputSha256"],
        "target": manifest["target"],
        "computeProfile": manifest["computeProfile"],
        "dataSink": manifest["dataSink"],
        "baselineSha256": manifest["baselineSha256"],
        "baselineRowCount": manifest["baselineRowCount"],
    }


def policy_projection(manifest: dict[str, Any]) -> dict[str, Any]:
    steps = []
    for event in manifest.get("stepEvents") or []:
        if not isinstance(event, dict):
            continue
        steps.append(
            {
                "name": event.get("name"),
                "status": event.get("status"),
                "reason": event.get("reason"),
                "upstreamStep": event.get("upstreamStep"),
            }
        )
    return {
        field: manifest.get(field) for field in POLICY_COMPARE_FIELDS
    } | {"stepEvents": steps}


def write_compatible_summary(path: Path, payload: dict[str, Any]) -> Path:
    validate_summary_manifest_payload(payload)
    write_json(path, payload)
    return path


def compare_policy(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    validate_summary_manifest_payload(baseline)
    validate_summary_manifest_payload(candidate)
    left = policy_projection(baseline)
    right = policy_projection(candidate)
    live_eligible = is_live_evidence_eligible(candidate)
    matched = left == right and live_eligible
    return {
        "matched": matched,
        "policyMatched": left == right,
        "liveEvidenceEligible": live_eligible,
        "baseline": left,
        "candidate": right,
    }


def load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest must be an object")
    return payload


def record_parity_attempt(
    ledger_path: Path,
    *,
    matched: bool,
    candidate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    else:
        ledger = {
            "schemaVersion": PARITY_LEDGER_SCHEMA_VERSION,
            "consecutiveMatches": 0,
            "cohort": None,
            "attempts": [],
        }
    if ledger.get("schemaVersion") != PARITY_LEDGER_SCHEMA_VERSION:
        ledger = {
            "schemaVersion": PARITY_LEDGER_SCHEMA_VERSION,
            "consecutiveMatches": 0,
            "cohort": None,
            "attempts": [],
            "legacyLedgerRejected": True,
        }
    live_eligible = candidate is not None and is_live_evidence_eligible(candidate)
    job_id = candidate.get("jobId") if candidate is not None else None
    receipt_sha = (
        candidate.get("evidenceReceiptSha256") if candidate is not None else None
    )
    prior_admitted_job_ids = {
        attempt.get("jobId")
        for attempt in ledger.get("attempts", [])
        if isinstance(attempt, dict) and attempt.get("matched") is True
    }
    prior_admitted_receipts = {
        attempt.get("evidenceReceiptSha256")
        for attempt in ledger.get("attempts", [])
        if isinstance(attempt, dict) and attempt.get("matched") is True
    }
    duplicate_job = job_id in prior_admitted_job_ids
    duplicate_receipt = receipt_sha in prior_admitted_receipts
    candidate_cohort = _evidence_cohort(candidate) if candidate is not None else None
    prior_consecutive = int(ledger.get("consecutiveMatches") or 0)
    pinned_cohort = ledger.get("cohort")
    cohort_matches = bool(
        candidate_cohort is not None
        and (prior_consecutive == 0 or pinned_cohort == candidate_cohort)
    )
    admitted_match = bool(
        matched
        and live_eligible
        and not duplicate_job
        and not duplicate_receipt
        and cohort_matches
    )
    consecutive = ledger.get("consecutiveMatches", 0) + 1 if admitted_match else 0
    ledger["consecutiveMatches"] = consecutive
    ledger["cohort"] = candidate_cohort if admitted_match else None
    ledger["attempts"].append(
        {
            "matched": admitted_match,
            "policyMatched": bool(matched),
            "liveEvidenceEligible": live_eligible,
            "duplicateJob": duplicate_job,
            "duplicateReceipt": duplicate_receipt,
            "cohortMatched": cohort_matches,
            "jobId": job_id,
            "evidenceReceiptSha256": receipt_sha,
            "cohort": candidate_cohort,
            "evidence": (
                {
                    field: candidate.get(field)
                    for field in LIVE_EVIDENCE_FIELDS
                }
                if candidate is not None
                else None
            ),
        }
    )
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return ledger


def deletion_allowed(ledger: dict[str, Any]) -> bool:
    if ledger.get("schemaVersion") != PARITY_LEDGER_SCHEMA_VERSION:
        return False
    attempts = ledger.get("attempts")
    cohort = ledger.get("cohort")
    if not isinstance(attempts, list) or not isinstance(cohort, dict):
        return False
    try:
        consecutive = int(ledger.get("consecutiveMatches") or 0)
    except (TypeError, ValueError):
        return False
    if consecutive < REQUIRED_MATCH_COUNT or len(attempts) < REQUIRED_MATCH_COUNT:
        return False
    admitted = attempts[-REQUIRED_MATCH_COUNT:]
    job_ids: set[str] = set()
    receipt_shas: set[str] = set()
    for attempt in admitted:
        if not isinstance(attempt, dict):
            return False
        evidence = attempt.get("evidence")
        job_id = attempt.get("jobId")
        receipt_sha = attempt.get("evidenceReceiptSha256")
        if not (
            attempt.get("matched") is True
            and attempt.get("policyMatched") is True
            and attempt.get("liveEvidenceEligible") is True
            and attempt.get("duplicateJob") is False
            and attempt.get("duplicateReceipt") is False
            and attempt.get("cohortMatched") is True
            and attempt.get("cohort") == cohort
            and isinstance(evidence, dict)
            and is_live_evidence_eligible(evidence)
            and _evidence_cohort(evidence) == cohort
            and isinstance(job_id, str)
            and bool(job_id.strip())
            and evidence.get("jobId") == job_id
            and isinstance(receipt_sha, str)
            and _SHA256_RE.fullmatch(receipt_sha) is not None
            and evidence.get("evidenceReceiptSha256") == receipt_sha
        ):
            return False
        job_ids.add(job_id)
        receipt_shas.add(receipt_sha)
    return (
        len(job_ids) == REQUIRED_MATCH_COUNT
        and len(receipt_shas) == REQUIRED_MATCH_COUNT
    )


def refuse_shim_deletion(ledger: dict[str, Any]) -> None:
    if not deletion_allowed(ledger):
        raise PermissionError("shim_deletion_blocked_until_n3_parity")


# ---------------------------------------------------------------------------
# Additive Run_Manifest fields (crawler-pipeline-orchestration, R5/R1.7/R6.2)
#
# Every field defined below is ADDITIVE, bounded, and secret-free. None of it
# removes or renames an existing manifest field. The rejection-code enumeration
# is a closed set; the operator summary is length-bounded; the reflection object
# is a placeholder for per-candidate accounting populated by the Mac apply path.
# ---------------------------------------------------------------------------

# Fixed maximum length for the one-line Operator-readable summary (R5.8).
OPERATOR_SUMMARY_MAX_LENGTH = 200

# Closed set of hosted-gate rejection codes recorded in the manifest (R3.7).
# The gate's internal configuration conditions are mapped onto exactly one of
# these bounded codes at the manifest layer; provider/DB text is never recorded.
HOSTED_GATE_REJECTION_CODES = frozenset(
    {
        "sink_not_admitted",
        "loopback_required",
        "hosted_apply_disabled",
        "not_live_mode",
        "approval_flag_absent",
        "project_ref_mismatch",
        "config_invalid",
    }
)

# Fixed status vocabulary. finalStatus is OK exclusive-or ERROR, mapped from the
# run status Succeeded exclusive-or Failed (R5.5). The two are mutually exclusive.
RUN_STATUS_SUCCEEDED = "Succeeded"
RUN_STATUS_FAILED = "Failed"
FINAL_STATUS_OK = "OK"
FINAL_STATUS_ERROR = "ERROR"
_STATUS_VOCABULARY = {
    RUN_STATUS_SUCCEEDED: FINAL_STATUS_OK,
    RUN_STATUS_FAILED: FINAL_STATUS_ERROR,
}

# Compute-profile -> runner label used in the committed cadence config.
_PROFILE_TO_RUNNER = {
    "lite_gha": "GHA_Runner",
    "heavy_local": "Mac_Runner",
}

CADENCE_CONFIG_PATH = Path(__file__).resolve().parent / "cadence.schedule.json"

_HHMM_RE = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]")
_GENERATED_AT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}Z")


def final_status_for(run_status: str) -> str:
    """Map a run status onto the mutually-exclusive OK/ERROR final vocabulary.

    Only ``Succeeded`` maps to ``OK``; every other status (``Failed``,
    ``Cancelled``, ``Paused``) maps to ``ERROR`` so success and failure remain
    mutually exclusive (R5.5).
    """

    return _STATUS_VOCABULARY.get(run_status, FINAL_STATUS_ERROR)


def _hhmm_to_minutes(value: object) -> int | None:
    if not isinstance(value, str) or _HHMM_RE.fullmatch(value) is None:
        return None
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def _normalized_hhmm(value: object) -> str | None:
    return value if isinstance(value, str) and _HHMM_RE.fullmatch(value) is not None else None


def _load_cadence_windows(config_path: Path | None = None) -> list[dict[str, Any]]:
    path = config_path or CADENCE_CONFIG_PATH
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(config, dict):
        return []
    windows = config.get("windows")
    if not isinstance(windows, list):
        return []
    return [window for window in windows if isinstance(window, dict)]


def cadence_window_for_profile(
    compute_profile: object,
    *,
    config_path: Path | None = None,
) -> tuple[str | None, str | None]:
    """Return ``(kstStart, kstEnd)`` for the runner mapped to ``compute_profile``.

    Values are bounded ``HH:MM`` KST strings drawn from the committed cadence
    config, or ``(None, None)`` when the profile is unknown, the config is
    absent/malformed, or the window shape is invalid (R1.5, R1.7).
    """

    if not isinstance(compute_profile, str):
        return (None, None)
    runner = _PROFILE_TO_RUNNER.get(compute_profile)
    for window in _load_cadence_windows(config_path):
        matches_profile = window.get("profile") == compute_profile
        matches_runner = runner is not None and window.get("runner") == runner
        if matches_profile or matches_runner:
            return (
                _normalized_hhmm(window.get("kstStart")),
                _normalized_hhmm(window.get("kstEnd")),
            )
    return (None, None)


def derive_window_overrun(window_end: object, generated_at: object) -> bool:
    """Return whether the KST completion time is past ``window_end`` (R1.7).

    ``generated_at`` is the UTC ``%Y-%m-%dT%H:%M:%SZ`` manifest timestamp; it is
    converted to a KST minute-of-day with the fixed UTC+9 offset and compared to
    the ``HH:MM`` KST ``window_end``. Returns ``False`` when either input is
    absent or malformed (no window means no overrun to record).
    """

    end_minutes = _hhmm_to_minutes(window_end)
    if end_minutes is None or not isinstance(generated_at, str):
        return False
    match = _GENERATED_AT_RE.fullmatch(generated_at)
    if match is None:
        return False
    utc_minutes = int(match.group(1)) * 60 + int(match.group(2))
    return utc_to_kst_minutes(utc_minutes) > end_minutes


def empty_reflection_accounting() -> dict[str, list[str]]:
    """Return the empty per-candidate reflection placeholder (R4.4).

    The Mac apply path (task 5.2) populates these mutually-exclusive lists; the
    manifest writer emits this placeholder for runs that perform no reflection.
    """

    return {"applied": [], "skippedAlreadyPresent": [], "unresolved": []}


def normalize_reflection_accounting(reflection: object) -> dict[str, list[str]]:
    """Coerce a reflection object into the bounded three-list accounting shape.

    Only ``applied`` / ``skippedAlreadyPresent`` / ``unresolved`` string lists
    are retained; anything else is dropped so no raw payload leaks into the
    manifest (R4.4, R5.9).
    """

    if not isinstance(reflection, dict):
        return empty_reflection_accounting()
    normalized: dict[str, list[str]] = {}
    for key in ("applied", "skippedAlreadyPresent", "unresolved"):
        value = reflection.get(key)
        if isinstance(value, list):
            normalized[key] = [item for item in value if isinstance(item, str)]
        else:
            normalized[key] = []
    return normalized


def build_operator_summary(
    *,
    final_status: str,
    execution_mode: object,
    data_sink: object,
    failed_required_count: int,
) -> str:
    """Build the bounded one-line Operator-readable summary (R5.8).

    Encodes the final status, execution mode, data sink, and failed-required-step
    count without requiring raw log inspection, truncated to the fixed maximum.
    """

    mode = execution_mode if isinstance(execution_mode, str) and execution_mode else "unknown"
    sink = data_sink if isinstance(data_sink, str) and data_sink else "unknown"
    count = failed_required_count if isinstance(failed_required_count, int) and failed_required_count >= 0 else 0
    summary = (
        f"status={final_status} mode={mode} sink={sink} failedRequiredSteps={count}"
    )
    return summary[:OPERATOR_SUMMARY_MAX_LENGTH]


def normalize_missed_window_count(value: object) -> int:
    """Coerce ``missedWindowCount`` to a non-negative int (R6.2)."""

    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def validate_hosted_gate_rejection_code(code: object) -> str | None:
    """Return ``code`` when it is ``None`` or a member of the closed set (R3.7).

    Raises ``ValueError`` for any out-of-set value so an unbounded or free-form
    rejection reason can never reach the manifest.
    """

    if code is None:
        return None
    if isinstance(code, str) and code in HOSTED_GATE_REJECTION_CODES:
        return code
    raise ValueError("hosted_gate_rejection_code_invalid")


def map_hosted_gate_rejection_code(
    environment: Mapping[str, object] | None = None,
    *,
    profile: str | None = None,
    execution_mode: str | None = None,
) -> str:
    """Map a hosted-gate rejection onto exactly one bounded code (R3.7, R9.4).

    Mirrors the decision precedence of ``admit_pipeline_supabase_boundary`` using
    the gate's own resolution helpers, returning a single member of
    ``HOSTED_GATE_REJECTION_CODES``. The mapping performs no network access and
    never reads or returns a secret value; provider identifiers, database error
    text, connection strings, and free-form diagnostics are never produced. Any
    condition the gate treats as an invalid configuration value collapses to the
    bounded ``config_invalid`` code. Callers invoke this only after the gate has
    already raised ``SupabaseRestConfigurationError`` for the same inputs, so a
    single bounded code is always returned.
    """

    env = os.environ if environment is None else environment
    try:
        data_sink = _resolve_pipeline_data_sink(env, profile)
        mode = _resolve_pipeline_execution_mode(env, execution_mode)
    except SupabaseRestConfigurationError:
        return "config_invalid"

    pipeline_context = bool(
        profile is not None
        or execution_mode is not None
        or any(name in env for name in PIPELINE_CONTEXT_ENV_NAMES)
    )

    raw_url = env.get("SUPABASE_URL")
    if raw_url is None or raw_url == "":
        # A hosted_apply sink with no endpoint is held closed by the
        # compile-time enablement latch; nothing else rejects on an empty URL.
        return "hosted_apply_disabled" if data_sink == "hosted_apply" else "config_invalid"
    if not isinstance(raw_url, str):
        return "config_invalid"
    try:
        parsed = _parse_url(raw_url)
    except SupabaseRestConfigurationError:
        return "config_invalid"

    if pipeline_context and data_sink is None:
        return "sink_not_admitted"

    if data_sink in {"local_db", "artifact_only"}:
        return "loopback_required" if _loopback_url(parsed) is None else "config_invalid"

    if data_sink == "hosted_apply":
        # The hosted-apply latch is a compile-time False constant; this is the
        # governing rejection reason for any hosted write while it stays closed.
        if not PIPELINE_HOSTED_APPLY_ENABLED:
            return "hosted_apply_disabled"
        if mode != "live":
            return "not_live_mode"
        if env.get(PIPELINE_HOSTED_APPLY_APPROVED_ENV) != "1":
            return "approval_flag_absent"
        try:
            project_ref = _optional_pipeline_value(env, PIPELINE_HOSTED_PROJECT_REF_ENV)
        except SupabaseRestConfigurationError:
            return "config_invalid"
        canonical_url = _production_url(parsed)
        expected_url = (
            f"https://{project_ref}.supabase.co"
            if project_ref is not None and PROJECT_REF_RE.fullmatch(project_ref)
            else None
        )
        if canonical_url is None or canonical_url != expected_url:
            return "project_ref_mismatch"

    return "config_invalid"
