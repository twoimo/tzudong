"""DB-free source binding and adversarial canonical receipt admission.

These tests do not substitute for exact-version full-clone execution.
"""
import copy
import hashlib
import re
import unittest
from unittest import mock

from backend.supabase.tests.test_local_seed_receipt_contract import (
    ROOT, _receipt_rows, local_migrate,
)


MIGRATION = ROOT / "backend/supabase/migrations/20261008201635_review_media_catalog_integration.sql"
PARENTS = (
    ROOT / "backend/supabase/migrations/20261008192455_review_media_commit_cleanup.sql",
    ROOT / "backend/supabase/migrations/20261008200719_review_verification_private.sql",
)
FORWARD = ROOT / "backend/supabase/migrations/20261011072824_admin_review_media_completion.sql"
SHARED_FORWARD = ROOT / "backend/supabase/migrations/20261011085342_review_legacy_shared_cleanup.sql"
SHARED_SIGNATURE = "review_media_private.enqueue_removed()"
HISTORICAL_SHARED_HASH = "7edb21d70ea3ff81ab90e13617e8c1c2749b54b1506f1ff42aaa6c5dc33f9e38"
FINAL_SHARED_HASH = "cbf6a87e453e8c2e14d67acd73a92e399fbba4b4f24ac27966806e13ef1fd905"
OWNER_SIGNATURE = "public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])"
HISTORICAL_OWNER_HASH = "50bfad7bc4fc7ddbc9d9379e8eb13facd938a15f66553576cc69fbcf69aa98b1"
FINAL_OWNER_HASH = "d5d6646a4294c0e7bd0cd75ea47a996c9c57bac6c32a39ac53fbb7a8b1e7e323"
GUARD_SIGNATURE = "review_media_private.guard_references()"
HISTORICAL_GUARD_HASH = "846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59"
FINAL_GUARD_HASH = "94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1"
FINISH_SIGNATURE = "public.finish_review_media_cleanup()"
HISTORICAL_FINISH_HASH = "f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1"
FINAL_FINISH_HASH = "a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9"
IMMUTABLE_FORWARD = ROOT / "backend/supabase/migrations/20261013190200_review_verification_immutable_key_fence.sql"
IMMUTABLE_FORWARD_SHA256 = "0a060ca537d3558779fd0cb1b780e7965189eb129f5018987f157c1cb5f2cd3d"
IMMUTABLE_GUARDS = {
    "review_media_private.guard_verification_object_delete()": True,
    "review_media_private.reject_verification_object_update()": False,
}


def immutable_forward_source():
    source = IMMUTABLE_FORWARD.read_bytes()
    if hashlib.sha256(source).hexdigest() != IMMUTABLE_FORWARD_SHA256:
        raise AssertionError("immutable forward migration bytes drift")
    return source.decode("utf-8")


def immutable_guard_rows():
    """Derive the later guard binding from its immutable migration, not a DB."""
    source = immutable_forward_source()
    rows = {}
    for signature, definer in IMMUTABLE_GUARDS.items():
        match = re.search(
            rf"CREATE FUNCTION {re.escape(signature)}\s+RETURNS trigger\s+LANGUAGE plpgsql(.*?)AS (\$[\w]*\$)(.*?)\2;",
            source, re.S,
        )
        if match is None or ("SECURITY DEFINER" in match[1]) != definer:
            raise AssertionError("immutable guard source metadata drift")
        role_changes = re.findall(r"(?m)^(SET LOCAL ROLE ([a-z_]+);|RESET ROLE;)$", source[:match.start()])
        owner = role_changes[-1][1] if role_changes else None
        settings = re.findall(r"(?m)^SET ([a-z_]+) = (.*)$", match[1])
        volatility = re.findall(r"\b(IMMUTABLE|STABLE|VOLATILE)\b", match[1])
        if owner != "privacy_workflow_owner" or settings != [('search_path', "''")]:
            raise AssertionError("immutable guard owner or configuration drift")
        if len(volatility) > 1:
            raise AssertionError("immutable guard volatility drift")
        for statement in (
            f"REVOKE ALL ON FUNCTION {signature}\n  FROM PUBLIC, anon, authenticated, service_role, supabase_storage_admin;",
            f"REVOKE EXECUTE ON FUNCTION {signature}\n  FROM postgres;",
        ):
            if source.count(statement) != 1:
                raise AssertionError("immutable guard privilege drift")
        rows[signature] = [signature, owner, "trigger", definer,
                           {'IMMUTABLE': 'i', 'STABLE': 's', 'VOLATILE': 'v'}[volatility[0] if volatility else 'VOLATILE'],
                           ['search_path=""'], hashlib.sha256(match[3].encode()).hexdigest(),
                           False, False, False, []]
    return rows


