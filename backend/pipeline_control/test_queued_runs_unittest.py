from __future__ import annotations

import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

from backend.pipeline_control import adapter, file_queue, live_run
from backend.pipeline_control.dsn_guard import DsnGuardError
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.store import LEASE_TTL_SECONDS

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_ENVIRONMENT = {
    "PATH": os.environ.get("PATH", ""),
    "TZUDONG_DATA_ENV": "local_db",
    "TZUDONG_DATA_SINK": "local_db",
    "PIPELINE_CONTROL_DSN": "postgresql://tzudong@127.0.0.1:54322/postgres",
    "RUN_DAILY_EXECUTION_SHA": "a" * 40,
}
TARGETS = ("tzuyang", "meatcreator")
WORKER_STOPPED_ONCE_IT_HOLDS_QUEUED_RUNS = """
import os, signal, sys
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import adapter, file_queue, live_run

root, stopped_after = Path(sys.argv[1]), sys.argv[2]
owner, name = {
    "taking_the_rows": (live_run, "drain"),
    "the_first_step": (adapter, "run_daily_helper_dry_run"),
}[stopped_after]
call = getattr(owner, name)
stopped = []


def call_then_stop(*args, **kwargs):
    result = call(*args, **kwargs)
    if not stopped:
        stopped.append(True)
        os.kill(os.getpid(), signal.SIGTERM)
    return result


with patch.object(owner, name, call_then_stop), patch.object(
    file_queue, "DEFAULT_QUEUE", root / "pipeline-queue.jsonl"
), patch.object(live_run, "CANDIDATE_DIR", root / "live-runs"):
    raise SystemExit(live_run.main([]))
"""


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class _Clock:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


class QueuedRunTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.queue = self.root / "pipeline-queue.jsonl"
        self.environment = {
            **WORKER_ENVIRONMENT,
            "PIPELINE_CONTROL_STORE_PATH": str(self.root / "store.json"),
        }

    def _enqueue_like_the_api(self, count: int) -> list[str]:
        store = FileStore(self.root / "store.json")
        run_ids = []
        for number, target in enumerate(TARGETS[:count], start=1):
            run, _created = store.create_run(
                target=target,
                profile="heavy_local",
                idempotency_key=f"queued-run-{number:04d}",
                payload={"dryRun": True},
                actor="api",
                request_id=f"req-queued-{number}",
                dry_run=True,
            )
            file_queue.enqueue(
                {
                    "id": run.id,
                    "target": run.target,
                    "profile": run.profile,
                    "idempotency_key": run.idempotency_key,
                    "dry_run": run.dry_run,
                    "actor": run.actor,
                    "request_id": run.request_id,
                },
                self.queue,
            )
            run_ids.append(run.id)
        return run_ids

    def _stopped_worker(self, stopped_after: str) -> int:
        worker = subprocess.run(
            [
                sys.executable,
                "-c",
                WORKER_STOPPED_ONCE_IT_HOLDS_QUEUED_RUNS,
                str(self.root),
                stopped_after,
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            capture_output=True,
            timeout=60,
        )
        return worker.returncode

    @contextmanager
    def _worker_in_this_process(self, **extra: str) -> Iterator[None]:
        with patch.dict(os.environ, {**self.environment, **extra}, clear=True), patch.object(
            file_queue, "DEFAULT_QUEUE", self.queue
        ), patch.object(live_run, "CANDIDATE_DIR", self.root / "live-runs"), redirect_stdout(
            io.StringIO()
        ):
            yield

    def _assert_each_run_failed_with_its_manifest(self, run_ids: list[str], error_code: str) -> None:
        store = _read(self.root / "store.json")
        for index, run_id in enumerate(run_ids, start=1):
            with self.subTest(run=index):
                run = store["runs"][run_id]
                self.assertEqual((run["status"], run["error_code"]), ("Failed", error_code))
                summary = self.root / "live-runs" / f"run-{index}-current-summary.json"
                self.assertTrue(summary.exists(), "the run has no manifest")
                manifest = _read(summary)
                self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("ERROR", run_id))
        self.assertEqual(store["locks"], {})
        self.assertEqual(file_queue.drain(self.queue), [])

    def test_stop_after_the_worker_takes_a_queued_run_fails_the_run_with_a_manifest(self) -> None:
        run_ids = self._enqueue_like_the_api(1)

        code = self._stopped_worker("taking_the_rows")

        self._assert_each_run_failed_with_its_manifest(run_ids, "worker_interrupted")
        self.assertEqual(code, 128 + signal.SIGTERM)

    def test_stop_during_a_queued_run_fails_the_queued_runs_after_it(self) -> None:
        run_ids = self._enqueue_like_the_api(2)

        code = self._stopped_worker("the_first_step")

        self._assert_each_run_failed_with_its_manifest(run_ids, "worker_interrupted")
        self.assertEqual(code, 128 + signal.SIGTERM)

    def test_stop_while_the_worker_finds_no_queued_run_creates_no_run(self) -> None:
        self._stopped_worker("taking_the_rows")

        self.assertFalse((self.root / "store.json").exists())
        self.assertFalse((self.root / "live-runs").exists())

    def test_error_in_a_queued_run_fails_the_queued_runs_after_it(self) -> None:
        run_ids = self._enqueue_like_the_api(2)

        with self._worker_in_this_process(), patch.object(
            adapter, "run_daily_helper_dry_run", side_effect=RuntimeError("step error")
        ):
            with self.assertRaises(RuntimeError):
                live_run.main([])

        self._assert_each_run_failed_with_its_manifest(run_ids, "worker_unexpected")

    def test_error_while_no_manifest_can_be_written_still_fails_every_taken_run(self) -> None:
        run_ids = self._enqueue_like_the_api(2)
        for index in range(1, 3):
            (self.root / "live-runs" / f"run-{index}-current-summary.json").mkdir(parents=True)

        with self._worker_in_this_process(), patch.object(
            adapter, "run_daily_helper_dry_run", side_effect=RuntimeError("step error")
        ):
            with self.assertRaises(RuntimeError):
                live_run.main([])

        store = _read(self.root / "store.json")
        self.assertEqual(
            [(store["runs"][run_id]["status"], store["runs"][run_id]["error_code"]) for run_id in run_ids],
            [("Failed", "worker_unexpected")] * 2,
        )
        self.assertEqual(store["locks"], {})
        self.assertEqual(file_queue.drain(self.queue), [])

    def _first_run_outlives_the_lease_of_the_second(self, *, then_stop: bool) -> list[str]:
        run_ids = self._enqueue_like_the_api(2)
        clock = _Clock()
        steps: list[str] = []

        def step_on_a_slow_host(step: str) -> None:
            if not steps:
                clock.now += LEASE_TTL_SECONDS + 1
                if then_stop:
                    raise KeyboardInterrupt
            steps.append(step)

        with self._worker_in_this_process(), patch.object(
            live_run, "FileStore", lambda: FileStore(clock=clock)
        ), patch.object(adapter, "run_daily_helper_dry_run", step_on_a_slow_host):
            if then_stop:
                with self.assertRaises(KeyboardInterrupt):
                    live_run.main([])
            else:
                self.assertEqual(live_run.main([]), 1)
        return run_ids

    def _assert_run_expired_with_its_manifest(self, run_ids: list[str], index: int) -> None:
        store = _read(self.root / "store.json")
        run_id = run_ids[index - 1]
        run = store["runs"][run_id]
        self.assertEqual((run["status"], run["error_code"]), ("Failed", "lease_expired"))
        summary = self.root / "live-runs" / f"run-{index}-current-summary.json"
        self.assertTrue(summary.exists(), "the run has no manifest")
        manifest = _read(summary)
        self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("ERROR", run_id))
        self.assertEqual(store["locks"], {})

    def test_taken_run_whose_lease_ended_before_its_turn_gets_a_manifest_that_names_it(self) -> None:
        run_ids = self._first_run_outlives_the_lease_of_the_second(then_stop=False)

        self._assert_run_expired_with_its_manifest(run_ids, 2)

    def test_stop_leaves_a_manifest_for_a_taken_run_whose_lease_ended(self) -> None:
        run_ids = self._first_run_outlives_the_lease_of_the_second(then_stop=True)

        self._assert_run_expired_with_its_manifest(run_ids, 2)
        first = _read(self.root / "store.json")["runs"][run_ids[0]]
        self.assertEqual((first["status"], first["error_code"]), ("Failed", "worker_interrupted"))
        self.assertEqual(_read(self.root / "live-runs" / "run-1-current-summary.json")["jobId"], run_ids[0])

    def test_error_before_the_worker_claims_a_queued_run_fails_that_run(self) -> None:
        run_ids = self._enqueue_like_the_api(2)

        with self._worker_in_this_process(
            PIPELINE_CONTROL_DSN="postgresql://tzudong@10.0.0.5:5432/postgres"
        ):
            with self.assertRaises(DsnGuardError):
                live_run.main([])

        self._assert_each_run_failed_with_its_manifest(run_ids, "worker_unexpected")


if __name__ == "__main__":
    unittest.main()
