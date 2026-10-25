"""Owned PG17.11 registration checks using actual queue SQL and G014 bodies.

The complete hosted G014 prerequisite graph and hosted PG17.6 are NOT executed.
Two extracted, byte-matched invoker branches supplement actual metadata/rollback
checks; they are not a replacement for the full pre/post G014 release gate.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

try:
    import psycopg2
except ImportError:
    psycopg2 = None

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/opt/homebrew/Cellar/postgresql@17/17.11_1/bin')
SELF = Path(__file__).resolve()
SQL = ROOT/'backend/supabase/candidates/20261024_thumbnail_g014_registration.sql'
QUEUE = ROOT/'backend/supabase/candidates/20261023_thumbnail_gemini_queue.sql'
PREIMAGE = ROOT/'backend/supabase/tests/fixtures/thumbnail-g014-hosted-preimage-20261024.json'
BRIDGE = ROOT/'backend/supabase/migrations/20261003182338_storyboard_service_role_bridge.sql'
SOURCES = [SELF, SQL, QUEUE, PREIMAGE, BRIDGE]
SIGNATURES = [
    'public.thumbnail_production_auth_worker(text)',
    'public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)',
    'public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)',
]
BOOTSTRAP = 'thumbnail_g014_bootstrap'
APPROVERS = ['privacy_retention_operator_approver', 'privacy_retention_legal_approver',
             'privacy_retention_activation_operator']


class ThumbnailG014Pg17(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if psycopg2 is None or sys.platform != 'darwin' or not all((PG/name).is_file() for name in ['initdb', 'pg_ctl', 'postgres']):
            raise unittest.SkipTest('owned installed PG17.11 and project psycopg2 required; no installation')
        cls.version = subprocess.check_output([str(PG/'postgres'), '--version'], text=True).strip()
        if cls.version != 'postgres (PostgreSQL) 17.11 (Homebrew)':
            raise unittest.SkipTest('PG17.11 pin mismatch')
        cls.root = Path(tempfile.mkdtemp(prefix='thumbnail-g014-pg17-', dir='/private/tmp'))
        cls.data = cls.root/'data'; cls.sock = cls.root/'socket'; cls.sock.mkdir(mode=0o700)
        cls.home = cls.root/'home'; cls.home.mkdir(mode=0o700)
        cls.env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(cls.home), 'LANG': 'C', 'LC_ALL': 'C'}
        cls.before = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        cls.observations = {}
        cls.preimage = json.loads(PREIMAGE.read_bytes())
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); cls.port = listener.getsockname()[1]
        with (cls.root/'init.log').open('w') as log:
            subprocess.run([str(PG/'initdb'), '-D', str(cls.data), '-U', 'postgres', '--no-locale', '--encoding=UTF8',
                            '--auth-local=trust', '--auth-host=trust'], env=cls.env, stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-l', str(cls.root/'postgres.log'), '-o',
                        f'-h 127.0.0.1 -p {cls.port} -k {cls.sock}', '-w', 'start'], env=cls.env, stdout=subprocess.DEVNULL, check=True)
        cls.pid = int((cls.data/'postmaster.pid').read_text().splitlines()[0]); cls.addClassCleanup(cls.cleanup)
        print('THUMBNAIL_G014_PG17_EVIDENCE='+str(cls.root), flush=True)
        with cls.connect('postgres') as connection:
            connection.autocommit = True
            with connection.cursor() as q:
                q.execute(f'CREATE ROLE {BOOTSTRAP} LOGIN SUPERUSER')
        with cls.connect() as connection:
            connection.autocommit = True
            with connection.cursor() as q:
                q.execute('ALTER ROLE postgres RENAME TO original_bootstrap;'
                          'CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT NOBYPASSRLS;'
                          'ALTER DATABASE postgres OWNER TO postgres;'
                          'CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT NOCREATEROLE NOCREATEDB NOBYPASSRLS;'
                          'CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;'
                          'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;')
                for role in APPROVERS:
                    q.execute(f'CREATE ROLE {role} NOLOGIN')
                q.execute('SET ROLE postgres; CREATE SCHEMA auth AUTHORIZATION postgres;'
                          'CREATE TABLE auth.users(id uuid PRIMARY KEY);'
                          'CREATE TABLE public.user_roles(user_id uuid,role text);'
                          'CREATE TABLE public.user_account_status(user_id uuid,account_status text);'
                          'CREATE SCHEMA storyboard_control AUTHORIZATION postgres;'
                          'GRANT USAGE ON SCHEMA storyboard_control TO service_role;')
                bridge = BRIDGE.read_text(); start = bridge.index('CREATE OR REPLACE FUNCTION storyboard_control.assert_owner')
                q.execute(bridge[start:bridge.index('DO $bridge$\n', start)])
                q.execute(QUEUE.read_text())
                q.execute('RESET ROLE; CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner; SET ROLE privacy_workflow_owner;')
                for role in APPROVERS:
                    q.execute(f'GRANT USAGE ON SCHEMA privacy_retention TO {role}')
                q.execute("""CREATE TABLE privacy_retention.g014_public_rpc_allowlist(
                    function_schema name NOT NULL,function_name name NOT NULL,identity_arguments text NOT NULL,
                    grantee name NOT NULL,source_signature text NOT NULL,
                    CONSTRAINT g014_public_rpc_allowlist_grantee_check CHECK(grantee=ANY(ARRAY['anon'::name,'authenticated'::name,'service_role'::name])),
                    CONSTRAINT g014_public_rpc_allowlist_pkey PRIMARY KEY(function_schema,function_name,identity_arguments,grantee),
                    CONSTRAINT g014_public_rpc_allowlist_source_signature_grantee_key UNIQUE(source_signature,grantee));
                    GRANT ALL ON privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner;
                    ALTER TABLE privacy_retention.g014_public_rpc_allowlist ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE privacy_retention.g014_public_rpc_allowlist FORCE ROW LEVEL SECURITY;
                    CREATE POLICY g014_privacy_workflow_owner_access ON privacy_retention.g014_public_rpc_allowlist
                      FOR ALL TO privacy_workflow_owner USING(true) WITH CHECK(true); RESET ROLE;""")

    @classmethod
    def connect(cls, user=BOOTSTRAP):
        return psycopg2.connect(host='127.0.0.1', port=cls.port, user=user, dbname='postgres', connect_timeout=3)

    @classmethod
    def cleanup(cls):
        pidfile = cls.data/'postmaster.pid'
        if not pidfile.exists() or int(pidfile.read_text().splitlines()[0]) != cls.pid:
            raise RuntimeError('OWNED_PG_PID_MISMATCH')
        subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'], env=cls.env, stdout=subprocess.DEVNULL, check=True)
        status = subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), 'status'], env=cls.env, capture_output=True).returncode
        with socket.socket() as probe:
            closed = probe.connect_ex(('127.0.0.1', cls.port)) != 0
        cleanup = {'ownedPid': cls.pid, 'statusExit': status, 'pidFileAbsent': not pidfile.exists(),
                   'socketAbsent': not (cls.sock/f'.s.PGSQL.{cls.port}').exists(), 'tcpClosed': closed}
        after = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES}
        (cls.root/'receipt.json').write_text(json.dumps({'version': cls.version, 'sourceBefore': cls.before,
            'sourceAfter': after, 'sourceStable': cls.before == after, 'cases': cls.observations, 'cleanup': cleanup,
            'hostedWrites': 0, 'providerCalls': 0, 'limits': __doc__}, indent=2)+'\n')
        if status != 3 or not all(cleanup[k] for k in ['pidFileAbsent', 'socketAbsent', 'tcpClosed']):
            raise RuntimeError('OWNED_PG_CLEANUP_FAILED')
        if cls.before != after:
            raise RuntimeError('SOURCE_CHANGED_DURING_CHECK')

    def setUp(self):
        with self.connect() as connection, connection.cursor() as q:
            q.execute('SET LOCAL ROLE privacy_workflow_owner; TRUNCATE privacy_retention.g014_public_rpc_allowlist')
            for row in self.preimage['registry']:
                q.execute('INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES(%s,%s,%s,%s,%s)',
                          tuple(row[k] for k in ['function_schema', 'function_name', 'identity_arguments', 'grantee', 'source_signature']))
            for item in self.preimage['assertions']:
                q.execute(item['definition'])
                q.execute('REVOKE ALL ON FUNCTION '+item['signature']+' FROM PUBLIC,anon,authenticated,service_role')

    @contextmanager
    def transaction(self):
        connection = self.connect()
        try:
            with connection.cursor() as q:
                yield connection, q
        finally:
            connection.rollback(); connection.close()

    def state(self, q):
        q.execute('RESET ROLE')
        q.execute("""SELECT jsonb_build_object(
          'registry',(SELECT jsonb_agg(to_jsonb(r) ORDER BY function_schema,function_name,identity_arguments,grantee) FROM privacy_retention.g014_public_rpc_allowlist r),
          'registryMetadata',jsonb_build_object(
            'relation',(SELECT jsonb_build_array(relowner,relacl,relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='privacy_retention.g014_public_rpc_allowlist'::regclass),
            'schema',(SELECT jsonb_build_array(nspowner,nspacl) FROM pg_namespace WHERE nspname='privacy_retention'),
            'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='privacy_retention' AND tablename='g014_public_rpc_allowlist'),
            'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c WHERE conrelid='privacy_retention.g014_public_rpc_allowlist'::regclass),
            'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY oid) FROM pg_trigger t WHERE tgrelid='privacy_retention.g014_public_rpc_allowlist'::regclass)),
          'assertions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='privacy_retention' AND p.proname IN ('assert_g014_catalog_contract','assert_g014_definer_contract')),
          'publicFunctions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE 'thumbnail_production_%'),
          'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolcanlogin,rolreplication,rolbypassrls) ORDER BY rolname) FROM pg_roles),
          'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))""")
        return q.fetchone()[0]

    def apply(self, q, role='postgres', statement=None):
        q.execute('SET LOCAL ROLE '+role)
        q.execute(SQL.read_text() if statement is None else statement)

    def rejected(self, q, code, expected='55000', role='postgres'):
        before = self.state(q)
        q.execute('SAVEPOINT registration_attempt')
        with self.assertRaises(psycopg2.Error) as raised:
            self.apply(q, role)
        self.assertEqual(raised.exception.pgcode, expected)
        self.assertEqual(raised.exception.diag.message_primary, code)
        q.execute('ROLLBACK TO SAVEPOINT registration_attempt')
        self.assertEqual(self.state(q), before)

    def probe_branches(self, q):
        """Run exact extracted invoker IF branches, not the complete assertions."""
        q.execute('SET LOCAL ROLE privacy_workflow_owner')
        for item in self.preimage['assertions']:
            q.execute('SELECT prosrc FROM pg_proc WHERE oid=%s::regprocedure', (item['signature'],))
            body = q.fetchone()[0]
            variable = 'v_signature' if 'definer' in item['signature'] else 'v_expected.source_signature'
            start = body.index('    IF '+variable+' IN (\n')
            end_marker = '      CONTINUE;\n    END IF;'
            end = body.index(end_marker, start)+len(end_marker)
            branch = body[start:end]
            original_loop = body.rfind('  FOR '+variable.split('.')[0]+' IN', 0, start)
            prelude_start = body.index('  LOOP\n', original_loop)+len('  LOOP\n')
            prelude = body[prelude_start:start]
            signatures = ','.join("'"+signature+"'" for signature in SIGNATURES)
            declaration = body[:body.index('\nBEGIN')]
            loop = 'FOREACH v_signature IN ARRAY ARRAY['+signatures+'] LOOP' if variable == 'v_signature' else 'FOR v_expected IN SELECT unnest(ARRAY['+signatures+']) AS source_signature LOOP'
            # Retain the actual declarations and metadata lookup preceding the
            # branch. Substituting an assumed v_is_definer=false would hide harm.
            q.execute('DO $probe$ '+declaration+' BEGIN '+loop+'\n'+prelude+branch+
                      "\nRAISE EXCEPTION 'fixture_branch_not_admitted'; END LOOP; END $probe$;")

    def test_commit_preserves_old_rows_metadata_and_actor(self):
        with self.transaction() as (_, q):
            before = self.state(q)
        connection = self.connect('postgres')
        try:
            with connection.cursor() as q:
                q.execute(SQL.read_text())
                q.execute('SELECT current_user,current_setting(\'is_superuser\')')
                self.assertEqual(q.fetchone(), ('postgres', 'off'))
            connection.commit()
        finally:
            connection.close()
        with self.transaction() as (_, q):
            after = self.state(q)
            self.assertEqual(len(after['registry']), 140)
            self.assertEqual([r for r in after['registry'] if r['source_signature'] not in SIGNATURES], before['registry'])
            self.assertEqual(after['roles'], before['roles']); self.assertEqual(after['memberships'], before['memberships'])
            self.assertEqual(after['registryMetadata'], before['registryMetadata'])
            self.assertEqual(after['publicFunctions'], before['publicFunctions'])
            for old, new in zip(before['assertions'], after['assertions']):
                self.assertEqual({k:v for k,v in old.items() if k!='prosrc'}, {k:v for k,v in new.items() if k!='prosrc'})
                addition = ''.join("      '"+signature+"',\n" for signature in SIGNATURES)
                self.assertEqual(new['prosrc'].replace(addition, ''), old['prosrc'])
            self.probe_branches(q)
        self.observations['commit'] = {'oldRowsPreserved': 137, 'newRows': 3, 'realNonsuperuserSession': True,
                                       'assertionMetadataAndRolesUnchanged': True, 'exactBranchesExecuted': 2}

    def test_other_roles_and_superuser_are_denied(self):
        for role in [BOOTSTRAP, 'anon', 'authenticated', 'service_role', 'privacy_workflow_owner']:
            with self.subTest(role=role), self.transaction() as (_, q):
                self.rejected(q, 'thumbnail_g014_executor_not_admitted', '42501', role)
        self.observations['executorDenials'] = 5

    def test_actual_owner_contract_requires_lease_removal_before_assertions(self):
        """Execute the complete real owner contract, not the full G014 graph."""
        owner = self.preimage['ownerAssertion']
        with self.transaction() as (_, q):
            q.execute('ALTER ROLE original_bootstrap RENAME TO supabase_admin;'
                      'ALTER ROLE postgres CREATEROLE INHERIT;'
                      'CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT;'
                      f'REVOKE privacy_workflow_owner FROM postgres GRANTED BY {BOOTSTRAP};'
                      'GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;'
                      'GRANT privacy_auth_bridge TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;'
                      'SET LOCAL ROLE postgres;'
                      'GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;'
                      'RESET ROLE; SET LOCAL ROLE privacy_workflow_owner;')
            q.execute(owner['definition'])
            q.execute('ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract() OWNER TO privacy_workflow_owner;'
                      'REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM PUBLIC,anon,authenticated,service_role;'
                      'RESET ROLE; SET SESSION AUTHORIZATION postgres;')
            q.execute("SELECT current_user,session_user,current_setting('is_superuser')")
            self.assertEqual(q.fetchone(), ('postgres', 'postgres', 'off'))
            membership_sql = """SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor)
                FROM pg_auth_members m WHERE roleid IN ('privacy_workflow_owner'::regrole,'privacy_auth_bridge'::regrole)
                OR member IN ('privacy_workflow_owner'::regrole,'privacy_auth_bridge'::regrole)"""
            q.execute(membership_sql); before = q.fetchone()[0]
            q.execute('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;'
                      'SET LOCAL ROLE privacy_workflow_owner;')
            q.execute("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure")
            self.assertEqual(q.fetchone()[0], owner['bodySha256'])
            q.execute("""CREATE FUNCTION pg_temp.thumbnail_owner_order_probe() RETURNS void
                LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $probe$
                BEGIN
                  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN
                    RAISE EXCEPTION 'fixture_owner_order_caller_denied';
                  END IF;
                  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
                  DROP FUNCTION pg_temp.thumbnail_owner_order_probe();
                END $probe$;
                REVOKE ALL ON FUNCTION pg_temp.thumbnail_owner_order_probe() FROM PUBLIC,anon,authenticated,service_role;
                GRANT EXECUTE ON FUNCTION pg_temp.thumbnail_owner_order_probe() TO postgres;
                SET LOCAL ROLE postgres;
                SAVEPOINT invalid_post_order;""")
            with self.assertRaises(psycopg2.Error) as raised:
                q.execute('SELECT pg_temp.thumbnail_owner_order_probe()')
            self.assertEqual(raised.exception.pgcode, 'P0001')
            self.assertEqual(raised.exception.diag.message_primary, 'g014_pg17_workflow_owner_membership_denied')
            q.execute('ROLLBACK TO SAVEPOINT invalid_post_order;'
                      'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;')
            q.execute(membership_sql); self.assertEqual(q.fetchone()[0], before)
            q.execute('SELECT pg_temp.thumbnail_owner_order_probe()')
            q.execute("SELECT to_regprocedure('pg_temp.thumbnail_owner_order_probe()') IS NULL,pg_has_role('postgres','privacy_workflow_owner','SET')")
            self.assertEqual(q.fetchone(), (True, False))
            q.execute(membership_sql); self.assertEqual(q.fetchone()[0], before)
        self.observations['actualOwnerContractOrdering'] = {
            'fullOwnerContractBodySha256': owner['bodySha256'], 'fullOwnerContractExecuted': True,
            'callerAndSession': 'postgres', 'nonsuperuser': True, 'sessionAuthorizationInOwnedFixture': True,
            'postWithLeaseRejected': 'P0001:g014_pg17_workflow_owner_membership_denied',
            'revokeBeforePostPassed': True, 'bootstrapMembershipPreserved': True, 'bridgeSelfDropped': True,
            'fullG014GraphExecuted': False}

    def test_missing_owner_lease_is_not_created(self):
        with self.transaction() as (_, q):
            q.execute('REVOKE privacy_workflow_owner FROM postgres')
            self.rejected(q, 'thumbnail_g014_executor_not_admitted', '42501')
        self.observations['missingLeaseDenied'] = True

    def test_registry_boundary_and_existing_row_drift_are_denied(self):
        changes = [
            'GRANT SELECT ON privacy_retention.g014_public_rpc_allowlist TO service_role',
            'ALTER TABLE privacy_retention.g014_public_rpc_allowlist NO FORCE ROW LEVEL SECURITY',
            'ALTER ROLE privacy_workflow_owner INHERIT',
            "UPDATE privacy_retention.g014_public_rpc_allowlist SET identity_arguments='25' WHERE source_signature='public.activate_account_deletion_policy(text,text)'",
        ]
        for change in changes:
            with self.subTest(change=change), self.transaction() as (_, q):
                q.execute(change)
                self.rejected(q, 'thumbnail_g014_registry_drift' if change.startswith('UPDATE') else 'thumbnail_g014_registry_boundary_drift')
        self.observations['registryBoundaryDriftsDenied'] = len(changes)

    def test_unexpected_registry_trigger_is_denied(self):
        with self.transaction() as (_, q):
            q.execute("""CREATE FUNCTION privacy_retention.fixture_registry_trigger() RETURNS trigger
              LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
              CREATE TRIGGER fixture_registry_trigger BEFORE INSERT ON privacy_retention.g014_public_rpc_allowlist
              FOR EACH ROW EXECUTE FUNCTION privacy_retention.fixture_registry_trigger()""")
            self.rejected(q, 'thumbnail_g014_registry_boundary_drift')
        self.observations['unexpectedRegistryTriggerDenied'] = True

    def test_rpc_mode_acl_path_body_default_and_overload_drift_are_denied(self):
        signature = SIGNATURES[2]
        changes = [
            'ALTER FUNCTION '+signature+' SECURITY DEFINER',
            'ALTER FUNCTION '+signature+" SET search_path='public'",
            'GRANT EXECUTE ON FUNCTION '+signature+' TO anon',
            'GRANT EXECUTE ON FUNCTION '+signature+' TO service_role WITH GRANT OPTION',
            "CREATE FUNCTION public.thumbnail_production_auth_worker(text,text) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'",
        ]
        for change in changes:
            with self.subTest(change=change), self.transaction() as (_, q):
                q.execute(change)
                self.rejected(q, 'thumbnail_g014_rpc_overload_drift' if change.startswith('CREATE') else 'thumbnail_g014_rpc_drift')
        for replacement in ['default', 'body']:
            with self.subTest(replacement=replacement), self.transaction() as (_, q):
                q.execute('SELECT pg_get_functiondef(%s::regprocedure)', (signature,)); definition = q.fetchone()[0]
                if replacement == 'default':
                    needle = "DEFAULT '{}'::jsonb"; self.assertEqual(definition.count(needle), 1)
                    mutated = definition.replace(needle, "DEFAULT '{\"unexpected\":true}'::jsonb")
                else:
                    q.execute('SELECT prosrc FROM pg_proc WHERE oid=%s::regprocedure', (signature,)); body = q.fetchone()[0]
                    mutated = definition.replace(body, body+'\n-- synthetic body drift\n')
                q.execute(mutated); self.rejected(q, 'thumbnail_g014_rpc_drift')
        self.observations['rpcDriftsDenied'] = len(changes)+2

    def test_second_assertion_drift_rolls_back_first_rewrite(self):
        with self.transaction() as (_, q):
            target = 'privacy_retention.assert_g014_catalog_contract()'
            q.execute('SELECT pg_get_functiondef(%s::regprocedure),prosrc FROM pg_proc WHERE oid=%s::regprocedure', (target, target))
            definition, body = q.fetchone(); q.execute(definition.replace(body, body+'\n-- synthetic source drift\n'))
            self.rejected(q, 'thumbnail_g014_assertion_source_drift')
        self.observations['secondAssertionFailureAtomic'] = True

    def test_same_body_with_wrong_assertion_return_type_is_denied(self):
        signature = 'privacy_retention.assert_g014_catalog_contract()'
        with self.transaction() as (_, q):
            q.execute('SELECT pg_get_functiondef(%s::regprocedure) FROM pg_proc WHERE oid=%s::regprocedure', (signature, signature))
            definition = q.fetchone()[0]
            self.assertEqual(definition.count('RETURNS void'), 1)
            q.execute('DROP FUNCTION '+signature)
            q.execute(definition.replace('RETURNS void', 'RETURNS boolean'))
            q.execute('ALTER FUNCTION '+signature+' OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION '+signature+' FROM PUBLIC,anon,authenticated,service_role')
            self.rejected(q, 'thumbnail_g014_assertion_source_drift')
        self.observations['sameBodyWrongAssertionTypeDenied'] = True

    def test_replay_and_outer_late_failure_preserve_original_contract(self):
        with self.transaction() as (_, q):
            before = self.state(q); q.execute('SAVEPOINT whole_install')
            self.apply(q); self.probe_branches(q)
            self.rejected(q, 'thumbnail_g014_registry_cardinality_drift')
            with self.assertRaises(psycopg2.Error) as raised:
                q.execute('SELECT 1/0')
            self.assertEqual(raised.exception.pgcode, '22012')
            q.execute('ROLLBACK TO SAVEPOINT whole_install')
            self.assertEqual(self.state(q), before)
        self.observations['outerLateFailureAndReplay'] = True

    def test_stale_transaction_snapshot_is_denied(self):
        with self.transaction() as (_, q):
            q.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            self.rejected(q, 'thumbnail_g014_executor_not_admitted', '42501')
        self.observations['repeatableReadDenied'] = True

    def test_unexpected_registry_cardinality_and_large_fields_are_denied_early(self):
        for kind in ['extra-row', 'large-field']:
            with self.subTest(kind=kind), self.transaction() as (_, q):
                if kind == 'extra-row':
                    q.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public','synthetic_extra','25','service_role','public.synthetic_extra(text)')")
                    code = 'thumbnail_g014_registry_cardinality_drift'
                else:
                    q.execute("UPDATE privacy_retention.g014_public_rpc_allowlist SET identity_arguments=repeat('x',4097) WHERE source_signature='public.activate_account_deletion_policy(text,text)'")
                    code = 'thumbnail_g014_registry_size_drift'
                self.rejected(q, code)
        self.observations['registryEarlyBounds'] = {'visibleRows': 137, 'extraVisibleRowRejected': True,
                                                   'fieldBytes': 4096, 'overFieldRejected': True}

    def test_large_rpc_or_assertion_source_is_denied_before_definition_expansion(self):
        for signature in [SIGNATURES[2], 'privacy_retention.assert_g014_catalog_contract()']:
            with self.subTest(signature=signature), self.transaction() as (_, q):
                q.execute('SELECT pg_get_functiondef(%s::regprocedure),prosrc FROM pg_proc WHERE oid=%s::regprocedure', (signature, signature))
                definition, body = q.fetchone()
                q.execute(definition.replace(body, body+'\n-- '+('x'*65537)+'\n'))
                self.rejected(q, 'thumbnail_g014_assertion_size_drift' if signature.startswith('privacy_retention.') else 'thumbnail_g014_rpc_size_drift')
        with self.transaction() as (_, q):
            q.execute('SELECT pg_get_functiondef(%s::regprocedure)', (SIGNATURES[2],)); definition = q.fetchone()[0]
            needle = "DEFAULT '{}'::jsonb"; self.assertEqual(definition.count(needle), 1)
            q.execute(definition.replace(needle, "DEFAULT '{\"synthetic\":\""+('x'*65537)+"\"}'::jsonb"))
            self.rejected(q, 'thumbnail_g014_rpc_size_drift')
        self.observations['sourceEarlyBounds'] = {'sourceBytes': 65536, 'overRpcAndAssertionRejected': 2,
                                                'overDefaultTreeRejected': True}

    def test_actual_extended_branch_rejects_public_execution_and_definer_mode(self):
        for change in ['GRANT EXECUTE ON FUNCTION '+SIGNATURES[0]+' TO authenticated',
                       'ALTER FUNCTION '+SIGNATURES[0]+' SECURITY DEFINER']:
            with self.subTest(change=change), self.transaction() as (_, q):
                self.apply(q); q.execute('RESET ROLE'); q.execute(change); q.execute('SAVEPOINT branch_probe')
                with self.assertRaises(psycopg2.Error) as raised:
                    self.probe_branches(q)
                self.assertEqual(raised.exception.pgcode, 'P0001')
                self.assertIn('SECURITY INVOKER contract mismatch', str(raised.exception))
                q.execute('ROLLBACK TO SAVEPOINT branch_probe')
        self.observations['actualBranchNegativeControls'] = 2

    def test_removing_grant_option_guard_admits_the_demonstrated_harm(self):
        original = SQL.read_text(); needle = ' OR acl.is_grantable'
        self.assertEqual(original.count(needle), 1)
        variant = original.replace(needle, '')
        with self.transaction() as (_, q):
            q.execute('GRANT EXECUTE ON FUNCTION '+SIGNATURES[0]+' TO service_role WITH GRANT OPTION')
            self.rejected(q, 'thumbnail_g014_rpc_drift')
            self.apply(q, statement=variant)
            q.execute('RESET ROLE')
            q.execute("SELECT EXISTS(SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=%s::regprocedure)) acl WHERE acl.grantee='service_role'::regrole AND acl.is_grantable)", (SIGNATURES[0],))
            self.assertTrue(q.fetchone()[0])
            q.execute('SAVEPOINT independent_branch_probe')
            with self.assertRaises(psycopg2.Error) as raised:
                self.probe_branches(q)
            self.assertEqual(raised.exception.pgcode, 'P0001')
            self.assertIn('SECURITY INVOKER contract mismatch', raised.exception.diag.message_primary)
            q.execute('ROLLBACK TO SAVEPOINT independent_branch_probe')
        self.observations['grantOptionGuardMutation'] = {'currentRejected': True, 'variantAdmittedHarm': True,
            'actualBranchRejectedVariant': True, 'checkoutFilesMutated': 0}

    def test_removing_old_registry_digest_guards_admits_an_existing_row_drift(self):
        original = SQL.read_text()
        needle = "old_registry_digest IS DISTINCT FROM '"+self.preimage['registryDigest']+"'"
        self.assertEqual(original.count(needle), 2)
        variant = original.replace(needle, 'false')
        with self.transaction() as (_, q):
            q.execute("UPDATE privacy_retention.g014_public_rpc_allowlist SET identity_arguments='25' WHERE source_signature='public.activate_account_deletion_policy(text,text)'")
            self.rejected(q, 'thumbnail_g014_registry_drift')
            self.apply(q, statement=variant)
            state = self.state(q)
            self.assertEqual(len(state['registry']), 140)
            changed = [r for r in state['registry'] if r['source_signature']=='public.activate_account_deletion_policy(text,text)']
            self.assertEqual(len(changed), 1); self.assertEqual(changed[0]['identity_arguments'], '25')
        self.observations['registryDigestGuardMutation'] = {'currentRejected': True, 'variantAdmittedExistingRowDrift': True,
                                                          'checkoutFilesMutated': 0}

    def test_two_concurrent_registrations_commit_once(self):
        barrier = threading.Barrier(2)
        def attempt(_):
            connection = self.connect('postgres')
            try:
                with connection.cursor() as q:
                    q.execute('SET statement_timeout=8000; SET lock_timeout=6000')
                    barrier.wait(timeout=3); q.execute(SQL.read_text())
                connection.commit(); return 'committed'
            except psycopg2.Error as error:
                connection.rollback(); return error.pgcode+':'+error.diag.message_primary
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = sorted(pool.map(attempt, range(2)))
        self.assertEqual(results, ['55000:thumbnail_g014_registry_cardinality_drift', 'committed'])
        with self.transaction() as (_, q):
            state = self.state(q); self.assertEqual(len(state['registry']), 140); self.probe_branches(q)
        self.observations['concurrency'] = {'calls': 2, 'committed': 1, 'replayRejected': 1, 'rows': 140}


if __name__ == '__main__':
    unittest.main()
