"""Exact-source tests for the PG15 OCR release source-only replay fixture."""

import hashlib
from pathlib import Path
import re
import unittest

from backend.supabase.scripts import (
    transform_receipt_ocr_credential_release_pg15_replay as replay,
)


ROOT = Path(__file__).resolve().parents[3]


class ReceiptOcrCredentialReleasePg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / "backend/supabase/migrations" / replay.NAME).read_bytes()

    def test_raw_migration_is_embedded_once_and_restored_byte_for_byte(self) -> None:
        actual = replay.transform(self.source)

        self.assertEqual(hashlib.sha256(self.source).hexdigest(), replay.SHA256)
        self.assertEqual(len(self.source), replay.BYTE_LENGTH)
        self.assertEqual(actual.count(self.source), 1)
        self.assertEqual(
            actual[len(replay.PREFIX) : -len(replay.SUFFIX)],
            self.source,
        )
        self.assertEqual(replay.unwrap(actual), self.source)

    def test_wrong_source_filename_or_wrapper_is_rejected(self) -> None:
        cases = (
            (self.source + b"\n", replay.NAME),
            (self.source, replay.NAME.replace("152032", "152033")),
            (
                self.source.replace(
                    b"SET LOCAL lock_timeout", b"SET LOCAL lock_timeout_changed", 1
                ),
                replay.NAME,
            ),
        )
        for source, name in cases:
            with self.subTest(name=name), self.assertRaisesRegex(
                ValueError, "SOURCE_DRIFT"
            ):
                replay.transform(source, name)

        for transformed in (
            replay.transform(self.source)[1:],
            replay.transform(self.source)[:-1],
        ):
            with self.assertRaisesRegex(ValueError, "WRAPPER_DRIFT"):
                replay.unwrap(transformed)

    def test_fixture_admission_is_pg15_only_empty_exact_and_fail_closed(self) -> None:
        actual = replay.transform(self.source)
        prefix = replay.PREFIX

        for marker in (
            b"server_version_num')::integer / 10000 <> 15",
            b"current_user <> 'postgres'",
            b"session_user <> 'postgres'",
            b"transaction_read_only') <> 'off'",
            b"to_regnamespace('supabase_migrations') IS NOT NULL",
            b"to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
            b"RECEIPT_OCR_SOURCE_REPLAY_LEDGER_FIXTURE_DENIED",
            b"CREATE SCHEMA supabase_migrations AUTHORIZATION postgres;",
            b"version text PRIMARY KEY,\n  name text,\n  statements text[]",
            b"RECEIPT_OCR_SOURCE_REPLAY_LEDGER_FIXTURE_DRIFT",
        ):
            self.assertIn(marker, prefix)

        self.assertNotIn(b"IF NOT EXISTS", prefix)
        self.assertEqual(
            prefix.count(
                b"(SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) <> 0"
            ),
            1,
        )
        self.assertEqual(
            actual.count(b"CREATE TABLE supabase_migrations.schema_migrations"), 1
        )

    def test_terminal_is_held_while_fixture_exists_then_cleanup_is_bounded(self) -> None:
        suffix = replay.SUFFIX
        drop_table = b"DROP TABLE supabase_migrations.schema_migrations RESTRICT;"
        drop_schema = b"DROP SCHEMA supabase_migrations RESTRICT;"
        cleanup = suffix[suffix.index(drop_table) :]

        for marker in (
            b"fixture.schema_oid <> 'supabase_migrations'::pg_catalog.regnamespace",
            b"fixture.relation_oid <> 'supabase_migrations.schema_migrations'::pg_catalog.regclass",
            b"contract_row.migration_version IS NULL",
            b"contract_row.statement_vector_sha256 IS NULL",
            b"contract_row.ledger_identity_root IS NULL",
            b"jsonb_object_keys(contract_row.function_contract)) = 4",
            b"jsonb_object_keys(contract_row.table_contract)) = 2",
            b"RECEIPT_OCR_SOURCE_REPLAY_TERMINAL_DRIFT",
            b"RECEIPT_OCR_SOURCE_REPLAY_FIXTURE_CLEANUP_DRIFT",
        ):
            self.assertIn(marker, suffix)

        getter_call = (
            b"public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM"
        )
        self.assertEqual(suffix.count(getter_call), 1)
        self.assertLess(suffix.index(getter_call), suffix.index(drop_table))
        self.assertIn(b'"status":"held"', suffix[: suffix.index(drop_table)])
        self.assertNotIn(getter_call, cleanup)

        self.assertIn(drop_table, suffix)
        self.assertIn(drop_schema, suffix)
        self.assertNotIn(b"CASCADE", suffix)
        self.assertIn(
            b"to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
            cleanup,
        )
        self.assertIn(
            b"to_regnamespace('supabase_migrations') IS NOT NULL", cleanup
        )
        self.assertIn(b"fixture.catalog_digest IS DISTINCT FROM catalog_digest_after", cleanup)
        self.assertTrue(
            suffix.rstrip().endswith(
                b"DROP TABLE pg_temp.receipt_ocr_source_replay_fixture_guard;"
            )
        )

    def test_generator_and_workflow_have_one_bounded_adapter_path(self) -> None:
        driver = (
            ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"
        ).read_text(encoding="utf-8")
        workflow = (
            ROOT / ".github/workflows/g014-catalog-contract-baseline.yml"
        ).read_text(encoding="utf-8")

        branches = re.findall(r"^\s+([^\n]+\.sql)\)\s*$", driver, re.MULTILINE)
        self.assertEqual(sum(replay.NAME in value.split("|") for value in branches), 1)
        branch = driver.split(replay.NAME + ")", 1)[1].split(";;", 1)[0]
        for marker in (
            "Catalog replay only: the empty ledger fixture is not operating readiness evidence.",
            "transform_receipt_ocr_credential_release_pg15_replay.py",
            "receipt-ocr-credential-release-pg15-replay-transformer",
            "receipt-ocr-credential-release-pg15-replay:",
            "ON_ERROR_STOP=1",
        ):
            self.assertIn(marker, branch)

        adapter_path = (
            "backend/supabase/scripts/"
            "transform_receipt_ocr_credential_release_pg15_replay.py"
        )
        test_path = (
            "backend/supabase/tests/"
            "test_receipt_ocr_credential_release_pg15_replay.py"
        )
        unit_name = (
            "backend.supabase.tests."
            "test_receipt_ocr_credential_release_pg15_replay"
        )
        self.assertEqual(driver.count("'" + adapter_path + "'"), 1)
        self.assertEqual(workflow.count("'" + adapter_path + "'"), 1)
        self.assertEqual(workflow.count("'" + test_path + "'"), 1)
        self.assertEqual(workflow.count(unit_name), 1)


if __name__ == "__main__":
    unittest.main()
