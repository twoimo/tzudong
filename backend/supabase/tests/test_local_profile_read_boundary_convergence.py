import hashlib
import importlib.util
import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
MIGRATION = (
    MIGRATIONS
    / "20260812000600_local_profile_read_boundary_convergence.sql"
)
BEHAVIOR = ROOT / "backend/supabase/tests/local_profile_read_boundary.sql"
PREDECESSOR = (
    MIGRATIONS
    / "20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql"
)
PREDECESSOR_TEST = (
    ROOT
    / "backend/supabase/tests/"
    "test_local_youtube_thumbnail_rpc_allowlist_convergence.py"
)
SUMMARY_SIGNATURE = "public.read_public_profile_summaries(uuid[])"
LEADERBOARD_SIGNATURE = (
    "public.read_public_profile_leaderboard(text,integer)"
)


def tagged(source: str, tag: str) -> str:
    match = re.search(rf"\${tag}\$(.*?)\${tag}\$", source, re.DOTALL)
    if match is None:
        raise AssertionError(f"missing ${tag}$ block")
    return match.group(1)


def load_predecessor_contract_module():
    spec = importlib.util.spec_from_file_location(
        "profile_boundary_predecessor_contract", PREDECESSOR_TEST
    )
    if spec is None or spec.loader is None:
        raise AssertionError("predecessor contract module unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LocalProfileReadBoundaryConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.behavior = BEHAVIOR.read_text(encoding="utf-8")
        cls.predecessor_source = PREDECESSOR.read_text(encoding="utf-8")
        predecessor = load_predecessor_contract_module()
        retention = predecessor.RETENTION_MIGRATION.read_text(encoding="utf-8")
        catalog = predecessor.CATALOG_MIGRATION.read_text(encoding="utf-8")
        bridge = predecessor.AUTH_BRIDGE_MIGRATION.read_text(encoding="utf-8")
        pre_definer = predecessor.definer_source_after_g041(retention, bridge)
        cls.definer_before = predecessor.apply_frozen_definer_correction(
            pre_definer, cls.predecessor_source
        )
        catalog_before_005 = predecessor.catalog_source_after_g041(
            catalog, bridge
        )
        cls.catalog_before = predecessor.apply_frozen_correction(
            catalog_before_005, cls.predecessor_source
        )

    def test_exact_forward_migration_and_immutable_predecessor_are_bound(self) -> None:
        self.assertEqual(
            [path.name for path in MIGRATIONS.glob("20260812000600*.sql")],
            [MIGRATION.name],
        )
        self.assertEqual(
            hashlib.sha256(PREDECESSOR.read_bytes()).hexdigest(),
            "33735c6661ff8b555424bc2ccc28467baee182dd455f8283bfced356c0793ff7",
        )
        self.assertRegex(self.source, r"(?s)^--.*?\n\nBEGIN;\n")
        self.assertTrue(self.source.endswith("\nCOMMIT;\n"))
        self.assertEqual(self.source.count("\nBEGIN;\n"), 1)
        self.assertEqual(self.source.count("\nCOMMIT;\n"), 1)

    def test_summary_contract_is_bounded_ordered_and_minimized(self) -> None:
        for token in (
            "CREATE FUNCTION public.read_public_profile_summaries(",
            "p_user_ids uuid[]",
            "RETURNS TABLE (\n  user_id uuid,\n  nickname text,\n  avatar_url text",
            "pg_catalog.cardinality(p_user_ids) NOT BETWEEN 1 AND 100",
            "pg_catalog.count(DISTINCT requested.requested_user_id)",
            "WITH ORDINALITY",
            "ORDER BY requested.input_ordinal",
            "profile.nickname <> '탈퇴한 사용자'",
        ):
            self.assertIn(token, self.source)
        self.assertNotIn("profile.email", self.source)
        self.assertNotIn("profile.role", self.source)

    def test_leaderboard_contract_is_kst_bounded_and_deterministic(self) -> None:
        for token in (
            "CREATE FUNCTION public.read_public_profile_leaderboard(",
            "p_period text",
            "p_limit integer",
            "p_period NOT IN ('all', 'monthly')",
            "p_limit NOT BETWEEN 1 AND 100",
            "LEFT JOIN public.reviews AS review_row",
            "'Asia/Seoul', pg_catalog.statement_timestamp()",
            "ORDER BY scored.quality_score DESC, scored.user_id ASC",
            "LIMIT p_limit",
            "pg_catalog.round(",
        ):
            self.assertIn(token, self.source)
        self.assertEqual(self.source.count("'Asia/Seoul'"), 2)
        self.assertNotIn("'UTC', pg_catalog.statement_timestamp()", self.source)

    def test_function_metadata_acl_and_direct_profile_deny_are_exact(self) -> None:
        self.assertEqual(
            len(re.findall(r"^SECURITY DEFINER$", self.source, re.MULTILINE)),
            3,
        )
        self.assertGreaterEqual(self.source.count("STABLE"), 2)
        self.assertGreaterEqual(self.source.count("SET search_path = ''"), 3)
        for signature in (SUMMARY_SIGNATURE, LEADERBOARD_SIGNATURE):
            self.assertGreaterEqual(self.source.count(signature), 5)
        for role in ("anon", "authenticated"):
            self.assertIn(role, self.source)
        self.assertIn(
            "FROM PUBLIC, anon, authenticated, service_role", self.source
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.read_public_profile_summaries(uuid[])\n  TO anon, authenticated",
            self.source,
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.read_public_profile_leaderboard(text, integer)\n  TO anon, authenticated",
            self.source,
        )
        self.assertNotRegex(
            self.source,
            r"(?is)\b(?:GRANT|REVOKE)\b[^;]*ON\s+(?:TABLE\s+)?public\.profiles",
        )

    def test_allowlist_is_four_exact_rows_and_all_g014_assertions_run(self) -> None:
        self.assertIn("GET DIAGNOSTICS v_rows = ROW_COUNT", self.source)
        self.assertIn("IF v_rows <> 4", self.source)
        self.assertIn("procedure.proargtypes::text", self.source)
        self.assertNotIn("ON CONFLICT", tagged(self.source, "allowlist_insert"))
        self.assertEqual(
            self.source.count(
                "SELECT privacy_retention.assert_g014_public_rpc_allowlist();"
            ),
            2,
        )
        self.assertEqual(
            self.source.count(
                "SELECT privacy_retention.assert_g014_definer_contract();"
            ),
            1,
        )
        self.assertIn(
            "PERFORM privacy_retention.assert_g014_catalog_contract();",
            self.source,
        )

    def test_g014_patches_are_hash_bound_and_exact(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.definer_before.encode()).hexdigest(),
            "7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599",
        )
        definer_after = self.definer_before.replace(
            tagged(self.source, "definer_anchor"),
            tagged(self.source, "definer_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(definer_after.encode()).hexdigest(),
            "c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025",
        )
        self.assertEqual(
            hashlib.sha256(self.catalog_before.encode()).hexdigest(),
            "9aa3bd25e13e3b5eb896a19363e0be2e8356031cf121a39d836cf2efdb214efa",
        )
        catalog_after = self.catalog_before.replace(
            tagged(self.source, "catalog_anchor"),
            tagged(self.source, "catalog_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(catalog_after.encode()).hexdigest(),
            "3a5c799d38a35e2c702b7ba0ee69cb291d483f5094a76568d4c92e490eb5b003",
        )

    def test_membership_window_is_restored_before_terminal_catalog_readback(self) -> None:
        ordered = (
            "DO $membership_acquire$",
            "SET LOCAL ROLE privacy_workflow_owner;",
            "CREATE FUNCTION public.read_public_profile_summaries(",
            "CREATE FUNCTION public.read_public_profile_leaderboard(",
            "DO $allowlist_insert$",
            "DO $definer_contract$",
            "DO $catalog_contract$",
            "CREATE TEMPORARY TABLE g014_006_catalog_assertion_guard (",
            "RESET ROLE;",
            "DO $membership_restore$",
            "DO $membership_postcondition$",
            "DO $catalog_assertion_readback$",
        )
        positions = [self.source.index(token) for token in ordered]
        self.assertEqual(positions, sorted(positions))
        for token in (
            "g014_006.remove_owner_membership",
            "g014_006.restore_owner_set_false",
            "WITH SET TRUE",
            "WITH SET FALSE",
            "local_profile_read_boundary_owner_membership_cleanup_drift",
        ):
            self.assertIn(token, self.source)
        self.assertNotIn("WITH ADMIN", self.source)

    def test_behavior_probe_covers_public_and_denied_branches(self) -> None:
        for token in (
            "SET LOCAL ROLE anon;",
            "SET LOCAL ROLE authenticated;",
            "SET LOCAL ROLE service_role;",
            "local_profile_read_anon_direct_profile_read_admitted",
            "local_profile_read_authenticated_direct_profile_read_admitted",
            "local_profile_read_service_role_direct_profile_read_admitted",
            "local_profile_read_service_role_summary_admitted",
            "local_profile_read_service_role_leaderboard_admitted",
            "local_profile_read_oversized_array_admitted",
            "local_profile_read_duplicate_array_admitted",
            "local_profile_read_summary_order_or_omission_failed",
            "local_profile_read_monthly_leaderboard_failed",
            "'00000000-0000-4000-8000-000000000602'",
            "'00000000-0000-4000-8000-000000000604'",
            "'탈퇴한 사용자'",
            "'Asia/Seoul'",
        ):
            self.assertIn(token, self.behavior)
        self.assertTrue(self.behavior.endswith("RESET ROLE;\nROLLBACK;\n"))


if __name__ == "__main__":
    unittest.main()