def immutable_guard_sql_rows():
    return [f"    ('{row[0]}','{row[6]}',{str(row[3]).lower()},'v','plpgsql','trigger',ARRAY[]::text[]),\n"
            for row in immutable_guard_rows().values()]


class ReviewMediaCatalogIntegrationTests(unittest.TestCase):
    def test_forward_binding_rejects_metadata_and_policy_source_drift(self):
        source = IMMUTABLE_FORWARD.read_bytes()
        for before, after in (
            (b"SET search_path = ''", b"SET search_path = 'public'"),
            (b"LANGUAGE plpgsql\nSECURITY INVOKER", b"LANGUAGE plpgsql\nSTABLE\nSECURITY INVOKER"),
            (b"SET LOCAL ROLE privacy_workflow_owner;", b"SET LOCAL ROLE postgres;"),
            (b"FROM PUBLIC, anon, authenticated, service_role, supabase_storage_admin;", b"FROM PUBLIC;"),
            (b"AS RESTRICTIVE\n  FOR UPDATE", b"AS PERMISSIVE\n  FOR SELECT"),
            (b"TO authenticated\n  USING", b"TO anon\n  USING"),
            (b"WITH CHECK (bucket_id <> 'review-verifications')", b"WITH CHECK (true)"),
        ):
            self.assertIn(before, source)
            with self.subTest(before=before), mock.patch.object(
                type(IMMUTABLE_FORWARD), 'read_bytes', return_value=source.replace(before, after, 1)
            ), self.assertRaisesRegex(AssertionError, 'immutable forward migration bytes drift'):
                immutable_guard_rows()

    def test_early_sql_storage_inventory_admits_the_complete_canonical_receipt(self):
        source = (ROOT / 'backend/supabase/scripts/local_catalog_readback.sql').read_text()
        inventory = re.search(r'IF policy_count <> (\d+) OR policy_names IS DISTINCT FROM ARRAY\[(.*?)\]::text\[\] THEN', source, re.S)
        self.assertIsNotNone(inventory)
        expected = {row[3] for row in _receipt_rows() if row[0] == 'storage_policies'}
        actual = re.findall(r"'([^']+)'", inventory.group(2))
        self.assertEqual(int(inventory.group(1)), len(expected))
        self.assertEqual(actual, sorted(expected))
        dispatch = re.search(r'IF policy_record.polname = ANY\(ARRAY\[(.*?)\]\) THEN\s+CONTINUE; -- Checked by review_media_catalog_readback', source, re.S)
        self.assertIsNotNone(dispatch)
        names = set(re.findall(r"'([^']+)'", dispatch.group(1)))
        for parent in PARENTS:
            policies = set(re.findall(r'CREATE POLICY ([\w]+) ON storage\.objects', parent.read_text()))
            self.assertTrue(policies <= names)

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
        historical_rows = [row for row in local_migrate.REVIEW_MEDIA_FUNCTIONS
                           if row[0] != "public.admin_review_verification_cleanup(uuid,text,text[])"
                           and row[0] not in IMMUTABLE_GUARDS]
        self.assertEqual(set(functions), {row[0] for row in historical_rows})
        current = {row[0]: row for row in local_migrate.REVIEW_MEDIA_FUNCTIONS}
        self.assertEqual(set(current), set(functions) | set(IMMUTABLE_GUARDS)
                         | {"public.admin_review_verification_cleanup(uuid,text,text[])"})
        for signature, row in immutable_guard_rows().items():
            self.assertEqual(current[signature], row)
        sql = MIGRATION.read_text()
        for row in historical_rows:
            with self.subTest(signature=row[0]):
                historical_hash = {OWNER_SIGNATURE: HISTORICAL_OWNER_HASH,
                                   SHARED_SIGNATURE: HISTORICAL_SHARED_HASH,
                                   FINISH_SIGNATURE: HISTORICAL_FINISH_HASH,
                                   GUARD_SIGNATURE: HISTORICAL_GUARD_HASH}.get(row[0], row[6])
                self.assertEqual((historical_hash, row[3], row[4], row[2]), functions[row[0]])
                self.assertIn(f"('{row[0]}','{before_hashes[row[0]]}','{historical_hash}'", sql)
                if row[0] == OWNER_SIGNATURE:
                    self.assertEqual(row[6], FINAL_OWNER_HASH)
                    self.assertIn(HISTORICAL_OWNER_HASH, FORWARD.read_text())
                    self.assertIn(FINAL_OWNER_HASH, FORWARD.read_text())
                if row[0] == GUARD_SIGNATURE:
                    fence = (ROOT / 'backend/supabase/migrations/20261011105114_review_media_storage_retirement_fence.sql').read_text()
                    self.assertEqual(row[6], FINAL_GUARD_HASH)
                    self.assertIn(HISTORICAL_GUARD_HASH, fence)
                    self.assertIn(FINAL_GUARD_HASH, fence)
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
        historical = checks(MIGRATION.read_text())
        self.assertEqual(historical.count(HISTORICAL_OWNER_HASH), 1)
        current = checks((ROOT / local_migrate.READBACK_SOURCE).read_text())
        # Validate each forward-only addition before projecting the complete
        # 20261008 postconditions. Unknown additions still fail byte equality.
        for row in immutable_guard_sql_rows():
            self.assertEqual(current.count(row), 1)
            current = current.replace(row, "", 1)
        old_count = "(SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>7"
        new_count = old_count[:-1] + "9"
        self.assertEqual(current.count(new_count), 1)
        current = current.replace(new_count, old_count, 1)
        policy = "      ('review_verifications_immutable_update','w',false,'authenticated','(bucket_id <> ''review-verifications''::text)','(bucket_id <> ''review-verifications''::text)'),\n"
        self.assertEqual(current.count(policy), 1)
        policy_ddl = re.search(r"CREATE POLICY review_verifications_immutable_update\b.*?;",
                               immutable_forward_source(), re.S).group()
        self.assertEqual(' '.join(policy_ddl.split()),
                         "CREATE POLICY review_verifications_immutable_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING (bucket_id <> 'review-verifications') WITH CHECK (bucket_id <> 'review-verifications');")
        self.assertEqual(local_migrate.REVIEW_MEDIA_STORAGE_POLICIES['review_verifications_immutable_update'],
                         ('UPDATE', ['authenticated'], "(bucket_id <> 'review-verifications'::text)",
                          "(bucket_id <> 'review-verifications'::text)", False))
        current = current.replace(policy, "", 1)
        trigger_check = """  IF EXISTS (
    WITH expected(name,function_oid,trigger_type) AS (VALUES
      ('a01_review_verification_immutable_update',
       'review_media_private.reject_verification_object_update()'::regprocedure::oid,19),
      ('a01_review_verification_guard_delete',
       'review_media_private.guard_verification_object_delete()'::regprocedure::oid,11)
    ), actual AS (
      SELECT tgname::text,tgfoid,tgtype::integer,tgenabled::text,tgnargs::integer,
             tgattr::text,tgdeferrable,tginitdeferred,tgqual IS NULL
      FROM pg_trigger WHERE tgrelid='storage.objects'::regclass
        AND tgname LIKE 'a01_review_verification_%' AND NOT tgisinternal
    ), wanted AS (
      SELECT name,function_oid,trigger_type,'O'::text,0,''::text,false,false,true FROM expected
    )
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_verification_trigger_drift'; END IF;
"""
        self.assertEqual(current.count(trigger_check), 1)
        for trigger, function, event in (
            ('a01_review_verification_immutable_update', 'reject_verification_object_update', 'UPDATE'),
            ('a01_review_verification_guard_delete', 'guard_verification_object_delete', 'DELETE'),
        ):
            self.assertIn(f"CREATE TRIGGER {trigger}\n  BEFORE {event} ON storage.objects\n  FOR EACH ROW\n  EXECUTE FUNCTION review_media_private.{function}();",
                          IMMUTABLE_FORWARD.read_text())
        current = current.replace(trigger_check, "", 1)
        self.assertEqual(historical.replace(HISTORICAL_OWNER_HASH, FINAL_OWNER_HASH)
                         .replace(HISTORICAL_SHARED_HASH, FINAL_SHARED_HASH)
                         .replace(HISTORICAL_GUARD_HASH, FINAL_GUARD_HASH)
                         .replace(HISTORICAL_FINISH_HASH, FINAL_FINISH_HASH)
                         .replace("((bucket_id = ''review-verifications''::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)))",
                                  "((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))"),
                         current)
        def forward_checks(source):
            return source.split("-- ADMIN_REVIEW_MEDIA_READBACK_BEGIN\n", 1)[1].split(
                "-- ADMIN_REVIEW_MEDIA_READBACK_END", 1)[0]
        self.assertEqual(forward_checks(FORWARD.read_text()).replace('2353de06b4d93f45fd603380e678f4edbcc0b16a8bd9860b5967683bea5f1157', '50b5900a7b6ca43062d6373dbba75378d714312c9ef02c6939997389f6833ba0').replace('f4d19bc5b41fe7808635240cae80f796d12f6cad8b13802577a88afbb1f024a7', '468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b'),
                         forward_checks((ROOT / local_migrate.READBACK_SOURCE).read_text()))

    def test_owner_completion_transition_retains_hash_and_readback_binding(self):
        sql = (ROOT / 'backend/supabase/migrations/20261011175912_review_owner_cleanup_completion.sql').read_text()
        body = re.search(r'CREATE OR REPLACE FUNCTION public.finish_review_media_cleanup\(\).*?AS \$\$(.*?)\$\$;', PARENTS[1].read_text(), re.S).group(1)
        body = body.replace('auth.uid()', 'privacy_retention.g041_current_claim_user_id()')
        old = re.search(r'\$old\$(.*?)\$old\$', sql, re.S).group(1)
        new = re.search(r'\$new\$(.*?)\$new\$', sql, re.S).group(1)
        self.assertEqual(body.count(old), 1)
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), HISTORICAL_FINISH_HASH)
        self.assertEqual(hashlib.sha256(body.replace(old, new).encode()).hexdigest(), FINAL_FINISH_HASH)
        def readback(text):
            return text.split('-- OWNER_CLEANUP_READBACK_BEGIN\n')[1].split('-- OWNER_CLEANUP_READBACK_END')[0]
        self.assertEqual(readback(sql), readback((ROOT / local_migrate.READBACK_SOURCE).read_text()))

    def test_shared_legacy_queue_transition_is_bound_to_the_original_trigger(self):
        body = re.search(r"CREATE FUNCTION review_media_private.enqueue_removed\(\).*?AS \$\$(.*?)\$\$;",
                         PARENTS[0].read_text(), re.S).group(1)
        sql = SHARED_FORWARD.read_text()
        old = re.search(r"\$old\$(.*?)\$old\$", sql, re.S).group(1)
        new = re.search(r"\$new\$(.*?)\$new\$", sql, re.S).group(1)
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), HISTORICAL_SHARED_HASH)
        self.assertEqual(body.count(old), 1)
        self.assertEqual(hashlib.sha256(body.replace(old, new).encode()).hexdigest(), FINAL_SHARED_HASH)
        row = next(row for row in local_migrate.REVIEW_MEDIA_FUNCTIONS if row[0] == SHARED_SIGNATURE)
        self.assertEqual(row[6], FINAL_SHARED_HASH)
        for clause in ("queued.owner_id = EXCLUDED.owner_id", "queued.purpose = EXCLUDED.purpose",
                       "queued.purpose = 'verification'", "NOT queued.retired AND NOT queued.complete",
                       "review_media_private.owned_legacy(queued.path, queued.owner_id, queued.purpose)"):
            self.assertIn(clause, new)
        self.assertIn("IS DISTINCT FROM before_schema", sql)
        self.assertIn("IF schema_lease THEN REVOKE CREATE ON SCHEMA review_media_private", sql)
        self.assertNotRegex(sql, r"(?i)(?:DISABLE TRIGGER|ALTER FUNCTION|GRANT[^;]+TO (?:anon|authenticated|service_role))")
        block = sql.split("-- REVIEW_SHARED_MEDIA_READBACK_BEGIN\n", 1)[1].split("-- REVIEW_SHARED_MEDIA_READBACK_END", 1)[0]
        current = (ROOT / local_migrate.READBACK_SOURCE).read_text().split("-- REVIEW_SHARED_MEDIA_READBACK_BEGIN\n", 1)[1].split("-- REVIEW_SHARED_MEDIA_READBACK_END", 1)[0]
        self.assertEqual(block, current)

    def test_new_service_only_cleanup_body_is_exactly_bound(self):
        body = FORWARD.read_text().split("AS $cleanup$", 1)[1].split("$cleanup$;", 1)[0]
        staging = (ROOT / 'backend/supabase/migrations/20261011103501_admin_verification_durable_staging.sql').read_text()
        old = re.search(r'\$old\$(.*?)\$old\$', staging, re.S).group(1)
        final = re.search(r'\$new\$(.*?)\$new\$', staging, re.S).group(1)
        self.assertEqual(body, old)
        self.assertIn(hashlib.sha256(body.encode()).hexdigest(), staging)
        row = next(row for row in local_migrate.REVIEW_MEDIA_FUNCTIONS
                   if row[0] == "public.admin_review_verification_cleanup(uuid,text,text[])")
        self.assertEqual(hashlib.sha256(final.encode()).hexdigest(), row[6])
        self.assertEqual(row[7:], [False, False, True, ["service_role"]])
        rows = copy.deepcopy(_receipt_rows())
        entry = next(entry for entry in rows if entry[0] == 'review_media_functions'
                     and entry[1] == row[0])
        rows.remove(entry)
        with self.assertRaises(local_migrate.LocalMigrationError):
            local_migrate.parse_readback(rows)

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
        self.assertEqual(len(files), len(local_migrate.migration_files()))
        integration = next(row for row in files if row["path"] == MIGRATION.relative_to(ROOT).as_posix())
        self.assertEqual(local_migrate._expected_terminal_status(integration), "applied")
        sql = local_migrate._execution_body(integration)
        self.assertEqual(sql, MIGRATION.read_bytes())
        self.assertEqual(len(local_migrate._load_replay_contract().supported_sources()), 6)

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
