"""Property-based test: pending-queue no-loss / no-duplicate (Property 32).

Feature: platform-modernization, Property 32: 보류 큐 손실·중복 부재
Validates: Requirement 13.13

Requirement 13.13 / design Property 32. For *every* sequence of delivery events
(a mix of delivery failure, delivery success, and claim-occupancy expiry),
``log_pending_queue`` (which reuses ``outbox.py`` memory-mode semantics) must
guarantee, at the end:

  * each distinct record reaches the Log_Sink **exactly once** -- no loss and no
    duplicate: a confirmed delivery is never re-claimed / re-delivered
    (deterministic ``document_id`` dedup), and a failed delivery stays pending
    and retries;
  * an enqueued record is *never dropped*: at all times it is either still
    pending or already delivered, never neither;
  * every retry claim batch is bounded to ``CLAIM_LIMIT`` (= 50); and
  * a claim held past ``CLAIM_STALE_SECONDS`` (= 30s) without ack/nack returns
    to the retry set, so an abandoned (crashed-worker) claim is not a loss.

Strategy
--------
This is a stateful model (:class:`hypothesis.stateful.RuleBasedStateMachine`).
The machine drives a random sequence of operations against the *real*
``log_pending_queue`` module:

  * ``enqueue`` distinct records drawn from a small keyed pool (so re-enqueue and
    the document-id dedup path are exercised);
  * ``deliver_once`` with a randomly-failing sender (a Hypothesis-drawn seed
    decides, per row, whether the sender confirms delivery -- deterministic and
    shrinkable, never wall-clock random);
  * ``claim_batch`` that is then *abandoned* with no ack/nack, simulating a
    crashed worker whose claim must return via the stale window; and
  * ``advance_clock`` to move virtual time forward past the 30s occupancy window.

A shadow model tracks every distinct record ever enqueued and every record the
sender has confirmed. Invariants are asserted continuously (no loss; confirmed
set matches the queue's delivered set; batch bound) plus at teardown, where the
queue is drained with an always-confirming sender and every enqueued record must
end delivered exactly once. The queue is reset between examples via the
``reset()`` test hook.

Runnable via ``python -m unittest backend.pipeline_control.test_log_queue_pbt``.
Requires ``hypothesis`` (the project ``.venv`` provides it).
"""

from __future__ import annotations

import unittest
from typing import Any

from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule

from backend.pipeline_control import log_pending_queue as q
from backend.pipeline_control.log_pending_queue import CLAIM_LIMIT, CLAIM_STALE_SECONDS

# A small keyed pool of distinct records. Keeping the key space small forces
# frequent re-enqueue of the same record, which exercises the deterministic
# document-id dedup path (no duplicate row, no re-delivery of a delivered
# record). Each distinct key maps to a distinct, JSON-serializable record.
_KEY_SPACE = 8


def _record(key: int) -> dict[str, Any]:
    """Build a distinct, deterministic log record for a pool key."""
    return {
        "component": "backend_runtime",
        "occurred_at": "2026-01-01T00:00:00.000Z",
        "correlation_id": f"corr-{key:04d}",
        "severity": "info",
        "type": "run.lifecycle",
        "status": "started",
        "key": key,
    }


def _pending_doc_ids() -> set[str]:
    """Document ids of records still awaiting confirmed delivery."""
    return {row["document_id"] for row in q.pending_snapshot()}


