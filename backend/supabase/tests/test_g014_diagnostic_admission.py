"""Offline and explicitly isolated PG17 diagnostic/admission tests. No hosted calls."""
import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'backend/supabase/scripts'))
import admin_user_ids_slice_plan as planner
import g014_catalog_diagnostic as diag


def fixture():
    snapshot={k:False for k in planner.baseline.SNAP_KEYS}
    snapshot.update(executor_ok=True,constraints_valid=4,function_paths_fixed=26,touch_ok=True)
    snapshot['ledger']=[{'version':str(i).zfill(14),'name':'fixture_'+str(i),'statement_count':0,'statements_pg_json_sha256':'a'*64} for i in range(50)]
    snapshot['ledger'].append({'version':planner.baseline.VERSION,'name':planner.baseline.NAME,'statement_count':17,'statements_pg_json_sha256':'b'*64})
    return snapshot


def success(preview, now):
    # Explicit synthetic unit fixture. Never a hosted receipt.
    return {'schema':diag.SCHEMA,'binding':diag.binding(preview),
            'observedAt':now.strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
            'readOnly':True,'roleMatches':True,'snapshotMatches':True,
            'assertions':dict.fromkeys(diag.ASSERTIONS,'passed'),
            'countsCode':'available','counts':dict.fromkeys(diag.COUNTS,0),'assertionCatalogSha256':'a'*64}


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.snapshot=fixture()
        self.enterContext(patch.object(planner,'CURRENT51_SNAPSHOT_SHA256',planner.sha(planner.canonical(self.snapshot).encode())))
        self.preview=planner.preview(self.snapshot)
        self.now=datetime.now(timezone.utc)
        self.receipt=success(self.preview,self.now)

    def test_success_freshness_exact_and_outside_boundaries(self):
        for age,allowed in [(0,True),(300,True),(300.000001,False),(-1,True),(-1.000001,False)]:
            with self.subTest(age=age):
                if allowed: diag.require_passed(self.receipt,self.preview,now=self.now+timedelta(seconds=age))
                else:
                    with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(self.receipt,self.preview,now=self.now+timedelta(seconds=age))

    def test_every_assertion_failure_denies_both_plans(self):
        for name in diag.ASSERTIONS:
            for code in diag.CODES-{'passed'}:
                bad=copy.deepcopy(self.receipt); bad['assertions'][name]=code
                for mode in ('rehearse','apply'):
                    with self.subTest(name=name,code=code,mode=mode), self.assertRaisesRegex(ValueError,'fresh_passed'):
                        planner.plan(self.preview,mode,planner.receipt(self.preview),diagnostic_receipt=bad)

    def test_absent_old_success_and_wrong_role_source_snapshot_denied(self):
        invalid=[None,{'g014AssertionPassed':True}]
        for field in ('schema','readOnly','roleMatches','snapshotMatches','countsCode','assertionCatalogSha256'):
            bad=copy.deepcopy(self.receipt);bad[field]=False;invalid.append(bad)
        for field in self.receipt['binding']:
            bad=copy.deepcopy(self.receipt);bad['binding'][field]='foreign';invalid.append(bad)
        for stamp in ('2020-01-01T00:00:00.000000Z','2099-01-01T00:00:00.000000Z','invalid',None):
            bad=copy.deepcopy(self.receipt);bad['observedAt']=stamp;invalid.append(bad)
        for bad in invalid:
            with self.subTest(value=bad),self.assertRaisesRegex(ValueError,'fresh_passed'):
                planner.plan(self.preview,'rehearse',diagnostic_receipt=bad)

    def test_counts_and_extra_raw_fields_fail_closed(self):
        for key,value in [('allowlist_missing',1),('unexpected_execute_pairs',3),('role_pairs',354),('public_functions',True),('owner_memberships',-1)]:
            bad=copy.deepcopy(self.receipt);bad['counts'][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(bad,self.preview)
        for key in ('rawError','userRows','actualRole'):
            bad=copy.deepcopy(self.receipt);bad[key]='not-persisted'
            with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(bad,self.preview)

    def test_failure_precedes_install_vector_generation(self):
        # preview revalidation parses vectors once; no second installation vector call.
        real=planner.vectors
        with patch.object(planner,'vectors',wraps=real) as vectors:
            with self.assertRaisesRegex(ValueError,'fresh_passed'): planner.plan(self.preview,'rehearse')
            self.assertEqual(vectors.call_count,1)

    def test_runtime_guard_precedes_original_transactional_work(self):
        sql=planner.plan(self.preview,'rehearse',diagnostic_receipt=self.receipt)
        self.assertLess(sql.index('g014_diagnostic_execution_binding_denied'),sql.index('EXECUTE '+planner.literal(planner.vectors()[0])))
        for guard in ('admin_ids_preview_drift','admin_ids_broad_post_drift','admin_ids_rehearsal_did_not_finish','admin_ids_rehearsal_restore_drift'):
            self.assertIn(guard,sql)
        with self.assertRaisesRegex(ValueError,'external_rehearsal'): planner.plan(self.preview,'apply',diagnostic_receipt=self.receipt)
        self.assertIn('COMMIT;',planner.plan(self.preview,'apply',planner.receipt(self.preview),diagnostic_receipt=self.receipt))
        self.assertIn('READ ONLY',planner.plan(self.preview,'readback'))

    def test_json_parser_rejects_duplicate_oversize_nonjson_and_provider_envelope(self):
        for raw in (b'{"schema":1,"schema":2}',b'x'*8193,b'not-json',b'\xff',b'{"value":NaN}'):
            with self.assertRaisesRegex(ValueError,'diagnostic_receipt_denied'): diag.parse_receipt(raw)
        envelope=diag.parse_receipt(b'{"error":"not-persisted"}')
        with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(envelope,self.preview)
        self.assertEqual(diag.parse_receipt(json.dumps(self.receipt).encode()),self.receipt)

    def test_generated_diagnostic_contains_no_lease_or_object_creation(self):
        sql=diag.diagnostic_sql(self.preview)
        for forbidden in ('CREATE FUNCTION','CREATE TABLE','GRANT ','REVOKE ','SET ROLE','SET LOCAL ROLE','INSERT INTO','SQLERRM','PG_EXCEPTION_DETAIL','RAISE NOTICE'):
            self.assertNotIn(forbidden,sql)
        self.assertEqual(sql.count('PERFORM privacy_retention.assert_g014_'),3)
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',sql)
        self.assertTrue(sql.endswith('ROLLBACK;\n'))


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG')=='1','explicit private PG17 opt-in required')
class DiagnosticPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container='g014-diagnostic-'+uuid.uuid4().hex[:10]
        cls.docker('run','--rm','-d','--network','none','--name',cls.container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f')
        for _ in range(100):
            if cls.docker('exec',cls.container,'pg_isready','-h','127.0.0.1','-U','postgres',check=False).returncode==0: break
            time.sleep(.1)
        cls.q('CREATE ROLE privacy_workflow_owner NOLOGIN; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE outsider LOGIN;')
    @classmethod
    def tearDownClass(cls): cls.docker('rm','-f',cls.container,check=False)
    @classmethod
    def docker(cls,*args,input=None,check=True):
        result=subprocess.run(['docker',*args],input=input,text=True,capture_output=True,timeout=45)
        if check and result.returncode: raise AssertionError('private_fixture_command_failed')
        return result
    @classmethod
    def q(cls,sql,db='postgres',role='postgres',check=True):
        return cls.docker('exec','-i',cls.container,'psql','-XAtq','-h','127.0.0.1','-U',role,'-d',db,'-v','ON_ERROR_STOP=1',input=sql,check=check)
    def setUp(self):
        self.db='diag_'+uuid.uuid4().hex[:10];self.q('CREATE DATABASE '+self.db)
        self.q('CREATE SCHEMA privacy_retention; CREATE TABLE privacy_retention.g014_public_rpc_allowlist(source_signature text, grantee name); CREATE TABLE public.write_probe(n int); GRANT ALL ON public.write_probe TO privacy_workflow_owner;',self.db)
        for name in diag.ASSERTIONS: self.replace(name,'NULL;')
        self.preview={'projectId':diag.PROJECT,'source_sha256':planner.SOURCE_SHA,'snapshot':{'fixture':True}}
        self.enterContext(patch.object(diag.baseline,'snapshot_sql',return_value="SELECT '{\"fixture\":true}'::jsonb"))
    def tearDown(self): self.q('DROP DATABASE '+self.db)
    def replace(self,name,body):
        self.q(f"CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_{name}() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN {body} END $$; ALTER FUNCTION privacy_retention.assert_g014_{name}() OWNER TO privacy_workflow_owner;",self.db)
    def run_diagnostic(self,role='postgres'):
        result=self.q(diag.diagnostic_sql(self.preview),self.db,role)
        self.assertNotIn('private_provider_marker',result.stdout+result.stderr)
        return json.loads(result.stdout)
    def test_all_three_fail_independently_and_errors_are_minimized(self):
        for name in diag.ASSERTIONS: self.replace(name,"RAISE EXCEPTION 'private_provider_marker';")
        result=self.run_diagnostic()
        self.assertEqual(result['assertions'],dict.fromkeys(diag.ASSERTIONS,'contract_failed'))
        self.assertTrue(result['readOnly']);self.assertTrue(result['snapshotMatches'])
        with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(result,self.preview)
    def test_success_no_persistent_or_temp_objects_or_role_changes(self):
        before=self.q('SELECT count(*) FROM pg_proc;',self.db).stdout
        result=self.run_diagnostic();diag.require_passed(result,self.preview)
        self.assertEqual(before,self.q('SELECT count(*) FROM pg_proc;',self.db).stdout)
        self.assertEqual(self.q('SELECT count(*) FROM pg_auth_members WHERE roleid=\'privacy_workflow_owner\'::regrole OR member=\'privacy_workflow_owner\'::regrole;',self.db).stdout.strip(),'0')
        self.assertEqual(self.q("SELECT coalesce(nullif(current_setting('tzudong.g014_diagnostic',true),''),'absent');",self.db).stdout.strip(),'absent')
    def test_write_attempt_denied_and_other_assertions_still_observed(self):
        self.replace(diag.ASSERTIONS[0],'INSERT INTO public.write_probe VALUES(1);')
        result=self.run_diagnostic()
        self.assertEqual(result['assertions'][diag.ASSERTIONS[0]],'read_only_violation')
        self.assertEqual(result['assertions'][diag.ASSERTIONS[1]],'passed')
        self.assertEqual(result['assertions'][diag.ASSERTIONS[2]],'passed')
        self.assertEqual(self.q('SELECT count(*) FROM public.write_probe;',self.db).stdout.strip(),'0')
    def test_wrong_role_and_permission_denial_are_not_success(self):
        result=self.run_diagnostic('outsider')
        self.assertFalse(result['roleMatches'])
        self.assertEqual(result['assertions'],dict.fromkeys(diag.ASSERTIONS,'permission_denied'))
        self.assertEqual(result['countsCode'],'unavailable')
        with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(result,self.preview)
    def test_missing_identity_and_extra_grants_counted_without_names(self):
        self.q("CREATE FUNCTION public.fixture_rpc(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'; REVOKE ALL ON FUNCTION public.fixture_rpc(integer) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fixture_rpc(integer) TO service_role; INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES ('public.fixture_rpc()','service_role');",self.db)
        result=self.run_diagnostic()
        self.assertEqual(result['counts']['allowlist_missing'],1)
        self.assertEqual(result['counts']['public_functions'],1)
        self.assertEqual(result['counts']['role_pairs'],3)
        self.assertEqual(result['counts']['unexpected_execute_pairs'],1)
        self.assertNotIn('fixture_rpc',json.dumps(result))
        with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(result,self.preview)

    def test_wrong_role_even_with_all_assertions_passed_is_denied(self):
        self.q('GRANT USAGE ON SCHEMA privacy_retention TO outsider; GRANT SELECT ON privacy_retention.g014_public_rpc_allowlist TO outsider;',self.db)
        result=self.run_diagnostic('outsider')
        self.assertEqual(result['assertions'],dict.fromkeys(diag.ASSERTIONS,'passed'))
        self.assertFalse(result['roleMatches'])
        with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(result,self.preview)

    def test_runtime_stale_guard_fails_before_write(self):
        guard=diag.execution_guard('2020-01-01T00:00:00.000000Z','a'*64)
        result=self.q("BEGIN; DO $test$ BEGIN "+guard+" INSERT INTO public.write_probe VALUES(1); END $test$; COMMIT;",self.db,check=False)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('g014_diagnostic_execution_binding_denied',result.stderr)
        self.assertEqual(self.q('SELECT count(*) FROM public.write_probe;',self.db).stdout.strip(),'0')

    def test_snapshot_drift_and_identity_drift_denied(self):
        with patch.object(diag.baseline,'snapshot_sql',return_value="SELECT '{}'::jsonb"):
            result=self.run_diagnostic()
            self.assertFalse(result['snapshotMatches'])
            with self.assertRaisesRegex(ValueError,'fresh_passed'): diag.require_passed(result,self.preview)
        self.q('ALTER FUNCTION privacy_retention.assert_g014_definer_contract() SECURITY INVOKER;',self.db)
        self.assertEqual(self.run_diagnostic()['assertions']['definer_contract'],'assertion_identity_denied')


if __name__=='__main__': unittest.main()
