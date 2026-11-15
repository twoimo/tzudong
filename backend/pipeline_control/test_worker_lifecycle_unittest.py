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

from backend.pipeline_control import live_run
from backend.pipeline_control import store as store_module
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
REPO_ROOT = Path(__file__).resolve().parents[2]
WORKER_ENVIRONMENT = {
    "PATH": os.environ.get("PATH", ""),
    "TZUDONG_DATA_ENV": "local_db",
    "TZUDONG_DATA_SINK": "local_db",
    "PIPELINE_CONTROL_DSN": "postgresql://tzudong@127.0.0.1:54322/postgres",
    "RUN_DAILY_EXECUTION_SHA": "a" * 40,
}
WORKER_SIGNALLED_DURING_A_PHASE = """
import os, sys
from functools import partial
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import adapter, media_cache, worker
from backend.pipeline_control.file_store import FileStore

root, phase, signum = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
store = FileStore(root / "store.json")
run, _ = store.create_run(
    target="tzuyang",
    profile="heavy_local",
    idempotency_key="signalled-001",
    payload={},
    actor="qa",
    request_id="req-signalled",
    dry_run=phase == "dry_run_step",
)
(root / "run_id").write_text(run.id)
owner, name = {
    "claim": (store, "claim"),
    "preflight": (worker, "preflight_data_sink"),
    "raw_document": (adapter, "emit_raw_document"),
    "dry_run_step": (adapter, "run_daily_helper_dry_run"),
    "cache_cleanup": (media_cache.shutil, "rmtree"),
}[phase]
call = getattr(owner, name)


def signalled(*args, **kwargs):
    os.kill(os.getpid(), signum)
    return call(*args, **kwargs)


with patch.object(owner, name, signalled), patch.object(
    worker, "owned_media_cache", partial(media_cache.owned_media_cache, root=root / "run-cache")
):
    worker.process_one(
        store, live=True, runner=lambda argv: 0, manifest_path=root / "summary.json", run_id=run.id
    )
"""
WORKER_KILLED_WHILE_CLEANING_UP_A_STOPPED_STEP = """
import os, signal, subprocess, sys
from functools import partial
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import media_cache, worker
from backend.pipeline_control.adapter import default_live_runner
from backend.pipeline_control.file_store import FileStore

root = Path(sys.argv[1])
store = FileStore(root / "store.json")
run, _ = store.create_run(
    target="tzuyang",
    profile="heavy_local",
    idempotency_key="killed-000001",
    payload={},
    actor="qa",
    request_id="req-killed",
    dry_run=False,
)
(root / "run_id").write_text(run.id)
spawn = subprocess.Popen
spawned = []


def spawn_then_stop(*args, **kwargs):
    process = spawn(*args, **kwargs)
    if not spawned:
        spawned.append(process)
        os.kill(os.getpid(), signal.SIGTERM)
    return process


def killed_by_the_daemon(*args, **kwargs):
    os.kill(os.getpid(), signal.SIGKILL)


subprocess.Popen = spawn_then_stop
with patch.object(media_cache.shutil, "rmtree", killed_by_the_daemon), patch.object(
    worker, "owned_media_cache", partial(media_cache.owned_media_cache, root=root / "run-cache")
):
    worker.process_one(
        store,
        live=True,
        runner=lambda argv: default_live_runner([sys.executable, "-c", "import time; time.sleep(30)"]),
        manifest_path=root / "summary.json",
        run_id=run.id,
    )
"""
WORKER_STOPPED_AT_EACH_LINE = """
import io, json, os, signal, sys, tempfile
from contextlib import redirect_stdout
from functools import partial
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import media_cache, worker
from backend.pipeline_control.file_store import FileStore


class Escaped(BaseException):
    pass


def escaped(signum, frame):
    raise Escaped()


def step_that_fills_the_cache(argv):
    (Path(os.environ["VIDEO_CACHE_DIR"]) / "frame.bin").write_bytes(b"x")
    return 0


def stopped_at(event):
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        store = FileStore(root / "store.json")
        run, _ = store.create_run(
            target="tzuyang",
            profile="heavy_local",
            idempotency_key="every-line-01",
            payload={},
            actor="qa",
            request_id="req-every-line",
            dry_run=False,
        )
        lines = []

        def trace(frame, kind, arg):
            if frame.f_code is not worker.process_one.__code__:
                return None

            def line(frame, kind, arg):
                if kind == "line":
                    lines.append(frame.f_lineno)
                    if len(lines) == event:
                        os.kill(os.getpid(), signal.SIGTERM)
                return line

            return line

        signal.signal(signal.SIGTERM, escaped)
        sys.settrace(trace)
        try:
            with patch.object(
                worker, "owned_media_cache", partial(media_cache.owned_media_cache, root=root / "run-cache")
            ), redirect_stdout(io.StringIO()):
                worker.process_one(
                    store,
                    live=True,
                    runner=step_that_fills_the_cache,
                    manifest_path=root / "summary.json",
                    run_id=run.id,
                )
        except BaseException:
            pass
        finally:
            sys.settrace(None)
        state = json.loads((root / "store.json").read_text())
        return lines, {
            "line": lines[event - 1] if 0 < event <= len(lines) else None,
            "status": state["runs"][run.id]["status"],
            "locks": state["locks"],
            "manifest": (root / "summary.json").exists(),
            "cache": (root / "run-cache" / run.id).exists(),
        }


lines, _ = stopped_at(0)
print(json.dumps([stopped_at(event)[1] for event in range(1, len(lines) + 1)]))
"""
WORKER_STOPPED_WHILE_A_SERVICE_STALLS = """
import os, signal, sys, time
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import live_evidence
from backend.pipeline_control import store as store_module
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.worker import process_one

root, stalled = Path(sys.argv[1]), sys.argv[2]
store = FileStore(root / "store.json")
run, _ = store.create_run(
    target="tzuyang",
    profile="heavy_local",
    idempotency_key="stalled-00001",
    payload={},
    actor="qa",
    request_id="req-stalled",
    dry_run=False,
)
(root / "run_id").write_text(run.id)
stopped = []
finish_succeeded = FileStore.finish_succeeded


def stop():
    stopped.append(True)
    (root / "stopped").write_text("1")
    os.kill(os.getpid(), signal.SIGTERM)


def step_stopped(argv):
    stop()
    return 0


def mirror_stalls_on_the_failed_record(run, *, lock_held, lock_key, audit):
    if audit is not None and audit["transition"] == "failed":
        time.sleep(60)


def finish_succeeded_after_a_stop(self, run_id):
    stop()
    return finish_succeeded(self, run_id)


def evidence_stalls_once_stopped(*args, **kwargs):
    if stopped:
        time.sleep(60)
    return ("c" * 64, 1)


if stalled == "mirror":
    patches = [patch.object(store_module, "persist_mutation", mirror_stalls_on_the_failed_record)]
    runner = step_stopped
else:
    patches = [
        patch.object(FileStore, "finish_succeeded", finish_succeeded_after_a_stop),
        patch.object(live_evidence, "snapshot_restaurants_relation", evidence_stalls_once_stopped),
    ]
    runner = lambda argv: 0
for active in patches:
    active.start()
process_one(store, live=True, runner=runner, manifest_path=root / "summary.json", run_id=run.id)
"""
# backend/bin/run_daily_monitor_daemon.sh stops a run with TERM, sleep 5, KILL.
DAEMON_STOP_GRACE_SECONDS = 5.0


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


