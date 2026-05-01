from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "materialize_rule_rerun_inputs.py"
spec = importlib.util.spec_from_file_location("materialize_rule_rerun_inputs", SCRIPT)
materialize = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(materialize)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class MaterializeRuleRerunInputsTest(unittest.TestCase):
    def test_materialize_groups_duplicate_video_and_filters_restaurants(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            selection_dir = root / "selection"
            write_jsonl(
                selection_dir / "video1.jsonl",
                [
                    {
                        "youtube_link": "https://www.youtube.com/watch?v=video1",
                        "channel_name": "tzuyang",
                        "evaluation_target": {"A": True, "B": True},
                        "restaurants": [
                            {"origin_name": "A", "address": "서울 A", "category": ["한식"]},
                            {"origin_name": "B", "address": "서울 B", "category": ["중식"]},
                            {"origin_name": "C", "address": "서울 C", "category": ["카페·디저트"]},
                        ],
                        "recollect_version": {"source": "test"},
                    }
                ],
            )
            rows = [
                {
                    "trace_id": "trace-a",
                    "youtube_link": "https://www.youtube.com/watch?v=video1",
                    "origin_name": "A",
                    "origin_address_text": "서울 A",
                    "recommended_action": "rerun_rule_evaluation_with_recovered_source_geocode",
                },
                {
                    "trace_id": "trace-b",
                    "youtube_link": "https://www.youtube.com/watch?v=video1",
                    "origin_name": "B",
                    "origin_address_text": "서울 B",
                    "recommended_action": "rerun_rule_evaluation_with_candidate_review",
                },
            ]

            result = materialize.materialize_inputs(rows, selection_dir, root / "out")

            self.assertEqual(2, result["summary"]["materialized_trace_ids"])
            self.assertEqual(1, result["summary"]["materialized_videos"])
            output = json.loads((root / "out" / "evaluation" / "selection" / "video1.jsonl").read_text().splitlines()[0])
            self.assertEqual(["A", "B"], [row["origin_name"] for row in output["restaurants"]])
            self.assertEqual({"A": True, "B": True}, output["evaluation_target"])
            self.assertEqual(["trace-a", "trace-b"], output["recollect_version"]["rule_rerun_trace_ids"])

    def test_materialize_prefers_one_exact_name_match_over_shared_address(self):
        source_record = {
            "youtube_link": "https://www.youtube.com/watch?v=video1",
            "channel_name": "tzuyang",
            "restaurants": [
                {"origin_name": "A", "address": "서울 같은주소", "category": ["한식"]},
                {"origin_name": "B", "address": "서울 같은주소", "category": ["중식"]},
            ],
        }
        rows = [{"trace_id": "trace-a", "origin_name": "A", "origin_address_text": "서울 같은주소"}]

        materialized = materialize.materialize_selection_record(source_record, rows)

        self.assertEqual(["A"], [row["origin_name"] for row in materialized["restaurants"]])

    def test_default_queue_paths_include_stage1_then_stage2_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queue_dir = root / "next_action_queues"
            queue_dir.mkdir()
            queue_paths = [
                queue_dir / "10-rerun-rule-evaluation-with-recovered-source-geocode.jsonl",
                queue_dir / "30-rerun-stage1-source-geocode-then-stage2.jsonl",
                queue_dir / "40-recrawl-or-manual-source-address-enrichment.jsonl",
            ]
            for path in queue_paths:
                path.write_text("", encoding="utf-8")
            (queue_dir / "manifest.json").write_text(
                json.dumps(
                    [
                        {
                            "action": "rerun_rule_evaluation_with_recovered_source_geocode",
                            "count": 1,
                            "path": str(queue_paths[0]),
                        },
                        {
                            "action": "rerun_stage1_source_geocode_then_stage2",
                            "count": 1,
                            "path": str(queue_paths[1]),
                        },
                        {
                            "action": "recrawl_or_manual_source_address_enrichment",
                            "count": 1,
                            "path": str(queue_paths[2]),
                        },
                    ]
                ),
                encoding="utf-8",
            )

            selected = materialize.default_queue_paths(root)

            self.assertEqual([queue_paths[0], queue_paths[1]], selected)

    def test_summarize_rule_results_marks_matched_and_unresolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_rows = [
                {
                    "trace_id": "matched",
                    "video_id": "v1",
                    "origin_name": "A",
                    "recommended_action": "rerun_rule_evaluation_with_recovered_source_geocode",
                },
                {
                    "trace_id": "unresolved",
                    "video_id": "v1",
                    "origin_name": "B",
                    "recommended_action": "rerun_rule_evaluation_with_candidate_review",
                },
            ]
            write_jsonl(
                root / "evaluation" / "rule_results" / "v1.jsonl",
                [
                    {
                        "evaluation_results": {
                            "location_match_TF": [
                                {"origin_name": "A", "eval_value": True, "match_status": "matched"},
                                {
                                    "origin_name": "B",
                                    "eval_value": False,
                                    "match_status": "pending",
                                    "pending_reason": "insufficient_evidence",
                                },
                            ]
                        }
                    }
                ],
            )

            summary = materialize.summarize_rule_results(root, manifest_rows)

            self.assertEqual({"matched": 1, "still_unresolved": 1}, summary["by_rerun_status"])
            rows = [json.loads(line) for line in (root / "rule-rerun-results.jsonl").read_text().splitlines()]
            self.assertEqual(["matched", "still_unresolved"], [row["rerun_status"] for row in rows])
            matched = (root / "matched-rule-rerun-candidates.jsonl").read_text(encoding="utf-8").splitlines()
            unresolved = (root / "still-unresolved-after-rule-rerun.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(1, len(matched))
            self.assertEqual(1, len(unresolved))


if __name__ == "__main__":
    unittest.main()
