"""N=3 parity gate must refuse .sh deletion without matching live runs."""

from __future__ import annotations

import json
import tempfile
import unittest
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

BASELINE = Path(
    "/Users/twoimo/Documents/projects/tzudong/backend/log/cron/current-summary.json"
)


def _ok_payload() -> dict:
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
    }


class ManifestParityTests(unittest.TestCase):
    def test_writer_validates_contract(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "current-summary.json"
            write_compatible_summary(path, _ok_payload())
            validate_summary_manifest_payload(json.loads(path.read_text(encoding="utf-8")))

    def test_live_baseline_does_not_match_dry_run_ok(self) -> None:
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
        result = compare_policy(baseline, _ok_payload())
        self.assertFalse(result["matched"])

    def test_deletion_refused_until_three_matches(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "parity.json"
            ledger = record_parity_attempt(ledger_path, matched=True)
            self.assertEqual(ledger["consecutiveMatches"], 1)
            self.assertFalse(deletion_allowed(ledger))
            ledger = record_parity_attempt(ledger_path, matched=False)
            self.assertEqual(ledger["consecutiveMatches"], 0)
            ledger = record_parity_attempt(ledger_path, matched=True)
            ledger = record_parity_attempt(ledger_path, matched=True)
            ledger = record_parity_attempt(ledger_path, matched=True)
            self.assertEqual(ledger["consecutiveMatches"], REQUIRED_MATCH_COUNT)
            self.assertTrue(deletion_allowed(ledger))
            refuse_shim_deletion(ledger)
            with self.assertRaises(PermissionError):
                refuse_shim_deletion({"consecutiveMatches": 2})


if __name__ == "__main__":
    unittest.main()
