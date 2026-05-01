from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "sync_category_review_resolutions_to_supabase.py"
spec = importlib.util.spec_from_file_location("sync_category_review_resolutions_to_supabase", SCRIPT)
syncer = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(syncer)


class SyncCategoryReviewResolutionsToSupabaseTest(unittest.TestCase):
    def test_classify_updates_allows_only_pending_unlocked_rows(self):
        changes = [
            {"trace_id": "pending", "origin_name": "A", "source_line": 1, "after_category": ["한식"], "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "approved", "origin_name": "B", "source_line": 2, "after_category": ["중식"], "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "admin", "origin_name": "C", "source_line": 3, "after_category": "분식", "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "missing", "origin_name": "D", "source_line": 4, "after_category": "양식", "after_category_validity_TF": {"eval_value": True}},
        ]
        db_rows = [
            {"id": 1, "trace_id": "pending", "status": "pending", "evaluation_results": {"x": 1}, "updated_by_admin_id": None},
            {"id": 2, "trace_id": "approved", "status": "approved", "evaluation_results": {}, "updated_by_admin_id": None},
            {"id": 3, "trace_id": "admin", "status": "pending", "evaluation_results": {}, "updated_by_admin_id": "admin-id"},
        ]

        eligible, skipped = syncer.classify_updates(changes, db_rows)

        self.assertEqual(1, len(eligible))
        self.assertEqual(["한식"], eligible[0]["payload"]["categories"])
        self.assertEqual({"eval_value": True}, eligible[0]["payload"]["evaluation_results"]["category_validity_TF"])
        self.assertEqual({"x": 1, "category_validity_TF": {"eval_value": True}}, eligible[0]["payload"]["evaluation_results"])
        self.assertEqual(["review_locked", "review_locked", "missing_in_supabase"], [row["skip_reason"] for row in skipped])

    def test_normalize_categories_deduplicates_strings(self):
        self.assertEqual(["한식", "분식"], syncer.normalize_categories(["한식", "분식", "한식", ""]))
        self.assertEqual(["중식"], syncer.normalize_categories("중식"))


if __name__ == "__main__":
    unittest.main()
