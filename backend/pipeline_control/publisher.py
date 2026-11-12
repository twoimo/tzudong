"""Long-lived outbox publisher. Sends claimed rows to Kafka, then acks."""

from __future__ import annotations

import json
import os
import signal
import threading
import time
from typing import Any, Callable

from backend.pipeline_control.dsn_guard import DsnGuardError
from backend.pipeline_control.events import KafkaPublishError, classify_events_mode, publish_bytes
from backend.pipeline_control.metrics import observe, observe_process
from backend.pipeline_control.outbox import (
    CLAIM_LIMIT,
    OutboxError,
    ack_events,
    claim_events,
    unpublished_snapshot,
)
from backend.pipeline_control.pool import PoolError, close_pool

SendFn = Callable[[str, bytes], None]
RETRYABLE_STORAGE_CODES = frozenset(
    {"pool_connect_failed", "outbox_read_failed", "outbox_claim_failed", "outbox_ack_failed"}
)
RETRYABLE_SQLSTATES = frozenset({"40001", "40P01", "53300", "57P01", "57P02", "57P03"})


def _retryable_storage_error(error: PoolError | OutboxError) -> bool:
    if error.code not in RETRYABLE_STORAGE_CODES:
        return False
    terminal_types = (DsnGuardError, ImportError, TypeError, ValueError)
    try:
        from psycopg2 import NotSupportedError, ProgrammingError
    except ImportError:
        pass
    else:
        # libpq option/DSN errors may have no SQLSTATE. Do not classify them
        # as an unavailable database just because the pool wrapped the error.
        terminal_types += (NotSupportedError, ProgrammingError)
    cause: BaseException | None = error
    seen: set[int] = set()
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        # The outbox adapter wraps admission errors as read/claim/ack failures.
        # Preserve those terminal failures instead of retrying a forbidden DSN.
        if isinstance(cause, terminal_types):
            return False
        if isinstance(cause, (PoolError, OutboxError)) and cause.code not in RETRYABLE_STORAGE_CODES:
            return False
        state = getattr(cause, "pgcode", None)
        if state and not (state.startswith("08") or state in RETRYABLE_SQLSTATES):
            return False
        cause = cause.__cause__
    return True


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
        except KafkaPublishError as exc:
            if exc.code != "kafka_publish_failed":
                raise exc from None
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
        try:
            drain_once()
        except (PoolError, OutboxError) as exc:
            if not _retryable_storage_error(exc):
                raise exc from None
            # A connection interrupted after startup may be cached in the
            # process pool. Reconnect on the next stop-aware iteration.
            close_pool()
        if stop.wait(1.0):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
