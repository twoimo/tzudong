from __future__ import annotations

import hashlib
import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
FIRST_MIGRATION = MIGRATIONS / "20260814010000_hosted_g016_g041_catalog_reconciliation.sql"
SECOND_MIGRATION = MIGRATIONS / "20260814010100_hosted_runtime_boundary_convergence.sql"
READ_MIGRATION = MIGRATIONS / "20260814010200_hosted_public_profile_read_convergence.sql"
MUTATION_MIGRATION = MIGRATIONS / "20260814010300_hosted_current_profile_mutation.sql"
CANONICAL_READ_MIGRATION = MIGRATIONS / "20260812000600_local_profile_read_boundary_convergence.sql"
CANONICAL_PAGE_MIGRATION = MIGRATIONS / "20260812000700_local_profile_leaderboard_page_convergence.sql"
CANONICAL_MUTATION_MIGRATION = MIGRATIONS / "20260813085342_current_profile_mutation_boundary.sql"
SQL_CONTRACT = ROOT / "backend/supabase/tests/hosted_profile_convergence.sql"
VECTOR_TOOL = ROOT / "backend/supabase/scripts/g037_supabase_statement_vector.mjs"


def statement_vector(path: Path, version: str) -> tuple[int, str]:
    raw = path.read_bytes()
    result = subprocess.run(
        [
            "node",
            str(VECTOR_TOOL),
            "--source",
            str(path),
            "--version",
            version,
            "--sha256",
            hashlib.sha256(raw).hexdigest(),
            "--size",
            str(len(raw)),
        ],
        capture_output=True,
        check=True,
        text=True,
        timeout=30,
    )
    statements = json.loads(result.stdout)["statements"]
    statements_sha256 = hashlib.sha256(
        json.dumps(
            statements,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return len(statements), statements_sha256


def tagged(source: str, tag: str, occurrence: int = 0) -> str:
    matches = re.findall(rf"\${tag}\$(.*?)\${tag}\$", source, re.DOTALL)
    if len(matches) <= occurrence:
        raise AssertionError(f"missing ${tag}$ occurrence {occurrence}")
    return matches[occurrence]


def function_definition(source: str, name: str) -> str:
    match = re.search(
        rf"CREATE (?:OR REPLACE )?FUNCTION {re.escape(name)}\(.*?"
        rf"\nAS (\$[A-Za-z0-9_]*\$).*?\1;",
        source,
        re.DOTALL,
    )
    if match is None:
        raise AssertionError(f"missing function definition: {name}")
    return match.group(0)


class HostedProfileConvergenceSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.read_source = READ_MIGRATION.read_text(encoding="utf-8")
        cls.mutation_source = MUTATION_MIGRATION.read_text(encoding="utf-8")
        cls.canonical_read_source = CANONICAL_READ_MIGRATION.read_text(encoding="utf-8")
        cls.canonical_page_source = CANONICAL_PAGE_MIGRATION.read_text(encoding="utf-8")
        cls.canonical_mutation_source = CANONICAL_MUTATION_MIGRATION.read_text(encoding="utf-8")
        cls.sql_contract = SQL_CONTRACT.read_text(encoding="utf-8")

    def test_forward_only_order_and_cli_owned_transaction(self) -> None:
        self.assertLess(READ_MIGRATION.name, MUTATION_MIGRATION.name)
        for source in (self.read_source, self.mutation_source):
            self.assertNotRegex(source, r"(?m)^(?:BEGIN|COMMIT|ROLLBACK);$")
            for setting in (
                "SET LOCAL lock_timeout = '5s';",
                "SET LOCAL statement_timeout = '120s';",
                "SET LOCAL idle_in_transaction_session_timeout = '30s';",
            ):
                self.assertEqual(1, source.count(setting))
                self.assertLess(source.index(setting), source.index("pg_advisory_xact_lock"))
            self.assertIn("pg_catalog.pg_advisory_xact_lock(", source)
            self.assertNotIn("_tzudong_local", source)
            self.assertNotIn("20260804000300", source)
            self.assertNotRegex(
                source,
                r"(?is)(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?"
                r"supabase_migrations\.schema_migrations",
            )
            self.assertNotIn("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014", source)

    def test_read_migration_is_bound_to_exact_reconciled_predecessors(self) -> None:
        for version, name in (
            ("20260814010000", "hosted_g016_g041_catalog_reconciliation"),
            ("20260814010100", "hosted_runtime_boundary_convergence"),
        ):
            self.assertIn(f"('{version}', '{name}')", self.read_source)
        self.assertIn(
            "FROM supabase_migrations.schema_migrations\n  ) <> 52",
            self.read_source,
        )
        self.assertIn("migration.version >= '20260814010000'", self.read_source)
        self.assertIn("hosted_public_profile_read_predecessor_ledger_drift", self.read_source)
        self.assertIn("rolname = 'privacy_workflow_owner'", self.read_source)
        for attribute in (
            "NOT role_row.rolsuper",
            "NOT role_row.rolinherit",
            "NOT role_row.rolcreaterole",
            "NOT role_row.rolcreatedb",
            "NOT role_row.rolcanlogin",
            "NOT role_row.rolreplication",
            "NOT role_row.rolbypassrls",
        ):
            self.assertIn(attribute, self.read_source)

    def test_full_statement_vectors_are_chained_and_terminally_read_back(self) -> None:
        expected = (
            (
                FIRST_MIGRATION,
                "20260814010000",
                41,
                "e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8",
            ),
            (
                SECOND_MIGRATION,
                "20260814010100",
                140,
                "f1531c8479a872791a96ff5595459ef0adfa2f9b3104890d820c1fe4bea7dd07",
            ),
            (
                READ_MIGRATION,
                "20260814010200",
                57,
                "b29359016f9f53753af372bfb359251ebc71b94f94387f06f43e11b65cd6cea8",
            ),
            (
                MUTATION_MIGRATION,
                "20260814010300",
                53,
                "45ebe6eb8dca03cdf4915adcab394ab8b7389252f1f37913760830f82fb6d727",
            ),
        )
        for path, version, count, digest in expected:
            with self.subTest(version=version):
                self.assertEqual((count, digest), statement_vector(path, version))
                self.assertIn(digest, self.sql_contract)

        for digest in (expected[0][3], expected[1][3]):
            self.assertIn(digest, self.read_source)
            self.assertIn(digest, self.mutation_source)
        self.assertIn(expected[2][3], self.mutation_source)
        self.assertNotIn("REPLACE_WITH_", self.read_source)
        self.assertNotIn("REPLACE_WITH_", self.mutation_source)

    def test_public_profile_rpc_signatures_match_the_current_app_contract(self) -> None:
        expected = (
            "public.read_public_profile_summaries(uuid[])",
            "public.read_public_profile_leaderboard(text,integer)",
            "public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)",
        )
        for signature in expected:
            self.assertIn(signature, self.read_source)
            self.assertIn(signature, self.mutation_source)
        self.assertIn("CREATE FUNCTION public.read_public_profile_summaries(", self.read_source)
        self.assertIn("CREATE FUNCTION public.read_public_profile_leaderboard(", self.read_source)
        self.assertIn("CREATE FUNCTION public.read_public_profile_leaderboard_page(", self.read_source)
        self.assertNotIn("read_public_profile_leaderboard_page(text,integer,timestamptz", self.read_source)
        self.assertNotIn("compare_and_set_current_profile_avatar(text,text)", self.mutation_source)
        self.assertIn("ORDER BY scored.quality_score DESC, scored.user_id ASC", self.read_source)
        self.assertIn("scored.quality_score < p_after_quality_score", self.read_source)
        self.assertIn("scored.user_id > p_after_user_id", self.read_source)

    def test_rpc_and_signup_definitions_are_exact_canonical_terminal_sources(self) -> None:
        for name, canonical_source in (
            ("public.read_public_profile_summaries", self.canonical_read_source),
            ("public.read_public_profile_leaderboard", self.canonical_read_source),
            ("public.read_public_profile_leaderboard_page", self.canonical_page_source),
            ("public.handle_new_user", self.canonical_mutation_source),
            ("public.update_current_profile_nickname", self.canonical_mutation_source),
            (
                "public.compare_and_set_current_profile_avatar",
                self.canonical_mutation_source,
            ),
            ("public.read_signup_profile_state", self.canonical_mutation_source),
        ):
            hosted_source = (
                self.read_source
                if name.startswith("public.read_public_profile_")
                else self.mutation_source
            )
            with self.subTest(function=name):
                self.assertEqual(
                    function_definition(canonical_source, name),
                    function_definition(hosted_source, name),
                )

    def test_public_profile_functions_are_bounded_definers_with_exact_acl(self) -> None:
        self.assertGreaterEqual(self.read_source.count("SECURITY DEFINER"), 5)
        self.assertGreaterEqual(self.read_source.count("SET search_path = ''"), 5)
        self.assertIn("pg_catalog.cardinality(p_user_ids) NOT BETWEEN 1 AND 100", self.read_source)
        self.assertGreaterEqual(self.read_source.count("p_limit NOT BETWEEN 1 AND 100"), 2)
        self.assertIn("profile.nickname <> '탈퇴한 사용자'", self.read_source)
        self.assertIn("TO anon, authenticated", self.read_source)
        self.assertIn("'service_role', v_page, 'EXECUTE'", self.read_source)
        self.assertNotRegex(
            self.read_source,
            r"(?is)GRANT\s+[^;]*\s+ON\s+(?:TABLE\s+)?public\.profiles",
        )
        for invocation in (
            "SELECT privacy_retention.assert_g014_public_rpc_allowlist();",
            "SELECT privacy_retention.assert_g014_definer_contract();",
            "PERFORM privacy_retention.assert_g014_catalog_contract();",
        ):
            self.assertIn(invocation, self.read_source)
        for token in (
            "(v_summary, 'anon'::name, false)",
            "(v_summary, 'authenticated'::name, false)",
            "(v_leaderboard, 'anon'::name, false)",
            "(v_leaderboard, 'authenticated'::name, false)",
            "(v_page, 'anon'::name, false)",
            "(v_page, 'authenticated'::name, false)",
            "acl.grantee <> procedure.proowner",
            "4cb8958c9c9324fcd16aa9264fdebf6ef4e5e91493770ddf10d4c5c91d2e79f7",
            "23197c61bc37e7ba8366a3b6d99ea30f47812b520bcc0eaeb6712e54ea85a87e",
            "e8a132569e5ea419609003fdbeb2dcad6c8233d35584e850954e1d4488a62d19",
        ):
            self.assertIn(token, self.read_source)
        self.assertGreaterEqual(self.read_source.count("EXCEPT ALL"), 4)

    def test_g014_assertion_sources_follow_the_exact_staged_hash_chain(self) -> None:
        for digest in (
            "7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599",
            "c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025",
            "b82ac1cecc89fb5bebf07b55c1edaca9df31f5762f2cd6ab7373117e2a5390f5",
            "8691f4c440fd563552a8ab38f91a19e19595722e0de077ff6016c7033afd3b55",
            "ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9",
            "9d015ecd1afa1814a8c8139675e7e2fa7e45851c207faf37fa25a7c65e9103da",
        ):
            self.assertIn(digest, self.read_source)
        self.assertEqual(2, self.read_source.count("DO $definer_contract$"))
        self.assertEqual(2, self.read_source.count("DO $catalog_contract$"))
        self.assertEqual(
            4,
            self.read_source.count(
                "procedure.proacl IS NOT DISTINCT FROM v_acl"
            ),
        )

        for digest in (
            "ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9",
            "6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d",
            "9d015ecd1afa1814a8c8139675e7e2fa7e45851c207faf37fa25a7c65e9103da",
            "33440eb6b1311aeac7f8d84161e4cb4e3dfe71c589dbc548e1e4f64755cba405",
        ):
            self.assertIn(digest, self.mutation_source)
        self.assertEqual(1, self.mutation_source.count("DO $definer_contract$"))
        self.assertEqual(1, self.mutation_source.count("DO $catalog_contract$"))
        self.assertEqual(
            2,
            self.mutation_source.count(
                "procedure.proacl IS NOT DISTINCT FROM v_acl"
            ),
        )
        for tag in ("definer_anchor", "definer_replacement", "catalog_anchor", "catalog_replacement"):
            self.assertEqual(
                tagged(self.canonical_read_source, tag),
                tagged(self.read_source, tag),
            )
            self.assertEqual(
                tagged(self.canonical_page_source, tag),
                tagged(self.read_source, tag, occurrence=1),
            )
        for tag in (
            "definer_anchor",
            "definer_replacement",
            "catalog_definer_anchor",
            "catalog_definer_replacement",
            "catalog_matrix_anchor",
            "catalog_matrix_replacement",
        ):
            self.assertEqual(
                tagged(self.canonical_mutation_source, tag),
                tagged(self.mutation_source, tag),
            )

        for source, expected_minimum in (
            (self.read_source, 4),
            (self.mutation_source, 2),
        ):
            for token in (
                "NOT procedure.proleakproof",
                "procedure.proparallel = 'u'",
                "procedure.provolatile = 'v'",
                "procedure.prokind = 'f'",
                "'void'::pg_catalog.regtype",
                "VALUES ('privacy_workflow_owner'::name, false)",
                "pg_catalog.acldefault('f', procedure.proowner)",
            ):
                self.assertGreaterEqual(source.count(token), expected_minimum)

    def test_profile_and_review_relation_boundaries_are_exact(self) -> None:
        for source in (self.read_source, self.mutation_source, self.sql_contract):
            for token in (
                "relation_row.relowner = 'postgres'::pg_catalog.regrole",
                "relation_row.relrowsecurity",
                "relation_row.relforcerowsecurity",
                "'public.profiles'::pg_catalog.regclass::oid",
                "'public.reviews'::pg_catalog.regclass::oid",
                "'privacy_workflow_owner'::name",
                "'SELECT','UPDATE'",
                "'DELETE','SELECT'",
                "pg_catalog.acldefault('r', relation_row.relowner)",
                "SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl",
            ):
                self.assertIn(token, source)
        self.assertEqual(3, self.read_source.count("DO $profile_relation_"))
        self.assertEqual(2, self.mutation_source.count("DO $profile_relation_"))
        self.assertNotIn("acl.grantee <> relation_row.relowner", self.read_source)
        self.assertNotIn("acl.grantee <> relation_row.relowner", self.mutation_source)

    def test_mutation_migration_requires_read_terminal_before_lock_bound_changes(self) -> None:
        self.assertIn(
            "('20260814010200', 'hosted_public_profile_read_convergence')",
            self.mutation_source,
        )
        self.assertIn("migration.version >= '20260814010000'", self.mutation_source)
        self.assertIn(
            "FROM supabase_migrations.schema_migrations\n  ) <> 53",
            self.mutation_source,
        )
        self.assertIn(
            "hosted_current_profile_mutation_profile_read_predecessor_drift",
            self.mutation_source,
        )
        self.assertIn("CROSS JOIN LATERAL pg_catalog.aclexplode(", self.mutation_source)
        self.assertIn("('service_role'::name, false)", self.mutation_source)
        self.assertIn("SELECT * FROM actual EXCEPT SELECT * FROM expected", self.mutation_source)
        ledger_check = self.mutation_source.index(
            "hosted_current_profile_mutation_predecessor_ledger_drift"
        )
        first_table_lock = self.mutation_source.index("LOCK TABLE auth.users")
        destructive_change = self.mutation_source.index(
            "DROP CONSTRAINT profiles_nickname_key"
        )
        self.assertLess(ledger_check, first_table_lock)
        self.assertLess(ledger_check, destructive_change)
        self.assertIn("LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;", self.mutation_source)

    def test_profile_constraints_trigger_and_rpc_receipts_are_forward_only(self) -> None:
        for token in (
            "CREATE UNIQUE INDEX profiles_active_nickname_key",
            "WHERE nickname <> '탈퇴한 사용자'",
            "ADD CONSTRAINT profiles_avatar_url_octet_length_check",
            "pg_catalog.octet_length(avatar_url) <= 4096",
            "CREATE OR REPLACE FUNCTION public.handle_new_user()",
            "signup_profile_initialization_incomplete",
            "FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()",
            "CREATE FUNCTION public.update_current_profile_nickname(",
            "CREATE FUNCTION public.compare_and_set_current_profile_avatar(",
            "CREATE FUNCTION public.read_signup_profile_state(",
            "'PROFILE_NICKNAME_UPDATED'",
            "'PROFILE_VERSION_CONFLICT'",
            "'PROFILE_AVATAR_UPDATED'",
            "'SIGNUP_PROFILE_READY'",
            "'readback', pg_catalog.jsonb_build_object('passed', true)",
        ):
            self.assertIn(token, self.mutation_source)
        handle_new_user = re.search(
            r"CREATE OR REPLACE FUNCTION public\.handle_new_user\(\).*?"
            r"AS \$handle_new_user\$(.*?)\$handle_new_user\$;",
            self.mutation_source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(handle_new_user)
        handle_new_user_body = handle_new_user.group(1)
        self.assertNotIn("WHEN OTHERS", handle_new_user_body)
        self.assertNotIn("SQLERRM", handle_new_user_body)
        self.assertIn(
            "'profile-avatar://' || v_user_id::text || '/avatar-'",
            self.mutation_source,
        )

    def test_mutation_acl_and_service_only_signup_readback_are_exact(self) -> None:
        for signature, role in (
            ("public.update_current_profile_nickname(text)", "authenticated"),
            ("public.compare_and_set_current_profile_avatar(text, uuid)", "authenticated"),
            ("public.read_signup_profile_state(uuid, text)", "service_role"),
        ):
            self.assertIn(f"GRANT EXECUTE ON FUNCTION {signature}\n  TO {role};", self.mutation_source)
        self.assertIn("PERFORM privacy_retention.g014_require_service_role();", self.mutation_source)
        self.assertIn("pg_catalog.has_function_privilege('anon', v_signup, 'EXECUTE')", self.mutation_source)
        self.assertIn("'authenticated', v_signup, 'EXECUTE'", self.mutation_source)
        self.assertIn("'service_role', v_signup, 'EXECUTE'", self.mutation_source)
        self.assertNotRegex(
            self.mutation_source,
            r"(?is)GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*"
            r"ON\s+(?:TABLE\s+)?public\.profiles",
        )
        for token in (
            "(v_nickname, 'authenticated'::name, false)",
            "(v_avatar, 'authenticated'::name, false)",
            "(v_signup, 'service_role'::name, false)",
            "acl.grantee <> procedure.proowner",
            "procedure.oid = v_handle",
            "b64bf274daa16ce4d53b7845c39697e22c9d01cae1c5e95ed4f43a45f7a46c44",
            "d03a55a5187ec6a6fe38bdc6a2992ec6ac5448b3c573d241b754682f106f78ec",
            "7d8317d463ac7f79361b6944b326968c254522fb350f6004c2f74acb72a9762d",
            "de6b6688eefa025cfee0babdc4d12e1cd8b7c580810ab9c2f3be0270e85a86ea",
        ):
            self.assertIn(token, self.mutation_source)
        self.assertGreaterEqual(self.mutation_source.count("EXCEPT ALL"), 6)

    def test_role_switches_only_toggle_the_postgres_grantor_set_option(self) -> None:
        sources = (self.read_source, self.mutation_source)
        self.assertEqual(
            3,
            sum(
                source.count(
                    "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY %I"
                )
                for source in sources
            ),
        )
        self.assertEqual(6, self.read_source.count("'privacy_auth_bridge'::name"))
        self.assertEqual(3, self.mutation_source.count("'privacy_auth_bridge'::name"))
        self.assertEqual(
            3,
            sum(
                source.count(
                    "REVOKE SET OPTION FOR privacy_workflow_owner "
                    "FROM %I GRANTED BY %I"
                )
                for source in sources
            ),
        )
        for source in sources:
            for token in (
                "role_name, member_name, grantor_name",
                "'privacy_auth_bridge'::name",
                "false, true, false",
                "false, true, true",
                "true, false, false",
                "membership.roleid =",
                "OR membership.member =",
                "NOT role_row.rolsuper",
                "role_row.rolcreaterole",
                "pg_has_role('postgres', 'supabase_admin', 'MEMBER')",
                "pg_has_role('postgres', 'supabase_admin', 'USAGE')",
                "pg_has_role('postgres', 'supabase_admin', 'SET')",
            ):
                self.assertIn(token, source)
            for stale in (
                "v_membership_exists",
                "v_supports_set_option",
                "SELECT membership.set_option",
                "remove_owner_membership",
                "restore_owner_set_false",
                "REVOKE privacy_workflow_owner FROM",
                "GRANT privacy_workflow_owner TO %I WITH SET FALSE",
            ):
                self.assertNotIn(stale, source)

    def test_user_stats_security_boundary_is_exactly_read_back(self) -> None:
        contract = self.mutation_source[
            self.mutation_source.index("DO $contract_readback$") :
            self.mutation_source.index(
                "SELECT privacy_retention.assert_g014_public_rpc_allowlist();",
                self.mutation_source.index("DO $contract_readback$"),
            )
        ]
        for token in (
            "relation.relowner = 'postgres'::pg_catalog.regrole",
            "relation.relrowsecurity",
            "relation.relforcerowsecurity",
            "CROSS JOIN LATERAL pg_catalog.aclexplode(",
            "('privacy_workflow_owner'::name, 'DELETE'::text, false)",
            "('privacy_workflow_owner'::name, 'SELECT'::text, false)",
            "('postgres'::name, 'MAINTAIN'::text, false)",
            "('service_role'::name, 'MAINTAIN'::text, false)",
            "policy.polcmd AS command",
            "pg_catalog.unnest(policy.polroles)",
            "policy.polqual, policy.polrelid, false",
            "policy.polwithcheck, policy.polrelid, false",
            "policy.polpermissive AS permissive",
            "'User stats are viewable by everyone'::name",
            "'g014_account_deletion_source_access'::name",
            "'g014_privacy_workflow_owner_access'::name",
            "hosted_current_profile_mutation_user_stats_rls_readback_drift",
            "hosted_current_profile_mutation_user_stats_acl_readback_drift",
            "hosted_current_profile_mutation_user_stats_policy_readback_drift",
        ):
            self.assertIn(token, contract)
        self.assertNotIn("acl.grantee <> relation.relowner", contract)
        self.assertEqual(6, contract.count("EXCEPT ALL"))
        self.assertNotIn(
            "has_table_privilege(\n       'privacy_workflow_owner', "
            "'public.user_stats'",
            contract,
        )
        self.assertLess(
            self.mutation_source.index(
                "CREATE POLICY g014_privacy_workflow_owner_access"
            ),
            self.mutation_source.index(
                "hosted_current_profile_mutation_user_stats_policy_readback_drift"
            ),
        )

    def test_sql_contract_is_catalog_only_and_rollback_scoped(self) -> None:
        self.assertTrue(self.sql_contract.startswith("BEGIN;\n"))
        self.assertTrue(self.sql_contract.rstrip().endswith("ROLLBACK;"))
        for signature in (
            "public.read_public_profile_summaries(uuid[])",
            "public.read_public_profile_leaderboard(text,integer)",
            "public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)",
            "public.update_current_profile_nickname(text)",
            "public.compare_and_set_current_profile_avatar(text,uuid)",
            "public.read_signup_profile_state(uuid,text)",
        ):
            self.assertIn(signature, self.sql_contract)
        self.assertIn("migration.version::text >= '20260814010000'", self.sql_contract)
        self.assertIn("hosted_profile_contract_statement_vector_drift", self.sql_contract)
        for token in (
            "ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4",
            "pg_catalog.json_agg(",
            "pg_catalog.json_build_array(",
            "migration.version::text < '20260814010000'",
            "migration.statements IS NULL",
            "pg_catalog.cardinality(migration.statements) = 0",
            "hosted_profile_contract_predecessor_statement_root_drift",
            "hosted_profile_contract_user_stats_rls_drift",
            "hosted_profile_contract_user_stats_acl_drift",
            "hosted_profile_contract_user_stats_policy_drift",
            "hosted_profile_contract_signup_trigger_acl_drift",
            "relation.relforcerowsecurity",
            "CROSS JOIN LATERAL pg_catalog.aclexplode(",
            "policy.polpermissive AS permissive",
            "4cb8958c9c9324fcd16aa9264fdebf6ef4e5e91493770ddf10d4c5c91d2e79f7",
            "23197c61bc37e7ba8366a3b6d99ea30f47812b520bcc0eaeb6712e54ea85a87e",
            "e8a132569e5ea419609003fdbeb2dcad6c8233d35584e850954e1d4488a62d19",
            "b64bf274daa16ce4d53b7845c39697e22c9d01cae1c5e95ed4f43a45f7a46c44",
            "d03a55a5187ec6a6fe38bdc6a2992ec6ac5448b3c573d241b754682f106f78ec",
            "7d8317d463ac7f79361b6944b326968c254522fb350f6004c2f74acb72a9762d",
            "de6b6688eefa025cfee0babdc4d12e1cd8b7c580810ab9c2f3be0270e85a86ea",
        ):
            self.assertIn(token, self.sql_contract)
        self.assertGreaterEqual(self.sql_contract.count("EXCEPT ALL"), 6)
        self.assertNotRegex(
            self.sql_contract,
            r"(?im)^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b",
        )


if __name__ == "__main__":
    unittest.main()
