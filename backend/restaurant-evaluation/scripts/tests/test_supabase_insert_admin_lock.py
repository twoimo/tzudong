from __future__ import annotations

import importlib.util
import unittest
from copy import deepcopy
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = PROJECT_ROOT / "backend" / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py"

spec = importlib.util.spec_from_file_location("supabase_insert_admin_lock", SCRIPT_PATH)
supabase_insert = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(supabase_insert)


class FakeResponse:
    def __init__(self, data=None):
        self.data = data or []


class FakeTableQuery:
    def __init__(self, parent, table_name: str):
        self.parent = parent
        self.table_name = table_name
        self.action = None
        self.rows = None
        self.on_conflict = None
        self.payload = None
        self.eq_filter = None
        self.select_columns = None
        self.in_filter = None

    def select(self, columns):
        self.action = "select"
        self.select_columns = columns
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def upsert(self, rows, on_conflict=None):
        self.action = "upsert"
        self.rows = deepcopy(rows)
        self.on_conflict = on_conflict
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = deepcopy(payload)
        return self

    def eq(self, field, value):
        self.eq_filter = (field, value)
        return self

    def execute(self):
        if self.action == "upsert":
            self.parent.upsert_calls.append(
                {"table": self.table_name, "rows": self.rows, "on_conflict": self.on_conflict}
            )
            if self.parent.upsert_behaviors:
                behavior = self.parent.upsert_behaviors.pop(0)
                if isinstance(behavior, Exception):
                    raise behavior
            return FakeResponse()

        if self.action == "update":
            self.parent.update_calls.append(
                {"table": self.table_name, "payload": self.payload, "eq": self.eq_filter}
            )
            if self.parent.update_behaviors:
                behavior = self.parent.update_behaviors.pop(0)
                if isinstance(behavior, Exception):
                    raise behavior
            return FakeResponse()

        if self.action == "select":
            self.parent.select_calls.append(
                {
                    "table": self.table_name,
                    "columns": self.select_columns,
                    "in": self.in_filter,
                }
            )
            return FakeResponse(self.parent.select_data)

        raise AssertionError("Unsupported query action")


class FakeSupabase:
    def __init__(self, *, upsert_behaviors=None, update_behaviors=None, select_data=None):
        self.upsert_behaviors = list(upsert_behaviors or [])
        self.update_behaviors = list(update_behaviors or [])
        self.select_data = list(select_data or [])
        self.upsert_calls = []
        self.update_calls = []
        self.select_calls = []

    def table(self, table_name: str):
        return FakeTableQuery(self, table_name)


