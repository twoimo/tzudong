import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260817000100_restaurant_identity_helper_writer_grants.sql"
)
WRAPPER = ROOT / "backend/utils/tests/fixtures/run_local_heavy.sh.legacy"


class RestaurantIdentityHelperWriterGrantTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sql = MIGRATION.read_text(encoding="utf-8")
        self.wrapper = WRAPPER.read_text(encoding="utf-8")

    def test_migration_exists_and_is_writer_only(self) -> None:
        self.assertTrue(MIGRATION.is_file())
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO postgres, service_role;",
            self.sql,
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.resolve_restaurant_identity_name(text, text, text, text) TO postgres, service_role;",
            self.sql,
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.normalize_restaurant_identity_name(text) TO postgres, service_role;",
            self.sql,
        )
        self.assertIn(
            "REVOKE ALL ON FUNCTION public.extract_youtube_video_id(text) FROM PUBLIC, anon, authenticated;",
            self.sql,
        )
        self.assertNotIn("g014_public_rpc_allowlist", self.sql)
        self.assertNotIn("TO anon", self.sql.split("GRANT EXECUTE", 1)[-1])
        self.assertNotIn("TO authenticated", self.sql.split("GRANT EXECUTE", 1)[-1])

    def test_local_heavy_defaults_to_split_sync(self) -> None:
        self.assertIn(
            'export RUN_DAILY_EXECUTION_BRANCH="${RUN_DAILY_EXECUTION_BRANCH:-develop}"',
            self.wrapper,
        )
        self.assertIn("export RUN_DAILY_TARGET_BRANCH=data", self.wrapper)


if __name__ == "__main__":
    unittest.main()
