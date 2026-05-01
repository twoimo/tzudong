from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_category_validity_rerun_diff_report.py"
spec = importlib.util.spec_from_file_location("build_category_validity_rerun_diff_report", SCRIPT)
diff = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(diff)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildCategoryValidityRerunDiffReportTest(unittest.TestCase):
    def row(self, category, current):
        return {
            "trace_id": "trace-1",
            "youtube_link": "https://www.youtube.com/watch?v=abc",
            "origin_name": "식당",
            "category": category,
            "geocoding_success": True,
            "evaluation_results": {
                "category_validity_TF": {"eval_value": current},
                "location_match_TF": {"eval_value": True},
            },
        }

    def test_build_diff_rows_marks_false_to_true_projection(self):
        rows = diff.build_diff_rows([self.row(["한식", "고기"], False)])

        self.assertEqual("false_to_true", rows[0]["diff_status"])
        self.assertEqual("safe_category_validity_projection", rows[0]["review_queue"])
        self.assertTrue(rows[0]["after_category_validity"])
        self.assertEqual(["한식", "고기"], rows[0]["projected_category_validity_TF"]["normalized_categories"])

    def test_build_diff_rows_keeps_unknown_taxonomy_false(self):
        rows = diff.build_diff_rows([self.row(["한식", "일식"], False)])

        self.assertEqual("still_false", rows[0]["diff_status"])
        self.assertEqual("taxonomy_review_required", rows[0]["review_queue"])
        self.assertEqual(["일식"], rows[0]["invalid_categories"])

    def test_write_diff_package_counts_before_after(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transforms = root / "transforms.jsonl"
            out = root / "out"
            write_jsonl(
                transforms,
                [
                    self.row(["한식", "고기"], False),
                    self.row(["일식"], False),
                    self.row("분식", True),
                    self.row(None, None),
                ],
            )

            summary = diff.write_diff_package(transforms, out)

            self.assertEqual(4, summary["total_rows"])
            self.assertEqual({"false": 2, "missing": 1, "true": 1}, summary["before_counter"])
            self.assertEqual({"false": 2, "true": 2}, summary["after_counter"])
            self.assertEqual(1, summary["diff_status_counter"]["false_to_true"])
            self.assertEqual(1, summary["diff_status_counter"]["still_false"])
            self.assertEqual(1, summary["diff_status_counter"]["missing_eval_to_false"])
            self.assertTrue((out / "category-validity-rerun-diff-changed.jsonl").exists())
            self.assertTrue((out / "safe_category_validity_projection.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
