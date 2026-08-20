"""Slice 1 Kafka event sink: fail-closed codes, allowlist, compose ownership."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from backend.pipeline_control.adapter import ADAPTER_STEPS, execute_steps
from backend.pipeline_control import adapter as adapter_mod
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

            def close(self) -> None:
                sent.append(("closed", b""))

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
        self.assertEqual(sent[-1][0], "closed")
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
            self.assertNotRegex(
                text,
                r"(?m)^\s+TZUDONG_KAFKA_",
                msg=path.name,
            )

    def test_kafka_fragment_owns_broker_without_host_9092_or_postgres(self) -> None:
        kafka = KAFKA_COMPOSE.read_text(encoding="utf-8")
        obs = OBS_COMPOSE.read_text(encoding="utf-8")
        pipeline = PIPELINE_COMPOSE.read_text(encoding="utf-8")
        contract = CONTRACT.read_text(encoding="utf-8")
        reqs = (ROOT / "pipeline-control" / "requirements.txt").read_text(encoding="utf-8")
        self.assertRegex(kafka, r"(?m)^\s+kafka:")
        self.assertRegex(kafka, r"(?m)^\s+kafka-ui:")
        self.assertNotRegex(kafka, r"(?im)^\s+postgres:")
        self.assertNotIn("127.0.0.1:9092", kafka)
        self.assertIn("PLAINTEXT://kafka:9092", kafka)
        self.assertIn("PLAINTEXT_HOST:PLAINTEXT", kafka)
        self.assertIn("KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT", kafka)
        self.assertIn("127.0.0.1:29092:29092", kafka)
        self.assertIn("127.0.0.1:8088:8080", kafka)
        self.assertEqual(kafka.count("127.0.0.1:29092:29092"), 1)
        self.assertNotRegex(obs, r"(?m)^\s+kafka:")
        self.assertNotRegex(obs, r"(?m)^\s+kafka-ui:")
        self.assertNotRegex(pipeline, r"(?im)^\s+postgres:")
        self.assertIn("losable", contract)
        self.assertIn("29092", contract)
        self.assertIn("kafka-python==3.0.11", reqs)

    def test_multi_token_bootstrap_admits_allowlisted_hosts(self) -> None:
        from backend.pipeline_control.events import admit_bootstrap

        self.assertEqual(
            admit_bootstrap(data_env="local_db", bootstrap="kafka:9092,127.0.0.1:29092"),
            "kafka",
        )

    def test_multi_token_bootstrap_rejects_remote_token(self) -> None:
        from backend.pipeline_control.events import admit_bootstrap

        with self.assertRaises(KafkaPublishError) as ctx:
            admit_bootstrap(data_env="local_db", bootstrap="kafka:9092,broker.example.com:9092")
        self.assertEqual(ctx.exception.code, "kafka_bootstrap_host_rejected")

    def test_empty_bootstrap_tokens_fail_closed(self) -> None:
        from backend.pipeline_control.events import admit_bootstrap

        for raw in ("kafka:9092,", "kafka:9092,,127.0.0.1:29092", "  ,kafka:9092"):
            with self.subTest(raw=raw):
                with self.assertRaises(KafkaPublishError) as ctx:
                    admit_bootstrap(data_env="local_db", bootstrap=raw)
                self.assertEqual(ctx.exception.code, "kafka_bootstrap_required")

    def test_close_after_success_maps_to_publish_failed(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"

        class CloseBoom:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def send(self, *_args: object, **_kwargs: object) -> None:
                return None

            def flush(self) -> None:
                return None

            def close(self) -> None:
                raise RuntimeError("close-failed")

        events_mod._load_kafka_producer = lambda: CloseBoom  # type: ignore[method-assign]
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_publish_failed")

    def test_close_does_not_mask_existing_publish_error(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"

        class SendBoom:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def send(self, *_args: object, **_kwargs: object) -> None:
                raise RuntimeError("send-failed")

            def flush(self) -> None:
                return None

            def close(self) -> None:
                raise RuntimeError("close-failed")

        events_mod._load_kafka_producer = lambda: SendBoom  # type: ignore[method-assign]
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_publish_failed")

    def test_publish_wrap_does_not_need_one_arg_ctor(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"

        class NoOneArg(Exception):
            def __init__(self) -> None:
                super().__init__("no-arg")

        class CtorBoom:
            def __init__(self, **_kwargs: object) -> None:
                raise NoOneArg()

        events_mod._load_kafka_producer = lambda: CtorBoom  # type: ignore[method-assign]
        with self.assertRaises(KafkaPublishError) as ctx:
            publish({"type": "run.lifecycle"})
        self.assertEqual(ctx.exception.code, "kafka_publish_failed")
    def test_envelope_allowlist_unchanged(self) -> None:
        self.assertEqual(
            ENVELOPE_ALLOWLIST,
            frozenset(
                {
                    "type",
                    "job_id",
                    "status",
                    "step",
                    "index",
                    "skipped",
                    "skipKind",
                    "reason",
                    "target",
                    "profile",
                    "request_id",
                    "ts",
                    "timestamp",
                }
            ),
        )

    def test_live_insert_emits_one_record_upserted_in_order(self) -> None:
        for key in ("RUN_DAILY_SKIP_FRAMES", "RUN_DAILY_SKIP_HEAVY_COMPUTE", "RUN_DAILY_SKIP_CHUNK"):
            os.environ.pop(key, None)
        seen: list[dict] = []
        result = execute_steps(
            _run(),
            should_stop=lambda: None,
            emit=seen.append,
            live=True,
            runner=lambda _argv: 0,
        )
        self.assertEqual(result, "Succeeded")
        upserts = [event for event in seen if event.get("type") == "record.upserted"]
        self.assertEqual(len(upserts), 1)
        upsert = upserts[0]
        self.assertEqual(set(upsert), {"type", "job_id", "step", "status", "index"})
        self.assertTrue(set(upsert) <= ENVELOPE_ALLOWLIST)
        self.assertEqual(upsert["status"], "Succeeded")
        self.assertEqual(upsert["step"], "13-supabase-insert")
        self.assertEqual(upsert["index"], ADAPTER_STEPS.index("13-supabase-insert"))
        self.assertNotIn("origin_name", upsert)
        self.assertNotIn("youtube_link", upsert)
        self.assertNotIn("road_address", upsert)
        self.assertNotIn("dsn", str(upsert))
        progress = [event for event in seen if event.get("type") == "step.progress"]
        lifecycle = [event for event in seen if event.get("type") == "run.lifecycle"]
        self.assertEqual(len(progress), len(ADAPTER_STEPS))
        self.assertEqual(lifecycle[-1]["status"], "Succeeded")
        upsert_at = seen.index(upsert)
        self.assertEqual(seen[upsert_at - 1]["type"], "step.progress")
        self.assertEqual(seen[upsert_at - 1]["step"], "13-supabase-insert")
        self.assertEqual(seen[upsert_at + 1]["type"], "step.progress")
        self.assertEqual(seen[upsert_at + 1]["step"], "13-quality-gate")
        self.assertEqual(lifecycle[-1]["type"], "run.lifecycle")
        self.assertEqual(lifecycle[-1]["status"], "Succeeded")

    def test_dry_run_skip_fail_and_halt_do_not_emit_record_upserted(self) -> None:
        dry: list[dict] = []
        execute_steps(_run(), should_stop=lambda: None, emit=dry.append, live=False)
        self.assertFalse(any(event.get("type") == "record.upserted" for event in dry))

        skipped: list[dict] = []
        orig_skip = adapter_mod.skipped_live_steps
        adapter_mod.skipped_live_steps = lambda: {"13-supabase-insert"}  # type: ignore[method-assign]
        try:
            execute_steps(
                _run(),
                should_stop=lambda: None,
                emit=skipped.append,
                live=True,
                runner=lambda _argv: 0,
            )
        finally:
            adapter_mod.skipped_live_steps = orig_skip  # type: ignore[method-assign]
        self.assertFalse(any(event.get("type") == "record.upserted" for event in skipped))

        failed: list[dict] = []
        result = execute_steps(
            _run(),
            should_stop=lambda: None,
            emit=failed.append,
            live=True,
            runner=lambda argv: 1 if any("13-supabase-insert.py" in part for part in argv) else 0,
        )
        self.assertEqual(result, "Failed")
        self.assertFalse(any(event.get("type") == "record.upserted" for event in failed))

        early: list[dict] = []
        result = execute_steps(
            _run(),
            should_stop=lambda: None,
            emit=early.append,
            live=True,
            runner=lambda _argv: 1,
        )
        self.assertEqual(result, "Failed")
        self.assertFalse(any(event.get("type") == "record.upserted" for event in early))

        halted: list[dict] = []
        calls = {"n": 0}

        def should_stop() -> str | None:
            calls["n"] += 1
            if calls["n"] == ADAPTER_STEPS.index("13-supabase-insert") + 1:
                return "Paused"
            return None

        result = execute_steps(
            _run(),
            should_stop=should_stop,
            emit=halted.append,
            live=True,
            runner=lambda _argv: 0,
        )
        self.assertEqual(result, "Paused")
        self.assertFalse(any(event.get("type") == "record.upserted" for event in halted))
        self.assertFalse(any(event.get("step") == "13-supabase-insert" for event in halted))

    def test_insert_script_is_unmodified_and_has_no_stdout_parse(self) -> None:
        source = (ROOT.parent / "backend" / "restaurant-evaluation" / "scripts" / "13-supabase-insert.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("record.upserted", source)
        self.assertNotIn("pipeline_control.events", source)
        self.assertNotIn("noop_event_sink", source)

    def test_sink_spies_publish_and_index_record_upserted(self) -> None:
        published: list[dict] = []
        indexed: list[dict] = []
        orig_publish = adapter_mod.publish
        orig_index = adapter_mod.index_document
        adapter_mod.publish = lambda event: published.append(dict(event))  # type: ignore[method-assign]
        adapter_mod.index_document = lambda document: indexed.append(dict(document))  # type: ignore[method-assign]
        try:
            result = execute_steps(
                _run(),
                should_stop=lambda: None,
                emit=adapter_mod.noop_event_sink,
                live=True,
                runner=lambda _argv: 0,
            )
        finally:
            adapter_mod.publish = orig_publish  # type: ignore[method-assign]
            adapter_mod.index_document = orig_index  # type: ignore[method-assign]
        self.assertEqual(result, "Succeeded")
        self.assertEqual(sum(1 for event in published if event.get("type") == "record.upserted"), 1)
        self.assertEqual(sum(1 for document in indexed if document.get("type") == "record.upserted"), 1)

    def test_injected_producer_receives_upsert_topic(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "127.0.0.1:9092"
        sent: list[str] = []

        class FakeProducer:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def send(self, topic: str, value: bytes) -> None:
                sent.append(topic)

            def flush(self) -> None:
                return None

            def close(self) -> None:
                return None

        events_mod._load_kafka_producer = lambda: FakeProducer  # type: ignore[method-assign]
        execute_steps(
            _run(),
            should_stop=lambda: None,
            emit=adapter_mod.noop_event_sink,
            live=True,
            runner=lambda _argv: 0,
        )
        self.assertIn("tzudong.pipeline.record.upserted.v1", sent)

    def test_record_upserted_publish_failure_fail_closes_job(self) -> None:
        from backend.pipeline_control import events as events_mod

        os.environ["TZUDONG_PIPELINE_EVENTS"] = "kafka"
        os.environ["TZUDONG_DATA_ENV"] = "local_db"
        os.environ["TZUDONG_KAFKA_BOOTSTRAP"] = "kafka:9092"

        class SelectiveBoom:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def send(self, topic: str, _value: bytes) -> None:
                if topic == "tzudong.pipeline.record.upserted.v1":
                    raise RuntimeError("upsert-send-failed")

            def flush(self) -> None:
                return None

            def close(self) -> None:
                return None

        events_mod._load_kafka_producer = lambda: SelectiveBoom  # type: ignore[method-assign]
        store = MemoryStore()
        created, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="events-upsert-fail",
            payload={"dryRun": False},
            actor="qa",
            request_id="req-euf",
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "current-summary.json"
            result = process_one(store, live=True, runner=lambda _argv: 0, manifest_path=dest)
            self.assertEqual(result, "Failed")
            self.assertEqual(store.get(created.id).status, "Failed")
            self.assertEqual(store.get(created.id).error_code, "kafka_publish_failed")

    def test_contract_documents_process_exit_zero_upsert(self) -> None:
        contract = CONTRACT.read_text(encoding="utf-8")
        self.assertIn("record.upserted", contract)
        self.assertIn("process exit 0", contract)
        self.assertIn("possibly zero rows", contract)
        self.assertIn("losable", contract)


if __name__ == "__main__":
    unittest.main()
