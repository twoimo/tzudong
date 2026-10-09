"""DB-free source binding and adversarial canonical receipt admission.

These tests do not substitute for exact-version full-clone execution.
"""
import copy
import hashlib
import re
import unittest

from backend.supabase.tests.test_local_seed_receipt_contract import (
    ROOT, _receipt_rows, local_migrate,
)


MIGRATION = ROOT / "backend/supabase/migrations/20261008201635_review_media_catalog_integration.sql"
PARENTS = (
    ROOT / "backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql",
    ROOT / "backend/supabase/migrations/20261008200719_review_verification_private.sql",
)


class ReviewMediaCatalogIntegrationTests(unittest.TestCase):
    def test_complete_receipt_remains_admitted(self):
        # Negative tests must reach their intended guard, not an earlier stale
        # inventory count after adding the two restrictive Storage policies.
        local_migrate.parse_readback(_receipt_rows())

    def test_final_function_bodies_are_bound_to_both_canonical_sources(self):
        functions = {}
        before_hashes = {}
        for path in PARENTS:
            for match in re.finditer(
                r"CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\((.*?)\)\s*RETURNS "
                r"(.*?)\s+LANGUAGE (sql|plpgsql)(.*?)AS \$\$(.*?)\$\$;",
                path.read_text(), re.S,
            ):
                name, args, result, language, attrs, body = match.groups()
                types = [part.strip().split()[1].replace("timestamptz", "timestamp with time zone")
                         for part in args.split(",") if part.strip()]
                signature = f"{name}({','.join(types)})"
                before_hashes[signature] = hashlib.sha256(body.encode()).hexdigest()
                body = body.replace("auth.uid()", "privacy_retention.g041_current_claim_user_id()")
                functions[signature] = (
                    hashlib.sha256(body.encode()).hexdigest(),
                    "SECURITY DEFINER" in attrs,
                    "i" if "IMMUTABLE" in attrs else "v",
                    " ".join(result.split()),
                )
        self.assertEqual(len(functions), 14)
        self.assertEqual(sum(key.startswith("public.") for key in functions), 7)
        self.assertEqual(set(functions), {row[0] for row in local_migrate.REVIEW_MEDIA_FUNCTIONS})
        sql = MIGRATION.read_text()
        for row in local_migrate.REVIEW_MEDIA_FUNCTIONS:
            with self.subTest(signature=row[0]):
                self.assertEqual((row[6], row[3], row[4], row[2]), functions[row[0]])
                self.assertIn(f"('{row[0]}','{before_hashes[row[0]]}','{row[6]}'", sql)
        self.assertEqual(sum(before_hashes[key] != value[0] for key, value in functions.items()), 7)

    def test_claim_transition_pins_existing_helper_without_auth_schema_grant(self):
        source = (ROOT / "backend/supabase/migrations/20260804000500_g041_auth_workflow_bridge.sql").read_text()
        body = re.search(
            r"CREATE OR REPLACE FUNCTION privacy_retention.g041_current_claim_user_id\(\).*?"
            r"AS \$function\$(.*?)\$function\$;", source, re.S,
        ).group(1)
        sql = MIGRATION.read_text()
        self.assertIn(hashlib.sha256(body.encode()).hexdigest(), sql)
        self.assertIn("EXECUTE replace(v_definition,'auth.uid()','privacy_retention.g041_current_claim_user_id()')", sql)
        self.assertIn("IS DISTINCT FROM v_expected.final_body_sha256", sql)
        self.assertIn("has_schema_privilege(v_owner,'auth','USAGE,CREATE')", sql)
        self.assertNotRegex(sql, r"(?i)GRANT[^;]+(?:SCHEMA auth|ON auth\.)")
        self.assertIn("to_jsonb(p)-'proowner'-'proacl'-'prosrc'", sql)

    def test_canonical_readback_reuses_the_complete_migration_postconditions(self):
        def checks(source):
            return source.split("-- REVIEW_MEDIA_READBACK_BEGIN\n", 1)[1].split(
                "-- REVIEW_MEDIA_READBACK_END", 1)[0].replace(
                    "-- The same independent catalog-only checks are embedded in canonical readback.\n", "")
        self.assertEqual(checks(MIGRATION.read_text()), checks((ROOT / local_migrate.READBACK_SOURCE).read_text()))

    def test_protected_identity_transition_reconstructs_from_immutable_source(self):
        original = (ROOT / "backend/supabase/migrations/20260713002500_g014_catalog_contract.sql").read_text()
        before = re.search(
            r"CREATE OR REPLACE FUNCTION privacy_retention.g014_catalog_protected_relations\(\).*?"
            r"AS \$function\$(.*?)\$function\$;", original, re.S,
        ).group(1)
        sql = MIGRATION.read_text()
        anchor = re.search(r"\$known_anchor\$(.*?)\$known_anchor\$", sql, re.S).group(1)
        replacement = re.search(r"\$known_replacement\$(.*?)\$known_replacement\$", sql, re.S).group(1)
        self.assertEqual(before.count(anchor), 1)
        self.assertEqual(replacement, "    ('review_media_private', 'commits'),\n"
                         "    ('review_media_private', 'cleanup'),\n" + anchor)
        after = before.replace(anchor, replacement)
        for body in (before, after):
            self.assertIn(hashlib.sha256(body.encode()).hexdigest(), sql)
        self.assertEqual(after.count("'review_media_private'"), 2)

    def test_transition_preserves_assertions_manifest_and_role_memberships(self):
        sql = MIGRATION.read_text()
        self.assertNotRegex(sql, r"(?i)(?:DISABLE\s+(?:TRIGGER|ROW LEVEL SECURITY)|\bBYPASSRLS\b|session_replication_role\s*=)")
        self.assertNotRegex(sql, r"(?i)(?:CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?FUNCTION\s+privacy_retention\.")
        self.assertNotRegex(sql, r"(?i)(?:UPDATE|DELETE FROM)\s+privacy_retention\.g014_catalog_contract_manifest")
        self.assertIn("INSERT INTO privacy_retention.g014_catalog_contract_manifest", sql)
        self.assertIn("AND manifest_key->>'relation' IN ('commits','cleanup')", sql)
        self.assertIn("IS DISTINCT FROM v_members", sql)
        self.assertIn("IS DISTINCT FROM v_assertions", sql)
        self.assertIn("IS DISTINCT FROM v_manifest", sql)
        self.assertIn("IS DISTINCT FROM v_functions", sql)
        for assertion in ("public_rpc_allowlist", "definer_contract", "catalog_contract", "catalog_manifest"):
            self.assertIn(f"privacy_retention.assert_g014_{assertion}()", sql)
        self.assertIn("GRANT UPDATE(content,categories,food_photos,is_verified,admin_note,updated_at)", sql)
        self.assertIn("DROP FUNCTION pg_temp.review_media_g014_assert()", sql)

    def test_storage_ddl_uses_existing_hook_without_global_privilege_fallback(self):
        sql = MIGRATION.read_text()
        self.assertNotRegex(sql, r"(?i)(?:GRANT|SET(?: LOCAL)? ROLE)\s+(?:supabase_storage_admin|supabase_admin|service_role)")
        self.assertNotRegex(sql, r"(?i)ALTER SYSTEM|(?:SET|set_config\()\s*'?supautils\.")
        self.assertNotIn("pg_extension", sql)
        self.assertEqual(sql.count("pg_has_role"), 1)
        self.assertIn("v_pg15_lease := NOT pg_has_role(v_runner,v_owner,'MEMBER');", sql)
        self.assertIn("IF v_pg15_lease THEN REVOKE privacy_workflow_owner FROM postgres; END IF;", sql)
        self.assertIn("CREATE POLICY review_media_workflow_read ON storage.objects", sql)
        self.assertIn("review_media_catalog_existing_owner_admin_missing", sql)
        self.assertNotIn("GRANT CREATE ON SCHEMA public", sql)
        self.assertIn("GRANT SELECT ON pg_temp.review_media_expected TO privacy_workflow_owner", sql)
        # Private allowlist reads/writes run under the trusted owner. The post-
        # cleanup catalog-only block must work for nonsuperuser postgres too.
        readback = sql.split("-- REVIEW_MEDIA_READBACK_BEGIN", 1)[1]
        self.assertNotIn("FROM privacy_retention.g014_public_rpc_allowlist", readback)
        self.assertIn("SET LOCAL ROLE privacy_workflow_owner;\n  INSERT INTO privacy_retention.g014_public_rpc_allowlist", sql)

    def test_ledger_applies_integration_normally_and_retains_current_overlap_proofs(self):
        manifest = local_migrate.verify_manifest()
        files = manifest["source"]["files"]
        self.assertEqual(len(files), 130)
        integration = next(row for row in files if row["path"] == MIGRATION.relative_to(ROOT).as_posix())
        self.assertEqual(local_migrate._expected_terminal_status(integration), "applied")
        sql = local_migrate._execution_body(integration)
        self.assertEqual(sql, MIGRATION.read_bytes())
        self.assertEqual(len(local_migrate._load_replay_contract().supported_sources()), 5)

    def test_rejects_every_function_owner_body_role_and_identity_drift(self):
        for signature in (row[0] for row in local_migrate.REVIEW_MEDIA_FUNCTIONS):
            for field, value in ((1, "unexpected()"), (2, "postgres"), (4, False),
                                 (6, ["search_path=public"]), (7, "0" * 64),
                                 (8, True), (9, None), (10, True), (11, ["anon"])):
                rows = copy.deepcopy(_receipt_rows())
                row = next(row for row in rows if row[0] == "review_media_functions" and row[1] == signature)
                if row[field] == value:
                    continue
                row[field] = value
                with self.subTest(signature=signature, field=field), self.assertRaises(local_migrate.LocalMigrationError):
                    local_migrate.parse_readback(rows)

    def test_rejects_policy_bit_role_command_and_full_predicate_drift(self):
        for name in local_migrate.REVIEW_MEDIA_STORAGE_POLICIES:
            for field, value in ((4, "ALL"), (5, ["anon", "authenticated"]),
                                 (6, "true"), (7, "true"), (8, None)):
                rows = copy.deepcopy(_receipt_rows())
                row = next(row for row in rows if row[0] == "storage_policies" and row[3] == name)
                row[field] = value
                with self.subTest(name=name, field=field), self.assertRaises(local_migrate.LocalMigrationError):
                    local_migrate.parse_readback(rows)
            rows = copy.deepcopy(_receipt_rows())
            row = next(row for row in rows if row[0] == "storage_policies" and row[3] == name)
            row[8] = not row[8]
            with self.subTest(name=name, field="permissive"), self.assertRaises(local_migrate.LocalMigrationError):
                local_migrate.parse_readback(rows)

    def test_rejects_predicate_or_true_even_when_every_expected_token_survives(self):
        rows = copy.deepcopy(_receipt_rows())
        row = next(row for row in rows if row[0] == "storage_policies" and row[3] == "review_media_safe_delete")
        row[6] += " OR true"
        with self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_review_media_storage_policy"):
            local_migrate.parse_readback(rows)

    def test_rejects_old_public_select_policy_leaking_the_private_bucket(self):
        rows = copy.deepcopy(_receipt_rows())
        row = next(row for row in rows if row[0] == "storage_policies" and row[3] == "tzudong_public_media_read")
        row[6] += " OR bucket_id = 'review-verifications'"
        with self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_review_media_public_read"):
            local_migrate.parse_readback(rows)

    def test_rejects_integer_substitutes_for_function_boolean_metadata(self):
        for field in (4, 8, 9, 10):
            rows = copy.deepcopy(_receipt_rows())
            row = next(row for row in rows if row[0] == "review_media_functions")
            row[field] = int(row[field])
            with self.subTest(field=field), self.assertRaisesRegex(local_migrate.LocalMigrationError, "receipt_review_media_function_contract"):
                local_migrate.parse_readback(rows)

    def test_rejects_private_bucket_public_name_size_and_mime_drift(self):
        for field, value in ((2, "other"), (3, True), (4, 5242881), (5, ["image/*"])):
            rows = copy.deepcopy(_receipt_rows())
            row = next(row for row in rows if row[0] == "storage_buckets" and row[1] == "review-verifications")
            row[field] = value
            with self.subTest(field=field), self.assertRaises(local_migrate.LocalMigrationError):
                local_migrate.parse_readback(rows)


if __name__ == "__main__":
    unittest.main()
