"""Long-lived outbox publisher. Sends claimed rows to Kafka, then acks."""

from __future__ import annotations

import json
import os
import signal
import threading
import time
from typing import Any, Callable

from backend.pipeline_control.events import classify_events_mode, publish_bytes
from backend.pipeline_control.metrics import observe, observe_process
from backend.pipeline_control.outbox import (
    CLAIM_LIMIT,
    ack_events,
    claim_events,
    unpublished_snapshot,
)

SendFn = Callable[[str, bytes], None]


def _payload_bytes(row: dict[str, Any]) -> bytes:
    payload = row.get("payload")
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)
    if isinstance(payload, str):
        return payload.encode("utf-8")
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def observe_queue() -> None:
    unpublished = unpublished_snapshot()
    observe("tzudong_pipeline_queue_depth", len(unpublished))
    if unpublished:
        created = unpublished[0].get("created_at")
        if created is not None:
            try:
                age = time.time() - float(created)
            except (TypeError, ValueError):
                age = 0.0
            observe("tzudong_pipeline_queue_age_seconds", max(age, 0.0))
        else:
            observe("tzudong_pipeline_queue_age_seconds", 0)
    else:
        observe("tzudong_pipeline_queue_age_seconds", 0)
    observe_process()


def drain_once(send: SendFn | None = None, limit: int = CLAIM_LIMIT) -> int:
    observe_queue()
    mode = classify_events_mode(os.environ.get("TZUDONG_PIPELINE_EVENTS"))
    if mode != "kafka":
        return 0
    token, rows = claim_events(limit=limit)
    if not rows:
        return 0
    sender = send or publish_bytes
    acked: list[int] = []
    for row in rows:
        try:
            sender(str(row["topic"]), _payload_bytes(row))
            acked.append(int(row["id"]))
        except Exception:
            continue
    if acked:
        ack_events(acked, token)
    observe_queue()
    return len(acked)


def main() -> int:
    stop = threading.Event()

    def _stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    while not stop.is_set():
        drain_once()
        if stop.wait(1.0):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
