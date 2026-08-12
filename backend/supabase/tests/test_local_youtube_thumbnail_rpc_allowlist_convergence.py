import hashlib
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "backend/supabase/migrations"
RETENTION_MIGRATION = (
    MIGRATIONS / "20260713002400_g014_retention_adapters_receipts.sql"
)
CATALOG_MIGRATION = MIGRATIONS / "20260713002500_g014_catalog_contract.sql"
AUTH_BRIDGE_MIGRATION = MIGRATIONS / "20260804000500_g041_auth_workflow_bridge.sql"
CORRECTION = (
    MIGRATIONS
    / "20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql"
)

SIGNATURE = (
    "public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,"
    "text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)"
)
APPLIED_LOCAL_MIGRATION_HASHES = {
    "20260713002400_g014_retention_adapters_receipts.sql": (
        "3b89edc7ffe96a770d1f537267546c6229c823fc3c2d9b4c036ff008ca7c0b94"
    ),
    "20260713002500_g014_catalog_contract.sql": (
        "808532b79fdc20d1c12a71c7988954188c7fe1d91bbfe4b7d47d9da458615838"
    ),
    "20260812000100_local_runtime_schema_convergence.sql": (
        "47a0a8376479de44ed6b92d14403d2b6868ac357aa41005c595ad6f8a16d1f0d"
    ),
    "20260812000200_local_public_read_policy_convergence.sql": (
        "e847ea7898c9ff77748d65c94c3dc04747ef0b1bbf8ac12ed623bbfc8c5e6233"
    ),
    "20260812000300_local_admin_data_boundary_convergence.sql": (
        "b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf"
    ),
    "20260812000400_local_admin_map_overlay_boundary_convergence.sql": (
        "f61595514b4218bfa47e3fb5c529f648fe4d16efef1f5ef02f216aff6dd08bcb"
    ),
}
DECLARED_INVOKERS = [
    (
        "public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,"
        "double precision,integer,integer,jsonb)"
    ),
    (
        "public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,"
        "double precision,integer,integer,jsonb)"
    ),
    (
        "public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,"
        "double precision,integer,integer,jsonb)"
    ),
    (
        "public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,"
        "double precision,integer,integer,jsonb)"
    ),
    "public.ocr_log_metadata_is_safe(jsonb)",
    "public.is_current_user_active_admin()",
    SIGNATURE,
]


def tagged(source: str, tag: str) -> str:
    match = re.search(rf"\${tag}\$(.*?)\${tag}\$", source, re.DOTALL)
    if match is None:
        raise AssertionError(f"missing ${tag}$ block")
    return match.group(1)


def catalog_source_after_g041(catalog: str, auth_bridge: str) -> str:
    match = re.search(
        r"CREATE OR REPLACE FUNCTION "
        r"privacy_retention\.assert_g014_catalog_contract\(\).*?"
        r"AS \$function\$(.*?)\$function\$;",
        catalog,
        re.DOTALL,
    )
    if match is None:
        raise AssertionError("missing frozen G014 catalog function")
    source = match.group(1)
    for before, after in (
        ("helper_predicate", "helper_replacement"),
        ("rpc_predicate", "rpc_replacement"),
    ):
        old = tagged(auth_bridge, before)
        new = tagged(auth_bridge, after)
        if source.count(old) != 1 or new in source:
            raise AssertionError("G041 owner correction source drifted")
        source = source.replace(old, new)
    return source


def definer_source_after_g041(retention: str, auth_bridge: str) -> str:
    match = re.search(
        r"CREATE OR REPLACE FUNCTION "
        r"privacy_retention\.assert_g014_definer_contract\(\).*?"
        r"AS \$function\$(.*?)\$function\$;",
        retention,
        re.DOTALL,
    )
    if match is None:
        raise AssertionError("missing frozen G014 definer function")
    source = match.group(1)
    old = tagged(auth_bridge, "definer_predicate")
    new = tagged(auth_bridge, "definer_replacement")
    if source.count(old) != 1 or new in source:
        raise AssertionError("G041 definer owner correction source drifted")
    return source.replace(old, new)


