"""Slice 0 lock loop, DSN guard, compose overlay, and transition matrix."""

from __future__ import annotations

import json
import os
import re
import threading
import tempfile
import unittest
from http.client import HTTPConnection
from pathlib import Path

from backend.pipeline_control import dsn_guard
from backend.pipeline_control.adapter import execute_dry_run
from backend.pipeline_control.api import PipelineApiHandler, STORE, serve
from backend.pipeline_control.state_machine import ControlPlaneError, payload_hash
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.targets import load_targets
from backend.pipeline_control.worker import heavy_local_runtime_ready, process_one
from backend.utils.privacy_log import sanitize_log_value

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "pipeline-control" / "docker-compose.pipeline.yml"
MIGRATION = ROOT / "supabase" / "migrations" / "20260817020000_pipeline_control.sql"
FIXTURE = ROOT / "pipeline-control" / "fixtures" / "pg-host-classes.v1.json"
MJS = ROOT / "utils" / "verified-pg-client.mjs"
CONTRACT = ROOT / "supabase" / "scripts" / "g035_hosted_recovery_contract.py"


class HostClassParityTests(unittest.TestCase):
    def test_fixture_matches_mjs_and_python(self) -> None:
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        mjs = MJS.read_text(encoding="utf-8")
        direct = re.search(r"DIRECT_DATABASE_HOST_RE = /\^(.*)\$/", mjs)
        pooler = re.search(r"POOLER_HOST_RE = /\^(.*)\$/", mjs)
        self.assertIsNotNone(direct)
        self.assertIsNotNone(pooler)
        self.assertEqual(fixture["directDatabaseHostPattern"], f"^{direct.group(1)}$")
        self.assertEqual(fixture["poolerHostPattern"], f"^{pooler.group(1)}$")
        self.assertTrue(dsn_guard.is_loopback_pg_host("127.0.0.1"))
        self.assertTrue(dsn_guard.is_loopback_pg_host("db"))
        admitted = dsn_guard.admit_dsn(
            data_env="local_db",
            dsn="postgresql://postgres@db:5432/postgres",
        )
        self.assertEqual(admitted["hostClass"], "loopback")
        self.assertTrue(dsn_guard.is_supabase_production_pg_host("db.aqlcofblfxdrjhhdmarw.supabase.co"))
        self.assertTrue(
            dsn_guard.is_supabase_production_pg_host("aws-1-ap-southeast-1.pooler.supabase.com")
        )


class DsnGuardTests(unittest.TestCase):
    def test_local_db_rejects_hosted_ref(self) -> None:
        with self.assertRaises(dsn_guard.DsnGuardError) as ctx:
            dsn_guard.admit_dsn(
                data_env="local_db",
                dsn="postgresql://postgres.aqlcofblfxdrjhhdmarw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
            )
        self.assertEqual(ctx.exception.code, "hosted_dsn_rejected")

    def test_local_db_accepts_loopback(self) -> None:
        admitted = dsn_guard.admit_dsn(
            data_env="local_db",
            dsn="postgresql://tzudong@127.0.0.1:54322/postgres",
        )
        self.assertEqual(admitted["hostClass"], "loopback")

    def test_invalid_env_fail_closed(self) -> None:
        with self.assertRaises(dsn_guard.DsnGuardError) as ctx:
            dsn_guard.admit_dsn(data_env="", dsn="postgresql://tzudong@127.0.0.1/postgres")
        self.assertEqual(ctx.exception.code, "data_env_invalid")


