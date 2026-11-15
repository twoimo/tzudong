"""Worker run lifecycle: every claimed run ends in a recorded state."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from backend.pipeline_control import live_run
from backend.pipeline_control.adapter import default_live_runner
from backend.pipeline_control.graph import STEP_SPECS
from backend.pipeline_control.state_machine import ControlPlaneError, RunRecord
from backend.pipeline_control.store import MemoryStore
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
    """Hermetic local_db worker environment with a private output directory."""

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
        ):
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


if __name__ == "__main__":
    unittest.main()