class PendingQueueMachine(RuleBasedStateMachine):
    """Stateful model of the pending queue's no-loss / no-duplicate contract."""

    def __init__(self) -> None:
        super().__init__()
        q.reset()
        # Shadow model.
        self.enqueued: dict[str, dict[str, Any]] = {}  # document_id -> record
        self.delivered: set[str] = set()  # document_ids the sender confirmed
        self.delivery_count: dict[str, int] = {}  # document_id -> #confirmations
        self.clock: float = 1000.0  # virtual time for the stale window

    # --- Rules: the random operation sequence ------------------------------
    @rule(key=st.integers(min_value=0, max_value=_KEY_SPACE - 1))
    def enqueue(self, key: int) -> None:
        record = _record(key)
        doc_id = q.document_id(record)
        already_delivered = doc_id in self.delivered
        was_known = doc_id in self.enqueued

        result = q.enqueue(record)

        # First time we see this record -> a new pending row is created.
        # A re-enqueue (known record) -> deduped, never a second row.
        if was_known:
            assert result["created"] is False
            # A re-enqueue of an already-delivered record must report delivered
            # and must NOT resurrect it into the pending set (no re-delivery).
            assert result["delivered"] is already_delivered
        else:
            assert result["created"] is True
            assert result["delivered"] is False
            self.enqueued[doc_id] = record

    @rule(seed=st.integers(min_value=0, max_value=2**32 - 1))
    def deliver(self, seed: int) -> None:
        """Attempt one delivery batch through a deterministically-failing sender."""
        confirmed_docs: set[str] = set()

        def sender(batch: list[dict[str, Any]]) -> set[int]:
            # Every claim batch must be bounded by CLAIM_LIMIT (13.13).
            assert len(batch) <= CLAIM_LIMIT
            picked: set[int] = set()
            for row in batch:
                doc = row["document_id"]
                # A confirmed (delivered) record must never be claimed again:
                # this is the no-duplicate guarantee at the queue level.
                assert doc not in self.delivered, "delivered record was re-claimed"
                # Deterministic per-row success decision (shrinkable via seed).
                if (int(row["id"]) * 2654435761 + seed) % 3 != 0:
                    picked.add(int(row["id"]))
                    confirmed_docs.add(doc)
            return picked

        summary = q.deliver_once(sender, now=self.clock)

        # The claim batch the queue handed the sender is bounded.
        assert summary["claimed"] <= CLAIM_LIMIT
        # Exactly the confirmed rows are acked; the rest stay pending.
        assert summary["acked"] == len(confirmed_docs)
        assert summary["nacked"] == summary["claimed"] - summary["acked"]

        for doc in confirmed_docs:
            self.delivery_count[doc] = self.delivery_count.get(doc, 0) + 1
            # Exactly-once: a record is never confirmed a second time.
            assert self.delivery_count[doc] == 1
            self.delivered.add(doc)

    @rule(seed=st.integers(min_value=0, max_value=2**32 - 1))
    def abandon_claim(self, seed: int) -> None:
        """Claim a batch and abandon it (crashed worker): no ack, no nack.

        The claimed records are now occupied and must not be re-claimed until
        the 30s stale window elapses -- but they must never be lost.
        """
        _token, batch = q.claim_batch(now=self.clock)
        assert len(batch) <= CLAIM_LIMIT
        # Intentionally drop the claim: no ack/nack. The stale window (exercised
        # by advance_clock) is what returns these records to the retry set.

    @rule(dt=st.floats(min_value=0.0, max_value=90.0, allow_nan=False))
    def advance_clock(self, dt: float) -> None:
        self.clock += dt

    # --- Invariants: checked after every rule ------------------------------
    @invariant()
    def no_record_is_lost(self) -> None:
        # Every enqueued record is either pending or delivered -- never dropped.
        pending = _pending_doc_ids()
        for doc in self.enqueued:
            assert doc in pending or doc in self.delivered, "record lost"
        # Delivered and pending are disjoint: a delivered record has left the
        # pending set (so it cannot be re-delivered).
        assert pending.isdisjoint(self.delivered)

    @invariant()
    def delivered_set_matches_queue(self) -> None:
        # The queue's delivered set (enqueued minus still-pending) must equal
        # the sender-confirmed set the model tracked -- no phantom deliveries.
        pending = _pending_doc_ids()
        queue_delivered = set(self.enqueued) - pending
        assert queue_delivered == self.delivered

    @invariant()
    def each_confirmation_is_unique(self) -> None:
        assert all(count == 1 for count in self.delivery_count.values())

    # --- Teardown: drain and assert exactly-once delivery ------------------
    def teardown(self) -> None:
        try:
            # Move well past the stale window so any abandoned claim returns,
            # then drain the queue with an always-confirming sender.
            drained: dict[str, int] = {}

            def drain_sender(batch: list[dict[str, Any]]) -> set[int]:
                assert len(batch) <= CLAIM_LIMIT
                out: set[int] = set()
                for row in batch:
                    doc = row["document_id"]
                    assert doc not in self.delivered, "delivered record re-claimed on drain"
                    drained[doc] = drained.get(doc, 0) + 1
                    out.add(int(row["id"]))
                return out

            for _ in range(2000):
                self.clock += CLAIM_STALE_SECONDS + 1.0
                summary = q.deliver_once(drain_sender, now=self.clock)
                if summary["claimed"] == 0:
                    break

            # No loss: nothing left pending after the drain.
            assert q.pending_count() == 0
            # Exactly once, overall: every enqueued record was confirmed exactly
            # once across the run + drain, and nothing spurious was delivered.
            total = dict(self.delivery_count)
            for doc, count in drained.items():
                total[doc] = total.get(doc, 0) + count
            assert set(total) == set(self.enqueued)
            assert all(count == 1 for count in total.values())
        finally:
            q.reset()


