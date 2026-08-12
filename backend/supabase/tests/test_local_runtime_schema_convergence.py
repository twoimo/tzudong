import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260812000100_local_runtime_schema_convergence.sql"
)
PUBLIC_READ_MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260812000200_local_public_read_policy_convergence.sql"
)
ADMIN_DATA_MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql"
)
ADMIN_MAP_OVERLAY_MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260812000400_local_admin_map_overlay_boundary_convergence.sql"
)
YOUTUBE_RPC_ALLOWLIST_MIGRATION = (
    ROOT
    / "backend/supabase/migrations/20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql"
)
SEED = ROOT / "backend/supabase/scripts/local-seed.sql"
READBACK = ROOT / "backend/supabase/scripts/local_catalog_readback.sql"
SUPABASE_README = ROOT / "backend/supabase/README.md"
BEHAVIOR_SQL = ROOT / "backend/supabase/tests/local_runtime_schema_convergence.sql"


class LocalRuntimeSchemaConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.public_read_migration = PUBLIC_READ_MIGRATION.read_text(encoding="utf-8")
        cls.admin_data_migration = ADMIN_DATA_MIGRATION.read_text(encoding="utf-8")
        cls.admin_map_overlay_migration = ADMIN_MAP_OVERLAY_MIGRATION.read_text(
            encoding="utf-8"
        )
        cls.youtube_rpc_allowlist_migration = (
            YOUTUBE_RPC_ALLOWLIST_MIGRATION.read_text(encoding="utf-8")
        )
        cls.seed = SEED.read_text(encoding="utf-8")
        cls.readback = READBACK.read_text(encoding="utf-8")
        cls.supabase_readme = SUPABASE_README.read_text(encoding="utf-8")
        cls.behavior_sql = BEHAVIOR_SQL.read_text(encoding="utf-8")

    def test_new_backend_migration_owns_web_runtime_objects(self) -> None:
        self.assertTrue(MIGRATION.is_file())
        for relation in (
            "youtube_channel_kpi_snapshots",
            "youtube_video_kpi_snapshots",
            "youtube_thumbnail_releases",
        ):
            self.assertIn(f"public.{relation}", self.migration)
            self.assertRegex(
                self.migration,
                rf"ALTER TABLE public\.{relation} ENABLE ROW LEVEL SECURITY",
            )
            self.assertIn(
                f"REVOKE ALL ON TABLE public.{relation} FROM PUBLIC, anon, authenticated",
                self.migration,
            )
        self.assertIn("SET search_path = ''", self.migration)
        self.assertIn("pg_catalog.pg_advisory_xact_lock", self.migration)
        self.assertIn("publish_youtube_thumbnail_release", self.migration)

    def test_storage_contract_matches_runtime_bucket_names_and_boundaries(self) -> None:
        for bucket in (
            "profile-avatars",
            "review-photos",
            "ad-banner-images",
            "youtube-thumbnail-releases",
        ):
            self.assertIn(f"'{bucket}'", self.migration)

        self.assertRegex(
            self.migration,
            r"\('youtube-thumbnail-releases'.*?false, 10485760",
        )
        self.assertIn("tzudong_public_media_read", self.migration)
        self.assertIn("tzudong_profile_avatar_insert_own", self.migration)
        self.assertIn("tzudong_review_photo_insert_own", self.migration)
        self.assertIn("tzudong_ad_banner_insert_admin", self.migration)
        self.assertIn("(storage.foldername(name))[1]", self.migration)
        self.assertIn("role_row.role::text = 'admin'", self.migration)
        self.assertIn("status_row.account_status = 'active'", self.migration)
        self.assertNotRegex(
            self.migration,
            r"CREATE POLICY[^;]+youtube-thumbnail-releases",
        )

    def test_youtube_release_allowlist_and_g014_readback_are_terminal(self) -> None:
        signature = (
            "public.publish_youtube_thumbnail_release(uuid,text,text,text,text,"
            "text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,"
            "timestamp with time zone)"
        )
        self.assertIn(signature, self.youtube_rpc_allowlist_migration)
        self.assertIn("procedure.proargtypes::text", self.youtube_rpc_allowlist_migration)
        self.assertIn("OWNER TO privacy_workflow_owner", self.youtube_rpc_allowlist_migration)
        for assertion in (
            "privacy_retention.assert_g014_public_rpc_allowlist()",
            "privacy_retention.assert_g014_catalog_contract()",
        ):
            self.assertIn(assertion, self.youtube_rpc_allowlist_migration)
            self.assertIn(f"PERFORM {assertion};", self.readback)
        self.assertIn(
            "receipt_unexpected_youtube_release_allowlist",
            self.readback,
        )
        self.assertIn(
            "allowed.identity_arguments = function_row.proargtypes::text",
            self.readback,
        )

    def test_realtime_contract_is_the_exact_app_subscription_set(self) -> None:
        self.assertIn(
            "ARRAY['notifications', 'review_likes', 'reviews']",
            self.migration,
        )
        self.assertIn(
            "'notifications', 'profiles', 'review_likes', 'reviews'",
            self.seed,
        )
        self.assertNotIn("restaurants', 'review_likes'", self.migration)

    def test_local_identity_is_active_admin_with_explicitly_synthetic_privacy_fixture(self) -> None:
        self.assertIn("INSERT INTO public.user_roles", self.seed)
        self.assertIn("'admin', '2026-01-01T00:00:00Z'", self.seed)
        self.assertIn("INSERT INTO public.user_account_status", self.seed)
        self.assertIn("'active', NULL, '2026-01-01T00:00:00Z'", self.seed)
        self.assertIn("receipt_unexpected_admin_role", self.readback)
        self.assertIn("receipt_unexpected_account_status", self.readback)
        self.assertIn("json_build_array('user_roles', 'nightly-ci'", self.readback)
        self.assertIn(
            "json_build_array('user_account_status', 'nightly-ci'",
            self.readback,
        )
        for required_fixture_contract in (
            "privacy_retention.privacy_policy_versions",
            "privacy_retention.privacy_age_profiles",
            "2026-08-04.1",
            "6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b",
            "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1",
            "age_14_plus",
            "eligible",
        ):
            self.assertIn(required_fixture_contract, self.seed)
        for readback_contract in (
            "receipt_unexpected_privacy_policy_fixture",
            "receipt_unexpected_privacy_age_profile",
            "'privacy_policy_fixture'",
            "'privacy_age_profile'",
        ):
            self.assertIn(readback_contract, self.readback)
        for documentation_boundary in (
            "LOCAL_TEST_ONLY:NOT_PRODUCTION",
            "not hosted publication evidence",
            "legal approval",
        ):
            self.assertIn(documentation_boundary, self.supabase_readme)
        for fabricated_evidence in (
            "operator_approved_at",
            "legal_approved_at",
            "privacy_onboarding_challenges",
        ):
            self.assertNotIn(fabricated_evidence, self.seed)

    def test_readback_fails_closed_over_storage_and_realtime_catalogs(self) -> None:
        self.assertIn("policy_count <> 12", self.readback)
        self.assertIn("bucket_count <> 5", self.readback)
        self.assertIn("realtime_membership_count <> 4", self.readback)
        self.assertIn("publication_count <> 2", self.readback)
        self.assertIn("publication_row.pubname = 'supabase_realtime'", self.readback)
        self.assertIn("owner_role.rolname = 'postgres'", self.readback)
        self.assertIn(
            "publication_row.pubname = 'supabase_realtime_messages_publication'",
            self.readback,
        )
        self.assertIn("owner_role.rolname = 'supabase_admin'", self.readback)
        self.assertIn("platform_realtime_membership_count < 1", self.readback)
        self.assertIn("platform_realtime_membership_count > 7", self.readback)
        self.assertIn("schemaname <> 'realtime'", self.readback)
        self.assertIn(
            "tablename !~ '^messages_[0-9]{4}_[0-9]{2}_[0-9]{2}$'",
            self.readback,
        )
        self.assertEqual(
            self.readback.count(
                "WHERE publication_row.pubname = 'supabase_realtime'"
            ),
            1,
        )
        self.assertNotIn(
            "publication_row.pubname LIKE 'supabase_realtime%'",
            self.readback,
        )
        self.assertNotIn("publication_row.pubname NOT LIKE", self.readback)
        self.assertIn("receipt_unexpected_youtube_runtime_contract", self.readback)
        self.assertIn("receipt_unexpected_youtube_release_function", self.readback)

    def test_public_read_policy_uses_caller_bound_least_privilege_predicate(self) -> None:
        self.assertTrue(PUBLIC_READ_MIGRATION.is_file())
        migration = self.public_read_migration
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.is_current_user_active_admin()",
            migration,
        )
        self.assertIn("SECURITY INVOKER", migration)
        self.assertIn("SET search_path = ''", migration)
        self.assertIn(
            "REVOKE ALL ON FUNCTION public.is_user_admin(uuid)",
            migration,
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.is_current_user_active_admin()\n  TO authenticated",
            migration,
        )
        self.assertNotRegex(
            migration,
            r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_user_admin\(uuid\)\s+TO\s+(?:anon|authenticated|service_role|PUBLIC)",
        )
        self.assertRegex(
            migration,
            r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_user_admin\(uuid\)\s+TO\s+privacy_workflow_owner",
        )
        self.assertNotRegex(
            migration,
            r"CREATE POLICY[^;]+is_user_admin",
        )
        for relation in ("announcements", "ad_banners"):
            self.assertRegex(
                migration,
                rf"CREATE POLICY tzudong_{relation}_select_active\s+"
                rf"ON public\.{relation} FOR SELECT TO anon, authenticated\s+"
                r"USING \(is_active = true\)",
            )
            for action in ("select", "insert", "update", "delete"):
                self.assertIn(f"tzudong_{relation}_{action}_admin", migration)
        for contract in (
            "receipt_unexpected_public_read_helper",
            "receipt_unexpected_public_read_table_grant",
            "receipt_unexpected_public_read_policy",
            "'public_read_function_grants'",
            "'public_read_table_grants'",
            "'public_read_policies'",
        ):
            self.assertIn(contract, self.readback)

        for relation in (
            "restaurant_refresh_candidates",
            "restaurant_refresh_runs",
            "restaurant_request_review_audit",
            "restaurant_requests",
            "restaurant_submission_items",
            "restaurant_submissions",
            "restaurants",
            "short_urls",
        ):
            self.assertIn(f"ON public.{relation} TO authenticated", migration)
        self.assertIn("local_legacy_admin_policy_dependency_remains", migration)
        self.assertIn("caller_bound_admin_policies", self.readback)

    def test_public_read_behavior_covers_anon_authenticated_and_service_role(self) -> None:
        for behavior_contract in (
            "SET LOCAL ROLE anon",
            "local_runtime_anon_active_read_failed",
            "local_runtime_anon_legacy_admin_helper_was_executable",
            "local_runtime_authenticated_non_admin_boundary_failed",
            "local_runtime_authenticated_admin_read_failed",
            "local_runtime_authenticated_legacy_admin_helper_was_executable",
            "SET LOCAL ROLE service_role",
            "local_runtime_service_role_bypass_failed",
            "local_runtime_service_role_caller_bound_helper_was_executable",
            "ROLLBACK;",
        ):
            self.assertIn(behavior_contract, self.behavior_sql)

    def test_admin_data_boundary_is_bounded_service_rpc_only(self) -> None:
        self.assertTrue(ADMIN_DATA_MIGRATION.is_file())
        for signature in (
            "public.read_admin_user_management_metadata",
            "public.read_admin_user_ids_for_management",
            "public.read_admin_user_audit_events",
            "public.append_admin_user_audit_event",
        ):
            self.assertIn(f"CREATE OR REPLACE FUNCTION {signature}", self.admin_data_migration)
            self.assertIn(signature, self.readback)
        self.assertIn("requested_count NOT BETWEEN 1 AND 200", self.admin_data_migration)
        self.assertIn("admin_count > 200", self.admin_data_migration)
        self.assertIn("p_limit NOT BETWEEN 1 AND 50", self.admin_data_migration)
        self.assertIn("SECURITY DEFINER", self.admin_data_migration)
        self.assertIn("SET search_path = ''", self.admin_data_migration)
        self.assertIn("TO service_role", self.admin_data_migration)
        self.assertNotRegex(
            self.admin_data_migration,
            r"GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]+ON\s+TABLE\s+public\.(?:profiles|user_roles|user_account_status|admin_audit_events)",
        )
        for behavior_contract in (
            "local_runtime_service_profile_direct_read_was_admitted",
            "local_runtime_admin_metadata_rpc_failed",
            "local_runtime_admin_ids_rpc_failed",
            "local_runtime_admin_audit_rpc_failed",
            "local_runtime_trusted_legacy_admin_rpc_failed",
        ):
            self.assertIn(behavior_contract, self.behavior_sql)

    def test_incident_guard_and_youtube_fixture_are_local_fail_closed_contracts(self) -> None:
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.privacy_incident_require_admin",
            self.admin_data_migration,
        )
        guard_match = re.search(
            r"CREATE OR REPLACE FUNCTION public\.privacy_incident_require_admin[\s\S]+?END\n\$\$;",
            self.admin_data_migration,
        )
        self.assertIsNotNone(guard_match)
        guard_definition = guard_match.group(0) if guard_match else ""
        self.assertIn("request.jwt.claim.role", guard_definition)
        self.assertNotIn("auth.role()", guard_definition)
        for source in (self.seed, self.readback, self.supabase_readme):
            self.assertIn("LOCAL_TEST_ONLY:NOT_PRODUCTION", source)
        self.assertIn("youtube_channel_kpi_snapshots", self.seed)
        self.assertIn("receipt_unexpected_youtube_channel_snapshot", self.readback)
        self.assertIn("not a successful YouTube", self.supabase_readme)

    def test_admin_map_overlay_boundary_uses_claims_and_exact_owner_grants(self) -> None:
        self.assertTrue(ADMIN_MAP_OVERLAY_MIGRATION.is_file())
        migration = self.admin_map_overlay_migration
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.apply_admin_restaurant_map_overlay_action",
            migration,
        )
        self.assertIn("SECURITY DEFINER", migration)
        self.assertIn("SET search_path = ''", migration)
        self.assertIn("pg_catalog.current_setting('request.jwt.claims', true)", migration)
        self.assertIn(
            "pg_catalog.current_setting('request.jwt.claim.role', true)",
            migration,
        )
        self.assertNotRegex(migration, r"pg_catalog\.(?:coalesce|nullif)\s*\(")
        function_definition = migration.split("ALTER FUNCTION", 1)[0]
        self.assertNotIn("auth.role()", function_definition)
        self.assertNotRegex(
            migration,
            r"GRANT\s+USAGE\s+ON\s+SCHEMA\s+auth",
        )
        self.assertNotRegex(function_definition.upper(), r"FOR\s+SHARE")
        self.assertEqual(function_definition.count("'matchedPayloadHash',"), 2)
        self.assertEqual(function_definition.count("'matchedPreviewHash',"), 2)
        self.assertIn(
            "GRANT SELECT ON TABLE public.admin_restaurant_map_overlays TO service_role",
            migration,
        )
        self.assertIn(
            "GRANT SELECT, INSERT, UPDATE\n  ON TABLE public.admin_restaurant_map_overlays TO privacy_workflow_owner",
            migration,
        )
        self.assertIn(
            "GRANT SELECT, INSERT\n  ON TABLE public.admin_restaurant_map_overlay_audit_events",
            migration,
        )
        for policy in (
            "tzudong_admin_map_overlays_owner_select",
            "tzudong_admin_map_overlays_owner_insert",
            "tzudong_admin_map_overlays_owner_update",
            "tzudong_admin_map_overlay_audit_owner_select",
            "tzudong_admin_map_overlay_audit_owner_insert",
        ):
            self.assertIn(policy, migration)
        for readback_contract in (
            "receipt_unexpected_admin_map_overlay_rpc",
            "receipt_unexpected_admin_map_overlay_table_grant",
            "receipt_unexpected_admin_map_overlay_policy",
            "'admin_map_overlay_rpc'",
            "'admin_map_overlay_table_grants'",
            "'admin_map_overlay_policies'",
        ):
            self.assertIn(readback_contract, self.readback)

    def test_admin_map_overlay_behavior_covers_roles_apply_and_replay(self) -> None:
        for behavior_contract in (
            "local_runtime_anon_overlay_direct_read_was_admitted",
            "local_runtime_anon_overlay_rpc_was_executable",
            "local_runtime_authenticated_overlay_direct_read_was_admitted",
            "local_runtime_authenticated_overlay_rpc_was_executable",
            "local_runtime_overlay_claim_guard_failed",
            "local_runtime_service_overlay_direct_read_failed",
            "local_runtime_service_overlay_direct_write_was_admitted",
            "local_runtime_service_overlay_audit_direct_read_was_admitted",
            "local_runtime_overlay_initial_apply_failed",
            "local_runtime_overlay_replay_failed",
        ):
            self.assertIn(behavior_contract, self.behavior_sql)

    def test_privacy_behavior_proves_eligibility_and_fail_closed_catalog_states(self) -> None:
        for behavior_contract in (
            "local_runtime_privacy_fixture_not_eligible",
            "privacy_fixture_inactive",
            "PRIVACY_AGE_BLOCKED",
            "privacy_fixture_removed",
            "PRIVACY_AGE_ATTESTATION_REQUIRED",
            "local_runtime_privacy_fixture_rollback_failed",
            "ROLLBACK TO SAVEPOINT privacy_fixture_inactive",
            "ROLLBACK TO SAVEPOINT privacy_fixture_removed",
        ):
            self.assertIn(behavior_contract, self.behavior_sql)


if __name__ == "__main__":
    unittest.main()
