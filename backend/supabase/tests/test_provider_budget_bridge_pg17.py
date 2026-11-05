"""Owned PG17 regression for the G014 provider-budget execution boundary.

Real SQL/roles/RLS; synthetic auth rows. This is not full G014, hosted PG17.6,
PostgREST, provider quota, release-admission or a proof over all schedules.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import unittest
import uuid

try:
    import psycopg2
except ImportError:
    psycopg2 = None

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/opt/homebrew/Cellar/postgresql@17/17.11_1/bin')
ORIGINAL = ROOT/'backend/supabase/migrations/20260713000300_g013_admin_provider_budgets.sql'
CANDIDATE = ROOT/'backend/supabase/candidates/20261024_provider_budget_private_bridge.sql'
SOURCES = [ORIGINAL, CANDIDATE, Path(__file__).resolve()]


class ProviderBudgetBridgePg17(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if psycopg2 is None or not all((PG/n).is_file() for n in ['initdb','pg_ctl','postgres']):
            raise unittest.SkipTest('installed pinned PG17 and project psycopg2 required; no installation')
        cls.version = subprocess.check_output([str(PG/'postgres'),'--version'],text=True).strip()
        if cls.version != 'postgres (PostgreSQL) 17.11 (Homebrew)':
            raise unittest.SkipTest('PG17 pin mismatch')
        cls.root = Path(tempfile.mkdtemp(prefix='provider-budget-pg17-',dir='/private/tmp'))
        cls.data = cls.root/'data'; cls.sock = cls.root/'socket'; cls.sock.mkdir(mode=0o700)
        cls.env = {'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
        cls.hashes = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        cls.observations = {}
        with socket.socket() as s:
            s.bind(('127.0.0.1',0)); cls.port = s.getsockname()[1]
        with (cls.root/'init.log').open('w') as log:
            subprocess.run([str(PG/'initdb'),'-D',str(cls.data),'-U','postgres','--no-locale','--encoding=UTF8',
                            '--auth-local=trust','--auth-host=trust'],env=cls.env,stdout=log,stderr=subprocess.STDOUT,check=True)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-l',str(cls.root/'postgres.log'),'-o',
                        f'-h 127.0.0.1 -p {cls.port} -k {cls.sock}','-w','start'],env=cls.env,stdout=subprocess.DEVNULL,check=True)
        cls.pid = int((cls.data/'postmaster.pid').read_text().splitlines()[0])
        cls.addClassCleanup(cls.cleanup)
        with cls.connect(user='postgres') as c,c.cursor() as q:
            q.execute('CREATE ROLE budget_bootstrap LOGIN SUPERUSER')
        with cls.connect() as c,c.cursor() as q:
            q.execute('ALTER ROLE postgres RENAME TO original_bootstrap;'
                      'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS NOINHERIT;'
                      'CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT NOBYPASSRLS;'
                      'CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;'
                      'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;'
                      'GRANT service_role,anon,authenticated TO postgres WITH INHERIT FALSE, SET TRUE;')
        print('PROVIDER_BUDGET_PG17_EVIDENCE='+str(cls.root),flush=True)

    @classmethod
    def connect(cls, db='postgres', user='budget_bootstrap'):
        return psycopg2.connect(host='127.0.0.1',port=cls.port,user=user,dbname=db,connect_timeout=3)

    @classmethod
    def cleanup(cls):
        pidfile = cls.data/'postmaster.pid'
        if not pidfile.exists() or int(pidfile.read_text().splitlines()[0]) != cls.pid:
            raise RuntimeError('OWNED_PG_PID_MISMATCH')
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'-m','fast','-w','stop'],env=cls.env,stdout=subprocess.DEVNULL,check=True)
        status = subprocess.run([str(PG/'pg_ctl'),'-D',str(cls.data),'status'],env=cls.env,capture_output=True).returncode
        with socket.socket() as s: closed = s.connect_ex(('127.0.0.1',cls.port)) != 0
        cleanup = {'ownedPid':cls.pid,'statusExit':status,'pidFileAbsent':not pidfile.exists(),
                   'socketAbsent':not (cls.sock/f'.s.PGSQL.{cls.port}').exists(),'tcpClosed':closed}
        after = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        (cls.root/'receipt.json').write_text(json.dumps({'version':cls.version,'sourceBefore':cls.hashes,'sourceAfter':after,
            'sourceStable':after==cls.hashes,'cases':cls.observations,'cleanup':cleanup,'hostedWrites':0,'providerCalls':0,'limits':__doc__},indent=2)+'\n')
        if status != 3 or not all(cleanup[k] for k in ['pidFileAbsent','socketAbsent','tcpClosed']):
            raise RuntimeError('OWNED_PG_CLEANUP_FAILED')
        if after != cls.hashes: raise RuntimeError('SOURCE_CHANGED_DURING_CHECK')

    def setUp(self):
        self.db = 'budget_'+uuid.uuid4().hex[:12]
        c=self.connect()
        try:
            c.autocommit=True
            with c.cursor() as q:q.execute('CREATE DATABASE '+self.db+' OWNER postgres')
        finally:c.close()
        self.addCleanup(self.drop_database)
        self.admin,self.other,self.user,self.inactive = [str(uuid.uuid4()) for _ in range(4)]
        with self.connect(self.db,user='postgres') as c,c.cursor() as q:
            q.execute("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);"
                      "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;"
                      "GRANT USAGE ON SCHEMA auth,public TO privacy_workflow_owner; GRANT CREATE ON SCHEMA public TO privacy_workflow_owner;"
                      "CREATE TABLE public.user_roles(user_id uuid,role text); CREATE TABLE public.user_account_status(user_id uuid,account_status text);"
                      "GRANT SELECT ON public.user_roles,public.user_account_status TO privacy_workflow_owner;")
            q.execute(ORIGINAL.read_text())
            for actor,role,status in [(self.admin,'admin','active'),(self.other,'admin','active'),(self.user,'user','active'),(self.inactive,'admin','inactive')]:
                q.execute('INSERT INTO auth.users VALUES(%s); INSERT INTO public.user_roles VALUES(%s,%s); INSERT INTO public.user_account_status VALUES(%s,%s)',
                          (actor,actor,role,actor,status))
        with self.connect(self.db) as c,c.cursor() as q:
            q.execute('ALTER FUNCTION public.reserve_admin_provider_budget(uuid,text,uuid) OWNER TO privacy_workflow_owner')

    def drop_database(self):
        c=self.connect()
        try:
            c.autocommit=True
            with c.cursor() as q:q.execute('DROP DATABASE '+self.db)
        finally:c.close()

    def install(self, tail='', rollback=False):
        if os.environ.get('TZUDONG_BUDGET_UNFIXED') == '1': return
        c = self.connect(self.db,user='postgres')
        try:
            with c.cursor() as q:q.execute(CANDIDATE.read_text()+tail)
            c.rollback() if rollback else c.commit()
        finally:c.close()

    def call(self, actor=None, provider='naver_directions', operation=None, claim='service_role', role='service_role'):
        with self.connect(self.db,user='postgres') as c,c.cursor() as q:
            q.execute('SET LOCAL ROLE '+role+"; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='5s'")
            q.execute("SELECT set_config('request.jwt.claim.role',%s,true)",(claim,))
            q.execute('SELECT * FROM public.reserve_admin_provider_budget(%s,%s,%s)',
                      (actor or self.admin,provider,operation or str(uuid.uuid4())))
            return q.fetchone()

    def scalar(self, sql):
        with self.connect(self.db) as c,c.cursor() as q:
            q.execute(sql);return q.fetchone()[0]

    def snapshot(self):
        return self.scalar("""SELECT jsonb_build_object(
          'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
          'roles',(SELECT jsonb_agg(jsonb_build_object('role',rolname,'super',rolsuper,'inherit',rolinherit,'bypass',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','privacy_workflow_owner','service_role','anon','authenticated')),
          'publicFunction',(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='public.reserve_admin_provider_budget(uuid,text,uuid)'::regprocedure),
          'counterFunction',(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid='provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure),
          'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'acl',relacl,'owner',relowner,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='provider_budget_private'::regnamespace AND relkind='r'),
          'rlsPolicies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p WHERE polrelid IN (SELECT oid FROM pg_class WHERE relnamespace='provider_budget_private'::regnamespace)),
          'defaults',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.oid) FROM pg_default_acl a))""")

    def test_allows_directions_with_unchanged_public_contract(self):
        before=self.snapshot(); self.install()
        self.assertEqual((True,0),self.call())
        self.assertEqual(before,self.snapshot())
        self.assertEqual([20,200,10000],self.scalar("SELECT jsonb_build_array(actor_per_minute,global_per_minute,global_per_day) FROM provider_budget_private.admin_provider_budget_policies WHERE provider='naver_directions'"))
        self.assertEqual(0,self.scalar("SELECT count(*) FROM provider_budget_private.admin_provider_budget_policies WHERE provider='openai_sponsor_analysis'"))
        self.observations['healthy']={'allowed':True,'publicMetadataAndExistingAclRlsRolesUnchanged':True,'directionsCeilings':[20,200,10000],'otherLlmPoliciesAdded':0}

    def test_original_owner_failure_and_original_exceeded_counter_failure(self):
        with self.assertRaises(psycopg2.Error) as caught:self.call(provider='naver_local_search')
        self.assertEqual('42501',caught.exception.pgcode)
        with self.assertRaises(psycopg2.Error) as counter:
            with self.connect(self.db,user='postgres') as c,c.cursor() as q:
                q.execute("SELECT * FROM provider_budget_private.consume_admin_provider_counter('naver_local_search','actor_minute','synthetic',1,clock_timestamp(),clock_timestamp()+interval '1 minute')")
        self.assertEqual('42883',counter.exception.pgcode)
        self.observations['originalFailures']={'publicOwnerSqlstate':'42501','firstCounterCallSqlstate':'42883','directionsPolicyAbsent':self.scalar("SELECT count(*)=0 FROM provider_budget_private.admin_provider_budget_policies WHERE provider='naver_directions'")}

    def test_replay_and_cross_binding(self):
        self.install(); operation=str(uuid.uuid4());self.assertEqual((True,0),self.call(operation=operation))
        before=self.scalar('SELECT sum(request_count) FROM provider_budget_private.admin_provider_budget_counters')
        self.assertEqual((True,0),self.call(operation=operation))
        self.assertEqual(before,self.scalar('SELECT sum(request_count) FROM provider_budget_private.admin_provider_budget_counters'))
        for change in [{'actor':self.other},{'provider':'naver_geocode'}]:
            with self.assertRaises(psycopg2.Error) as caught:self.call(operation=operation,**change)
            self.assertEqual('22023',caught.exception.pgcode)
        self.observations['replay']={'extraCounterIncrement':0,'crossActorProviderDenied':2}

    def test_parallel_same_operation_only_counts_once(self):
        self.install(); operation=str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:self.call(operation=operation),range(16)))
        self.assertEqual([(True,0)]*16,results)
        self.assertEqual(1,self.scalar('SELECT count(*) FROM provider_budget_private.admin_provider_budget_decisions'))
        self.assertEqual([1,1,1],self.scalar('SELECT jsonb_agg(request_count ORDER BY scope) FROM provider_budget_private.admin_provider_budget_counters'))
        self.observations['sameOperationConcurrency']={'calls':16,'decisions':1,'counterValues':[1,1,1]}

    def test_parallel_unique_operations_enforce_actor_ceiling(self):
        self.install()
        with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:self.call(),range(40)))
        self.assertEqual(20,sum(1 for allowed,_ in results if allowed))
        self.assertTrue(all(1<=retry<=60 for allowed,retry in results if not allowed))
        self.assertEqual(40,self.scalar('SELECT count(*) FROM provider_budget_private.admin_provider_budget_decisions'))
        self.observations['actorCeilingConcurrency']={'calls':40,'allowed':20,'denied':20}

    def test_global_minute_and_day_ceilings(self):
        self.install()
        for scope,limit,key in [('global_minute',200,"'global'"),('global_day',10000,"(clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date::text")]:
            with self.connect(self.db,user='postgres') as c,c.cursor() as q:
                q.execute('DELETE FROM provider_budget_private.admin_provider_budget_counters; DELETE FROM provider_budget_private.admin_provider_budget_decisions')
                q.execute("INSERT INTO provider_budget_private.admin_provider_budget_counters VALUES('naver_directions',%s,"+key+",%s,clock_timestamp(),clock_timestamp()+interval '1 day')",(scope,limit))
            allowed,retry=self.call();self.assertFalse(allowed);self.assertTrue(1<=retry<=86400)
        self.observations['globalCeilings']={'minute':200,'day':10000,'overCeilingDenied':2}

    def test_claim_actor_and_browser_denials(self):
        self.install();denials=0
        for kwargs in [{'claim':''},{'claim':'authenticated'},{'actor':self.user},{'actor':self.inactive},{'role':'anon'},{'role':'authenticated'}]:
            with self.assertRaises(psycopg2.Error) as caught:self.call(**kwargs)
            self.assertEqual('42501',caught.exception.pgcode);denials+=1
        self.assertEqual(0,self.scalar('SELECT count(*) FROM provider_budget_private.admin_provider_budget_decisions'))
        self.observations['authorization']={'deniedCases':denials,'newDecisions':0}

    def test_private_table_and_helper_are_not_directly_exposed(self):
        self.install()
        for role in ['anon','authenticated','service_role','privacy_workflow_owner']:
            self.assertFalse(self.scalar("SELECT has_table_privilege('"+role+"','provider_budget_private.admin_provider_budget_policies','SELECT')"))
        for role in ['anon','authenticated','service_role']:
            self.assertFalse(self.scalar("SELECT has_function_privilege('"+role+"','provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)','EXECUTE')"))
        self.assertTrue(self.scalar("SELECT has_schema_privilege('privacy_workflow_owner','provider_budget_private','USAGE')"))
        self.assertFalse(self.scalar("SELECT has_schema_privilege('privacy_workflow_owner','provider_budget_private','CREATE')"))
        self.observations['privateBoundary']={'tableReadersAdded':0,'browserOrServiceCoreExecute':0,'workflowSchemaCreate':False}

    def test_policy_immutability_and_unknown_provider_remain_denied(self):
        self.install()
        with self.assertRaises(psycopg2.Error):
            with self.connect(self.db,user='postgres') as c,c.cursor() as q:q.execute("UPDATE provider_budget_private.admin_provider_budget_policies SET actor_per_minute=99")
        for provider in ['unknown','openai_sponsor_analysis']:
            with self.assertRaises(psycopg2.Error) as caught:self.call(provider=provider)
            self.assertEqual('22023',caught.exception.pgcode)

    def test_rollback_and_late_failure_preserve_preimage(self):
        before=self.snapshot();self.install(rollback=True);self.assertEqual(before,self.snapshot())
        self.assertIsNone(self.scalar("SELECT to_regprocedure('provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)')"))
        with self.assertRaises(psycopg2.Error):self.install(tail=';SELECT 1/0;')
        self.assertEqual(before,self.snapshot())
        self.assertEqual(3,self.scalar('SELECT count(*) FROM provider_budget_private.admin_provider_budget_policies'))
        self.observations['atomicRollback']={'rehearsalAndLateFailureUnchanged':True,'policies':3}

    def test_reapplication_and_source_drift_fail_without_changes(self):
        self.install();before=self.snapshot()
        with self.assertRaises(psycopg2.Error) as caught:self.install()
        self.assertEqual('55000',caught.exception.pgcode);self.assertEqual(before,self.snapshot())

    def test_missing_executor_lease_is_denied_without_changes(self):
        with self.connect(self.db) as c,c.cursor() as q:q.execute('REVOKE privacy_workflow_owner FROM postgres')
        try:
            before=self.snapshot()
            with self.assertRaises(psycopg2.Error) as caught:self.install()
            self.assertEqual('42501',caught.exception.pgcode);self.assertEqual(before,self.snapshot())
        finally:
            with self.connect() as c,c.cursor() as q:
                q.execute('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE')

    def test_preexisting_policy_drift_is_not_overwritten(self):
        with self.connect(self.db,user='postgres') as c,c.cursor() as q:
            q.execute("ALTER TABLE provider_budget_private.admin_provider_budget_policies DISABLE TRIGGER admin_provider_budget_policies_immutable;"
                      "UPDATE provider_budget_private.admin_provider_budget_policies SET actor_per_minute=59 WHERE provider='naver_geocode';"
                      "ALTER TABLE provider_budget_private.admin_provider_budget_policies ENABLE TRIGGER admin_provider_budget_policies_immutable")
        with self.assertRaises(psycopg2.Error) as caught:self.install()
        self.assertEqual('55000',caught.exception.pgcode)
        self.assertEqual(59,self.scalar("SELECT actor_per_minute FROM provider_budget_private.admin_provider_budget_policies WHERE provider='naver_geocode'"))
        self.assertIsNone(self.scalar("SELECT to_regprocedure('provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)')"))

    def test_private_acl_or_rls_drift_is_not_admitted(self):
        for change,restore in [
            ('GRANT SELECT ON provider_budget_private.admin_provider_budget_policies TO service_role',
             'REVOKE SELECT ON provider_budget_private.admin_provider_budget_policies FROM service_role'),
            ('ALTER TABLE provider_budget_private.admin_provider_budget_policies NO FORCE ROW LEVEL SECURITY',
             'ALTER TABLE provider_budget_private.admin_provider_budget_policies FORCE ROW LEVEL SECURITY'),
        ]:
            with self.connect(self.db,user='postgres') as c,c.cursor() as q:q.execute(change)
            try:
                before=self.snapshot()
                with self.assertRaises(psycopg2.Error) as caught:self.install()
                self.assertEqual('55000',caught.exception.pgcode);self.assertEqual(before,self.snapshot())
            finally:
                with self.connect(self.db,user='postgres') as c,c.cursor() as q:q.execute(restore)

    def test_removed_claim_guard_is_a_reachable_negative_control(self):
        self.install()
        with self.connect(self.db,user='postgres') as c,c.cursor() as q:
            q.execute("SELECT pg_get_functiondef('provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)'::regprocedure)")
            source=q.fetchone()[0]
            broken=source.replace("auth.role() IS DISTINCT FROM 'service_role'",'false')
            self.assertNotEqual(source,broken);q.execute(broken)
        self.assertEqual((True,0),self.call(claim=''))
        self.observations['claimGuardNegativeControl']={'removedGuardAdmittedNullClaim':True,'mutatedFiles':0}

    def test_qualified_greatest_is_a_reachable_negative_control(self):
        self.install()
        with self.connect(self.db,user='postgres') as c,c.cursor() as q:
            q.execute("SELECT pg_get_functiondef('provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure)")
            source=q.fetchone()[0];broken=source.replace('GREATEST(','pg_catalog.greatest(')
            self.assertNotEqual(source,broken);q.execute(broken)
        with self.assertRaises(psycopg2.Error) as caught:self.call()
        self.assertEqual('42883',caught.exception.pgcode)
        self.observations['counterNegativeControl']={'restoredQualifiedSyntaxSqlstate':'42883','mutatedFiles':0}


if __name__ == '__main__':unittest.main(verbosity=2)
