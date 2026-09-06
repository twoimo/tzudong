"""Private network-isolated PG17 checks; never imports hosted credentials."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'backend/supabase/migrations/20260906064459_admin_restaurant_refresh_apply_boundary.sql'
GATE = """DO $catalog_binding_pending$
BEGIN
  RAISE EXCEPTION 'refresh_apply_catalog_binding_pending' USING ERRCODE = '55000';
END;
$catalog_binding_pending$;"""
ACTOR = '00000000-0000-0000-0000-000000000001'
RESTAURANT = '00000000-0000-0000-0000-000000000002'
CANDIDATE = '00000000-0000-0000-0000-000000000003'

class SourceBoundary(unittest.TestCase):
    def test_pending_gate_and_no_legacy_revocation(self):
        s = SOURCE.read_text()
        self.assertEqual(s.count(GATE), 1)
        self.assertLess(s.index(GATE), s.index('CREATE TABLE'))
        self.assertNotIn('REVOKE ALL ON FUNCTION public.extract_youtube_video_id', s)
        self.assertNotIn('CREATE OR REPLACE FUNCTION', s)
        self.assertNotIn('ALTER ROLE', s)
        self.assertNotIn('GRANT privacy_workflow_owner', s)

@unittest.skipUnless(os.environ.get('TZUDONG_REFRESH_PRIVATE_PG') == '1', 'explicit private fixture opt-in')
class PrivatePostgres(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = 'refresh-apply-test-' + uuid.uuid4().hex[:10]
        cls.run_command(['docker','run','--rm','-d','--network','none','--name',cls.container,
            '-e','POSTGRES_HOST_AUTH_METHOD=trust',
            'pgvector/pgvector@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f']).check_returncode()
        cls.addClassCleanup(cls.run_command, ['docker','rm','-f',cls.container])
        for _ in range(100):
            if cls.run_command(['docker','exec',cls.container,'pg_isready','-h','127.0.0.1','-U','postgres']).returncode == 0:
                break
            time.sleep(.1)
        cls.user = 'postgres'
        cls.query('CREATE ROLE fixture_bootstrap LOGIN SUPERUSER;')
        cls.user = 'fixture_bootstrap'
        cls.query('ALTER ROLE postgres RENAME TO original_bootstrap; CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;')
        cls.query('CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;')

    @staticmethod
    def run_command(args, **kwargs):
        return subprocess.run(args, text=True, capture_output=True, timeout=45, **kwargs)

    @classmethod
    def query(cls, sql, db='postgres', check=True, role=None):
        p = cls.run_command(['docker','exec','-i',cls.container,'psql','-XAtq','-h','127.0.0.1',
            '-U',role or cls.user,'-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'], input=sql)
        if check and p.returncode:
            raise AssertionError(p.stderr)
        return p

    def q(self, sql, check=True):
        return self.query(sql, db=self.db, check=check)

    def setUp(self):
        self.db = 'refresh_' + uuid.uuid4().hex[:10]
        self.query('CREATE DATABASE '+self.db)
        self.q("""CREATE SCHEMA privacy_retention;
CREATE TYPE public.app_role AS ENUM('admin','user');
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,approved_name text,phone text,road_address text,jibun_address text,
 lat numeric,lng numeric,status text,updated_at timestamptz,updated_by_admin_id uuid,youtube_link text);
CREATE TABLE public.restaurant_refresh_candidates(id uuid PRIMARY KEY,restaurant_id uuid,candidate_status text,
 detected_change_types text[],previous_snapshot jsonb,candidate_snapshot jsonb,operator_decision text,operator_notes text,
 decided_by_admin_id uuid,decided_at timestamptz,applied_at timestamptz);
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,
 identity_arguments text,grantee name,source_signature text,PRIMARY KEY(source_signature,grantee));
