"""Slice 1 Kafka event sink: fail-closed codes, allowlist, compose ownership."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control.adapter import ADAPTER_STEPS, execute_steps
from backend.pipeline_control.events import (
    ENVELOPE_ALLOWLIST,
    KafkaPublishError,
    envelope,
    publish,
    resolve_topic,
)
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT.parent / ".github" / "workflows"
KAFKA_COMPOSE = ROOT / "pipeline-control" / "docker-compose.kafka.yml"
OBS_COMPOSE = ROOT / "pipeline-control" / "docker-compose.observability.yml"
PIPELINE_COMPOSE = ROOT / "pipeline-control" / "docker-compose.pipeline.yml"
CONTRACT = ROOT.parent / "backend" / "DATA_CONTRACTS.md"


def _run() -> RunRecord:
    return RunRecord(
        id="00000000-0000-4000-8000-0000000000e1",
        target="tzuyang",
        profile="heavy_local",
        status="Queued",
        idempotency_key="events01",
        payload_hash="abc",
        actor="qa",
        request_id="req-e1",
        lease_until=1.0,
        heartbeat_at=1.0,
    )


class EventSinkTests(unittest.TestCase):
    def setUp(self) -> None:
        from backend.pipeline_control import events as events_mod

        self._orig = {
            key: os.environ.get(key)
            for key in (
                "TZUDONG_PIPELINE_EVENTS",
                "TZUDONG_KAFKA_BOOTSTRAP",
                "TZUDONG_DATA_ENV",
            )
        }
        self._orig_load = events_mod._load_kafka_producer

    def tearDown(self) -> None:
        from backend.pipeline_control import events as events_mod

        events_mod._load_kafka_producer = self._orig_load
        for key, value in self._orig.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_default_is_noop_and_does_not_load_client(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ.pop("TZUDONG_PIPELINE_EVENTS", None)
        loads = {"n": 0}

        def boom() -> object:
            loads["n"] += 1
            raise ImportError("kafka")

        events_mod._load_kafka_producer = boom  # type: ignore[method-assign]
        self.assertEqual(
            publish({"type": "run.lifecycle", "job_id": "j1", "status": "Succeeded"}),
            "noop:tzudong.pipeline.run.lifecycle.v1",
        )
        self.assertEqual(loads["n"], 0)

    def test_typo_mode_is_invalid(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kakfa"
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "events_mode_invalid")

    def test_missing_and_unknown_type_fail_closed(self) -> None:
        os.environ.pop("TZUDONG_PIPELINE_EVENTS", None)
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({})
        self.assertEqual(ctx.exception.code, "kafka_topic_unknown")
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "not.a.topic"})
        self.assertEqual(ctx.exception.code, "kafka_topic_unknown")
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": ""})
        self.assertEqual(ctx.exception.code, "kafka_topic_unknown")

    def test_kafka_missing_bootstrap(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("TZUDONG_KAFKA_BOOTSTRAP", None)
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_bootstrap_required")

    def test_kafka_remote_bootstrap_rejected(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "broker.example.com:9092"
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_bootstrap_host_rejected")

    def test_kafka_non_local_db_rejected(self) -> None:
        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "hosting_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_bootstrap_host_rejected")

    def test_kafka_client_missing(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"

        def missing() -> object:
            raise ImportError("no-kafka")

        events_mod._load_kafka_producer = missing  # type: ignore[method-assign]
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_client_missing")

    def test_injected_producer_receives_allowlisted_progress(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "127.0.0.1:9092"
        sent: list[tuple[str, bytes]] = []

        class FakeProducer:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def send(self, topic: str, value: bytes) -> None:
                sent.append((topic, value))

            def flush(self) -> None:
                return None

        events_mod._load_kafka_producer = lambda: FakeProducer  # type: ignore[method-assign]
        result = publish(
            {
                "type": "step.progress",
                "job_id": "j1",
                "step": "01-collect-urls",
                "index": 0,
                "skipped": False,
                "password": "super-secret-value",
            }
        )
        self.assertEqual(result, "kafka:tzudong.pipeline.step.progress.v1")
        self.assertEqual(sent[0][0], "tzudong.pipeline.step.progress.v1")
        body = sent[0][1].decode("utf-8")
        self.assertIn('"index":0', body)
        self.assertIn('"skipped":false', body)
        self.assertNotIn("super-secret-value", body)
        self.assertEqual(resolve_topic("record.upserted"), "tzudong.pipeline.record.upserted.v1")

    def test_adapter_emitted_keys_are_allowlisted(self) -> None:
        seen: list[set[str]] = []

        def capture(event: dict) -> None:
            seen.append(set(event))

        execute_steps(_run(), should_stop=lambda: None, emit=capture, live=False)
        self.assertTrue(seen)
        for keys in seen:
            self.assertTrue(keys <= ENVELOPE_ALLOWLIST)

    def test_envelope_drops_unknown_keys(self) -> None:
        raw = envelope({"type": "run.lifecycle", "dsn": "postgresql://x", "job_id": "j"})
        self.assertNotIn("dsn", raw)
        self.assertIn("job_id", raw)

    def test_worker_publish_error_finishes_failed(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ.pop("TZUDONG_KAFKA_BOOTSTRAP", None)
        store = MemoryStore()
        created, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="events-worker-1",
            payload={"dryRun": True},
            actor="qa",
            request_id="req-ew",
            dry_run=True,
        )
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "current-summary.json"
            result = process_one(store, live=False, manifest_path=dest)
            self.assertEqual(result, "Failed")
            self.assertEqual(store.get(created.id).status, "Failed")
            self.assertEqual(store.get(created.id).error_code, "kafka_bootstrap_required")
            self.assertTrue(dest.is_file())
        events_mod._load_kafka_producer = self._orig_load

    def test_gha_does_not_set_events_env_key(self) -> None:
        for path in WORKFLOWS.glob("*.yml"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(
                text,
                r"(?m)^\s+TZUDONG_PIPELINE_EVENTS\s*:",
                msg=path.name,
            )

    def test_kafka_fragment_owns_broker_without_host_port_or_postgres(self) -> None:
        kafka = KAFKA_COMPOSE.read_text(encoding="utf-8")
        obs = OBS_COMPOSE.read_text(encoding="utf-8")
        pipeline = PIPELINE_COMPOSE.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertRegex(kafka, r"(?m)^\s+kafka:")
        self.assertRegex(kafka, r"(?m)^\s+kafka-ui:")
        self.assertNotRegex(kafka, r"(?im)^\s+postgres:")
        self.assertNotIn("127.0.0.1:9092", kafka)
        self.assertIn("PLAINTEXT://kafka:9092", kafka)
        self.assertNotRegex(obs, r"(?m)^\s+kafka:")
        self.assertNotRegex(obs, r"(?m)^\s+kafka-ui:")
        self.assertNotRegex(pipeline, r"(?im)^\s+postgres:")
        self.assertIn("losable", contract)


if __name__ == "__main__":
    unittest.main()
