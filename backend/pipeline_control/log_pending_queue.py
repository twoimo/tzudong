"""Log_Pipeline pending queue + status-decision separation (design B, reqs
13.11, 13.13).

When a Log_Sink delivery fails, the undelivered record must not be lost and must
not be duplicated on re-delivery. This module is the delivery buffer that
provides that guarantee. It reuses the memory-mode semantics already proven in
``outbox.py`` (design B explicitly says to reuse this structure):

- deterministic document id so the same record always maps to the same id, and
  re-delivery of the same record never creates a duplicate at the sink
  (``outbox.document_id`` style sha256 over stable fields);
- a claim batch bounded to at most ``CLAIM_LIMIT`` (= 50) records per retry;
- a stale-reclaim window of ``CLAIM_STALE_SECONDS`` (= 30s): a claimed but
  unacked record returns to the retry set after 30 seconds of occupancy;
- per-record retry (attempt) counting;
- removal from the queue only on *confirmed* delivery success (ack). A delivery
  failure leaves the record pending (nack releases the claim so it retries
  immediately; otherwise the stale window returns it).

Status-decision separation (requirement 13.11)
----------------------------------------------
Job status decisions and re-run decisions are made from ``Local_Database`` /
``Hosted_Database`` queries only. The Log_Sink is never a status source. This
module enforces that separation structurally:

- it is a *delivery buffer only*: it exposes no API that reads job status back
  from a Log_Sink, and it never consults a sink to decide anything;
- :func:`admit_status_source` is the single guard a status/re-run caller uses to
  assert its source; it admits only ``local_db`` / ``hosted_db`` and raises the
  bounded fixed code ``log_sink_not_status_source`` for ``log_sink`` (or any
  other value). Log_Sink delivery failure or unavailability therefore cannot
  affect status queries or job processing -- they read the database regardless.

This module holds an in-process (memory-mode) queue, matching ``outbox.py``'s
memory mode. It is deterministic and side-effect-free apart from its own state,
so the dedicated no-loss/no-duplicate property test (Property 32, Task 25.8) can
drive it directly. Only bounded fixed codes are surfaced; provider and database
error strings are never exposed (``AGENTS.md``).
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from typing import Any, Callable
from uuid import uuid4

# Reuse the proven bounds from the transactional outbox (design B): a retry
# batch is capped at 50 and a claim goes stale after 30 seconds. These are
# imported, not redefined, so the two queues stay in lock-step.
from backend.pipeline_control.outbox import CLAIM_LIMIT, CLAIM_STALE_SECONDS

# --- Status sources (requirement 13.11) -----------------------------------
# Job status / re-run decisions read only these sources. The Log_Sink is never
# one of them.
STATUS_SOURCES: frozenset[str] = frozenset({"local_db", "hosted_db"})

# --- Fixed codes ----------------------------------------------------------
# A status/re-run decision attempted to use the Log_Sink (or any non-DB source).
CODE_LOG_SINK_NOT_STATUS_SOURCE = "log_sink_not_status_source"

_queue_lock = threading.Lock()
_rows: list[dict[str, Any]] = []
_seq = 0


class LogPendingQueueError(Exception):
    """Bounded fixed-code error for the pending queue / status guard.

    ``code`` is always one of the enumerated fixed codes; no provider or
    database diagnostics are ever attached.
    """

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def admit_status_source(source: Any) -> str:
    """Admit a job-status / re-run decision source; reject the Log_Sink.

    Returns the source unchanged when it is a database source
    (``local_db`` / ``hosted_db``). Raises :class:`LogPendingQueueError` with
    ``log_sink_not_status_source`` for ``log_sink`` or any other value. This is
    the structural enforcement of requirement 13.11: status decisions never use
    a Log_Sink query as input.
    """
    if isinstance(source, str) and source in STATUS_SOURCES:
        return source
    raise LogPendingQueueError(CODE_LOG_SINK_NOT_STATUS_SOURCE)


def reset() -> None:
    """Clear the in-process queue (test/support hook, mirrors outbox.reset_memory)."""
    global _seq
    with _queue_lock:
        _rows.clear()
        _seq = 0


def document_id(record: Any) -> str:
    """Deterministic document id for a log record.

    Same record -> same id, so re-delivery of the same record never creates a
    duplicate at the sink (requirement 13.13). Mirrors ``outbox.document_id``'s
    sha256 approach, but hashes the canonical serialization of the whole record
    (sorted keys, compact separators) because a log record has no single natural
    key. Records that are not JSON-serializable fall back to their ``repr`` so
    an id can still be derived deterministically.
    """
    try:
        canonical = json.dumps(record, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        canonical = repr(record)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "document_id": row["document_id"],
        "record": row["record"],
        "attempts": row.get("attempts"),
        "created_at": row.get("created_at"),
    }


def enqueue(record: Any) -> dict[str, Any]:
    """Add a record to the pending queue, deduplicated by document id.

    If a record with the same document id is already pending (not yet delivered),
    the existing row is returned with ``created = False`` and no duplicate row is
    created. A record already delivered is treated as still-satisfied: re-adding
    it returns the delivered row with ``created = False`` so it is not resent.
    """
    global _seq
    doc_id = document_id(record)
    with _queue_lock:
        for existing in _rows:
            if existing["document_id"] == doc_id:
                return {
                    "id": existing["id"],
                    "document_id": doc_id,
                    "created": False,
                    "delivered": existing.get("delivered_at") is not None,
                }
        _seq += 1
        row = {
            "id": _seq,
            "document_id": doc_id,
            "record": record,
            "created_at": time.time(),
            "delivered_at": None,
            "claimed_at": None,
            "claim_token": None,
            "attempts": 0,
        }
        _rows.append(row)
        return {"id": _seq, "document_id": doc_id, "created": True, "delivered": False}


def pending_snapshot() -> list[dict[str, Any]]:
    """Return the records still awaiting confirmed delivery (undelivered)."""
    with _queue_lock:
        return [_public_row(row) for row in _rows if row.get("delivered_at") is None]


def pending_count() -> int:
    with _queue_lock:
        return sum(1 for row in _rows if row.get("delivered_at") is None)


def claim_batch(
    limit: int = CLAIM_LIMIT, claim_token: str | None = None, now: float | None = None
) -> tuple[str, list[dict[str, Any]]]:
    """Claim up to ``min(limit, CLAIM_LIMIT)`` undelivered records for a retry.

    A record is claimable when it is undelivered and either never claimed or its
    previous claim has been held for at least ``CLAIM_STALE_SECONDS`` (occupancy
    over 30s returns it to the retry set). Claiming increments the per-record
    attempt count and stamps the claim token. Mirrors ``outbox._memory_claim``.
    """
    token = claim_token or str(uuid4())
    bounded = min(max(int(limit), 1), CLAIM_LIMIT)
    stamp = time.time() if now is None else float(now)
    claimed: list[dict[str, Any]] = []
    with _queue_lock:
        for row in _rows:
            if row.get("delivered_at") is not None:
                continue
            claimed_at = row.get("claimed_at")
            if claimed_at is not None and stamp - float(claimed_at) < CLAIM_STALE_SECONDS:
                continue
            row["claimed_at"] = stamp
            row["claim_token"] = token
            row["attempts"] = int(row.get("attempts") or 0) + 1
            claimed.append(_public_row(row))
            if len(claimed) >= bounded:
                break
    return token, claimed


def ack(ids: list[int], claim_token: str) -> int:
    """Confirm delivery success: mark the acked records delivered.

    Only rows still held by ``claim_token`` and not already delivered are acked.
    Marking-on-confirmed-success (rather than dropping the row) is what makes the
    queue both lossless and duplicate-free: a record leaves the *pending* set
    only after delivery is confirmed, and its document id stays known so a later
    re-enqueue of the same record dedups instead of being resent (requirement
    13.13). This mirrors ``outbox._memory_ack`` setting ``published_at`` and
    keeping the row. Returns the number of records acked.
    """
    wanted = {int(item) for item in ids}
    stamp = time.time()
    acked = 0
    with _queue_lock:
        for row in _rows:
            if row["id"] not in wanted:
                continue
            if row.get("claim_token") != claim_token or row.get("delivered_at") is not None:
                continue
            row["delivered_at"] = stamp
            acked += 1
    return acked


def nack(ids: list[int], claim_token: str) -> int:
    """Delivery failed: release the claim so the record retries; keep it pending.

    The record is not removed (a failure never drops a record). Releasing the
    claim returns it to the retry set immediately; if not released, the
    ``CLAIM_STALE_SECONDS`` window returns it after 30s anyway. Returns the
    number of records released.
    """
    wanted = {int(item) for item in ids}
    released = 0
    with _queue_lock:
        for row in _rows:
            if row["id"] not in wanted:
                continue
            if row.get("claim_token") != claim_token or row.get("delivered_at") is not None:
                continue
            row["claimed_at"] = None
            row["claim_token"] = None
            released += 1
    return released


def deliver_once(
    sender: Callable[[list[dict[str, Any]]], set[int] | list[int]],
    limit: int = CLAIM_LIMIT,
    now: float | None = None,
) -> dict[str, Any]:
    """Claim one retry batch and attempt delivery through ``sender``.

    ``sender`` receives the claimed public rows (each with ``id``,
    ``document_id``, ``record``) and returns the set of row ids whose delivery it
    *confirmed*. Confirmed ids are acked (removed); every other claimed id is
    nacked (released, stays pending). If ``sender`` raises, the whole batch is
    nacked so nothing is lost -- the sender's diagnostic is never surfaced.

    Returns a bounded summary ``{claimed, acked, nacked}``. The batch size is
    always at most ``CLAIM_LIMIT`` (requirement 13.13).
    """
    token, batch = claim_batch(limit=limit, now=now)
    if not batch:
        return {"claimed": 0, "acked": 0, "nacked": 0}
    batch_ids = [row["id"] for row in batch]
    try:
        confirmed_raw = sender(batch)
        confirmed = {int(item) for item in confirmed_raw}
    except Exception:
        # Fail closed: any sender error leaves the entire batch pending. No
        # provider/transport diagnostic is inspected or surfaced.
        confirmed = set()
    confirmed &= set(batch_ids)
    acked = ack(list(confirmed), token) if confirmed else 0
    failed = [rid for rid in batch_ids if rid not in confirmed]
    nacked = nack(failed, token) if failed else 0
    return {"claimed": len(batch), "acked": acked, "nacked": nacked}


__all__ = [
    "CLAIM_LIMIT",
    "CLAIM_STALE_SECONDS",
    "CODE_LOG_SINK_NOT_STATUS_SOURCE",
    "STATUS_SOURCES",
    "LogPendingQueueError",
    "ack",
    "admit_status_source",
    "claim_batch",
    "deliver_once",
    "document_id",
    "enqueue",
    "nack",
    "pending_count",
    "pending_snapshot",
    "reset",
]
