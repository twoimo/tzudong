from pathlib import Path
import unittest


ROOT = Path(__file__).parents[3]
GENERATOR = ROOT / "backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh"


class G014CatalogBaselineGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = GENERATOR.read_text(encoding="utf8")

    def test_g016_catalog_assertion_replay_is_transactional_and_self_reverting(self):
        self.assertIn("g016_apply_catalog_assertion_membership_window()", self.source)
        self.assertIn("'BEGIN;'", self.source)
        self.assertIn("'GRANT privacy_workflow_owner TO postgres;'", self.source)
        self.assertIn("'REVOKE privacy_workflow_owner FROM postgres;'", self.source)
        self.assertIn("'COMMIT;'", self.source)

    def test_g016_catalog_assertion_uses_only_the_scoped_replay_wrapper(self):
        case = self.source.split(
            "20260801000300_g016_onboarding_allowlist_freshness.sql)", 1
        )[1].split(";;", 1)[0]
        self.assertIn("g016_apply_catalog_assertion_membership_window", case)
        self.assertIn("g016-catalog-assertion-membership-window", case)
        self.assertNotIn('psql -X', case.split("transformed_migration=", 1)[0])


if __name__ == "__main__":
    unittest.main()
