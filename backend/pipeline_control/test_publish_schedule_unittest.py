"""Unit tests for the committed publish-schedule ledger artifact.

Covers task 12 (Requirement 10.14): assert the committed
``backend/deploy/publish-schedule.approved.json`` parses, carries the exact
design C6 cadence values (KST 07:30-08:30 window, UTC cron ``30 22 * * *``,
``minBufferMinutesAfterHeavyLocal`` = 30), leaves the operator approval
unresolved (``approval.approverName`` null, ``approval.status`` "unresolved"),
and contains no forbidden log fields / secret material.

The schedule values are authored here by a human; code only reads them and
must not generate or substitute defaults. This test guards those exact values.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import re
import unittest

_SCHEDULE_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "deploy",
        "publish-schedule.approved.json",
    )
)

# Substrings that must never appear in an approval ledger artifact.
_FORBIDDEN_SUBSTRINGS = (
    "password",
    "secret",
    "token",
    "cookie",
    "authorization",
    "resident_registration",
    "@",
)


class PublishScheduleLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        with open(_SCHEDULE_PATH, "r", encoding="utf-8") as handle:
            self.raw = handle.read()
        self.doc = json.loads(self.raw)

    def test_ledger_parses_as_json_object(self) -> None:
        self.assertIsInstance(self.doc, dict)
        self.assertEqual(self.doc.get("schemaVersion"), 1)

    def test_exact_design_c6_cadence_values(self) -> None:
        # Requirement 10.14 / design C6: exact committed cadence values.
        self.assertEqual(self.doc["timezone"], "Asia/Seoul")
        self.assertEqual(self.doc["utcOffsetMinutes"], 540)
        self.assertEqual(self.doc["cadence"], "daily")
        self.assertEqual(self.doc["kstWindowStart"], "07:30")
        self.assertEqual(self.doc["kstWindowEnd"], "08:30")
        self.assertEqual(self.doc["utcCron"], "30 22 * * *")
        self.assertEqual(self.doc["minBufferMinutesAfterHeavyLocal"], 30)

    def test_utc_cron_matches_kst_window_start(self) -> None:
        # KST 07:30 minus the 540-minute (+09:00) offset is 22:30 UTC.
        minute, hour = self.doc["utcCron"].split()[:2]
        self.assertEqual((int(hour), int(minute)), (22, 30))

    def test_operator_approval_unresolved(self) -> None:
        # Task 12: approval stays unresolved; a named human fills it.
        approval = self.doc["approval"]
        self.assertIsNone(approval["approverName"])
        self.assertIsNone(approval["approvedAt"])
        self.assertEqual(approval["status"], "unresolved")

    def test_no_secret_or_forbidden_log_fields(self) -> None:
        lowered = self.raw.lower()
        for token in _FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(
                token, lowered, f"forbidden substring present in ledger: {token}"
            )
        # No email-like literals.
        self.assertIsNone(re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", self.raw))


if __name__ == "__main__":
    unittest.main()
