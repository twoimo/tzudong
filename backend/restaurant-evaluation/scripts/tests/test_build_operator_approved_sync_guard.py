from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_operator_approved_sync_guard.py"
spec = importlib.util.spec_from_file_location("build_operator_approved_sync_guard", SCRIPT)
guard = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(guard)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildOperatorApprovedSyncGuardTest(unittest.TestCase):
    def approved_row(self) -> dict:
        return {
            "precheck_id": "MCP-1",
            "decision_id": "MCD-1",
            "review_id": "RVW-1",
            "trace_id": "trace-approved",
            "origin_name": "막내낙지",
            "precheck_status": "sync_candidate_pending_operator_spot_check",
            "operator_sync_decision": "approve_for_sync",
            "proposed_sync_fields": {"status": "approved"},
        }

    def test_build_guard_rows_allows_only_operator_approved_sync_candidates(self):
        pending = {
            **self.approved_row(),
            "trace_id": "trace-pending",
            "operator_sync_decision": "pending",
        }
        hold = {
            **self.approved_row(),
            "trace_id": "trace-hold",
            "precheck_status": "hold_pending_stage_recovery_spot_check",
        }

        approved, blocked = guard.build_guard_rows([self.approved_row(), pending, hold])

        self.assertEqual(1, len(approved))
        self.assertEqual("approved_for_future_sync_input", approved[0]["guard_status"])
        self.assertEqual("report_only_no_mutation", approved[0]["write_mode"])
        self.assertEqual(2, len(blocked))
        self.assertIn("operator_decision_not_approve_for_sync", blocked[0]["blocked_reasons"])
        self.assertIn("not_sync_precheck_candidate", blocked[1]["blocked_reasons"])

    def test_missing_proposed_sync_fields_blocks_even_when_approved(self):
        row = {**self.approved_row(), "proposed_sync_fields": {}}

        approved, blocked = guard.build_guard_rows([row])

        self.assertEqual([], approved)
        self.assertEqual(1, len(blocked))
        self.assertIn("missing_proposed_sync_fields", blocked[0]["blocked_reasons"])

    def test_write_guard_package_creates_report_only_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            precheck_dir = root / "precheck"
            output_dir = root / "out"
            write_jsonl(
                precheck_dir / "matched-candidate-promotion-precheck.jsonl",
                [
                    self.approved_row(),
                    {
                        **self.approved_row(),
                        "trace_id": "trace-pending",
                        "operator_sync_decision": "pending",
                    },
                ],
            )

            summary = guard.write_guard_package(precheck_dir, output_dir)

            self.assertEqual(2, summary["total_precheck_rows"])
            self.assertEqual(1, summary["approved_for_future_sync_input"])
            self.assertEqual(1, summary["blocked_rows"])
            self.assertEqual("report_only_no_mutation", summary["safety_mode"])
            self.assertTrue((output_dir / "approved-sync-candidates-report-only.jsonl").exists())
            self.assertTrue((output_dir / "blocked-sync-candidates.jsonl").exists())
            self.assertTrue((output_dir / "operator-approved-sync-guard.csv").exists())
            self.assertIn("막내낙지", (output_dir / "operator-approved-sync-guard.md").read_text(encoding="utf-8"))

    def test_latest_precheck_package_prefers_latest_named_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            older = root / "matched-candidate-promotion-precheck-20260101T000000Z"
            newer = root / "matched-candidate-promotion-precheck-20260102T000000Z"
            write_jsonl(older / "matched-candidate-promotion-precheck.jsonl", [{"trace_id": "old"}])
            write_jsonl(newer / "matched-candidate-promotion-precheck.jsonl", [{"trace_id": "new"}])

            self.assertEqual(newer, guard.latest_precheck_package(root))


if __name__ == "__main__":
    unittest.main()
