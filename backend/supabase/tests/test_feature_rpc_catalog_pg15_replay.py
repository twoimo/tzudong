"""Exact-source tests for the isolated PG15 feature-RPC catalog replay."""

from pathlib import Path
import re
import unittest

from backend.supabase.scripts import transform_feature_rpc_catalog_pg15_replay as replay


ROOT = Path(__file__).resolve().parents[3]


class FeatureRpcCatalogPg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / "backend/supabase/migrations" / replay.NAME).read_bytes()

    def test_only_executor_and_pg17_membership_windows_change(self) -> None:
        actual = replay.transform(self.source)
        membership = replay._bounded_block(
            self.source, replay.MEMBERSHIP_START, replay.MEMBERSHIP_END
        )
        restore = replay._bounded_block(
            self.source, replay.RESTORE_START, replay.RESTORE_END
        )
        restored = actual.replace(replay.PG15_VERSION_GUARD, replay.PG17_VERSION_GUARD, 1)
        restored = restored.replace(replay.PG15_MEMBERSHIP_WINDOW, membership, 1)
        restored = restored.replace(replay.PG15_RESTORE_ASSERTION, restore, 1)
        self.assertEqual(restored, self.source)
        self.assertEqual(
            actual[actual.index(b"SET LOCAL ROLE privacy_workflow_owner;") : actual.index(b"RESET ROLE;")],
            self.source[
                self.source.index(b"SET LOCAL ROLE privacy_workflow_owner;") : self.source.index(b"RESET ROLE;")
            ],
        )
        for marker in (
            b"CREATE FUNCTION public.",
            b"GRANT EXECUTE ON FUNCTION",
            b"REVOKE ALL ON FUNCTION",
            b"SELECT pg_temp.g014_feature_rpc_assert();",
            b"G014_FEATURE_RPC_MEMBERSHIP_DRIFT",
            b"public.read_receipt_ocr_result(",
            b"public.get_review_receipt_ocr_generation(",
            b"public.publish_review_receipt_ocr_result(",
            b"public.get_feature_runtime_capability(",
        ):
            self.assertEqual(actual.count(marker), self.source.count(marker))

    def test_pg15_window_is_fail_closed_and_restores_temporary_membership(self) -> None:
        actual = replay.transform(self.source)
        self.assertIn(replay.PG15_VERSION_GUARD, actual)
        self.assertNotIn(replay.PG17_VERSION_GUARD, actual)
        for marker in (
            b"current_user <> 'postgres'",
            b"session_user <> 'postgres'",
            b"transaction_read_only') <> 'off'",
            b"G014_FEATURE_RPC_PG15_REPLAY_DENIED",
            b"G014_FEATURE_RPC_PG15_SELF_MEMBERSHIP_DENIED",
            b"G014_FEATURE_RPC_PG15_MEMBERSHIP_DRIFT",
        ):
            self.assertIn(marker, actual)
        self.assertNotIn(b"WITH ADMIN FALSE, INHERIT FALSE, SET TRUE", actual)
        self.assertNotIn(b"GRANTED BY postgres", actual)
        self.assertEqual(actual.count(b"GRANT privacy_workflow_owner TO postgres;"), 1)
        self.assertEqual(actual.count(b"REVOKE privacy_workflow_owner FROM postgres;"), 1)
        self.assertLess(
            actual.index(b"GRANT privacy_workflow_owner TO postgres;"),
            actual.index(b"SET LOCAL ROLE privacy_workflow_owner;"),
        )
        self.assertGreater(
            actual.index(b"REVOKE privacy_workflow_owner FROM postgres;"),
            actual.index(b"RESET ROLE;"),
        )

    def test_wrong_source_or_filename_is_rejected(self) -> None:
        cases = (
            (self.source + b"\n", replay.NAME),
            (self.source, "20261013190101_g014_feature_rpc_catalog_contract.sql"),
            (self.source.replace(b"lock_timeout", b"lock_timeout_changed"), replay.NAME),
        )
        for source, name in cases:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "SOURCE_DRIFT"):
                replay.transform(source, name)

    def test_generator_has_one_hash_bound_pg15_branch(self) -> None:
        driver = (
            ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"
        ).read_text(encoding="utf-8")
        branches = re.findall(r"^\s+([^\n]+\.sql)\)\s*$", driver, re.MULTILINE)
        self.assertEqual(sum(replay.NAME in value.split("|") for value in branches), 1)
        branch = driver.split(replay.NAME + ")", 1)[1].split(";;", 1)[0]
        self.assertIn("transform_feature_rpc_catalog_pg15_replay.py", branch)
        self.assertIn("feature-rpc-catalog-pg15-replay-transformer", branch)
        self.assertIn("feature-rpc-catalog-pg15-replay:", branch)
        self.assertIn("ON_ERROR_STOP=1", branch)


if __name__ == "__main__":
    unittest.main()
