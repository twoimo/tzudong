from __future__ import annotations

import itertools
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from typing import Iterator, NamedTuple

from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.pg_store import AtomicMemoryStore
from backend.pipeline_control.state_machine import TERMINAL_STATUSES, ControlPlaneError, lock_key
from backend.pipeline_control.store import MemoryStore

CALLS = ("pause", "resume", "cancel", "boundary", "finish_succeeded", "finish_failed")
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

    def test_finish_of_an_unknown_run_is_refused_as_not_found(self) -> None:
        store = self.make_store()
        for finish in ("finish_succeeded", "finish_failed"):
            with self.subTest(finish=finish):
                self.assertEqual(make_call(store, "unknown-run", finish, 0), "run_not_found")

    def test_heartbeat_of_a_finished_run_is_refused_and_changes_nothing(self) -> None:
        for ended_by in ("cancel", "finish_succeeded", "finish_failed"):
            with self.subTest(ended_by=ended_by):
                store = self.make_store()
                run_id = _enqueue(store)
                make_call(store, run_id, ended_by, 0)
                recorded = asdict(store.get(run_id)), list(store.audit), dict(store.locks)

                with self.assertRaises(ControlPlaneError) as refused:
                    store.beat(run_id)

                self.assertEqual(refused.exception.code, "illegal_transition")
                self.assertEqual(
                    (asdict(store.get(run_id)), list(store.audit), dict(store.locks)), recorded
                )

    def test_paused_run_keeps_its_pause_request_until_it_is_resumed(self) -> None:
        for claimed in (False, True):
            with self.subTest(claimed=claimed):
                store = self.make_store()
                run_id = _enqueue(store, claimed=claimed)
                make_call(store, run_id, "pause", 0)
                if claimed:
                    make_call(store, run_id, "boundary", 1)
                paused = store.get(run_id)
                self.assertEqual((paused.status, paused.pause_requested), ("Paused", True))

                make_call(store, run_id, "resume", 2)

                resumed = store.get(run_id)
                self.assertEqual((resumed.status, resumed.pause_requested), ("Queued", False))


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

    def test_postgres_model_answers_an_unfinished_run_like_memory_store(self) -> None:
        different = []
        for (claimed, calls), memory in self.memory.items():
            for step, (ours, theirs) in enumerate(zip(memory, self.model[claimed, calls])):
                if ours != theirs:
                    different.append((claimed, calls[: step + 1], ours, theirs))
                if ours != theirs or ours.status in TERMINAL_STATUSES:
                    break
        self.assertEqual(different[:3], [])

    def test_only_a_resume_of_a_finished_run_is_answered_differently(self) -> None:
        different = set()
        for (claimed, calls), memory in self.memory.items():
            finished = False
            for name, ours, theirs in zip(calls, memory, self.model[claimed, calls]):
                if finished and ours.result != theirs.result:
                    different.add((name, ours.result, theirs.result))
                finished = finished or ours.status in TERMINAL_STATUSES
        self.assertEqual(different, {("resume", "illegal_transition", "ok")})


if __name__ == "__main__":
    unittest.main()
