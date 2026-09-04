"""Unit tests for the fixed-SQL publication adapter; no database is touched."""

from __future__ import annotations

import json
import unittest
from dataclasses import replace
from typing import Any

from backend.pipeline_control.publish_worker import (
    HostedApplyConflict,
    HostedApplyFailure,
    HostedBatchLimitError,
)
from backend.pipeline_control.batch_upsert import BATCH_LIMIT
from backend.pipeline_control.publication_adapter import PublicationSqlAdapter
from backend.pipeline_control.tests.publication_fixtures import (
    APPROVED_TEST_PUBLICATION_SET,
)


class _Diag:
    def __init__(self, message_primary: str) -> None:
        self.message_primary = message_primary


class _DatabaseError(Exception):
    def __init__(self, primary: str, *, pgcode: str | None = None) -> None:
        super().__init__("provider detail must not escape")
        self.diag = _Diag(primary)
        self.pgcode = pgcode


class _Executor:
    def __init__(self) -> None:
        self.one_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.all_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.one_result: Any = {
            "inserted_count": 1,
            "updated_count": 0,
            "readback": [],
        }
        self.all_result: Any = []
        self.one_error: Exception | None = None
        self.all_error: Exception | None = None

    def one(self, sql: str, params: tuple[Any, ...]) -> Any:
        self.one_calls.append((sql, params))
        if self.one_error is not None:
            raise self.one_error
        return self.one_result

    def all(self, sql: str, params: tuple[Any, ...]) -> Any:
        self.all_calls.append((sql, params))
        if self.all_error is not None:
            raise self.all_error
        return self.all_result


def _video_row(video_id: str = "abcdefghijk") -> dict[str, Any]:
    return {
        "id": video_id,
        "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
        "channel_name": "tzuyang",
        "title": "title",
    }


def _restaurant_row(row_id: str = "00000000-0000-4000-8000-000000000001") -> dict[str, Any]:
    return {"id": row_id, "trace_id": "trace-1", "approved_name": "name"}


class PublicationSqlAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.executor = _Executor()
        self.adapter = PublicationSqlAdapter(
            APPROVED_TEST_PUBLICATION_SET,
            execute_one=self.executor.one,
            execute_all=self.executor.all,
        )

    def test_construction_performs_no_io(self) -> None:
        self.assertEqual(self.executor.one_calls, [])
        self.assertEqual(self.executor.all_calls, [])

    def test_video_insert_uses_distinct_fixed_rpc_and_required_columns(self) -> None:
        row = _video_row()
        result = self.adapter.apply("public.videos", [row])
        self.assertEqual(result["inserted_count"], 1)
        self.assertEqual(len(self.executor.all_calls), 1)
        read_sql, read_params = self.executor.all_calls[0]
        self.assertIn("FROM public.videos", read_sql)
        self.assertEqual(read_params, ([row["id"]],))
        rpc_sql, rpc_params = self.executor.one_calls[0]
        self.assertEqual(
            rpc_sql,
            "SELECT pipeline_control.publish_upsert_videos(%s::jsonb)",
        )
        operations = json.loads(rpc_params[0])
        self.assertEqual(operations, [{"op": "insert", "payload": row}])

    def test_video_insert_missing_required_service_column_fails_before_rpc(self) -> None:
        row = _video_row()
        del row["channel_name"]
        with self.assertRaises(HostedApplyFailure):
            self.adapter.apply("public.videos", [row])
        self.assertEqual(self.executor.one_calls, [])

    def test_restaurant_update_binds_hosted_cas_snapshot(self) -> None:
        row = _restaurant_row()
        self.executor.all_result = [
            {"id": row["id"], "trace_id": "before", "updated_at": "2026-09-01T00:00:00Z"}
        ]
        self.executor.one_result = {
            "inserted_count": 0,
            "updated_count": 1,
            "readback": [row],
        }
        self.adapter.apply("public.restaurants", [row])
        rpc_sql, rpc_params = self.executor.one_calls[0]
        self.assertEqual(
            rpc_sql,
            "SELECT pipeline_control.publish_upsert_restaurants(%s::jsonb)",
        )
        operation = json.loads(rpc_params[0])[0]
        self.assertEqual(operation["op"], "update")
        self.assertEqual(
            operation["expected"],
            {
                "id": row["id"],
                "trace_id": "before",
                "updated_at": "2026-09-01T00:00:00Z",
            },
        )
        self.assertNotIn("updated_at", operation["payload"])

    def test_missing_cas_snapshot_fails_before_rpc(self) -> None:
        row = _restaurant_row()
        self.executor.all_result = [{"id": row["id"], "trace_id": "before"}]
        with self.assertRaises(HostedApplyFailure):
            self.adapter.apply("public.restaurants", [row])
        self.assertEqual(self.executor.one_calls, [])

    def test_unknown_target_never_interpolates_or_executes(self) -> None:
        with self.assertRaises(HostedApplyFailure):
            self.adapter.read("public.videos; DROP TABLE public.videos", [("x",)])
        self.assertEqual(self.executor.all_calls, [])

    def test_ledger_to_sql_plan_drift_fails_before_io(self) -> None:
        table = APPROVED_TEST_PUBLICATION_SET.tables["public.videos"]
        drifted_table = replace(
            table,
            published_columns=table.published_columns - {"channel_name"},
            allowed_columns=table.allowed_columns - {"channel_name"},
        )
        drifted = replace(
            APPROVED_TEST_PUBLICATION_SET,
            tables={**APPROVED_TEST_PUBLICATION_SET.tables, "public.videos": drifted_table},
        )
        adapter = PublicationSqlAdapter(
            drifted,
            execute_one=self.executor.one,
            execute_all=self.executor.all,
        )
        with self.assertRaises(HostedApplyFailure):
            adapter.apply("public.videos", [_video_row()])
        self.assertEqual(self.executor.all_calls, [])

    def test_duplicate_identity_and_identity_only_payload_fail_before_io(self) -> None:
        with self.assertRaises(HostedApplyFailure):
            self.adapter.apply("public.videos", [_video_row(), _video_row()])
        with self.assertRaises(HostedApplyFailure):
            self.adapter.apply("public.videos", [{"id": "abcdefghijk"}])
        self.assertEqual(self.executor.all_calls, [])
        self.assertEqual(self.executor.one_calls, [])

    def test_batch_limit_is_enforced_before_io(self) -> None:
        rows = [_video_row(f"video{i:06d}") for i in range(BATCH_LIMIT + 1)]
        with self.assertRaises(HostedBatchLimitError):
            self.adapter.apply("public.videos", rows)
        self.assertEqual(self.executor.all_calls, [])

    def test_database_codes_map_to_bounded_exceptions_without_diagnostic_text(self) -> None:
        cases = (
            (_DatabaseError("compare_and_set_conflict"), HostedApplyConflict),
            (_DatabaseError("batch_upsert_limit"), HostedBatchLimitError),
            (_DatabaseError("unknown provider message"), HostedApplyFailure),
            (_DatabaseError("unknown", pgcode="23505"), HostedApplyConflict),
        )
        for error, expected in cases:
            with self.subTest(expected=expected.__name__):
                executor = _Executor()
                executor.one_error = error
                adapter = PublicationSqlAdapter(
                    APPROVED_TEST_PUBLICATION_SET,
                    execute_one=executor.one,
                    execute_all=executor.all,
                )
                with self.assertRaises(expected) as raised:
                    adapter.apply("public.videos", [_video_row()])
                self.assertNotIn("provider", str(raised.exception))

    def test_malformed_read_or_rpc_result_fails_closed(self) -> None:
        self.executor.all_result = "not rows"
        with self.assertRaises(HostedApplyFailure):
            self.adapter.read("public.videos", [("abcdefghijk",)])

        executor = _Executor()
        executor.one_result = "not json"
        adapter = PublicationSqlAdapter(
            APPROVED_TEST_PUBLICATION_SET,
            execute_one=executor.one,
            execute_all=executor.all,
        )
        with self.assertRaises(HostedApplyFailure):
            adapter.apply("public.videos", [_video_row()])


if __name__ == "__main__":
    unittest.main()
