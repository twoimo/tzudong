"""Source drift and real local database negative tests for the replay overlap."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'backend/supabase/scripts/verify_admin_user_ids_replay.py'
spec = importlib.util.spec_from_file_location('admin_ids_replay', SCRIPT)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)
SOURCE = ROOT / 'backend/supabase/migrations/20260906040116_admin_user_ids_catalog_slice.sql'
PREDECESSOR = ROOT / 'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql'


class SourceContract(unittest.TestCase):
    def test_both_immutable_sources_are_required(self):
        with self.assertRaisesRegex(ValueError, 'source_drift'):
            replay.verification_sql(SOURCE.read_bytes() + b'\n', PREDECESSOR.read_bytes())
        with self.assertRaisesRegex(ValueError, 'predecessor_drift'):
            replay.verification_sql(SOURCE.read_bytes(), PREDECESSOR.read_bytes() + b'\n')
        sql = replay.verification_sql(SOURCE.read_bytes(), PREDECESSOR.read_bytes()).decode()
        self.assertIn('REPEATABLE READ READ ONLY', sql)
        for forbidden in ('CREATE ', 'ALTER ', 'GRANT ', 'REVOKE ', 'INSERT ', 'UPDATE ', 'DELETE ', 'SET ROLE'):
            self.assertNotIn(forbidden, sql)
        body = re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management\(\).*?AS \$\$(.*?)\$\$;', PREDECESSOR.read_text(), re.S).group(1)
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), replay.BODY_SHA256)

    def test_generator_retains_and_chains_the_verification(self):
        generator = (SCRIPT.parent / 'generate_g014_catalog_contract_baseline.sh').read_text()
        self.assertIn("'backend/supabase/scripts/verify_admin_user_ids_replay.py'", generator)
        for phase in ('verifier', 'verification', 'receipt'):
            self.assertIn('g026_chain_apply "admin-user-ids-source-overlap-' + phase + '"', generator)
        self.assertIn('admin-user-ids-overlap-verification.sql admin-user-ids-overlap-receipt.json', generator)
        self.assertIn('SELECT privacy_retention.assert_g014_catalog_contract();', generator)


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'explicit private local PG opt-in required')
class LocalPostgresContract(unittest.TestCase):
    @classmethod
    def docker(cls, *args, input=None):
        return subprocess.run(['docker', *args], input=input, text=True, capture_output=True, timeout=60,
                              env={**os.environ, 'POSTGRES_PASSWORD': cls.password, 'PGPASSWORD': cls.password})

    @classmethod
    def query(cls, sql, role='supabase_admin'):
        return cls.docker('exec', '-i', '-e', 'PGPASSWORD', cls.container, 'psql', '-XAtq', '-h', '127.0.0.1', '-U', role, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', input=sql)

    @classmethod
    def setUpClass(cls):
        cls.container = 'admin-ids-replay-test-' + uuid.uuid4().hex[:10]
        cls.password = secrets.token_hex(24)
        # Match the canonical PG15 image. This narrower fixture explicitly gives
        # a non-superuser reader catalog access; missing access must fail closed.
        # CI also executes against the complete canonical source replay twice.
        started = cls.docker('run', '--rm', '-d', '--network', 'none', '--name', cls.container,
                             '-e', 'POSTGRES_PASSWORD',
                             'supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b')
        if started.returncode:
            raise AssertionError(started.stderr)
        cls.addClassCleanup(cls.docker, 'rm', '-f', cls.container)
        for _ in range(200):
            if cls.query('SELECT 1;').returncode == 0:
                break
            time.sleep(.1)
        definition = re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management\(\).*?END\n\$\$;', PREDECESSOR.read_text(), re.S).group()
        result = cls.query('''ALTER ROLE postgres NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
REVOKE ALL ON SCHEMA privacy_retention FROM PUBLIC,postgres;
GRANT USAGE ON SCHEMA privacy_retention TO postgres;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text);
ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;
GRANT SELECT ON privacy_retention.g014_public_rpc_allowlist TO postgres;
''' + definition + '''
ALTER FUNCTION public.read_admin_user_ids_for_management() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management() FROM PUBLIC,anon,authenticated,service_role,postgres,supabase_admin;
GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public','read_admin_user_ids_for_management','','service_role','public.read_admin_user_ids_for_management()');
''')
        if result.returncode:
            raise AssertionError(result.stderr)
        cls.verification = replay.verification_sql(SOURCE.read_bytes(), PREDECESSOR.read_bytes()).decode()

    def test_exact_overlap_passes_without_mutating_catalog(self):
        snapshot = "SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY oid)) FROM pg_proc p;"
        before = self.query(snapshot).stdout
        result = self.query(self.verification, role='postgres')
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['disposition'], 'already-present-contract-verified')
        self.assertTrue(receipt['read_only'])
        self.assertEqual(receipt['source_sha256'], replay.SOURCE_SHA256)
        self.assertEqual(self.query(snapshot).stdout, before)

    def test_catalog_drift_is_rejected(self):
        cases = [
            ('DROP FUNCTION public.read_admin_user_ids_for_management();', 'rpc_mismatch'),
            ('CREATE FUNCTION public.read_admin_user_ids_for_management(integer) RETURNS integer LANGUAGE sql AS $$SELECT 1$$;', 'rpc_mismatch'),
            ("CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management() RETURNS TABLE(user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN; END $$;", 'rpc_mismatch'),
            ('ALTER FUNCTION public.read_admin_user_ids_for_management() OWNER TO postgres;', 'rpc_mismatch'),
            ('ALTER FUNCTION public.read_admin_user_ids_for_management() SECURITY INVOKER;', 'rpc_mismatch'),
            ('ALTER FUNCTION public.read_admin_user_ids_for_management() SET search_path=public;', 'rpc_mismatch'),
            ('GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO PUBLIC;', 'acl_mismatch'),
            ('REVOKE EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() FROM service_role;', 'acl_mismatch'),
            ('GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role WITH GRANT OPTION;', 'acl_mismatch'),
            ('DELETE FROM privacy_retention.g014_public_rpc_allowlist;', 'allowlist_mismatch'),
            ("UPDATE privacy_retention.g014_public_rpc_allowlist SET identity_arguments='uuid';", 'allowlist_mismatch'),
            ("INSERT INTO privacy_retention.g014_public_rpc_allowlist SELECT * FROM privacy_retention.g014_public_rpc_allowlist;", 'allowlist_mismatch'),
        ]
        for mutation, code in cases:
            with self.subTest(mutation=mutation):
                # Each bad fixture is rolled back when psql exits on the real
                # verifier exception; the production query itself stays read-only.
                body = self.verification.split('READ ONLY;\n', 1)[1].rsplit('COMMIT;', 1)[0]
                result = self.query('BEGIN;\n' + mutation + '\nSET SESSION AUTHORIZATION postgres;\n' + body + '\nROLLBACK;')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('admin_ids_replay_' + code, result.stderr)
        self.assertEqual(self.query(self.verification, role='postgres').returncode, 0)

    def test_missing_private_access_fails_without_granting_membership(self):
        before = self.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;').stdout
        self.query('REVOKE USAGE ON SCHEMA privacy_retention FROM postgres;')
        try:
            denied = self.query(self.verification, role='postgres')
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('permission denied for schema privacy_retention', denied.stderr)
            self.assertEqual(self.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;').stdout, before)
            self.assertEqual(self.query("SELECT has_schema_privilege('postgres','privacy_retention','USAGE');").stdout.strip(), 'f')
        finally:
            self.query('GRANT USAGE ON SCHEMA privacy_retention TO postgres;')
