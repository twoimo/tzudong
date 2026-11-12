"""Baseline capture and provisioning, exercised without Docker.

The behaviour worth pinning is the part that failed in production: a restore that
reported success while creating nothing. These tests drive the real module through an
injected command runner, so the assertions cover the decision logic rather than a mock
of it.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import local_baseline as lb  # noqa: E402


def completed(stdout: bytes = b"", stderr: bytes = b"", code: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=code, stdout=stdout, stderr=stderr)


def make_runner(*, names, roles, restored=None, setup_stderr=b"", restore_stderr=b""):
    """Answer docker calls by what they ask for, and switch names after the restore."""
    state = {"restored": False}

    def runner(command, capture_output=True):
        joined = " ".join(command)
        if "pg_dump" in joined:
            return completed(stdout=b"-- schema\n")
        if "pg_catalog.pg_roles r" in joined:
            return completed(stdout=("\n".join(roles) + ("\n" if roles else "")).encode())
        if "pg_catalog.pg_class c" in joined:
            pool = (restored if state["restored"] else names) or []
            return completed(stdout=("\n".join(pool) + ("\n" if pool else "")).encode())
        if "-f /tmp/baseline-setup.sql" in joined:
            return completed(stderr=setup_stderr)
        if "-f /tmp/baseline-schema.sql" in joined:
            state["restored"] = True
            return completed(stderr=restore_stderr)
        if command[:2] == ["docker", "cp"]:
            return completed()
        raise AssertionError(f"unexpected command: {joined}")

    return runner


class CaptureTests(unittest.TestCase):
    def test_capture_refuses_an_empty_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                lb.capture("db", "postgres", Path(tmp), source_image="img",
                           runner=make_runner(names=[], roles=[]))

    def test_capture_writes_a_self_verifying_baseline(self) -> None:
        names = ["public.restaurants", "privacy_retention.audit_log"]
        roles = ["CREATE ROLE privacy_workflow_owner NOLOGIN"]
        with tempfile.TemporaryDirectory() as tmp:
            baseline = lb.capture("db", "postgres", Path(tmp), source_image="supabase/postgres:15.8.1.085",
                                  runner=make_runner(names=names, roles=roles))
            self.assertEqual(baseline.manifest["objectCount"], 2)
            self.assertEqual(baseline.manifest["roleStatementCount"], 1)
            self.assertTrue((Path(tmp) / "objects.txt").is_file())
            # The target cluster has no roles, so the baseline must carry them.
            self.assertIn("privacy_workflow_owner", (Path(tmp) / "roles.sql").read_text())
            reloaded = lb.load_baseline(Path(tmp))
            self.assertEqual(reloaded.manifest["schemaSha256"], baseline.manifest["schemaSha256"])


class LoadTests(unittest.TestCase):
    def _baseline(self, tmp: Path) -> Path:
        lb.capture("db", "postgres", tmp, source_image="img",
                   runner=make_runner(names=["public.a"], roles=["CREATE ROLE x NOLOGIN"]))
        return tmp

    def test_tampered_schema_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._baseline(Path(tmp))
            (path / "schema.sql").write_text("-- tampered\n")
            with self.assertRaises(SystemExit):
                lb.load_baseline(path)

    def test_missing_roles_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._baseline(Path(tmp))
            (path / "roles.sql").unlink()
            with self.assertRaises(SystemExit):
                lb.load_baseline(path)

    def test_tampered_objects_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = self._baseline(Path(tmp))
            (path / "objects.txt").write_text("public.injected\n")
            with self.assertRaises(SystemExit):
                lb.load_baseline(path)


class ProvisionTests(unittest.TestCase):
    def _baseline(self, tmp: Path, names) -> lb.Baseline:
        return lb.capture("db", "postgres", tmp, source_image="img",
                          runner=make_runner(names=names, roles=["CREATE ROLE privacy_workflow_owner NOLOGIN"]))

    def test_clean_restore_is_provisioned(self) -> None:
        names = ["public.a", "public.b"]
        with tempfile.TemporaryDirectory() as tmp:
            baseline = self._baseline(Path(tmp), names)
            record = lb.provision(baseline, "target", "profile",
                                  runner=make_runner(names=names, roles=[], restored=names))
            self.assertTrue(record["provisioned"])
            self.assertEqual(record["restoredObjectCount"], 2)
            self.assertEqual(record["preparedRoleCount"], 1)

    def test_a_missing_object_blocks_success(self) -> None:
        names = ["public.a", "public.b"]
        with tempfile.TemporaryDirectory() as tmp:
            baseline = self._baseline(Path(tmp), names)
            record = lb.provision(baseline, "target", "profile",
                                  runner=make_runner(names=names, roles=[], restored=["public.a"]))
            self.assertFalse(record["provisioned"])
            self.assertEqual(record["missingObjects"], ["public.b"])

    def test_a_setup_error_blocks_success(self) -> None:
        names = ["public.a"]
        with tempfile.TemporaryDirectory() as tmp:
            baseline = self._baseline(Path(tmp), names)
            record = lb.provision(
                baseline, "target", "profile",
                runner=make_runner(names=names, roles=[], restored=names,
                                   setup_stderr=b'psql: ERROR:  syntax error at or near "CREATE"\n'))
            self.assertFalse(record["provisioned"])
            self.assertEqual(record["setupErrorCount"], 1)

    def test_role_statements_are_terminated(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            baseline = self._baseline(Path(tmp), ["public.a"])
            record = lb.provision(baseline, "target", "profile",
                                  runner=make_runner(names=["public.a"], roles=[], restored=["public.a"]))
            setup = (Path(tmp) / "provision-setup.sql").read_text()
            statement = [line for line in setup.splitlines() if line.startswith("CREATE ROLE")][0]
            self.assertTrue(statement.endswith(";"), statement)
            self.assertTrue(record["provisioned"])

    def test_manifest_is_json_serialisable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            baseline = self._baseline(Path(tmp), ["public.a"])
            json.dumps(baseline.manifest)


if __name__ == "__main__":
    unittest.main()
