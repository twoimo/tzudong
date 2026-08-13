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
        self.assertIn('"BEGIN;\\n"', self.source)
        self.assertIn('"GRANT privacy_workflow_owner TO postgres;\\n"', self.source)
        self.assertIn("REVOKE privacy_workflow_owner FROM postgres;", self.source)
        self.assertIn("CREATE OR REPLACE FUNCTION pg_temp.g016_catalog_assertion_bridge()", self.source)
        self.assertIn("SECURITY DEFINER", self.source)
        self.assertIn("SELECT pg_temp.g016_catalog_assertion_bridge();", self.source)
        self.assertIn('+"\\nCOMMIT;\\n"', self.source.replace(" ", ""))

    def test_g016_catalog_assertion_uses_only_the_scoped_replay_wrapper(self):
        case = self.source.split(
            "20260801000300_g016_onboarding_allowlist_freshness.sql)", 1
        )[1].split(";;", 1)[0]
        self.assertIn("g016_apply_catalog_assertion_membership_window", case)
        self.assertIn("g016-catalog-assertion-membership-window", case)
        self.assertNotIn('psql -X', case.split("transformed_migration=", 1)[0])

    def test_hosted_only_recovery_migrations_are_exactly_bound_and_excluded(self):
        self.assertIn("declare -A hosted_only_backend_migrations=(", self.source)
        self.assertIn("declare -A observed_hosted_only_backend_migrations=()", self.source)
        for name in (
            "20260814010000_hosted_g016_g041_catalog_reconciliation.sql",
            "20260814010100_hosted_runtime_boundary_convergence.sql",
            "20260814010200_hosted_public_profile_read_convergence.sql",
            "20260814010300_hosted_current_profile_mutation.sql",
        ):
            self.assertIn(name, self.source)
        self.assertIn("unrecognized hosted-only backend migration", self.source)
        self.assertIn("hosted-only backend migration source drift", self.source)
        self.assertIn("missing hosted-only backend migration", self.source)
        self.assertIn("symlinked %s migration source", self.source)
        self.assertLess(
            self.source.index("-type l -name '*.sql'"),
            self.source.index("-type f -name '*.sql'"),
        )
        self.assertLess(
            self.source.index("continue\n    fi", self.source.index("hosted_only_backend_migrations")),
            self.source.index("backend_migrations_by_name[$name]=$migration"),
        )


if __name__ == "__main__":
    unittest.main()
