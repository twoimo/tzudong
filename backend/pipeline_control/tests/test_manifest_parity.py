"""N=3 parity gate must refuse .sh deletion without matching live runs."""

from __future__ import annotations

import json
from hashlib import sha256
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from backend.pipeline_control.manifest import (
    REQUIRED_MATCH_COUNT,
    compare_policy,
    deletion_allowed,
    record_parity_attempt,
    refuse_shim_deletion,
    write_compatible_summary,
)
from backend.utils.run_daily_helpers import validate_summary_manifest_payload

def _ok_payload(*, execution_mode: str = "live", job_id: str = "job-live-1") -> dict:
    readback_sha = "c" * 64
    return {
        "generatedAt": "2026-08-17T00:00:00Z",
        "date": "2026-08-17",
        "finalStatus": "OK",
        "finalExitCode": 0,
        "failedRequiredSteps": [],
        "optionalSkips": [],
        "downstreamSkips": [],
        "latestLogPath": "backend/log/cron/daily.log",
        "summaryPath": "summary.md",
        "noWorkShortCircuit": False,
        "policyMode": "end_to_end",
        "stepEvents": [{"name": "Step 1 (URL Collection)", "status": "completed", "durationSeconds": 1}],
        "jobId": job_id,
        "sameRunIdVerified": True,
        "executionMode": execution_mode,
        "dataSink": "local_db",
        "computeProfile": "heavy_local",
        "target": "tzuyang",
        "gitSha": "a" * 40,
        "inputSha256": "b" * 64,
        "outputSha256": readback_sha,
        "stepEvidenceSha256": "d" * 64,
        "evidenceSchemaVersion": "pipeline-live-evidence-v1",
        "baselineSha256": readback_sha,
        "candidateSha256": readback_sha,
        "readbackSha256": readback_sha,
        "evidenceReceiptSha256": sha256(job_id.encode("utf-8")).hexdigest(),
        "baselineRowCount": 25,
        "candidateRowCount": 25,
        "readbackRowCount": 25,
    }


class ManifestParityTests(unittest.TestCase):
    def test_writer_validates_contract(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "current-summary.json"
            write_compatible_summary(path, _ok_payload())
            validate_summary_manifest_payload(json.loads(path.read_text(encoding="utf-8")))

    def test_live_baseline_does_not_match_dry_run_ok(self) -> None:
        baseline = _ok_payload(job_id="baseline-live")
        result = compare_policy(baseline, _ok_payload(execution_mode="dry_run"))
        self.assertTrue(result["policyMatched"])
        self.assertFalse(result["liveEvidenceEligible"])
        self.assertFalse(result["matched"])

    def test_deletion_refused_until_three_matches(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            live = _ok_payload()
            dry = _ok_payload(execution_mode="dry_run", job_id="job-dry-1")
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ):
                ledger = record_parity_attempt(ledger_path, matched=True)
                self.assertEqual(ledger["consecutiveMatches"], 0)
                ledger = record_parity_attempt(ledger_path, matched=True, candidate=dry)
                self.assertEqual(ledger["consecutiveMatches"], 0)
                self.assertFalse(deletion_allowed(ledger))
                ledger = record_parity_attempt(ledger_path, matched=False, candidate=live)
                self.assertEqual(ledger["consecutiveMatches"], 0)
                ledger = record_parity_attempt(ledger_path, matched=True, candidate=live)
                ledger = record_parity_attempt(
                    ledger_path,
                    matched=True,
                    candidate=_ok_payload(job_id="job-live-2"),
                )
                ledger = record_parity_attempt(
                    ledger_path,
                    matched=True,
                    candidate=_ok_payload(job_id="job-live-3"),
                )
                self.assertEqual(ledger["consecutiveMatches"], REQUIRED_MATCH_COUNT)
                self.assertTrue(deletion_allowed(ledger))
                refuse_shim_deletion(ledger)
            with self.assertRaises(PermissionError):
                refuse_shim_deletion({"consecutiveMatches": 2})

    def test_same_live_job_cannot_count_twice(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            live = _ok_payload(job_id="job-live-once")
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ):
                first = record_parity_attempt(ledger_path, matched=True, candidate=live)
                self.assertEqual(first["consecutiveMatches"], 1)
                replay = record_parity_attempt(ledger_path, matched=True, candidate=live)
                self.assertEqual(replay["consecutiveMatches"], 0)
                self.assertTrue(replay["attempts"][-1]["duplicateJob"])

    def test_n3_resets_when_frozen_input_or_git_cohort_changes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            first = _ok_payload(job_id="job-cohort-1")
            second = _ok_payload(job_id="job-cohort-2")
            second["inputSha256"] = "e" * 64
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ):
                record_parity_attempt(ledger_path, matched=True, candidate=first)
                ledger = record_parity_attempt(ledger_path, matched=True, candidate=second)
            self.assertEqual(ledger["consecutiveMatches"], 0)
            self.assertFalse(ledger["attempts"][-1]["cohortMatched"])

    def test_complete_manifest_shape_stays_blocked_until_authoritative_producer_lands(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            for index in range(3):
                ledger = record_parity_attempt(
                    ledger_path,
                    matched=True,
                    candidate=_ok_payload(job_id=f"blocked-live-{index}"),
                )
            self.assertEqual(ledger["consecutiveMatches"], 0)
            self.assertFalse(deletion_allowed(ledger))

    def test_incomplete_hex_only_evidence_never_counts(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            for index in range(3):
                candidate = {
                    "jobId": f"fake-{index}",
                    "executionMode": "live",
                    "dataSink": "local_db",
                    "finalStatus": "OK",
                    "finalExitCode": 0,
                    "noWorkShortCircuit": False,
                    "gitSha": chr(ord("a") + index) * 40,
                    "inputSha256": chr(ord("d") + index) * 64,
                    "outputSha256": chr(ord("g") + index) * 64,
                }
                ledger = record_parity_attempt(
                    ledger_path,
                    matched=True,
                    candidate=candidate,
                )
            self.assertEqual(ledger["consecutiveMatches"], 0)
            self.assertFalse(deletion_allowed(ledger))

    def test_deletion_read_path_revalidates_attempt_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            with patch(
                "backend.pipeline_control.manifest.AUTHORITATIVE_LIVE_EVIDENCE_ENABLED",
                True,
            ):
                for index in range(3):
                    ledger = record_parity_attempt(
                        ledger_path,
                        matched=True,
                        candidate=_ok_payload(job_id=f"tamper-live-{index}"),
                    )
                self.assertTrue(deletion_allowed(ledger))
                ledger["attempts"][-1]["evidence"]["readbackSha256"] = "f" * 64
                self.assertFalse(deletion_allowed(ledger))


if __name__ == "__main__":
    unittest.main()