class DurableMirrorOutageTests(unittest.TestCase):
    def test_mirror_outage_during_a_run_fails_it_with_a_manifest(self) -> None:
        writes = {"n": 0}

        def mirror_down_after_the_first_step(run, *, lock_held, lock_key, audit) -> None:
            writes["n"] += 1
            if writes["n"] > 2:
                raise PersistError("persist_failed")

        with _local_pipeline() as root:
            path = root / "store.json"
            run = _enqueue(FileStore(path, clock=_Clock()))
            with patch.object(store_module, "persist_mutation", mirror_down_after_the_first_step):
                with self.assertRaises(PersistError):
                    process_one(
                        FileStore(path, clock=_Clock()),
                        live=True,
                        runner=lambda argv: 0,
                        manifest_path=root / "summary.json",
                    )
            settled = FileStore(path, clock=_Clock())
            failed = settled.get(run.id)
            self.assertEqual((failed.status, failed.error_code), ("Failed", "worker_unexpected"))
            self.assertEqual(_target_status(settled, "tzuyang"), "Idle")
            self.assertTrue((root / "summary.json").is_file())
            manifest = _read(root / "summary.json")
            self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("ERROR", run.id))

    def test_mirror_refusing_the_final_success_write_keeps_the_success_in_the_manifest(
        self,
    ) -> None:
        def mirror_refuses_the_final_write(run, *, lock_held, lock_key, audit) -> None:
            if audit is not None and audit["transition"] in {"succeeded", "dry_run_succeeded"}:
                raise PersistError("persist_failed")

        for live in (True, False):
            with self.subTest(live=live), _local_pipeline() as root:
                path = root / "store.json"
                run = _enqueue(FileStore(path, clock=_Clock()))
                log = io.StringIO()
                with patch.object(
                    store_module, "persist_mutation", mirror_refuses_the_final_write
                ), redirect_stdout(log):
                    with self.assertRaises(PersistError):
                        process_one(
                            FileStore(path, clock=_Clock()),
                            live=live,
                            runner=lambda argv: 0,
                            manifest_path=root / "summary.json",
                        )
                settled = FileStore(path, clock=_Clock())
                self.assertEqual(settled.get(run.id).status, "Succeeded")
                self.assertEqual(_target_status(settled, "tzuyang"), "Idle")
                self.assertIn("operation=run_record_failed error=PersistError", log.getvalue())
                manifest = _read(root / "summary.json")
                self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("OK", run.id))
                self.assertIs(manifest["liveExecutionSucceeded"], live)


