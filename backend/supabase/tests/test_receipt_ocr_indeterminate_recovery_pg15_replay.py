"""Exact-source tests for the held 108 PG15 source-only replay adapter."""

from pathlib import Path
import re
import unittest

from backend.supabase.scripts import transform_receipt_ocr_indeterminate_recovery_pg15_replay as replay


ROOT = Path(__file__).resolve().parents[3]


class ReceiptOcrIndeterminateRecoveryPg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / "backend/supabase/migrations" / replay.NAME).read_bytes()

    def test_only_operating_admission_changes_and_raw_bytes_restore(self) -> None:
        transformed = replay.transform(self.source)
        original_admission = replay._operating_admission(self.source)

        self.assertEqual(transformed.count(replay.SOURCE_ONLY_ADMISSION), 1)
        self.assertNotIn(original_admission, transformed)
        self.assertEqual(replay.restore(transformed, self.source), self.source)
        self.assertEqual(
            transformed.replace(replay.SOURCE_ONLY_ADMISSION, original_admission, 1),
            self.source,
        )
        boundary_end = transformed.index(replay.END) + len(replay.END)
        lease_start = transformed.index(
            b"CREATE TEMPORARY TABLE pg_temp.receipt_ocr_recovery108_owner_lease"
        )
        self.assertGreater(lease_start, boundary_end)
        for marker in (
            b"WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres",
            b"SET LOCAL ROLE privacy_workflow_owner",
            b"INSERT INTO privacy_retention.g014_nested_helper_allowlist",
            b"PERFORM privacy_retention.assert_g014_public_rpc_allowlist()",
            b"PERFORM privacy_retention.assert_g014_definer_contract()",
            b"RESET ROLE",
            b"after_members IS DISTINCT FROM lease.before_members",
            b"RECEIPT_OCR_RECOVERY108_OWNER_LEASE_RESTORE_FAILED",
        ):
            self.assertIn(marker, transformed)

    def test_source_only_admission_is_pg15_empty_ledger_exact_107_and_fresh_108(self) -> None:
        admission = replay.SOURCE_ONLY_ADMISSION
        for marker in (
            b"server_version_num')::integer / 10000 <> 15",
            b"current_user <> 'postgres'",
            b"session_user <> 'postgres'",
            b"transaction_read_only') <> 'off'",
            b"to_regnamespace('supabase_migrations') IS NOT NULL",
            b"to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
            b"receipt_credential_rejection_releases') IS NULL",
            b"receipt_credential_release_catalog_contract') IS NULL",
            b"receipt-ocr-definitive-credential-release-v2",
            b'"status":"held"',
            b"receipt_ocr_indeterminate_recoveries') IS NOT NULL",
            b"receipt_ocr_recovery_execution_leases') IS NOT NULL",
            b"receipt_ocr_recovery_catalog_contract') IS NOT NULL",
            b"receipt_ocr_recovery_catalog_snapshot_v1()') IS NOT NULL",
            b"get_receipt_ocr_indeterminate_recovery_capability()') IS NOT NULL",
            b"RECEIPT_OCR_RECOVERY108_SOURCE_REPLAY_ADMISSION_FAILED",
        ):
            self.assertIn(marker, admission)
        self.assertNotIn(b"CREATE SCHEMA supabase_migrations", admission)
        self.assertNotIn(b"INSERT INTO supabase_migrations", admission)
        self.assertNotIn(b"IF NOT EXISTS", admission)

    def test_wrong_source_filename_and_wrapper_fail_closed(self) -> None:
        for source, name in (
            (self.source + b"\n", replay.NAME),
            (self.source, replay.NAME.replace("130000", "130001")),
            (
                self.source.replace(
                    b"SET LOCAL lock_timeout", b"SET LOCAL lock_timeout_changed", 1
                ),
                replay.NAME,
            ),
        ):
            with self.subTest(name=name), self.assertRaisesRegex(
                ValueError, "SOURCE_DRIFT"
            ):
                replay.transform(source, name)
        with self.assertRaisesRegex(ValueError, "WRAPPER_DRIFT"):
            replay.restore(replay.transform(self.source)[:-1], self.source)

    def test_generator_and_workflow_have_one_exact_branch(self) -> None:
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
            "transform_receipt_ocr_indeterminate_recovery_pg15_replay.py",
            "receipt-ocr-recovery108-pg15-replay-transformer",
            "receipt-ocr-recovery108-pg15-replay:",
            "ON_ERROR_STOP=1",
        ):
            self.assertIn(marker, branch)
        self.assertEqual(
            driver.count(
                "'backend/supabase/scripts/transform_receipt_ocr_indeterminate_recovery_pg15_replay.py'"
            ),
            1,
        )
        self.assertEqual(
            workflow.count(
                "backend/supabase/scripts/transform_receipt_ocr_indeterminate_recovery_pg15_replay.py"
            ),
            1,
        )
        self.assertEqual(
            workflow.count(
                "backend/supabase/tests/test_receipt_ocr_indeterminate_recovery_pg15_replay.py"
            ),
            1,
        )
        self.assertEqual(
            workflow.count(
                "backend.supabase.tests.test_receipt_ocr_indeterminate_recovery_pg15_replay"
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