PendingQueueMachine.TestCase.settings = settings(
    max_examples=100,
    deadline=None,
    stateful_step_count=40,
)

# unittest entry point for the stateful machine.
PendingQueuePropertyTests = PendingQueueMachine.TestCase


class PendingQueueAnchorTests(unittest.TestCase):
    """Concrete anchor examples pinning the Property 32 invariants."""

    def setUp(self) -> None:
        q.reset()

    def tearDown(self) -> None:
        q.reset()

    def test_failed_then_succeeded_delivers_exactly_once(self) -> None:
        q.enqueue(_record(1))
        # First attempt fails -> stays pending, no delivery.
        s1 = q.deliver_once(lambda batch: set())
        self.assertEqual(s1["acked"], 0)
        self.assertEqual(q.pending_count(), 1)
        # Second attempt succeeds -> delivered exactly once, none pending.
        s2 = q.deliver_once(lambda batch: {int(r["id"]) for r in batch})
        self.assertEqual(s2["acked"], 1)
        self.assertEqual(q.pending_count(), 0)

    def test_delivered_record_is_never_reclaimed(self) -> None:
        q.enqueue(_record(1))
        q.deliver_once(lambda batch: {int(r["id"]) for r in batch})
        # A subsequent delivery pass claims nothing (record already delivered).
        s = q.deliver_once(lambda batch: {int(r["id"]) for r in batch})
        self.assertEqual(s["claimed"], 0)
        # Re-enqueue of the same record does not resurrect it.
        again = q.enqueue(_record(1))
        self.assertFalse(again["created"])
        self.assertTrue(again["delivered"])
        self.assertEqual(q.pending_count(), 0)

    def test_abandoned_claim_returns_after_stale_window(self) -> None:
        q.enqueue(_record(1))
        base = 5000.0
        # Claim and abandon (no ack/nack).
        q.claim_batch(now=base)
        self.assertEqual(len(q.claim_batch(now=base + 5.0)[1]), 0)
        # Past the 30s occupancy window: returns to the retry set, not lost.
        _t, batch = q.claim_batch(now=base + CLAIM_STALE_SECONDS + 0.1)
        self.assertEqual(len(batch), 1)

    def test_claim_batch_bounded_to_limit(self) -> None:
        for i in range(CLAIM_LIMIT + 30):
            q.enqueue(_record(i))
        s = q.deliver_once(lambda batch: set(), limit=1000)
        self.assertLessEqual(s["claimed"], CLAIM_LIMIT)
        self.assertEqual(s["claimed"], CLAIM_LIMIT)


if __name__ == "__main__":
    unittest.main()
