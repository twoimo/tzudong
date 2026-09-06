"""Private PostgreSQL 17 slice tests. No hosted transport or credentials."""
import hashlib
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'backend/supabase/migrations/20260906040116_admin_user_ids_catalog_slice.sql'
ORIGINAL = ROOT / 'backend/supabase/migrations/20260812000300_local_admin_data_boundary_convergence.sql'

class SourceContract(unittest.TestCase):
    def test_exact_accepted_rpc_and_no_other_persistent_ddl(self):
        old = re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management\(\).*?END\n\$\$;', ORIGINAL.read_text(), re.S).group()
        self.assertIn(old.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 1), SOURCE.read_text())
        self.assertEqual(hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(), 'b23e7150d94538744fd34f061c426def63b2c9e25d3c30539a221d40845306bf')
        for forbidden in ('CREATE ROLE', 'ALTER ROLE', 'CREATE POLICY', 'ALTER TABLE', 'UPDATE privacy_retention', 'DELETE FROM', 'CREATE OR REPLACE FUNCTION'):
            self.assertNotIn(forbidden, SOURCE.read_text())

    def test_preview_rejects_past_ledger_and_catalog_drift(self):
        import sys
        from unittest.mock import patch
        sys.path.insert(0, str(ROOT / 'backend/supabase/scripts'))
        import admin_user_ids_slice_plan as planner
        # An explicitly substituted fixture trust anchor tests drift denial;
        # production retains its independently reviewed current51 fingerprint.
        fixture = {k: False for k in planner.baseline.SNAP_KEYS}
        fixture.update(executor_ok=True, constraints_valid=4, function_paths_fixed=26, touch_ok=True)
        fixture['ledger'] = [{'version': str(i).zfill(14), 'name': 'fixture_'+str(i), 'statement_count': 0, 'statements_pg_json_sha256': 'a'*64} for i in range(50)]
        fixture['ledger'].append({'version': planner.baseline.VERSION, 'name': planner.baseline.NAME, 'statement_count': 17, 'statements_pg_json_sha256': 'b'*64})
        with self.assertRaisesRegex(ValueError, 'current51_snapshot_binding_denied'):
            planner.preview(fixture)
        trusted = planner.sha(planner.canonical(fixture).encode())
        with patch.object(planner, 'CURRENT51_SNAPSHOT_SHA256', trusted), patch.object(planner, 'vectors', return_value=['fixture']):
            self.assertEqual(planner.preview(fixture)['snapshot'], fixture)
            for field, changed in [('name','corrupted_name'), ('statement_count',1), ('statements_pg_json_sha256','c'*64)]:
                drift = copy.deepcopy(fixture)
                drift['ledger'][2][field] = changed
                with self.subTest(ledger_field=field), self.assertRaisesRegex(ValueError, 'current51_snapshot_binding_denied'):
                    planner.preview(drift)
            for field in ('membership','policies','schemas','relations','helpers','functions_stable','constraints_stable','manifest_normalized','triggers','server_major'):
                drift = copy.deepcopy(fixture)
                drift[field] = 'changed'
                with self.subTest(catalog_field=field), self.assertRaisesRegex(ValueError, 'current51_snapshot_binding_denied'):
                    planner.preview(drift)

