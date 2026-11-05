"""Exact-source tests for the isolated PG15 readiness-successor replay."""

from pathlib import Path
import re
import unittest

from backend.supabase.scripts import transform_review_verification_readiness_pg15_replay as replay


ROOT = Path(__file__).resolve().parents[3]


class ReviewVerificationReadinessPg15ReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (ROOT / "backend/supabase/migrations" / replay.NAME).read_bytes()

    def test_only_executor_version_guard_changes(self) -> None:
        actual = replay.transform(self.source)
        self.assertEqual(
            actual,
            self.source.replace(replay.PG17_VERSION_GUARD, replay.PG15_VERSION_GUARD, 1),
        )
        self.assertEqual(
            actual.replace(replay.PG15_VERSION_GUARD, replay.PG17_VERSION_GUARD, 1),
            self.source,
        )
        for marker in (
            b"CREATE OR REPLACE FUNCTION ocr_private.get_feature_runtime_capability",
            b"a01_review_verification_immutable_update",
            b"a01_review_verification_guard_delete",
            b"aa1d4951b8d5fdd15249b090c6d6efba897f39eaceee86bf09221eb1d942d545",
            b"24311fc7071597fbc78c4c54897690da5aaa70edb62c24f7912fd23fecf515b0",
            b"FEATURE_RUNTIME_STORAGE_FENCE_READBACK_DRIFT",
        ):
            self.assertEqual(actual.count(marker), self.source.count(marker))

    def test_wrong_source_or_filename_is_rejected(self) -> None:
        cases = (
            (self.source + b"\n", replay.NAME),
            (self.source, replay.NAME.replace("16090000", "16090001")),
            (self.source.replace(b"lock_timeout", b"lock_timeout_changed"), replay.NAME),
        )
        for source, name in cases:
            with self.assertRaisesRegex(ValueError, "SOURCE_DRIFT"):
                replay.transform(source, name)

    def test_pg15_replay_guard_remains_bounded_and_fail_closed(self) -> None:
        actual = replay.transform(self.source)
        self.assertIn(replay.PG15_VERSION_GUARD, actual)
        self.assertNotIn(replay.PG17_VERSION_GUARD, actual)
        for marker in (
            b"current_user <> 'postgres'",
            b"session_user <> 'postgres'",
            b"transaction_read_only') <> 'off'",
            b"FEATURE_RUNTIME_STORAGE_FENCE_PREREQUISITE_MISSING",
        ):
            self.assertIn(marker, actual)

    def test_generator_has_one_hash_bound_replay_branch(self) -> None:
        driver = (
            ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"
        ).read_text()
        branches = re.findall(r"^\s+([^\n]+\.sql)\)\s*$", driver, re.M)
        self.assertEqual(sum(replay.NAME in value.split("|") for value in branches), 1)
        branch = driver.split(replay.NAME + ")", 1)[1].split(";;", 1)[0]
        self.assertIn("transform_review_verification_readiness_pg15_replay.py", branch)
        self.assertIn("review-verification-readiness-pg15-replay-transformer", branch)
        self.assertIn("review-verification-readiness-pg15-replay:", branch)
        self.assertIn("ON_ERROR_STOP=1", branch)


if __name__ == "__main__":
    unittest.main()
