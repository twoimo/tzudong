"""Opt-in private PostgreSQL17/pgvector container, network disabled, no host DB.

Fixture is production-shaped (non-super postgres, owner-only G014 helpers,
real catalog-manifest projection/assertion, exact signature identities), NOT a
production dump. Historical ledger rows and application bodies are synthetic.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).parents[1]/'scripts'))
import advisor_successor_plan as a

IMAGE='pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f'

@unittest.skipUnless(os.environ.get('TZUDONG_ADVISOR_PG17_TEST')=='1','private docker PG17 opt-in absent')
class PostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container='advisor-successor-test-'+uuid.uuid4().hex[:12]
        subprocess.run(['docker','run','--detach','--rm','--network','none','--name',cls.container,
                        '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=fixture_admin',
                        '-e','POSTGRES_DB=postgres',IMAGE],check=True,capture_output=True)
        cls.addClassCleanup(lambda: subprocess.run(['docker','stop',cls.container],capture_output=True))
        for _ in range(100):
            r=subprocess.run(['docker','exec',cls.container,'pg_isready','-U','fixture_admin'],capture_output=True)
            pid=subprocess.run(['docker','exec',cls.container,'cat','/proc/1/comm'],capture_output=True,text=True)
            if r.returncode==0 and pid.stdout.strip()=='postgres': break
            time.sleep(.1)
        else: raise AssertionError('private PG17 startup failed')
        cls.sql('CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE privacy_workflow_owner NOLOGIN; GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT TRUE, SET TRUE; ALTER DATABASE postgres OWNER TO postgres;',admin=True)

    @classmethod
    def command(cls,admin=False):
        return ['docker','exec','-i',cls.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',
                'fixture_admin' if admin else 'postgres','-d','postgres']

    @classmethod
    def sql(cls,text,admin=False,ok=True):
        r=subprocess.run(cls.command(admin),input=text,text=True,capture_output=True,timeout=60)
        if ok and r.returncode: raise AssertionError(r.stderr)
        if not ok and not r.returncode: raise AssertionError('expected denial')
        return r

    def snapshot(self):
        return json.loads(self.sql(a.preview_sql()).stdout)

    def setUp(self):
        self.sql('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS privacy_retention CASCADE; DROP SCHEMA IF EXISTS supabase_migrations CASCADE; CREATE SCHEMA public AUTHORIZATION postgres; CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner; CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; CREATE EXTENSION vector SCHEMA public; GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner;',admin=True)
        self.sql("CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL,statements text[] NOT NULL); INSERT INTO supabase_migrations.schema_migrations SELECT (20260101000000+i)::text,'fixture_'||i, CASE WHEN i%7=0 THEN ARRAY[]::text[] ELSE ARRAY['SELECT '||i] END FROM generate_series(0,48)i; INSERT INTO supabase_migrations.schema_migrations VALUES ('20260804000500','fixture_terminal',ARRAY[]::text[]);")
        for signature in a.signatures():
            if 'touch_admin_workflow' not in signature:
                self.sql(f'CREATE FUNCTION {signature} RETURNS integer LANGUAGE sql AS $$SELECT 1$$; REVOKE ALL ON FUNCTION {signature} FROM PUBLIC,anon,authenticated,service_role;')
        source=a.SOURCE.read_text()
        self.sql(source[:source.index('DO $harden_functions$')])
        # Real immutable manifest implementation, bounded fixture protected relations.
        self.sql("SET ROLE privacy_workflow_owner; CREATE TABLE public.admin_audit_events(ok boolean); CREATE TABLE public.account_deletion_requests(ok boolean); CREATE TABLE public.account_deletion_request_items(ok boolean); CREATE TABLE privacy_retention.g014_catalog_contract_manifest(manifest_kind text NOT NULL,manifest_key jsonb NOT NULL,manifest_value jsonb NOT NULL,PRIMARY KEY(manifest_kind,manifest_key));")
        for table,name in a.CONSTRAINTS:
            self.sql(f'SET ROLE privacy_workflow_owner; ALTER TABLE public.{table} ADD CONSTRAINT {name} CHECK(ok) NOT VALID;')
        sql="""SET ROLE privacy_workflow_owner;
