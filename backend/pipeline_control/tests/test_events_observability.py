"""P6 transactional outbox, Kafka publisher/consumer, ES bulk, live gauges."""

from __future__ import annotations

import json
import os
import traceback
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, call, patch
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
COMPOSE = ROOT / "pipeline-control" / "docker-compose.pipeline.yml"
EVENTS_CATALOG = ROOT / "pipeline-control" / "events.v1.json"


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


class ConsumerRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.pipeline_control import es_index

        self.es = es_index
        self.env = patch.dict(os.environ, {
            "TZUDONG_PIPELINE_ES": "es",
            "TZUDONG_DATA_ENV": "local_db",
            "TZUDONG_ES_URL": "http://elasticsearch:9200",
            "TZUDONG_KAFKA_BOOTSTRAP": "kafka:9092",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "",
            "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        reset_for_tests()
        self.addCleanup(reset_for_tests)

    def consumer(self) -> MagicMock:
        consumer = MagicMock()
        consumer.__iter__.return_value = iter([SimpleNamespace(
            value=b'{"type":"step.progress","job_id":"j1","step":"01"}',
            offset=1, highwater=4,
        )])
        return consumer

    def test_owned_consumer_closes_after_index_then_commit_with_autocommit_off(self) -> None:
        consumer = self.consumer()
        order: list[str] = []
        consumer.commit.side_effect = lambda: order.append("commit")
        consumer.close.side_effect = lambda **_kw: order.append("close")
        factory = Mock(return_value=consumer)
        with patch.object(self.es, "_load_kafka_consumer", return_value=factory), \
                patch.object(self.es, "index_bulk", side_effect=lambda _docs: order.append("index")):
            self.assertEqual(consume_once(), 1)
        self.assertIs(factory.call_args.kwargs["enable_auto_commit"], False)
        self.assertEqual(factory.call_args.kwargs["group_id"], CONSUMER_GROUP)
        self.assertEqual(order, ["index", "commit", "close"])
        consumer.close.assert_called_once_with(autocommit=False)

    def test_owned_idle_consumer_closes_without_index_or_commit(self) -> None:
        consumer = self.consumer()
        consumer.__iter__.return_value = iter([])
        with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(return_value=consumer)), \
                patch.object(self.es, "index_bulk") as index:
            self.assertEqual(consume_once(), 0)
        index.assert_not_called()
        consumer.commit.assert_not_called()
        consumer.close.assert_called_once_with(autocommit=False)

    def test_owned_consumer_closes_on_poll_index_commit_and_decode_failure(self) -> None:
        for stage in ("poll", "index", "commit", "decode"):
            with self.subTest(stage=stage):
                consumer = self.consumer()
                index = Mock()
                if stage == "poll":
                    def failed_poll():
                        yield SimpleNamespace(value={"type": "run.lifecycle"}, offset=0)
                        raise ConnectionError("FORBIDDEN_broker_diagnostic")
                    consumer.__iter__.return_value = failed_poll()
                elif stage == "index":
                    index.side_effect = self.es.EsIndexError("es_index_failed")
                elif stage == "commit":
                    consumer.commit.side_effect = TimeoutError("FORBIDDEN_commit_diagnostic")
                else:
                    consumer.__iter__.return_value = iter([SimpleNamespace(value=b'{')])
                expected = json.JSONDecodeError if stage == "decode" else self.es.EsIndexError
                with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(return_value=consumer)), \
                        patch.object(self.es, "index_bulk", index):
                    with self.assertRaises(expected) as caught:
                        consume_once()
                consumer.close.assert_called_once_with(autocommit=False)
                if stage == "commit":
                    index.assert_called_once()
                    consumer.commit.assert_called_once()
                else:
                    consumer.commit.assert_not_called()
                if stage in {"poll", "decode"}:
                    index.assert_not_called()
                if stage in {"poll", "commit"}:
                    self.assertEqual(caught.exception.code, "kafka_consumer_unavailable")
                    self.assertNotIn("FORBIDDEN", "".join(traceback.format_exception(caught.exception)))

    def test_injected_consumer_remains_caller_owned_on_success_and_failure(self) -> None:
        for failed in (False, True):
            with self.subTest(failed=failed):
                consumer = self.consumer()
                effect = self.es.EsIndexError("es_index_failed") if failed else None
                with patch.object(self.es, "index_bulk", side_effect=effect):
                    if failed:
                        with self.assertRaises(self.es.EsIndexError):
                            consume_once(consumer)
                        consumer.commit.assert_not_called()
                    else:
                        self.assertEqual(consume_once(consumer), 1)
                        consumer.commit.assert_called_once()
                consumer.close.assert_not_called()

    def test_close_failure_never_masks_failed_index_or_commits(self) -> None:
        consumer = self.consumer()
        consumer.close.side_effect = ConnectionError("FORBIDDEN_close_diagnostic")
        with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(return_value=consumer)), \
                patch.object(self.es, "index_bulk", side_effect=self.es.EsIndexError("es_url_host_rejected")):
            with self.assertRaises(self.es.EsIndexError) as caught:
                consume_once()
        self.assertEqual(caught.exception.code, "es_url_host_rejected")
        consumer.close.assert_called_once_with(autocommit=False)
        consumer.commit.assert_not_called()

    def test_main_recovers_after_factory_poll_and_commit_outage(self) -> None:
        for stage in ("factory", "poll", "commit"):
            with self.subTest(stage=stage):
                failed, recovered = self.consumer(), self.consumer()
                if stage == "poll":
                    failed.__iter__.side_effect = ConnectionError("broker_not_ready")
                elif stage == "commit":
                    failed.commit.side_effect = TimeoutError("coordinator_not_ready")
                factory = Mock(side_effect=[
                    ConnectionError("broker_not_ready") if stage == "factory" else failed,
                    recovered,
                ])
                stop = Mock()
                stop.is_set.return_value = False
                stop.wait.side_effect = [False, True]
                with patch.object(self.es.threading, "Event", return_value=stop), \
                        patch.object(self.es.signal, "signal"), \
                        patch.object(self.es, "_load_kafka_consumer", return_value=factory), \
                        patch.object(self.es, "index_bulk") as index:
                    self.assertEqual(self.es.main(), 0)
                self.assertEqual(factory.call_count, 2)
                self.assertEqual(stop.wait.call_args_list, [call(1.0), call(1.0)])
                self.assertEqual(index.call_count, 2 if stage == "commit" else 1)
                recovered.commit.assert_called_once()
                recovered.close.assert_called_once_with(autocommit=False)
                if stage != "factory":
                    failed.close.assert_called_once_with(autocommit=False)

    def test_stop_during_retry_wait_ends_without_another_consumer(self) -> None:
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = True
        factory = Mock(side_effect=ConnectionError("broker_not_ready"))
        with patch.object(self.es.threading, "Event", return_value=stop), \
                patch.object(self.es.signal, "signal"), \
                patch.object(self.es, "_load_kafka_consumer", return_value=factory):
            self.assertEqual(self.es.main(), 0)
        factory.assert_called_once()
        stop.wait.assert_called_once_with(1.0)

    def test_configuration_and_admission_errors_remain_terminal(self) -> None:
        from backend.pipeline_control.events import KafkaPublishError

        for env, expected, code in (
            ({"TZUDONG_PIPELINE_ES": "invalid"}, self.es.EsIndexError, "es_mode_invalid"),
            ({"TZUDONG_ES_URL": "http://remote.example:9200"}, self.es.EsIndexError, "es_url_host_rejected"),
            ({"TZUDONG_KAFKA_BOOTSTRAP": "remote.example:9092"}, KafkaPublishError, "kafka_bootstrap_host_rejected"),
        ):
            with self.subTest(code=code):
                stop = Mock()
                stop.is_set.return_value = False
                with patch.dict(os.environ, env), \
                        patch.object(self.es.threading, "Event", return_value=stop), \
                        patch.object(self.es.signal, "signal"), \
                        patch.object(self.es, "_load_kafka_consumer") as load:
                    with self.assertRaises(expected) as caught:
                        self.es.main()
                self.assertEqual(caught.exception.code, code)
                load.assert_not_called()
                stop.wait.assert_not_called()
        with patch.object(self.es, "_load_kafka_consumer", side_effect=ImportError("private_path")):
            with self.assertRaises(self.es.EsIndexError) as caught:
                consume_once()
        self.assertEqual(caught.exception.code, "es_client_missing")

    def test_pinned_kafka_retryable_errors_and_configuration_errors_are_distinct(self) -> None:
        try:
            from kafka.errors import CommitFailedError, KafkaConfigurationError, KafkaConnectionError
        except ImportError:
            self.skipTest("pinned kafka-python is required for actual client error classes")
        for error, code in (
            (KafkaConnectionError("private_endpoint"), "kafka_consumer_unavailable"),
            (CommitFailedError("private_group"), "kafka_consumer_unavailable"),
            (KafkaConfigurationError("private_config"), "kafka_consumer_failed"),
            (ValueError("private_config"), "kafka_consumer_failed"),
        ):
            with self.subTest(error=type(error).__name__):
                with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(side_effect=error)):
                    with self.assertRaises(self.es.EsIndexError) as caught:
                        consume_once()
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("private_", "".join(traceback.format_exception(caught.exception)))

    def test_bulk_http_200_failure_malformed_or_oversized_response_never_commits(self) -> None:
        invalid = (
            {"errors": True, "items": [{"index": {"status": 400, "error": {"reason": "FORBIDDEN_document"}}}]},
            {"errors": False, "items": [{"index": {"status": 400}}]},
            {"items": [{"index": {"status": 201}}]},
            {"errors": 0, "items": [{"index": {"status": 201}}]},
            {"errors": False, "items": []},
            {"errors": False, "items": [{"index": {"status": 201}}] * 2},
            {"errors": False, "items": {}},
            {"errors": False, "items": [{"create": {"status": 201}}]},
            {"errors": False, "items": [{"index": "FORBIDDEN_document"}]},
            {"errors": False, "items": [{"index": {"status": "201"}}]},
            {"errors": False, "items": [{"index": {"status": True}}]},
            {"errors": False, "items": [{"index": {}}]},
            {"errors": False, "items": [{"index": {"status": 201, "error": None}}]},
            [],
            b'FORBIDDEN_not_json',
            b'x' * (self.es.BULK_RESPONSE_MAX_BYTES + 1),
        )
        for position, payload in enumerate(invalid):
            with self.subTest(response=position):
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                consumer = self.consumer()
                response = Mock(status=200)
                response.read.return_value = body
                opener = MagicMock()
                opener.open.return_value.__enter__.return_value = response
                with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(return_value=consumer)), \
                        patch.object(self.es, "_load_es_client", return_value=self.es._StdlibEsClient), \
                        patch.object(self.es._StdlibEsClient, "_opener", return_value=opener):
                    with self.assertRaises(self.es.EsIndexError) as caught:
                        consume_once()
                self.assertEqual(caught.exception.code, "es_index_failed")
                self.assertNotIn("FORBIDDEN", "".join(traceback.format_exception(caught.exception)))
                response.read.assert_called_once_with(self.es.BULK_RESPONSE_MAX_BYTES + 1)
                consumer.commit.assert_not_called()
                consumer.close.assert_called_once_with(autocommit=False)

    def test_bulk_replay_after_partial_failure_commits_only_valid_result_with_same_id(self) -> None:
        consumers = [self.consumer(), self.consumer()]
        response = Mock(status=200)
        response.read.side_effect = [
            b'{"errors":true,"items":[{"index":{"status":429,"error":{"type":"busy"}}}]}',
            b'{"errors":false,"items":[{"index":{"status":201}}]}',
        ]
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.object(self.es, "_load_kafka_consumer", return_value=Mock(side_effect=consumers)), \
                patch.object(self.es, "_load_es_client", return_value=self.es._StdlibEsClient), \
                patch.object(self.es._StdlibEsClient, "_opener", return_value=opener):
            with self.assertRaises(self.es.EsIndexError):
                consume_once()
            consumers[0].commit.assert_not_called()
            self.assertEqual(consume_once(), 1)
        consumers[1].commit.assert_called_once_with()
        for consumer in consumers:
            consumer.close.assert_called_once_with(autocommit=False)
        actions = [json.loads(args.args[0].data.splitlines()[0]) for args in opener.open.call_args_list]
        self.assertEqual(actions[0]["index"]["_id"], actions[1]["index"]["_id"])
        self.assertEqual(actions[0]["index"]["_index"], "pipeline-logs-v1")
        self.assertEqual(response.read.call_args_list, [
            call(self.es.BULK_RESPONSE_MAX_BYTES + 1), call(self.es.BULK_RESPONSE_MAX_BYTES + 1),
        ])


class PublisherRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.pipeline_control import outbox, publisher

        self.outbox, self.publisher = outbox, publisher
        self.env = patch.dict(os.environ, {
            "TZUDONG_PIPELINE_OUTBOX": "memory",
            "TZUDONG_PIPELINE_EVENTS": "kafka",
            "TZUDONG_DATA_ENV": "local_db",
            "TZUDONG_KAFKA_BOOTSTRAP": "kafka:9092",
            "OTEL_EXPORTER_OTLP_ENDPOINT": "",
            "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        reset_memory()
        reset_for_tests()
        self.addCleanup(reset_memory)
        self.addCleanup(reset_for_tests)

    def test_snapshot_claim_and_ack_outages_recover_without_premature_ack(self) -> None:
        from backend.pipeline_control.pool import PoolError

        read_error = self.outbox.OutboxError("outbox_read_failed")
        read_error.__cause__ = type("DatabaseError", (Exception,), {"pgcode": "57P03"})("private_startup")
        for stage, error in (
            ("unpublished_snapshot", PoolError("pool_connect_failed")),
            ("unpublished_snapshot", read_error),
            ("claim_events", self.outbox.OutboxError("outbox_claim_failed")),
            ("ack_events", self.outbox.OutboxError("outbox_ack_failed")),
        ):
            with self.subTest(stage=stage, code=error.code):
                reset_memory()
                enqueue_event({"type": "run.lifecycle", "job_id": "recovery", "status": "Succeeded"})
                original = getattr(self.publisher, stage)
                attempts = 0
                sent: list[bytes] = []

                def fail_once(*args, **kwargs):
                    nonlocal attempts
                    attempts += 1
                    if attempts == 1:
                        raise error
                    return original(*args, **kwargs)

                def send(_topic, payload):
                    self.assertEqual(len(unpublished_snapshot()), 1)
                    sent.append(payload)

                stop = Mock()
                stop.is_set.return_value = False
                stop.wait.side_effect = [False, True]
                with patch.object(self.publisher.threading, "Event", return_value=stop), \
                        patch.object(self.publisher.signal, "signal"), \
                        patch.object(self.publisher, stage, side_effect=fail_once), \
                        patch.object(self.publisher, "publish_bytes", side_effect=send), \
                        patch.object(self.publisher, "close_pool") as reconnect, \
                        patch.object(self.outbox, "CLAIM_STALE_SECONDS", 0):
                    self.assertEqual(self.publisher.main(), 0)
                self.assertEqual(unpublished_snapshot(), [])
                self.assertEqual(len(sent), 2 if stage == "ack_events" else 1)
                self.assertEqual(len(set(sent)), 1)
                reconnect.assert_called_once_with()
                self.assertEqual(stop.wait.call_args_list, [call(1.0), call(1.0)])

    def test_storage_retry_is_bounded_by_codes_and_preserves_wrapped_admission_failure(self) -> None:
        from backend.pipeline_control.dsn_guard import DsnGuardError
        from backend.pipeline_control.pool import PoolError

        wrapped_guard = self.outbox.OutboxError("outbox_read_failed")
        wrapped_guard.__cause__ = DsnGuardError("hosted_dsn_rejected")
        schema_error = self.outbox.OutboxError("outbox_read_failed")
        schema_error.__cause__ = type("DatabaseError", (Exception,), {"pgcode": "42P01"})("private_schema")
        for error in (
            PoolError("psycopg2_missing"), PoolError("persist_dsn_required"),
            self.outbox.OutboxError("outbox_mode_invalid"),
            self.outbox.OutboxError("outbox_enqueue_failed"),
            wrapped_guard, schema_error,
        ):
            with self.subTest(code=error.code, cause=type(error.__cause__).__name__):
                stop = Mock()
                stop.is_set.return_value = False
                with patch.object(self.publisher.threading, "Event", return_value=stop), \
                        patch.object(self.publisher.signal, "signal"), \
                        patch.object(self.publisher, "drain_once", side_effect=error), \
                        patch.object(self.publisher, "close_pool") as reconnect:
                    with self.assertRaises(type(error)) as caught:
                        self.publisher.main()
                self.assertEqual(caught.exception.code, error.code)
                self.assertNotIn("private_schema", "".join(traceback.format_exception(caught.exception)))
                stop.wait.assert_not_called()
                reconnect.assert_not_called()

    def test_driver_dsn_configuration_error_without_sqlstate_is_terminal(self) -> None:
        from backend.pipeline_control.pool import PoolError

        try:
            from psycopg2 import ProgrammingError
        except ImportError:
            self.skipTest("pinned psycopg2 is required for actual driver error classes")
        error = PoolError("pool_connect_failed")
        error.__cause__ = ProgrammingError("FORBIDDEN_invalid_dsn_option")
        self.assertIsNone(error.__cause__.pgcode)
        stop = Mock()
        stop.is_set.return_value = False
        with patch.object(self.publisher.threading, "Event", return_value=stop), \
                patch.object(self.publisher.signal, "signal"), \
                patch.object(self.publisher, "drain_once", side_effect=error), \
                patch.object(self.publisher, "close_pool") as reconnect:
            with self.assertRaises(PoolError) as caught:
                self.publisher.main()
        self.assertEqual(caught.exception.code, "pool_connect_failed")
        self.assertNotIn("FORBIDDEN", "".join(traceback.format_exception(caught.exception)))
        stop.wait.assert_not_called()
        reconnect.assert_not_called()

    def test_missing_kafka_dependency_and_forbidden_broker_are_terminal_and_unacked(self) -> None:
        from backend.pipeline_control import events

        for bootstrap, code in (
            ("kafka:9092", "kafka_client_missing"),
            ("remote.example:9092", "kafka_bootstrap_host_rejected"),
        ):
            with self.subTest(code=code):
                reset_memory()
                enqueue_event({"type": "run.lifecycle", "job_id": "config", "status": "Succeeded"})
                stop = Mock()
                stop.is_set.return_value = False
                with patch.dict(os.environ, {"TZUDONG_KAFKA_BOOTSTRAP": bootstrap}), \
                        patch.object(self.publisher.threading, "Event", return_value=stop), \
                        patch.object(self.publisher.signal, "signal"), \
                        patch.object(events, "_load_kafka_producer", side_effect=ImportError("private_path")), \
                        patch.object(self.publisher, "close_pool") as reconnect:
                    with self.assertRaises(events.KafkaPublishError) as caught:
                        self.publisher.main()
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(len(unpublished_snapshot()), 1)
                stop.wait.assert_not_called()
                reconnect.assert_not_called()

    def test_stop_during_storage_retry_wait_prevents_another_drain(self) -> None:
        from backend.pipeline_control.pool import PoolError

        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = True
        with patch.object(self.publisher.threading, "Event", return_value=stop), \
                patch.object(self.publisher.signal, "signal"), \
                patch.object(self.publisher, "drain_once", side_effect=PoolError("pool_connect_failed")) as drain, \
                patch.object(self.publisher, "close_pool") as reconnect:
            self.assertEqual(self.publisher.main(), 0)
        drain.assert_called_once_with()
        reconnect.assert_called_once_with()
        stop.wait.assert_called_once_with(1.0)

    def test_actual_kafka_delivery_future_must_succeed_before_outbox_ack(self) -> None:
        from backend.pipeline_control import events

        try:
            from kafka.errors import KafkaTimeoutError
            from kafka.producer.future import FutureProduceResult, FutureRecordMetadata
            from kafka.structs import TopicPartition
        except ImportError:
            self.skipTest("pinned kafka-python is required for actual delivery futures")
        for succeeded in (False, True):
            with self.subTest(succeeded=succeeded):
                reset_memory()
                enqueue_event({"type": "run.lifecycle", "job_id": "future", "status": "Succeeded"})
                batch = FutureProduceResult(TopicPartition("tzudong.pipeline.run.lifecycle.v1", 0))
                record = FutureRecordMetadata(batch, 0, 0, None, 0, 1, 0)
                if succeeded:
                    batch.success((100, 0, None))
                else:
                    batch.failure(KafkaTimeoutError("FORBIDDEN_failed_delivery"))
                    self.assertTrue(record.failed())
                order: list[str] = []
                delivery = Mock(wraps=record)
                producer = Mock()

                def sent(*_args):
                    order.append("send")
                    return delivery

                def delivered(*, timeout):
                    order.append("delivery")
                    self.assertEqual(len(unpublished_snapshot()), 1)
                    return record.get(timeout=timeout)

                def acknowledged(ids, token):
                    order.append("ack")
                    return self.outbox.ack_events(ids, token)

                producer.send.side_effect = sent
                delivery.get.side_effect = delivered
                producer.flush.side_effect = lambda **_kw: order.append("flush")
                producer.close.side_effect = lambda **_kw: order.append("close")
                with patch.object(events, "_load_kafka_producer", return_value=Mock(return_value=producer)), \
                        patch.object(self.publisher, "ack_events", side_effect=acknowledged) as ack:
                    self.assertEqual(drain_once(), 1 if succeeded else 0)
                delivery.get.assert_called_once_with(timeout=events.PUBLISH_TIMEOUT_SECONDS)
                producer.close.assert_called_once_with(timeout=events.PUBLISH_TIMEOUT_SECONDS)
                if succeeded:
                    self.assertEqual(order, ["send", "delivery", "flush", "close", "ack"])
                    self.assertEqual(unpublished_snapshot(), [])
                    producer.flush.assert_called_once_with(timeout=events.PUBLISH_TIMEOUT_SECONDS)
                else:
                    self.assertEqual(order, ["send", "delivery", "close"])
                    self.assertEqual(len(unpublished_snapshot()), 1)
                    producer.flush.assert_not_called()
                    ack.assert_not_called()

    def test_missing_or_timeout_delivery_future_preserves_outbox_and_closes(self) -> None:
        from backend.pipeline_control import events

        timeout = Mock()
        timeout.get.side_effect = TimeoutError("FORBIDDEN_delivery_timeout")
        for future in (None, timeout):
            with self.subTest(missing=future is None):
                reset_memory()
                enqueue_event({"type": "run.lifecycle", "job_id": "pending", "status": "Succeeded"})
                producer = Mock()
                producer.send.return_value = future
                with patch.object(events, "_load_kafka_producer", return_value=Mock(return_value=producer)), \
                        patch.object(self.publisher, "ack_events") as ack:
                    self.assertEqual(drain_once(), 0)
                self.assertEqual(len(unpublished_snapshot()), 1)
                ack.assert_not_called()
                producer.flush.assert_not_called()
                producer.close.assert_called_once_with(timeout=events.PUBLISH_TIMEOUT_SECONDS)
        timeout.get.assert_called_once_with(timeout=events.PUBLISH_TIMEOUT_SECONDS)


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