def apply_frozen_correction(source: str, correction: str) -> str:
    catalog_correction = correction[correction.index("DO $catalog_contract$") :]
    hashes = re.findall(
        r"v_expected_source_sha256_(?:before|after) constant text :=\n"
        r"\s+'([0-9a-f]{64})'",
        catalog_correction,
    )
    if len(hashes) != 2:
        raise AssertionError("correction source hashes drifted")
    anchor = tagged(catalog_correction, "invoker_anchor")
    replacement = tagged(catalog_correction, "invoker_replacement")
    if hashlib.sha256(source.encode()).hexdigest() != hashes[0]:
        raise AssertionError("pre-correction source hash drifted")
    if source.count(anchor) != 1:
        raise AssertionError("correction anchor drifted")
    corrected = source.replace(anchor, replacement)
    if hashlib.sha256(corrected.encode()).hexdigest() != hashes[1]:
        raise AssertionError("post-correction source hash drifted")
    return corrected


def apply_frozen_definer_correction(source: str, correction: str) -> str:
    source_hash = hashlib.sha256(source.encode()).hexdigest()
    expected_before = {
        "fae34d72db537f15f2e87c304ef2c06e960068942908551fa39bb7dbe2655277": (
            "definer_invoker_anchor_extensions"
        ),
        "e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67": (
            "definer_invoker_anchor_public"
        ),
    }
    if source_hash not in expected_before:
        raise AssertionError("pre-definer-correction source hash drifted")
    anchor = tagged(correction, expected_before[source_hash])
    replacement = tagged(correction, "definer_invoker_replacement")
    if source.count(anchor) != 1:
        raise AssertionError("definer correction anchor drifted")
    corrected = source.replace(anchor, replacement)
    if hashlib.sha256(corrected.encode()).hexdigest() != (
        "7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599"
    ):
        raise AssertionError("post-definer-correction source hash drifted")
    return corrected


