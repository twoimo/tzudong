import hashlib
import importlib.util
import json
import re
import stat
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "backend/supabase/scripts/local-migrate.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("local_migrate_contract_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load local-migrate.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_migrate = _load_module()


class LocalMigrationContractTests(unittest.TestCase):
    def test_function_source_evidence_binds_both_exact_edge_functions(self) -> None:
        functions = {
            "root": "functions",
            "files": list(local_migrate.FUNCTION_SOURCES),
        }
        records = [
            {
                "path": path,
                "source": path,
                "source_sha256": character * 64,
            }
            for path, character in zip(local_migrate.FUNCTION_SOURCES, ("a", "b"))
        ]
        expected = hashlib.sha256(json.dumps(
            [
                {"path": record["path"], "sha256": record["source_sha256"]}
                for record in records
            ],
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("ascii")).hexdigest()
        self.assertEqual(
            local_migrate._function_source_evidence(functions, records),
            expected,
        )

        for invalid_functions, invalid_records in (
            ({"root": "functions", "files": [local_migrate.FUNCTION_SOURCES[0]]}, records),
            (functions, records[:-1]),
            (functions, list(reversed(records))),
            (functions, [{**records[0], "source": "functions/other/index.ts"}, records[1]]),
            (functions, [records[0], {**records[1], "source_sha256": "not-a-digest"}]),
        ):
            with self.subTest(functions=invalid_functions, records=invalid_records):
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "receipt_input_provenance",
                ):
                    local_migrate._function_source_evidence(
                        invalid_functions, invalid_records
                    )

    def test_manifest_is_source_bound_hash_bound_and_name_ordered(self) -> None:
        manifest = local_migrate.build_manifest()
        source = manifest["source"]
        paths = local_migrate.migration_files()

        self.assertEqual(manifest["schemaVersion"], "local-supabase-migration-manifest/v1")
        self.assertEqual(source["root"], "backend/supabase/migrations")
        self.assertEqual(source["migrationCount"], len(paths))
        self.assertEqual([item["ordinal"] for item in source["files"]], list(range(1, len(paths) + 1)))
        self.assertEqual([item["path"] for item in source["files"]], [
            path.relative_to(ROOT).as_posix() for path in paths
        ])

        chain_parts = []
        for item, path in zip(source["files"], paths):
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            self.assertEqual(item["byteLength"], len(data))
            self.assertEqual(item["sha256"], digest)
            chain_parts.extend((item["path"].encode("utf-8"), b"\0", digest.encode("ascii"), b"\n"))
        self.assertEqual(source["chainSha256"], hashlib.sha256(b"".join(chain_parts)).hexdigest())

        canonical = json.dumps(manifest, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
        self.assertEqual(local_migrate.manifest_digest(manifest), hashlib.sha256(canonical).hexdigest())
        self.assertEqual(manifest["exclusions"], list(local_migrate.LOCAL_MANIFEST_EXCLUSIONS))
        self.assertEqual(len(manifest["exclusions"]), 8)
        for name, digest in local_migrate.HOSTED_ONLY_MIGRATION_SOURCE_SHA256.items():
            self.assertIn(
                f"backend/supabase/migrations/{name}@sha256:{digest}",
                manifest["exclusions"],
            )

    def test_hosted_only_sources_are_exactly_bound_and_never_enter_local_ledger(self) -> None:
        canonical_root = ROOT / "backend/supabase/migrations"
        hosted_sources = {
            name: (canonical_root / name).read_bytes()
            for name in local_migrate.HOSTED_ONLY_MIGRATION_SOURCE_SHA256
        }

        def populate(root: Path) -> None:
            (root / "20260101000000_local_fixture.sql").write_text(
                "SELECT 1;\n", encoding="utf-8"
            )
            for name, data in hosted_sources.items():
                (root / name).write_bytes(data)

        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            populate(root)
            with patch.object(local_migrate, "source_root", return_value=root):
                self.assertEqual(
                    [path.name for path in local_migrate.migration_files()],
                    ["20260101000000_local_fixture.sql"],
                )

                drifted = root / next(iter(local_migrate.HOSTED_ONLY_MIGRATION_SOURCE_SHA256))
                original = drifted.read_bytes()
                drifted.write_bytes(original + b"\n")
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "hosted_only_migration_source_drift",
                ):
                    local_migrate.migration_files()
                drifted.write_bytes(original)

                drifted.unlink()
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "hosted_only_migration_missing",
                ):
                    local_migrate.migration_files()
                drifted.write_bytes(original)

                unknown = root / "20260814010400_hosted_unknown.sql"
                unknown.write_text("SELECT 1;\n", encoding="utf-8")
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "hosted_only_migration_unrecognized",
                ):
                    local_migrate.migration_files()
                unknown.unlink()

                unknown_upper = root / "20260814010401_HOSTED_unknown.sql"
                unknown_upper.write_text("SELECT 1;\n", encoding="utf-8")
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "hosted_only_migration_unrecognized",
                ):
                    local_migrate.migration_files()
                unknown_upper.unlink()

                # migration_files sorts directory entries before suffix filtering,
                # so keep the non-SQL symlink target outside the candidate set while
                # retaining a valid numeric sort prefix.
                target = root / "20260814019999_hosted-target.bin"
                target.write_bytes(drifted.read_bytes())
                drifted.unlink()
                drifted.symlink_to(target)
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "source_file_not_regular",
                ):
                    local_migrate.migration_files()

    def test_transaction_classification_masks_comments_and_literals(self) -> None:
        self.assertEqual(local_migrate.transaction_control("CREATE TABLE sample(id integer);")["class"], "transactional")
        explicit = local_migrate.transaction_control("BEGIN; CREATE TABLE sample(id integer); SAVEPOINT before_commit;")
        self.assertEqual(explicit["class"], "transactional_explicit")
        self.assertTrue(explicit["hasBegin"])
        self.assertTrue(explicit["hasSavepoint"])

        committing = local_migrate.transaction_control("-- COMMIT\nSELECT 'ROLLBACK';\nCOMMIT;")
        self.assertEqual(committing["class"], "self_committing")
        self.assertTrue(committing["hasCommit"])
        self.assertFalse(committing["hasRollback"])

    def test_ddl_prerequisite_is_ddl_only_and_localizes_extensions(self) -> None:
        sql = b"CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE sample(id integer);\n"
        transformed = local_migrate.transform_ddl_prerequisite(sql).decode("utf-8")
        self.assertTrue(transformed.startswith("CREATE SCHEMA IF NOT EXISTS extensions;\n"))
        self.assertIn('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;', transformed)
        self.assertIn("CREATE TABLE sample(id integer);", transformed)

        for rejected in (
            b"INSERT INTO sample VALUES (1);",
            b"CREATE TABLE sample(id integer); SELECT 1;",
            b"CREATE EXTENSION postgres_fdw;",
            b"CREATE TABLE sample(id integer); -- postgres://cloud.example/db\n",
            b"\\copy sample FROM '/tmp/seed.csv'",
        ):
            with self.subTest(rejected=rejected):
                with self.assertRaises(local_migrate.LocalMigrationError):
                    local_migrate.transform_ddl_prerequisite(rejected)

    def test_source_rejects_cloud_and_noncanonical_custody(self) -> None:
        for text in (
            "CREATE TABLE t(id integer);\n-- DATABASE_URL=postgres://cloud/db\n",
            "CREATE TABLE t(id integer);\n-- https://project.supabase.co\n",
            "CREATE TABLE t(id integer);\n-- cloud.google.com\n",
        ):
            with self.subTest(text=text):
                with self.assertRaisesRegex(local_migrate.LocalMigrationError, "cloud_input_rejected"):
                    local_migrate._reject_source_text(text.encode("utf-8"))

        rejected_paths = (
            ROOT / "apps/web/supabase/migrations/20260101000000_app_tree.sql",
            ROOT / "backend/supabase/baselines/historical/replay.sql",
            ROOT / "tmp/replay-authorized-false.sql",
        )
        for path in rejected_paths:
            with self.subTest(path=path):
                with self.assertRaisesRegex(
                    local_migrate.LocalMigrationError,
                    "historical_or_hosted_source_rejected",
                ):
                    local_migrate._reject_path_custody(path)

    def test_filename_contract_is_checked_before_manifest_admission(self) -> None:
        self.assertRegex("20260801000100_contract.sql", r"^\d{8,14}(?:_|\.)")
        self.assertIsNone(re.match(r"^\d{8,14}(?:_|\.)", "seed.sql"))
        with self.assertRaisesRegex(local_migrate.LocalMigrationError, "source_root_not_canonical"):
            local_migrate.migration_files(ROOT / "backend/supabase")

    def test_docker_context_accepts_github_actions_root_socket_only(self) -> None:
        socket_info = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o660, st_uid=0)
        admission_info = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0)
        selected = SimpleNamespace(returncode=0, stdout="default\n")
        inspected = SimpleNamespace(
            returncode=0,
            stdout=json.dumps([{
                "Endpoints": {"docker": {"Host": "unix:///var/run/docker.sock"}},
            }]),
        )
        admission_path = Path("/run/tzudong-nightly-local-admission-123-2")
        admission_payload = b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"
        admission_read = SimpleNamespace(returncode=0, stdout=admission_payload)

        def admitted_lstat(path: Path):
            return socket_info if path == Path("/var/run/docker.sock") else admission_info

        with (
            patch.object(
                local_migrate.subprocess,
                "run",
                side_effect=(selected, inspected, admission_read),
            ),
            patch.object(local_migrate.Path, "lstat", autospec=True, side_effect=admitted_lstat),
            patch.object(local_migrate.os, "getuid", return_value=1000),
            patch.dict(local_migrate.os.environ, {
                "GITHUB_ACTIONS": "true",
                "CI": "true",
                "GITHUB_REPOSITORY": "twoimo/tzudong",
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "2",
                local_migrate.DOCKER_SOCKET_ADMISSION_ENV: str(admission_path),
            }, clear=False),
        ):
            local_migrate._assert_local_docker_context("docker")

        with (
            patch.object(local_migrate.subprocess, "run", side_effect=(selected, inspected)),
            patch.object(local_migrate.Path, "lstat", return_value=socket_info),
            patch.object(local_migrate.os, "getuid", return_value=1000),
            patch.dict(local_migrate.os.environ, {
                "GITHUB_ACTIONS": "true",
                "CI": "true",
                "GITHUB_REPOSITORY": "twoimo/tzudong",
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "2",
                local_migrate.DOCKER_SOCKET_ADMISSION_ENV: "",
            }, clear=False),
        ):
            with self.assertRaisesRegex(local_migrate.LocalMigrationError, "docker_context"):
                local_migrate._assert_local_docker_context("docker")

    def test_root_socket_admission_rejects_spoofed_file_contract(self) -> None:
        environment = {
            "GITHUB_ACTIONS": "true",
            "CI": "true",
            "GITHUB_REPOSITORY": "twoimo/tzudong",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "2",
            local_migrate.DOCKER_SOCKET_ADMISSION_ENV:
                "/run/tzudong-nightly-local-admission-123-2",
        }
        for info, payload in (
            (SimpleNamespace(st_mode=stat.S_IFLNK | 0o400, st_uid=0), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=1000), b"repo=twoimo/tzudong\nrun_id=123\nrun_attempt=2\n"),
            (SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0), b"repo=other/repo\nrun_id=123\nrun_attempt=2\n"),
        ):
            with self.subTest(mode=info.st_mode, owner=info.st_uid, payload=payload):
                with (
                    patch.dict(local_migrate.os.environ, environment, clear=True),
                    patch.object(local_migrate.Path, "lstat", return_value=info),
                    patch.object(
                        local_migrate.subprocess,
                        "run",
                        return_value=SimpleNamespace(returncode=0, stdout=payload),
                    ),
                ):
                    self.assertFalse(local_migrate._github_actions_root_socket_admission())

    def test_receipts_bind_runtime_closure_and_readback_sources(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for token in (
            "closure_binding_sha256",
            "def _closure_binding_for_current_source",
            "readback_sql_sha256",
            "receipt_closure_binding",
            "def _apply_sequence_marker",
        ):
            self.assertIn(token, source)
    def test_sequence_marker_failure_records_reset_required_marker(self) -> None:
        class FailingExecutor:
            def __init__(self, state: Path) -> None:
                self.state = state

            def _binding(self):
                return "tzudong-local-000000000000", self.state, {}

            def _expected_project(self) -> str:
                return "tzudong-local-000000000000"

            def run(self, sql: bytes, variables=None) -> None:
                raise local_migrate.LocalMigrationError("psql_ambiguous")

        with tempfile.TemporaryDirectory() as directory:
            executor = FailingExecutor(Path(directory))
            manifest = {"source": {"chainSha256": "a" * 64}}
            with self.assertRaisesRegex(local_migrate.LocalMigrationError, "psql_ambiguous"):
                local_migrate._apply_sequence_marker(executor, manifest)
            marker = Path(directory) / local_migrate.AMBIGUITY_MARKER
            self.assertTrue(marker.is_file())
            payload = json.loads(marker.read_text(encoding="utf-8"))
            self.assertEqual(payload["migration_id"], "migration-sequence")
            self.assertEqual(payload["error_code"], "psql_ambiguous")


if __name__ == "__main__":
    unittest.main()