class StoreMatrixTests(unittest.TestCase):
    def test_idempotency_replay_and_conflict(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        first, created = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="idemkey01",
            payload={"channel": "tzuyang"},
            actor="admin",
            request_id="req-1",
        )
        self.assertTrue(created)
        replay, created_again = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="idemkey01",
            payload={"channel": "tzuyang"},
            actor="admin",
            request_id="req-2",
        )
        self.assertFalse(created_again)
        self.assertEqual(first.id, replay.id)
        with self.assertRaises(ControlPlaneError) as ctx:
            store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="idemkey01",
                payload={"channel": "other"},
                actor="admin",
                request_id="req-3",
            )
        self.assertEqual(ctx.exception.code, "idempotency_payload_conflict")

    def test_single_flight_lock(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="lockkey01",
            payload={},
            actor="admin",
            request_id="req-1",
        )
        with self.assertRaises(ControlPlaneError) as ctx:
            store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="lockkey02",
                payload={"n": 2},
                actor="admin",
                request_id="req-2",
            )
        self.assertEqual(ctx.exception.code, "lock_held")

    def test_pause_holds_lease_and_skips_reclaim(self) -> None:
        now = {"t": 1_000.0}

        def clock() -> float:
            return now["t"]

        store = MemoryStore(clock=clock)
        run, _ = store.create_run(
            target="tzuyang",
            profile="lite_gha",
            idempotency_key="pause0001",
            payload={},
            actor="admin",
            request_id="req-p",
        )
        store.control(run.id, "pause", actor="admin", request_id="req-p2")
        now["t"] = 10_000.0
        store._reclaim()
        self.assertEqual(store.get(run.id).status, "Paused")
        with self.assertRaises(ControlPlaneError):
            store.create_run(
                target="tzuyang",
                profile="lite_gha",
                idempotency_key="pause0002",
                payload={"x": 1},
                actor="admin",
                request_id="req-p3",
            )

    def test_stale_reclaim_on_fetching(self) -> None:
        now = {"t": 1_000.0}
        store = MemoryStore(clock=lambda: now["t"])
        run, _ = store.create_run(
            target="meatcreator",
            profile="lite_gha",
            idempotency_key="stale0001",
            payload={},
            actor="admin",
            request_id="req-s",
        )
        store.claim()
        now["t"] = 10_000.0
        store._reclaim()
        self.assertEqual(store.get(run.id).status, "Failed")
        self.assertEqual(store.get(run.id).error_code, "lease_expired")

    def test_transition_matrix(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="trans0001",
            payload={},
            actor="admin",
            request_id="req-t",
        )
        store.control(run.id, "pause", actor="a", request_id="r1")
        self.assertEqual(store.get(run.id).status, "Paused")
        store.control(run.id, "resume", actor="a", request_id="r2")
        self.assertEqual(store.get(run.id).status, "Queued")
        store.control(run.id, "cancel", actor="a", request_id="r3")
        self.assertEqual(store.get(run.id).status, "Cancelled")
        with self.assertRaises(ControlPlaneError) as ctx:
            store.control(run.id, "pause", actor="a", request_id="r4")
        self.assertEqual(ctx.exception.code, "illegal_transition")

    def test_audit_row_fields(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="audit0001",
            payload={},
            actor="operator",
            request_id="req-audit",
        )
        row = store.audit[0]
        self.assertEqual(row["actor"], "operator")
        self.assertEqual(row["job_id"], run.id)
        self.assertEqual(row["transition"], "enqueue")
        self.assertEqual(row["X-Request-Id"], "req-audit")

    def test_dry_run_worker(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="dryrun001",
            payload={},
            actor="admin",
            request_id="req-d",
        )
        self.assertEqual(process_one(store), "Succeeded")
        self.assertTrue(any(row["transition"] == "dry_run_succeeded" for row in store.audit))

    def test_pause_between_steps(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="midstep01",
            payload={},
            actor="admin",
            request_id="req-m",
        )
        claimed = store.claim()
        assert claimed is not None
        calls = {"n": 0}

        def should_stop() -> str | None:
            calls["n"] += 1
            if calls["n"] == 2:
                store.control(run.id, "pause", actor="admin", request_id="req-m2")
                return "Paused"
            return None

        self.assertEqual(execute_dry_run(claimed, should_stop=should_stop), "Paused")
        self.assertLess(claimed.adapter_index, 10)


class HttpLoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self._store_dir = tempfile.TemporaryDirectory()
        os.environ["PIPELINE_CONTROL_STORE_PATH"] = str(Path(self._store_dir.name) / "store.json")
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control.file_store import FileStore

        api_mod.STORE = FileStore()
        self._queue = tempfile.TemporaryDirectory()
        from backend.pipeline_control import queue as queue_mod

        self._orig_queue = queue_mod.DEFAULT_QUEUE
        queue_mod.DEFAULT_QUEUE = Path(self._queue.name) / "pipeline-queue.jsonl"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        self.server = serve("127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        from backend.pipeline_control import queue as queue_mod
        queue_mod.DEFAULT_QUEUE = self._orig_queue
        self._queue.cleanup()
        self._store_dir.cleanup()
        self.server.shutdown()
        self.server.server_close()

    def _request(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        hdrs = {"Content-Type": "application/json", "X-Request-Id": "http-req-1"}
        if headers:
            hdrs.update(headers)
        conn.request(method, path, body=payload, headers=hdrs)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        echoed = response.getheader("X-Request-Id")
        conn.close()
        return response.status, data, echoed

    def test_health_targets_and_202(self) -> None:
        status, body, _ = self._request("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        status, body, _ = self._request("GET", "/v1/targets")
        self.assertEqual({item["id"] for item in body["targets"]}, {"tzuyang", "meatcreator"})
        self.assertTrue(all(item["status"] == "Idle" for item in body["targets"]))
        status, body, echoed = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpidem01", "X-Actor": "qa"},
        )
        self.assertEqual(status, 202)
        self.assertEqual(body["status"], "Queued")
        self.assertEqual(echoed, "http-req-1")
        replay, replay_body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpidem01", "X-Actor": "qa"},
        )
        self.assertEqual(replay, 202)
        self.assertEqual(replay_body["id"], body["id"])

    def test_privacy_sanitize_on_errors(self) -> None:
        leaked = sanitize_log_value("password=super-secret-value")
        self.assertNotIn("super-secret-value", json.dumps(leaked))


class OverlayAndDocsTests(unittest.TestCase):
    def test_compose_has_no_postgres(self) -> None:
        text = COMPOSE.read_text(encoding="utf-8")
        self.assertNotRegex(text, r"(?im)^\s+postgres:")
        self.assertNotIn("image: postgres", text)
        self.assertIn("supabase_network_local", text)
        self.assertIn("pipeline-api", text)
        self.assertIn("pipeline-worker", text)

    def test_migration_and_allowlist(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("CREATE SCHEMA IF NOT EXISTS pipeline_control", sql)
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertIn('"pipeline_control"', contract)

    def test_heavy_local_mounts(self) -> None:
        ready = heavy_local_runtime_ready(ROOT.parent)
        self.assertTrue(ready["scripts"])
        self.assertTrue(ready["helpers"])

    def test_payload_hash_stable(self) -> None:
        self.assertEqual(payload_hash({"a": 1, "b": 2}), payload_hash({"b": 2, "a": 1}))
    def test_observability_overlay_is_separate_and_has_no_postgres(self) -> None:
        obs = (ROOT / "pipeline-control" / "docker-compose.observability.yml").read_text(encoding="utf-8")
        events = json.loads((ROOT / "pipeline-control" / "events.v1.json").read_text(encoding="utf-8"))
        self.assertNotRegex(obs, r"(?im)^\s+postgres:")
        self.assertIn("tzudong.pipeline.run.lifecycle.v1", events["topics"])
        self.assertEqual(events["structuredSourceOfTruth"], "supabase.pipeline_control")
        dashboard = (
            ROOT.parent
            / "apps"
            / "web"
            / "components"
            / "admin"
            / "pipeline"
            / "AdminPipelineDashboard.tsx"
        ).read_text(encoding="utf-8")
        self.assertNotIn("<iframe", dashboard)
    def test_lite_gha_workflow_has_postgres_service_and_worker(self) -> None:
        workflow = (ROOT.parent / ".github" / "workflows" / "daily-crawler.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("image: postgres:15", workflow)
        self.assertIn("python3 -m backend.pipeline_control.worker", workflow)
        self.assertIn("TZUDONG_COMPUTE_PROFILE: lite_gha", workflow)
        self.assertNotIn("bash backend/run_daily.sh", workflow)


if __name__ == "__main__":
    unittest.main()
