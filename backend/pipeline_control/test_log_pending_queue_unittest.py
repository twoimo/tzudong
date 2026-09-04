"""Unit tests for the Log_Pipeline pending queue + status separation (Task 24).

Covers Requirements 13.11 and 13.13:

- R13.13: on delivery failure the record stays pending; it is removed only after
  confirmed success; per-record retry count is kept; a retry batch is <= 50;
  a claim held past 30s returns to the retry set; the same record's re-delivery
  never creates a duplicate (deterministic document id + dedup).
- R13.11: job status / re-run decisions read Local/Hosted DB only; the Log_Sink
  is never a status source.

The dedicated no-loss/no-duplicate property test (Property 32, Task 25.8) is
separate; these unit tests pin the specific examples and edge cases.

Runnable via ``python -m unittest``.
"""

from __future__ import annotations

import unittest

from backend.pipeline_control import log_pending_queue as q
from backend.pipeline_control.log_pending_queue import (
    CLAIM_LIMIT,
    CLAIM_STALE_SECONDS,
    CODE_LOG_SINK_NOT_STATUS_SOURCE,
    LogPendingQueueError,
)
from backend.pipeline_control.outbox import CLAIM_LIMIT as OUTBOX_CLAIM_LIMIT
from backend.pipeline_control.outbox import CLAIM_STALE_SECONDS as OUTBOX_STALE


def _record(i: int) -> dict[str, object]:
    return {
        "component": "backend_runtime",
        "occurred_at": "2026-01-01T00:00:00.000Z",
        "correlation_id": f"corr-{i:04d}",
        "severity": "info",
        "type": "run.lifecycle",
        "status": "started",
    }


class ReuseOutboxBoundsTests(unittest.TestCase):
    def test_bounds_are_reused_from_outbox_not_redefined(self) -> None:
        self.assertEqual(CLAIM_LIMIT, OUTBOX_CLAIM_LIMIT)
        self.assertEqual(CLAIM_LIMIT, 50)
        self.assertEqual(CLAIM_STALE_SECONDS, OUTBOX_STALE)
        self.assertEqual(CLAIM_STALE_SECONDS, 30.0)


class DeterministicDedupTests(unittest.TestCase):
    def setUp(self) -> None:
        q.reset()

    def test_same_record_same_document_id(self) -> None:
        self.assertEqual(q.document_id(_record(1)), q.document_id(_record(1)))

    def test_different_record_different_document_id(self) -> None:
        self.assertNotEqual(q.document_id(_record(1)), q.document_id(_record(2)))

    def test_enqueue_dedups_by_document_id(self) -> None:
        first = q.enqueue(_record(1))
        second = q.enqueue(_record(1))
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(q.pending_count(), 1)

    def test_unserializable_record_still_gets_deterministic_id(self) -> None:
        obj = object()
        # repr of a bare object embeds its id(); reuse the same object so the id
        # is stable within the test.
        self.assertEqual(q.document_id(obj), q.document_id(obj))


