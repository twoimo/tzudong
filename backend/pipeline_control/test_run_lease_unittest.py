from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import store as store_module
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.persist import PersistError
from backend.pipeline_control.state_machine import ControlPlaneError, RunRecord
from backend.pipeline_control.store import LEASE_TTL_SECONDS, MemoryStore

STEP_LEASE_SECONDS = 7_500.0


class _Clock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class _LeaseContract:
    def make_store(self, clock: _Clock) -> MemoryStore:
        raise NotImplementedError

    def setUp(self) -> None:
        self.clock = _Clock()
        self.store = self.make_store(self.clock)

    def _enqueue(self, key: str, store: MemoryStore | None = None) -> RunRecord:
        run, _created = (store or self.store).create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key=key,
            payload={},
            actor="qa",
            request_id=f"req-{key}",
            dry_run=False,
        )
        return run

    def _claimed(self, key: str) -> RunRecord:
        claimed = self.store.claim(self._enqueue(key).id)
        assert claimed is not None
        return claimed

    def _assert_target_locked(self, key: str, store: MemoryStore | None = None) -> None:
        with self.assertRaises(ControlPlaneError) as held:
            self._enqueue(key, store)
        self.assertEqual(held.exception.code, "lock_held")

    def _assert_reclaimed(self, run: RunRecord) -> None:
        settled = self.store.get(run.id)
        self.assertEqual((settled.status, settled.error_code), ("Failed", "lease_expired"))

    def test_step_lease_keeps_the_lock_past_the_claim_ttl(self) -> None:
        run = self._claimed("lease-first-01")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.clock.advance(60)
        self._assert_target_locked("lease-second-1")
        self.assertEqual(self.store.get(run.id).status, "Fetching")

    def test_worker_dead_before_its_first_step_is_reclaimed_after_the_claim_ttl(self) -> None:
        run = self._claimed("dead-first-001")
        self.clock.advance(LEASE_TTL_SECONDS + 1)
        successor = self._enqueue("dead-second-01")
        self._assert_reclaimed(run)
        self.assertEqual(successor.status, "Queued")

    def test_worker_dead_during_a_step_is_reclaimed_after_the_step_lease(self) -> None:
        run = self._claimed("dead-step-0001")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.clock.advance(STEP_LEASE_SECONDS + 1)
        successor = self._enqueue("dead-step-0002")
        self._assert_reclaimed(run)
        self.assertEqual(successor.status, "Queued")

    def test_reclaimed_run_cannot_finish_over_its_successor(self) -> None:
        stale = self._claimed("stale-first-01")
        self.clock.advance(LEASE_TTL_SECONDS + 1)
        successor = self._enqueue("stale-second-1")
        for finish in (
            self.store.finish_succeeded,
            self.store.finish_dry_run,
            self.store.finish_failed,
        ):
            with self.subTest(finish=finish.__name__):
                finish(stale.id)
                self._assert_reclaimed(stale)
                self._assert_target_locked(f"stale-after-{finish.__name__}")
                self.assertEqual(self.store.get(successor.id).status, "Queued")

    def test_pause_and_resume_during_a_step_leave_the_run_with_its_worker(self) -> None:
        run = self._claimed("resume-step-01")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.store.control(run.id, "pause", actor="operator", request_id="req-pause")
        self.store.control(run.id, "resume", actor="operator", request_id="req-resume")
        self.clock.advance(10)
        self.assertIsNone(self.store.claim())
        self.clock.advance(LEASE_TTL_SECONDS)
        self._assert_target_locked("resume-step-02")
        self.assertEqual(self.store.get(run.id).status, "Fetching")

    def test_pause_during_a_step_takes_effect_at_the_next_step_boundary(self) -> None:
        run = self._claimed("pause-step-001")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.store.control(run.id, "pause", actor="operator", request_id="req-pause")
        self.clock.advance(LEASE_TTL_SECONDS + 1)
        self._assert_target_locked("pause-step-002")
        self.assertEqual(self.store.get(run.id).status, "Fetching")
        self.assertEqual(self.store.beat(run.id, STEP_LEASE_SECONDS).status, "Paused")
        self.assertEqual(self.store.audit[-1]["transition"], "pause_approved")
        resumed = self.store.control(run.id, "resume", actor="operator", request_id="req-resume")
        self.assertEqual(resumed.status, "Queued")

    def test_cancel_during_a_step_takes_effect_at_the_next_step_boundary(self) -> None:
        run = self._claimed("cancel-step-01")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        requested = self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual((requested.status, requested.cancel_requested), ("Fetching", True))
        self.clock.advance(LEASE_TTL_SECONDS + 1)
        self._assert_target_locked("cancel-step-02")
        self.assertEqual(self.store.beat(run.id, STEP_LEASE_SECONDS).status, "Cancelled")
        self.assertEqual(self.store.audit[-1]["transition"], "cancel_approved")
        self.assertEqual(self._enqueue("cancel-step-03").status, "Queued")

    def test_cancel_of_a_queued_or_paused_run_ends_it_at_once_and_records_the_request(self) -> None:
        queued = self._enqueue("cancel-queue-1")
        cancelled = self.store.control(queued.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual((cancelled.status, cancelled.cancel_requested), ("Cancelled", True))
        paused = self._enqueue("cancel-queue-2")
        self.store.control(paused.id, "pause", actor="operator", request_id="req-pause")
        cancelled = self.store.control(paused.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual((cancelled.status, cancelled.cancel_requested), ("Cancelled", True))
        self.assertEqual(self._enqueue("cancel-queue-3").status, "Queued")

    def test_cancel_wins_over_a_pause_that_waits_for_the_same_step_boundary(self) -> None:
        run = self._claimed("cancel-pause-1")
        self.store.control(run.id, "pause", actor="operator", request_id="req-pause")
        self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual(self.store.beat(run.id).status, "Cancelled")
        self.assertEqual(self._enqueue("cancel-pause-2").status, "Queued")

    def test_cancelled_run_of_a_dead_worker_keeps_its_target_until_the_lease_ends(self) -> None:
        run = self._claimed("cancel-dead-01")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.clock.advance(STEP_LEASE_SECONDS - 1)
        self._assert_target_locked("cancel-dead-02")
        self.clock.advance(2)
        successor = self._enqueue("cancel-dead-03")
        self._assert_reclaimed(run)
        self.assertEqual(successor.status, "Queued")

    def test_cancel_after_the_lease_ended_is_refused_and_records_the_run_lease_expired(self) -> None:
        run = self._claimed("cancel-late-01")
        self.clock.advance(LEASE_TTL_SECONDS + 1)
        with self.assertRaises(ControlPlaneError) as refused:
            self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual(refused.exception.code, "illegal_transition")
        self._assert_reclaimed(run)

    def test_cancel_during_the_last_step_leaves_the_finished_run_succeeded(self) -> None:
        run = self._claimed("cancel-last-01")
        self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual(self.store.finish_succeeded(run.id).status, "Succeeded")
        self.assertEqual(self._enqueue("cancel-last-02").status, "Queued")

    def test_terminal_record_holds_when_the_durable_mirror_fails(self) -> None:
        run = self._claimed("mirror-down-01")
        with patch.object(
            store_module, "persist_mutation", side_effect=PersistError("persist_failed")
        ):
            with self.assertRaises(PersistError):
                self.store.finish_failed(run.id, "worker_unexpected")
        settled = self.store.get(run.id)
        self.assertEqual((settled.status, settled.error_code), ("Failed", "worker_unexpected"))
        self.assertEqual(self._enqueue("mirror-down-02").status, "Queued")

    def test_heartbeat_for_a_cancelled_run_reports_cancelled_and_grants_no_lease(self) -> None:
        run = self._claimed("cancel-first-1")
        self.store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
        self.assertEqual(self.store.beat(run.id).status, "Cancelled")
        self.assertEqual(self._enqueue("cancel-second").status, "Queued")


class MemoryStoreLeaseTests(_LeaseContract, unittest.TestCase):
    def make_store(self, clock: _Clock) -> MemoryStore:
        return MemoryStore(clock=clock)


class FileStoreLeaseTests(_LeaseContract, unittest.TestCase):
    def make_store(self, clock: _Clock) -> MemoryStore:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return FileStore(Path(directory.name) / "store.json", clock=clock)

    def test_step_lease_is_honoured_by_another_process(self) -> None:
        run = self._claimed("shared-first-1")
        self.store.beat(run.id, STEP_LEASE_SECONDS)
        self.clock.advance(60)
        api_process = FileStore(self.store.path, clock=self.clock)
        self._assert_target_locked("shared-second", api_process)
        self.assertEqual(api_process.get(run.id).status, "Fetching")

    def test_enqueue_refused_by_the_durable_mirror_is_not_recorded(self) -> None:
        with patch.object(
            store_module, "persist_mutation", side_effect=PersistError("persist_failed")
        ):
            with self.assertRaises(PersistError):
                self._enqueue("mirror-down-03")
        _run, created = self.store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="mirror-down-03",
            payload={},
            actor="qa",
            request_id="req-mirror-down-03",
            dry_run=False,
        )
        self.assertTrue(created)


if __name__ == "__main__":
    unittest.main()
