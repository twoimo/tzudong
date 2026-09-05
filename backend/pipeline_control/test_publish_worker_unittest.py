"""Unit tests for Publish_Worker preview and confirm phases.

Covers task 13 (Requirements 10.2, 10.3, 10.4, 10.5, 10.6): the preview phase
validates a publish request against the committed Publication_Set, drops
marker-carrying local-test rows, counts inserts/updates, and derives a stable
hash reusing the ``state_machine.payload_hash`` normalization; the confirm phase
admits apply only on hash match within the 900-second window and otherwise
returns ``preview_hash_mismatch`` or ``preview_expired``.

These tests exercise the pure preview/confirm logic with injectable inputs (a
Publication_Set, existing hosted identity keys, and a deterministic clock); no
database is touched. Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from backend.pipeline_control.publish_worker import (
    PREVIEW_EXPIRED,
    PREVIEW_HASH_MISMATCH,
    PREVIEW_TTL_SECONDS,
    PUBLICATION_TARGET_NOT_ADMITTED,
    PUBLISH_SCHEDULE_NOT_APPROVED,
    PublicationSet,
    PublicationTable,
    PublishWorker,
    PublishWorkerError,
    load_publication_set,
    stable_publish_hash,
)

_ACTIVE_SCHEDULE = {
    "schemaVersion": 1,
    "timezone": "Asia/Seoul",
    "utcOffsetMinutes": 540,
    "cadence": "daily",
    "kstWindowStart": "07:30",
    "kstWindowEnd": "08:30",
    "utcCron": "30 22 * * *",
    "minBufferMinutesAfterHeavyLocal": 30,
    "approval": {
        "approverName": "test-operator",
        "approvedAt": "2026-09-01T00:00:00Z",
        "status": "approved",
    },
}


def _videos_table() -> PublicationTable:
    identity = ("id",)
    published = frozenset(
        {
            "title",
            "published_at",
            "duration",
            "category",
            "meta_history",
            "view_count",
            "like_count",
            "comment_count",
        }
    )
    return PublicationTable(
        schema="public",
        table="videos",
        identity_keys=identity,
        published_columns=published,
        allowed_columns=published | set(identity),
    )


def _publication_set() -> PublicationSet:
    videos = _videos_table()
    return PublicationSet(
        tables={videos.key: videos},
        approval_status="approved",
        approval_reference_valid=True,
    )


def _video_row(video_id: str, *, title: str = "t") -> dict:
    return {
        "id": video_id,
        "title": title,
        "published_at": "2020-01-01",
        "duration": 100,
        "category": "food",
        "meta_history": {"v": 1},
        "view_count": 10,
        "like_count": 2,
        "comment_count": 1,
    }


def _request(rows: list[dict], *, schema: str = "public", table: str = "videos") -> dict:
    return {
        "publishJobId": "job-1",
        "tables": [{"schema": schema, "table": table, "rows": rows}],
    }


class PublishPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 1_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )

    # -- Requirement 10.4: counts + stable hash ---------------------------

    def test_preview_counts_all_inserts_when_no_existing_keys(self) -> None:
        result = self.worker.preview(_request([_video_row("v1"), _video_row("v2")]))
        self.assertTrue(result.admitted)
        self.assertIsNone(result.code)
        table = result.preview.tables[0]
        self.assertEqual(table.insert_row_count, 2)
        self.assertEqual(table.update_row_count, 0)
        self.assertEqual(table.total_row_count, 2)

    def test_preview_classifies_updates_against_existing_hosted_keys(self) -> None:
        result = self.worker.preview(
            _request([_video_row("v1"), _video_row("v2")]),
            existing_identity_keys={"public.videos": [("v1",)]},
        )
        table = result.preview.tables[0]
        self.assertEqual(table.update_row_count, 1)
        self.assertEqual(table.insert_row_count, 1)
        self.assertEqual(table.total_row_count, 2)

    def test_preview_records_creation_time_from_clock(self) -> None:
        result = self.worker.preview(_request([_video_row("v1")]))
        self.assertEqual(result.preview.created_at, self.clock_value)

    # -- Requirement 10.4: hash determinism -------------------------------

    def test_hash_is_order_independent(self) -> None:
        forward = self.worker.preview(_request([_video_row("v1"), _video_row("v2")]))
        reverse = self.worker.preview(_request([_video_row("v2"), _video_row("v1")]))
        self.assertEqual(forward.preview.preview_hash, reverse.preview.preview_hash)

    def test_hash_changes_when_any_value_changes(self) -> None:
        base = self.worker.preview(_request([_video_row("v1", title="a")]))
        changed = self.worker.preview(_request([_video_row("v1", title="b")]))
        self.assertNotEqual(base.preview.preview_hash, changed.preview.preview_hash)

    def test_hash_matches_direct_stable_hash_of_projection(self) -> None:
        row = _video_row("v1")
        result = self.worker.preview(_request([row]))
        expected = stable_publish_hash({"public.videos": [row]})
        self.assertEqual(result.preview.preview_hash, expected)

    # -- Requirement 9.8: marker-carrying rows excluded -------------------

    def test_marker_rows_are_excluded_from_input(self) -> None:
        marked = _video_row("seed-1")
        marked["title"] = "LOCAL_TEST_ONLY:NOT_PRODUCTION fixture"
        result = self.worker.preview(_request([_video_row("v1"), marked]))
        self.assertTrue(result.admitted)
        self.assertEqual(result.excluded_marked_row_count, 1)
        self.assertEqual(result.preview.tables[0].total_row_count, 1)

    def test_marker_only_input_yields_empty_preview_not_refusal(self) -> None:
        marked = _video_row("seed-1")
        marked["category"] = "LOCAL_TEST_ONLY:NOT_PRODUCTION"
        result = self.worker.preview(_request([marked]))
        self.assertTrue(result.admitted)
        self.assertEqual(result.preview.tables[0].total_row_count, 0)

    # -- Requirements 10.2 / 10.3: non-admitted targets -------------------

    def test_unenumerated_table_is_not_admitted(self) -> None:
        result = self.worker.preview(
            _request([{"id": "r1", "approved_name": "x"}], table="restaurants")
        )
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)
        self.assertIsNone(result.preview)

    def test_unenumerated_column_is_not_admitted(self) -> None:
        row = _video_row("v1")
        row["db_error_message"] = "leaked diagnostic"
        result = self.worker.preview(_request([row]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)
        self.assertIsNone(result.preview)

    def test_row_missing_identity_key_is_not_admitted(self) -> None:
        row = _video_row("v1")
        del row["id"]
        result = self.worker.preview(_request([row]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)

    def test_identity_only_row_is_not_admitted(self) -> None:
        result = self.worker.preview(_request([{"id": "v1"}]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)

    def test_duplicate_identity_is_not_admitted(self) -> None:
        result = self.worker.preview(_request([_video_row("v1"), _video_row("v1")]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)

    def test_duplicate_table_entry_is_not_admitted(self) -> None:
        request = _request([_video_row("v1")])
        request["tables"].append(
            {"schema": "public", "table": "videos", "rows": [_video_row("v2")]}
        )
        result = self.worker.preview(request)
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)

    def test_malformed_request_raises_rather_than_refusing(self) -> None:
        with self.assertRaises(PublishWorkerError):
            self.worker.preview({"tables": []})  # missing publishJobId
        with self.assertRaises(PublishWorkerError):
            self.worker.preview({"publishJobId": "j", "tables": "nope"})

    # -- audit-ready records for Task 14 ----------------------------------

    def test_preview_emits_bounded_history_and_audit_rows(self) -> None:
        result = self.worker.preview(_request([_video_row("v1")]))
        history = result.preview.history_rows()
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["stage"], "preview")
        self.assertEqual(history[0]["target_table"], "public.videos")
        self.assertEqual(history[0]["total_row_count"], 1)
        # No row values leak into the audit surface.
        audit = result.preview.audit_events()
        self.assertEqual(audit[0]["row_count"], 1)
        self.assertNotIn("rows", audit[0])


class PublishConfirmTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 5_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.preview = self.worker.preview(_request([_video_row("v1")])).preview

    # -- Requirement 10.5: admit apply on match within window -------------

    def test_confirm_admits_on_hash_match_within_window(self) -> None:
        self.clock_value += 100.0  # well within 900s
        result = self.worker.confirm(self.preview, self.preview.preview_hash)
        self.assertTrue(result.admitted)
        self.assertIsNone(result.code)

    def test_confirm_admits_exactly_at_ttl_boundary(self) -> None:
        self.clock_value += PREVIEW_TTL_SECONDS  # elapsed == 900 -> still valid
        result = self.worker.confirm(self.preview, self.preview.preview_hash)
        self.assertTrue(result.admitted)

    # -- Requirement 10.6: refuse on mismatch or expiry -------------------

    def test_confirm_rejects_hash_mismatch(self) -> None:
        self.clock_value += 10.0
        result = self.worker.confirm(self.preview, "deadbeef")
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PREVIEW_HASH_MISMATCH)

    def test_confirm_rejects_when_expired(self) -> None:
        self.clock_value += PREVIEW_TTL_SECONDS + 0.5
        result = self.worker.confirm(self.preview, self.preview.preview_hash)
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PREVIEW_EXPIRED)

    def test_expiry_takes_precedence_over_mismatch(self) -> None:
        self.clock_value += PREVIEW_TTL_SECONDS + 100.0
        result = self.worker.confirm(self.preview, "not-the-hash")
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PREVIEW_EXPIRED)

    def test_confirm_history_row_is_bounded(self) -> None:
        self.clock_value += 1.0
        result = self.worker.confirm(self.preview, self.preview.preview_hash)
        row = result.history_row()
        self.assertEqual(row["stage"], "confirm")
        self.assertEqual(row["preview_hash"], self.preview.preview_hash)


class PublicationSetLoaderTests(unittest.TestCase):
    def test_loads_committed_ledger_with_both_tables(self) -> None:
        ps = load_publication_set()
        self.assertIn("public.restaurants", ps.tables)
        self.assertIn("public.videos", ps.tables)
        restaurants = ps.get("public", "restaurants")
        self.assertEqual(restaurants.identity_keys, ("id",))
        # Identity key is part of the allowed column set.
        self.assertIn("id", restaurants.allowed_columns)
        self.assertIn("approved_name", restaurants.allowed_columns)
        # Excluded diagnostic column is not enumerated.
        self.assertNotIn("db_error_message", restaurants.allowed_columns)
        self.assertFalse(ps.is_approved)

    def test_unresolved_publication_set_blocks_preview(self) -> None:
        worker = PublishWorker(
            publication_set=load_publication_set(), schedule=_ACTIVE_SCHEDULE
        )
        result = worker.preview(_request([_video_row("v1")]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLICATION_TARGET_NOT_ADMITTED)
        self.assertIsNone(result.preview)

    def test_unresolved_schedule_blocks_preview(self) -> None:
        worker = PublishWorker(publication_set=_publication_set(), schedule=None)
        result = worker.preview(_request([_video_row("v1")]))
        self.assertFalse(result.admitted)
        self.assertEqual(result.code, PUBLISH_SCHEDULE_NOT_APPROVED)
        self.assertIsNone(result.preview)


if __name__ == "__main__":
    unittest.main()
