"""Event sink. Default no-op; Kafka publisher is opt-in via TZUDONG_PIPELINE_EVENTS=kafka."""

from __future__ import annotations

import json
import os
from typing import Any

TOPICS = {
    "run.lifecycle": "tzudong.pipeline.run.lifecycle.v1",
    "step.progress": "tzudong.pipeline.step.progress.v1",
    "record.upserted": "tzudong.pipeline.record.upserted.v1",
}


def resolve_topic(event_type: str) -> str:
    return TOPICS[event_type]


def publish(event: dict[str, Any]) -> str:
    mode = os.environ.get("TZUDONG_PIPELINE_EVENTS", "noop")
    topic = resolve_topic(str(event.get("type") or "run.lifecycle"))
    if mode != "kafka":
        return f"noop:{topic}"
    # Kafka client is wired in a later slice; fail closed rather than pretend.
    raise RuntimeError("kafka_publisher_not_configured")


def envelope(event: dict[str, Any]) -> str:
    return json.dumps(event, sort_keys=True, separators=(",", ":"))
