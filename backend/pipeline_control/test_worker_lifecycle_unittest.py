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
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.worker import process_one

STEP_TIMEOUT_ENV = "TZUDONG_PIPELINE_STEP_TIMEOUT_SECONDS"


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


if __name__ == "__main__":
    unittest.main()
