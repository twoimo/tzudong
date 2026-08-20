"""Slice 2 Elasticsearch sink: fail-closed codes, allowlist, compose ownership."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control.adapter import execute_steps
from backend.pipeline_control.es_index import (
    EsIndexError,
    INDICES,
    allowlisted_raw_doc,
    index_document,
)
from backend.pipeline_control.events import KafkaPublishError
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT.parent / ".github" / "workflows"
COMPOSE_DIR = ROOT / "pipeline-control"
CONTRACT = ROOT.parent / "backend" / "DATA_CONTRACTS.md"


def _run() -> RunRecord:
    return RunRecord(
        id="00000000-0000-4000-8000-0000000000e2",
        target="tzuyang",
        profile="heavy_local",
        status="Queued",
        idempotency_key="es01",
        payload_hash="abc",
        actor="qa",
        request_id="req-es1",
        lease_until=1.0,
        heartbeat_at=1.0,
    )


class EsIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        self._orig = {
            key: os.environ.get(key)
            for key in (
                "TZUDONG_PIPELINE_ES",
                "TZUDONG_ES_URL",
                "TZUDONG_DATA_ENV",
                "TZUDONG_PIPELINE_EVENTS",
            )
        }
        self._orig_load = es_mod._load_es_client

    def tearDown(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        es_mod._load_es_client = self._orig_load
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_default_is_noop_and_does_not_load_client(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ.pop("TZUDONG_PIPELINE_ES", None)
        loads = {"n": 0}

        def boom() -> object:
            loads["n"] += 1
            raise ImportError("es")

        es_mod._load_es_client = boom  # type: ignore[method-assign]
        self.assertEqual(
            index_document({"type": "run.lifecycle", "job_id": "j1", "status": "Succeeded"}),
            "noop:pipeline-logs-v1",
        )
        self.assertEqual(loads["n"], 0)

    def test_typo_mode_is_invalid(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "elastic"
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_mode_invalid")

    def test_missing_and_unknown_class_fail_closed(self) -> None:
        os.environ.pop("TZUDONG_PIPELINE_ES", None)
        with self.assertRaises(EsIndexError) as ctx:
            index_document({})
        self.assertEqual(ctx.exception.code, "es_document_class_unknown")
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "not.a.class"})
        self.assertEqual(ctx.exception.code, "es_document_class_unknown")

    def test_es_missing_url(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("TZUDONG_ES_URL", None)
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_url_required")

    def test_es_remote_host_rejected(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://es.example.com:9200"
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_es_non_local_db_rejected(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "hosting_db"
        os.environ["TZUDONG_ES_URL"] = "http://elasticsearch:9200"
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_es_scheme_invalid(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "ftp://127.0.0.1:9200"
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_url_invalid")

    def test_es_userinfo_trick_rejected(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://elasticsearch@evil.example:9200"
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_url_host_rejected")

    def test_es_client_missing(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"

        def missing() -> object:
            raise ImportError("no-es")

        es_mod._load_es_client = missing  # type: ignore[method-assign]
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_client_missing")

    def test_injected_redirect_fails_closed(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"

        class RedirectClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def index(self, *_args: object, **_kwargs: object) -> int:
                return 302

        es_mod._load_es_client = lambda: RedirectClient  # type: ignore[method-assign]
        with self.assertRaises(EsIndexError) as ctx:
            index_document({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "es_index_failed")

    def test_injected_client_receives_both_classes(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"
        sent: list[tuple[str, dict]] = []

        class FakeClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def index(self, index: str, document: dict) -> None:
                sent.append((index, document))

        es_mod._load_es_client = lambda: FakeClient  # type: ignore[method-assign]
        self.assertEqual(
            index_document(
                {
                    "type": "step.progress",
                    "job_id": "j1",
                    "step": "01-collect-urls",
                    "dsn": "postgresql://x",
                    "password": "super-secret-value",
                }
            ),
            "es:pipeline-logs-v1",
        )
        self.assertEqual(
            index_document(
                {
                    "type": "adapter.raw",
                    "job_id": "j1",
                    "step": "01-collect-urls",
                    "status": "ok",
                    "skipped": False,
                    "request_id": "req",
                    "payload_hash": "abc",
                    "byte_size": 99,
                    "sha256": "deadbeef",
                    "origin_name": "비밀식당",
                }
            ),
            "es:pipeline-raw-v1",
        )
        self.assertEqual(sent[0][0], "pipeline-logs-v1")
        self.assertEqual(sent[1][0], "pipeline-raw-v1")
        self.assertNotIn("super-secret-value", str(sent[0][1]))
        self.assertNotIn("dsn", sent[0][1])
        self.assertNotIn("byte_size", sent[1][1])
        self.assertNotIn("sha256", sent[1][1])
        self.assertNotIn("origin_name", sent[1][1])
        raw = allowlisted_raw_doc({"type": "adapter.raw", "byte_size": 1, "sha256": "x"})
        self.assertNotIn("byte_size", raw)
        self.assertNotIn("sha256", raw)

    def test_raw_bypass_does_not_publish_and_default_run_succeeds(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ.pop("TZUDONG_PIPELINE_ES", None)
        os.environ.pop("TZUDONG_PIPELINE_EVENTS", None)
        indexed: list[dict] = []
        orig = es_mod.index_document

        def capture(document: dict) -> str:
            indexed.append(document)
            return orig(document)

        es_mod.index_document = capture  # type: ignore[method-assign]
        try:
            from backend.pipeline_control import adapter as adapter_mod

            adapter_mod.index_document = capture  # type: ignore[method-assign]
            store = MemoryStore()
            created, _ = store.create_run(
                target="tzuyang",
                profile="heavy_local",
                idempotency_key="es-raw-bypass-1",
                payload={"dryRun": True},
                actor="qa",
                request_id="req-erb",
                dry_run=True,
            )
            with tempfile.TemporaryDirectory() as tmp:
                dest = Path(tmp) / "current-summary.json"
                try:
                    result = process_one(store, live=False, manifest_path=dest)
                except KafkaPublishError:
                    self.fail("raw document must not flow through events.publish")
                self.assertEqual(result, "Succeeded")
                self.assertEqual(store.get(created.id).status, "Succeeded")
            raw_docs = [doc for doc in indexed if doc.get("type") == "adapter.raw"]
            log_docs = [doc for doc in indexed if doc.get("type") in {"run.lifecycle", "step.progress"}]
            self.assertTrue(raw_docs)
            self.assertTrue(log_docs)
            self.assertTrue(all(doc.get("type") != "adapter.raw" or "byte_size" not in doc for doc in raw_docs))
        finally:
            es_mod.index_document = orig
            from backend.pipeline_control import adapter as adapter_mod

            adapter_mod.index_document = orig

    def test_es_index_error_finishes_failed_as_sole_authority(self) -> None:
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("TZUDONG_ES_URL", None)
        store = MemoryStore()
        created, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="es-worker-1",
            payload={"dryRun": True},
            actor="qa",
            request_id="req-ew",
            dry_run=True,
        )
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "current-summary.json"
            result = process_one(store, live=False, manifest_path=dest)
            self.assertEqual(result, "Failed")
            row = store.get(created.id)
            self.assertEqual(row.status, "Failed")
            self.assertEqual(row.error_code, "es_url_required")
            self.assertNotIn(f"{row.target}:{row.profile}", store.locks)
            self.assertTrue(dest.is_file())

    def test_gha_does_not_set_es_env_keys(self) -> None:
        for path in WORKFLOWS.glob("*.yml"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"(?m)^\s+TZUDONG_PIPELINE_ES\s*:", msg=path.name)
            self.assertNotRegex(text, r"(?m)^\s+TZUDONG_ES_URL\s*:", msg=path.name)

    def test_elasticsearch_fragment_owns_service(self) -> None:
        ymls = list(COMPOSE_DIR.glob("*.yml"))
        owners = []
        for path in ymls:
            text = path.read_text(encoding="utf-8")
            if __import__("re").search(r"(?m)^\s+elasticsearch:", text):
                owners.append(path.name)
        self.assertEqual(owners, ["docker-compose.elasticsearch.yml"])
        es = (COMPOSE_DIR / "docker-compose.elasticsearch.yml").read_text(encoding="utf-8")
        obs = (COMPOSE_DIR / "docker-compose.observability.yml").read_text(encoding="utf-8")
        pipeline = (COMPOSE_DIR / "docker-compose.pipeline.yml").read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertNotRegex(es, r"(?im)^\s+postgres:")
        self.assertNotRegex(es, r"(?m)^\s+grafana:")
        self.assertNotRegex(es, r"(?m)^\s+otel-collector:")
        self.assertNotRegex(es, r"(?m)^\s+prometheus:")
        self.assertNotRegex(es, r"(?m)^\s+kafka:")
        self.assertIn("127.0.0.1:9200", es)
        self.assertIn("TZUDONG_LOCAL_SUPABASE_NETWORK", es)
        self.assertNotRegex(obs, r"(?m)^\s+elasticsearch:")
        self.assertNotRegex(pipeline, r"(?im)^\s+postgres:")
        self.assertIn("non-authoritative", contract)
        self.assertNotIn("later Slice 2 ES ingest", contract)
        self.assertIn("deterministic document IDs", contract)


    def test_record_upserted_uses_logs_index(self) -> None:
        self.assertEqual(INDICES["record.upserted"], "pipeline-logs-v1")
        self.assertEqual(
            index_document({"type": "record.upserted", "job_id": "j1", "status": "Succeeded"}),
            "noop:pipeline-logs-v1",
        )

    def test_injected_client_indexes_upsert_on_logs_not_raw(self) -> None:
        from backend.pipeline_control import adapter as adapter_mod
        from backend.pipeline_control import es_index as es_mod

        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"
        sent: list[tuple[str, dict]] = []

        class FakeClient:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def index(self, index: str, document: dict) -> None:
                sent.append((index, document))

        es_mod._load_es_client = lambda: FakeClient  # type: ignore[method-assign]
        result = execute_steps(
            _run(),
            should_stop=lambda: None,
            emit=adapter_mod.noop_event_sink,
            live=True,
            runner=lambda _argv: 0,
        )
        self.assertEqual(result, "Succeeded")
        upserts = [(index, doc) for index, doc in sent if doc.get("type") == "record.upserted"]
        self.assertEqual(len(upserts), 1)
        self.assertEqual(upserts[0][0], "pipeline-logs-v1")
        self.assertNotEqual(upserts[0][0], "pipeline-raw-v1")
        self.assertTrue(all(index != "pipeline-raw-v1" or doc.get("type") == "adapter.raw" for index, doc in sent))

    def test_record_upserted_index_failure_fail_closes_job(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"

        class SelectiveBoom:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                pass

            def index(self, _index: str, document: dict) -> None:
                if document.get("type") == "record.upserted":
                    raise EsIndexError("es_index_failed")

        es_mod._load_es_client = lambda: SelectiveBoom  # type: ignore[method-assign]
        store = MemoryStore()
        created, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="es-upsert-fail",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-esuf",
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "current-summary.json"
            result = process_one(store, live=True, runner=lambda _argv: 0, manifest_path=dest)
            self.assertEqual(result, "Failed")
            self.assertEqual(store.get(created.id).status, "Failed")
            self.assertEqual(store.get(created.id).error_code, "es_index_failed")


if __name__ == "__main__":
    unittest.main()
