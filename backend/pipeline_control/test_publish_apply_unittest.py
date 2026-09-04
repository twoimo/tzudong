"""Unit tests for Publish_Worker apply, readback, and audit phases.

Covers task 14 (Requirements 10.7, 10.8, 10.9, 10.10, 10.13, 10.15, 10.16,
10.17): the apply phase splits confirmed input into sequential <=200-row
batches and applies them through an injected hosted callable; a
compare-and-set conflict converges to ``converged_no_op`` when hosted values
already match and otherwise aborts with ``publish_apply_aborted``; readback
re-reads every applied identity key and fails with ``publish_readback_mismatch``
on any drift; audit emits append-only stage records under one job identifier;
and the schedule gate fails closed with ``publish_schedule_not_approved`` when
no active operator approval exists.

The apply/readback logic is exercised with an in-memory hosted model injected
through ``hosted_apply`` / ``hosted_read`` — no database is touched and no
hosted write is performed. Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import json
import unittest

from backend.pipeline_control.publish_worker import (
    BATCH_UPSERT_LIMIT,
    PREVIEW_EXPIRED,
    PREVIEW_HASH_MISMATCH,
    PREVIEW_TTL_SECONDS,
    PUBLICATION_TARGET_NOT_ADMITTED,
    PUBLISH_APPLY_ABORTED,
    PUBLISH_FAILURE_CODES,
    PUBLISH_READBACK_MISMATCH,
    PUBLISH_SCHEDULE_NOT_APPROVED,
    HostedApplyConflict,
    HostedApplyFailure,
    HostedBatchLimitError,
    PublicationSet,
    PublicationTable,
    PublishWorker,
    is_publish_schedule_active,
    load_publish_schedule,
)

# An active schedule for the happy path; the committed ledger is unresolved.
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


class FakeHosted:
    """In-memory hosted model with batch compare-and-set semantics.

    ``apply`` stores a batch keyed by its identity signature and returns
    inserted/updated counts. A second, wholly-identical apply raises
    ``HostedApplyConflict`` (mirroring the RPC's ``updated_at`` CAS), which lets
    the worker exercise its convergence path. ``read`` returns the stored rows,
    optionally overridden by ``tamper`` to simulate hosted drift.
    """

    def __init__(self, identity_keys_by_table: dict[str, tuple[str, ...]]) -> None:
        self.identity_keys = identity_keys_by_table
        self.store: dict[str, dict[tuple, dict]] = {}
        self.apply_calls: list[tuple[str, int]] = []
        self.force_conflict = False
        self.fail_on_batch: int | None = None
        self.limit_on_batch: int | None = None
        self.tamper: dict[str, dict[tuple, dict]] = {}

    def _sig(self, table_key: str, row: dict) -> tuple:
        return tuple(row.get(k) for k in self.identity_keys[table_key])

    def apply(self, table_key: str, rows: list[dict]) -> dict:
        index = len(self.apply_calls)
        self.apply_calls.append((table_key, len(rows)))
        if self.limit_on_batch is not None and index == self.limit_on_batch:
            raise HostedBatchLimitError()
        if self.fail_on_batch is not None and index == self.fail_on_batch:
            raise HostedApplyFailure()
        table = self.store.setdefault(table_key, {})
        all_identical = bool(rows) and all(
            self._sig(table_key, r) in table
            and table[self._sig(table_key, r)] == dict(r)
            for r in rows
        )
        if self.force_conflict or all_identical:
            raise HostedApplyConflict()
        inserted = 0
        updated = 0
        for row in rows:
            sig = self._sig(table_key, row)
            if sig in table:
                updated += 1
            else:
                inserted += 1
            table[sig] = dict(row)
        return {
            "inserted_count": inserted,
            "updated_count": updated,
            "readback": [dict(r) for r in rows],
        }

    def read(self, table_key: str, signatures: list[tuple]) -> list[dict]:
        table = self.store.get(table_key, {})
        overrides = self.tamper.get(table_key, {})
        out: list[dict] = []
        for sig in signatures:
            row = overrides[sig] if sig in overrides else table.get(sig)
            if row is not None:
                out.append(dict(row))
        return out


class ApplyHappyPathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 1_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.hosted = FakeHosted({"public.videos": ("id",)})

    def _preview(self, rows: list[dict]):
        return self.worker.preview(_request(rows)).preview

    def test_apply_succeeds_and_readback_matches(self) -> None:
        preview = self._preview([_video_row("v1"), _video_row("v2")])
        result = self.worker.apply(
            preview,
            _request([_video_row("v1"), _video_row("v2")]),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 10.0,
        )
        self.assertTrue(result.succeeded)
        self.assertIsNone(result.code)
        self.assertEqual(result.applied_insert_count, 2)
        self.assertEqual(result.completed_batch_count, 1)
        readback = result.readback_records[0]
        self.assertEqual(readback.readback_row_count, 2)
        self.assertEqual(readback.matched_row_count, 2)
        self.assertEqual(readback.mismatched_row_count, 0)

    def test_audit_records_all_stages_under_one_job_id(self) -> None:
        preview = self._preview([_video_row("v1")])
        result = self.worker.apply(
            preview,
            _request([_video_row("v1")]),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        stages = [event["stage"] for event in result.audit_events]
        self.assertEqual(stages, ["preview", "confirm", "apply", "readback"])
        for event in result.audit_events:
            self.assertEqual(event["publish_job_id"], "job-1")
            # Audit surface is counts + fixed codes only; no row values.
            self.assertEqual(
                set(event.keys()),
                {"publish_job_id", "stage", "target_table", "row_count", "result_code"},
            )

    def test_batches_split_at_the_limit(self) -> None:
        rows = [_video_row(f"v{i}") for i in range(450)]
        preview = self._preview(rows)
        result = self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        self.assertTrue(result.succeeded)
        self.assertEqual(result.completed_batch_count, 3)
        # No single apply call exceeds the 200-row limit (10.9).
        self.assertEqual([n for _, n in self.hosted.apply_calls], [200, 200, 50])


class ApplyGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 2_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.hosted = FakeHosted({"public.videos": ("id",)})
        self.preview = self.worker.preview(_request([_video_row("v1")])).preview

    def _apply(self, request=None, presented_hash=None, *, schedule=_ACTIVE_SCHEDULE, now=None):
        return self.worker.apply(
            self.preview,
            request if request is not None else _request([_video_row("v1")]),
            presented_hash if presented_hash is not None else self.preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=schedule,
            now=now if now is not None else self.clock_value + 1.0,
        )

    def test_inactive_schedule_blocks_apply(self) -> None:
        # Committed ledger is unresolved -> not active (10.14, 10.17).
        result = self._apply(schedule=load_publish_schedule())
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_SCHEDULE_NOT_APPROVED)
        self.assertEqual(self.hosted.apply_calls, [])

    def test_missing_schedule_blocks_apply(self) -> None:
        result = self._apply(schedule=None)
        self.assertEqual(result.code, PUBLISH_SCHEDULE_NOT_APPROVED)
        self.assertEqual(self.hosted.apply_calls, [])

    def test_hash_mismatch_blocks_apply(self) -> None:
        result = self._apply(presented_hash="deadbeef")
        self.assertEqual(result.code, PREVIEW_HASH_MISMATCH)
        self.assertEqual(self.hosted.apply_calls, [])

    def test_expired_preview_blocks_apply(self) -> None:
        result = self._apply(now=self.clock_value + PREVIEW_TTL_SECONDS + 1.0)
        self.assertEqual(result.code, PREVIEW_EXPIRED)
        self.assertEqual(self.hosted.apply_calls, [])

    def test_non_admitted_target_blocks_apply(self) -> None:
        bad = _video_row("v1")
        bad["db_error_message"] = "leak"
        # The preview hash won't match the tampered request, but the target
        # check fires first and applies nothing.
        result = self._apply(request=_request([bad]))
        self.assertIn(result.code, {PUBLICATION_TARGET_NOT_ADMITTED, PREVIEW_HASH_MISMATCH})
        self.assertEqual(self.hosted.apply_calls, [])

    def test_changed_rows_fail_hash_binding(self) -> None:
        # Rows admitted but different from the previewed set -> hash mismatch.
        result = self._apply(request=_request([_video_row("v1", title="changed")]))
        self.assertEqual(result.code, PREVIEW_HASH_MISMATCH)
        self.assertEqual(self.hosted.apply_calls, [])


class ApplyConvergenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 3_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.hosted = FakeHosted({"public.videos": ("id",)})

    def _run(self, rows: list[dict]):
        preview = self.worker.preview(_request(rows)).preview
        return self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )

    def test_second_identical_apply_converges(self) -> None:
        rows = [_video_row("v1"), _video_row("v2")]
        first = self._run(rows)
        self.assertTrue(first.succeeded)
        # Second apply hits a compare-and-set conflict but converges (10.11).
        second = self._run(rows)
        self.assertTrue(second.succeeded)
        self.assertIsNone(second.code)
        self.assertEqual(second.converged_no_op_count, 2)
        self.assertEqual(second.applied_insert_count, 0)

    def test_conflict_without_convergence_aborts(self) -> None:
        rows = [_video_row("v1")]
        # Seed hosted with a DIFFERENT value, then force a CAS conflict: the
        # re-read shows drift, so apply aborts (10.16).
        self.hosted.store["public.videos"] = {("v1",): _video_row("v1", title="other")}
        self.hosted.force_conflict = True
        result = self._run(rows)
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)


class ApplyAbortTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 4_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.hosted = FakeHosted({"public.videos": ("id",)})

    def _run(self, rows: list[dict]):
        preview = self.worker.preview(_request(rows)).preview
        return self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )

    def test_batch_failure_stops_subsequent_batches(self) -> None:
        rows = [_video_row(f"v{i}") for i in range(450)]  # 3 batches
        self.hosted.fail_on_batch = 1  # second batch fails
        result = self._run(rows)
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)
        self.assertEqual(result.completed_batch_count, 1)
        self.assertEqual(result.uncompleted_batch_count, 2)
        # The third batch is never started (10.16).
        self.assertEqual(len(self.hosted.apply_calls), 2)
        self.assertEqual(len(result.readback_records), 1)
        self.assertEqual(result.readback_records[0].matched_row_count, 200)
        self.assertEqual(result.readback_records[0].mismatched_row_count, 0)
        self.assertEqual(result.audit_events[-1]["stage"], "readback")
        self.assertEqual(result.history_rows[-1]["stage"], "readback")

    def test_hosted_batch_limit_maps_to_fixed_code(self) -> None:
        rows = [_video_row(f"v{i}") for i in range(10)]
        self.hosted.limit_on_batch = 0
        result = self._run(rows)
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, BATCH_UPSERT_LIMIT)

    def test_partial_abort_audits_readback_drift_and_unavailability(self) -> None:
        for unavailable in (False, True):
            self.hosted = FakeHosted({"public.videos": ("id",)})
            self.hosted.fail_on_batch = 1
            self.hosted.tamper = {"public.videos": {("v0",): _video_row("v0", title="drift")}}
            if unavailable:
                def failed_read(*_args):
                    raise RuntimeError("private database diagnostic")
                self.hosted.read = failed_read
            result = self._run([_video_row(f"v{i}") for i in range(450)])
            self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)
            self.assertEqual(len(self.hosted.apply_calls), 2)
            self.assertEqual(result.readback_records[0].mismatched_row_count, 200 if unavailable else 1)
            self.assertEqual(result.audit_events[-1]["result_code"], PUBLISH_READBACK_MISMATCH)
            self.assertNotIn("private database diagnostic", str(result))

    def test_unexpected_adapter_exception_maps_to_fixed_code_without_diagnostics(self) -> None:
        sentinel = "provider database error detail must not escape"

        def broken_apply(_table, _rows):
            raise RuntimeError(sentinel)

        rows = [_video_row("v1")]
        preview = self.worker.preview(_request(rows)).preview
        result = self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=broken_apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)
        self.assertNotIn(sentinel, json.dumps(result.as_dict()))
        self.assertNotIn(sentinel, json.dumps(result.audit_events))

    def test_malformed_or_impossible_adapter_counts_abort(self) -> None:
        for outcome in (
            None,
            {"inserted_count": -1, "updated_count": 2},
            {"inserted_count": 0, "updated_count": 0},
            {"inserted_count": True, "updated_count": 0},
        ):
            rows = [_video_row("v1")]
            preview = self.worker.preview(_request(rows)).preview
            result = self.worker.apply(
                preview,
                _request(rows),
                preview.preview_hash,
                hosted_apply=lambda _table, _rows, value=outcome: value,
                hosted_read=self.hosted.read,
                schedule=_ACTIVE_SCHEDULE,
                now=self.clock_value + 1.0,
            )
            self.assertEqual(result.code, PUBLISH_APPLY_ABORTED)


class ReadbackMismatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock_value = 5_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )
        self.hosted = FakeHosted({"public.videos": ("id",)})

    def test_readback_mismatch_is_not_a_success(self) -> None:
        rows = [_video_row("v1"), _video_row("v2")]
        preview = self.worker.preview(_request(rows)).preview
        # Tamper the hosted readback for v2 so its value drifts from intended.
        self.hosted.tamper["public.videos"] = {("v2",): _video_row("v2", title="drift")}
        result = self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=self.hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        self.assertFalse(result.succeeded)
        self.assertEqual(result.code, PUBLISH_READBACK_MISMATCH)
        readback = result.readback_records[0]
        self.assertEqual(readback.mismatched_row_count, 1)
        self.assertEqual(readback.matched_row_count, 1)
        # The mismatch table name and mismatch count are on the audit surface.
        readback_audit = [e for e in result.audit_events if e["stage"] == "readback"]
        self.assertEqual(readback_audit[0]["target_table"], "public.videos")
        self.assertEqual(readback_audit[0]["result_code"], PUBLISH_READBACK_MISMATCH)
        self.assertEqual(readback_audit[0]["row_count"], 1)

    def test_readback_exception_is_bounded_mismatch_without_diagnostics(self) -> None:
        sentinel = "raw hosted read error must not escape"
        rows = [_video_row("v1")]
        preview = self.worker.preview(_request(rows)).preview

        def broken_read(_table, _signatures):
            raise RuntimeError(sentinel)

        result = self.worker.apply(
            preview,
            _request(rows),
            preview.preview_hash,
            hosted_apply=self.hosted.apply,
            hosted_read=broken_read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        self.assertEqual(result.code, PUBLISH_READBACK_MISMATCH)
        self.assertFalse(result.succeeded)
        self.assertEqual(result.readback_records[0].mismatched_row_count, 1)
        self.assertNotIn(sentinel, json.dumps(result.as_dict()))
        self.assertNotIn(sentinel, json.dumps(result.audit_events))


class ClosedCodeSetTests(unittest.TestCase):
    """Every failure code the flow emits is inside the seven-value set (10.13)."""

    def setUp(self) -> None:
        self.clock_value = 6_000.0
        self.worker = PublishWorker(
            publication_set=_publication_set(), schedule=_ACTIVE_SCHEDULE, clock=lambda: self.clock_value
        )

    def test_all_emitted_failure_codes_are_in_the_closed_set(self) -> None:
        self.assertEqual(len(PUBLISH_FAILURE_CODES), 7)
        preview = self.worker.preview(_request([_video_row("v1")])).preview
        hosted = FakeHosted({"public.videos": ("id",)})

        # Schedule not approved.
        r1 = self.worker.apply(
            preview,
            _request([_video_row("v1")]),
            preview.preview_hash,
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=None,
            now=self.clock_value + 1.0,
        )
        # Hash mismatch.
        r2 = self.worker.apply(
            preview,
            _request([_video_row("v1")]),
            "nope",
            hosted_apply=hosted.apply,
            hosted_read=hosted.read,
            schedule=_ACTIVE_SCHEDULE,
            now=self.clock_value + 1.0,
        )
        for result in (r1, r2):
            self.assertIn(result.code, PUBLISH_FAILURE_CODES)


class ScheduleActivationTests(unittest.TestCase):
    def test_committed_schedule_is_inactive(self) -> None:
        self.assertFalse(is_publish_schedule_active(load_publish_schedule()))

    def test_only_approved_status_is_active(self) -> None:
        self.assertTrue(is_publish_schedule_active(_ACTIVE_SCHEDULE))
        missing_name = {**_ACTIVE_SCHEDULE, "approval": {"status": "approved", "approvedAt": "2026-09-01T00:00:00Z"}}
        bad_timestamp = {**_ACTIVE_SCHEDULE, "approval": {"status": "approved", "approverName": "operator", "approvedAt": "yesterday"}}
        bad_cron = {**_ACTIVE_SCHEDULE, "utcCron": "0 0 * * *"}
        self.assertFalse(is_publish_schedule_active(missing_name))
        self.assertFalse(is_publish_schedule_active(bad_timestamp))
        self.assertFalse(is_publish_schedule_active(bad_cron))
        self.assertFalse(is_publish_schedule_active({"approval": {"status": "unresolved"}}))
        self.assertFalse(is_publish_schedule_active({"approval": {}}))
        self.assertFalse(is_publish_schedule_active({}))
        self.assertFalse(is_publish_schedule_active(None))


if __name__ == "__main__":
    unittest.main()