class ClaimAckNackTests(unittest.TestCase):
    def setUp(self) -> None:
        q.reset()

    def test_failure_keeps_record_pending_success_removes_it(self) -> None:
        q.enqueue(_record(1))
        token, batch = q.claim_batch()
        self.assertEqual(len(batch), 1)
        # Delivery failure -> nack -> still pending.
        self.assertEqual(q.nack([batch[0]["id"]], token), 1)
        self.assertEqual(q.pending_count(), 1)
        # Confirmed success -> ack -> removed.
        token2, batch2 = q.claim_batch()
        self.assertEqual(q.ack([batch2[0]["id"]], token2), 1)
        self.assertEqual(q.pending_count(), 0)

    def test_ack_requires_matching_claim_token(self) -> None:
        q.enqueue(_record(1))
        _token, batch = q.claim_batch()
        self.assertEqual(q.ack([batch[0]["id"]], "wrong-token"), 0)
        self.assertEqual(q.pending_count(), 1)

    def test_per_record_attempt_count_increments_on_each_claim(self) -> None:
        q.enqueue(_record(1))
        _t1, b1 = q.claim_batch()
        self.assertEqual(b1[0]["attempts"], 1)
        # Release and reclaim -> attempts increments.
        q.nack([b1[0]["id"]], _t1)
        _t2, b2 = q.claim_batch()
        self.assertEqual(b2[0]["attempts"], 2)

    def test_retry_batch_is_bounded_to_claim_limit(self) -> None:
        for i in range(CLAIM_LIMIT + 25):
            q.enqueue(_record(i))
        _token, batch = q.claim_batch(limit=1000)
        self.assertLessEqual(len(batch), CLAIM_LIMIT)
        self.assertEqual(len(batch), CLAIM_LIMIT)

    def test_claimed_record_is_not_reclaimed_within_stale_window(self) -> None:
        q.enqueue(_record(1))
        base = 1000.0
        _t1, b1 = q.claim_batch(now=base)
        self.assertEqual(len(b1), 1)
        # 10s later: still occupied, not reclaimable.
        _t2, b2 = q.claim_batch(now=base + 10.0)
        self.assertEqual(len(b2), 0)

    def test_claim_returns_after_stale_window(self) -> None:
        q.enqueue(_record(1))
        base = 1000.0
        q.claim_batch(now=base)
        # Past the 30s occupancy window -> back in the retry set.
        _t2, b2 = q.claim_batch(now=base + CLAIM_STALE_SECONDS + 0.1)
        self.assertEqual(len(b2), 1)

    def test_no_duplicate_delivery_after_reenqueue_of_same_record(self) -> None:
        q.enqueue(_record(1))
        token, batch = q.claim_batch()
        q.ack([batch[0]["id"]], token)
        # Re-enqueue the identical record: dedup by document id means no new row.
        again = q.enqueue(_record(1))
        self.assertFalse(again["created"])
        self.assertEqual(q.pending_count(), 0)


class DeliverOnceTests(unittest.TestCase):
    def setUp(self) -> None:
        q.reset()

    def test_deliver_once_acks_confirmed_and_keeps_failed(self) -> None:
        for i in range(3):
            q.enqueue(_record(i))

        # Sender confirms only the first row id.
        def sender(batch: list[dict[str, object]]) -> set[int]:
            return {int(batch[0]["id"])}

        summary = q.deliver_once(sender)
        self.assertEqual(summary["claimed"], 3)
        self.assertEqual(summary["acked"], 1)
        self.assertEqual(summary["nacked"], 2)
        self.assertEqual(q.pending_count(), 2)

    def test_deliver_once_sender_exception_keeps_whole_batch(self) -> None:
        q.enqueue(_record(1))

        def boom(_batch: list[dict[str, object]]) -> set[int]:
            raise RuntimeError("provider-detail-should-not-leak")

        summary = q.deliver_once(boom)
        self.assertEqual(summary["acked"], 0)
        self.assertEqual(q.pending_count(), 1)

    def test_deliver_once_empty_queue_is_noop(self) -> None:
        summary = q.deliver_once(lambda batch: {int(r["id"]) for r in batch})
        self.assertEqual(summary, {"claimed": 0, "acked": 0, "nacked": 0})


class StatusSourceSeparationTests(unittest.TestCase):
    def test_database_sources_are_admitted(self) -> None:
        self.assertEqual(q.admit_status_source("local_db"), "local_db")
        self.assertEqual(q.admit_status_source("hosted_db"), "hosted_db")

    def test_log_sink_is_rejected_with_fixed_code(self) -> None:
        with self.assertRaises(LogPendingQueueError) as ctx:
            q.admit_status_source("log_sink")
        self.assertEqual(ctx.exception.code, CODE_LOG_SINK_NOT_STATUS_SOURCE)

    def test_arbitrary_source_is_rejected(self) -> None:
        for bad in ("elasticsearch", "loki", "", None, 123):
            with self.assertRaises(LogPendingQueueError):
                q.admit_status_source(bad)


if __name__ == "__main__":
    unittest.main()
