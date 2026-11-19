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
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control import adapter
from backend.pipeline_control.adapter import default_live_runner
from backend.pipeline_control.graph import AdapterGraphError

REPO_ROOT = Path(__file__).resolve().parents[2]
STEP_TIMEOUT_ENV = "TZUDONG_PIPELINE_STEP_TIMEOUT_SECONDS"
RECORD_PID_THEN_SLEEP = (
    "import os, sys, time\n"
    "open(sys.argv[1], 'w').write(str(os.getpid()))\n"
    "time.sleep(float(sys.argv[2]))\n"
)
IGNORE_SIGTERM_THEN_SLEEP = (
    "import os, signal, sys, time\n"
    "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
    "open(sys.argv[1], 'w').write(str(os.getpid()))\n"
    "time.sleep(float(sys.argv[2]))\n"
)
SPAWN_CHILD_THEN_SLEEP = (
    "import subprocess, sys, time\n"
    "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(' + sys.argv[2] + ')'])\n"
    "open(sys.argv[1], 'w').write(str(child.pid))\n"
    "time.sleep(float(sys.argv[2]))\n"
)
WORKER_SIGNALLED_WHILE_STARTING_A_STEP = (
    "import os, signal, subprocess, sys\n"
    "from backend.pipeline_control.adapter import default_live_runner\n"
    "spawn = subprocess.Popen\n"
    "def spawn_then_signal(*args, **kwargs):\n"
    "    process = spawn(*args, **kwargs)\n"
    "    open(sys.argv[1], 'w').write(str(process.pid))\n"
    "    os.kill(os.getpid(), signal.SIGTERM)\n"
    "    return process\n"
    "subprocess.Popen = spawn_then_signal\n"
    "default_live_runner([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
)
WORKER_RUNNING_ONE_STEP = (
    "import sys\n"
    "from backend.pipeline_control.adapter import default_live_runner\n"
    f"default_live_runner([sys.executable, '-c', {RECORD_PID_THEN_SLEEP!r}, sys.argv[1], '30'])\n"
)


def _sleep(seconds: float) -> list[str]:
    return [sys.executable, "-c", f"import time; time.sleep({seconds})"]


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _wait_until(predicate, seconds: float = 10.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def _process_gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def _kill_quietly(pid: int) -> None:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


class StepRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        silenced = patch("sys.stdout", new_callable=io.StringIO)
        silenced.start()
        self.addCleanup(silenced.stop)

    def test_exit_code_of_a_finished_step_is_returned(self) -> None:
        self.assertEqual(default_live_runner([sys.executable, "-c", "raise SystemExit(7)"]), 7)

    def test_hung_step_ends_with_the_timeout_code(self) -> None:
        with patch.dict(os.environ, {STEP_TIMEOUT_ENV: "0.3"}):
            self.assertEqual(default_live_runner(_sleep(5)), 124)

    def test_timeout_stops_processes_the_step_started(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            pid_file = Path(raw) / "child.pid"
            with patch.dict(os.environ, {STEP_TIMEOUT_ENV: "2"}):
                code = default_live_runner(
                    [sys.executable, "-c", SPAWN_CHILD_THEN_SLEEP, str(pid_file), "6"]
                )
            child = int(pid_file.read_text())
        self.addCleanup(_kill_quietly, child)
        self.assertEqual(code, 124)
        self.assertTrue(_wait_until(lambda: _process_gone(child)))

    def test_step_that_ignores_sigterm_is_killed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            pid_file = Path(raw) / "step.pid"
            with patch.dict(os.environ, {STEP_TIMEOUT_ENV: "2"}):
                code = default_live_runner(
                    [sys.executable, "-c", IGNORE_SIGTERM_THEN_SLEEP, str(pid_file), "6"]
                )
            step = int(pid_file.read_text())
        self.addCleanup(_kill_quietly, step)
        self.assertEqual(code, 124)
        self.assertTrue(_process_gone(step))

    def test_deadline_is_measured_on_the_wall_clock(self) -> None:
        ticks = iter([1_000.0])

        def woke_up_two_hours_later() -> float:
            return next(ticks, 1_000.0 + 7_200.0)

        code = default_live_runner(
            _sleep(5), timeout=3_600.0, wall_clock=woke_up_two_hours_later
        )
        self.assertEqual(code, 124)

    def test_default_timeout_outlasts_every_cadence_window(self) -> None:
        cadence = json.loads(
            (REPO_ROOT / "backend/pipeline_control/cadence.schedule.json").read_text(
                encoding="utf-8"
            )
        )
        longest = max(
            _minutes(window["kstEnd"]) - _minutes(window["kstStart"])
            for window in cadence["windows"]
        )
        self.assertGreater(adapter.STEP_TIMEOUT_SECONDS, longest * 60)

    def test_invalid_timeout_override_is_rejected(self) -> None:
        for raw in ("soon", "0", "-1", "nan", "inf"):
            with self.subTest(raw=raw), patch.dict(os.environ, {STEP_TIMEOUT_ENV: raw}):
                with self.assertRaises(AdapterGraphError) as rejected:
                    adapter.step_timeout_seconds()
                self.assertEqual(rejected.exception.code, "step_timeout_invalid")

    def test_terminating_the_worker_stops_its_step(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            pid_file = Path(raw) / "step.pid"
            worker = subprocess.Popen(
                [sys.executable, "-c", WORKER_RUNNING_ONE_STEP, str(pid_file)],
                cwd=REPO_ROOT,
            )
            self.addCleanup(worker.wait)
            self.addCleanup(worker.kill)
            self.assertTrue(
                _wait_until(lambda: pid_file.is_file() and pid_file.read_text().strip() != "")
            )
            step = int(pid_file.read_text())
            self.addCleanup(_kill_quietly, step)
            worker.send_signal(signal.SIGTERM)
            worker.wait(timeout=10)
        self.assertTrue(_wait_until(lambda: _process_gone(step)))

    def test_signal_while_a_step_starts_still_stops_the_step(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            pid_file = Path(raw) / "step.pid"
            worker = subprocess.run(
                [sys.executable, "-c", WORKER_SIGNALLED_WHILE_STARTING_A_STEP, str(pid_file)],
                cwd=REPO_ROOT,
                timeout=20,
            )
            step = int(pid_file.read_text())
        self.addCleanup(_kill_quietly, step)
        self.assertNotEqual(worker.returncode, 0)
        self.assertTrue(_wait_until(lambda: _process_gone(step)))


if __name__ == "__main__":
    unittest.main()