class StopSignalTests(unittest.TestCase):
    def _worker(self, script: str, *args: str) -> tuple[int, dict, dict, dict | None]:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            worker = subprocess.run(
                [sys.executable, "-c", script, str(root), *args],
                cwd=REPO_ROOT,
                env=WORKER_ENVIRONMENT,
                capture_output=True,
                timeout=60,
            )
            store = _read(root / "store.json")
            run = store["runs"][(root / "run_id").read_text()]
            summary = root / "summary.json"
            manifest = _read(summary) if summary.exists() else None
        return worker.returncode, run, store["locks"], manifest

    def _stopped_like_the_daemon(self, stalled: str) -> tuple[dict, dict, dict | None]:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            summary = root / "summary.json"

            def recorded() -> bool:
                run = _read(root / "store.json")["runs"][(root / "run_id").read_text()]
                return summary.exists() and run["status"] in {"Succeeded", "Failed"}

            worker = subprocess.Popen(
                [sys.executable, "-c", WORKER_STOPPED_WHILE_A_SERVICE_STALLS, str(root), stalled],
                cwd=REPO_ROOT,
                env={**WORKER_ENVIRONMENT, "VIDEO_CACHE_DIR": str(root / "video-cache")},
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.monotonic() + 60
                while not (root / "stopped").exists() and worker.poll() is None:
                    self.assertLess(time.monotonic(), deadline, "worker never reached its stop")
                    time.sleep(0.01)
                grace_ends = time.monotonic() + DAEMON_STOP_GRACE_SECONDS
                while worker.poll() is None and time.monotonic() < grace_ends and not recorded():
                    time.sleep(0.05)
            finally:
                if worker.poll() is None:
                    os.killpg(worker.pid, signal.SIGKILL)
                worker.wait()
            store = _read(root / "store.json")
            run = store["runs"][(root / "run_id").read_text()]
            manifest = _read(summary) if summary.exists() else None
        return run, store["locks"], manifest

    def _assert_recorded_failed(self, run: dict, locks: dict, manifest: dict | None) -> None:
        self.assertEqual((run["status"], run["error_code"]), ("Failed", "worker_interrupted"))
        self.assertEqual(locks, {})
        self.assertIsNotNone(manifest)
        self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("ERROR", run["id"]))

    def test_stop_signal_outside_a_step_fails_the_run_with_a_manifest(self) -> None:
        for phase, signum in (
            ("claim", signal.SIGTERM),
            ("preflight", signal.SIGTERM),
            ("raw_document", signal.SIGTERM),
            ("raw_document", signal.SIGHUP),
            ("dry_run_step", signal.SIGTERM),
        ):
            with self.subTest(phase=phase, signal=signum.name):
                code, run, locks, manifest = self._worker(
                    WORKER_SIGNALLED_DURING_A_PHASE, phase, str(int(signum))
                )
                self._assert_recorded_failed(run, locks, manifest)
                self.assertEqual(code, 128 + signum)

    def test_stop_signal_during_cleanup_keeps_the_recorded_success(self) -> None:
        code, run, locks, manifest = self._worker(
            WORKER_SIGNALLED_DURING_A_PHASE, "cache_cleanup", str(int(signal.SIGTERM))
        )

        self.assertEqual(run["status"], "Succeeded")
        self.assertEqual(locks, {})
        self.assertIsNotNone(manifest)
        self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("OK", run["id"]))
        self.assertEqual(code, 128 + signal.SIGTERM)

    def test_kill_during_cleanup_after_a_stopped_step_leaves_the_run_recorded(self) -> None:
        code, run, locks, manifest = self._worker(WORKER_KILLED_WHILE_CLEANING_UP_A_STOPPED_STEP)

        self._assert_recorded_failed(run, locks, manifest)
        self.assertEqual(code, -signal.SIGKILL)

    def test_stop_at_any_line_of_a_run_leaves_it_recorded_and_cleaned_up(self) -> None:
        worker = subprocess.run(
            [sys.executable, "-c", WORKER_STOPPED_AT_EACH_LINE],
            cwd=REPO_ROOT,
            env=WORKER_ENVIRONMENT,
            capture_output=True,
            timeout=120,
            check=True,
        )
        outcomes = json.loads(worker.stdout.decode().splitlines()[-1])

        def settled(outcome: dict) -> bool:
            if outcome["status"] == "Queued":
                return not outcome["manifest"]
            return (
                outcome["status"] in {"Succeeded", "Failed"}
                and outcome["locks"] == {}
                and outcome["manifest"]
                and not outcome["cache"]
            )

        self.assertEqual([outcome for outcome in outcomes if not settled(outcome)], [])
        self.assertEqual(
            {outcome["status"] for outcome in outcomes}, {"Queued", "Failed", "Succeeded"}
        )

    def test_stop_while_the_mirror_stalls_leaves_a_manifest_within_the_daemon_grace(self) -> None:
        run, locks, manifest = self._stopped_like_the_daemon("mirror")

        self._assert_recorded_failed(run, locks, manifest)

    def test_stop_while_live_evidence_stalls_leaves_a_manifest_within_the_daemon_grace(
        self,
    ) -> None:
        run, locks, manifest = self._stopped_like_the_daemon("evidence")

        self.assertEqual((run["status"], locks), ("Succeeded", {}))
        self.assertIsNotNone(manifest)
        self.assertEqual((manifest["finalStatus"], manifest["jobId"]), ("OK", run["id"]))
        self.assertEqual(manifest["readbackSha256"], "c" * 64)


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
