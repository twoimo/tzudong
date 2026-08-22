"""Compatible current-summary.json writer and N=3 parity gate.

Deletion of run_daily.sh is refused until three consecutive control-plane
manifests match the last .sh baseline on policy/smart-skip fields.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from backend.utils.run_daily_helpers import (
    validate_summary_manifest_payload,
    write_json,
)

REQUIRED_MATCH_COUNT = 3
LIVE_EVIDENCE_SCHEMA = "pipeline-live-evidence-v1"
PARITY_LEDGER_SCHEMA_VERSION = 2
# P1 can describe and validate the future receipt shape, but Slice 0 cannot
# prove API-to-worker run-ID continuity or authoritative database readback.
# P2/P4 must remove this fail-closed latch in the same change that supplies and
# verifies those receipts; no environment or manifest field can enable it.
AUTHORITATIVE_LIVE_EVIDENCE_ENABLED = False
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

    if not AUTHORITATIVE_LIVE_EVIDENCE_ENABLED:
        return False
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
    if not AUTHORITATIVE_LIVE_EVIDENCE_ENABLED:
        return False
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
