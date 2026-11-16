from __future__ import annotations

import itertools
import os
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from backend.pipeline_control.pg_store import AtomicMemoryStore, PostgresStore
from backend.pipeline_control.state_machine import TERMINAL_STATUSES, ControlPlaneError
from backend.pipeline_control.test_store_parity_unittest import (
    Answer,
    answers,
    call_sequences,
    make_call,
)

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = (
    "20260817020000_pipeline_control.sql",
    "20260820030000_pipeline_control_atomic.sql",
)


@unittest.skipUnless(os.environ.get("TZUDONG_TEST_POSTGRES_BIN"), "isolated postgres opt-in absent")
class PostgresStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import psycopg2

        cls.tmp = tempfile.TemporaryDirectory(prefix="tzq-", dir="/tmp")
        cls.addClassCleanup(cls.tmp.cleanup)
        bindir = Path(os.environ["TZUDONG_TEST_POSTGRES_BIN"])
        data = Path(cls.tmp.name) / "data"

        def run(*args: str) -> None:
            subprocess.run(
                [str(bindir / args[0]), *args[1:]],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        run("initdb", "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8")
        run(
            "pg_ctl",
            "-D",
            str(data),
            "-l",
            str(Path(cls.tmp.name) / "server.log"),
            "-o",
            f"-c listen_addresses='' -c unix_socket_directories='{cls.tmp.name}'",
            "-w",
            "start",
        )
        cls.addClassCleanup(lambda: run("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"))
        cls.admin = psycopg2.connect(f"dbname=postgres host={cls.tmp.name}")
        cls.addClassCleanup(cls.admin.close)
        cls.admin.autocommit = True
        with cls.admin.cursor() as cur:
            cur.execute("CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;")
            for name in MIGRATIONS:
                cur.execute((ROOT / "supabase/migrations" / name).read_text(encoding="utf-8"))
        environment = patch.dict(
            os.environ,
            {
                "TZUDONG_DATA_ENV": "local_db",
                "PIPELINE_CONTROL_DSN": f"postgresql://localhost/postgres?host={cls.tmp.name}",
            },
        )
        environment.start()
        cls.addClassCleanup(environment.stop)
        cls.store = PostgresStore()
        cls.addClassCleanup(cls.store.close)

    def _enqueue(self, *, claimed: bool = False) -> str:
        run_id, target = str(uuid.uuid4()), f"target-{uuid.uuid4().hex}"
        with self.admin.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_control.jobs (
                    id, target, profile, status, idempotency_key, payload_hash,
                    actor, request_id, lease_until, heartbeat_at
                ) VALUES (
                    %s, %s, 'heavy_local', 'Queued', %s, 'hash',
                    'qa', 'req-parity', now() + interval '30 seconds', now()
                )
                """,
                (run_id, target, f"key-{run_id}"),
            )
            cur.execute(
                "INSERT INTO pipeline_control.locks (lock_key, job_id) VALUES (%s, %s)",
                (f"{target}:heavy_local", run_id),
            )
        if claimed:
            self.assertEqual(self.store.claim(run_id).status, "Fetching")
        return run_id

    def _observe(self, run_id: str) -> tuple:
        with self.admin.cursor() as cur:
            cur.execute(
                """
                SELECT j.status, j.error_code, l.job_id IS NOT NULL,
                       j.pause_requested, j.cancel_requested
                FROM pipeline_control.jobs j
                LEFT JOIN pipeline_control.locks l ON l.job_id = j.id
                WHERE j.id = %s
                """,
                (run_id,),
            )
            return cur.fetchone()

    def _audit(self, run_id: str) -> list[str]:
        with self.admin.cursor() as cur:
            cur.execute(
                "SELECT transition FROM pipeline_control.audit WHERE job_id = %s ORDER BY id",
                (run_id,),
            )
            return [row[0] for row in cur.fetchall()]

    def test_finish_records_the_status_frees_the_target_and_writes_one_audit_row(self) -> None:
        for finish, status, error_code, transition in (
            ("finish_succeeded", "Succeeded", None, "dry_run_succeeded"),
            ("finish_failed", "Failed", "failure_0", "failed"),
        ):
            with self.subTest(finish=finish):
                run_id = self._enqueue(claimed=True)

                self.assertEqual(make_call(self.store, run_id, finish, 0), "ok")

                self.assertEqual(self._observe(run_id)[:3], (status, error_code, False))
                self.assertEqual(self._audit(run_id), ["claim", transition])

    def test_finish_after_a_terminal_status_changes_nothing(self) -> None:
        for ended_by, finish in itertools.product(
            ("cancel", "finish_succeeded", "finish_failed"),
            ("finish_succeeded", "finish_failed"),
        ):
            with self.subTest(ended_by=ended_by, finish=finish):
                run_id = self._enqueue()
                make_call(self.store, run_id, ended_by, 0)
                recorded = self._observe(run_id), self._audit(run_id)
                self.assertIn(recorded[0][0], TERMINAL_STATUSES)

                self.assertEqual(make_call(self.store, run_id, finish, 1), "ok")

                self.assertEqual((self._observe(run_id), self._audit(run_id)), recorded)

    def test_claim_that_cannot_write_its_audit_row_leaves_the_run_queued(self) -> None:
        run_id = self._enqueue()
        with self.admin.cursor() as cur:
            cur.execute(
                """
                CREATE FUNCTION public.refuse_audit() RETURNS trigger LANGUAGE plpgsql
                AS $$ BEGIN RAISE EXCEPTION 'audit_unavailable'; END $$;
                CREATE TRIGGER refuse_audit BEFORE INSERT ON pipeline_control.audit
                FOR EACH ROW EXECUTE FUNCTION public.refuse_audit();
                """
            )

        def allow_audit() -> None:
            with self.admin.cursor() as cur:
                cur.execute(
                    "DROP TRIGGER IF EXISTS refuse_audit ON pipeline_control.audit;"
                    "DROP FUNCTION IF EXISTS public.refuse_audit();"
                )

        self.addCleanup(allow_audit)

        with self.assertRaises(ControlPlaneError):
            self.store.claim(run_id)

        self.assertEqual((self._observe(run_id), self._audit(run_id)), (("Queued", None, True, False, False), []))
        allow_audit()
        self.assertEqual(self.store.claim(run_id).status, "Fetching")
        self.assertEqual(self._audit(run_id), ["claim"])

    def test_heartbeat_of_a_finished_run_is_refused_and_changes_nothing(self) -> None:
        for ended_by in ("cancel", "finish_succeeded", "finish_failed"):
            with self.subTest(ended_by=ended_by):
                run_id = self._enqueue()
                make_call(self.store, run_id, ended_by, 0)
                recorded = self.store.get(run_id), self._audit(run_id)

                with self.assertRaises(ControlPlaneError) as refused:
                    self.store.beat(run_id)

                self.assertEqual(refused.exception.code, "illegal_transition")
                self.assertEqual((self.store.get(run_id), self._audit(run_id)), recorded)

    def test_heartbeat_leaves_a_pending_pause_for_the_step_boundary(self) -> None:
        run_id = self._enqueue(claimed=True)
        self.store.control(run_id, "pause", actor="operator", request_id="req-pause")

        beaten = self.store.beat(run_id)

        self.assertEqual((beaten.status, beaten.pause_requested), ("Fetching", True))
        self.assertEqual(self.store.checkpoint(run_id).status, "Paused")

    def test_model_answers_every_call_sequence_like_the_real_store(self) -> None:
        different = []
        for claimed, calls in call_sequences():
            model = answers(AtomicMemoryStore(clock=lambda: 1_000.0), calls, claimed=claimed)
            run_id = self._enqueue(claimed=claimed)
            real = [
                Answer(make_call(self.store, run_id, name, step), *self._observe(run_id))
                for step, name in enumerate(calls)
            ]
            if real != model:
                different.append((claimed, calls, real, model))
        self.assertEqual(different[:3], [])


if __name__ == "__main__":
    unittest.main()
