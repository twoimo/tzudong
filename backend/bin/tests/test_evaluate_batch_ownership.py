#!/usr/bin/env python3
"""Process-level ownership checks for the new-video URL batch.

Only the evaluator's main/_run are real. Hosted reads and numbered stages are
replaced inside task-owned temporary processes; no pipeline or API is called.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

try:
    import fcntl
except ImportError:  # Windows skips the POSIX ownership cases below.
    fcntl = None


ROOT = Path(__file__).resolve().parents[3]
EVALUATOR = ROOT / "backend/bin/evaluate_new_youtube_videos.py"
A_ID = "aaaaaaaaaaa"
B_ID = "bbbbbbbbbbb"

DRIVER = r'''
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

source, workspace, actor, mode = sys.argv[1:]
workspace = Path(workspace)
os.environ.clear()
os.environ.update({"PATH": "/usr/bin:/bin", "TEST_WORKSPACE": str(workspace),
                   "TEST_ACTOR": actor, "TEST_MODE": mode})
spec = importlib.util.spec_from_file_location("owned_evaluator", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.REPO_ROOT = workspace

def record(stage, **extra):
    row = {"actor": actor, "stage": stage, **extra}
    fd = os.open(workspace / "events.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(row, sort_keys=True) + "\n").encode())
    finally:
        os.close(fd)

def urls():
    path = workspace / "backend/restaurant-crawling/data/tzuyang/urls.txt"
    return path.read_text().splitlines() if path.exists() else []

module.assert_hosted_target = lambda _url: None
def snapshot(**_kwargs):
    record("fetch", urls=urls())
    return [], (["aaaaaaaaaaa"] if actor == "B" else [])
module.fetch_hosted_restaurant_snapshot = snapshot
if mode == "unlocked":
    # Negative control: the former main had no batch-level ownership.
    module.stage_lock = lambda _path, **_kwargs: contextlib.nullcontext(None)
real_run = module._run
def staged_run(argv, env, *, required=True):
    key = next(key for key, path in module.SCRIPTS.items() if str(path) in argv)
    if key == "chunk" and mode in {"raise", "keyboard"}:
        # A task-owned child survives a synthetic evaluator exception. This
        # tests only the context manager's close lifetime; normal _run waits
        # for its child and is exercised by the other process tests.
        child = subprocess.Popen(
            [sys.executable, str(workspace / "stage.py"), key],
            cwd=workspace, env=env, pass_fds=(module._BATCH_LOCK_FD.get(),),
        )
        record("detached", pid=child.pid)
        if mode == "raise":
            raise OSError("synthetic interrupted stage")
        raise KeyboardInterrupt
    return real_run([sys.executable, str(workspace / "stage.py"), key], env,
                    required=required)
module._run = staged_run
record("start")
result = module.main(["--channel", "tzuyang", "--limit", "1"]
                    + (["--dry-run"] if mode == "dry" else []))
record("done", result=result, urls=urls())
raise SystemExit(result)
'''

STAGE = r'''
import json
import os
from pathlib import Path
import sys
import time

root = Path(os.environ["TEST_WORKSPACE"])
actor = os.environ["TEST_ACTOR"]
mode = os.environ["TEST_MODE"]
stage = sys.argv[1]
path = root / "backend/restaurant-crawling/data/tzuyang/urls.txt"
def record(name, **extra):
    row = {"actor": actor, "stage": name, "urls": path.read_text().splitlines()
           if path.exists() else [], **extra}
    fd = os.open(root / "events.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(row, sort_keys=True) + "\n").encode())
    finally:
        os.close(fd)

if stage == "collect_urls":
    path.parent.mkdir(parents=True, exist_ok=True)
    video = "aaaaaaaaaaa" if actor == "A" else "bbbbbbbbbbb"
    path.write_text("https://www.youtube.com/watch?v=" + video + "\n")
if stage == "chunk" and actor == "A" and mode != "dry":
    # Signal readiness before consuming the input. The parent test chooses
    # when another evaluator has finished before this stage reads urls.txt.
    record("chunk-ready", pid=os.getpid())
    release = root / "release-A"
    deadline = time.monotonic() + 20
    while not release.exists():
        if time.monotonic() >= deadline:
            record("barrier-timeout")
            raise SystemExit(91)
        time.sleep(.01)
    record("chunk", pid=os.getpid())
    record("chunk-released")
else:
    record(stage, pid=os.getpid())
'''


class EvaluateBatchOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        if os.name != "posix" or fcntl is None:
            self.skipTest("POSIX flock and pass_fds required")
        self.temporary = tempfile.TemporaryDirectory(prefix="evaluate-batch-ownership-")
        self.addCleanup(self.temporary.cleanup)
        self.workspace = Path(self.temporary.name)
        self.driver = self.workspace / "driver.py"
        self.driver.write_text(textwrap.dedent(DRIVER), encoding="utf-8")
        (self.workspace / "stage.py").write_text(textwrap.dedent(STAGE), encoding="utf-8")
        self.urls = self.workspace / "backend/restaurant-crawling/data/tzuyang/urls.txt"
        self.urls.parent.mkdir(parents=True)
        self.urls.write_text(self._url(B_ID) + "\n", encoding="utf-8")
        self.processes: list[subprocess.Popen[str]] = []
        self.children: set[int] = set()
        self.addCleanup(self._cleanup_processes)

    @staticmethod
    def _url(video_id: str) -> str:
        return f"https://www.youtube.com/watch?v={video_id}"

    def _spawn(self, actor: str, mode: str = "normal") -> subprocess.Popen[str]:
        process = subprocess.Popen(
            [sys.executable, str(self.driver), str(EVALUATOR), str(self.workspace), actor, mode],
            cwd=self.workspace,
            env={"PATH": "/usr/bin:/bin"},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.processes.append(process)
        return process

    def _events(self) -> list[dict]:
        path = self.workspace / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def _wait_event(self, actor: str, stage: str) -> dict:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            match = next((row for row in self._events()
                          if row["actor"] == actor and row["stage"] == stage), None)
            if match is not None:
                return match
            time.sleep(.01)
        self.fail(f"event missing: {actor}/{stage}; observed={self._events()}")

    def _wait_exit(self, process: subprocess.Popen[str], expected: int) -> None:
        out, err = process.communicate(timeout=15)
        self.assertEqual(process.returncode, expected, f"stdout={out!r} stderr={err!r}")

    def _lock_available(self) -> bool:
        lock = self.workspace / "backend/restaurant-crawling/data/tzuyang/.new-video-batch.json.lock"
        with lock.open("a+b") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            fcntl.flock(handle, fcntl.LOCK_UN)
            return True

    def _wait_lock_available(self) -> None:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self._lock_available():
                return
            time.sleep(.01)
        self.fail("batch lock remained held after owned child exit")

    def _cleanup_processes(self) -> None:
        (self.workspace / "release-A").touch()
        lock = self.workspace / "backend/restaurant-crawling/data/tzuyang/.new-video-batch.json.lock"
        if lock.exists() and not self._lock_available():
            for pid in self.children:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.communicate()

    def test_two_processes_keep_stage_inputs_owned_until_restoration(self) -> None:
        a = self._spawn("A")
        chunk = self._wait_event("A", "chunk-ready")
        self.children.add(chunk["pid"])
        self.assertFalse(self._lock_available())
        b = self._spawn("B")
        self._wait_event("B", "start")
        (self.workspace / "release-A").touch()
        self._wait_exit(a, 1)  # No certified extraction was fabricated by the stub.
        self._wait_exit(b, 1)
        events = self._events()
        scoped = [row for row in events if row["actor"] == "A"
                  and row["stage"] in {"collect_meta", "transcript", "chunk"}]
        self.assertEqual([row["stage"] for row in scoped],
                         ["collect_meta", "transcript", "chunk"])
        self.assertTrue(all(row["urls"] == [self._url(A_ID)] for row in scoped))
        b_fetch = next(row for row in events if row["actor"] == "B" and row["stage"] == "fetch")
        self.assertEqual(b_fetch["urls"], [self._url(A_ID), self._url(B_ID)])
        self.assertTrue(all(row["urls"] == [self._url(B_ID)] for row in events
                            if row["actor"] == "B" and row["stage"] in
                            {"collect_meta", "transcript", "chunk"}))
        self._wait_lock_available()

    def test_dry_run_and_failed_batch_release_lock(self) -> None:
        dry = self._spawn("A", "dry")
        self._wait_exit(dry, 0)
        self.assertEqual(self.urls.read_text().splitlines(), [self._url(B_ID)])
        self._wait_lock_available()
        failed = self._spawn("A")
        chunk = self._wait_event("A", "chunk-ready")
        self.children.add(chunk["pid"])
        (self.workspace / "release-A").touch()
        self._wait_exit(failed, 1)
        self._wait_lock_available()

    def test_unlocked_control_exposes_cross_batch_stage_input(self) -> None:
        a = self._spawn("A", "unlocked")
        chunk = self._wait_event("A", "chunk-ready")
        self.children.add(chunk["pid"])
        b = self._spawn("B", "unlocked")
        b_fetch = self._wait_event("B", "fetch")
        # The old, unlocked main could inspect A's temporary one-video input.
        self.assertEqual(b_fetch["urls"], [self._url(A_ID)])
        self._wait_exit(b, 1)
        self._wait_event("B", "done")
        (self.workspace / "release-A").touch()
        self._wait_exit(a, 1)
        events = self._events()
        a_chunk = next(row for row in events if row["actor"] == "A" and row["stage"] == "chunk")
        self.assertNotEqual(a_chunk["urls"], [self._url(A_ID)])
        self.assertIn(self._url(B_ID), a_chunk["urls"])
        self.assertLess(next(index for index, row in enumerate(events)
                             if row["actor"] == "B" and row["stage"] == "done"),
                        next(index for index, row in enumerate(events)
                             if row["actor"] == "A" and row["stage"] == "chunk"))

    def test_surviving_stage_retains_lock_after_parent_is_killed(self) -> None:
        a = self._spawn("A")
        chunk = self._wait_event("A", "chunk-ready")
        child = chunk["pid"]
        self.children.add(child)
        os.kill(a.pid, signal.SIGKILL)
        # communicate() waits for pipe EOF; the surviving child inherited the
        # evaluator's stdout/stderr. Wait for the parent PID alone here.
        self.assertEqual(a.wait(timeout=5), -signal.SIGKILL)
        os.kill(child, 0)  # The inherited FD must still belong to a live stage.
        self.assertFalse(self._lock_available())
        (self.workspace / "release-A").touch()
        self._wait_event("A", "chunk-released")
        self._wait_lock_available()

    def _assert_exception_close_preserves_child_lock(self, mode: str) -> None:
        a = self._spawn("A", mode)
        detached = self._wait_event("A", "detached")
        self.children.add(detached["pid"])
        self._wait_event("A", "chunk-ready")
        # The child inherited the parent's pipes as well as its lock FD, so
        # communicate() cannot see EOF until the barrier is released.
        self.assertNotEqual(a.wait(timeout=5), 0)
        self.assertFalse(self._lock_available())
        self.assertEqual(self.urls.read_text().splitlines(),
                         [self._url(A_ID), self._url(B_ID)])
        (self.workspace / "release-A").touch()
        self._wait_event("A", "chunk-released")
        self._wait_lock_available()

    def test_oserror_close_leaves_live_child_as_lock_owner(self) -> None:
        self._assert_exception_close_preserves_child_lock("raise")

    def test_keyboard_interrupt_close_leaves_live_child_as_lock_owner(self) -> None:
        self._assert_exception_close_preserves_child_lock("keyboard")
