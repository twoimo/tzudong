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
        self._orig_env = {
            key: os.environ.get(key)
            for key in (
                "PIPELINE_CONTROL_STORE_PATH",
                "TZUDONG_DATA_ENV",
                "PIPELINE_CONTROL_DSN",
                "TZUDONG_PIPELINE_PERSIST",
            )
        }
        self._store_dir = tempfile.TemporaryDirectory()
        os.environ["PIPELINE_CONTROL_STORE_PATH"] = str(Path(self._store_dir.name) / "store.json")
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control.file_store import FileStore

        self._orig_store = api_mod.STORE
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
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control import queue as queue_mod

        queue_mod.DEFAULT_QUEUE = self._orig_queue
        api_mod.STORE = self._orig_store
        for key, value in self._orig_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
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
    def test_setup_snapshots_store_path_before_mutation(self) -> None:
        current = os.environ.get("PIPELINE_CONTROL_STORE_PATH")
        self.assertIsNotNone(current)
        self.assertNotEqual(current, self._orig_env["PIPELINE_CONTROL_STORE_PATH"])
        self.assertTrue(str(current).startswith(self._store_dir.name))
    def test_persist_misconfig_returns_bounded_json(self) -> None:
        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ.pop("PIPELINE_CONTROL_DSN", None)
        status, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httppersist1", "X-Actor": "qa"},
        )
        self.assertEqual(status, 503)
        self.assertEqual(body, {"error": "persist_dsn_required"})


    def test_get_targets_overlays_enqueued_job(self) -> None:
        status, empty, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        self.assertEqual(empty.get("jobs"), [])
        self.assertEqual(empty.get("failures"), [])
        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpoverlay1", "X-Actor": "qa"},
        )
        self.assertEqual(post, 202)
        status, snap, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        tzuyang = next(item for item in snap["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Queued")
        self.assertEqual(len(snap["jobs"]), 1)
        self.assertEqual(snap["jobs"][0]["id"], body["id"])
        missing, miss_body, _ = self._request("GET", "/v1/runs")
        self.assertEqual(missing, 404)
        self.assertEqual(miss_body["error"], "not_found")

    def test_get_targets_does_not_reclaim_when_persist_on(self) -> None:
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control.file_store import FileStore

        now = {"t": 1_000.0}
        path = Path(os.environ["PIPELINE_CONTROL_STORE_PATH"])
        store = FileStore(path=path, clock=lambda: now["t"])
        api_mod.STORE = store
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="httpleas11",
            payload={},
            actor="qa",
            request_id="req-lease",
        )
        claimed = store.claim()
        assert claimed is not None
        self.assertEqual(store.get(run.id).status, "Fetching")
        now["t"] = 10_000.0
        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ.pop("PIPELINE_CONTROL_DSN", None)
        status, body, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        tzuyang = next(item for item in body["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Idle")
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(raw["runs"][run.id]["status"], "Fetching")
        self.assertNotEqual(raw["runs"][run.id].get("error_code"), "lease_expired")
        self.assertNotEqual(raw["runs"][run.id]["status"], "Failed")
    def test_get_targets_persist_on_with_local_dsn_does_not_connect(self) -> None:
        from backend.pipeline_control import api as api_mod
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.file_store import FileStore

        now = {"t": 1_000.0}
        path = Path(os.environ["PIPELINE_CONTROL_STORE_PATH"])
        store = FileStore(path=path, clock=lambda: now["t"])
        api_mod.STORE = store
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="getpersist1",
            payload={},
            actor="qa",
            request_id="req-gp",
        )
        store.claim()
        now["t"] = 10_000.0
        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        connects: list[str] = []
        statements: list[str] = []

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def execute(self, sql: str, params: tuple) -> None:
                statements.append(sql)

        class FakeConn:
            def cursor(self):
                return FakeCursor()

            def commit(self) -> None:
                return None

            def close(self) -> None:
                return None

        class FakePsycopg2:
            @staticmethod
            def connect(dsn: str) -> FakeConn:
                connects.append(dsn)
                return FakeConn()

        persist_mod._load_psycopg2 = lambda: FakePsycopg2()  # type: ignore[method-assign]
        status, body, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        tzuyang = next(item for item in body["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Idle")
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(raw["runs"][run.id]["status"], "Fetching")
        self.assertEqual(connects, [])
        self.assertEqual(statements, [])




    def test_post_enqueue_omitted_dry_run_stores_true(self) -> None:
        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local"},
            {"Idempotency-Key": "httpenqomit1", "X-Actor": "qa"},
        )
        self.assertEqual(post, 202)
        path = Path(os.environ["PIPELINE_CONTROL_STORE_PATH"])
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.assertTrue(raw["runs"][body["id"]]["dry_run"])

    def test_post_enqueue_dry_run_overlays_allowlisted_queued_job(self) -> None:
        from backend.pipeline_control.store import PUBLIC_LIST_KEYS

        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpenqdry01", "X-Actor": "qa"},
        )
        self.assertEqual(post, 202)
        status, snap, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        tzuyang = next(item for item in snap["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Queued")
        self.assertEqual(len(snap["jobs"]), 1)
        job = snap["jobs"][0]
        self.assertEqual(job["id"], body["id"])
        self.assertTrue(job["dry_run"])
        self.assertTrue(set(job).issubset(set(PUBLIC_LIST_KEYS)))
        missing, miss_body, _ = self._request("GET", "/v1/runs")
        self.assertEqual(missing, 404)
        self.assertEqual(miss_body["error"], "not_found")

    def test_post_pause_resume_cancel_file_store_cycle(self) -> None:
        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpcycle0001", "X-Actor": "qa"},
        )
        self.assertEqual(post, 202)
        run_id = body["id"]
        pause, paused, _ = self._request("POST", f"/v1/runs/{run_id}/pause")
        self.assertEqual(pause, 200)
        self.assertEqual(paused["status"], "Paused")
        status, snap, _ = self._request("GET", "/v1/targets")
        self.assertEqual(status, 200)
        tzuyang = next(item for item in snap["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Paused")
        self.assertEqual(snap["jobs"][0]["id"], run_id)
        self.assertEqual(snap["jobs"][0]["status"], "Paused")
        resume, resumed, _ = self._request("POST", f"/v1/runs/{run_id}/resume")
        self.assertEqual(resume, 200)
        self.assertEqual(resumed["status"], "Queued")
        status, snap, _ = self._request("GET", "/v1/targets")
        tzuyang = next(item for item in snap["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Queued")
        cancel, cancelled, _ = self._request("POST", f"/v1/runs/{run_id}/cancel")
        self.assertEqual(cancel, 200)
        self.assertEqual(cancelled["status"], "Cancelled")
        status, snap, _ = self._request("GET", "/v1/targets")
        tzuyang = next(item for item in snap["targets"] if item["id"] == "tzuyang")
        self.assertEqual(tzuyang["status"], "Idle")
        self.assertEqual(snap["jobs"], [])

    def test_post_hosted_dsn_rejected_on_enqueue(self) -> None:
        os.environ["PIPELINE_CONTROL_DSN"] = (
            "postgresql://postgres.aqlcofblfxdrjhhdmarw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
        )
        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httphosted01", "X-Actor": "qa"},
        )
        self.assertEqual(post, 403)
        self.assertEqual(body["error"], "hosted_dsn_rejected")

    def test_illegal_pause_on_cancelled_returns_409(self) -> None:
        post, body, _ = self._request(
            "POST",
            "/v1/runs",
            {"target": "tzuyang", "profile": "heavy_local", "dryRun": True},
            {"Idempotency-Key": "httpillegal01", "X-Actor": "qa"},
        )
        self.assertEqual(post, 202)
        run_id = body["id"]
        cancel, cancelled, _ = self._request("POST", f"/v1/runs/{run_id}/cancel")
        self.assertEqual(cancel, 200)
        self.assertEqual(cancelled["status"], "Cancelled")
        pause, paused, _ = self._request("POST", f"/v1/runs/{run_id}/pause")
        self.assertEqual(pause, 409)
        self.assertEqual(paused["error"], "illegal_transition")


class OverlayAndDocsTests(unittest.TestCase):
    def test_compose_has_no_postgres(self) -> None:
        text = COMPOSE.read_text(encoding="utf-8")
        self.assertNotRegex(text, r"(?im)^\s+postgres:")
        self.assertNotIn("image: postgres", text)
        self.assertIn("supabase_network_local", text)
        self.assertIn("pipeline-api", text)
        self.assertIn("pipeline-worker", text)
        self.assertNotIn("TZUDONG_PIPELINE_PERSIST", text)
        workflow = (ROOT.parent / ".github" / "workflows" / "daily-crawler.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("TZUDONG_PIPELINE_PERSIST", workflow)

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
        kafka = (ROOT / "pipeline-control" / "docker-compose.kafka.yml").read_text(encoding="utf-8")
        events = json.loads((ROOT / "pipeline-control" / "events.v1.json").read_text(encoding="utf-8"))
        self.assertNotRegex(obs, r"(?im)^\s+postgres:")
        self.assertNotRegex(obs, r"(?m)^\s+kafka:")
        self.assertRegex(kafka, r"(?m)^\s+kafka:")
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
        self.assertIn("127.0.0.1:3001:3000", obs)
        self.assertIn('GF_AUTH_ANONYMOUS_ENABLED: "false"', obs)
        self.assertIn('GF_USERS_ALLOW_SIGN_UP: "false"', obs)
        self.assertIn('GF_SECURITY_ALLOW_EMBEDDING: "false"', obs)
        self.assertIn('GF_SECURITY_CONTENT_SECURITY_POLICY: "true"', obs)
        self.assertIn('GF_SECURITY_COOKIE_SAMESITE: "strict"', obs)
        self.assertIn("${GRAFANA_ADMIN_PASSWORD:?", obs)
        self.assertNotRegex(obs, r"(?i)GF_SECURITY_ADMIN_PASSWORD:\s*['\"]?(admin|password|changeme)")
        self.assertNotIn("TZUDONG_PIPELINE_PERSIST", obs)

    def test_lite_gha_workflow_has_postgres_service_and_worker(self) -> None:
        workflow = (ROOT.parent / ".github" / "workflows" / "daily-crawler.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("image: postgres:15", workflow)
        self.assertIn("python3 -m backend.pipeline_control.worker", workflow)
        self.assertIn("TZUDONG_COMPUTE_PROFILE: lite_gha", workflow)
        self.assertNotIn("bash backend/run_daily.sh", workflow)


class PersistSoTTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.pipeline_control import persist as persist_mod

        self._orig = {
            key: os.environ.get(key)
            for key in ("TZUDONG_PIPELINE_PERSIST", "PIPELINE_CONTROL_DSN", "TZUDONG_DATA_ENV")
        }
        self._orig_load = persist_mod._load_psycopg2

    def tearDown(self) -> None:
        from backend.pipeline_control import persist as persist_mod

        persist_mod._load_psycopg2 = self._orig_load
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_default_persist_is_off(self) -> None:
        from backend.pipeline_control import persist as persist_mod

        os.environ.pop("TZUDONG_PIPELINE_PERSIST", None)
        self.assertFalse(persist_mod.persist_enabled())

    def test_enabled_without_psycopg2_fails_closed(self) -> None:
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.state_machine import RunRecord

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"

        def missing() -> object:
            raise ImportError("no-psycopg2")

        persist_mod._load_psycopg2 = missing  # type: ignore[method-assign]
        run = RunRecord(
            id="00000000-0000-4000-8000-000000000001",
            target="tzuyang",
            profile="heavy_local",
            status="Queued",
            idempotency_key="persist01",
            payload_hash="abc",
            actor="qa",
            request_id="req-p1",
            lease_until=1.0,
            heartbeat_at=1.0,
        )
        with self.assertRaises(persist_mod.PersistError) as ctx:
            persist_mod.persist_mutation(
                run,
                lock_held=True,
                lock_key="tzuyang:heavy_local",
                audit=None,
            )
        self.assertEqual(ctx.exception.code, "psycopg2_missing")
    def test_enabled_without_dsn_fails_closed(self) -> None:
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.state_machine import RunRecord

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("PIPELINE_CONTROL_DSN", None)
        loads = {"n": 0}

        def missing() -> object:
            loads["n"] += 1
            raise ImportError("no-psycopg2")

        persist_mod._load_psycopg2 = missing  # type: ignore[method-assign]
        run = RunRecord(
            id="00000000-0000-4000-8000-00000000000d",
            target="tzuyang",
            profile="heavy_local",
            status="Queued",
            idempotency_key="persist0d",
            payload_hash="abc",
            actor="qa",
            request_id="req-pd",
            lease_until=1.0,
            heartbeat_at=1.0,
        )
        with self.assertRaises(persist_mod.PersistError) as ctx:
            persist_mod.persist_mutation(
                run,
                lock_held=True,
                lock_key="tzuyang:heavy_local",
                audit=None,
            )
        self.assertEqual(ctx.exception.code, "persist_dsn_required")
        self.assertEqual(loads["n"], 0)

    def test_enabled_hosted_dsn_rejected(self) -> None:
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.state_machine import RunRecord

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = (
            "postgresql://postgres.aqlcofblfxdrjhhdmarw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
        )
        run = RunRecord(
            id="00000000-0000-4000-8000-000000000002",
            target="tzuyang",
            profile="heavy_local",
            status="Queued",
            idempotency_key="persist02",
            payload_hash="abc",
            actor="qa",
            request_id="req-p2",
            lease_until=1.0,
            heartbeat_at=1.0,
        )
        with self.assertRaises(dsn_guard.DsnGuardError) as ctx:
            persist_mod.persist_mutation(
                run,
                lock_held=True,
                lock_key="tzuyang:heavy_local",
                audit=None,
            )
        self.assertEqual(ctx.exception.code, "hosted_dsn_rejected")

    def test_enabled_hosted_dsn_rejected_even_for_hosting_db(self) -> None:
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.state_machine import RunRecord

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "hosting_db"
        os.environ["PIPELINE_CONTROL_DSN"] = (
            "postgresql://postgres.aqlcofblfxdrjhhdmarw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres"
        )
        run = RunRecord(
            id="00000000-0000-4000-8000-000000000002",
            target="tzuyang",
            profile="heavy_local",
            status="Queued",
            idempotency_key="persist02",
            payload_hash="abc",
            actor="qa",
            request_id="req-p2",
            lease_until=1.0,
            heartbeat_at=1.0,
        )
        with self.assertRaises(dsn_guard.DsnGuardError) as ctx:
            persist_mod.persist_mutation(
                run,
                lock_held=True,
                lock_key="tzuyang:heavy_local",
                audit=None,
            )
        self.assertEqual(ctx.exception.code, "hosted_dsn_rejected")

    def test_local_upsert_does_not_use_hosted_dsn(self) -> None:
        from backend.pipeline_control import persist as persist_mod

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        seen: list[str] = []
        statements: list[str] = []

        class FakeCursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc: object) -> None:
                return None

            def execute(self, sql: str, params: tuple) -> None:
                statements.append(sql)
                self.params = params

        class FakeConn:
            def cursor(self):
                return FakeCursor()

            def commit(self) -> None:
                return None

            def close(self) -> None:
                return None

        class FakePsycopg2:
            @staticmethod
            def connect(dsn: str) -> FakeConn:
                seen.append(dsn)
                self.assertNotIn("aqlcofblfxdrjhhdmarw", dsn)
                return FakeConn()

        persist_mod._load_psycopg2 = lambda: FakePsycopg2()  # type: ignore[method-assign]
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="persist03",
            payload={},
            actor="qa",
            request_id="req-p3",
        )
        self.assertEqual(seen, ["postgresql://tzudong@127.0.0.1:54322/postgres"])
        joined = "\n".join(statements)
        self.assertIn("INSERT INTO pipeline_control.jobs", joined)
        self.assertIn("INSERT INTO pipeline_control.locks", joined)
        self.assertIn("INSERT INTO pipeline_control.audit", joined)
        claimed = store.claim()
        self.assertIsNotNone(claimed)
        statements.clear()
        store.beat(claimed.id)
        beat_sql = "\n".join(statements)
        self.assertIn("INSERT INTO pipeline_control.jobs", beat_sql)
        self.assertIn("INSERT INTO pipeline_control.locks", beat_sql)
        self.assertNotIn("INSERT INTO pipeline_control.audit", beat_sql)
        statements.clear()
        store.finish_dry_run(claimed.id)
        finish_sql = "\n".join(statements)
        self.assertIn("DELETE FROM pipeline_control.locks", finish_sql)
        self.assertIn("INSERT INTO pipeline_control.audit", finish_sql)

    def test_enabled_empty_lock_key_fails_closed(self) -> None:
        from backend.pipeline_control import persist as persist_mod
        from backend.pipeline_control.state_machine import RunRecord

        os.environ["TZUDONG_PIPELINE_PERSIST"] = "1"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["PIPELINE_CONTROL_DSN"] = "postgresql://tzudong@127.0.0.1:54322/postgres"
        loads = {"n": 0}

        def missing() -> object:
            loads["n"] += 1
            raise ImportError("psycopg2")

        persist_mod._load_psycopg2 = missing  # type: ignore[method-assign]
        run = RunRecord(
            id="00000000-0000-4000-8000-00000000000e",
            target="tzuyang",
            profile="heavy_local",
            status="Queued",
            idempotency_key="persist04",
            payload_hash="abc",
            actor="qa",
            request_id="req-p4",
            lease_until=1.0,
            heartbeat_at=1.0,
        )
        with self.assertRaises(persist_mod.PersistError) as ctx:
            persist_mod.persist_mutation(
                run,
                lock_held=True,
                lock_key="   ",
                audit=None,
            )
        self.assertEqual(ctx.exception.code, "persist_lock_key_required")
        self.assertEqual(loads["n"], 0)

class OperatorSnapshotTests(unittest.TestCase):
    FORBIDDEN = {
        "actor",
        "payload_hash",
        "events",
        "idempotency_key",
        "request_id",
        "lease_until",
        "heartbeat_at",
    }

    def _status(self, snap: dict, target: str) -> str:
        return next(item["status"] for item in snap["targets"] if item["id"] == target)

    def _allowlisted(self, rows: list[dict]) -> None:
        from backend.pipeline_control.store import PUBLIC_LIST_KEYS

        for row in rows:
            self.assertEqual(set(row), set(PUBLIC_LIST_KEYS))
            for key in self.FORBIDDEN:
                self.assertNotIn(key, row)

    def test_overlay_live_queued(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapq0001",
            payload={},
            actor="admin",
            request_id="req-q",
        )
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Queued")
        self.assertEqual(self._status(snap, "meatcreator"), "Idle")
        self.assertEqual(len(snap["jobs"]), 1)
        self._allowlisted(snap["jobs"])

    def test_overlay_claim_fetching(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapf0001",
            payload={},
            actor="admin",
            request_id="req-f",
        )
        store.claim()
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Fetching")

    def test_overlay_pause_holds(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapp0001",
            payload={},
            actor="admin",
            request_id="req-p",
        )
        store.control(run.id, "pause", actor="admin", request_id="req-p2")
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Paused")
        self.assertEqual(len(snap["jobs"]), 1)

    def test_overlay_idle_after_success_and_fail(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        ok, _ = store.create_run(
            target="meatcreator",
            profile="lite_gha",
            idempotency_key="snaps0001",
            payload={},
            actor="admin",
            request_id="req-ok",
        )
        store.finish_dry_run(ok.id)
        failed, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapx0001",
            payload={},
            actor="admin",
            request_id="req-x",
        )
        store.finish_failed(failed.id, "adapter_failed")
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Idle")
        self.assertEqual(self._status(snap, "meatcreator"), "Idle")
        self.assertEqual(len(snap["failures"]), 1)
        self.assertEqual(snap["failures"][0]["error_code"], "adapter_failed")
        self.assertEqual(snap["failures"][0]["id"], failed.id)
        self._allowlisted(snap["failures"])

    def test_stale_missing_holder_and_unadmitted_lock(self) -> None:
        now = {"t": 1_000.0}
        store = MemoryStore(clock=lambda: now["t"])
        ghost, _ = store.create_run(
            target="ghost",
            profile="heavy_local",
            idempotency_key="snapghost1",
            payload={},
            actor="admin",
            request_id="req-g",
        )
        store.finish_failed(ghost.id, "gone")
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapstale1",
            payload={},
            actor="admin",
            request_id="req-st",
        )
        store.claim()
        now["t"] = 10_000.0
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Idle")
        self.assertEqual(store.get(run.id).status, "Fetching")
        self.assertEqual(snap["jobs"], [])
        self.assertFalse(any(row["id"] == run.id for row in snap["failures"]))
        self.assertNotIn("ghost", {item["id"] for item in snap["targets"]})
        self.assertFalse(any(row["target"] == "ghost" for row in snap["jobs"]))
        self.assertFalse(any(row["target"] == "ghost" for row in snap["failures"]))
        store.locks["tzuyang:lite_gha"] = "missing-holder"
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Idle")
        self.assertFalse(any(row["id"] == "missing-holder" for row in snap["jobs"]))

    def test_dual_profile_rank(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        heavy, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapdual01",
            payload={},
            actor="admin",
            request_id="req-dh",
        )
        lite, _ = store.create_run(
            target="tzuyang",
            profile="lite_gha",
            idempotency_key="snapdual02",
            payload={},
            actor="admin",
            request_id="req-dl",
        )
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Queued")
        heavy.status = "Fetching"
        lite.status = "Inserting"
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Inserting")
        heavy.status = "Fetching"
        lite.status = "Fetching"
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(self._status(snap, "tzuyang"), "Fetching")
        self.assertEqual(len(snap["jobs"]), 2)

    def test_allowlist_keys(self) -> None:
        store = MemoryStore(clock=lambda: 1_000.0)
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="snapkeys01",
            payload={},
            actor="admin@example.com",
            request_id="req-k",
        )
        snap = store.operator_snapshot(load_targets())
        self.assertTrue(snap["jobs"])
        self._allowlisted(snap["jobs"])
        store.finish_failed(run.id, "boom")
        snap = store.operator_snapshot(load_targets())
        self.assertTrue(snap["failures"])
        self._allowlisted(snap["failures"])

    def test_failure_cap_keeps_newest(self) -> None:
        from backend.pipeline_control.store import OPERATOR_FAILURE_CAP

        now = {"t": 1_000.0}
        store = MemoryStore(clock=lambda: now["t"])
        ids: list[str] = []
        for index in range(25):
            now["t"] += 1
            run, _ = store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key=f"snapcap{index:05d}",
                payload={"n": index},
                actor="admin",
                request_id=f"req-c{index}",
            )
            store.finish_failed(run.id, f"e{index}")
            ids.append(run.id)
        snap = store.operator_snapshot(load_targets())
        self.assertEqual(len(snap["failures"]), OPERATOR_FAILURE_CAP)
        self.assertEqual([row["id"] for row in snap["failures"]], list(reversed(ids[-20:])))

    def test_filestore_reload_same_path(self) -> None:
        from backend.pipeline_control.file_store import FileStore

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "store.json"
            writer = FileStore(path=path, clock=lambda: 1_000.0)
            writer.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="snapfile01",
                payload={},
                actor="admin",
                request_id="req-file",
            )
            reader = FileStore(path=path, clock=lambda: 1_000.0)
            snap = reader.operator_snapshot(load_targets())
            self.assertEqual(self._status(snap, "tzuyang"), "Queued")



if __name__ == "__main__":
    unittest.main()
