"""Source drift and real local database negative tests for the replay overlap."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
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
        return subprocess.run(['docker', *args], input=input, text=True, capture_output=True, timeout=60)

    @classmethod
    def query(cls, sql):
        return cls.docker('exec', '-i', cls.container, 'psql', '-XAtq', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', input=sql)

    @classmethod
    def setUpClass(cls):
        cls.container = 'admin-ids-replay-test-' + uuid.uuid4().hex[:10]
        # Isolated fixture, not the canonical PG15 clean replay image. CI also
        # executes the verifier against the complete pinned PG15 replay twice.
        started = cls.docker('run', '--rm', '-d', '--network', 'none', '--name', cls.container,
                             '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector:pg17')
        if started.returncode:
            raise AssertionError(started.stderr)
        cls.addClassCleanup(cls.docker, 'rm', '-f', cls.container)
        for _ in range(100):
            if cls.docker('exec', cls.container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').returncode == 0:
                break
            time.sleep(.1)
        definition = re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management\(\).*?END\n\$\$;', PREDECESSOR.read_text(), re.S).group()
        result = cls.query('''CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA privacy_retention;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text);
''' + definition + '''
ALTER FUNCTION public.read_admin_user_ids_for_management() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public','read_admin_user_ids_for_management','','service_role','public.read_admin_user_ids_for_management()');
''')
        if result.returncode:
            raise AssertionError(result.stderr)
        cls.verification = replay.verification_sql(SOURCE.read_bytes(), PREDECESSOR.read_bytes()).decode()

    def test_exact_overlap_passes_without_mutating_catalog(self):
        snapshot = "SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY oid)) FROM pg_proc p;"
        before = self.query(snapshot).stdout
        result = self.query(self.verification)
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
                result = self.query('BEGIN;\n' + mutation + '\n' + body + '\nROLLBACK;')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('admin_ids_replay_' + code, result.stderr)
        self.assertEqual(self.query(self.verification).returncode, 0)