""")
        canonical = (ROOT/'backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql').read_text()
        self.q(re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.g014_reject_audit_mutation\(\).*?\$function\$;', canonical, re.S).group())
        helpers = (ROOT/'backend/supabase/migrations/20260417_prevent_active_restaurant_identity_duplicates.sql').read_text().split('with identity_rows as')[0]
        self.q(helpers+"CREATE UNIQUE INDEX fixture_identity ON restaurants(extract_youtube_video_id(youtube_link),normalize_restaurant_identity_name(resolve_restaurant_identity_name(approved_name,NULL,NULL,NULL))); GRANT EXECUTE ON FUNCTION extract_youtube_video_id(text),normalize_restaurant_identity_name(text),resolve_restaurant_identity_name(text,text,text,text) TO service_role;")
        # Only an exact, asserted gate is removed in the disposable private DB.
        self.q("ALTER SCHEMA privacy_retention OWNER TO postgres; GRANT USAGE,CREATE ON SCHEMA public TO postgres; ALTER TABLE public.restaurants OWNER TO postgres; ALTER TABLE public.user_roles OWNER TO postgres; ALTER TABLE public.restaurant_refresh_candidates OWNER TO postgres; ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO postgres; ALTER FUNCTION public.extract_youtube_video_id(text) OWNER TO postgres; ALTER FUNCTION public.normalize_restaurant_identity_name(text) OWNER TO postgres; ALTER FUNCTION public.resolve_restaurant_identity_name(text,text,text,text) OWNER TO postgres; ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY; ALTER TABLE restaurant_refresh_candidates ENABLE ROW LEVEL SECURITY; ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;")
        self.query(SOURCE.read_text().replace(GATE, '', 1),db=self.db,role='postgres')
        self.previous = {'name':'before','phone':None,'road_address':None,'jibun_address':None,'lat':37,'lng':127,'updated_at':'2026-01-01T00:00:00+00:00'}
        self.candidate = {'name':'after','lat':None,'lng':None}
        self.q(f"INSERT INTO user_roles VALUES('{ACTOR}','admin'); INSERT INTO restaurants VALUES('{RESTAURANT}','before',NULL,NULL,NULL,37,127,'approved','2026-01-01',NULL,'https://youtu.be/abcdef12345'); INSERT INTO restaurant_refresh_candidates VALUES('{CANDIDATE}','{RESTAURANT}','needs_review',ARRAY['name'],{self.literal(self.previous)},{self.literal(self.candidate)},NULL,NULL,NULL,NULL,NULL);")

    def tearDown(self):
        self.query('DROP DATABASE '+self.db)

    @staticmethod
    def literal(value):
        return "'"+json.dumps(value).replace("'","''")+"'::jsonb"

    def apply(self, actor=ACTOR, role='service_role', previous=None, candidate=None, check=True):
        args = f"'{actor}','{CANDIDATE}',{self.literal(self.previous if previous is None else previous)},{self.literal(self.candidate if candidate is None else candidate)},NULL"
        return self.q(f'SET ROLE {role}; SELECT public.apply_restaurant_refresh_candidate({args});', check=check)

    def assert_denied(self, code, **kwargs):
        before = self.state()
        result = self.apply(check=False, **kwargs)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(code, result.stderr)
        self.assertEqual(before, self.state())

    def state(self):
        return self.q("SELECT jsonb_build_object('restaurants',(SELECT jsonb_agg(to_jsonb(r)) FROM restaurants r),'candidates',(SELECT jsonb_agg(to_jsonb(c)) FROM restaurant_refresh_candidates c),'receipts',(SELECT jsonb_agg(to_jsonb(a)) FROM restaurant_refresh_apply_receipts a));").stdout

    def test_success_readback_receipt_null_coordinates_and_duplicate_denied(self):
        receipt = json.loads(self.apply().stdout)
        self.assertTrue(receipt['ok'] and receipt['readback'])
        self.assertEqual(receipt['candidate_id'], CANDIDATE)
        self.assertRegex(receipt['preview_hash'], '^[0-9a-f]{64}$')
        self.assertEqual(self.q('SELECT approved_name,lat,lng FROM restaurants').stdout.strip(), 'after|37|127')
        self.assertEqual(self.q('SELECT candidate_status,operator_decision FROM restaurant_refresh_candidates').stdout.strip(), 'applied|approved')
        self.assertEqual(self.q('SELECT count(*) FROM restaurant_refresh_apply_receipts').stdout.strip(),'1')
        self.assert_denied('40001')

    def test_acl_and_non_admin_denied(self):
        for role in ('anon','authenticated'):
            self.assert_denied('42501',role=role)
        self.assert_denied('42501',actor='00000000-0000-0000-0000-000000000009')
        self.assertEqual(self.q("SELECT has_function_privilege('service_role','public.extract_youtube_video_id(text)','EXECUTE')").stdout.strip(),'t')

    def test_stale_candidate_and_restaurant_and_previous_snapshot_denied(self):
        self.assert_denied('40001',candidate={'name':'tampered'})
        self.assert_denied('40001',previous={})
        self.q("UPDATE restaurants SET phone='changed'")
        self.assert_denied('40001')

    def test_invalid_closure_and_coordinate_denied(self):
        self.q("UPDATE restaurant_refresh_candidates SET detected_change_types=ARRAY['closure']")
        self.assert_denied('22023')
        self.q("UPDATE restaurant_refresh_candidates SET detected_change_types=ARRAY['name'],candidate_snapshot='{\"lat\":91}'")
        self.assert_denied('22023',candidate={'lat':91})
        self.q("UPDATE restaurant_refresh_candidates SET candidate_snapshot='{\"lat\":\"37\"}'")
        self.assert_denied('22023',candidate={'lat':'37'})

    def test_unique_identity_conflict_rolls_back_decision_and_receipt(self):
        self.q("INSERT INTO restaurants(id,approved_name,youtube_link) VALUES('00000000-0000-0000-0000-000000000004','after','https://youtu.be/abcdef12345')")
        self.assert_denied('23505')

    def test_trigger_readback_mismatch_rolls_back_everything(self):
        self.q("CREATE FUNCTION spoil() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.approved_name:='unexpected'; RETURN NEW; END$$; CREATE TRIGGER spoil BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION spoil();")
        self.assert_denied('40001')

    def test_receipt_append_only_and_private(self):
        self.apply()
        self.assertIn('55000',self.q('DELETE FROM restaurant_refresh_apply_receipts',check=False).stderr)
        self.assertIn('42501',self.q('SET ROLE service_role; SELECT * FROM restaurant_refresh_apply_receipts',check=False).stderr)

    def test_rpc_owner_is_not_superuser_or_bypassrls(self):
        self.assertEqual(self.q("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='postgres'").stdout.strip(),'f|f')
        self.apply()

    def test_unknown_patch_columns_cannot_change_status(self):
        self.candidate = {'name':'after','status':'deleted','updated_by_admin_id':RESTAURANT}
        self.q('UPDATE restaurant_refresh_candidates SET candidate_snapshot='+self.literal(self.candidate))
        self.apply()
        self.assertEqual(self.q('SELECT status,updated_by_admin_id FROM restaurants').stdout.strip(),'approved|'+ACTOR)

    def test_receipt_insert_failure_rolls_back_restaurant_and_decision(self):
        self.q("ALTER TABLE restaurant_refresh_apply_receipts ADD CONSTRAINT deny_fixture CHECK(outcome<>'applied')")
        self.assert_denied('23514')

    def test_lock_timeout_preserves_state(self):
        locker = subprocess.Popen(['docker','exec','-i',self.container,'psql','-XAtq','-h','127.0.0.1',
            '-U',self.user,'-d',self.db,'-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        locker.stdin.write("SET application_name='refresh_fixture_locker'; BEGIN; SELECT id FROM restaurants FOR UPDATE; SELECT pg_sleep(5); ROLLBACK;")
        locker.stdin.close()
        try:
            for _ in range(100):
                if self.q("SELECT count(*) FROM pg_stat_activity WHERE application_name='refresh_fixture_locker' AND wait_event='PgSleep'").stdout.strip()=='1':
                    break
                time.sleep(.05)
            else:
                self.fail('fixture lock not acquired')
            self.assert_denied('55P03')
        finally:
            locker.wait(timeout=10)
            locker.stdout.close()
            locker.stderr.close()

    def test_unbound_migration_and_dependency_mismatch_denied(self):
        self.assertIn('55000',self.q(SOURCE.read_text(),check=False).stderr)
        self.q('ALTER TABLE restaurants ALTER COLUMN lat TYPE double precision')
        self.assertIn('55000',self.q(SOURCE.read_text().replace(GATE,'',1),check=False).stderr)

if __name__ == '__main__':
    unittest.main()
