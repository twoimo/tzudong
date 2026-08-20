"""Transactional outbox for pipeline Kafka events. Default off with FileStore."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Any
from uuid import uuid4

from backend.pipeline_control.pool import PoolError, connection

CLAIM_LIMIT = 50
CLAIM_STALE_SECONDS = 30.0
ALLOWED_TYPES = frozenset({"run.lifecycle", "step.progress", "record.upserted"})
ALLOWED_MODES = frozenset({"none", "memory", "postgres"})

_memory_lock = threading.Lock()
_memory_rows: list[dict[str, Any]] = []
_memory_seq = 0


class OutboxError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def reset_memory() -> None:
    global _memory_seq
    with _memory_lock:
        _memory_rows.clear()
        _memory_seq = 0


def classify_outbox_mode(raw: str | None = None, store: str | None = None) -> str:
    value = (
        raw
        if raw is not None
        else os.environ.get("TZUDONG_PIPELINE_OUTBOX", "")
    ).strip()
    if value == "":
        return "none"
    if value not in ALLOWED_MODES:
        raise OutboxError("outbox_mode_invalid")
    return value


def event_id(event: dict[str, Any]) -> str:
    parts = [
        str(event.get("type") or ""),
        str(event.get("job_id") or ""),
        str(event.get("step") or ""),
        str(event.get("status") or ""),
        "" if event.get("index") is None else str(event.get("index")),
        "" if event.get("skipped") is None else str(event.get("skipped")),
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def document_id(event: dict[str, Any]) -> str:
    return event_id(event)


def unpublished_snapshot() -> list[dict[str, Any]]:
    mode = classify_outbox_mode()
    if mode == "none":
        return []
    if mode == "memory":
        with _memory_lock:
            return [dict(row) for row in _memory_rows if row.get("published_at") is None]
    return _sql_unpublished()


def enqueue_event(event: dict[str, Any]) -> dict[str, Any]:
    from backend.pipeline_control.events import allowlisted_event, resolve_topic

    body = allowlisted_event(event)
    event_type = body.get("type")
    if not isinstance(event_type, str) or event_type not in ALLOWED_TYPES:
        raise OutboxError("outbox_event_type_unknown")
    topic = resolve_topic(event_type)
    eid = event_id(body)
    record = {
        "type": event_type,
        "event_id": eid,
        "document_id": eid,
        "topic": topic,
        "job_id": body.get("job_id"),
        "payload": body,
    }
    mode = classify_outbox_mode()
    if mode == "none":
        raise OutboxError("outbox_mode_invalid")
    if mode == "memory":
        return _memory_enqueue(record)
    return _sql_enqueue(record)


def claim_events(limit: int = CLAIM_LIMIT, claim_token: str | None = None) -> tuple[str, list[dict[str, Any]]]:
    token = claim_token or str(uuid4())
    bounded = min(max(int(limit), 1), CLAIM_LIMIT)
    mode = classify_outbox_mode()
    if mode == "none":
        return token, []
    if mode == "memory":
        return token, _memory_claim(bounded, token)
    return token, _sql_claim(bounded, token)


def ack_events(ids: list[int], claim_token: str) -> int:
    mode = classify_outbox_mode()
    if mode == "none":
        return 0
    if mode == "memory":
        return _memory_ack(ids, claim_token)
    return _sql_ack(ids, claim_token)


def _memory_enqueue(record: dict[str, Any]) -> dict[str, Any]:
    global _memory_seq
    with _memory_lock:
        for existing in _memory_rows:
            if existing["event_id"] == record["event_id"]:
                return {
                    "id": existing["id"],
                    "event_id": existing["event_id"],
                    "document_id": existing["document_id"],
                    "topic": existing["topic"],
                    "created": False,
                }
        _memory_seq += 1
        row = {
            **record,
            "id": _memory_seq,
            "created_at": time.time(),
            "published_at": None,
            "claimed_at": None,
            "claim_token": None,
            "attempts": 0,
        }
        _memory_rows.append(row)
        return {
            "id": row["id"],
            "event_id": row["event_id"],
            "document_id": row["document_id"],
            "topic": row["topic"],
            "created": True,
        }


def _memory_claim(limit: int, token: str) -> list[dict[str, Any]]:
    now = time.time()
    claimed: list[dict[str, Any]] = []
    with _memory_lock:
        for row in _memory_rows:
            if row.get("published_at") is not None:
                continue
            claimed_at = row.get("claimed_at")
            if claimed_at is not None and now - float(claimed_at) < CLAIM_STALE_SECONDS:
                continue
            row["claimed_at"] = now
            row["claim_token"] = token
            row["attempts"] = int(row.get("attempts") or 0) + 1
            claimed.append(_public_row(row))
            if len(claimed) >= limit:
                break
    return claimed


def _memory_ack(ids: list[int], token: str) -> int:
    wanted = {int(item) for item in ids}
    acked = 0
    now = time.time()
    with _memory_lock:
        for row in _memory_rows:
            if row["id"] not in wanted:
                continue
            if row.get("claim_token") != token or row.get("published_at") is not None:
                continue
            row["published_at"] = now
            acked += 1
    return acked


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "event_id": row["event_id"],
        "job_id": row.get("job_id"),
        "event_type": row.get("type") or row.get("event_type"),
        "topic": row["topic"],
        "payload": row["payload"],
        "document_id": row["document_id"],
        "created_at": row.get("created_at"),
        "attempts": row.get("attempts"),
    }


def _load_psycopg2() -> Any:
    import psycopg2
    from psycopg2.extras import Json

    return psycopg2, Json


def _decode(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def _sql_enqueue(record: dict[str, Any]) -> dict[str, Any]:
    try:
        with connection() as conn:
            try:
                _psycopg2, Json = _load_psycopg2()
            except ImportError as exc:
                raise PoolError("psycopg2_missing") from exc
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pipeline_control.enqueue_outbox(%s::jsonb)",
                    (Json(record),),
                )
                row = cur.fetchone()
    except PoolError:
        raise
    except Exception as exc:
        raise OutboxError("outbox_enqueue_failed") from exc
    if not row:
        raise OutboxError("outbox_enqueue_failed")
    payload = _decode(row[0])
    if not isinstance(payload, dict):
        raise OutboxError("outbox_enqueue_failed")
    return payload


def _sql_claim(limit: int, token: str) -> list[dict[str, Any]]:
    try:
        with connection() as conn:
            try:
                _psycopg2, Json = _load_psycopg2()
            except ImportError as exc:
                raise PoolError("psycopg2_missing") from exc
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pipeline_control.claim_outbox(%s, %s::uuid)",
                    (limit, token),
                )
                row = cur.fetchone()
    except PoolError:
        raise
    except Exception as exc:
        raise OutboxError("outbox_claim_failed") from exc
    payload = _decode(row[0]) if row else []
    if payload is None:
        return []
    if not isinstance(payload, list):
        raise OutboxError("outbox_claim_failed")
    return payload


def _sql_ack(ids: list[int], token: str) -> int:
    try:
        with connection() as conn:
            try:
                _psycopg2, Json = _load_psycopg2()
            except ImportError as exc:
                raise PoolError("psycopg2_missing") from exc
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT pipeline_control.ack_outbox(%s::bigint[], %s::uuid)",
                    (ids, token),
                )
                row = cur.fetchone()
    except PoolError:
        raise
    except Exception as exc:
        raise OutboxError("outbox_ack_failed") from exc
    payload = _decode(row[0]) if row else {"acked": 0}
    if not isinstance(payload, dict):
        raise OutboxError("outbox_ack_failed")
    return int(payload.get("acked") or 0)


def _sql_unpublished() -> list[dict[str, Any]]:
    try:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, event_id, job_id, event_type, topic, payload, document_id, created_at, attempts
                    FROM pipeline_control.outbox
                    WHERE published_at IS NULL
                    ORDER BY id
                    """
                )
                rows = cur.fetchall()
    except PoolError:
        raise
    except Exception as exc:
        raise OutboxError("outbox_read_failed") from exc
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                "id": row[0],
                "event_id": row[1],
                "job_id": row[2],
                "event_type": row[3],
                "topic": row[4],
                "payload": _decode(row[5]),
                "document_id": row[6],
                "created_at": row[7],
                "attempts": row[8],
            }
        )
    return result
