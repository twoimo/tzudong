"""P4 bounded restaurant batch upsert: SQL contracts, DSN fail-closed, no REST writes."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260820040000_pipeline_batch_upsert.sql"
ATOMIC = ROOT / "supabase" / "migrations" / "20260820030000_pipeline_control_atomic.sql"
HELPERS = ROOT / "supabase" / "migrations" / "20260817000100_restaurant_identity_helper_writer_grants.sql"
CONTRACTS = ROOT / "DATA_CONTRACTS.md"
SCRIPT = ROOT / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py"


class BatchUpsertSqlContractTests(unittest.TestCase):
    def test_follow_on_keeps_prior_pipeline_migrations(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        atomic = ATOMIC.read_text(encoding="utf-8")
        helpers = HELPERS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control.batch_upsert_restaurants(p_rows jsonb)", sql)
        self.assertIn("v_count > 200", sql)
        self.assertIn("v_count := jsonb_array_length(p_rows);", sql)
        self.assertIn("compare_and_set_conflict", sql)
        self.assertIn("target.updated_at IS NOT DISTINCT FROM $4", sql)
        self.assertIn("jsonb_agg(to_jsonb(restaurant)", sql)
        self.assertIn("inserted_count", sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", sql)
        self.assertNotIn("GRANT EXECUTE ON FUNCTION pipeline_control.batch_upsert_restaurants", sql)
        self.assertIn("SELECT privacy_retention.assert_g014_public_rpc_allowlist();", sql)
        self.assertIn("REVOKE ALL ON FUNCTION public.extract_youtube_video_id(text)", sql)
        self.assertIn("FROM service_role", sql)
        self.assertIn("FOR UPDATE SKIP LOCKED", atomic)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO postgres, service_role;", helpers)

    def test_data_contracts_row(self) -> None:
        text = CONTRACTS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control batch restaurant upsert", text)
        self.assertIn("20260820040000_pipeline_batch_upsert.sql", text)
        self.assertIn("at most 200 rows", text)


class BatchUpsertClientTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("PIPELINE_CONTROL_DSN", None)
        from backend.pipeline_control import pool as pool_mod

        pool_mod.close_pool()

    def tearDown(self) -> None:
        from backend.pipeline_control import pool as pool_mod

        pool_mod.close_pool()
        os.environ.pop("PIPELINE_CONTROL_DSN", None)

    def test_missing_dsn_fail_closed_before_connect(self) -> None:
        from backend.pipeline_control.batch_upsert import apply_restaurant_batch
        from backend.pipeline_control.pool import PoolError

        with self.assertRaises(PoolError) as ctx:
            apply_restaurant_batch([{"op": "insert", "payload": {"trace_id": "t"}}])
        self.assertEqual(ctx.exception.code, "persist_dsn_required")

    def test_rejects_over_limit_without_connect(self) -> None:
        from backend.pipeline_control.batch_upsert import BATCH_LIMIT, BatchUpsertError, apply_restaurant_batch

        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        with self.assertRaises(BatchUpsertError) as ctx:
            apply_restaurant_batch([{"op": "insert", "payload": {"trace_id": str(i)}} for i in range(BATCH_LIMIT + 1)])
        self.assertEqual(ctx.exception.code, "batch_upsert_limit")

    def test_maps_cas_conflict_from_postgres(self) -> None:
        from backend.pipeline_control import batch_upsert as batch_mod
        from backend.pipeline_control.batch_upsert import BatchUpsertError, apply_restaurant_batch

        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"

        class FakeError(Exception):
            pgcode = "40001"
            pgerror = "ERROR:  compare_and_set_conflict"

        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                raise FakeError("compare_and_set_conflict")

            def fetchone(self):
                raise AssertionError("must not fetch after execute failure")

            def __enter__(self):
                return self

            def __exit__(self, *_exc):
                return False

        class FakeConn:
            def cursor(self):
                return FakeCursor()

            def commit(self):
                raise AssertionError("must not commit after conflict")

        def fake_connection():
            from contextlib import contextmanager

            @contextmanager
            def _inner():
                yield FakeConn()

            return _inner()

        with mock.patch.object(batch_mod, "connection", fake_connection):
            with mock.patch.object(batch_mod, "_load_psycopg2", lambda: (object(), lambda value: value)):
                with self.assertRaises(BatchUpsertError) as ctx:
                    apply_restaurant_batch(
                        [{"op": "update", "payload": {"trace_id": "t"}, "expected": {"id": "x", "trace_id": "t", "updated_at": "2026-01-01T00:00:00Z"}}]
                    )
        self.assertEqual(ctx.exception.code, "compare_and_set_conflict")


class Step13BatchWriteTests(unittest.TestCase):
    def test_script_does_not_loop_rest_insert_or_update(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("apply_restaurant_batch(operations)", source)
        self.assertIn("RESTAURANT_BATCH_LIMIT", source)
        self.assertNotIn("execute_conditional_insert(supabase, payload)", source)
        self.assertNotIn('execute_conditional_update(supabase, existing["id"], payload, existing)', source)
        self.assertNotIn("execute_conditional_update(supabase, row_id, payload, existing)", source)


if __name__ == "__main__":
    unittest.main()
