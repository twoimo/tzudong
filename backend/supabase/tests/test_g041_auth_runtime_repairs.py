import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PRIVILEGES = ROOT / "backend/supabase/migrations/20260804000200_g041_privacy_onboarding_workflow_privileges.sql"
RUNTIME_REPAIRS = ROOT / "backend/supabase/migrations/20260804000300_g041_auth_boundary_runtime_repairs.sql"


class PrivacyOnboardingWorkflowPrivilegeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = WORKFLOW_PRIVILEGES.read_text(encoding="utf-8")

    def test_restores_only_rpc_owner_mutations(self) -> None:
        for relation, privileges in (
            ("privacy_onboarding_challenges", "INSERT, UPDATE"),
            ("privacy_age_profiles", "INSERT, UPDATE"),
            ("privacy_consent_events", "INSERT"),
        ):
            self.assertRegex(
                self.sql,
                re.compile(
                    rf"GRANT {privileges} ON TABLE privacy_retention\.{relation}\s+TO privacy_workflow_owner;",
                    re.IGNORECASE,
                ),
            )
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", self.sql)
        self.assertIn("g041_privacy_onboarding_api_role_privilege_detected", self.sql)

    def test_records_and_reads_back_all_grant_manifest_rows(self) -> None:
        self.assertIn("FROM privacy_retention.g014_catalog_manifest_rows()", self.sql)
        self.assertIn("ON CONFLICT (manifest_kind, manifest_key) DO NOTHING", self.sql)
        self.assertIn("g041_privacy_onboarding_grant_manifest_missing", self.sql)
        self.assertEqual(self.sql.count("'privilege', 'INSERT'"), 3)
        self.assertEqual(self.sql.count("'privilege', 'UPDATE'"), 2)

    def test_restores_hosted_membership_set_option(self) -> None:
        self.assertIn("WITH SET TRUE", self.sql)
        self.assertIn("WITH SET FALSE", self.sql)
        self.assertIn("g041_onboarding.remove_membership", self.sql)
        self.assertIn("g041_onboarding.restore_set_false", self.sql)


class AuthBoundaryRuntimeRepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = RUNTIME_REPAIRS.read_text(encoding="utf-8")

    def test_eligibility_functions_use_verified_claims_without_auth_schema_reads(self) -> None:
        self.assertIn("CREATE OR REPLACE FUNCTION public.get_current_privacy_eligibility()", self.sql)
        self.assertIn("CREATE OR REPLACE FUNCTION public.get_privacy_eligibility_for_user(p_user_id uuid)", self.sql)
        self.assertIn("pg_catalog.current_setting('request.jwt.claims', true)", self.sql)
        self.assertIn("v_claims ->> 'sub'", self.sql)
        self.assertNotRegex(self.sql, re.compile(r"\bauth\.(?:uid|jwt)\b", re.IGNORECASE))
        self.assertNotRegex(self.sql, re.compile(r"\b(?:SELECT|FROM)\s+auth\.", re.IGNORECASE))
        self.assertIn("g041_runtime_auth_schema_privilege_detected", self.sql)

    def test_reattest_audit_summary_stays_within_the_safe_shape(self) -> None:
        expected = "pg_catalog.jsonb_build_object('consentEvents', v_event_count, 'eligible', true)"
        self.assertIn(expected, self.sql)
        self.assertNotIn("'reattest', true", self.sql)
        self.assertIn("privacy_retention.append_privacy_audit_event_internal", self.sql)

    def test_session_guard_uses_signed_claims_and_private_lease_state(self) -> None:
        self.assertIn("CREATE OR REPLACE FUNCTION public.get_current_auth_session_id()", self.sql)
        self.assertIn("CREATE OR REPLACE FUNCTION public.is_current_auth_session_active()", self.sql)
        self.assertIn("v_claims ->> 'session_id'", self.sql)
        self.assertIn("public.release_auth_identities", self.sql)
        self.assertIn("public.release_auth_session_leases", self.sql)
        self.assertIn("GRANT SELECT, UPDATE ON TABLE public.release_auth_session_leases TO privacy_workflow_owner", self.sql)
        self.assertNotRegex(self.sql, re.compile(r"DELETE\s+FROM\s+auth\.", re.IGNORECASE))

    def test_admin_guard_reads_are_select_only_and_rls_bound(self) -> None:
        self.assertIn("GRANT SELECT ON TABLE public.user_roles, public.user_account_status TO authenticated", self.sql)
        self.assertIn('DROP POLICY IF EXISTS "Users and admins can view roles"', self.sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", self.sql)
        self.assertIn("REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", self.sql)
        self.assertIn("user_roles_select_own", self.sql)
        self.assertIn("user_account_status_select_own", self.sql)
        self.assertIn("g041_runtime_admin_mutation_privilege_detected", self.sql)

    def test_all_replaced_functions_remain_hardened_security_definers(self) -> None:
        self.assertEqual(self.sql.count("SECURITY DEFINER"), 5)
        self.assertEqual(self.sql.count("SET search_path = ''"), 5)
        self.assertIn("g041_runtime_function_boundary_invalid", self.sql)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", self.sql)

    def test_restores_hosted_membership_set_option(self) -> None:
        self.assertIn("WITH SET TRUE", self.sql)
        self.assertIn("WITH SET FALSE", self.sql)
        self.assertIn("g041_runtime.remove_membership", self.sql)
        self.assertIn("g041_runtime.restore_set_false", self.sql)


if __name__ == "__main__":
    unittest.main()
