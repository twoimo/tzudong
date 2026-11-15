from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from backend.pipeline_control import live_run
from backend.pipeline_control.adapter import default_live_runner
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.graph import STEP_SPECS
from backend.pipeline_control.live_run import run_once
from backend.pipeline_control.persist import PersistError
from backend.pipeline_control.state_machine import ControlPlaneError, RunRecord
from backend.pipeline_control.store import LEASE_TTL_SECONDS, MemoryStore
from backend.pipeline_control.worker import process_one

STEP_TIMEOUT_ENV = "TZUDONG_PIPELINE_STEP_TIMEOUT_SECONDS"
DAY = 86_400.0


class _Clock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@contextmanager
def _local_pipeline(**extra: str) -> Iterator[Path]:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        environment = {
            "PATH": os.environ.get("PATH", ""),
            "TZUDONG_DATA_ENV": "local_db",
            "TZUDONG_DATA_SINK": "local_db",
            "PIPELINE_CONTROL_DSN": "postgresql://tzudong@127.0.0.1:54322/postgres",
            "RUN_DAILY_EXECUTION_SHA": "a" * 40,
            "VIDEO_CACHE_DIR": str(root / "video-cache"),
            **extra,
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(
            live_run, "CANDIDATE_DIR", root / "live-runs"
        ), redirect_stdout(io.StringIO()):
            yield root


def _enqueue(
    store: MemoryStore,
    target: str = "tzuyang",
    key: str = "lifecycle-0001",
) -> RunRecord:
    run, _created = store.create_run(
        target=target,
        profile="heavy_local",
        idempotency_key=key,
        payload={},
        actor="qa",
        request_id=f"req-{key}",
        dry_run=False,
    )
    return run


def _claimed(store: MemoryStore, target: str, key: str) -> RunRecord:
    claimed = store.claim(_enqueue(store, target, key).id)
    assert claimed is not None
    return claimed


def _target_status(store: MemoryStore, target: str) -> str:
    return store.operator_snapshot([{"id": target}])["targets"][0]["status"]


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class LiveStepLeaseTests(unittest.TestCase):
    def test_step_longer_than_the_claim_ttl_keeps_its_run_and_lock(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        run = _enqueue(store)

        def minute_long_step(argv: list[str]) -> int:
            clock.advance(60)
            with self.assertRaises(ControlPlaneError) as held:
                _enqueue(store, key="lifecycle-rival")
            self.assertEqual(held.exception.code, "lock_held")
            return 0

        with _local_pipeline() as root:
            result = process_one(
                store, live=True, runner=minute_long_step, manifest_path=root / "summary.json"
            )

        self.assertEqual(result, "Succeeded")
        self.assertEqual(store.get(run.id).status, "Succeeded")

    def test_worker_that_outlived_its_lease_stops_and_reports_failed(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        run = _enqueue(store)
        steps: list[list[str]] = []

        def step_on_a_suspended_host(argv: list[str]) -> int:
            steps.append(argv)
            clock.advance(DAY)
            _enqueue(store, key="lifecycle-next")
            return 0

        with _local_pipeline() as root:
            result = process_one(
                store,
                live=True,
                runner=step_on_a_suspended_host,
                manifest_path=root / "summary.json",
            )
            manifest = _read(root / "summary.json")

        self.assertEqual(result, "Failed")
        self.assertEqual(len(steps), 1)
        reclaimed = store.get(run.id)
        self.assertEqual((reclaimed.status, reclaimed.error_code), ("Failed", "lease_expired"))
        self.assertEqual(_target_status(store, "tzuyang"), "Queued")
        self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("ERROR", run.id))

    def test_run_reclaimed_during_its_last_step_is_not_reported_succeeded(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        run = _enqueue(store)

        def last_step_on_a_suspended_host(argv: list[str]) -> int:
            if STEP_SPECS[-1].script in argv:
                clock.advance(DAY)
                _enqueue(store, key="lifecycle-next")
            return 0

        with _local_pipeline() as root:
            result = process_one(
                store,
                live=True,
                runner=last_step_on_a_suspended_host,
                manifest_path=root / "summary.json",
            )
            manifest = _read(root / "summary.json")

        self.assertEqual(result, "Failed")
        self.assertEqual(store.get(run.id).error_code, "lease_expired")
        self.assertEqual(_target_status(store, "tzuyang"), "Queued")
        self.assertEqual(manifest["finalStatus"], "ERROR")

    def test_pause_and_resume_during_a_step_leave_the_run_with_its_worker(self) -> None:
        for waited in (10.0, LEASE_TTL_SECONDS + 1):
            with self.subTest(waited=waited):
                clock = _Clock()
                store = MemoryStore(clock=clock)
                run = _enqueue(store)
                during_step: dict[str, object] = {}

                def step_paused_and_resumed_by_the_operator(argv: list[str]) -> int:
                    if during_step:
                        return 0
                    store.control(run.id, "pause", actor="operator", request_id="req-pause")
                    store.control(run.id, "resume", actor="operator", request_id="req-resume")
                    clock.advance(waited)
                    during_step["second worker claimed"] = store.claim() is not None
                    try:
                        _enqueue(store, key="lifecycle-rival")
                        during_step["rival"] = "created"
                    except ControlPlaneError as refused:
                        during_step["rival"] = refused.code
                    return 0

                with _local_pipeline() as root:
                    result = process_one(
                        store,
                        live=True,
                        runner=step_paused_and_resumed_by_the_operator,
                        manifest_path=root / "summary.json",
                    )

                self.assertEqual(
                    during_step, {"second worker claimed": False, "rival": "lock_held"}
                )
                self.assertEqual((result, store.get(run.id).status), ("Succeeded", "Succeeded"))

    def test_pause_during_a_step_stops_the_worker_at_the_next_step(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        run = _enqueue(store)
        steps: list[list[str]] = []

        def step_paused_by_the_operator(argv: list[str]) -> int:
            steps.append(argv)
            store.control(run.id, "pause", actor="operator", request_id="req-pause")
            clock.advance(LEASE_TTL_SECONDS + 1)
            return 0

        with _local_pipeline() as root:
            result = process_one(
                store, live=True, runner=step_paused_by_the_operator, manifest_path=root / "summary.json"
            )
            manifest = _read(root / "summary.json")

        self.assertEqual((result, len(steps)), ("Paused", 1))
        self.assertEqual(store.get(run.id).status, "Paused")
        self.assertEqual(_target_status(store, "tzuyang"), "Paused")
        self.assertEqual(manifest["finalStatus"], "ERROR")

    def test_operator_cancel_during_a_step_ends_the_run_cancelled(self) -> None:
        store = MemoryStore(clock=_Clock())
        run = _enqueue(store)
        steps: list[list[str]] = []

        def step_cancelled_by_the_operator(argv: list[str]) -> int:
            steps.append(argv)
            store.control(run.id, "cancel", actor="operator", request_id="req-cancel")
            return 0

        with _local_pipeline() as root:
            result = process_one(
                store,
                live=True,
                runner=step_cancelled_by_the_operator,
                manifest_path=root / "summary.json",
            )
            manifest = _read(root / "summary.json")

        self.assertEqual(result, "Cancelled")
        self.assertEqual(len(steps), 1)
        self.assertEqual(store.get(run.id).status, "Cancelled")
        self.assertEqual(manifest["finalStatus"], "ERROR")


class HungStepTests(unittest.TestCase):
    def test_hung_step_fails_the_run(self) -> None:
        store = MemoryStore(clock=_Clock())
        run = _enqueue(store)
        steps: list[list[str]] = []

        def first_step_hangs(argv: list[str]) -> int:
            steps.append(argv)
            if len(steps) > 1:
                return 0
            return default_live_runner([sys.executable, "-c", "import time; time.sleep(5)"])

        with _local_pipeline(**{STEP_TIMEOUT_ENV: "0.3"}) as root:
            result = process_one(
                store, live=True, runner=first_step_hangs, manifest_path=root / "summary.json"
            )
            manifest = _read(root / "summary.json")

        self.assertEqual(result, "Failed")
        self.assertEqual(len(steps), 1)
        self.assertEqual(store.get(run.id).status, "Failed")
        self.assertEqual(_target_status(store, "tzuyang"), "Idle")
        self.assertEqual(manifest["finalStatus"], "ERROR")
        self.assertEqual(manifest["failedRequiredSteps"], ["Step 1 (URL Collection)"])


class UnexpectedErrorTests(unittest.TestCase):
    def test_error_in_a_step_fails_the_run_and_is_raised(self) -> None:
        for error, code in (
            (RuntimeError("step runner broke"), "worker_unexpected"),
            (KeyboardInterrupt(), "worker_interrupted"),
        ):
            with self.subTest(error=type(error).__name__):
                store = MemoryStore(clock=_Clock())
                run = _enqueue(store)

                def broken_step(argv: list[str]) -> int:
                    raise error

                with _local_pipeline() as root:
                    with self.assertRaises(type(error)):
                        process_one(
                            store,
                            live=True,
                            runner=broken_step,
                            manifest_path=root / "summary.json",
                        )
                    failed = store.get(run.id)
                    self.assertEqual((failed.status, failed.error_code), ("Failed", code))
                    self.assertEqual(_target_status(store, "tzuyang"), "Idle")
                    manifest = _read(root / "summary.json")
                    self.assertEqual(
                        (manifest["finalStatus"], manifest["jobId"]), ("ERROR", run.id)
                    )


class RunWindowTests(unittest.TestCase):
    def test_next_day_gets_a_new_run_on_a_persistent_store(self) -> None:
        clock = _Clock(1_700_000_000.0)
        with _local_pipeline() as root:
            summary = root / "live-runs" / "run-1-current-summary.json"
            first = run_once(
                FileStore(root / "store.json", clock=clock), target="tzuyang", index=1, live=False
            )
            first_job = _read(summary)["jobId"]
            clock.advance(DAY)
            second = run_once(
                FileStore(root / "store.json", clock=clock), target="tzuyang", index=1, live=False
            )
            second_job = _read(summary)["jobId"]

        self.assertEqual((first, second), ("Succeeded", "Succeeded"))
        self.assertNotEqual(first_job, second_job)

    def test_same_window_retry_does_not_run_again(self) -> None:
        clock = _Clock(1_700_000_000.0)
        store = MemoryStore(clock=clock)
        steps: list[list[str]] = []

        def step(argv: list[str]) -> int:
            steps.append(argv)
            return 0

        with _local_pipeline():
            first = run_once(store, target="tzuyang", index=1, live=True, runner=step)
            executed = len(steps)
            clock.advance(60)
            second = run_once(store, target="tzuyang", index=1, live=True, runner=step)

        self.assertEqual((first, second), ("Succeeded", "Failed"))
        self.assertGreater(executed, 0)
        self.assertEqual(len(steps), executed)

    def test_dry_run_and_live_run_share_a_window(self) -> None:
        store = MemoryStore(clock=_Clock(1_700_000_000.0))
        steps: list[list[str]] = []

        with _local_pipeline():
            dry = run_once(store, target="tzuyang", index=1, live=False)
            live_result = run_once(
                store,
                target="tzuyang",
                index=1,
                live=True,
                runner=lambda argv: steps.append(argv) or 0,
            )

        self.assertEqual((dry, live_result), ("Succeeded", "Succeeded"))
        self.assertTrue(steps)

    def test_queued_dry_run_without_an_id_reuses_the_days_dry_run(self) -> None:
        store = MemoryStore(clock=_Clock(1_700_000_000.0))

        with _local_pipeline() as root:
            summary = root / "live-runs" / "run-1-current-summary.json"
            first = run_once(store, target="tzuyang", index=1, live=False)
            first_job = _read(summary)["jobId"]
            second = run_once(store, target="tzuyang", index=1, live=True, queued_dry_run=True)
            second_job = _read(summary)["jobId"]

        self.assertEqual((first, second), ("Succeeded", "Failed"))
        self.assertEqual(second_job, first_job)


class BusyTargetTests(unittest.TestCase):
    def test_busy_target_is_refused_and_no_holder_is_touched(self) -> None:
        store = MemoryStore(clock=_Clock())
        holders = [
            _claimed(store, "tzuyang", "busy-tzuyang-1"),
            _claimed(store, "meatcreator", "busy-meat-0001"),
        ]

        with _local_pipeline() as root:
            result = run_once(store, target="tzuyang", index=1, live=False)
            manifest = _read(root / "live-runs" / "run-1-current-summary.json")

        for holder in holders:
            current = store.get(holder.id)
            self.assertEqual((current.status, current.error_code), ("Fetching", None))
        self.assertEqual(result, "Failed")
        self.assertEqual(manifest["finalStatus"], "ERROR")

    def test_store_error_other_than_a_busy_target_propagates_and_no_run_changes(self) -> None:
        for error in (
            ControlPlaneError("idempotency_payload_conflict", 409),
            PersistError("persist_divergence"),
        ):
            with self.subTest(error=type(error).__name__):
                store = MemoryStore(clock=_Clock())
                holders = [
                    _claimed(store, "tzuyang", "error-tzuyang-1"),
                    _claimed(store, "meatcreator", "error-meat-0001"),
                ]

                with _local_pipeline(), patch.object(store, "create_run", side_effect=error):
                    with self.assertRaises(type(error)) as raised:
                        run_once(store, target="tzuyang", index=1, live=False)

                self.assertIs(raised.exception, error)
                for holder in holders:
                    current = store.get(holder.id)
                    self.assertEqual((current.status, current.error_code), ("Fetching", None))

    def test_paused_target_is_not_taken_over(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        paused = _enqueue(store, key="paused-tzuyang")
        store.control(paused.id, "pause", actor="operator", request_id="req-pause")
        clock.advance(DAY)

        with _local_pipeline():
            result = run_once(store, target="tzuyang", index=1, live=False)

        self.assertEqual(store.get(paused.id).status, "Paused")
        self.assertEqual(result, "Failed")

    def test_expired_holder_is_reclaimed_and_other_targets_are_untouched(self) -> None:
        clock = _Clock()
        store = MemoryStore(clock=clock)
        dead = _claimed(store, "tzuyang", "dead-tzuyang-1")
        clock.advance(20)
        alive = _claimed(store, "meatcreator", "live-meat-0001")
        clock.advance(15)

        with _local_pipeline():
            result = run_once(store, target="tzuyang", index=1, live=False)

        self.assertEqual(result, "Succeeded")
        reclaimed = store.get(dead.id)
        self.assertEqual((reclaimed.status, reclaimed.error_code), ("Failed", "lease_expired"))
        self.assertEqual(store.get(alive.id).status, "Fetching")


if __name__ == "__main__":
    unittest.main()
