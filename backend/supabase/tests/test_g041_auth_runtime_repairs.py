import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_PRIVILEGES = ROOT / "backend/supabase/migrations/20260804000200_g041_privacy_onboarding_workflow_privileges.sql"
RUNTIME_REPAIRS = ROOT / "backend/supabase/migrations/20260804000300_g041_auth_boundary_runtime_repairs.sql"
CLOSURE = ROOT / "backend/supabase/migrations/20260804000400_g041_auth_boundary_closure.sql"
BRIDGE = ROOT / "backend/supabase/migrations/20260804000500_g041_auth_workflow_bridge.sql"
RUNTIME_MATRIX = ROOT / "backend/supabase/tests/g041_auth_boundary_runtime.sql"


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
        self.assertIn("g041_runtime_auth_direct_privilege_detected", self.sql)

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


class AuthWorkflowBridgeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = BRIDGE.read_text(encoding="utf-8")
        cls.runtime_sql = RUNTIME_MATRIX.read_text(encoding="utf-8")

    def test_exact_workflow_signatures_and_private_bridge_are_fail_closed(self) -> None:
        self.assertIn("privacy_auth_bridge NOLOGIN", self.sql)
        self.assertIn("NOBYPASSRLS", self.sql)
        self.assertIn("g041_auth_workflow_bridge_expected_signature_drift", self.sql)
        self.assertIn("g041_auth_workflow_bridge_replacement_coverage_invalid", self.sql)
        self.assertEqual(self.sql.count("OWNER TO privacy_auth_bridge;"), 21)
        self.assertEqual(self.sql.count("ALTER FUNCTION "), 22)
        self.assertEqual(self.sql.count("::regprocedure"), 21)
        for signature in (
            "begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)",
            "hold_privacy_onboarding_compensation(uuid,uuid,text,text)",
            "preview_account_deletion(uuid,uuid,timestamptz)",
            "run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)",
        ):
            self.assertIn(signature, self.sql)

    def test_managed_auth_access_uses_narrow_barrier_views(self) -> None:
        for view in (
            "g041_auth_users",
            "g041_auth_sessions",
            "g041_auth_identities",
            "g041_auth_refresh_tokens",
        ):
            self.assertIn(f"privacy_retention.{view}", self.sql)
        self.assertEqual(self.sql.count("WITH (security_barrier = true) AS"), 4)
        self.assertIn("DO $auth_view_replacements$", self.sql)
        self.assertIn("g041_auth_workflow_view_replacement_incomplete", self.sql)
        self.assertIn("relation.reloptions @> ARRAY['security_barrier=true']", self.sql)
        for forbidden in (
            "GRANT USAGE ON SCHEMA auth TO privacy_auth_bridge",
            "ON TABLE auth.users TO privacy_auth_bridge",
            "ON TABLE auth.sessions TO privacy_auth_bridge",
            "ON TABLE auth.identities TO privacy_auth_bridge",
            "ON TABLE auth.refresh_tokens TO privacy_auth_bridge",
        ):
            self.assertNotIn(forbidden, self.sql)

    def test_claim_replacements_and_runtime_matrix_are_fail_closed(self) -> None:
        self.assertIn("g041_current_claim_user_id", self.sql)
        self.assertIn("g041_auth_workflow_claim_signature_drift", self.sql)
        self.assertIn("FOREACH v_signature IN ARRAY v_expected_signatures", self.sql)
        self.assertIn("'auth.uid()'", self.sql)
        self.assertIn("'privacy_retention.g041_current_claim_user_id()'", self.sql)
        for assertion in (
            "missing claims did not fail closed",
            "malformed claims did not fail closed",
            "authenticated own-row RLS isolation failed",
            "user_roles mutation unexpectedly succeeded",
            "user_account_status mutation unexpectedly succeeded",
            "account-deletion status auth permission denied",
            "bridge user view cannot read exact identity",
        ):
            self.assertIn(assertion, self.runtime_sql)
class AuthBoundaryClosureContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = CLOSURE.read_text(encoding="utf-8")
        cls.runtime_sql = RUNTIME_MATRIX.read_text(encoding="utf-8")

    def test_replay_and_live_closure_revoke_each_predecessor_auth_grant(self) -> None:
        expected_revokes = (
            "REVOKE ALL PRIVILEGES ON SCHEMA auth FROM privacy_workflow_owner;",
            "REVOKE ALL PRIVILEGES ON TABLE auth.users, auth.sessions, auth.identities, auth.refresh_tokens",
            "REVOKE SELECT (id, last_sign_in_at) ON TABLE auth.users FROM privacy_workflow_owner;",
        )
        for revoke in expected_revokes:
            self.assertIn(revoke, RUNTIME_REPAIRS.read_text(encoding="utf-8"))
            self.assertIn(revoke, self.sql)
        self.assertIn("pg_catalog.aclexplode", self.sql)
        self.assertIn("g041_auth_direct_acl_remains", self.sql)

    def test_owner_only_rls_and_narrow_lease_lock_grant_are_exact(self) -> None:
        for relation, policy in (
            ("release_auth_identities", "g041_release_auth_identities_owner_select"),
            ("release_auth_session_leases", "g041_release_auth_session_leases_owner_select"),
        ):
            self.assertRegex(
                self.sql,
                re.compile(
                    rf"CREATE POLICY {policy}\s+ON public\.{relation}\s+FOR SELECT\s+TO privacy_workflow_owner\s+USING \(true\);",
                    re.IGNORECASE,
                ),
            )
        self.assertRegex(
            self.sql,
            re.compile(
                r"CREATE POLICY g041_release_auth_session_leases_owner_update\s+"
                r"ON public\.release_auth_session_leases\s+FOR UPDATE\s+"
                r"TO privacy_workflow_owner\s+USING \(true\)\s+WITH CHECK \(true\);",
                re.IGNORECASE,
            ),
        )
        self.assertIn("GRANT SELECT ON TABLE public.release_auth_identities TO privacy_workflow_owner;", self.sql)
        self.assertIn(
            "GRANT SELECT, UPDATE (created_at) ON TABLE public.release_auth_session_leases",
            self.sql,
        )
        self.assertIn("g041_release_auth_guard_rls_invalid", self.sql)
        self.assertIn("refresh_sha256', 'UPDATE'", self.sql)
        self.assertIn("expires_at', 'UPDATE'", self.sql)

    def test_runtime_matrix_exercises_roles_and_fail_closed_lease_cases(self) -> None:
        self.assertTrue(RUNTIME_MATRIX.is_file())
        self.assertIn("BEGIN;", self.runtime_sql)
        self.assertIn("ROLLBACK;", self.runtime_sql)
        self.assertIn("SET LOCAL ROLE authenticated;", self.runtime_sql)
        self.assertIn("SET LOCAL ROLE privacy_workflow_owner;", self.runtime_sql)
        for assertion in (
            "ordinary identity did not pass",
            "dedicated identity without lease did not fail closed",
            "exact live lease did not pass",
            "wrong session did not fail closed",
            "wrong-user lease did not fail closed",
            "expired lease did not fail closed",
            "owner RLS cannot see dedicated identity",
            "owner RLS cannot lock exact lease",
            "sensitive lease update unexpectedly succeeded",
            "auth ACL contract failed",
        ):
            self.assertIn(assertion, self.runtime_sql)


if __name__ == "__main__":
    unittest.main()
