from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_matched_candidate_promotion_precheck.py"
spec = importlib.util.spec_from_file_location("build_matched_candidate_promotion_precheck", SCRIPT)
precheck = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(precheck)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildMatchedCandidatePromotionPrecheckTest(unittest.TestCase):
    def test_build_precheck_rows_splits_sync_and_hold_candidates(self):
        decision_rows = [
            {
                "trace_id": "sync-trace",
                "decision_id": "MCD-1",
                "origin_name": "막내낙지",
                "decision_queue": "approval_ready_spot_check",
                "risk_level": "low",
                "matched_distance_m": 39.4,
            },
            {
                "trace_id": "hold-trace",
                "decision_id": "MCD-2",
                "origin_name": "김영섭초밥",
                "decision_queue": "stage_recovery_spot_check",
                "risk_level": "medium",
                "risk_flags": ["stage1_then_stage2_recovered"],
            },
            {
                "trace_id": "skip-trace",
                "decision_queue": "manual_distance_review",
            },
        ]

        rows = precheck.build_precheck_rows(decision_rows)
        sync_rows, hold_rows = precheck.split_precheck_rows(rows)

        self.assertEqual(2, len(rows))
        self.assertEqual(1, len(sync_rows))
        self.assertEqual("sync_candidate_pending_operator_spot_check", sync_rows[0]["precheck_status"])
        self.assertEqual(1, len(hold_rows))
        self.assertEqual("hold_pending_stage_recovery_spot_check", hold_rows[0]["precheck_status"])
        self.assertIn("confirm_stage1_recovered_geocode", hold_rows[0]["required_precheck"])

    def test_write_precheck_package_creates_sync_and_hold_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            decision_dir = root / "decisions"
            output_dir = root / "out"
            write_jsonl(
                decision_dir / "matched-candidate-decisions.jsonl",
                [
                    {
                        "trace_id": "sync-trace",
                        "decision_id": "MCD-1",
                        "origin_name": "막내낙지",
                        "decision_queue": "approval_ready_spot_check",
                        "risk_level": "low",
                    },
                    {
                        "trace_id": "hold-trace",
                        "decision_id": "MCD-2",
                        "origin_name": "김영섭초밥",
                        "decision_queue": "stage_recovery_spot_check",
                        "risk_level": "medium",
                    },
                ],
            )

            summary = precheck.write_precheck_package(decision_dir, output_dir)

            self.assertEqual(2, summary["total_precheck_candidates"])
            self.assertEqual(1, summary["sync_candidates_pending_spot_check"])
            self.assertEqual(1, summary["hold_candidates_pending_spot_check"])
            self.assertTrue((output_dir / "matched-candidate-promotion-precheck.jsonl").exists())
            self.assertTrue((output_dir / "sync-candidates-pending-spot-check.jsonl").exists())
            self.assertTrue((output_dir / "hold-candidates-pending-spot-check.jsonl").exists())
            self.assertTrue((output_dir / "matched-candidate-promotion-precheck.csv").exists())
            self.assertTrue((output_dir / "matched-candidate-promotion-precheck.md").exists())
            self.assertIn("막내낙지", (output_dir / "matched-candidate-promotion-precheck.md").read_text(encoding="utf-8"))

    def test_latest_decision_package_prefers_latest_named_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            older = root / "matched-candidate-decisions-20260101T000000Z"
            newer = root / "matched-candidate-decisions-20260102T000000Z"
            write_jsonl(older / "matched-candidate-decisions.jsonl", [{"trace_id": "old"}])
            write_jsonl(newer / "matched-candidate-decisions.jsonl", [{"trace_id": "new"}])

            self.assertEqual(newer, precheck.latest_decision_package(root))


if __name__ == "__main__":
    unittest.main()
