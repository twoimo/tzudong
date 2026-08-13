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
    / "20260812000700_local_profile_leaderboard_page_convergence.sql"
)
BEHAVIOR = ROOT / "backend/supabase/tests/local_profile_leaderboard_page.sql"
PREDECESSOR = (
    MIGRATIONS
    / "20260812000600_local_profile_read_boundary_convergence.sql"
)
PREDECESSOR_TEST = (
    ROOT
    / "backend/supabase/tests/"
    "test_local_profile_read_boundary_convergence.py"
)
PAGE_SIGNATURE = (
    "public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)"
)


def tagged(source: str, tag: str) -> str:
    match = re.search(rf"\${tag}\$(.*?)\${tag}\$", source, re.DOTALL)
    if match is None:
        raise AssertionError(f"missing ${tag}$ block")
    return match.group(1)


def load_predecessor_contract_module():
    spec = importlib.util.spec_from_file_location(
        "profile_page_predecessor_contract", PREDECESSOR_TEST
    )
    if spec is None or spec.loader is None:
        raise AssertionError("predecessor contract module unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LocalProfileLeaderboardPageConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.behavior = BEHAVIOR.read_text(encoding="utf-8")
        predecessor = load_predecessor_contract_module()
        predecessor.setUpModule() if hasattr(predecessor, "setUpModule") else None
        predecessor_class = predecessor.LocalProfileReadBoundaryConvergenceTests
        predecessor_class.setUpClass()
        cls.definer_before = predecessor_class.definer_before.replace(
            tagged(predecessor_class.source, "definer_anchor"),
            tagged(predecessor_class.source, "definer_replacement"),
        )
        cls.catalog_before = predecessor_class.catalog_before.replace(
            tagged(predecessor_class.source, "catalog_anchor"),
            tagged(predecessor_class.source, "catalog_replacement"),
        )

    def test_exact_forward_migration_and_immutable_006_are_bound(self) -> None:
        self.assertEqual(
            [path.name for path in MIGRATIONS.glob("20260812000700*.sql")],
            [MIGRATION.name],
        )
        self.assertEqual(
            hashlib.sha256(PREDECESSOR.read_bytes()).hexdigest(),
            "c8c0d2c0a4767b4e076cfe524fcba747e7cf8139bf768373f9329f4bce8e0da4",
        )
        self.assertRegex(self.source, r"(?s)^--.*?\n\nBEGIN;\n")
        self.assertTrue(self.source.endswith("\nCOMMIT;\n"))
        self.assertEqual(self.source.count("\nBEGIN;\n"), 1)
        self.assertEqual(self.source.count("\nCOMMIT;\n"), 1)

    def test_cursor_contract_is_exact_bounded_and_deterministic(self) -> None:
        for token in (
            "CREATE FUNCTION public.read_public_profile_leaderboard_page(",
            "p_period text,\n  p_limit integer,\n  p_after_quality_score numeric,\n  p_after_user_id uuid",
            "p_period NOT IN ('all', 'monthly')",
            "p_limit NOT BETWEEN 1 AND 100",
            "(p_after_quality_score IS NULL)\n       IS DISTINCT FROM (p_after_user_id IS NULL)",
            "p_after_quality_score < 0::numeric",
            "p_after_quality_score = 'NaN'::numeric",
            "p_after_quality_score = 'Infinity'::numeric",
            "p_after_quality_score = '-Infinity'::numeric",
            "scored.quality_score < p_after_quality_score",
            "scored.quality_score = p_after_quality_score",
            "scored.user_id > p_after_user_id",
            "ORDER BY scored.quality_score DESC, scored.user_id ASC",
            "LIMIT p_limit",
        ):
            self.assertIn(token, self.source)
        self.assertEqual(self.source.count("'Asia/Seoul'"), 2)
        self.assertNotIn("OFFSET", self.source)

    def test_result_shape_metadata_acl_and_direct_grants_are_exact(self) -> None:
        self.assertIn(
            "RETURNS TABLE (\n  user_id uuid,\n  nickname text,\n  review_count bigint,\n  verified_review_count bigint,\n  total_likes bigint,\n  avg_likes_per_review numeric,\n  quality_score numeric",
            self.source,
        )
        self.assertEqual(
            len(re.findall(r"^SECURITY DEFINER$", self.source, re.MULTILINE)),
            2,
        )
        self.assertGreaterEqual(self.source.count("SET search_path = ''"), 2)
        self.assertGreaterEqual(self.source.count(PAGE_SIGNATURE), 5)
        self.assertIn(
            "FROM PUBLIC, anon, authenticated, service_role", self.source
        )
        self.assertIn(
            "GRANT EXECUTE ON FUNCTION public.read_public_profile_leaderboard_page(\n  text, integer, numeric, uuid\n) TO anon, authenticated",
            self.source,
        )
        self.assertNotRegex(
            self.source,
            r"(?is)\b(?:GRANT|REVOKE)\b[^;]*ON\s+(?:TABLE\s+)?public\.profiles",
        )

    def test_allowlist_and_all_g014_assertions_are_exact(self) -> None:
        self.assertIn("GET DIAGNOSTICS v_rows = ROW_COUNT", self.source)
        self.assertIn("IF v_rows <> 2", self.source)
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
            "c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025",
        )
        definer_after = self.definer_before.replace(
            tagged(self.source, "definer_anchor"),
            tagged(self.source, "definer_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(definer_after.encode()).hexdigest(),
            "ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9",
        )
        self.assertEqual(
            hashlib.sha256(self.catalog_before.encode()).hexdigest(),
            "3a5c799d38a35e2c702b7ba0ee69cb291d483f5094a76568d4c92e490eb5b003",
        )
        catalog_after = self.catalog_before.replace(
            tagged(self.source, "catalog_anchor"),
            tagged(self.source, "catalog_replacement"),
        )
        self.assertEqual(
            hashlib.sha256(catalog_after.encode()).hexdigest(),
            "addca083161250234a8378713dbc07074bfff248f5d0f02f4a8f3772a5b951e6",
        )

    def test_membership_cleanup_precedes_terminal_catalog_readback(self) -> None:
        ordered = (
            "DO $membership_acquire$",
            "SET LOCAL ROLE privacy_workflow_owner;",
            "CREATE FUNCTION public.read_public_profile_leaderboard_page(",
            "DO $allowlist_insert$",
            "DO $definer_contract$",
            "DO $catalog_contract$",
            "CREATE TEMPORARY TABLE g014_007_catalog_assertion_guard (",
            "RESET ROLE;",
            "DO $membership_restore$",
            "DO $membership_postcondition$",
            "DO $catalog_assertion_readback$",
        )
        positions = [self.source.index(token) for token in ordered]
        self.assertEqual(positions, sorted(positions))
        for token in (
            "g014_007.remove_owner_membership",
            "g014_007.restore_owner_set_false",
            "WITH SET TRUE",
            "WITH SET FALSE",
            "local_profile_leaderboard_page_owner_membership_cleanup_drift",
        ):
            self.assertIn(token, self.source)
        self.assertNotIn("WITH ADMIN", self.source)

    def test_behavior_probe_covers_pages_ties_invalids_and_service_deny(self) -> None:
        for token in (
            "SET LOCAL ROLE anon;",
            "SET LOCAL ROLE authenticated;",
            "SET LOCAL ROLE service_role;",
            "local_profile_page_first_page_failed",
            "local_profile_page_tie_cursor_failed",
            "local_profile_page_zero_review_monthly_failed",
            "local_profile_page_all_period_failed",
            "local_profile_page_partial_cursor_id_admitted",
            "local_profile_page_partial_cursor_score_admitted",
            "local_profile_page_negative_cursor_admitted",
            "local_profile_page_nan_cursor_admitted",
            "local_profile_page_infinity_cursor_admitted",
            "local_profile_page_negative_infinity_cursor_admitted",
            "local_profile_page_service_role_execution_admitted",
            "'Asia/Seoul'",
        ):
            self.assertIn(token, self.behavior)
        self.assertTrue(self.behavior.endswith("RESET ROLE;\nROLLBACK;\n"))


if __name__ == "__main__":
    unittest.main()
