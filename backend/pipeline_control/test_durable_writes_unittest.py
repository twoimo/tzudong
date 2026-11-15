"""Durability of the parity ledger and the worker's health-report step.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.pipeline_control.manifest import (
    PARITY_LEDGER_SCHEMA_VERSION,
    deletion_allowed,
    record_parity_attempt,
)


class ParityLedgerDurabilityTests(unittest.TestCase):
    def _record_on(self, contents: str) -> dict:
        with tempfile.TemporaryDirectory() as raw:
            ledger_path = Path(raw) / "pipeline-parity-ledger.json"
            ledger_path.write_text(contents, encoding="utf-8")
            ledger = record_parity_attempt(ledger_path, matched=True)
            self.assertEqual(
                ledger,
                json.loads(ledger_path.read_text(encoding="utf-8")),
                "returned ledger is the one persisted",
            )
            self.assertEqual([], list(Path(raw).glob("*.tmp")), "no temp file left behind")
            return ledger

    def test_truncated_ledger_is_rejected_and_reset(self) -> None:
        ledger = self._record_on('{"schemaVersion": 2, "consecutiveMatches": 2, "attem')
        self.assertTrue(ledger["legacyLedgerRejected"])
        self.assertEqual(PARITY_LEDGER_SCHEMA_VERSION, ledger["schemaVersion"])
        self.assertEqual(0, ledger["consecutiveMatches"])
        self.assertEqual(1, len(ledger["attempts"]))
        self.assertFalse(deletion_allowed(ledger))

    def test_non_object_ledger_is_rejected_and_reset(self) -> None:
        ledger = self._record_on("[]\n")
        self.assertTrue(ledger["legacyLedgerRejected"])
        self.assertEqual(0, ledger["consecutiveMatches"])


class HealthReportFailureTests(unittest.TestCase):
    def test_failed_health_report_emits_marker_and_keeps_exit_code(self) -> None:
        # Imported here so the ledger tests above still load on Python 3.9,
        # where worker's PEP 604 annotations fail at import time.
        from backend.pipeline_control import worker

        secret = "provider said: token=abc123"
        stdout = io.StringIO()
        with contextlib.ExitStack() as stack:
            for name in ("cadence_preflight", "cadence_source_preflight", "env_contract_preflight", "preflight_data_sink"):
                stack.enter_context(mock.patch.object(worker, name))
            stack.enter_context(mock.patch.object(worker, "resolve_compute_profile", return_value="lite_gha"))
            stack.enter_context(mock.patch("backend.pipeline_control.live_run.main", return_value=7))
            stack.enter_context(
                mock.patch(
                    "backend.pipeline_control.health.write_health_report",
                    side_effect=OSError(secret),
                )
            )
            stack.enter_context(contextlib.redirect_stdout(stdout))
            exit_code = worker.main()
        self.assertEqual(7, exit_code)
        self.assertEqual(
            ["operation=health_report_failed error_type=OSError"],
            stdout.getvalue().splitlines(),
        )
        self.assertNotIn("abc123", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
