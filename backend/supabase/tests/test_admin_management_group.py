"""Explicit private PG17 tests; fixtures never establish a hosted trust anchor."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
import uuid

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'backend/supabase/scripts'))
import admin_management_group_plan as plan
from backend.supabase.tests import test_admin_user_ids_catalog_slice as first_fixture

NAMES=['read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event']
SIGS=['public.'+NAMES[0]+'(uuid[])','public.'+NAMES[1]+'(integer)','public.'+NAMES[2]+'(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)']
ACTOR='00000000-0000-4000-8000-000000000001'
OTHER='00000000-0000-4000-8000-000000000002'
MISSING='00000000-0000-4000-8000-000000000003'
REQUEST='00000000-0000-4000-8000-000000000010'


def definitions():
    return [re.search(r'CREATE OR REPLACE FUNCTION public.'+n+r'\(.*?END\n\$\$;',plan.PREDECESSOR.read_text(),re.S).group() for n in NAMES]


def dependency_fixture():
    m=ROOT/'backend/supabase/migrations'
    g010=(m/'20260712000300_g010_account_deletion.sql').read_text()
    audit=re.search(r'CREATE TABLE IF NOT EXISTS public.admin_audit_events \(.*?\n\);',(m/'20260514_admin_user_management_audit.sql').read_text(),re.S).group()
    helpers='\n'.join(re.search(r'CREATE FUNCTION public.'+n+r'\(.*?\$\$;',g010,re.S).group() for n in ['admin_user_audit_reason_code','admin_user_audit_counts_are_safe','admin_user_audit_flags_are_safe','admin_user_audit_event_is_safe'])
    trigger=re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.g014_reject_audit_mutation\(\).*?\$function\$;',(m/'20260713002000_g014_public_api_private_boundary.sql').read_text(),re.S).group()
    return '''CREATE TABLE public.profiles(user_id uuid NOT NULL UNIQUE,username text,nickname text NOT NULL,avatar_url text,role text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_account_status(user_id uuid PRIMARY KEY,account_status text NOT NULL,disabled_at timestamptz);
ALTER TABLE public.profiles OWNER TO postgres;
ALTER TABLE public.user_account_status OWNER TO postgres;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_account_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles,public.user_account_status TO privacy_workflow_owner;
CREATE POLICY owner_all ON public.profiles TO privacy_workflow_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_all ON public.user_account_status TO privacy_workflow_owner USING(true) WITH CHECK(true);
'''+audit+helpers+'''
ALTER TABLE public.admin_audit_events ADD COLUMN audit_counts jsonb NOT NULL DEFAULT '{}', ADD COLUMN audit_flags jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.admin_audit_events ADD CONSTRAINT admin_audit_events_whitelisted_contract CHECK(public.admin_user_audit_event_is_safe(action,status,reason,error_code,before_state,after_state,audit_counts,audit_flags,request_id,ip_hash,user_agent_hash));
ALTER TABLE public.admin_audit_events OWNER TO privacy_workflow_owner;
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON public.admin_audit_events TO privacy_workflow_owner USING(true) WITH CHECK(true);
'''+trigger+'''
ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() OWNER TO privacy_workflow_owner;
CREATE TRIGGER g014_admin_audit_events_append_only BEFORE UPDATE OR DELETE ON public.admin_audit_events FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_reject_audit_mutation();
'''


class SourceContract(unittest.TestCase):
    def test_exact_bodies_source_pins_and_two_vectors(self):
        text=plan.source()
        for d in definitions(): self.assertIn(d.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION',1),text)
        for sig in SIGS: self.assertIn("('"+sig+"', 'service_role'::name)",plan.PREDECESSOR.read_text())
        self.assertEqual(len(plan.vectors()),2)
        for forbidden in ('CREATE ROLE','ALTER ROLE','CREATE POLICY','ALTER TABLE','DELETE FROM','CREATE OR REPLACE FUNCTION','REVOKE privacy_workflow_owner'):
            self.assertNotIn(forbidden,text)
        self.assertEqual(text.count('WITH SET TRUE GRANTED BY postgres;'),2)
        self.assertEqual(text.count('WITH SET FALSE GRANTED BY postgres;'),2)

    def test_production_unpinned_always_denies(self):
        self.assertIsNone(plan.CURRENT52_SNAPSHOT_SHA256)
        with self.assertRaisesRegex(ValueError,'not_yet_available'): plan.preview({})
        self.assertIn('READ ONLY',plan.snapshot_plan())

    def test_preview_full_snapshot_drift_denial(self):
        a={k:False for k in plan.baseline.SNAP_KEYS}
        a.update(executor_ok=True,constraints_valid=4,function_paths_fixed=26,touch_ok=True)
        a['ledger']=[dict(version=str(i).zfill(14),name='fixture_'+str(i),statement_count=0,statements_pg_json_sha256='a'*64) for i in range(51)]
        a['ledger'].append(dict(version=plan.FIRST_VERSION,name=plan.FIRST_NAME,statement_count=2,statements_pg_json_sha256='b'*64))
        snapshot={'advisor':a,'group':{'roles':'b'*64,'functions':'c'*64}}
        with patch.object(plan,'CURRENT52_SNAPSHOT_SHA256',plan.sha(plan.canonical(snapshot).encode())):
            p=plan.preview(snapshot)
            for field in ('name','statement_count','statements_pg_json_sha256'):
                bad=copy.deepcopy(snapshot);bad['advisor']['ledger'][3][field]='drift'
                with self.subTest(field=field),self.assertRaisesRegex(ValueError,'binding_denied'): plan.preview(bad)
            bad=copy.deepcopy(snapshot);bad['group']['functions']='d'*64
            with self.assertRaisesRegex(ValueError,'binding_denied'): plan.preview(bad)
            with self.assertRaisesRegex(ValueError,'external_rehearsal'): plan.plan(p,'apply')
            self.assertEqual(plan.plan(p,'apply',plan.receipt(p)).count('admin_group_intentional_rehearsal_rollback'),1)


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_GROUP_LOCAL_PG')=='1','explicit private PG17 opt-in required')
class PG17(unittest.TestCase):
    setUpClass=classmethod(first_fixture.PostgresContract.setUpClass.__func__)
    tearDownClass=classmethod(first_fixture.PostgresContract.tearDownClass.__func__)
    docker=classmethod(first_fixture.PostgresContract.docker.__func__)
    q=classmethod(first_fixture.PostgresContract.q.__func__)
    sql=first_fixture.PostgresContract.sql
    tearDown=first_fixture.PostgresContract.tearDown
    state=first_fixture.PostgresContract.state

    def setUp(self):
        first_fixture.PostgresContract.setUp(self)
        self.sql(dependency_fixture())
        self.before=self.state()

    def apply(self,end='COMMIT',check=True):
        return self.sql('BEGIN; SET LOCAL search_path=pg_catalog;\n'+plan.source()+'\n'+end+';',role='postgres',check=check)

    def count(self): return self.sql('SELECT count(*) FROM public.admin_audit_events;').stdout.strip()

    def seed(self):
        self.sql(f"INSERT INTO public.user_roles(user_id,role) VALUES('{ACTOR}','admin'),('{OTHER}','user'); INSERT INTO public.user_account_status VALUES('{ACTOR}','active',NULL),('{OTHER}','active',NULL); INSERT INTO public.profiles(user_id,username,nickname,role) VALUES('{ACTOR}','fixture_actor','Actor','admin'),('{OTHER}','fixture_other','Other','user');")

    def append(self,**changes):
        args=[f"'{ACTOR}'",f"'{OTHER}'","'admin_user_profile_updated'","'ADMIN_USER_PROFILE_UPDATE_INTENT'","'intent'",'NULL',"'{}'::jsonb","'{}'::jsonb",'NULL','NULL',f"'{REQUEST}'",'NULL','NULL']
        keys=['actor','target','action','reason','status','correlation','counts','flags','applied','error','request','ip','ua']
        for k,v in changes.items(): args[keys.index(k)]=v
        return 'SELECT public.append_admin_user_audit_event('+','.join(args)+');'

    def verify_absent(self):
        self.assertEqual(self.sql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ("+','.join(plan.literal(n) for n in NAMES)+');').stdout.strip(),'0')
        self.assertEqual(self.state(),self.before)

    def test_rehearsal_install_permissions_membership_and_repeat_denial(self):
        self.apply('ROLLBACK');self.verify_absent()
        self.apply();self.assertEqual(self.state(),self.before)
        for sig in SIGS:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('service_role','{sig}','EXECUTE') AND NOT has_function_privilege('anon','{sig}','EXECUTE') AND NOT has_function_privilege('authenticated','{sig}','EXECUTE');").stdout.strip(),'t')
        self.assertEqual(self.sql('SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist;').stdout.strip(),'3')
        self.assertIn('identity_conflict',self.apply(check=False).stderr)
        self.assertEqual(self.state(),self.before)

    def test_metadata_order_missing_profile_bounds_and_exact_projection(self):
        self.apply();self.seed()
        rows=json.loads(self.sql(f"SELECT jsonb_agg(to_jsonb(m)) FROM public.read_admin_user_management_metadata(ARRAY['{OTHER}','{MISSING}','{ACTOR}']::uuid[]) m;",role='service_role').stdout)
        self.assertEqual([r['user_id'] for r in rows],[OTHER,MISSING,ACTOR])
        self.assertIsNone(rows[1]['nickname']);self.assertFalse(rows[1]['is_admin']);self.assertTrue(rows[2]['is_admin'])
        self.assertEqual(set(rows[0]),{'user_id','username','nickname','avatar_url','profile_role','profile_created_at','profile_updated_at','is_admin','account_status'})
        for arg in ['NULL::uuid[]','ARRAY[]::uuid[]',f"ARRAY['{ACTOR}','{ACTOR}']::uuid[]",f"ARRAY['{ACTOR}',NULL]::uuid[]","ARRAY(SELECT md5(i::text)::uuid FROM generate_series(1,201) i)"]:
            with self.subTest(arg=arg): self.assertIn('admin_user_metadata_request_invalid',self.sql('SELECT count(*) FROM public.read_admin_user_management_metadata('+arg+');',role='service_role',check=False).stderr)
        self.assertEqual(self.sql('SELECT count(*) FROM public.read_admin_user_management_metadata(ARRAY(SELECT md5(i::text)::uuid FROM generate_series(1,200) i));',role='service_role').stdout.strip(),'200')

    def test_append_denials_source_bounds_and_duplicate_request_semantics(self):
        self.apply();self.seed()
        bad=[dict(actor='NULL'),dict(request='NULL'),dict(actor=f"'{MISSING}'"),dict(actor=f"'{OTHER}'"),dict(counts='NULL'),dict(flags='NULL'),dict(counts="'[]'::jsonb"),dict(flags="'[]'::jsonb"),dict(counts="'1'::jsonb"),dict(counts="'{\"email\":1}'::jsonb"),dict(counts="'{\"updated\":-1}'::jsonb"),dict(counts="'{\"updated\":10000000000}'::jsonb"),dict(flags="'{\"roleAdmin\":1}'::jsonb"),dict(flags="'{\"unknown\":true}'::jsonb"),dict(reason="'unsafe freeform'"),dict(ip="'raw diagnostic'"),dict(request="'00000000-0000-0000-0000-000000000000'"),dict(applied='now()'),dict(status="'applied'",reason="'ADMIN_USER_PROFILE_UPDATE_APPLIED'")]
        for change in bad:
            with self.subTest(change=change):
                result=self.sql(self.append(**change),role='service_role',check=False)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(self.count(),'0')
        for mutation,restore in [("account_status='disabled'","account_status='active'"),("disabled_at=now()","disabled_at=NULL")]:
            self.sql(f"UPDATE public.user_account_status SET {mutation} WHERE user_id='{ACTOR}';")
            self.assertIn('admin_user_audit_event_invalid',self.sql(self.append(),role='service_role',check=False).stderr)
            self.sql(f"UPDATE public.user_account_status SET {restore} WHERE user_id='{ACTOR}';")
        first=self.sql(self.append(counts="'{\"updated\":9999999999}'::jsonb"),role='service_role').stdout.strip()
        second=self.sql(self.append(),role='service_role').stdout.strip()
        self.assertNotEqual(first,second);self.assertEqual(self.count(),'2')
        self.assertEqual(self.sql("SELECT bool_and(before_state='{}'::jsonb AND after_state='{}'::jsonb) AND count(DISTINCT request_id)=1 FROM public.admin_audit_events;").stdout.strip(),'t')
        self.assertIn('append_only_audit_ledger',self.sql('DELETE FROM public.admin_audit_events;',check=False).stderr)

    def test_nullable_reason_exact_source_behavior_is_explicit(self):
        self.apply();self.seed()
        # SQL NULL propagates through helper / CHECK; unchanged source allows NULL reason.
        self.sql(self.append(reason='NULL'),role='service_role')
        self.assertEqual(self.sql('SELECT count(*) FROM public.admin_audit_events WHERE reason IS NULL;').stdout.strip(),'1')

    def test_audit_limit_order_and_minimized_projection(self):
        self.apply();self.seed()
        self.sql('BEGIN;'+''.join(self.append() for _ in range(52))+'COMMIT;',role='service_role')
        # One input batch shares transaction timestamp; id is the deterministic tie-breaker.
        rows=json.loads(self.sql('SELECT jsonb_agg(to_jsonb(a)) FROM public.read_admin_user_audit_events(50) a;',role='service_role').stdout)
        self.assertEqual(len(rows),50)
        self.assertEqual([r['id'] for r in rows],sorted([r['id'] for r in rows],reverse=True))
        self.assertEqual(set(rows[0]),{'id','actor_user_id','target_user_id','action','reason','status','correlation_id','applied_at','error_code','created_at','audit_counts','audit_flags'})
        for limit in ['NULL','0','51','-1']:
            self.assertIn('admin_user_audit_limit_invalid',self.sql(f'SELECT count(*) FROM public.read_admin_user_audit_events({limit});',role='service_role',check=False).stderr)

    def test_actual_rls_subset_is_denied_even_when_row_counts_match(self):
        self.apply();self.seed()
        self.sql(f"CREATE POLICY subset ON public.profiles AS RESTRICTIVE TO PUBLIC USING(user_id='{OTHER}'::uuid);")
        result=self.sql(f"SELECT count(*)=2 AND count(nickname)=1 FROM public.read_admin_user_management_metadata(ARRAY['{ACTOR}','{OTHER}']::uuid[]);",role='service_role')
        self.assertEqual(result.stdout.strip(),'t')
        guard='DO $check$ DECLARE '+plan.DECLARATIONS+' BEGIN '+plan.section('DEPENDENCY')+' END $check$;'
        self.assertIn('rls_visibility_denied',self.sql('SET search_path=pg_catalog;'+guard,check=False).stderr)

    def test_dependency_mutations_fail_without_installing(self):
        cases=[('DROP POLICY owner_all ON public.profiles;','rls_visibility'),('CREATE POLICY subset ON public.profiles AS RESTRICTIVE TO privacy_workflow_owner USING(false);','rls_visibility'),('ALTER TABLE public.profiles DROP CONSTRAINT profiles_user_id_key;','join_key'),('REVOKE SELECT ON public.profiles FROM privacy_workflow_owner;','column_dependency'),('ALTER TABLE public.admin_audit_events DISABLE TRIGGER g014_admin_audit_events_append_only;','audit_contract'),('ALTER TABLE public.admin_audit_events ALTER COLUMN id DROP DEFAULT;','default_dependency'),("ALTER FUNCTION public.admin_user_audit_counts_are_safe(jsonb) VOLATILE;",'helper_denied')]
        for mutation,code in cases:
            with self.subTest(mutation=mutation):
                result=self.sql('BEGIN;'+mutation+'SET SESSION AUTHORIZATION postgres;'+plan.source(),check=False)
                self.assertNotEqual(result.returncode,0);self.assertIn(code,result.stderr)
                self.verify_absent()

    def test_insert_privilege_and_restrictive_insert_policy_denied(self):
        # Owned table grants are intrinsic; emulate an owner with INSERT revoked from self.
        self.sql('REVOKE INSERT ON public.admin_audit_events FROM privacy_workflow_owner;')
        self.assertIn('column_dependency_denied',self.apply(check=False).stderr)
        self.sql('GRANT INSERT ON public.admin_audit_events TO privacy_workflow_owner;')
        self.sql('CREATE POLICY partial_insert ON public.admin_audit_events AS RESTRICTIVE FOR INSERT TO privacy_workflow_owner WITH CHECK(false);')
        self.assertIn('rls_visibility_denied',self.apply(check=False).stderr)

    def test_g014_before_after_and_sqlstate_collision_restore(self):
        for predicate in ['true',"to_regprocedure('public.read_admin_user_audit_events(integer)') IS NOT NULL"]:
            original=self.sql("SELECT pg_get_functiondef('privacy_retention.assert_g014_catalog_contract()'::regprocedure);").stdout
            self.sql("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF "+predicate+" THEN RAISE EXCEPTION 'forced_g014_failure'; END IF; END $$;")
            self.assertIn('forced_g014_failure',self.apply(check=False).stderr);self.verify_absent()
            self.sql(original)

    def test_membership_drift_and_lock_timeout(self):
        self.sql('GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;',role='postgres')
        try: self.assertIn('membership_admission_denied',self.apply(check=False).stderr)
        finally: self.sql('GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;',role='postgres')
        child=subprocess.Popen(['docker','exec','-i',self.container,'psql','-XAtq','-h','127.0.0.1','-U','bootstrap','-d',self.db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            child.stdin.write("BEGIN; LOCK TABLE public.admin_audit_events IN ACCESS EXCLUSIVE MODE; SELECT 'locked'; SELECT pg_sleep(4); ROLLBACK;\n");child.stdin.flush()
            self.assertEqual(child.stdout.readline().strip(),'locked')
            self.assertIn('lock timeout',self.apply(check=False).stderr)
            child.stdin.close();child.wait(timeout=10);self.verify_absent()
        finally:
            if child.poll() is None: child.kill();child.wait()
            child.stdout.close();child.stderr.close()

    def test_atomic_planner_real_group_snapshot_and_history(self):
        first=re.search(r'CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management\(\).*?END\n\$\$;',plan.PREDECESSOR.read_text(),re.S).group()
        self.sql(first+"ALTER FUNCTION public.read_admin_user_ids_for_management() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role; INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public','read_admin_user_ids_for_management','','service_role','public.read_admin_user_ids_for_management()');")
        self.sql('CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;')
        for i in range(51): self.sql(f"INSERT INTO supabase_migrations.schema_migrations VALUES('{str(i).zfill(14)}','fixture_{i}',ARRAY[]::text[]);")
        self.sql(f"INSERT INTO supabase_migrations.schema_migrations VALUES('{plan.FIRST_VERSION}','{plan.FIRST_NAME}',ARRAY['fixture']::text[]);")
        # Preserve real ledger and group catalog. Only broader advisor projection is a fixture.
        a={k:False for k in plan.baseline.SNAP_KEYS};a.update(executor_ok=True,constraints_valid=4,function_paths_fixed=26,touch_ok=True)
        advisor_sql=f"SELECT jsonb_set({plan.literal(plan.canonical(a))}::jsonb,'{{ledger}}',({plan.baseline.LEDGER_SQL}))"
        with patch.object(plan.baseline,'snapshot_sql',return_value=advisor_sql):
            before=json.loads(self.sql(plan.snapshot_sql()+';').stdout)
            with patch.object(plan,'CURRENT52_SNAPSHOT_SHA256',plan.sha(plan.canonical(before).encode())):
                p=plan.preview(before)
                self.sql("UPDATE supabase_migrations.schema_migrations SET name='drift' WHERE version='00000000000003';")
                self.assertIn('preview_drift',self.sql(plan.plan(p,'rehearse'),role='postgres',check=False).stderr)
                self.sql("UPDATE supabase_migrations.schema_migrations SET name='fixture_3' WHERE version='00000000000003';")
                original=self.sql("SELECT pg_get_functiondef('privacy_retention.assert_g014_catalog_contract()'::regprocedure);").stdout
                self.sql("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='ZP003',MESSAGE='fixture_collision'; END $$;")
                collision_snapshot=json.loads(self.sql(plan.snapshot_sql()+';').stdout)
                with patch.object(plan,'CURRENT52_SNAPSHOT_SHA256',plan.sha(plan.canonical(collision_snapshot).encode())):
                    collision_plan=plan.preview(collision_snapshot)
                    result=self.sql(plan.plan(collision_plan,'rehearse'),role='postgres',check=False)
                    self.assertIn('rehearsal_did_not_finish',result.stderr)
                    self.assertEqual(json.loads(self.sql(plan.snapshot_sql()+';').stdout),collision_snapshot)
                self.sql(original)
                rehearsal=self.sql(plan.plan(p,'rehearse'),role='postgres')
                self.assertEqual(json.loads(rehearsal.stdout),plan.receipt(p))
                self.assertEqual(json.loads(self.sql(plan.snapshot_sql()+';').stdout),before);self.verify_absent()
                self.sql(plan.plan(p,'apply',plan.receipt(p)),role='postgres')
                self.assertEqual(self.sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').stdout.strip(),'53')
                self.assertEqual(self.sql(f"SELECT statements=ARRAY[{','.join(plan.literal(s) for s in plan.vectors())}]::text[] FROM supabase_migrations.schema_migrations WHERE version='{plan.VERSION}';").stdout.strip(),'t')
                self.assertIn('preview_drift',self.sql(plan.plan(p,'apply',plan.receipt(p)),role='postgres',check=False).stderr)
                after=json.loads(self.sql(plan.snapshot_sql()+';').stdout)
                self.assertEqual(after['group'],before['group'])
                self.assertEqual(after['advisor']['ledger'][:-1],before['advisor']['ledger'])
                empty=self.sql(plan.plan(p,'readback'),role='postgres')
                self.assertTrue(all(json.loads(empty.stdout).values()))
                self.seed()
                self.sql(self.append(),role='service_role')
                populated=self.sql(plan.plan(p,'readback'),role='postgres')
                self.assertTrue(all(json.loads(populated.stdout).values()))
                self.assertEqual(self.count(),'1')
                # Invalid-input hosted-style readback must never append an audit row.
                self.sql("CREATE POLICY unexpected ON public.profiles TO authenticated USING(false);")
                self.assertIn('readback_drift',self.sql(plan.plan(p,'readback'),role='postgres',check=False).stderr)

if __name__=='__main__': unittest.main()
