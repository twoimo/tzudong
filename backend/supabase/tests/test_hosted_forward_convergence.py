"""Static source contracts for the hosted-only forward convergence pair."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
FIRST = MIGRATIONS / "20260814010000_hosted_g016_g041_catalog_reconciliation.sql"
SECOND = MIGRATIONS / "20260814010100_hosted_runtime_boundary_convergence.sql"
THIRD = MIGRATIONS / "20260814010200_hosted_public_profile_read_convergence.sql"
FOURTH = MIGRATIONS / "20260814010300_hosted_current_profile_mutation.sql"
TERMINAL_READBACK = (
    ROOT / "backend/supabase/tests/hosted_forward_convergence_readback.sql"
)
VECTOR_TOOL = ROOT / "backend/supabase/scripts/g037_supabase_statement_vector.mjs"


def parsed_statements(path: Path, version: str) -> list[str]:
    data = path.read_bytes()
    result = subprocess.run(
        [
            "node",
            str(VECTOR_TOOL),
            "--source",
            str(path),
            "--version",
            version,
            "--sha256",
            hashlib.sha256(data).hexdigest(),
            "--size",
            str(len(data)),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    return json.loads(result.stdout)["statements"]


class HostedForwardConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.first = FIRST.read_text(encoding="utf-8")
        cls.second = SECOND.read_text(encoding="utf-8")
        cls.terminal_readback = TERMINAL_READBACK.read_text(encoding="utf-8")

    def test_names_order_and_cli_implicit_transaction_contract(self) -> None:
        self.assertLess(FIRST.name, SECOND.name)
        for source in (self.first, self.second):
            self.assertEqual(1, source.count("SET LOCAL lock_timeout = '5s';"))
            self.assertEqual(1, source.count("SET LOCAL statement_timeout = '120s';"))
            self.assertEqual(
                1,
                source.count("SET LOCAL idle_in_transaction_session_timeout = '30s';"),
            )
            stripped = re.sub(r"--[^\n]*|/\*.*?\*/", "", source, flags=re.S)
            self.assertNotRegex(stripped, r"(?im)^\s*(BEGIN|COMMIT|ROLLBACK)\s*;")
            self.assertNotRegex(
                stripped,
                r"(?is)\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"
                r"supabase_migrations\.schema_migrations\b",
            )

    def test_first_binds_exact_hosted_50_collision_and_full_hashes(self) -> None:
        self.assertIn(") <> 50 THEN", self.first)
        self.assertIn("g041_privacy_eligibility_auth_boundary", self.first)
        self.assertIn(") <> 7", self.first)
        required = {
            "ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4",
            "c7c33f0f76e5b3a949e48af75d117104ce15bbe5c9a37d34ea98dff8e10d2547",
            "ccaf453fb015baaf69e8aa5c33a563406a83f72c5ba20791d6fc637f84f96d27",
            "3e5d9508cecee2ae37be085646879e683c17576cb49a175e124a47038831bf45",
            "21c64036761984944707abbbd5740c9466ab3d4af46995624d57ff9113010ad6",
            "c525ffdb57c558f34374313330f9404ba6ed399b13b8d48486848c8a95ef1003",
            "5c3a92cf51a592ac8b5a00193f40d161170c672bb592e4a037625712ee4270d8",
            "f23203a0d27fc2d51b73a87df87c86288b052614b7035b93675656c89223d203",
            "e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67",
            "9f5b15cc3d0c0b11d39053759409ce359ae8acda3669ed0b1dc40ee6612ef73d",
        }
        self.assertTrue(required.issubset(set(re.findall(r"[a-f0-9]{64}", self.first))))
        self.assertNotIn("pg_catalog.left(v_source_sha256", self.first)
        source_hash_region = self.first[
            self.first.index("DO $catalog_preflight$") :
            self.first.index("DO $membership$")
        ]
        self.assertNotRegex(source_hash_region, r"'(?=[a-f0-9]{8}')[a-f0-9]{8}'")
        self.assertNotIn(
            "CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_", self.first
        )
        self.assertIn("pg_catalog.json_agg(", self.first)
        self.assertIn("pg_catalog.json_build_array(", self.first)
        self.assertIn("WHERE statements IS NULL\n     ) <> 0", self.first)
        self.assertIn("WHERE pg_catalog.cardinality(statements) = 0\n     ) <> 7", self.first)

    def test_first_exact_acl_and_membership_cleanup_are_bidirectional(self) -> None:
        self.assertGreaterEqual(self.first.count("pg_catalog.aclexplode("), 4)
        self.assertIn("acl.is_grantable", self.first)
        self.assertIn("hosted_g016_g041_function_acl_prerequisite_drift", self.first)
        self.assertIn("hosted_g016_g041_function_acl_readback_drift", self.first)
        self.assertIn("hosted_g016_g041_vector_helper_acl_readback_drift", self.first)
        for signature in (
            "public.cosine_distance(halfvec,halfvec)",
            "public.cosine_distance(sparsevec,sparsevec)",
            "public.cosine_distance(vector,vector)",
            "public.l1_distance(halfvec,halfvec)",
            "public.l1_distance(sparsevec,sparsevec)",
            "public.l1_distance(vector,vector)",
            "public.vector_negative_inner_product(vector,vector)",
        ):
            self.assertEqual(2, self.first.count(signature))
        for metadata in (
            "procedure.proowner <> 'supabase_admin'::pg_catalog.regrole",
            "procedure.provolatile <> 'i'",
            "procedure.proparallel <> 's'",
            "procedure.prorettype <> 'double precision'::pg_catalog.regtype",
            "WHERE language.lanname = 'c'",
        ):
            self.assertEqual(2, self.first.count(metadata))
        self.assertEqual(2, self.first.count("('postgres'::name, false)"))
        self.assertEqual(2, self.first.count("('supabase_admin'::name, false)"))
        self.assertNotIn("DO $extension_helpers$", self.first)
        self.assertNotIn("REVOKE EXECUTE ON FUNCTION %s", self.first)
        self.assertIn("provider-owned by supabase_admin", self.first)
        self.assertEqual(
            3,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'supabase_admin'::name,\s*true,\s*false,\s*false",
                self.first,
            )),
        )
        self.assertEqual(
            2,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*false",
                self.first,
            )),
        )
        self.assertEqual(
            1,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*true",
                self.first,
            )),
        )
        self.assertEqual(
            3,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'privacy_auth_bridge'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*true",
                self.first,
            )),
        )
        self.assertIn(
            "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY %I",
            self.first,
        )
        self.assertIn(
            "REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I",
            self.first,
        )
        self.assertNotIn("hosted_g016_g041.remove_membership", self.first)
        self.assertNotIn("hosted_g016_g041.restore_set_false", self.first)
        self.assertEqual(2, self.first.count("v_expected_grantees name[];"))
        self.assertNotIn("v_expected_grantees text[];", self.first)
        for metadata_clause in (
            "procedure.provolatile = v_expected.volatility",
            "WHERE language.lanname = 'plpgsql'",
            "procedure.prorettype = v_expected.return_type",
            "AND NOT procedure.proretset",
            "procedure.prokind = 'f'",
            "AND NOT procedure.proleakproof",
            "procedure.proparallel = 'u'",
        ):
            self.assertEqual(2, self.first.count(metadata_clause))
        self.assertIn("hosted_g016_g041_membership_prerequisite_drift", self.first)
        self.assertIn("hosted_g016_g041_membership_acquire_drift", self.first)
        self.assertEqual(
            1,
            self.first.count("hosted_g016_g041_membership_restore_drift"),
        )
        self.assertEqual(3, self.first.count("role_name, member_name, grantor_name"))
        self.assertEqual(3, self.first.count("OR membership.member ="))
        self.assertNotIn("membership.member IN (", self.first)

    def test_first_reconciles_only_forward_bodies_and_never_replays_files(self) -> None:
        for forbidden in (
            "\\i ",
            "20260801000300_g016_onboarding_allowlist_freshness.sql",
            "20260804000300_g041_auth_boundary_runtime_repairs.sql",
            "GRANT SELECT, UPDATE ON TABLE public.release_auth_session_leases",
        ):
            self.assertNotIn(forbidden, self.first)
        self.assertEqual(
            1,
            self.first.count(
                "CREATE OR REPLACE FUNCTION privacy_retention.g016_reattest_privacy_onboarding("
            ),
        )
        for function_name in (
            "get_current_privacy_eligibility",
            "get_privacy_eligibility_for_user",
            "get_current_auth_session_id",
            "is_current_auth_session_active",
        ):
            self.assertEqual(
                1,
                self.first.count(f"CREATE OR REPLACE FUNCTION public.{function_name}"),
            )

    def test_second_binds_exact_51_and_frozen_first_statement_vector(self) -> None:
        statements = parsed_statements(FIRST, "20260814010000")
        vector_hash = hashlib.sha256(
            json.dumps(statements, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
        self.assertEqual(41, len(statements))
        self.assertEqual(
            "e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8",
            vector_hash,
        )
        self.assertIn("<> 51", self.second)
        self.assertIn("<> 41", self.second)
        self.assertIn(vector_hash, self.second)
        self.assertIn("hosted_g016_g041_catalog_reconciliation", self.second)

    def test_second_is_forward_only_bounded_and_no_broadening(self) -> None:
        self.assertNotIn("REPLACE_WITH_", self.second)
        self.assertNotIn("\\i ", self.second)
        self.assertNotRegex(self.second, r"(?i)GRANT\s+ALL\s+ON")
        self.assertNotRegex(self.second, r"(?i)GRANT\s+EXECUTE[^;]+TO\s+PUBLIC")
        self.assertNotRegex(self.second, r"(?i)GRANT\s+(?:INSERT|UPDATE|DELETE)[^;]+TO\s+anon")
        self.assertIn("f5b6b36fd8394c8151406b42cabbd47301d23c092828129262cfc8ccab4f36d3", self.second)
        self.assertIn("CREATE TABLE public.admin_storyboard_jobs", self.second)
        self.assertIn("CREATE TABLE public.youtube_thumbnail_releases", self.second)
        self.assertIn("CREATE FUNCTION public.is_current_user_active_admin()", self.second)
        self.assertIn("CREATE OR REPLACE FUNCTION public.apply_admin_restaurant_map_overlay_action", self.second)
        self.assertIn("SELECT privacy_retention.assert_g014_public_rpc_allowlist();", self.second)
        self.assertIn("privacy_workflow_owner', 'public.profiles', 'SELECT", self.second)
        self.assertIn("privacy_workflow_owner', 'public.reviews', 'SELECT", self.second)

    def test_second_preserves_g014_assertion_identity_contract(self) -> None:
        for signature in (
            "privacy_retention.assert_g014_public_rpc_allowlist()",
            "privacy_retention.assert_g014_definer_contract()",
            "privacy_retention.assert_g014_catalog_contract()",
        ):
            self.assertIn(signature, self.second)
        self.assertNotIn(
            "CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_", self.second
        )
        self.assertIn("AND prosecdef", self.second)
        self.assertIn("ARRAY['search_path=\"\"']::text[]", self.second)
        for digest in (
            "e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67",
            "7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599",
            "9f5b15cc3d0c0b11d39053759409ce359ae8acda3669ed0b1dc40ee6612ef73d",
            "b82ac1cecc89fb5bebf07b55c1edaca9df31f5762f2cd6ab7373117e2a5390f5",
        ):
            self.assertIn(digest, self.second)
        definer_patch = self.second[
            self.second.index("DO $definer_contract_convergence$") :
            self.second.index("DO $catalog_contract_convergence$")
        ]
        catalog_patch = self.second[
            self.second.index("DO $catalog_contract_convergence$") :
            self.second.index("SELECT privacy_retention.assert_g014_public_rpc_allowlist();")
        ]
        self.assertIn("WHERE procedure.oid = v_oid;", definer_patch)
        self.assertNotIn("WHERE procedure.oid = v_procedure;", definer_patch)
        self.assertIn("WHERE procedure.oid = v_procedure", catalog_patch)
        self.assertNotIn("WHERE procedure.oid = v_oid;", catalog_patch)

    def test_second_exact_acl_readback_never_assumes_owner_grant_option(self) -> None:
        self.assertGreaterEqual(
            self.second.count("SELECT grantee, false AS is_grantable"),
            2,
        )
        self.assertNotIn(
            "grantee = 'privacy_workflow_owner'::name",
            self.second,
        )
        self.assertGreaterEqual(self.second.count("pg_catalog.aclexplode("), 2)
        for digest in (
            "40e35587fad6e34c4f124d41d536bdc6c8a39f31686c33fb308256b6c110e409",
            "9879b4b5f2e0aec97a1725bf31f565a07a28eadec0c1100716f5b545b4ebcfdb",
            "fa01f64f3bbe45c244fa018e1cac140004b195f9de2dcfb6a617552bd4dd592b",
            "15c1bb46db8620bfac36004dfbcef653a288daf51b864223de6112f5eac92521",
            "8e26866583fbc55cb15c6b916bb7d0fa19397660393380dd06dfdb6b5eb57e09",
            "3b8496725033f1e785b6f35739a4cfe7a0a0d72f51f5089faede61aa39f70d8a",
            "d9e432b58fa728fce8a12fa1cb6f670d4f5175957f1bf8d4814db1ab2565b7a3",
            "714dbcc44aa918270ff742f837287407be7af98df48d4598037c9fbcaf279d61",
            "054fc22e57851ddb50935b75db9cd96e7224f5418a22da806de0b27c761999b0",
        ):
            self.assertIn(digest, self.second)
        self.assertIn("hosted_runtime_existing_function_identity_drift", self.second)
        self.assertIn("hosted_runtime_function_readback_drift", self.second)
        self.assertIn("hosted_runtime_g014_definer_acl_readback_drift", self.second)
        self.assertIn("hosted_runtime_g014_catalog_acl_readback_drift", self.second)
        self.assertGreaterEqual(
            self.second.count("VALUES ('privacy_workflow_owner'::name, false)"),
            4,
        )
        self.assertGreaterEqual(self.second.count("AND NOT proleakproof"), 4)
        self.assertGreaterEqual(self.second.count("AND proparallel = 'u'"), 4)
        for metadata in (
            "procedure.prokind = 'f'",
            "NOT procedure.proleakproof",
            "procedure.proparallel = 'u'",
            "procedure.prorettype = v_expected.return_type",
            "procedure.proretset = v_expected.returns_set",
        ):
            self.assertGreaterEqual(self.second.count(metadata), 2)
        self.assertIn("WHERE language.lanname = v_expected.language_name", self.second)

    def test_second_positive_table_readback_is_all_not_any(self) -> None:
        for relation, privileges in (
            (
                "public.admin_storyboard_jobs",
                ("SELECT", "INSERT", "UPDATE", "DELETE"),
            ),
            (
                "public.youtube_thumbnail_releases",
                ("SELECT", "INSERT", "UPDATE", "DELETE"),
            ),
            (
                "public.admin_restaurant_map_overlays",
                ("SELECT", "INSERT", "UPDATE"),
            ),
            (
                "public.admin_restaurant_map_overlay_audit_events",
                ("SELECT", "INSERT"),
            ),
        ):
            for privilege in privileges:
                self.assertRegex(
                    self.second,
                    rf"NOT pg_catalog\.has_table_privilege\(\s*"
                    rf"'[^']+',\s*'{re.escape(relation)}',\s*"
                    rf"'{privilege}'\s*\)",
                )
            self.assertNotRegex(
                self.second,
                rf"NOT pg_catalog\.has_table_privilege\(\s*"
                rf"'[^']+',\s*'{re.escape(relation)}',\s*'[^']*,[^']*'",
            )

    def test_second_policy_readback_pins_dependencies_and_exact_shapes(self) -> None:
        self.assertIn("v_helper_policy_count <> 26", self.second)
        self.assertIn("expected.helper_dependency_count", self.second)
        self.assertIn("expected.uid_dependency_count", self.second)
        self.assertIn("v_legacy_dependency_count <> 0", self.second)
        self.assertIn("v_using <> v_admin_expression", self.second)
        self.assertIn("v_check <> v_admin_expression", self.second)
        self.assertIn("hosted_runtime_caller_policy_contract_drift", self.second)
        self.assertIn("hosted_runtime_storage_policy_definition_drift", self.second)
        self.assertNotRegex(
            self.second,
            r"has_table_privilege\([^)]*'[^']*,[^']*'\s*\)",
        )
        self.assertIn("hosted_runtime_new_table_policy_readback_drift", self.second)
        self.assertIn("relation_row.relowner = 'postgres'::pg_catalog.regrole", self.second)
        self.assertGreaterEqual(self.second.count("relation_row.relrowsecurity"), 2)
        self.assertGreaterEqual(self.second.count("NOT relation_row.relforcerowsecurity"), 2)
        self.assertIn("ARRAY['service_role']::name[]", self.second)
        self.assertIn("'(auth.role() = ''service_role''::text)'::text", self.second)
        self.assertIn("'public.youtube_thumbnail_releases'::pg_catalog.regclass", self.second)
        for digest in (
            "c13b66bec94eb7fedaae8796692ca4b6203a6dd07fe7059345ce295f44c87bdb",
            "5b93b69ec67fe24f5884d4483a16a3a388a1fd58ee81f397ac5169c6e4d48c07",
            "8fa3aaf48874ee4ea016ad6b6371ab0c3ba13d0f3c68cc8286ce10cd3d7b5920",
            "1750cb7027fc3774ebcfad9b2159da5b9025ac6dea6c662b06c95050b1fb731e",
        ):
            self.assertIn(digest, self.second)

    def test_second_membership_is_restored_without_admin_option(self) -> None:
        self.assertIn("hosted_runtime_membership_prerequisite_drift", self.second)
        self.assertIn("hosted_runtime_membership_acquire_drift", self.second)
        self.assertEqual(
            3,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'supabase_admin'::name,\s*true,\s*false,\s*false",
                self.second,
            )),
        )
        self.assertEqual(
            2,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*false",
                self.second,
            )),
        )
        self.assertEqual(
            1,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'postgres'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*true",
                self.second,
            )),
        )
        self.assertEqual(
            3,
            len(re.findall(
                r"'privacy_workflow_owner'::name,\s*'privacy_auth_bridge'::name,\s*"
                r"'postgres'::name,\s*false,\s*true,\s*true",
                self.second,
            )),
        )
        self.assertIn(
            "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY %I",
            self.second,
        )
        self.assertIn(
            "REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I",
            self.second,
        )
        self.assertEqual(1, self.second.count("hosted_runtime_membership_restore_drift"))
        self.assertNotIn("hosted_runtime.remove_membership", self.second)
        self.assertNotIn("hosted_runtime.restore_set_false", self.second)
        self.assertEqual(3, self.second.count("role_name, member_name, grantor_name"))
        self.assertEqual(3, self.second.count("OR membership.member ="))
        self.assertNotIn("membership.member IN (", self.second)

    def test_second_profiles_and_reviews_are_exact_pre_and_post(self) -> None:
        self.assertIn(
            "hosted_runtime_profile_relation_prerequisite_drift", self.second
        )
        self.assertIn("hosted_runtime_profile_relation_readback_drift", self.second)
        self.assertEqual(4, self.second.count("relation_row.relforcerowsecurity"))
        self.assertEqual(
            6,
            self.second.count(
                "'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',\n"
                "               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'"
            ),
        )
        self.assertEqual(
            2,
            self.second.count("ARRAY['SELECT', 'UPDATE']::text[]"),
        )
        self.assertEqual(
            2,
            self.second.count("ARRAY['DELETE', 'SELECT']::text[]"),
        )

    def test_pinned_parser_accepts_both_files(self) -> None:
        self.assertGreater(len(parsed_statements(FIRST, "20260814010000")), 0)
        self.assertGreater(len(parsed_statements(SECOND, "20260814010100")), 0)

    def test_terminal_readback_binds_all_four_exact_statement_vectors(self) -> None:
        expected = (
            (
                FIRST,
                "20260814010000",
                "hosted_g016_g041_catalog_reconciliation",
                41,
                "e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8",
            ),
            (
                SECOND,
                "20260814010100",
                "hosted_runtime_boundary_convergence",
                140,
                "f1531c8479a872791a96ff5595459ef0adfa2f9b3104890d820c1fe4bea7dd07",
            ),
            (
                THIRD,
                "20260814010200",
                "hosted_public_profile_read_convergence",
                57,
                "b29359016f9f53753af372bfb359251ebc71b94f94387f06f43e11b65cd6cea8",
            ),
            (
                FOURTH,
                "20260814010300",
                "hosted_current_profile_mutation",
                53,
                "45ebe6eb8dca03cdf4915adcab394ab8b7389252f1f37913760830f82fb6d727",
            ),
        )
        for path, version, name, count, digest in expected:
            with self.subTest(version=version):
                statements = parsed_statements(path, version)
                actual_digest = hashlib.sha256(
                    json.dumps(
                        statements,
                        # PostgreSQL to_json(text[]) emits UTF-8 characters
                        # directly; ensure_ascii=False preserves those exact
                        # bytes for the hosted ledger vector contract.
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode()
                ).hexdigest()
                self.assertEqual((count, digest), (len(statements), actual_digest))
                self.assertIn(f"('{version}', '{name}')", self.terminal_readback)
                self.assertIn(digest, self.terminal_readback)
        self.assertIn("<> 54", self.terminal_readback)
        self.assertIn(
            "ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4",
            self.terminal_readback,
        )
        self.assertIn(
            "migration.version::text < '20260814010000'",
            self.terminal_readback,
        )
        self.assertIn("migration.statements IS NULL", self.terminal_readback)
        self.assertIn(
            "pg_catalog.cardinality(migration.statements) = 0",
            self.terminal_readback,
        )
        self.assertIn("pg_catalog.cardinality(migration.statements)", self.terminal_readback)
        self.assertIn("pg_catalog.to_json(migration.statements)::text", self.terminal_readback)


if __name__ == "__main__":
    unittest.main()
