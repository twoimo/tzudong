from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "build_category_validity_safe_apply_package.py"
spec = importlib.util.spec_from_file_location("build_category_validity_safe_apply_package", SCRIPT)
package = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(package)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildCategoryValiditySafeApplyPackageTest(unittest.TestCase):
    def safe_row(self, **overrides):
        row = {
            "category_diff_id": "CVD-1",
            "trace_id": "trace-safe",
            "source_line": 10,
            "origin_name": "복합식당",
            "category": ["한식", "고기"],
            "normalized_categories": ["한식", "고기"],
            "review_queue": "safe_category_validity_projection",
            "diff_status": "false_to_true",
            "before_category_validity": False,
            "after_category_validity": True,
            "projected_category_validity_TF": {"eval_value": True},
        }
        row.update(overrides)
        return row

    def test_build_package_rows_accepts_only_false_to_true_safe_queue(self):
        apply_rows, blocked_rows = package.build_package_rows(
            [
                self.safe_row(),
                self.safe_row(trace_id="taxonomy", review_queue="taxonomy_review_required"),
                self.safe_row(trace_id="missing", diff_status="missing_eval_to_true", before_category_validity=None),
            ]
        )

        self.assertEqual(1, len(apply_rows))
        self.assertEqual("ready_for_operator_approved_apply", apply_rows[0]["safe_apply_status"])
        self.assertEqual("report_only_no_mutation", apply_rows[0]["write_mode"])
        self.assertEqual(2, len(blocked_rows))
        self.assertIn("review_queue_not_safe:taxonomy_review_required", blocked_rows[0]["blocked_reasons"])
        self.assertIn("diff_status_not_false_to_true:missing_eval_to_true", blocked_rows[1]["blocked_reasons"])

    def test_write_safe_apply_package_creates_apply_and_blocked_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            diff_dir = root / "diff"
            out = root / "out"
            write_jsonl(
                diff_dir / "category-validity-rerun-diff-actionable.jsonl",
                [self.safe_row(), self.safe_row(trace_id="bad", review_queue="taxonomy_review_required")],
            )

            summary = package.write_safe_apply_package(diff_dir, out)

            self.assertEqual(2, summary["total_actionable_rows"])
            self.assertEqual(1, summary["ready_for_operator_approved_apply"])
            self.assertEqual(1, summary["blocked_from_safe_apply"])
            self.assertEqual("report_only_no_mutation", summary["safety_mode"])
            self.assertTrue((out / "category-validity-safe-apply-candidates-report-only.jsonl").exists())
            self.assertTrue((out / "category-validity-safe-apply-blocked.jsonl").exists())
            self.assertTrue((out / "category-validity-safe-apply-package.md").exists())

    def test_latest_diff_package_prefers_latest_named_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            older = root / "category-validity-rerun-diff-20260101T000000Z"
            newer = root / "category-validity-rerun-diff-20260102T000000Z"
            write_jsonl(older / "category-validity-rerun-diff-actionable.jsonl", [{"trace_id": "old"}])
            write_jsonl(newer / "category-validity-rerun-diff-actionable.jsonl", [{"trace_id": "new"}])

            self.assertEqual(newer, package.latest_diff_package(root))


if __name__ == "__main__":
    unittest.main()