class SupabaseInsertAdminLockTests(unittest.TestCase):
    def make_stats(self) -> dict[str, int]:
        return {
            "total_records": 0,
            "inserted": 0,
            "skipped": 0,
            "errors": 0,
            "exact_review_locks": 0,
            "legacy_review_locks": 0,
            "trace_rebinds": 0,
            "ambiguous_rebind_skips": 0,
        }

    def make_incoming(self, **overrides):
        data = {
            "trace_id": "trace-new",
            "youtube_link": "https://youtube.com/watch?v=abc123",
            "channel_name": "tzuyang",
            "status": "pending",
            "origin_name": "새 이름",
            "naver_name": "새 네이버",
            "google_name": "새 구글",
            "trace_id_name_source": "google",
            "categories": ["분식"],
            "reasoning_basis": "new reasoning",
            "tzuyang_review": "new review",
            "origin_address": "서울 새주소",
            "road_address": "서울 새 도로명",
            "jibun_address": "서울 새 지번",
            "english_address": "New English Address",
            "address_elements": {"roadName": "새도로"},
            "lat": 37.55,
            "lng": 126.99,
            "geocoding_success": True,
            "geocoding_false_stage": None,
            "is_missing": False,
            "is_not_selected": False,
            "evaluation_results": {"score": 99},
            "youtube_meta": {"publishedAt": "2025-01-02T00:00:00Z"},
            "source_type": "crawler",
            "description_map_url": "https://maps.example/new",
            "recollect_version": {"stage": 2},
            "review_count": 0,
            "created_at": "2025-01-02T00:00:00Z",
        }
        data.update(overrides)
        return data

    def test_unreviewed_exact_match_refreshes_pipeline_fields_but_keeps_row_owned_fields(self):
        existing = {
            "id": "row-1",
            "trace_id": "trace-new",
            "status": "pending",
            "origin_name": "기존 이름",
            "categories": ["한식"],
            "youtube_meta": {"publishedAt": "2024-01-01T00:00:00Z"},
            "evaluation_results": {"score": 10},
            "review_count": 7,
            "created_at": "2024-01-01T00:00:00Z",
        }
        incoming = self.make_incoming(trace_id="trace-new")

        merged = supabase_insert.merge_restaurant_record(existing, incoming)

        self.assertEqual("새 이름", merged["origin_name"])
        self.assertEqual({"score": 99}, merged["evaluation_results"])
        self.assertEqual(["분식"], merged["categories"])
        self.assertEqual(7, merged["review_count"])
        self.assertEqual("2024-01-01T00:00:00Z", merged["created_at"])

    def test_reviewed_exact_match_preserves_review_owned_fields_and_refreshes_pipeline_fields(self):
        existing = {
            "id": "row-2",
            "trace_id": "trace-new",
            "status": "approved",
            "approved_name": "관리자 승인명",
            "updated_by_admin_id": "admin-1",
            "categories": ["한식"],
            "tzuyang_review": "admin review",
            "road_address": "서울 기존 도로명",
            "lat": 37.11,
            "lng": 127.11,
            "evaluation_results": {"score": 1},
            "youtube_meta": {"publishedAt": "2024-01-01T00:00:00Z"},
            "origin_name": "기존 이름",
            "review_count": 3,
            "created_at": "2024-01-01T00:00:00Z",
        }
        incoming = self.make_incoming(trace_id="trace-new")

        merged = supabase_insert.merge_restaurant_record(existing, incoming)

        self.assertEqual("approved", merged["status"])
        self.assertEqual("관리자 승인명", merged["approved_name"])
        self.assertEqual("admin-1", merged["updated_by_admin_id"])
        self.assertEqual(["한식"], merged["categories"])
        self.assertEqual("admin review", merged["tzuyang_review"])
        self.assertEqual("서울 기존 도로명", merged["road_address"])
        self.assertEqual(37.11, merged["lat"])
        self.assertEqual({"score": 99}, merged["evaluation_results"])
        self.assertEqual({"publishedAt": "2025-01-02T00:00:00Z"}, merged["youtube_meta"])
        self.assertEqual("새 이름", merged["origin_name"])
        self.assertEqual(3, merged["review_count"])
        self.assertEqual("2024-01-01T00:00:00Z", merged["created_at"])

    def test_legacy_reviewed_exact_match_counts_as_protected(self):
        existing = {
            "id": "row-3",
            "trace_id": "trace-new",
            "status": "deleted",
            "updated_by_admin_id": None,
            "categories": ["술집"],
            "review_count": 1,
            "created_at": "2024-01-01T00:00:00Z",
        }
        incoming = self.make_incoming(trace_id="trace-new")
        stats = self.make_stats()

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {"trace-new": existing},
            {},
            stats,
        )

        self.assertEqual(1, len(upserts))
        self.assertEqual([], rebinds)
        self.assertEqual("deleted", upserts[0]["status"])
        self.assertEqual(["술집"], upserts[0]["categories"])
        self.assertEqual(1, stats["exact_review_locks"])
        self.assertEqual(1, stats["legacy_review_locks"])

    def test_unique_reviewed_candidate_rebinds_to_new_trace_id(self):
        reviewed_row = {
            "id": "row-4",
            "trace_id": "trace-old",
            "youtube_link": "https://youtube.com/watch?v=abc123",
            "origin_name": "새 이름",
            "status": "approved",
            "approved_name": "새 이름",
            "updated_by_admin_id": "admin-9",
            "categories": ["고기"],
            "evaluation_results": {"score": 5},
            "review_count": 2,
            "created_at": "2024-01-01T00:00:00Z",
        }
        incoming = self.make_incoming(trace_id="trace-new")
        stats = self.make_stats()
        candidate_map = supabase_insert.build_review_rebind_candidate_map([reviewed_row])

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([], upserts)
        self.assertEqual(1, len(rebinds))
        row_id, payload = rebinds[0]
        self.assertEqual("row-4", row_id)
        self.assertEqual("trace-new", payload["trace_id"])
        self.assertEqual("새 이름", payload["approved_name"])
        self.assertEqual(["고기"], payload["categories"])
        self.assertEqual({"score": 99}, payload["evaluation_results"])
        self.assertEqual(1, stats["trace_rebinds"])
        self.assertEqual(0, stats["ambiguous_rebind_skips"])

    def test_reviewed_candidate_rebinds_via_approved_name_alias_when_origin_name_changed(self):
        reviewed_row = {
            "id": "row-approved",
            "trace_id": "trace-approved",
            "youtube_link": "https://www.youtube.com/watch?v=abc123",
            "origin_name": "해피고기집",
            "approved_name": "행복한고기집",
            "status": "approved",
            "updated_by_admin_id": "admin-1",
            "categories": ["고기"],
        }
        incoming = self.make_incoming(
            trace_id="trace-new",
            youtube_link="https://youtu.be/abc123?feature=share",
            origin_name="행복한고기집",
            naver_name="행복한고기집",
        )
        stats = self.make_stats()
        candidate_map = supabase_insert.build_review_rebind_candidate_map([reviewed_row])

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([], upserts)
        self.assertEqual(1, len(rebinds))
        row_id, payload = rebinds[0]
        self.assertEqual("row-approved", row_id)
        self.assertEqual("trace-new", payload["trace_id"])
        self.assertEqual("행복한고기집", payload["approved_name"])
        self.assertEqual(1, stats["trace_rebinds"])

    def test_noncanonical_existing_youtube_link_rebinds_by_video_identity(self):
        reviewed_row = {
            "id": "row-short-url",
            "trace_id": "trace-approved",
            "youtube_link": "https://youtu.be/abc123",
            "origin_name": "새 이름",
            "approved_name": "새 이름",
            "status": "approved",
            "updated_by_admin_id": "admin-1",
            "categories": ["분식"],
        }
        incoming = self.make_incoming(
            trace_id="trace-new",
            youtube_link="https://www.youtube.com/watch?v=abc123",
            origin_name="새 이름",
            naver_name="새 이름",
        )
        stats = self.make_stats()
        candidate_map = supabase_insert.build_review_rebind_candidate_map([reviewed_row])

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([], upserts)
        self.assertEqual(1, len(rebinds))
        row_id, payload = rebinds[0]
        self.assertEqual("row-short-url", row_id)
        self.assertEqual("trace-new", payload["trace_id"])
        self.assertEqual(1, stats["trace_rebinds"])

    def test_recent_actions_failure_identity_rebinds_before_upsert(self):
        reviewed_row = {
            "id": "row-failed-actions-key",
            "trace_id": "trace-old-failed-actions-key",
            "youtube_link": "https://youtu.be/Xy7Cp6rA3BM",
            "origin_name": "옛날맛짜장",
            "approved_name": "옛날맛짜장",
            "status": "approved",
            "updated_by_admin_id": "admin-1",
        }
        incoming = self.make_incoming(
            trace_id="trace-new-failed-actions-key",
            youtube_link="https://www.youtube.com/watch?v=Xy7Cp6rA3BM",
            origin_name="옛날맛짜장",
            naver_name="옛날맛짜장",
        )
        stats = self.make_stats()
        candidate_map = supabase_insert.build_review_rebind_candidate_map([reviewed_row])

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([], upserts)
        self.assertEqual(1, len(rebinds))
        row_id, payload = rebinds[0]
        self.assertEqual("row-failed-actions-key", row_id)
        self.assertEqual("trace-new-failed-actions-key", payload["trace_id"])
        self.assertEqual(1, stats["trace_rebinds"])

    def test_fetch_review_rebind_candidates_queries_youtube_link_aliases(self):
        existing = {
            "id": "row-short-url",
            "trace_id": "trace-approved",
            "youtube_link": "https://youtu.be/abc123",
            "origin_name": "새 이름",
            "status": "approved",
            "updated_by_admin_id": "admin-1",
        }
        supabase = FakeSupabase(select_data=[existing])

        candidate_map = supabase_insert.fetch_review_rebind_candidates(
            supabase,
            ["https://www.youtube.com/watch?v=abc123"],
        )

        self.assertEqual(1, len(supabase.select_calls))
        _, lookup_links = supabase.select_calls[0]["in"]
        self.assertIn("https://www.youtube.com/watch?v=abc123", lookup_links)
        self.assertIn("https://youtu.be/abc123", lookup_links)
        self.assertIn(("abc123", "새 이름"), candidate_map)

    def test_fetch_review_rebind_candidates_chunks_large_alias_queries(self):
        original_chunk_size = supabase_insert.YOUTUBE_LOOKUP_CHUNK_SIZE
        supabase_insert.YOUTUBE_LOOKUP_CHUNK_SIZE = 2
        try:
            supabase = FakeSupabase()

            supabase_insert.fetch_review_rebind_candidates(
                supabase,
                ["https://www.youtube.com/watch?v=abc123"],
            )
        finally:
            supabase_insert.YOUTUBE_LOOKUP_CHUNK_SIZE = original_chunk_size

        self.assertGreater(len(supabase.select_calls), 1)
        for call in supabase.select_calls:
            _, lookup_links = call["in"]
            self.assertLessEqual(len(lookup_links), 2)

    def test_duplicate_resolved_identity_candidates_skip_without_upsert(self):
        incoming = self.make_incoming(trace_id="trace-new")
        candidate_map = supabase_insert.build_review_rebind_candidate_map([
            {
                "id": "row-5",
                "trace_id": "trace-pending-1",
                "youtube_link": "https://youtube.com/watch?v=abc123",
                "origin_name": "새 이름",
                "status": "pending",
                "updated_by_admin_id": None,
                "evaluation_results": None,
            },
            {
                "id": "row-6",
                "trace_id": "trace-pending-2",
                "youtube_link": "https://youtube.com/watch?v=abc123",
                "origin_name": "새 이름",
                "approved_name": "새 이름",
                "status": "pending",
                "updated_by_admin_id": "admin-1",
                "evaluation_results": {"score": 1},
            },
        ])
        stats = self.make_stats()

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([], upserts)
        self.assertEqual([], rebinds)
        self.assertEqual(0, stats["trace_rebinds"])
        self.assertEqual(1, stats["ambiguous_rebind_skips"])
        self.assertEqual(1, stats["skipped"])

    def test_secondary_name_match_does_not_rebind_when_resolved_identity_differs(self):
        reviewed_row = {
            "id": "row-secondary-name-only",
            "trace_id": "trace-old",
            "youtube_link": "https://youtube.com/watch?v=abc123",
            "approved_name": "관리자 승인명",
            "origin_name": "새 이름",
            "status": "approved",
            "updated_by_admin_id": "admin-1",
        }
        incoming = self.make_incoming(
            trace_id="trace-new",
            origin_name="새 이름",
            naver_name="관리자 승인명 아님",
        )
        stats = self.make_stats()
        candidate_map = supabase_insert.build_review_rebind_candidate_map([reviewed_row])

        upserts, rebinds = supabase_insert.classify_batch_operations(
            [incoming],
            {},
            candidate_map,
            stats,
        )

        self.assertEqual([incoming], upserts)
        self.assertEqual([], rebinds)
        self.assertEqual(0, stats["trace_rebinds"])

    def test_build_record_canonicalizes_youtube_link(self):
        record = supabase_insert.build_record(
            {
                "trace_id": "trace-1",
                "youtube_link": "https://youtu.be/abc123?feature=share",
                "origin_name": "테스트 식당",
                "status": "pending",
            },
            "tzuyang",
        )

        self.assertEqual("https://www.youtube.com/watch?v=abc123", record["youtube_link"])

    def test_execute_upsert_rows_retries_without_optional_google_name_field(self):
        stats = self.make_stats()
        rows = [self.make_incoming(trace_id="trace-new")]
        supabase = FakeSupabase(
            upsert_behaviors=[
                Exception("Could not find the 'google_name' column of 'restaurants' in the schema cache"),
                None,
            ]
        )

        supabase_insert.execute_upsert_rows(supabase, rows, False, stats)

        self.assertEqual(1, stats["inserted"])
        self.assertEqual(0, stats["errors"])
        self.assertEqual(2, len(supabase.upsert_calls))
        self.assertIn("google_name", supabase.upsert_calls[0]["rows"][0])
        self.assertNotIn("google_name", supabase.upsert_calls[1]["rows"][0])

    def test_execute_rebind_updates_retries_without_optional_google_name_field(self):
        stats = self.make_stats()
        payload = self.make_incoming(trace_id="trace-new")
        supabase = FakeSupabase(
            update_behaviors=[
                Exception("Could not find the 'google_name' column of 'restaurants' in the schema cache"),
                None,
            ]
        )

        supabase_insert.execute_rebind_updates(supabase, [("row-9", payload)], False, stats)

        self.assertEqual(1, stats["inserted"])
        self.assertEqual(0, stats["errors"])
        self.assertEqual(2, len(supabase.update_calls))
        self.assertIn("google_name", supabase.update_calls[0]["payload"])
        self.assertNotIn("google_name", supabase.update_calls[1]["payload"])


if __name__ == "__main__":
    unittest.main()
