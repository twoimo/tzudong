"""Unit tests for the Log_Pipeline retention gate (Task 24).

Covers Requirements 13.12 and 13.16:

- R13.12: retention periods / legal bases are read only from active
  operator-approved classes; code never invents a period or a default.
- R13.16: with no active operator-approved class, no retention/expiry/deletion
  is performed, the fixed code ``retention_class_unavailable`` is returned, and
  no default period is applied.

The tests exercise the real committed
``backend/deploy/log-retention.proposed.json`` ledger (which ships every class
as ``unresolved`` with a null approver) and synthetic in-memory ledgers written
to a temp path, so no ledger content is invented in code.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from backend.pipeline_control import log_retention
from backend.pipeline_control.log_retention import (
    CODE_RETENTION_CLASS_UNAVAILABLE,
    LogRetentionError,
    active_retention_classes,
    load_retention_proposal,
    require_active_retention,
    retention_gate,
)

_COMMITTED_LEDGER = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "deploy",
        "log-retention.proposed.json",
    )
)


class CommittedLedgerTests(unittest.TestCase):
    def test_committed_ledger_parses_and_is_proposed_only(self) -> None:
        doc = load_retention_proposal(_COMMITTED_LEDGER)
        self.assertIsNotNone(doc)
        classes = {c["classId"]: c for c in doc["proposedClasses"]}
        self.assertIn("operational_logs", classes)
        self.assertIn("audit_events", classes)
        # Operational logs propose 30 days; audit events defer to privacy classes.
        self.assertEqual(classes["operational_logs"]["proposedRetentionDays"], 30)
        self.assertIsNone(classes["audit_events"]["proposedRetentionDays"])
        # Every class is unresolved with a null approver: no activation claimed.
        for cls in doc["proposedClasses"]:
            self.assertEqual(cls["activation"]["status"], "unresolved")
            self.assertIsNone(cls["activation"]["approverName"])

    def test_committed_ledger_has_no_active_class(self) -> None:
        doc = load_retention_proposal(_COMMITTED_LEDGER)
        self.assertEqual(active_retention_classes(doc), [])

    def test_gate_on_committed_ledger_fails_closed(self) -> None:
        result = retention_gate(_COMMITTED_LEDGER)
        self.assertFalse(result["admitted"])
        self.assertEqual(result["code"], CODE_RETENTION_CLASS_UNAVAILABLE)
        self.assertEqual(result["activeClassIds"], [])

    def test_require_active_raises_fixed_code_on_committed_ledger(self) -> None:
        with self.assertRaises(LogRetentionError) as ctx:
            require_active_retention(_COMMITTED_LEDGER)
        self.assertEqual(ctx.exception.code, CODE_RETENTION_CLASS_UNAVAILABLE)


class MissingAndMalformedLedgerTests(unittest.TestCase):
    def test_missing_ledger_fails_closed(self) -> None:
        result = retention_gate("/nonexistent/path/log-retention.proposed.json")
        self.assertFalse(result["admitted"])
        self.assertEqual(result["code"], CODE_RETENTION_CLASS_UNAVAILABLE)

    def test_malformed_ledger_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("{ not json")
            self.assertIsNone(load_retention_proposal(path))
            self.assertFalse(retention_gate(path)["admitted"])

    def test_non_object_document_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "list.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump([1, 2, 3], handle)
            self.assertIsNone(load_retention_proposal(path))


class ActivationGateTests(unittest.TestCase):
    def _write(self, tmp: str, doc: object) -> str:
        path = os.path.join(tmp, "ledger.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle)
        return path

    def test_approved_status_without_approver_is_not_active(self) -> None:
        # An "approved" status but null approverName is not a valid activation.
        doc = {
            "schemaVersion": 1,
            "proposedClasses": [
                {
                    "classId": "operational_logs",
                    "proposedRetentionDays": 30,
                    "activation": {
                        "status": "approved",
                        "approverName": None,
                        "approvedAt": None,
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, doc)
            self.assertEqual(active_retention_classes(load_retention_proposal(path)), [])
            self.assertFalse(retention_gate(path)["admitted"])

    def test_active_approved_class_opens_the_gate(self) -> None:
        doc = {
            "schemaVersion": 1,
            "proposedClasses": [
                {
                    "classId": "operational_logs",
                    "proposedRetentionDays": 30,
                    "legalBasis": "operator-approved-test-basis",
                    "trigger": "event_occurred",
                    "activation": {
                        "status": "approved",
                        "approverName": "operator-name",
                        "approvedAt": "2026-01-01T00:00:00.000Z",
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, doc)
            result = retention_gate(path)
            self.assertTrue(result["admitted"])
            self.assertIsNone(result["code"])
            self.assertEqual(result["activeClassIds"], ["operational_logs"])
            # require_active_retention returns the class rather than raising.
            active = require_active_retention(path)
            self.assertEqual(len(active), 1)

    def test_incomplete_or_malformed_approved_tuple_stays_closed(self) -> None:
        valid = {
            "classId": "operational_logs", "proposedRetentionDays": 30,
            "legalBasis": "operator-approved-test-basis", "trigger": "event_occurred",
            "activation": {"status": "approved", "approverName": "test-operator",
                           "approvedAt": "2026-01-01T00:00:00Z"},
        }
        cases = []
        for field in ("classId", "legalBasis", "trigger"):
            cases.extend({**valid, field: value} for value in (None, "", " ", 42))
        cases.extend({**valid, "proposedRetentionDays": value}
                     for value in (None, True, 0, -1, 1.5, "30"))
        cases.extend({**valid, "activation": {**valid["activation"], "approvedAt": value}}
                     for value in (None, "yesterday", "2026-02-30T00:00:00Z",
                                   "2026-01-01", "2026-01-01T00:00:00",
                                   "9999-01-01T00:00:00Z"))
        for candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertEqual(active_retention_classes({"proposedClasses": [candidate]}), [])

    def test_unresolved_status_stays_closed(self) -> None:
        doc = {
            "schemaVersion": 1,
            "proposedClasses": [
                {
                    "classId": "operational_logs",
                    "proposedRetentionDays": 30,
                    "activation": {
                        "status": "unresolved",
                        "approverName": "operator-name",
                        "approvedAt": None,
                    },
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, doc)
            self.assertFalse(retention_gate(path)["admitted"])


if __name__ == "__main__":
    unittest.main()
