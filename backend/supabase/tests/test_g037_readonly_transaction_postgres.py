"""Controller transaction regression on a private, disposable PostgreSQL cluster.

Opt in with TZUDONG_TEST_POSTGRES_BIN. No TCP or hosted credentials are used.
The synthetic mutator is never called; its EXECUTE privilege is only inspected.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g037_hosted_closure_executor as executor


@unittest.skipUnless(os.environ.get("TZUDONG_TEST_POSTGRES_BIN"), "isolated postgres opt-in absent")
class ReadonlyTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.psycopg = psycopg
        cls.tmp = tempfile.TemporaryDirectory(prefix="g037pg-", dir="/tmp")
        cls.addClassCleanup(cls.tmp.cleanup)
        bindir = Path(os.environ["TZUDONG_TEST_POSTGRES_BIN"])
        data = Path(cls.tmp.name) / "data"

        def run(*args):
            subprocess.run([str(bindir / args[0]), *args[1:]], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        run("initdb", "-D", str(data), "-A", "trust", "--no-locale", "--encoding=UTF8")
        run("pg_ctl", "-D", str(data), "-l", str(Path(cls.tmp.name) / "server.log"),
            "-o", f"-c listen_addresses='' -c unix_socket_directories='{cls.tmp.name}'", "-w", "start")
        cls.addClassCleanup(lambda: run("pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"))
        with psycopg.connect(host=cls.tmp.name, dbname="postgres") as conn:
            conn.execute("""
                CREATE ROLE tzudong_g037_readonly LOGIN NOINHERIT NOSUPERUSER
                    NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
                CREATE ROLE fixture_creator CREATEROLE NOSUPERUSER NOLOGIN;
                GRANT tzudong_g037_readonly TO fixture_creator
                    WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
                GRANT CONNECT ON DATABASE postgres TO tzudong_g037_readonly;
                CREATE SCHEMA supabase_migrations;
                CREATE TABLE supabase_migrations.schema_migrations(version text,name text,statements text[]);
                GRANT USAGE ON SCHEMA supabase_migrations TO tzudong_g037_readonly;
                GRANT SELECT(version,name,statements) ON supabase_migrations.schema_migrations
                    TO tzudong_g037_readonly;
                CREATE FUNCTION public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)
                    RETURNS boolean LANGUAGE sql AS 'SELECT false';
                REVOKE ALL ON FUNCTION public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)
                    FROM PUBLIC;
                ALTER ROLE tzudong_g037_readonly SET default_transaction_read_only=on;
                ALTER ROLE tzudong_g037_readonly SET idle_in_transaction_session_timeout='30s';
                ALTER ROLE tzudong_g037_readonly SET lock_timeout='10s';
                ALTER ROLE tzudong_g037_readonly SET search_path=pg_catalog;
                ALTER ROLE tzudong_g037_readonly SET statement_timeout='30s';
            """)

    def connection(self):
        conn = self.psycopg.connect(host=self.tmp.name, dbname="postgres", user="tzudong_g037_readonly")
        self.addCleanup(conn.close)
        return conn

    def test_old_admission_first_order_reproduces_sqlstate_25001(self):
        conn = self.connection()
        cursor = conn.cursor()
        executor.readonly_role_admission(cursor)  # All 33 real predicates pass.
        with self.assertRaises(self.psycopg.errors.ActiveSqlTransaction) as raised:
            cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        self.assertEqual(raised.exception.sqlstate, "25001")
        conn.rollback()

    def test_runtime_probe_uses_real_admission_and_privileges_then_closes(self):
        conn = self.connection()
        real_probe = executor.runtime_probe

        def observe_snapshot(cursor):
            cursor.execute("SELECT current_setting('transaction_isolation'), current_setting('transaction_read_only')")
            self.assertEqual(cursor.fetchone(), ("repeatable read", "on"))
            return real_probe(cursor)

        with patch.object(executor, "connection", return_value=conn), patch.object(executor, "runtime_probe", side_effect=observe_snapshot):
            result = executor.run(SimpleNamespace(mode="runtime-probe", db_env="UNUSED_LOCAL_FIXTURE"))
        self.assertEqual(result["status"], "authorization-denied")
        self.assertTrue(result["evidence"]["runtime_authorization_denied"])
        self.assertTrue(conn.closed)

    def test_catalog_modes_admit_then_reject_empty_fixture_ledger_and_close(self):
        for mode in ("preflight", "readback", "reconciliation-readback"):
            with self.subTest(mode=mode):
                conn = self.connection()
                with patch.object(executor, "connection", return_value=conn):
                    with self.assertRaises(executor.ClosureError):
                        executor.run(SimpleNamespace(mode=mode, db_env="UNUSED_LOCAL_FIXTURE"))
                self.assertTrue(conn.closed)

    def test_snapshot_disallows_writes_even_after_role_admission(self):
        conn = self.connection()
        cursor = conn.cursor()
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        executor.readonly_role_admission(cursor)
        with self.assertRaises(self.psycopg.errors.ReadOnlySqlTransaction):
            cursor.execute("CREATE TEMP TABLE forbidden_fixture_write(id integer)")
        conn.rollback()


if __name__ == "__main__":
    unittest.main()
