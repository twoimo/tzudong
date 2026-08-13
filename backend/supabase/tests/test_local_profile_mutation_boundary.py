import hashlib
import importlib.util
import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
MIGRATION = (
    MIGRATIONS / "20260813085342_current_profile_mutation_boundary.sql"
)
PREDECESSOR = (
    MIGRATIONS
    / "20260812000700_local_profile_leaderboard_page_convergence.sql"
)
PREDECESSOR_TEST = (
    ROOT
    / "backend/supabase/tests/"
    "test_local_profile_leaderboard_page_convergence.py"
)
BEHAVIOR = ROOT / "backend/supabase/tests/local_profile_mutation_boundary.sql"
SEED = ROOT / "backend/supabase/scripts/local-seed.sql"


def tagged(source: str, tag: str) -> str:
    match = re.search(rf"\${tag}\$(.*?)\${tag}\$", source, re.DOTALL)
    if match is None:
        raise AssertionError(f"missing ${tag}$ block")
    return match.group(1)


def load_predecessor_contract_module():
    spec = importlib.util.spec_from_file_location(
        "profile_mutation_predecessor_contract", PREDECESSOR_TEST
    )
    if spec is None or spec.loader is None:
        raise AssertionError("predecessor contract module unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LocalProfileMutationBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.behavior = BEHAVIOR.read_text(encoding="utf-8")
        cls.seed = SEED.read_text(encoding="utf-8")
        predecessor = load_predecessor_contract_module()
        predecessor_class = (
            predecessor.LocalProfileLeaderboardPageConvergenceTests
        )
        predecessor_class.setUpClass()
        cls.definer_before = predecessor_class.definer_before.replace(
            tagged(predecessor_class.source, "definer_anchor"),
            tagged(predecessor_class.source, "definer_replacement"),
        )
        cls.catalog_before = predecessor_class.catalog_before.replace(
            tagged(predecessor_class.source, "catalog_anchor"),
            tagged(predecessor_class.source, "catalog_replacement"),
        )

    def test_cli_created_forward_migration_and_predecessor_are_bound(self) -> None:
        self.assertEqual(
            [path.name for path in MIGRATIONS.glob("20260813085342*.sql")],
            [MIGRATION.name],
        )
        self.assertEqual(
            hashlib.sha256(PREDECESSOR.read_bytes()).hexdigest(),
            "c03c0833294875be06d7cff6d513f7c7ddaf263514b7148bc3db22a29ac3bd17",
        )
        self.assertTrue(self.source.startswith("-- Harden signup initialization"))
        self.assertTrue(self.source.endswith("\nCOMMIT;\n"))
        self.assertIn("BEGIN;", self.source)
        self.assertNotRegex(
            self.source,
            r"(?im)^\s*(?:DROP|ALTER)\s+(?:DATABASE|SCHEMA)\b",
        )

    def test_partial_unique_nickname_index_is_exact_and_fail_closed(self) -> None:
        for token in (
            "DROP CONSTRAINT profiles_nickname_key",
            "CREATE UNIQUE INDEX profiles_active_nickname_key",
            "ON public.profiles USING btree (nickname)",
            "WHERE nickname <> '탈퇴한 사용자'",
            "current_profile_mutation_nickname_index_drift",
            "current_profile_mutation_nickname_index_readback_drift",
            "(index_row.indkey::smallint[])[0] = v_nickname_attnum",
            "GROUP BY profile.nickname",
            "HAVING pg_catalog.count(*) <> 1",
        ):
            self.assertIn(token, self.source)
        self.assertNotIn("ADD CONSTRAINT profiles_active_nickname_key", self.source)

    def test_signup_write_quiescence_and_active_identity_preflight_are_exact(self) -> None:
        prerequisite_body = tagged(self.source, "prerequisites")
        for token in (
            "DO $lock_prerequisites$",
            "pg_catalog.to_regclass('auth.users') IS NULL",
            "pg_catalog.to_regclass('public.profiles') IS NULL",
            "pg_catalog.to_regclass('public.user_roles') IS NULL",
            "pg_catalog.to_regclass('public.user_stats') IS NULL",
            "pg_catalog.to_regclass('public.user_account_status') IS NULL",
            "LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;",
            "LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;",
            "LOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE;",
            "LOCK TABLE public.user_stats IN ACCESS EXCLUSIVE MODE;",
            "LOCK TABLE public.user_account_status IN ACCESS EXCLUSIVE MODE;",
            "current_profile_mutation_active_identity_incomplete",
            "current_profile_mutation_active_identity_readback_incomplete",
            "auth_user.deleted_at IS NULL",
            "disabled_status.account_status = 'disabled'",
            "disabled_status.disabled_at IS NOT NULL",
            "active_status.account_status = 'active'",
            "active_status.disabled_at IS NULL",
            "FROM public.user_account_status AS status_row",
            "profile.nickname <> '탈퇴한 사용자'",
            "FROM public.user_roles AS role_row",
            "FROM public.user_stats AS stats",
        ):
            self.assertIn(token, self.source)
        auth_lock = self.source.index(
            "LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;"
        )
        profile_lock = self.source.index(
            "LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;"
        )
        role_lock = self.source.index(
            "LOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE;"
        )
        stats_lock = self.source.index(
            "LOCK TABLE public.user_stats IN ACCESS EXCLUSIVE MODE;"
        )
        status_lock = self.source.index(
            "LOCK TABLE public.user_account_status IN ACCESS EXCLUSIVE MODE;"
        )
        data_preflight = self.source.index(
            "current_profile_mutation_active_identity_incomplete"
        )
        self.assertLess(auth_lock, profile_lock)
        self.assertLess(profile_lock, role_lock)
        self.assertLess(role_lock, stats_lock)
        self.assertLess(stats_lock, status_lock)
        self.assertLess(status_lock, data_preflight)
        self.assertLess(data_preflight, self.source.index("DROP CONSTRAINT profiles_nickname_key"))
        self.assertEqual(
            self.source.count(
                "FROM public.user_account_status AS status_row\n"
                "           WHERE status_row.user_id = auth_user.id) <> 1"
            ),
            2,
        )
        self.assertNotRegex(prerequisite_body, r"(?im)^\s*(?:UPDATE|DELETE|TRUNCATE)\b")
        self.assertNotIn("substring", prerequisite_body.lower())

    def test_signup_trigger_is_atomic_bounded_and_non_diagnostic(self) -> None:
        body = tagged(self.source, "handle_new_user")
        for token in (
            "FOR v_attempt IN 1..16 LOOP",
            "pg_catalog.jsonb_typeof(NEW.raw_user_meta_data) <> 'object'",
            "pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'nickname')",
            "profiles_active_nickname_key",
            "GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME",
            "'쯔동이_' || pg_catalog.substr(",
            "INSERT INTO public.profiles",
            "INSERT INTO public.user_roles",
            "FROM public.user_roles AS role_row\n         WHERE role_row.user_id = NEW.id) <> 1",
            "INSERT INTO public.user_stats",
            "INSERT INTO public.user_account_status",
            "signup_profile_initialization_incomplete",
        ):
            self.assertIn(token, body)
        for forbidden in (
            "WHEN OTHERS",
            "SQLERRM",
            "RAISE WARNING",
            "ON CONFLICT",
        ):
            self.assertNotIn(forbidden, body)
        self.assertIn(
            "CREATE OR REPLACE FUNCTION public.handle_new_user()", self.source
        )
        self.assertIn(
            "ALTER FUNCTION public.handle_new_user() OWNER TO postgres",
            self.source,
        )
        self.assertIn(
            "AFTER INSERT ON auth.users\n    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()",
            self.source,
        )
        self.assertIn("trigger_row.tgtype IS DISTINCT FROM 5::smallint", self.source)

    def test_nickname_rpc_is_claim_bound_private_and_receipted(self) -> None:
        body = tagged(self.source, "update_nickname")
        for token in (
            "privacy_retention.g041_current_claim_user_id()",
            "privacy_retention.g014_privacy_eligibility_receipt(v_user_id)",
            "FOR UPDATE",
            "p_nickname IS DISTINCT FROM pg_catalog.btrim(p_nickname)",
            "pg_catalog.char_length(p_nickname) NOT BETWEEN 2 AND 20",
            "pg_catalog.octet_length(p_nickname) > 80",
            "profile_account_deleted",
            "PROFILE_NICKNAME_UPDATED",
            "PROFILE_NICKNAME_UNCHANGED",
            "GET DIAGNOSTICS v_rows = ROW_COUNT",
            "v_rows IS DISTINCT FROM 1",
            "profile_nickname_readback_failed",
            "USING ERRCODE = '55000'",
            "'changes', pg_catalog.jsonb_build_object('nickname', v_changed)",
            "'readback', pg_catalog.jsonb_build_object('passed', true)",
        ):
            self.assertIn(token, body)
        self.assertNotIn("p_user_id", body)
        self.assertNotIn("email", body.lower())

    def test_avatar_rpc_accepts_only_expected_reference_and_operation_id(self) -> None:
        body = tagged(self.source, "compare_and_set_avatar")
        self.assertIn(
            "CREATE FUNCTION public.compare_and_set_current_profile_avatar(\n"
            "  p_expected_avatar_reference text,\n"
            "  p_next_avatar_operation_id uuid",
            self.source,
        )
        for token in (
            "pg_catalog.octet_length(p_expected_avatar_reference) > 4096",
            "v_current_reference IS DISTINCT FROM p_expected_avatar_reference",
            "PROFILE_VERSION_CONFLICT",
            "'profile-avatar://' || v_user_id::text || '/avatar-'",
            "pg_catalog.lower(p_next_avatar_operation_id::text) || '.jpg'",
            "profile_account_deleted",
            "PROFILE_AVATAR_UPDATED",
            "PROFILE_AVATAR_UNCHANGED",
            "GET DIAGNOSTICS v_rows = ROW_COUNT",
            "v_rows IS DISTINCT FROM 1",
            "profile_avatar_readback_failed",
            "USING ERRCODE = '55000'",
        ):
            self.assertIn(token, body)
        self.assertNotIn("p_next_avatar_reference", body)
        self.assertNotIn("http://", body)
        self.assertNotIn("https://", body)

    def test_existing_avatar_reference_bound_is_fail_closed_and_read_back(self) -> None:
        for token in (
            "profiles_avatar_url_octet_length_check",
            "current_profile_mutation_avatar_constraint_conflict",
            "current_profile_mutation_avatar_constraint_readback_drift",
            "ADD CONSTRAINT profiles_avatar_url_octet_length_check",
            "avatar_url IS NULL OR pg_catalog.octet_length(avatar_url) <= 4096",
            "constraint_row.contype = 'c'",
            "constraint_row.convalidated",
            "pg_catalog.pg_get_expr(",
            "current_profile_mutation_avatar_reference_too_large",
            "current_profile_mutation_avatar_reference_readback_drift",
            "profile.avatar_url IS NOT NULL",
            "pg_catalog.octet_length(profile.avatar_url) > 4096",
        ):
            self.assertIn(token, self.source)
        self.assertEqual(
            self.source.count("pg_catalog.octet_length(profile.avatar_url) > 4096"),
            2,
        )
        self.assertLess(
            self.source.index("current_profile_mutation_avatar_reference_too_large"),
            self.source.index("DROP CONSTRAINT profiles_nickname_key"),
        )
        self.assertLess(
            self.source.index("DROP CONSTRAINT profiles_nickname_key"),
            self.source.index("ADD CONSTRAINT profiles_avatar_url_octet_length_check"),
        )

    def test_signup_readback_is_minimized_and_excludes_admins(self) -> None:
        body = tagged(self.source, "read_signup_state")
        for token in (
            "privacy_retention.g014_require_service_role()",
            "v_profile_count = 1",
            "v_ordinary_role_count = 1",
            "v_admin_role_count = 0",
            "v_stats_count = 1",
            "v_active_status_count = 1",
            "SIGNUP_PROFILE_READY",
            "SIGNUP_PROFILE_INCOMPLETE",
            "'adminRole', v_admin_role_count",
        ):
            self.assertIn(token, body)
        for forbidden in ("email", "avatar_url", "raw_user_meta_data"):
            self.assertNotIn(forbidden, body.lower())

    def test_rpc_grants_and_direct_profiles_acl_remain_exact(self) -> None:
        for signature, grantee in (
            ("public.update_current_profile_nickname(text)", "authenticated"),
            (
                "public.compare_and_set_current_profile_avatar(text, uuid)",
                "authenticated",
            ),
            ("public.read_signup_profile_state(uuid, text)", "service_role"),
        ):
            self.assertIn(f"GRANT EXECUTE ON FUNCTION {signature}\n  TO {grantee}", self.source)
        self.assertGreaterEqual(self.source.count("supabase_auth_admin"), 8)
        self.assertNotRegex(
            self.source,
            r"(?is)\bGRANT\b[^;]*ON\s+(?:TABLE\s+)?public\.profiles",
        )
        for role in ("anon", "authenticated", "service_role"):
            self.assertIn(
                f"pg_catalog.has_table_privilege('{role}', 'public.profiles', 'SELECT')",
                self.source,
            )

    def test_g014_assertion_patches_are_exact_hash_bound(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.definer_before.encode()).hexdigest(),
            "ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9",
        )
        definer_after = self.definer_before.replace(
            tagged(self.source, "definer_anchor"),
            tagged(self.source, "definer_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(definer_after.encode()).hexdigest(),
            "6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d",
        )
        self.assertEqual(
            hashlib.sha256(self.catalog_before.encode()).hexdigest(),
            "addca083161250234a8378713dbc07074bfff248f5d0f02f4a8f3772a5b951e6",
        )
        catalog_after = self.catalog_before.replace(
            tagged(self.source, "catalog_definer_anchor"),
            tagged(self.source, "catalog_definer_replacement"),
        ).replace(
            tagged(self.source, "catalog_matrix_anchor"),
            tagged(self.source, "catalog_matrix_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(catalog_after.encode()).hexdigest(),
            "c58fa9c66865db3f5e81513f9537084a9024ebe77863a1b22f4ddb37936c6998",
        )
        self.assertEqual(
            self.source.count(
                "SELECT privacy_retention.assert_g014_public_rpc_allowlist();"
            ),
            2,
        )
        self.assertIn(
            "PERFORM privacy_retention.assert_g014_catalog_contract();",
            self.source,
        )

    def test_local_seed_normalizes_only_trigger_created_user_state(self) -> None:
        for token in (
            "(SELECT count(*) FROM public.profiles) <> 1",
            "role::text NOT IN ('user', 'admin')",
            "(SELECT count(*) FROM public.user_roles) <> 1",
            "(SELECT count(*) FROM public.user_stats) <> 1",
            "DELETE FROM public.user_roles\nWHERE user_id = :'nightly_user_id'::uuid\n  AND role::text = 'user'",
            "DELETE FROM public.user_stats\nWHERE user_id = :'nightly_user_id'::uuid",
            "INSERT INTO public.user_stats (",
            "'2026-01-01T00:00:00Z'",
        ):
            self.assertIn(token, self.seed)
        self.assertNotIn("DELETE FROM auth.users", self.seed)

    def test_behavior_probe_covers_atomicity_receipts_conflicts_and_sentinel(self) -> None:
        for token in (
            "local_profile_mutation_failed_signup_not_atomic",
            "local_profile_mutation_nonstring_signup_not_atomic",
            "'{\"nickname\":123}'::jsonb",
            "local_profile_mutation_duplicate_signup_not_atomic",
            "profiles_active_nickname_key",
            "local_profile_mutation_downstream_failure_not_atomic",
            "VALUES (NEW.id, 'admin')",
            "signup_profile_initialization_incomplete",
            "local_profile_mutation_signup_state_incomplete",
            "local_profile_mutation_nickname_receipt_drift",
            "local_profile_mutation_duplicate_nickname_admitted",
            "local_profile_mutation_avatar_apply_drift",
            "local_profile_mutation_legacy_avatar_boundary_drift",
            "local_profile_mutation_legacy_avatar_overflow_admitted",
            "profiles_avatar_url_octet_length_check",
            "pg_catalog.repeat('x', 4089)",
            "pg_catalog.repeat('x', 4097)",
            "local_profile_mutation_avatar_conflict_drift",
            "local_profile_mutation_oversized_avatar_expected_admitted",
            "local_profile_mutation_avatar_unchanged_drift",
            "local_profile_mutation_avatar_clear_drift",
            "local_profile_mutation_nickname_suppression_admitted",
            "local_profile_mutation_avatar_suppression_admitted",
            "profile_nickname_readback_failed",
            "profile_avatar_readback_failed",
            "local_profile_mutation_signup_admin_admitted",
            "local_profile_mutation_deleted_nickname_admitted",
            "local_profile_mutation_deleted_avatar_admitted",
            "local_profile_mutation_deleted_sentinel_not_repeatable",
            "SET LOCAL ROLE anon;",
            "SET LOCAL ROLE authenticated;",
            "SET LOCAL ROLE service_role;",
        ):
            self.assertIn(token, self.behavior)
        self.assertTrue(self.behavior.endswith("\nROLLBACK;\n"))

    def test_external_before_user_created_hook_is_out_of_scope(self) -> None:
        for forbidden in (
            "before_user_created",
            "hook_secret",
            "challenge_token",
            "custom_access_token_hook",
        ):
            self.assertNotIn(forbidden, self.source.lower())


if __name__ == "__main__":
    unittest.main()
