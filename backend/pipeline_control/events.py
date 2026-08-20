"""Event sink. Default no-op; Kafka publisher is opt-in via TZUDONG_PIPELINE_EVENTS=kafka."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlparse

from backend.utils.privacy_log import safe_error_name, sanitize_log_value

TOPICS = {
    "run.lifecycle": "tzudong.pipeline.run.lifecycle.v1",
    "step.progress": "tzudong.pipeline.step.progress.v1",
    "record.upserted": "tzudong.pipeline.record.upserted.v1",
}

ALLOWED_MODES = frozenset({"noop", "kafka"})
ALLOWED_BOOTSTRAP_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "kafka"})
ENVELOPE_ALLOWLIST = frozenset(
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
)


class KafkaPublishError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def resolve_topic(event_type: str) -> str:
    if event_type not in TOPICS:
        raise KafkaPublishError("kafka_topic_unknown")
    return TOPICS[event_type]


def classify_events_mode(raw: str | None) -> str:
    if raw is None:
        return "noop"
    value = str(raw).strip()
    if value == "":
        return "noop"
    if value not in ALLOWED_MODES:
        raise KafkaPublishError("events_mode_invalid")
    return value


def _bootstrap_host(raw: str) -> str:
    token = str(raw).strip()
    if not token:
        raise KafkaPublishError("kafka_bootstrap_required")
    if "://" not in token:
        token = f"kafka://{token}"
    parsed = urlparse(token)
    host = (parsed.hostname or "").lower().strip().strip("[]")
    if not host:
        raise KafkaPublishError("kafka_bootstrap_required")
    return host


def admit_bootstrap(*, data_env: str | None, bootstrap: str | None) -> str:
    env = (data_env or "local_db").strip() or "local_db"
    if env != "local_db":
        raise KafkaPublishError("kafka_bootstrap_host_rejected")
    if not bootstrap or not str(bootstrap).strip():
        raise KafkaPublishError("kafka_bootstrap_required")
    tokens = str(bootstrap).split(",")
    if not tokens:
        raise KafkaPublishError("kafka_bootstrap_required")
    hosts: list[str] = []
    for token in tokens:
        host = _bootstrap_host(token)
        if host not in ALLOWED_BOOTSTRAP_HOSTS:
            raise KafkaPublishError("kafka_bootstrap_host_rejected")
        hosts.append(host)
    return hosts[0]


def allowlisted_event(event: dict[str, Any]) -> dict[str, Any]:
    return {
        key: sanitize_log_value(value)
        for key, value in event.items()
        if key in ENVELOPE_ALLOWLIST
    }


def _load_kafka_producer() -> Any:
    from kafka import KafkaProducer

    return KafkaProducer


def publish_bytes(topic: str, payload: bytes) -> None:
    bootstrap = os.environ.get("TZUDONG_KAFKA_BOOTSTRAP")
    admit_bootstrap(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        bootstrap=bootstrap,
    )
    try:
        producer_cls = _load_kafka_producer()
    except ImportError as exc:
        raise KafkaPublishError("kafka_client_missing") from exc
    producer = None
    caught: KafkaPublishError | None = None
    try:
        producer = producer_cls(bootstrap_servers=str(bootstrap).strip())
        producer.send(topic, payload)
        producer.flush()
    except KafkaPublishError as exc:
        caught = exc
        raise
    except Exception as exc:
        caught = KafkaPublishError("kafka_publish_failed")
        raise caught from RuntimeError(safe_error_name(exc))
    finally:
        if producer is not None:
            try:
                closer = getattr(producer, "close", None)
                if closer is not None:
                    closer()
            except KafkaPublishError:
                if caught is None:
                    raise
            except Exception as exc:
                if caught is None:
                    raise KafkaPublishError("kafka_publish_failed") from RuntimeError(
                        safe_error_name(exc)
                    )


def publish(event: dict[str, Any]) -> str:
    event_type = event.get("type")
    if not isinstance(event_type, str) or not event_type.strip():
        raise KafkaPublishError("kafka_topic_unknown")
    topic = resolve_topic(event_type.strip())
    from backend.pipeline_control.outbox import classify_outbox_mode, enqueue_event

    if classify_outbox_mode() != "none":
        enqueue_event(event)
        return f"outbox:{topic}"
    mode = classify_events_mode(os.environ.get("TZUDONG_PIPELINE_EVENTS"))
    if mode != "kafka":
        return f"noop:{topic}"
    payload = envelope(allowlisted_event(event))
    publish_bytes(topic, payload.encode("utf-8"))
    return f"kafka:{topic}"


def envelope(event: dict[str, Any]) -> str:
    return json.dumps(allowlisted_event(event), sort_keys=True, separators=(",", ":"))