CREATE FUNCTION privacy_retention.g014_catalog_protected_relations() RETURNS TABLE(schema_name name,relation_name name) LANGUAGE sql AS $$VALUES ('public'::name,'admin_audit_events'::name),('public','account_deletion_requests'),('public','account_deletion_request_items')$$;
CREATE FUNCTION privacy_retention.g014_account_deletion_append_only() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable'; END$$;
CREATE TRIGGER g014_catalog_manifest_immutable BEFORE UPDATE OR DELETE ON privacy_retention.g014_catalog_contract_manifest FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_append_only();
"""
        catalog=(a.ROOT/'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql').read_text()
        for function in ('g014_catalog_manifest_rows','assert_g014_catalog_manifest'):
            start=catalog.index('CREATE OR REPLACE FUNCTION privacy_retention.'+function+'()')
            end=catalog.index('$function$;',start)+len('$function$;')
            sql+=catalog[start:end]+'\n'
            sql+=f'REVOKE ALL ON FUNCTION privacy_retention.{function}() FROM PUBLIC,anon,authenticated,service_role;\n'
        for relation in ('public.admin_audit_events','public.account_deletion_requests','public.account_deletion_request_items','privacy_retention.g014_catalog_contract_manifest'):
            sql+=f'ALTER TABLE {relation} ENABLE ROW LEVEL SECURITY; ALTER TABLE {relation} FORCE ROW LEVEL SECURITY; CREATE POLICY fixture_owner ON {relation} TO privacy_workflow_owner USING (true) WITH CHECK (true);\n'
        sql+='INSERT INTO privacy_retention.g014_catalog_contract_manifest SELECT * FROM privacy_retention.g014_catalog_manifest_rows();'
        self.sql(sql)
        self.before=self.snapshot()
        self.preview=a.preview({'schema':'hosted-current50-ledger-metadata-v1','projectId':a.PROJECT,'ledger':self.before['ledger']},self.before)

    def rehearse(self):
        r=self.sql(a.plan(self.preview,'rehearse'))
        receipt=json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(receipt['status'],'rehearsed-rolled-back')
        self.assertEqual(self.snapshot(),self.before)
        return receipt

    def test_real_rehearsal_apply_readback_and_second_apply_denied(self):
        receipt=self.rehearse()
        sql=a.plan(self.preview,'apply',receipt)
        self.sql(sql)
        after=self.snapshot()
        self.assertEqual(after['ledger'][:-1],self.before['ledger'])
        self.assertEqual(after['ledger'][-1]['statement_count'],17)
        self.assertEqual(after['constraints_valid'],4)
        self.assertEqual(after['function_paths_fixed'],26)
        self.assertEqual(after['membership'],self.before['membership'])
        self.sql(a.plan(self.preview,'readback'))
        self.sql(sql,ok=False)
        self.assertEqual(self.snapshot(),after)

    def test_constraint_violation_rolls_back_no_raw_row_diagnostic(self):
        self.sql('SET ROLE privacy_workflow_owner; ALTER TABLE public.admin_audit_events DROP CONSTRAINT admin_audit_events_whitelisted_contract; INSERT INTO public.admin_audit_events VALUES(false); ALTER TABLE public.admin_audit_events ADD CONSTRAINT admin_audit_events_whitelisted_contract CHECK(ok) NOT VALID; ALTER TABLE privacy_retention.g014_catalog_contract_manifest DISABLE TRIGGER g014_catalog_manifest_immutable; DELETE FROM privacy_retention.g014_catalog_contract_manifest; INSERT INTO privacy_retention.g014_catalog_contract_manifest SELECT * FROM privacy_retention.g014_catalog_manifest_rows(); ALTER TABLE privacy_retention.g014_catalog_contract_manifest ENABLE TRIGGER g014_catalog_manifest_immutable;')
        self.before=self.snapshot();self.preview['snapshot']=self.before
        result=self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertIn('advisor_successor_denied',result.stderr)
        self.assertNotIn('is violated by some row',result.stderr)
        self.assertEqual(self.snapshot(),self.before)

    def test_stale_catalog_and_ledger_refused(self):
        self.sql("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['changed'] WHERE version='20260804000500';")
        changed=self.snapshot()
        self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertEqual(self.snapshot(),changed)

    def test_failure_after_ddl_before_ledger_insert_rolls_everything_back(self):
        self.sql("CREATE FUNCTION public.fixture_deny_ledger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture-private-diagnostic'; END$$; CREATE TRIGGER fixture_deny_ledger BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.fixture_deny_ledger();")
        result=self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertIn('advisor_successor_denied',result.stderr)
        self.assertNotIn('fixture-private-diagnostic',result.stderr)
        self.assertEqual(self.snapshot(),self.before)

    def test_catalog_drift_and_lock_contention_are_fail_closed(self):
        self.sql('GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO authenticated;')
        changed=self.snapshot()
        self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertEqual(self.snapshot(),changed)
        self.sql('REVOKE EXECUTE ON FUNCTION public.extract_youtube_video_id(text) FROM authenticated;')
        holder=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        try:
            holder.stdin.write("BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE; SELECT 'locked';\n")
            holder.stdin.flush()
            self.assertEqual(holder.stdout.readline().strip(),'locked')
            result=self.sql(a.plan(self.preview,'rehearse'),ok=False)
            self.assertIn('lock timeout',result.stderr)
        finally:
            holder.stdin.write('ROLLBACK;\n');holder.stdin.close();holder.stdin=None
            holder.communicate(timeout=20)
        self.assertEqual(self.snapshot(),self.before)

    def test_missing_actual_function_is_denied_without_recovery(self):
        self.sql('DROP FUNCTION public.extract_youtube_video_id(text);')
        changed=self.snapshot()
        self.assertEqual(changed['function_count'],25)
        with self.assertRaises(a.Denied): a.validate_snapshot(changed)
        self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertEqual(self.snapshot(),changed)

    def test_missing_actual_constraint_is_denied_without_recovery(self):
        self.sql('SET ROLE privacy_workflow_owner; ALTER TABLE public.admin_audit_events DROP CONSTRAINT admin_audit_events_whitelisted_contract;')
        changed=self.snapshot()
        self.assertEqual(changed['constraint_count'],3)
        with self.assertRaises(a.Denied): a.validate_snapshot(changed)
        self.sql(a.plan(self.preview,'rehearse'),ok=False)
        self.assertEqual(self.snapshot(),changed)

    def test_owner_privilege_denial_is_atomic(self):
        self.sql('GRANT privacy_workflow_owner TO postgres WITH INHERIT FALSE;',admin=True)
        try:
            self.sql(a.plan(self.preview,'rehearse'),ok=False)
            self.assertEqual(self.sql('SELECT count(*) FROM supabase_migrations.schema_migrations').stdout.strip(),'50')
        finally:
            self.sql('GRANT privacy_workflow_owner TO postgres WITH INHERIT TRUE;',admin=True)

    def test_concurrent_apply_only_one_commits(self):
        receipt=self.rehearse(); sql=a.plan(self.preview,'apply',receipt)
        first=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        second=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        first.stdin.write(sql);first.stdin.close();first.stdin=None
        second.stdin.write(sql);second.stdin.close();second.stdin=None
        first.communicate(timeout=60);second.communicate(timeout=60)
        self.assertEqual(sorted([first.returncode,second.returncode]),[0,3])
        self.sql(a.plan(self.preview,'readback'))

if __name__=='__main__': unittest.main()