@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'explicit private local PG17 opt-in required')
class PostgresContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = 'admin-ids-test-' + uuid.uuid4().hex[:10]
        cls.docker('run', '--rm', '-d', '--network', 'none', '--name', cls.container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'pgvector/pgvector@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f')
        for _ in range(100):
            if cls.docker('exec', cls.container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', check=False).returncode == 0: break
            time.sleep(.1)
        cls.q("CREATE ROLE bootstrap LOGIN SUPERUSER;", role='postgres')
        cls.q("ALTER ROLE postgres RENAME TO original_bootstrap; CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEROLE INHERIT; CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE; GRANT service_role TO postgres WITH INHERIT FALSE, SET TRUE;")
        cls.q("GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;", role='postgres')
    @classmethod
    def tearDownClass(cls):
        cls.docker('rm', '-f', cls.container, check=False)
    @classmethod
    def docker(cls, *args, input=None, check=True):
        p = subprocess.run(['docker', *args], input=input, text=True, capture_output=True, timeout=45)
        if check and p.returncode: raise AssertionError(p.stderr)
        return p
    @classmethod
    def q(cls, sql, *, role='bootstrap', db='postgres', check=True):
        return cls.docker('exec', '-i', cls.container, 'psql', '-XAtq', '-h', '127.0.0.1', '-U', role, '-d', db, '-v', 'ON_ERROR_STOP=1', input=sql, check=check)
    def setUp(self):
        self.db = 'slice_' + uuid.uuid4().hex[:10]
        self.q('CREATE DATABASE '+self.db+' OWNER postgres;')
        self.sql("""GRANT USAGE,CREATE ON SCHEMA public TO privacy_workflow_owner;
CREATE TYPE public.app_role AS ENUM('admin','user');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, created_at timestamptz);
ALTER TABLE public.user_roles OWNER TO postgres; ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_roles TO privacy_workflow_owner;
CREATE POLICY owner_read ON public.user_roles FOR SELECT TO privacy_workflow_owner USING(true);
CREATE POLICY caller_read ON public.user_roles FOR SELECT TO authenticated USING(false);
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text, PRIMARY KEY(source_signature,grantee));
ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;
GRANT USAGE ON SCHEMA privacy_retention TO postgres;
GRANT SELECT,INSERT ON privacy_retention.g014_public_rpc_allowlist TO postgres;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner USING(true) WITH CHECK(true);
CREATE POLICY runner_all ON privacy_retention.g014_public_rpc_allowlist TO postgres USING(true) WITH CHECK(true);
""")
        # Deliberately modeled G014 fixture checks: actual hosted assertions are not synthesized as passing receipts.
        for name in ('assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'):
            self.sql(f"""CREATE FUNCTION privacy_retention.{name}() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND set_option) THEN RAISE EXCEPTION 'lease_visible_to_g014'; END IF;
IF EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(a.source_signature) WHERE p.oid IS NULL OR NOT p.prosecdef OR p.proowner<>'privacy_workflow_owner'::regrole OR p.proconfig<>ARRAY['search_path=""']::text[] OR NOT pg_catalog.has_function_privilege(a.grantee,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'g014_fixture_contract_failed'; END IF;
END $$; ALTER FUNCTION privacy_retention.{name}() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.{name}() FROM PUBLIC;""")
        self.before = self.state()
    def tearDown(self):
        self.q('DROP DATABASE '+self.db+';')
    def sql(self, s, *, role='bootstrap', check=True):
        if role in ('anon','authenticated','service_role'):
            s='SET ROLE '+role+'; '+s
            role='bootstrap'
        return self.q(s, db=self.db, role=role, check=check)
    def state(self):
        return self.sql("SELECT jsonb_build_object('membership',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r));").stdout.strip()
    def apply(self, end='COMMIT', check=True):
        return self.sql('BEGIN;\n'+SOURCE.read_text()+'\n'+end+';',role='postgres',check=check)
    def test_rehearsal_apply_acl_and_exact_membership_restore(self):
        self.apply('ROLLBACK')
        self.assertEqual(self.before,self.state())
        self.assertEqual(self.sql("SELECT to_regprocedure('public.read_admin_user_ids_for_management()') IS NULL;").stdout.strip(),'t')
        self.apply(); self.assertEqual(self.before,self.state())
        self.sql("INSERT INTO public.user_roles(user_id,role) VALUES ('00000000-0000-0000-0000-000000000002','admin'),('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000003','user');")
        result=self.sql('SELECT user_id FROM public.read_admin_user_ids_for_management();',role='service_role').stdout.splitlines()
        self.assertEqual(result,['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'])
        for role in ('anon','authenticated'):
            self.assertNotEqual(self.sql('SELECT * FROM public.read_admin_user_ids_for_management();',role=role,check=False).returncode,0)
        self.assertIn('admin_ids_identity_conflict',self.apply(check=False).stderr)
        self.assertEqual(self.before,self.state())
    def test_empty_and_over_limit(self):
        self.apply()
        self.assertEqual(self.sql('SELECT count(*) FROM public.read_admin_user_ids_for_management();',role='service_role').stdout.strip(),'0')
        self.sql("INSERT INTO public.user_roles(user_id,role) SELECT gen_random_uuid(),'admin' FROM generate_series(1,201);")
        self.assertIn('admin_user_id_count_exceeded',self.sql('SELECT count(*) FROM public.read_admin_user_ids_for_management();',role='service_role',check=False).stderr)
    def test_missing_privilege_and_rls_denied_before_changes(self):
        self.sql('REVOKE SELECT ON public.user_roles FROM privacy_workflow_owner;')
        self.assertIn('admin_ids_dependency_denied',self.apply(check=False).stderr)
        self.sql('GRANT SELECT ON public.user_roles TO privacy_workflow_owner; DROP POLICY owner_read ON public.user_roles;')
        self.assertIn('admin_ids_rls_visibility_denied',self.apply(check=False).stderr)
        self.assertEqual(self.sql('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist;').stdout.strip(),'0')
    def test_g014_post_failure_rolls_back_function_and_lease(self):
        self.sql("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF to_regprocedure('public.read_admin_user_ids_for_management()') IS NOT NULL THEN RAISE EXCEPTION 'forced_post_failure'; END IF; END $$;")
        self.assertIn('forced_post_failure',self.apply(check=False).stderr)
        self.assertEqual(self.before,self.state())
        self.assertEqual(self.sql("SELECT to_regprocedure('public.read_admin_user_ids_for_management()') IS NULL;").stdout.strip(),'t')
    def test_preexisting_allowlist_conflict(self):
        self.sql("INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public','read_admin_user_ids_for_management','','service_role','public.read_admin_user_ids_for_management()');")
        self.assertIn('admin_ids_identity_conflict',self.apply(check=False).stderr)

    def test_plan_exact_ledger_rehearsal_apply_and_readback(self):
        import sys
        from unittest.mock import patch
        sys.path.insert(0,str(ROOT/'backend/supabase/scripts'))
        import admin_user_ids_slice_plan as planner
        self.sql('CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;')
        rows=[(str(i).zfill(14),'historical_'+str(i)) for i in range(50)]+[(planner.baseline.VERSION,planner.baseline.NAME)]
        for v,n in rows:
            self.sql(f"INSERT INTO supabase_migrations.schema_migrations VALUES('{v}','{n}',ARRAY[]::text[]);")
        ledger=json.loads(self.sql(planner.baseline.LEDGER_SQL+';').stdout)
        baseline={k:False for k in planner.baseline.SNAP_KEYS}
        baseline.update(ledger=ledger,executor_ok=True,constraints_valid=4,function_paths_fixed=26,touch_ok=True)
        fixture_pin = patch.object(planner, 'CURRENT51_SNAPSHOT_SHA256', planner.sha(planner.canonical(baseline).encode()))
        fixture_pin.start()
        self.addCleanup(fixture_pin.stop)
        bound=planner.preview(baseline)
        # Harness ledger/transaction test only; broad advisor SQL is independently tested by its suite.
        read=f"SELECT jsonb_set({planner.literal(planner.canonical(baseline))}::jsonb,'{{ledger}}',({planner.baseline.LEDGER_SQL}))"
        with patch.object(planner.baseline,'snapshot_sql',return_value=read):
            with self.assertRaisesRegex(ValueError,'external_rehearsal'): planner.plan(bound,'apply')
            original_assertion = self.sql("SELECT pg_get_functiondef('privacy_retention.assert_g014_catalog_contract()'::regprocedure);").stdout
            self.sql("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='ZP001', MESSAGE='injected_rehearsal_code_collision'; END $$;")
            collision = self.sql(planner.plan(bound,'rehearse'),role='postgres',check=False)
            self.assertNotEqual(collision.returncode, 0)
            self.assertIn('admin_ids_rehearsal_did_not_finish', collision.stderr)
            self.assertEqual(self.before, self.state())
            self.sql(original_assertion)
            got=self.sql(planner.plan(bound,'rehearse'),role='postgres')
            self.assertEqual(json.loads(got.stdout),planner.receipt(bound))
            self.assertEqual(self.sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').stdout.strip(),'51')
            self.assertEqual(self.before,self.state())
            self.sql(planner.plan(bound,'apply',planner.receipt(bound)),role='postgres')
            self.assertEqual(self.sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').stdout.strip(),'52')
            self.assertEqual(self.sql('SELECT cardinality(statements) FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;').stdout.strip(),'2')
            self.sql("INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','admin');")
            result=self.sql(planner.plan(bound,'readback'),role='postgres')
            self.assertTrue(all(json.loads(result.stdout).values()))
            self.sql("CREATE POLICY partial_owner ON public.user_roles AS RESTRICTIVE TO privacy_workflow_owner USING(user_id='00000000-0000-0000-0000-000000000001'::uuid);")
            self.assertEqual(self.sql('SELECT count(*) FROM public.read_admin_user_ids_for_management();',role='service_role').stdout.strip(),'1')
            partial=self.sql(planner.plan(bound,'readback'),role='postgres',check=False)
            self.assertNotEqual(partial.returncode,0)
            self.assertIn('admin_ids_visibility_readback_denied',partial.stderr)
            self.sql('DROP POLICY partial_owner ON public.user_roles;')
            self.assertIn('admin_ids_preview_drift',self.sql(planner.plan(bound,'apply',planner.receipt(bound)),role='postgres',check=False).stderr)
            self.assertEqual(self.before,self.state())

    def test_restrictive_policy_and_g014_before_failure(self):
        self.sql('CREATE POLICY restrictive_owner ON public.user_roles AS RESTRICTIVE TO privacy_workflow_owner USING(false);')
        self.assertIn('admin_ids_rls_visibility_denied',self.apply(check=False).stderr)
        self.sql('DROP POLICY restrictive_owner ON public.user_roles;')
        self.sql("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'forced_pre_failure'; END $$;")
        self.assertIn('forced_pre_failure',self.apply(check=False).stderr)
        self.assertEqual(self.before,self.state())

    def test_membership_option_drift_denied(self):
        self.sql('GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;',role='postgres')
        try:
            drifted=self.state()
            self.assertIn('admin_ids_membership_admission_denied',self.apply(check=False).stderr)
            self.assertEqual(drifted,self.state())
        finally:
            self.sql('GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;',role='postgres')
        self.assertEqual(self.before,self.state())

    def test_concurrent_relation_lock_times_out_without_changes(self):
        child=subprocess.Popen(['docker','exec','-i',self.container,'psql','-XAtq','-h','127.0.0.1','-U','bootstrap','-d',self.db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            child.stdin.write("BEGIN; LOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE; SELECT 'locked'; SELECT pg_sleep(4); ROLLBACK;\n")
            child.stdin.flush()
            self.assertEqual(child.stdout.readline().strip(),'locked')
            self.assertIn('lock timeout',self.apply(check=False).stderr)
            child.stdin.close();child.wait(timeout=10)
            self.assertEqual(self.before,self.state())
        finally:
            if child.poll() is None: child.kill();child.wait()
            child.stdout.close();child.stderr.close()
