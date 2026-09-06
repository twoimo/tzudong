"""Private PG15 overlap checks. No migration execution or hosted transport."""
import json
import os
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'backend/supabase/scripts'))
import admin_management_group_plan as plan
import verify_admin_management_group_replay as replay
from backend.supabase.tests import test_admin_user_ids_replay as first_replay
from backend.supabase.tests import test_admin_management_group as group_fixture


class SourceContract(unittest.TestCase):
    def test_generator_and_ci_bind_all_runtime_dependencies(self):
        generator=(ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        workflow=(ROOT/'.github/workflows/g014-catalog-contract-baseline.yml').read_text()
        for dependency in ('verify_admin_management_group_replay.py','admin_management_group_plan.py','advisor_successor_plan.py','g037_supabase_statement_vector.mjs'):
            self.assertIn("'backend/supabase/scripts/"+dependency+"'",generator)
            self.assertIn(dependency,generator.split('20260906053936_admin_management_group_catalog_slice.sql)',1)[1].split(';;',1)[0])
            self.assertIn(dependency,workflow)
        self.assertIn('admin-management-group-overlap-verification.sql admin-management-group-overlap-receipt.json',generator)
        self.assertIn('ON_ERROR_STOP=1',generator)
        self.assertEqual(generator.count('    platform: linux/amd64'),3)
        self.assertIn('docker_local image inspect --platform linux/amd64',generator)
        self.assertIn('docker_local pull --platform linux/amd64',generator)
        self.assertIn('.already_present_contract_verified == true',generator)
        self.assertIn("TZUDONG_ADMIN_GROUP_LOCAL_PG: '1'",workflow)
        for module in ('test_admin_management_group','test_admin_management_group_replay'):
            self.assertGreaterEqual(workflow.count('backend.supabase.tests.'+module),2)
        self.assertLess(workflow.index('Set up the migration statement parser runtime'),workflow.index('Run G026 and reconstruction unit tests'))

    def test_pins_and_no_ddl(self):
        sql=replay.verification_sql(plan.SOURCE.read_bytes(),plan.PREDECESSOR.read_bytes()).decode()
        self.assertIn('READ ONLY',sql)
        for forbidden in ('CREATE ', 'ALTER ', 'GRANT ', 'REVOKE ', 'INSERT INTO ', 'UPDATE ', 'DELETE ', 'SET ROLE'):
            self.assertNotIn(forbidden,sql)
        for source,old in [(plan.SOURCE.read_bytes()+b'\n',plan.PREDECESSOR.read_bytes()),(plan.SOURCE.read_bytes(),plan.PREDECESSOR.read_bytes()+b'\n')]:
            with self.assertRaisesRegex(ValueError,'binding_denied'): replay.verification_sql(source,old)


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_GROUP_LOCAL_PG')=='1','explicit private PG15 opt-in required')
class PG15(unittest.TestCase):
    docker=classmethod(first_replay.LocalPostgresContract.docker.__func__)
    query=classmethod(first_replay.LocalPostgresContract.query.__func__)

    @classmethod
    def setUpClass(cls):
        # Reuse private container lifecycle/first-RPC fixture without editing it.
        first_replay.LocalPostgresContract.setUpClass.__func__(cls)
        installed=group_fixture.dependency_fixture()
        for definition,sig in zip(group_fixture.definitions(),group_fixture.SIGS):
            installed+=definition+f"ALTER FUNCTION {sig} OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role,postgres,supabase_admin; GRANT EXECUTE ON FUNCTION {sig} TO service_role; INSERT INTO privacy_retention.g014_public_rpc_allowlist SELECT 'public',proname,proargtypes::text,'service_role','{sig}' FROM pg_proc WHERE oid='{sig}'::regprocedure;"
        result=cls.query(installed)
        if result.returncode: raise AssertionError(result.stderr)
        cls.verification=replay.verification_sql(plan.SOURCE.read_bytes(),plan.PREDECESSOR.read_bytes()).decode()
        cls.body=cls.verification.split('READ ONLY;',1)[1].rsplit('ROLLBACK;',1)[0]

    def test_exact_overlap_metadata_unchanged(self):
        before=self.query(plan.group_snapshot_sql()+';').stdout
        result=self.query(self.verification,role='postgres')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads(result.stdout)['already_present_contract_verified'])
        self.assertTrue(json.loads(result.stdout)['read_only'])
        self.assertEqual(before,self.query(plan.group_snapshot_sql()+';').stdout)

    def test_permissions_visibility_and_dependency_drift_denied(self):
        cases=[
            ('REVOKE SELECT ON public.profiles FROM privacy_workflow_owner;','column_dependency'),
            ('ALTER TABLE public.profiles ALTER COLUMN username TYPE varchar(100);','column_dependency'),
            ('DROP POLICY owner_all ON public.profiles;','rls_visibility'),
            ('CREATE POLICY partial ON public.user_account_status AS RESTRICTIVE TO PUBLIC USING(false);','rls_visibility'),
            ('CREATE POLICY partial ON public.admin_audit_events AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK(false);','rls_visibility'),
            ('ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_id_key;','join_key'),
            ('ALTER TABLE public.admin_audit_events DISABLE TRIGGER g014_admin_audit_events_append_only;','audit_contract'),
            ('ALTER FUNCTION public.admin_user_audit_event_is_safe(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text) SECURITY DEFINER;','helper_denied'),
            ('ALTER ROLE privacy_workflow_owner INHERIT;','column_dependency'),
        ]
        for mutation,code in cases:
            with self.subTest(mutation=mutation):
                result=self.query('BEGIN;'+mutation+' SET SESSION AUTHORIZATION postgres;'+self.body+'ROLLBACK;')
                self.assertNotEqual(result.returncode,0);self.assertIn(code,result.stderr)
                self.assertEqual(result.stdout.strip(),'')
        self.assertEqual(self.query(self.verification,role='postgres').returncode,0)

    def test_each_target_owner_acl_signature_and_allowlist_drift_denied(self):
        for sig in group_fixture.SIGS:
            for mutation in [f'ALTER FUNCTION {sig} SECURITY INVOKER;',f'ALTER FUNCTION {sig} OWNER TO postgres;',f'GRANT EXECUTE ON FUNCTION {sig} TO PUBLIC;',f'GRANT EXECUTE ON FUNCTION {sig} TO service_role WITH GRANT OPTION;',f'REVOKE EXECUTE ON FUNCTION {sig} FROM service_role;',f"DELETE FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature='{sig}';"]:
                with self.subTest(mutation=mutation):
                    result=self.query('BEGIN;'+mutation+' SET SESSION AUTHORIZATION postgres;'+self.body+'ROLLBACK;')
                    self.assertNotEqual(result.returncode,0);self.assertIn('target_contract_denied',result.stderr)
        self.assertEqual(self.query(self.verification,role='postgres').returncode,0)

    def test_missing_private_access_no_automatic_grant(self):
        before=self.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;').stdout
        result=self.query('BEGIN; REVOKE USAGE ON SCHEMA privacy_retention FROM postgres; SET SESSION AUTHORIZATION postgres;'+self.body+'ROLLBACK;')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(before,self.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;').stdout)

if __name__=='__main__': unittest.main()