class LocalYoutubeThumbnailRpcAllowlistConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.retention = RETENTION_MIGRATION.read_text(encoding="utf-8")
        cls.catalog = CATALOG_MIGRATION.read_text(encoding="utf-8")
        cls.auth_bridge = AUTH_BRIDGE_MIGRATION.read_text(encoding="utf-8")
        cls.correction = CORRECTION.read_text(encoding="utf-8")
        cls.pre_source = catalog_source_after_g041(cls.catalog, cls.auth_bridge)
        cls.post_source = apply_frozen_correction(
            cls.pre_source,
            cls.correction,
        )
        cls.pre_definer_extensions = definer_source_after_g041(
            cls.retention,
            cls.auth_bridge,
        )
        cls.pre_definer_public = cls.pre_definer_extensions.replace(
            "extensions.vector",
            "public.vector",
        )
        cls.post_definer_extensions = apply_frozen_definer_correction(
            cls.pre_definer_extensions,
            cls.correction,
        )
        cls.post_definer_public = apply_frozen_definer_correction(
            cls.pre_definer_public,
            cls.correction,
        )

    def test_applied_local_migrations_remain_byte_identical(self) -> None:
        for filename, expected_hash in APPLIED_LOCAL_MIGRATION_HASHES.items():
            with self.subTest(filename=filename):
                self.assertEqual(
                    hashlib.sha256((MIGRATIONS / filename).read_bytes()).hexdigest(),
                    expected_hash,
                )

    def test_correction_is_the_only_005_migration(self) -> None:
        self.assertTrue(CORRECTION.is_file())
        self.assertEqual(
            [path.name for path in MIGRATIONS.glob("20260812000500*.sql")],
            [CORRECTION.name],
        )
        self.assertRegex(self.correction, r"(?s)^--.*?\n\nBEGIN;\n")
        self.assertTrue(self.correction.endswith("\nCOMMIT;\n"))
        self.assertEqual(self.correction.count("\nBEGIN;\n"), 1)
        self.assertEqual(self.correction.count("\nCOMMIT;\n"), 1)

    def test_exact_rpc_catalog_and_one_row_allowlist_contract_are_bound(self) -> None:
        self.assertIn("procedure.proargtypes::text", self.correction)
        self.assertIn("v_function.pronargs <> 16", self.correction)
        self.assertIn("v_named_overloads <> 1", self.correction)
        self.assertIn("'public.youtube_thumbnail_releases'::pg_catalog.regtype", self.correction)
        self.assertIn("v_function.prosecdef IS DISTINCT FROM false", self.correction)
        self.assertRegex(
            self.correction,
            r"v_function\.owner_name NOT IN \(\n"
            r"\s+'postgres',\n\s+'supabase_admin'\n\s+\)",
        )
        self.assertNotRegex(
            self.correction,
            r"v_function\.owner_name NOT IN \([^)]*privacy_workflow_owner",
        )
        self.assertIn(
            "ALTER FUNCTION public.publish_youtube_thumbnail_release(",
            self.correction,
        )
        self.assertIn("OWNER TO privacy_workflow_owner", self.correction)
        self.assertIn(
            "'c66d8c05ab53df5547301e5fb8af1929cf716a9e7e5d4747db45ae00577310ea'",
            self.correction,
        )
        self.assertIn("ARRAY['search_path=\"\"']::text[]", self.correction)
        self.assertIn("ON CONFLICT (source_signature, grantee) DO UPDATE", self.correction)
        self.assertIn("GET DIAGNOSTICS v_rows = ROW_COUNT", self.correction)
        self.assertIn("IF v_rows <> 1", self.correction)
        self.assertIn("allowed.identity_arguments = procedure.proargtypes::text", self.correction)
        self.assertGreaterEqual(self.correction.count(SIGNATURE), 7)
        self.assertNotRegex(
            self.correction,
            r"(?is)\b(?:GRANT|REVOKE)\b[^;]*"
            r"publish_youtube_thumbnail_release",
        )

    def test_acl_contract_accepts_only_non_grantable_owner_and_service_rows(self) -> None:
        owner_exact = re.findall(
            r"acl\.grantee = procedure\.proowner\n"
            r"\s+AND acl\.privilege_type = 'EXECUTE'\n"
            r"\s+AND NOT acl\.is_grantable",
            self.correction,
        )
        self.assertEqual(len(owner_exact), 2)
        service_exact = re.findall(
            r"acl\.grantee = (?:v_service_role|'service_role'::pg_catalog\.regrole)\n"
            r"\s+AND acl\.privilege_type = 'EXECUTE'\n"
            r"\s+AND NOT acl\.is_grantable",
            self.correction,
        )
        self.assertEqual(len(service_exact), 2)
        self.assertEqual(
            self.correction.count("AND acl.grantee <> procedure.proowner\n              AND acl.is_grantable"),
            2,
        )
        self.assertNotRegex(
            self.correction,
            r"acl\.grantee = procedure\.proowner\n"
            r"\s+AND acl\.privilege_type = 'EXECUTE'\n"
            r"\s+AND acl\.is_grantable",
        )

    def test_owner_change_uses_a_bounded_temporary_membership_window(self) -> None:
        ordered = (
            "DO $membership_acquire$",
            "ALTER FUNCTION public.publish_youtube_thumbnail_release(",
            "SET LOCAL ROLE privacy_workflow_owner;",
            "DO $allowlist_upsert$",
            "DO $definer_contract$",
            "DO $catalog_contract$",
            "RESET ROLE;",
            "DO $membership_restore$",
            "DO $membership_postcondition$",
            "SELECT privacy_retention.assert_g014_public_rpc_allowlist();",
        )
        positions = [self.correction.index(statement) for statement in ordered]
        self.assertEqual(positions, sorted(positions))
        for exact_contract in (
            "g014_005.remove_owner_membership",
            "g014_005.restore_owner_set_false",
            "WITH SET TRUE",
            "WITH SET FALSE",
            "NOT membership.admin_option",
            "local_youtube_thumbnail_rpc_owner_membership_cleanup_drift",
        ):
            self.assertIn(exact_contract, self.correction)
        self.assertNotIn("WITH ADMIN", self.correction)

    def test_definer_patch_converges_two_exact_variants_to_seven_invokers(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.pre_definer_extensions.encode()).hexdigest(),
            "fae34d72db537f15f2e87c304ef2c06e960068942908551fa39bb7dbe2655277",
        )
        self.assertEqual(
            hashlib.sha256(self.pre_definer_public.encode()).hexdigest(),
            "e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67",
        )
        self.assertEqual(self.post_definer_extensions, self.post_definer_public)
        self.assertEqual(
            hashlib.sha256(self.post_definer_extensions.encode()).hexdigest(),
            "7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599",
        )
        invoker_branch = re.search(
            r"IF v_signature IN \(\n(.*?)\n    \) THEN",
            self.post_definer_extensions,
            re.DOTALL,
        )
        self.assertIsNotNone(invoker_branch)
        self.assertEqual(
            re.findall(r"'([^']+)'", invoker_branch.group(1)),
            DECLARED_INVOKERS,
        )
        self.assertIn(
            "G014 post-contract SECURITY INVOKER RPC owner/path mismatch",
            self.post_definer_extensions,
        )

    def test_definer_patch_rejects_unknown_broadened_or_missing_source(self) -> None:
        mutations = (
            self.pre_definer_extensions.replace(
                tagged(self.correction, "definer_invoker_anchor_extensions"),
                "",
                1,
            ),
            self.pre_definer_extensions.replace(
                "'public.ocr_log_metadata_is_safe(jsonb)'",
                "'public.ocr_log_metadata_is_safe(jsonb)',\n"
                "      'public.unexpected_invoker()'",
                1,
            ),
            self.pre_definer_public.replace(
                "IF NOT v_is_definer THEN",
                "IF false THEN",
                1,
            ),
        )
        for mutation in mutations:
            with self.subTest(source_hash=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(AssertionError):
                    apply_frozen_definer_correction(mutation, self.correction)

    def test_catalog_patch_is_hash_bound_and_declares_exactly_seven_invokers(self) -> None:
        self.assertEqual(
            hashlib.sha256(self.pre_source.encode()).hexdigest(),
            "8446731d59f1efcd41e6a58c8b253a9308b314bf3d6f35af4999f408c6a25be4",
        )
        self.assertEqual(
            hashlib.sha256(self.post_source.encode()).hexdigest(),
            "9aa3bd25e13e3b5eb896a19363e0be2e8356031cf121a39d836cf2efdb214efa",
        )
        invoker_branch = re.search(
            r"IF v_expected\.source_signature IN \(\n(.*?)\n    \) THEN",
            self.post_source,
            re.DOTALL,
        )
        self.assertIsNotNone(invoker_branch)
        self.assertEqual(
            re.findall(r"'([^']+)'", invoker_branch.group(1)),
            DECLARED_INVOKERS,
        )
        durable_new_invokers = re.search(
            r"IF v_expected\.source_signature IN \(\n(.*?)\n      \) THEN"
            r".*?IS DISTINCT FROM 'privacy_workflow_owner'"
            r".*?v_search_path IS DISTINCT FROM 'search_path='"
            r".*?v_search_path IS DISTINCT FROM 'search_path=\"\"'",
            self.post_source[self.post_source.index("IF v_is_definer THEN") :],
            re.DOTALL,
        )
        self.assertIsNotNone(durable_new_invokers)
        self.assertEqual(
            re.findall(r"'([^']+)'", durable_new_invokers.group(1)),
            ["public.is_current_user_active_admin()", SIGNATURE],
        )

    def test_catalog_patch_rejects_missing_broadened_or_unknown_source(self) -> None:
        anchor = tagged(self.correction, "invoker_anchor")
        mutations = (
            self.pre_source.replace(anchor, "", 1),
            self.pre_source.replace(
                "'public.ocr_log_metadata_is_safe(jsonb)'",
                "'public.ocr_log_metadata_is_safe(jsonb)',\n"
                "      'public.unexpected_invoker()'",
                1,
            ),
            self.pre_source.replace(
                "ELSIF NOT v_is_definer THEN",
                "ELSIF false THEN",
                1,
            ),
        )
        for mutation in mutations:
            with self.subTest(source_hash=hashlib.sha256(mutation.encode()).hexdigest()):
                with self.assertRaises(AssertionError):
                    apply_frozen_correction(mutation, self.correction)

    def test_public_and_catalog_readbacks_run_after_the_single_upsert(self) -> None:
        allowlist_assertion = (
            "SELECT privacy_retention.assert_g014_public_rpc_allowlist();"
        )
        catalog_assertion = "SELECT privacy_retention.assert_g014_catalog_contract();"
        self.assertEqual(self.correction.count(allowlist_assertion), 1)
        self.assertNotIn(
            "SELECT privacy_retention.assert_g014_definer_contract();",
            self.correction,
        )
        self.assertIn(
            "PERFORM privacy_retention.assert_g014_definer_contract();",
            self.post_source,
        )
        self.assertEqual(self.correction.count(catalog_assertion), 1)
        self.assertLess(
            self.correction.index("DO $allowlist_upsert$"),
            self.correction.index(allowlist_assertion),
        )
        self.assertLess(
            self.correction.index(allowlist_assertion),
            self.correction.index(catalog_assertion),
        )


if __name__ == "__main__":
    unittest.main()
