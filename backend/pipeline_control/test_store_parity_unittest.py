from __future__ import annotations

import itertools
import tempfile
import unittest
from pathlib import Path
from typing import Iterator, NamedTuple

from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.pg_store import AtomicMemoryStore
from backend.pipeline_control.state_machine import TERMINAL_STATUSES, ControlPlaneError, lock_key
from backend.pipeline_control.store import MemoryStore

CALLS = ("pause", "resume", "cancel", "boundary", "finish_succeeded", "finish_failed")
# Three calls reach every status and request flag that a run can have. The
# fourth call then makes every call on each of them.
LONGEST = 4


class Answer(NamedTuple):
    result: str
    status: str
    error_code: str | None
    locked: bool
    pause_requested: bool
    cancel_requested: bool


def call_sequences() -> Iterator[tuple[bool, tuple[str, ...]]]:
    for claimed in (False, True):
        for length in range(1, LONGEST + 1):
            for calls in itertools.product(CALLS, repeat=length):
                yield claimed, calls


def make_call(store, run_id: str, name: str, step: int) -> str:
    try:
        if name == "boundary":
            if hasattr(store, "checkpoint"):
                store.checkpoint(run_id)
            else:
                store.beat(run_id)
        elif name == "finish_succeeded":
            store.finish_dry_run(run_id)
        elif name == "finish_failed":
            store.finish_failed(run_id, f"failure_{step}")
        else:
            store.control(run_id, name, actor="operator", request_id=f"req-{step}")
    except ControlPlaneError as refused:
        return refused.code
    return "ok"


def _enqueue(store, *, claimed: bool = False) -> str:
    run, _created = store.create_run(
        target="tzuyang",
        profile="heavy_local",
        idempotency_key="parity-run-01",
        payload={},
        actor="qa",
        request_id="req-parity",
    )
    if claimed:
        store.claim(run.id)
    return run.id


def _observe(store, run_id: str) -> tuple[str, str | None, bool, bool, bool]:
    run = store.get(run_id)
    locked = store.locks.get(lock_key(run.target, run.profile)) == run_id
    return run.status, run.error_code, locked, run.pause_requested, run.cancel_requested


def answers(store, calls: tuple[str, ...], *, claimed: bool) -> list[Answer]:
    run_id = _enqueue(store, claimed=claimed)
    return [
        Answer(make_call(store, run_id, name, step), *_observe(store, run_id))
        for step, name in enumerate(calls)
    ]


class _StoreContract:
    def make_store(self):
        raise NotImplementedError

    def test_finish_after_a_terminal_status_changes_nothing(self) -> None:
        for ended_by, finish in itertools.product(
            ("cancel", "finish_succeeded", "finish_failed"),
            ("finish_succeeded", "finish_failed"),
        ):
            with self.subTest(ended_by=ended_by, finish=finish):
                store = self.make_store()
                run_id = _enqueue(store)
                make_call(store, run_id, ended_by, 0)
                recorded = _observe(store, run_id), list(store.audit)
                self.assertIn(recorded[0][0], TERMINAL_STATUSES)

                self.assertEqual(make_call(store, run_id, finish, 1), "ok")

                self.assertEqual((_observe(store, run_id), list(store.audit)), recorded)


class MemoryStoreContractTests(_StoreContract, unittest.TestCase):
    def make_store(self):
        return MemoryStore(clock=lambda: 1_000.0)


class FileStoreContractTests(_StoreContract, unittest.TestCase):
    def make_store(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return FileStore(Path(directory.name) / "store.json", clock=lambda: 1_000.0)


class PostgresModelContractTests(_StoreContract, unittest.TestCase):
    def make_store(self):
        return AtomicMemoryStore(clock=lambda: 1_000.0)


class EveryCallSequenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.memory, cls.model = (
            {
                (claimed, calls): answers(make(clock=lambda: 1_000.0), calls, claimed=claimed)
                for claimed, calls in call_sequences()
            }
            for make in (MemoryStore, AtomicMemoryStore)
        )

    def test_first_terminal_status_of_a_run_stands(self) -> None:
        for store, sequences in (("MemoryStore", self.memory), ("AtomicMemoryStore", self.model)):
            changed = []
            for sequence, seen in sequences.items():
                finished = next(
                    (step for step, answer in enumerate(seen) if answer.status in TERMINAL_STATUSES),
                    len(seen),
                )
                for answer in seen[finished:]:
                    if (answer.status, answer.error_code, answer.locked) != (
                        seen[finished].status,
                        seen[finished].error_code,
                        False,
                    ):
                        changed.append((sequence, seen[finished], answer))
                        break
            with self.subTest(store=store):
                self.assertEqual(changed[:3], [])


if __name__ == "__main__":
    unittest.main()
