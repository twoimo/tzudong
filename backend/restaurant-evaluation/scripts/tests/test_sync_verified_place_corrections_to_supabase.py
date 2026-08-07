import copy
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "sync_verified_place_corrections_to_supabase.py"
SPEC = importlib.util.spec_from_file_location("sync_verified_place_corrections_to_supabase", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(module)
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


class VerifiedPlaceCorrectionPayloadTests(unittest.TestCase):


    def test_flatten_categories_removes_nested_arrays_and_duplicates(self):
        self.assertEqual(["한식", "분식"], module.flatten_categories([["한식", "분식"], "한식", None, ""]))

    def test_build_payload_guards_approved_name_and_normalizes_metadata(self):
        existing = {
            "approved_name": "춘천냉면",
            "origin_name": "청량리할머니냉면",
            "naver_name": "할머니냉면",
            "categories": [["한식", "분식"]],
            "evaluation_results": {"old": True},
            "jibun_address": "서울특별시 동대문구 청량리동 733",
        }
        correction = {
            "restaurants": [{
                "origin_name": "춘천냉면",
                "address": "서울특별시 동대문구 왕산로37길 50",
                "lat": 37.5821845,
                "lng": 127.0439578,
                "category": ["한식", "분식"],
            }]
        }

        payload = module.build_payload(existing, correction)

        self.assertEqual("춘천냉면", payload["origin_name"])
        self.assertEqual("춘천냉면", payload["naver_name"])
        self.assertEqual(["한식", "분식"], payload["categories"])
        self.assertTrue(payload["evaluation_results"]["location_match_TF"]["eval_value"])
        self.assertEqual("manual_place_correction_supabase_sync", payload["evaluation_results"]["category_validity_TF"]["projection_source"])

    def test_build_payload_rejects_non_matching_approved_name(self):
        self.assertIsNone(module.build_payload(
            {"approved_name": "다른집"},
            {"restaurants": [{"origin_name": "춘천냉면", "category": ["한식"]}]},
        ))
    def verified_row(self):
        original = {
            "id": "restaurant-1",
            "status": "approved",
            "updated_by_admin_id": None,
            "updated_at": "2026-07-12T00:00:00+00:00",
            "youtube_link": "https://www.youtube.com/watch?v=abc123",
            "approved_name": "춘천냉면",
            "origin_name": "이전 원본명",
            "naver_name": "이전 네이버명",
            "categories": ["기존"],
            "evaluation_results": {"old": True},
            "jibun_address": "서울특별시 동대문구 청량리동 733",
            "db_error_message": "old error",
            "db_error_details": {"old": "error"},
        }
        correction = {
            "restaurants": [{
                "origin_name": "춘천냉면",
                "address": "서울특별시 동대문구 왕산로37길 50",
                "lat": 37.5821845,
                "lng": 127.0439578,
                "category": ["한식", "분식"],
            }]
        }
        payload = module.build_payload(original, correction)
        assert payload is not None
        return {
            "youtube_link": original["youtube_link"],
            "id": original["id"],
            "approved_name": original["approved_name"],
            "before": {
                "origin_name": original["origin_name"],
                "naver_name": original["naver_name"],
                "categories": original["categories"],
            },
            "payload": payload,
            "reviewed": module.reviewed_fields(original),
        }, original

    def test_compare_and_set_updates_exactly_one_row_and_reads_back(self):
        row, original = self.verified_row()
        client = CompareAndSetClient(original)

        applied, conflict = module.apply_verified_compare_and_set(client, row)

        self.assertTrue(applied)
        self.assertIsNone(conflict)
        self.assertEqual(row["payload"]["origin_name"], client.state["origin_name"])
        self.assertEqual(row["payload"]["evaluation_results"], client.state["evaluation_results"])
        self.assertEqual(row["payload"]["updated_at"], client.state["updated_at"])
        self.assertEqual(1, len(client.update_filters))
        self.assertIn(("eq", "status", original["status"]), client.update_filters[0])
        self.assertIn(("is", "updated_by_admin_id", None), client.update_filters[0])
        self.assertIn(("eq", "updated_at", original["updated_at"]), client.update_filters[0])
        self.assertIn(("eq", "origin_name", original["origin_name"]), client.update_filters[0])
        self.assertIn(("eq", "categories", '{"기존"}'), client.update_filters[0])
        self.assertIn(("eq", "evaluation_results", '{"old":true}'), client.update_filters[0])
        self.assertIn(("eq", "db_error_details", '{"old":"error"}'), client.update_filters[0])

    def test_compare_and_set_conflicts_when_reviewed_values_change_before_mutation(self):
        row, original = self.verified_row()
        for field, value in (
            ("updated_by_admin_id", "admin-1"),
            ("status", "pending"),
            ("origin_name", "관리자 원본명"),
            ("updated_at", "2026-07-12T00:01:00+00:00"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed[field] = value
                client = CompareAndSetClient(changed, recheck_row=changed)

                applied, conflict = module.apply_verified_compare_and_set(client, row)

                self.assertFalse(applied)
                self.assertEqual(module.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
                self.assertEqual(changed, client.state)
                self.assertEqual([], client.update_filters)

    def test_compare_and_set_rejects_zero_or_multiple_affected_rows(self):
        row, original = self.verified_row()
        for affected_rows in ([], [{"id": "restaurant-1"}, {"id": "restaurant-1"}]):
            with self.subTest(affected_rows=len(affected_rows)):
                client = CompareAndSetClient(original, affected_rows=affected_rows)

                applied, conflict = module.apply_verified_compare_and_set(client, row)

                self.assertFalse(applied)
                self.assertEqual(module.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
                self.assertEqual("affected_row_count_not_one", conflict["conflict_stage"])
                self.assertEqual(original, client.state)
                self.assertEqual(1, len(client.update_filters))

    def test_compare_and_set_rejects_non_exact_readback(self):
        row, original = self.verified_row()
        client = CompareAndSetClient(original, readback_rows=[])

        applied, conflict = module.apply_verified_compare_and_set(client, row)

        self.assertFalse(applied)
        self.assertEqual(module.COMPARE_AND_SET_CONFLICT, conflict["skip_reason"])
        self.assertEqual("readback_not_exactly_one_or_mismatched", conflict["conflict_stage"])


if __name__ == "__main__":
    unittest.main()
