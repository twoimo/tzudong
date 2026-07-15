import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))
import read_hosted_migration_ledger as ledger  # noqa: E402


class FakeCursor:
    def __init__(self, responses):
        self.responses = list(responses)
        self.executed = []
        self.rows = []
        self.closed = False
        self.aborted = False

    def execute(self, query):
        self.executed.append(query)
        if query.startswith("ROLLBACK TO SAVEPOINT"):
            self.aborted = False
            return
        if self.aborted:
            raise RuntimeError("current transaction is aborted")
        if query.startswith("SELECT"):
            response = self.responses.pop(0)
            if isinstance(response, Exception):
                self.aborted = True
                raise response
            self.rows = response

    def fetchall(self):
        return self.rows

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, responses):
        self.cursor_instance = FakeCursor(responses)
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class HostedMigrationLedgerTests(unittest.TestCase):
    def test_reads_ordered_rows_and_canonical_hash(self):
        connection = FakeConnection([[("20240101000000", "first"), ("20240202000000", "second")]])

        artifact = ledger.read_ledger(connection)

        rows = [{"version": "20240101000000", "name": "first"}, {"version": "20240202000000", "name": "second"}]
        self.assertEqual(rows, artifact["migrations"])
        self.assertEqual(2, artifact["rowCount"])
        self.assertEqual(
            hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            artifact["sha256"],
        )
        self.assertEqual("BEGIN READ ONLY", connection.cursor_instance.executed[0])
        self.assertIn("statement_timeout", connection.cursor_instance.executed[1])
        self.assertIn("lock_timeout", connection.cursor_instance.executed[2])
        self.assertIn("idle_in_transaction_session_timeout", connection.cursor_instance.executed[3])
        self.assertIn("SAVEPOINT ledger_variant_version_name", connection.cursor_instance.executed[4])
        self.assertIn("ORDER BY version ASC, name ASC LIMIT 1001", connection.cursor_instance.executed[5])
        self.assertEqual("RELEASE SAVEPOINT ledger_variant_version_name", connection.cursor_instance.executed[6])

    def test_rolls_back_failed_probe_before_known_variant(self):
        connection = FakeConnection([RuntimeError("missing name"), [("20240101000000", "renamed")]])

        artifact = ledger.read_ledger(connection)

        self.assertEqual("renamed", artifact["migrations"][0]["name"])
        queries = connection.cursor_instance.executed
        failed_select = next(index for index, query in enumerate(queries) if query.startswith("SELECT version, name"))
        rollback = queries.index("ROLLBACK TO SAVEPOINT ledger_variant_version_name")
        succeeding_select = next(index for index, query in enumerate(queries) if query.startswith("SELECT version, migration_name"))
        self.assertLess(failed_select, rollback)
        self.assertLess(rollback, succeeding_select)
        self.assertFalse(connection.cursor_instance.aborted)
        self.assertIn("RELEASE SAVEPOINT ledger_variant_version_migration_name", queries)
        self.assertTrue(connection.cursor_instance.closed)

    def test_uses_only_bounded_ledger_queries_and_known_variant(self):
        connection = FakeConnection([[("20240101000000", "safe")]])

        ledger.read_ledger(connection)

        allowed_prefixes = (
            "BEGIN READ ONLY",
            "SET LOCAL",
            "SAVEPOINT ledger_variant_",
            "RELEASE SAVEPOINT ledger_variant_",
            "ROLLBACK TO SAVEPOINT ledger_variant_",
            "SELECT version, name FROM supabase_migrations.schema_migrations",
            "SELECT version, migration_name FROM supabase_migrations.schema_migrations",
        )
        for query in connection.cursor_instance.executed:
            self.assertTrue(query.startswith(allowed_prefixes), query)
            self.assertNotIn("INSERT", query)
            self.assertNotIn("UPDATE", query)
            self.assertNotIn("DELETE", query)
            self.assertNotIn("pg_catalog", query)

    def test_rejects_invalid_duplicate_empty_and_over_bound_ledgers(self):
        cases = [
            [],
            [("20240101000000", "ok"), ("20240101000000", "ok")],
            [("not-a-version", "ok")],
            [(str(index), "ok") for index in range(ledger.MAX_ROWS + 1)],
        ]
        for rows in cases:
            with self.subTest(rows=len(rows)):
                with self.assertRaises(ValueError):
                    ledger.read_ledger(FakeConnection([rows, rows]))

    def test_artifact_validation_rejects_mutated_content(self):
        artifact = ledger.build_artifact([{"version": "20240101000000", "name": "safe_name"}])
        ledger.validate_artifact(artifact)
        artifact["migrations"][0]["name"] = "changed"
        with self.assertRaises(ValueError):
            ledger.validate_artifact(artifact)

    def test_requires_postgresql_uri(self):
        self.assertTrue(ledger._is_postgresql_uri("postgresql://user:password@db.example/database"))
        self.assertTrue(ledger._is_postgresql_uri("postgres://user:password@db.example/database"))
        self.assertFalse(ledger._is_postgresql_uri("host=db.example dbname=database"))
        self.assertFalse(ledger._is_postgresql_uri("https://db.example/database"))

    def test_main_requires_environment_and_redacts_secret(self):
        secret = "postgresql://user:very-secret@host/db"
        stderr = io.StringIO()
        with patch.dict(os.environ, {"SUPABASE_DB_URL": secret}, clear=False), patch.object(
            ledger, "connect_from_environment", side_effect=RuntimeError(secret)
        ), contextlib.redirect_stderr(stderr):
            self.assertEqual(1, ledger.main(["--output", "unused.json"]))
        self.assertNotIn(secret, stderr.getvalue())
        self.assertEqual("hosted migration ledger audit failed\n", stderr.getvalue())

    def test_main_validates_artifact_without_database_connection(self):
        artifact = ledger.build_artifact([{"version": "20240101000000", "name": "safe_name"}])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "artifact.json"
            path.write_text(json.dumps(artifact), encoding="utf-8")
            with patch.object(ledger, "connect_from_environment") as connect:
                self.assertEqual(0, ledger.main(["--validate-artifact", str(path)]))
                connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
