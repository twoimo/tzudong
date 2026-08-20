"""P2 atomic postgres control: SQL contracts, pool fail-closed, same-ID API/worker."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

from backend.pipeline_control.adapter import execute_dry_run
from backend.pipeline_control.api import serve
from backend.pipeline_control.dsn_guard import DsnGuardError, HOSTED_PROJECT_REF
from backend.pipeline_control.pool import PoolError, close_pool, get_pool
from backend.pipeline_control.pg_store import AtomicMemoryStore
from backend.pipeline_control.state_machine import ControlPlaneError
from backend.pipeline_control.worker import process_one

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260820030000_pipeline_control_atomic.sql"
BASE_MIGRATION = ROOT / "supabase" / "migrations" / "20260817020000_pipeline_control.sql"
CONTRACTS = ROOT / "DATA_CONTRACTS.md"


class AtomicSqlContractTests(unittest.TestCase):
    def test_follow_on_migration_keeps_base_file(self) -> None:
        self.assertTrue(BASE_MIGRATION.is_file())
        self.assertTrue(MIGRATION.is_file())
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("pipeline_control.enqueue_job", sql)
        self.assertIn("pipeline_control.claim_job", sql)
        self.assertIn("pipeline_control.control_job", sql)
        self.assertIn("pipeline_control.checkpoint_job", sql)
        self.assertIn("pause_requested", sql)
        self.assertIn("pipeline_control.job_steps", sql)
        self.assertIn("pipeline_control.control_requests", sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", sql)
        self.assertNotIn("GRANT EXECUTE ON FUNCTION pipeline_control.", sql)
        base = BASE_MIGRATION.read_text(encoding="utf-8")
        self.assertNotIn("FOR UPDATE SKIP LOCKED", base)

    def test_data_contracts_row(self) -> None:
        text = CONTRACTS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control atomic postgres RPCs", text)
        self.assertIn("TZUDONG_PIPELINE_STORE=postgres", text)


class PoolFailClosedTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig = {
            key: os.environ.get(key)
            for key in ("TZUDONG_DATA_ENV", "PIPELINE_CONTROL_DSN", "TZUDONG_PIPELINE_STORE")
        }
        close_pool()

    def tearDown(self) -> None:
        close_pool()
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_missing_dsn(self) -> None:
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("PIPELINE_CONTROL_DSN", None)
        with self.assertRaises(PoolError) as ctx:
            get_pool()
        self.assertEqual(ctx.exception.code, "persist_dsn_required")

    def test_hosted_dsn_rejected_before_connect(self) -> None:
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = (
            f"postgresql://postgres.{HOSTED_PROJECT_REF}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres"
        )
        loads = {"n": 0}

        def boom() -> object:
            loads["n"] += 1
            raise AssertionError("must not import psycopg2 for hosted dsn")

        from backend.pipeline_control import pool as pool_mod

        with mock.patch.object(pool_mod, "_load_psycopg2", boom):
            with self.assertRaises(DsnGuardError) as ctx:
                get_pool()
        self.assertEqual(ctx.exception.code, "hosted_dsn_rejected")
        self.assertEqual(loads["n"], 0)

    def test_psycopg2_missing(self) -> None:
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        from backend.pipeline_control import pool as pool_mod

        def missing() -> object:
            raise ImportError("no-psycopg2")

        with mock.patch.object(pool_mod, "_load_psycopg2", missing):
            with self.assertRaises(PoolError) as ctx:
                get_pool()
        self.assertEqual(ctx.exception.code, "psycopg2_missing")


class AtomicSameIdTests(unittest.TestCase):
    def test_enqueue_replay_same_id_and_payload_mismatch(self) -> None:
        store = AtomicMemoryStore(clock=lambda: 1_000.0)
        first, created = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="sameid-key-01",
            payload={"target": "tzuyang", "n": 1},
            actor="qa",
            request_id="req-1",
        )
        self.assertTrue(created)
        replay, created_again = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="sameid-key-01",
            payload={"target": "tzuyang", "n": 1},
            actor="qa",
            request_id="req-2",
        )
        self.assertFalse(created_again)
        self.assertEqual(replay.id, first.id)
        with self.assertRaises(ControlPlaneError) as ctx:
            store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="sameid-key-01",
                payload={"target": "tzuyang", "n": 2},
                actor="qa",
                request_id="req-3",
            )
        self.assertEqual(ctx.exception.code, "idempotency_payload_conflict")
        self.assertEqual(ctx.exception.http_status, 409)

    def test_claim_keeps_same_id_and_second_claim_empty(self) -> None:
        store = AtomicMemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="claim-key-01",
            payload={},
            actor="qa",
            request_id="req-c",
        )
        claimed = store.claim()
        assert claimed is not None
        self.assertEqual(claimed.id, run.id)
        self.assertEqual(claimed.status, "Fetching")
        self.assertIsNone(store.claim())

    def test_pause_requested_until_checkpoint_holds_lock(self) -> None:
        store = AtomicMemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="pause-key-01",
            payload={},
            actor="qa",
            request_id="req-p",
        )
        claimed = store.claim()
        assert claimed is not None
        paused = store.control(run.id, "pause", actor="qa", request_id="req-p2")
        self.assertTrue(paused.pause_requested)
        self.assertEqual(paused.status, "Fetching")
        self.assertEqual(store.locks["tzuyang:heavy_local"], run.id)
        approved = store.checkpoint(run.id, adapter_index=2)
        self.assertEqual(approved.status, "Paused")
        self.assertEqual(store.locks["tzuyang:heavy_local"], run.id)
        resumed = store.control(run.id, "resume", actor="qa", request_id="req-p3")
        self.assertEqual(resumed.status, "Queued")
        self.assertFalse(resumed.pause_requested)
        claimed_again = store.claim()
        assert claimed_again is not None
        self.assertEqual(claimed_again.id, run.id)

    def test_worker_dry_run_same_id(self) -> None:
        store = AtomicMemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="worker-same-01",
            payload={},
            actor="qa",
            request_id="req-w",
        )
        self.assertEqual(process_one(store, live=False), "Succeeded")
        finished = store.get(run.id)
        self.assertEqual(finished.id, run.id)
        self.assertEqual(finished.status, "Succeeded")

    def test_worker_applies_pause_at_checkpoint(self) -> None:
        store = AtomicMemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="worker-pause-01",
            payload={},
            actor="qa",
            request_id="req-wp",
        )
        claimed = store.claim()
        assert claimed is not None
        calls = {"n": 0}

        def should_stop() -> str | None:
            calls["n"] += 1
            if calls["n"] == 2:
                store.control(run.id, "pause", actor="qa", request_id="req-wp2")
            current = store.checkpoint(run.id, adapter_index=claimed.adapter_index)
            if current.status in {"Paused", "Cancelled"}:
                return current.status
            return None

        self.assertEqual(execute_dry_run(claimed, should_stop=should_stop), "Paused")
        self.assertEqual(store.get(run.id).status, "Paused")
        self.assertEqual(store.get(run.id).id, run.id)
        self.assertLess(claimed.adapter_index, 10)


class AtomicHttpSameIdTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_env = {
            key: os.environ.get(key)
            for key in (
                "PIPELINE_CONTROL_STORE_PATH",
                "TZUDONG_DATA_ENV",
                "PIPELINE_CONTROL_DSN",
                "TZUDONG_PIPELINE_PERSIST",
                "TZUDONG_PIPELINE_STORE",
            )
        }
        self._store_dir = tempfile.TemporaryDirectory()
        os.environ["PIPELINE_CONTROL_STORE_PATH"] = str(Path(self._store_dir.name) / "store.json")
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        os.environ.pop("TZUDONG_PIPELINE_PERSIST", None)
        os.environ.pop("TZUDONG_PIPELINE_STORE", None)
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control import queue as queue_mod

        self._orig_store = api_mod.STORE
        self._queue = tempfile.TemporaryDirectory()
        self._orig_queue = queue_mod.DEFAULT_QUEUE
        queue_mod.DEFAULT_QUEUE = Path(self._queue.name) / "pipeline-queue.jsonl"
        api_mod.STORE = AtomicMemoryStore(clock=lambda: 2_000.0)
        self.store = api_mod.STORE
        self.server = serve("127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control import queue as queue_mod

        queue_mod.DEFAULT_QUEUE = self._orig_queue
        api_mod.STORE = self._orig_store
        for key, value in self._orig_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self._queue.cleanup()
        self._store_dir.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        hdrs = {"Content-Type": "application/json", "X-Request-Id": "http-req-1"}
        if headers:
            hdrs.update(headers)
        conn.request(method, path, body=payload, headers=hdrs)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        return response.status, data

    def test_http_enqueue_replay_and_worker_claim_same_id(self) -> None:
        status, body = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "http-same-01", "X-Actor": "qa"},
        )
        self.assertEqual(status, 202)
        run_id = body["id"]
        self.assertEqual(body["status"], "Queued")
        replay_status, replay = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "http-same-01", "X-Actor": "qa"},
        )
        self.assertEqual(replay_status, 202)
        self.assertEqual(replay["id"], run_id)
        mismatch_status, mismatch = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": False},
            {"Idempotency-Key": "http-same-01", "X-Actor": "qa"},
        )
        self.assertEqual(mismatch_status, 409)
        self.assertEqual(mismatch["error"], "idempotency_payload_conflict")
        claimed = self.store.claim()
        assert claimed is not None
        self.assertEqual(claimed.id, run_id)
        get_status, got = self._request("GET", f"/v1/runs/{run_id}")
        self.assertEqual(get_status, 200)
        self.assertEqual(got["id"], run_id)
        self.assertEqual(got["status"], "Fetching")
