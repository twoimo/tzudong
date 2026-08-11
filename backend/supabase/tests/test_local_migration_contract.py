import hashlib
import importlib.util
import json
import re
import sys
import tempfile
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
