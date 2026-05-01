from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_category_validity_recovery_report.py"
spec = importlib.util.spec_from_file_location("build_category_validity_recovery_report", SCRIPT)
report = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(report)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildCategoryValidityRecoveryReportTest(unittest.TestCase):
    def false_row(self, **overrides):
        row = {
            "trace_id": "trace-1",
            "youtube_link": "https://www.youtube.com/watch?v=abc",
            "origin_name": "복합식당",
            "category": ["한식", "고기"],
            "geocoding_success": True,
            "evaluation_results": {
                "category_validity_TF": {"eval_value": False},
                "location_match_TF": {"eval_value": True},
            },
        }
        row.update(overrides)
        return row

    def test_build_report_rows_classifies_auto_recoverable_list_categories(self):
        rows = report.build_report_rows([self.false_row()])

        self.assertEqual(1, len(rows))
        self.assertEqual("auto_recoverable_list_valid", rows[0]["review_queue"])
        self.assertTrue(rows[0]["projected_category_validity"])
        self.assertEqual(["한식", "고기"], rows[0]["normalized_categories"])

    def test_build_report_rows_classifies_taxonomy_review_required(self):
        rows = report.build_report_rows([self.false_row(category=["한식", "일식"])])

        self.assertEqual("taxonomy_review_required", rows[0]["review_queue"])
        self.assertEqual(["일식"], rows[0]["invalid_categories"])
        self.assertFalse(rows[0]["projected_category_validity"])

    def test_build_report_rows_classifies_missing_category(self):
        rows = report.build_report_rows([self.false_row(category=[])])

        self.assertEqual("missing_category", rows[0]["review_queue"])

    def test_write_recovery_package_creates_expected_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transforms = root / "transforms.jsonl"
            out = root / "out"
            write_jsonl(
                transforms,
                [
                    self.false_row(trace_id="auto", category=["한식", "고기"]),
                    self.false_row(trace_id="taxonomy", category=["일식"]),
                    self.false_row(trace_id="skip", evaluation_results={"category_validity_TF": {"eval_value": True}}),
                ],
            )

            summary = report.write_recovery_package(transforms, out)

            self.assertEqual(3, summary["total_rows"])
            self.assertEqual(2, summary["current_false_rows"])
            self.assertEqual(1, summary["queue_counter"]["auto_recoverable_list_valid"])
            self.assertEqual(1, summary["queue_counter"]["taxonomy_review_required"])
            self.assertEqual(1, summary["projected_auto_recovered"])
            self.assertEqual(1, summary["projected_false_after_validator_fix"])
            self.assertTrue((out / "category-validity-recovery-rows.jsonl").exists())
            self.assertTrue((out / "category-validity-recovery-rows.csv").exists())
            self.assertTrue((out / "category-validity-recovery-report.md").exists())


if __name__ == "__main__":
    unittest.main()
