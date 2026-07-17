import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts" / "preflight_g034_hosted_migration_closure.py"
spec = importlib.util.spec_from_file_location("g034_preflight", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeCursor:
    def __init__(self, fail_on=None, catalog_issue=None, named_arguments=False):
        self.sql = []
        self.fail_on = fail_on
        self.catalog_issue = catalog_issue
        self.named_arguments = named_arguments
        self.closed = False
        self.last_sql = ""

    def execute(self, sql, params=None):
        self.sql.append((sql, params))
        self.last_sql = sql
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("database diagnostic containing a secret")

    def fetchall(self):
        return [("20260531084516",)]

    def fetchone(self):
        if "pg_catalog.pg_class AS class" in self.last_sql:
            return (self.catalog_issue not in {"missing", "wrong-schema", "wrong-name", "wrong-relkind", "decoy"},)
        if "pg_catalog.pg_proc AS procedure" in self.last_sql:
            if self.named_arguments and "pg_get_function_identity_arguments" in self.last_sql:
                return (False,)
            return (self.catalog_issue not in {"missing", "wrong-schema", "wrong-name", "wrong-input-types", "wrong-prokind", "decoy"},)
        if "pg_locks" in self.last_sql:
            return (0,)
        if "pg_roles" in self.last_sql:
            return (3,)
        raise AssertionError(self.last_sql)

    def close(self):
        self.closed = True

class FakeConnection:
    def __init__(self, cursor):
        self.cursor_value = cursor
        self.closed = False
        self.commits = 0

    def cursor(self):
        return self.cursor_value

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


class G034HostedPreflightTests(unittest.TestCase):
    def report(self):
        return {"blockers": [], "ledgerExpectedTerminal": "20260531084516"}

    def run_catalog(self, cursor):
        connection = FakeConnection(cursor)
        fake_psycopg = types.SimpleNamespace(connect=lambda url, autocommit: self.assert_connect(url, autocommit, connection))
        with patch.dict(sys.modules, {"psycopg": fake_psycopg}), patch.dict(os.environ, {"SUPABASE_DB_URL": "postgresql://not-reported"}):
            report = self.report()
            module.catalog_preflight(report)
        return report, connection, cursor

    def assert_connect(self, url, autocommit, connection):
        self.assertEqual("postgresql://not-reported", url)
        self.assertTrue(autocommit)
        return connection

    def test_manifest_is_exact_selected_closure_and_later_gate(self):
        data = module.load_manifest(module.MANIFEST)
        self.assertEqual(27, len(data["migrations"]))
        self.assertEqual("20260627080000", data["migrations"][0]["version"])
        self.assertEqual("20260713002400", data["migrations"][-1]["version"])
        self.assertEqual(module.EXPECTED_MANIFEST_SHA256, module.hashlib.sha256(module.MANIFEST.read_bytes()).hexdigest())

    def test_manifest_rejects_canonical_path_and_semantic_drift(self):
        data = json.loads(module.MANIFEST.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            data["migrations"][0]["path"] = "backend/supabase/migrations/decoy.sql"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_manifest(path)
            data = json.loads(module.MANIFEST.read_text(encoding="utf-8"))
            data["cloneBackupRecoveryRequired"] = False
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ValueError):
                module.load_manifest(path)

    def test_first_sql_is_read_only_with_timeouts_and_explicit_rollback(self):
        report, connection, cursor = self.run_catalog(FakeCursor())
        self.assertEqual([], report["blockers"])
        self.assertEqual("BEGIN READ ONLY", cursor.sql[0][0])
        self.assertEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '5000ms'", "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL idle_in_transaction_session_timeout = '5000ms'"], [item[0] for item in cursor.sql[:4]])
        self.assertEqual("ROLLBACK", cursor.sql[-1][0])
        self.assertEqual(0, connection.commits)
        self.assertTrue(connection.closed)

    def test_exception_rolls_back_without_leaking_driver_error(self):
        report, connection, cursor = self.run_catalog(FakeCursor(fail_on="schema_migrations"))
        self.assertIn("catalog-read-failed", report["blockers"])
        self.assertNotIn("database diagnostic", report["blockers"])
        self.assertEqual("ROLLBACK", cursor.sql[-1][0])
        self.assertEqual(0, connection.commits)

    def test_catalog_identity_is_oid_based_and_ignores_display_forms(self):
        report, _, cursor = self.run_catalog(FakeCursor(named_arguments=True))
        self.assertEqual([], report["blockers"])
        catalog_sql = [sql for sql, _ in cursor.sql if "to_reg" in sql]
        procedure_checks = [(sql, params) for sql, params in cursor.sql if "to_regprocedure" in sql]
        self.assertTrue(catalog_sql)
        self.assertTrue(all("::text" not in sql for sql in catalog_sql))
        self.assertTrue(all("pg_namespace" in sql for sql in catalog_sql))
        self.assertTrue(all(params[0].startswith(("public.", "storage.")) for sql, params in cursor.sql if "to_regclass" in sql))
        self.assertTrue(all("(" in params[0] for _, params in procedure_checks))
        self.assertTrue(any("class.relkind = 'r'" in sql for sql in catalog_sql))
        self.assertTrue(all("pg_get_function_identity_arguments" not in sql for sql, _ in procedure_checks))
        self.assertTrue(all("procedure.proargtypes = %s::pg_catalog.oidvector" in sql for sql, _ in procedure_checks))
        self.assertEqual(["2950 2950 3802"] * len(procedure_checks), [params[3] for _, params in procedure_checks])
        self.assertTrue(all("procedure.prokind = 'f'" in sql for sql, _ in procedure_checks))

    def test_catalog_identity_decoys_fail_closed(self):
        for issue in ("missing", "wrong-schema", "wrong-name", "wrong-relkind", "wrong-input-types", "wrong-prokind", "decoy"):
            with self.subTest(issue=issue):
                report, _, _ = self.run_catalog(FakeCursor(catalog_issue=issue))
                self.assertIn("catalog-prerequisite", report["blockers"])

    def test_validate_only_retains_unconditional_clone_backup_blocker(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "artifact.json"
            self.assertEqual(0, module.main(["--validate-only", "--artifact", str(artifact)]))
            report = json.loads(artifact.read_text(encoding="utf-8"))
        self.assertTrue(report["sourceValid"])
        self.assertFalse(report["safeToApply"])
        self.assertTrue(report["cloneBackupRecoveryRequired"])
        self.assertIn("clone-backup-recovery-required", report["blockers"])


if __name__ == "__main__":
    unittest.main()
