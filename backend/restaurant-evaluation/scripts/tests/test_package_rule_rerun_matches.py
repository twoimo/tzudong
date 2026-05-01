from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "package_rule_rerun_matches.py"
spec = importlib.util.spec_from_file_location("package_rule_rerun_matches", SCRIPT)
package = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(package)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class PackageRuleRerunMatchesTest(unittest.TestCase):
    def test_package_report_writes_review_and_followup_queues(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = root / "report"
            output = root / "out"
            transforms = root / "transforms.jsonl"
            write_jsonl(
                transforms,
                [
                    {
                        "trace_id": "matched",
                        "status": "pending",
                        "geocoding_success": False,
                        "geocoding_false_stage": 2,
                    }
                ],
            )
            write_jsonl(
                report / "matched-rule-rerun-candidates.jsonl",
                [
                    {
                        "trace_id": "matched",
                        "video_id": "v1",
                        "youtube_link": "https://www.youtube.com/watch?v=v1",
                        "origin_name": "가게",
                        "origin_address_text": "서울",
                        "recommended_action": "rerun_stage1_source_geocode_then_stage2",
                    }
                ],
            )
            write_jsonl(
                report / "still-unresolved-after-rule-rerun.jsonl",
                [
                    {
                        "trace_id": "unresolved",
                        "pending_reason": "multi_candidate",
                        "recommended_action": "rerun_stage1_source_geocode_then_stage2",
                    }
                ],
            )
            write_jsonl(
                report / "evaluation" / "rule_results" / "v1.jsonl",
                [
                    {
                        "evaluation_results": {
                            "location_match_TF": [
                                {
                                    "origin_name": "가게",
                                    "eval_value": True,
                                    "match_status": "matched",
                                    "matched_provider": "naver",
                                    "matched_name": "가게",
                                    "naver_name": "가게",
                                    "matched_address": {"distance": 250.0},
                                    "evidence_summary": ["ok"],
                                    "evidence_families": ["provider_candidate"],
                                }
                            ]
                        }
                    }
                ],
            )

            summary = package.package_report(report, transforms, output)

            self.assertEqual(1, summary["review_candidates"])
            self.assertEqual(1, summary["unresolved_input_rows"])
            self.assertEqual(1, summary["risk_flag_counter"]["large_distance_over_200m"])
            review_rows = [json.loads(line) for line in (output / "matched-review-candidates.jsonl").read_text().splitlines()]
            self.assertEqual("admin_review_before_sync", review_rows[0]["review_recommendation"])
            self.assertTrue((output / "unresolved_followup_queues" / "multi_candidate.jsonl").exists())

    def test_latest_rule_rerun_prefers_expanded_reports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / "rule-rerun-20260101T000000Z"
            expanded = root / "rule-rerun-expanded-20260101T000000Z"
            old.mkdir()
            expanded.mkdir()

            self.assertEqual(expanded, package.latest_rule_rerun_report(root))


if __name__ == "__main__":
    unittest.main()
