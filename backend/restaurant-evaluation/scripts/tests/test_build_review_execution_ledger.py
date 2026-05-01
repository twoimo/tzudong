from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_review_execution_ledger.py"
spec = importlib.util.spec_from_file_location("build_review_execution_ledger", SCRIPT)
ledger = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(ledger)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildReviewExecutionLedgerTest(unittest.TestCase):
    def test_aggregate_multi_candidate_rows_builds_one_job_per_trace(self):
        rows = [
            {
                "trace_id": "trace1",
                "video_id": "v1",
                "origin_name": "가게",
                "origin_address_text": "서울",
                "candidate_rank": 1,
                "candidate_title": "가게 후보1",
                "candidate_distance_m": 12.0,
            },
            {
                "trace_id": "trace1",
                "video_id": "v1",
                "origin_name": "가게",
                "origin_address_text": "서울",
                "candidate_rank": 2,
                "candidate_title": "가게 후보2",
                "candidate_distance_m": 44.0,
            },
        ]

        output = ledger.aggregate_multi_candidate_rows(rows)

        self.assertEqual(1, len(output))
        self.assertEqual(2, output[0]["candidate_count"])
        self.assertEqual(["가게 후보1", "가게 후보2"], output[0]["candidate_titles"])

    def test_build_ledger_rows_combines_job_types_with_stable_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_jsonl(
                root / "matched-review-candidates.jsonl",
                [
                    {
                        "trace_id": "matched-trace",
                        "video_id": "v1",
                        "origin_name": "승인후보",
                        "origin_address_text": "서울",
                        "review_recommendation": "admin_review_before_sync",
                        "risk_flags": ["large_distance_over_200m"],
                    }
                ],
            )
            write_jsonl(
                root / "multi-candidate-comparison.jsonl",
                [
                    {
                        "trace_id": "multi-trace",
                        "video_id": "v2",
                        "origin_name": "다중후보",
                        "candidate_rank": 1,
                        "candidate_title": "후보",
                    }
                ],
            )
            write_jsonl(
                root / "generic-evidence-gap-jobs.jsonl",
                [
                    {
                        "trace_id": "generic-trace",
                        "video_id": "v3",
                        "origin_name": "증거부족",
                        "problem_tags": ["generic_evidence_gap"],
                        "next_action_options": ["recrawl"],
                    }
                ],
            )

            rows = ledger.build_ledger_rows(root)

            self.assertEqual(3, len(rows))
            self.assertEqual([0, 1, 2], [row["priority"] for row in rows])
            self.assertEqual("RVW-P0-0001-matched-trac", rows[0]["review_id"])
            self.assertEqual("pending", rows[0]["decision_status"])
            self.assertIn("large_distance_over_200m", rows[0]["problem_tags"])
            self.assertEqual("multi_candidate_review", rows[1]["job_kind"])
            self.assertEqual(1, rows[1]["candidate_count"])
            self.assertEqual(["recrawl"], rows[2]["decision_options"])

    def test_write_ledger_creates_jsonl_csv_markdown_and_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = root / "report"
            output = root / "out"
            write_jsonl(
                report / "provider-search-review-jobs.jsonl",
                [
                    {
                        "trace_id": "provider-trace",
                        "video_id": "v1",
                        "origin_name": "검색실패",
                        "problem_tags": ["provider_search_no_result"],
                    }
                ],
            )

            summary = ledger.write_ledger(report, output)

            self.assertEqual(1, summary["total_jobs"])
            self.assertEqual(1, summary["job_kind_counter"]["provider_search_review"])
            self.assertTrue((output / "review-execution-ledger.jsonl").exists())
            self.assertTrue((output / "review-execution-ledger.csv").exists())
            self.assertTrue((output / "review-execution-ledger.md").exists())
            self.assertTrue((output / "review-execution-ledger-summary.json").exists())
            self.assertIn("검색실패", (output / "review-execution-ledger.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
