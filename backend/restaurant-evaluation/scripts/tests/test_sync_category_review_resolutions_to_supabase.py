from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "sync_category_review_resolutions_to_supabase.py"
spec = importlib.util.spec_from_file_location("sync_category_review_resolutions_to_supabase", SCRIPT)
syncer = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(syncer)
class Response:
    def __init__(self, data):
        self.data = data


class CompareAndSetQuery:
    def __init__(self, client):
        self.client = client
        self.operation = None
        self.payload = None
        self.filters = []

    def select(self, _columns):
        self.operation = "select"
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def is_(self, column, value):
        self.filters.append(("is", column, value))
        return self

    def execute(self):
        return self.client.execute(self)


class CompareAndSetClient:
    def __init__(self, state, *, recheck_row=None, affected_rows=None, readback_rows=None):
        self.state = copy.deepcopy(state)
        self.recheck_row = copy.deepcopy(recheck_row if recheck_row is not None else state)
        self.affected_rows = copy.deepcopy(affected_rows)
        self.readback_rows = copy.deepcopy(readback_rows)
        self.id_select_count = 0
        self.update_filters = []

    def table(self, _name):
        return CompareAndSetQuery(self)

    def execute(self, query):
        if query.operation == "select":
            self.id_select_count += 1
            if self.id_select_count == 1:
                return Response([copy.deepcopy(self.recheck_row)])
            if self.readback_rows is not None:
                return Response(copy.deepcopy(self.readback_rows))
            return Response([copy.deepcopy(self.state)])
        self.update_filters.append(query.filters)
        if self.affected_rows is not None:
            return Response(copy.deepcopy(self.affected_rows))
        self.state.update(copy.deepcopy(query.payload))
        return Response([copy.deepcopy(self.state)])


class SyncCategoryReviewResolutionsToSupabaseTest(unittest.TestCase):


    def test_classify_updates_allows_only_pending_unlocked_rows(self):
        changes = [
            {"trace_id": "pending", "origin_name": "A", "source_line": 1, "after_category": ["한식"], "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "approved", "origin_name": "B", "source_line": 2, "after_category": ["중식"], "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "admin", "origin_name": "C", "source_line": 3, "after_category": "분식", "after_category_validity_TF": {"eval_value": True}},
            {"trace_id": "missing", "origin_name": "D", "source_line": 4, "after_category": "양식", "after_category_validity_TF": {"eval_value": True}},
        ]
        db_rows = [
            {"id": 1, "trace_id": "pending", "status": "pending", "evaluation_results": {"x": 1}, "updated_by_admin_id": None, "updated_at": "2026-07-12T00:00:00+00:00"},
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
    def category_row(self):
        original = {
            "id": "restaurant-1",
            "trace_id": "trace-1",
            "status": "pending",
            "updated_by_admin_id": None,
            "updated_at": "2026-07-12T00:00:00+00:00",
            "categories": ["기존"],
            "evaluation_results": {"existing": True},
        }
        eligible, skipped = syncer.classify_updates(
            [{
                "trace_id": "trace-1",
                "origin_name": "식당",
                "source_line": 1,
                "after_category": ["한식"],
                "after_category_validity_TF": {"eval_value": True},
            }],
            [original],
        )
        self.assertEqual([], skipped)
        return eligible[0], original

    def test_compare_and_set_updates_exactly_one_row_and_reads_back(self):
        row, original = self.category_row()
        client = CompareAndSetClient(original)

        applied, conflict = syncer.apply_category_compare_and_set(client, row)

        self.assertTrue(applied)
        self.assertIsNone(conflict)
        self.assertEqual(row["payload"]["categories"], client.state["categories"])
        self.assertEqual(row["payload"]["evaluation_results"], client.state["evaluation_results"])
        self.assertEqual(original["updated_at"], client.state["updated_at"])
        self.assertEqual(1, len(client.update_filters))
        self.assertIn(("eq", "status", original["status"]), client.update_filters[0])
        self.assertIn(("is", "updated_by_admin_id", None), client.update_filters[0])
        self.assertIn(("eq", "updated_at", original["updated_at"]), client.update_filters[0])
        self.assertIn(("eq", "categories", '{"기존"}'), client.update_filters[0])
        self.assertIn(("eq", "evaluation_results", '{"existing":true}'), client.update_filters[0])

    def test_compare_and_set_conflicts_when_reviewed_values_change_before_mutation(self):
        row, original = self.category_row()
        for field, value in (
            ("updated_by_admin_id", "admin-1"),
            ("status", "approved"),
            ("categories", ["관리자 분류"]),
            ("updated_at", "2026-07-12T00:01:00+00:00"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed[field] = value
                client = CompareAndSetClient(changed, recheck_row=changed)

                applied, conflict = syncer.apply_category_compare_and_set(client, row)

                self.assertFalse(applied)
                self.assertEqual(syncer.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
                self.assertEqual(changed, client.state)
                self.assertEqual([], client.update_filters)

    def test_compare_and_set_rejects_zero_or_multiple_affected_rows(self):
        row, original = self.category_row()
        for affected_rows in ([], [{"id": "restaurant-1"}, {"id": "restaurant-1"}]):
            with self.subTest(affected_rows=len(affected_rows)):
                client = CompareAndSetClient(original, affected_rows=affected_rows)

                applied, conflict = syncer.apply_category_compare_and_set(client, row)

                self.assertFalse(applied)
                self.assertEqual(syncer.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
                self.assertEqual("affected_row_count_not_one", conflict["conflict_stage"])
                self.assertEqual(original, client.state)
                self.assertEqual(1, len(client.update_filters))

    def test_compare_and_set_rejects_non_exact_readback(self):
        row, original = self.category_row()
        client = CompareAndSetClient(original, readback_rows=[])

        applied, conflict = syncer.apply_category_compare_and_set(client, row)

        self.assertFalse(applied)
        self.assertEqual(syncer.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
        self.assertEqual("readback_not_exactly_one_or_mismatched", conflict["conflict_stage"])


if __name__ == "__main__":
    unittest.main()
