from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_matched_candidate_decision_package.py"
spec = importlib.util.spec_from_file_location("build_matched_candidate_decision_package", SCRIPT)
decisions = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(decisions)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildMatchedCandidateDecisionPackageTest(unittest.TestCase):
    def test_build_decision_rows_classifies_distance_risk(self):
        rows = [
            {
                "trace_id": "critical-trace",
                "origin_name": "위험후보",
                "matched_distance_m": 1200.0,
                "risk_flags": ["very_large_distance_over_1000m", "stage1_then_stage2_recovered"],
            },
            {
                "trace_id": "safe-trace",
                "origin_name": "안전후보",
                "matched_distance_m": 10.0,
                "risk_flags": [],
            },
        ]

        output = decisions.build_decision_rows(rows, ledger_review_ids={"critical-trace": "RVW-P0-0001-critical"})

        self.assertEqual("critical", output[0]["risk_level"])
        self.assertEqual("critical_distance_evidence_review", output[0]["decision_queue"])
        self.assertEqual("needs_more_evidence_before_approval", output[0]["suggested_decision"])
        self.assertIn("reject_if_no_video_address_evidence", output[0]["required_checks"])
        self.assertEqual("RVW-P0-0001-critical", output[0]["review_id"])
        self.assertEqual("low", output[1]["risk_level"])
        self.assertEqual("approval_ready_spot_check", output[1]["decision_queue"])

    def test_write_decision_package_creates_queue_exports_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            review_package = root / "review"
            ledger_dir = root / "ledger"
            output_dir = root / "out"
            write_jsonl(
                review_package / "matched-review-candidates.jsonl",
                [
                    {
                        "trace_id": "trace1",
                        "video_id": "v1",
                        "origin_name": "검수후보",
                        "matched_distance_m": 250.0,
                        "risk_flags": ["large_distance_over_200m"],
                    }
                ],
            )
            write_jsonl(
                ledger_dir / "review-execution-ledger.jsonl",
                [
                    {
                        "trace_id": "trace1",
                        "job_kind": "matched_review_candidate",
                        "review_id": "RVW-P0-0001-trace1",
                    }
                ],
            )

            summary = decisions.write_decision_package(review_package, output_dir, ledger_dir)

            self.assertEqual(1, summary["total_candidates"])
            self.assertEqual(1, summary["decision_queue_counter"]["manual_distance_review"])
            self.assertTrue((output_dir / "matched-candidate-decisions.jsonl").exists())
            self.assertTrue((output_dir / "matched-candidate-decisions.csv").exists())
            self.assertTrue((output_dir / "matched-candidate-decisions.md").exists())
            self.assertTrue((output_dir / "decision_queues" / "manual_distance_review.jsonl").exists())
            self.assertTrue((output_dir / "decision_queues" / "manifest.json").exists())
            self.assertIn("검수후보", (output_dir / "matched-candidate-decisions.md").read_text(encoding="utf-8"))

    def test_load_ledger_review_ids_ignores_other_job_kinds(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger_dir = Path(tmp)
            write_jsonl(
                ledger_dir / "review-execution-ledger.jsonl",
                [
                    {"trace_id": "a", "job_kind": "matched_review_candidate", "review_id": "matched"},
                    {"trace_id": "b", "job_kind": "provider_search_review", "review_id": "provider"},
                ],
            )

            self.assertEqual({"a": "matched"}, decisions.load_ledger_review_ids(ledger_dir))


if __name__ == "__main__":
    unittest.main()
