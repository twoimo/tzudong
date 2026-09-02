"""P6 transactional outbox, Kafka publisher/consumer, ES bulk, live gauges."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from backend.pipeline_control.es_index import (
    CONSUMER_GROUP,
    consume_once,
    document_id,
    index_bulk,
)
from backend.pipeline_control.events import publish
from backend.pipeline_control.metrics import (
    GAUGES,
    MetricsError,
    gauge_snapshot,
    observe,
    observe_process,
    record,
    reset_for_tests,
)
from backend.pipeline_control.outbox import (
    classify_outbox_mode,
    enqueue_event,
    event_id,
    reset_memory,
    unpublished_snapshot,
)
from backend.pipeline_control.publisher import drain_once

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260820050000_pipeline_outbox.sql"
BATCH = ROOT / "supabase" / "migrations" / "20260820040000_pipeline_batch_upsert.sql"
ATOMIC = ROOT / "supabase" / "migrations" / "20260820030000_pipeline_control_atomic.sql"
CONTRACTS = ROOT / "DATA_CONTRACTS.md"
COMPOSE = ROOT / "deploy" / "pipeline-control" / "docker-compose.pipeline.yml"
EVENTS_CATALOG = ROOT / "deploy" / "pipeline-control" / "events.v1.json"


class OutboxSqlContractTests(unittest.TestCase):
    def test_follow_on_keeps_prior_pipeline_migrations(self) -> None:
        self.assertTrue(ATOMIC.exists())
        self.assertTrue(BATCH.exists())
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("Do not edit prior pipeline_control migrations", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS pipeline_control.outbox", sql)
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("pipeline_control.enqueue_outbox", sql)
        self.assertIn("pipeline_control.claim_outbox", sql)
        self.assertIn("pipeline_control.ack_outbox", sql)
        self.assertIn("REVOKE ALL ON TABLE pipeline_control.outbox", sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", sql)
        self.assertNotIn(
            "GRANT EXECUTE ON FUNCTION pipeline_control.enqueue_outbox",
            sql,
        )
        self.assertIn("privacy_retention.assert_g014_public_rpc_allowlist()", sql)

    def test_contract_row(self) -> None:
        text = CONTRACTS.read_text(encoding="utf-8")
        self.assertIn("pipeline_control transactional outbox", text)
        self.assertIn("unpublished outbox rows survive broker outage", text)
        self.assertIn("deterministic document IDs so replay duplicates stay 0", text)
        self.assertIn("pipeline-indexer", text)
        compose = COMPOSE.read_text(encoding="utf-8")
        self.assertIn("pipeline-publisher", compose)
        self.assertIn("backend.pipeline_control.publisher", compose)
        self.assertIn("TZUDONG_KAFKA_BOOTSTRAP: kafka:9092", compose)
        catalog = json.loads(EVENTS_CATALOG.read_text(encoding="utf-8"))
        self.assertIn("pipeline-indexer consumer group bulk API", catalog["elasticsearchWriter"])


class MemoryOutboxTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig = {
            key: os.environ.get(key)
            for key in (
                "TZUDONG_PIPELINE_OUTBOX",
                "TZUDONG_PIPELINE_EVENTS",
                "TZUDONG_PIPELINE_STORE",
                "TZUDONG_KAFKA_BOOTSTRAP",
                "TZUDONG_DATA_ENV",
                "TZUDONG_PIPELINE_ES",
                "TZUDONG_ES_URL",
            )
        }
        os.environ["TZUDONG_PIPELINE_OUTBOX"] = "memory"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        reset_memory()
        reset_for_tests()

    def tearDown(self) -> None:
        reset_memory()
        reset_for_tests()
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_publish_writes_outbox_not_kafka(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"
        result = publish({"type": "run.lifecycle", "job_id": "j1", "status": "Succeeded"})
        self.assertEqual(result, "outbox:tzudong.pipeline.run.lifecycle.v1")
        rows = unpublished_snapshot()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_id"], event_id(rows[0]["payload"]))

    def test_idempotent_event_id(self) -> None:
        event = {"type": "step.progress", "job_id": "j1", "step": "01-collect-urls", "index": 0}
        first = enqueue_event(event)
        second = enqueue_event(event)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["event_id"], second["event_id"])
        self.assertEqual(len(unpublished_snapshot()), 1)

    def test_broker_failure_preserves_outbox(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"
        enqueue_event({"type": "run.lifecycle", "job_id": "j1", "status": "Failed"})

        def boom(_topic: str, _payload: bytes) -> None:
            raise RuntimeError("broker_down")

        self.assertEqual(drain_once(send=boom), 0)
        self.assertEqual(len(unpublished_snapshot()), 1)

    def test_publisher_acks_after_send(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"
        enqueue_event({"type": "record.upserted", "job_id": "j1", "status": "Succeeded", "step": "13-supabase-insert"})
        sent: list[tuple[str, bytes]] = []

        def capture(topic: str, payload: bytes) -> None:
            sent.append((topic, payload))

        self.assertEqual(drain_once(send=capture), 1)
        self.assertEqual(sent[0][0], "tzudong.pipeline.record.upserted.v1")
        self.assertEqual(unpublished_snapshot(), [])

    def test_retry_after_stale_claim(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"
        enqueue_event({"type": "run.lifecycle", "job_id": "j2", "status": "Succeeded"})
        from backend.pipeline_control import outbox as outbox_mod

        original = outbox_mod.CLAIM_STALE_SECONDS
        outbox_mod.CLAIM_STALE_SECONDS = 0
        try:
            drain_once(send=lambda *_args: (_ for _ in ()).throw(RuntimeError("down")))
            sent: list[str] = []
            drain_once(send=lambda topic, _payload: sent.append(topic))
            self.assertEqual(sent, ["tzudong.pipeline.run.lifecycle.v1"])
            self.assertEqual(unpublished_snapshot(), [])
        finally:
            outbox_mod.CLAIM_STALE_SECONDS = original


class EsBulkAndConsumerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig = {
            key: os.environ.get(key)
            for key in (
                "TZUDONG_PIPELINE_ES",
                "TZUDONG_ES_URL",
                "TZUDONG_DATA_ENV",
                "TZUDONG_KAFKA_BOOTSTRAP",
            )
        }
        os.environ["TZUDONG_PIPELINE_ES"] = "es"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_ES_URL"] = "http://127.0.0.1:9200"
        reset_for_tests()

    def tearDown(self) -> None:
        reset_for_tests()
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_document_id_is_stable(self) -> None:
        doc = {"type": "run.lifecycle", "job_id": "j1", "status": "Succeeded"}
        self.assertEqual(document_id(doc), document_id(dict(doc)))
        self.assertEqual(len(document_id(doc)), 64)

    def test_bulk_replay_keeps_one_id(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        seen: list[str] = []

        class Fake:
            def __init__(self, _url: str) -> None:
                return None

            def bulk(self, documents: list[dict]) -> None:
                for document in documents:
                    seen.append(document_id(document))

        es_mod._load_es_client = lambda: Fake  # type: ignore[method-assign]
        try:
            docs = [{"type": "run.lifecycle", "job_id": "j1", "status": "Succeeded"}]
            self.assertEqual(index_bulk(docs), "es:bulk:1")
            self.assertEqual(index_bulk(docs), "es:bulk:1")
            self.assertEqual(seen, [document_id(docs[0]), document_id(docs[0])])
            self.assertEqual(len(set(seen)), 1)
        finally:
            es_mod._load_es_client = es_mod._StdlibEsClient  # type: ignore[method-assign]

    def test_consumer_group_and_bulk_from_kafka(self) -> None:
        from backend.pipeline_control import es_index as es_mod

        self.assertEqual(CONSUMER_GROUP, "pipeline-indexer")
        bulked: list[dict] = []

        class Fake:
            def __init__(self, _url: str) -> None:
                return None

            def bulk(self, documents: list[dict]) -> None:
                bulked.extend(documents)

        class Message:
            def __init__(self, value: bytes) -> None:
                self.value = value
                self.offset = 1
                self.highwater = 4

        class Consumer(list):
            def commit(self) -> None:
                self.committed = True

        consumer = Consumer()
        consumer.append(
            Message(
                json.dumps(
                    {"type": "step.progress", "job_id": "j1", "step": "01-collect-urls", "index": 0}
                ).encode("utf-8")
            )
        )
        es_mod._load_es_client = lambda: Fake  # type: ignore[method-assign]
        try:
            self.assertEqual(consume_once(consumer), 1)
            self.assertEqual(len(bulked), 1)
            self.assertTrue(getattr(consumer, "committed", False))
            self.assertEqual(gauge_snapshot().get("tzudong_pipeline_kafka_lag"), 3)
            self.assertEqual(gauge_snapshot().get("tzudong_pipeline_es_rows_per_sec"), 1)
        finally:
            es_mod._load_es_client = es_mod._StdlibEsClient  # type: ignore[method-assign]


class LiveGaugeTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_for_tests()

    def tearDown(self) -> None:
        reset_for_tests()

    def test_observe_gauges_and_reject_unknown(self) -> None:
        self.assertEqual(observe("tzudong_pipeline_kafka_lag", 9), "noop:tzudong_pipeline_kafka_lag")
        self.assertEqual(gauge_snapshot()["tzudong_pipeline_kafka_lag"], 9.0)
        observe_process()
        self.assertIn("tzudong_pipeline_process_rss_bytes", gauge_snapshot())
        self.assertIn("tzudong_pipeline_process_cpu_ratio", gauge_snapshot())
        with self.assertRaises(MetricsError) as ctx:
            observe("tzudong_pipeline_runs_enqueued_total", 1)
        self.assertEqual(ctx.exception.code, "metrics_name_unknown")
        self.assertEqual(record("tzudong_pipeline_step_failures_total"), "noop:tzudong_pipeline_step_failures_total")
        self.assertTrue(set(GAUGES))

    def test_outbox_mode_default_none(self) -> None:
        os.environ.pop("TZUDONG_PIPELINE_OUTBOX", None)
        self.assertEqual(classify_outbox_mode(), "none")


if __name__ == "__main__":
    unittest.main()
