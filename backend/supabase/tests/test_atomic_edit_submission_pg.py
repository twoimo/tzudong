"""Actual owned PG15/PG17 component checks for the atomic-edit candidate.

Run from the repository root with python3 -B -m unittest <this module>.
Uses only the cached supabase/postgres:15.8.1.085 image (network none) and the
existing native PG17 install; never connects to an existing DB/container.
The real runtime/registration SQL and baseline table CHECK/FK definitions are
used. This component fixture does NOT stand in for the full G014 replay graph.
Full candidate admission/replay must additionally run on a complete baseline.
No raw psql diagnostics, payloads, credentials, or DB URLs are emitted.
"""
from concurrent.futures import ThreadPoolExecutor
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
CANDIDATE = ROOT / 'backend/supabase/migrations/20261026120000_atomic_edit_submission_request.sql'
BASELINE = ROOT / 'backend/supabase/baselines/local/application-prerequisites.sql'
BOUNDARY = ROOT / 'backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql'
PG17_BIN_OVERRIDE = 'TZUDONG_ATOMIC_EDIT_PG17_BIN'
USER = '10000000-0000-0000-0000-000000000001'
OTHER = '10000000-0000-0000-0000-000000000002'
TARGET = '20000000-0000-0000-0000-000000000001'
SIBLING = '20000000-0000-0000-0000-000000000002'
MISSING = '20000000-0000-0000-0000-000000000003'
BOOTSTRAP = 'atomic_edit_bootstrap'
OBSERVATIONS = []


def literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


class SqlFailure(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__('OWNED_SQL_FAILED:' + code)


def run(argv, **kwargs):
    return subprocess.run(argv, capture_output=True, timeout=60, **kwargs)


def discover_native_pg17():
    """Verify installed tools; an explicit task override never silently falls back."""
    environment = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL')}

    def invoke(program, argument):
        try:
            if not stat.S_ISREG(program.stat().st_mode):
                return None
            result = run([str(program), argument], env=environment)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EPERM):
                raise RuntimeError('NATIVE_PG17_DISCOVERY_PERMISSION_DENIED') from None
            return None
        except subprocess.TimeoutExpired:
            return None
        return result.stdout.strip() if result.returncode == 0 else None

    def major(program):
        output = invoke(program, '--version')
        match = re.search(rb'\bPostgreSQL\)?\s+(\d+)\.', output or b'')
        return int(match[1]) if match else None

    override = os.environ.get(PG17_BIN_OVERRIDE)
    candidates = []
    if override is not None:
        if override.strip():
            candidates.append(Path(override).expanduser())
    else:
        configured = shutil.which('pg_config')
        if configured and major(Path(configured)) == 17:
            output = invoke(Path(configured), '--bindir')
            if output:
                candidates.append(Path(os.fsdecode(output)))
        candidates.extend(Path(p) for p in (
            '/opt/homebrew/opt/postgresql@17/bin',
            '/usr/local/opt/postgresql@17/bin',
            '/usr/lib/postgresql/17/bin',
        ))
    for directory in dict.fromkeys(candidates):
        if directory.is_absolute() and all(major(directory / program) == 17 for program in ('postgres', 'pg_ctl', 'initdb', 'psql')):
            return directory.resolve()
    raise unittest.SkipTest('native PG17 unavailable: no verified installed PG17 toolchain; optional ' + PG17_BIN_OVERRIDE)


def fixture_sql():
    baseline = BASELINE.read_text()
    tables = []
    for table in ('restaurant_submissions', 'restaurant_submission_items'):
        start = baseline.index('CREATE TABLE public.' + table + ' (')
        tables.append(baseline[start:baseline.index('\n);', start) + 3])
    return """
CREATE ROLE postgres LOGIN CREATEROLE CREATEDB NOINHERIT;
CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TYPE public.submission_type AS ENUM('new','edit');
CREATE TYPE public.submission_status AS ENUM('pending','approved','rejected');
CREATE SCHEMA pipeline_control AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA pipeline_control TO privacy_workflow_owner;
GRANT USAGE,CREATE ON SCHEMA public TO postgres,privacy_workflow_owner;
GRANT USAGE ON SCHEMA extensions,auth TO postgres;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,approved_name text,naver_name text,origin_name text,google_name text,channel_name text);
CREATE TABLE public.restaurants_backup(id uuid PRIMARY KEY);
""" + '\n'.join(tables) + """
ALTER TABLE public.restaurant_submissions ADD PRIMARY KEY(id);
ALTER TABLE public.restaurant_submissions ADD COLUMN client_submission_key text;
ALTER TABLE public.restaurant_submissions ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.restaurant_submission_items ADD PRIMARY KEY(id);
ALTER TABLE public.restaurant_submission_items ADD FOREIGN KEY(submission_id) REFERENCES public.restaurant_submissions(id) ON DELETE CASCADE;
ALTER TABLE public.restaurant_submission_items ADD FOREIGN KEY(target_restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX restaurant_submissions_user_type_client_submission_key_idx ON public.restaurant_submissions(user_id,submission_type,client_submission_key) WHERE client_submission_key IS NOT NULL;
ALTER TABLE public.restaurant_submissions OWNER TO postgres;
ALTER TABLE public.restaurant_submission_items OWNER TO postgres;
GRANT SELECT ON auth.users,public.restaurants,public.restaurants_backup TO postgres;
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
GRANT privacy_workflow_owner TO postgres;
SET ROLE privacy_workflow_owner;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name NOT NULL,function_name name NOT NULL,identity_arguments text NOT NULL,grantee name NOT NULL CHECK(grantee IN ('anon','authenticated','service_role')),source_signature text NOT NULL,PRIMARY KEY(function_schema,function_name,identity_arguments,grantee),UNIQUE(source_signature,grantee));
CREATE TABLE privacy_retention.g014_nested_helper_allowlist(source_signature text PRIMARY KEY);
ALTER TABLE privacy_retention.g014_public_rpc_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_nested_helper_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_nested_helper_allowlist FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_access ON privacy_retention.g014_nested_helper_allowlist TO privacy_workflow_owner USING(true) WITH CHECK(true);
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres;
"""


class OwnedDatabase:
    def __init__(self, major, pg17=None):
        self.major = major
        self.pg17 = pg17
        self.root = Path(tempfile.mkdtemp(prefix='atomic-edit-v84-'))
        self.container = None
        self.pid = None
        self.closed = False
        self.before = {}
        self.env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL')}

    def start(self):
        if self.major == 15:
            listed = run(['docker', 'ps', '-aq', '--no-trunc'], env=self.env)
            if listed.returncode:
                raise RuntimeError('OWNED_DOCKER_UNAVAILABLE')
            self.before = set(listed.stdout.decode().split())
            self.container = 'atomic-edit-v84-' + uuid.uuid4().hex[:12]
            created = run(['docker', 'run', '-d', '--pull=never', '--network', 'none', '--user', 'postgres',
                '--name', self.container, '--label', 'tzudong.atomic-edit-component=v84',
                '--tmpfs', '/tmp:rw,mode=1777', '--entrypoint', '/bin/sh', 'supabase/postgres:15.8.1.085', '-c',
                'mkdir /tmp/atomic-edit && initdb -D /tmp/atomic-edit/data -U atomic_edit_bootstrap --auth=trust --no-locale --encoding=UTF8 >/dev/null 2>&1 && exec postgres -D /tmp/atomic-edit/data -h "" -k /tmp/atomic-edit -p 55432 -c log_min_messages=panic -c log_min_error_statement=panic'], env=self.env)
            if created.returncode:
                raise RuntimeError('OWNED_PG15_CREATE_FAILED')
            self.cid = created.stdout.decode().strip()
            self.base = ['docker', 'exec', '-i', self.container, 'psql', '-h', '/tmp/atomic-edit', '-p', '55432']
        else:
            if self.pg17 is None:
                raise RuntimeError('OWNED_PG17_NOT_VERIFIED')
            self.data = self.root / 'data'
            self.sock = self.root / 'socket'
            self.sock.mkdir()
            initialized = run([str(self.pg17 / 'initdb'), '-D', str(self.data), '-U', BOOTSTRAP, '--auth=trust', '--no-locale', '--encoding=UTF8'], env=self.env)
            if initialized.returncode:
                raise RuntimeError('OWNED_PG17_INIT_FAILED')
            started = run([str(self.pg17 / 'pg_ctl'), '-D', str(self.data), '-l', '/dev/null', '-o',
                f'-h "" -k {self.sock} -p 55432 -c log_min_messages=panic -c log_min_error_statement=panic', '-w', 'start'], env=self.env)
            if started.returncode:
                raise RuntimeError('OWNED_PG17_START_FAILED')
            self.pid = int((self.data / 'postmaster.pid').read_text().splitlines()[0])
            self.base = [str(self.pg17 / 'psql'), '-h', str(self.sock), '-p', '55432']
        for _ in range(50):
            try:
                self.version = self.sql('SHOW server_version;').strip()
                break
            except SqlFailure:
                time.sleep(0.1)
        else:
            raise RuntimeError('OWNED_PG_NOT_READY')
        if int(self.version.split('.')[0]) != self.major:
            raise RuntimeError('OWNED_PG_VERSION_MISMATCH')
        self.sql(fixture_sql())
        if self.major == 17:
            self.sql('CREATE ROLE supabase_admin SUPERUSER NOLOGIN; SET ROLE supabase_admin; '
                     'GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE; RESET ROLE;')
        source = CANDIDATE.read_text()
        # Exact source fragments, with no altered function body, grants, or
        # assertion success stubs. Full installation admission is tested apart.
        table_start = source.index('CREATE TABLE pipeline_control.restaurant_edit_request_bindings')
        table_end = source.index('-- BEGIN atomic-edit runtime core')
        core_start = source.index('CREATE FUNCTION pipeline_control.submit_restaurant_edit_request')
        core_end = source.index('-- END atomic-edit runtime core.')
        register_start = source.index('DO $edit_request_registration_role$')
        register_end = source.index('DO $edit_request_post$')
        self.sql('BEGIN;\n' + source[table_start:table_end] + source[core_start:core_end] + source[register_start:register_end] + '\nCOMMIT;', actor='postgres')
        boundary = BOUNDARY.read_text()
        start = boundary.index('CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_public_rpc_allowlist()')
        end = boundary.index('CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_invoker_contract()', start)
        self.sql(boundary[start:end])

    def sql(self, sql, actor=BOOTSTRAP):
        result = run([*self.base, '-X', '-q', '-A', '-t', '--no-password', '-U', actor, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
            env=self.env, input=('\\set VERBOSITY sqlstate\n' + sql).encode())
        if result.returncode:
            match = re.search(rb'ERROR:\s+([0-9A-Z]{5})\b', result.stderr)
            raise SqlFailure(match[1].decode() if match else 'unclassified')
        return result.stdout.decode().strip()

    def json(self, sql, actor=BOOTSTRAP):
        return json.loads(self.sql(sql, actor).splitlines()[-1])

    def close(self):
        if self.closed:
            return
        if self.container:
            identity = run(['docker', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "tzudong.atomic-edit-component"}}', self.container], env=self.env)
            if identity.returncode == 0:
                if identity.stdout.decode().strip() != self.cid + ' v84':
                    raise RuntimeError('OWNED_CONTAINER_IDENTITY_MISMATCH')
                stopped = run(['docker', 'exec', self.cid, 'pg_ctl', '-D', '/tmp/atomic-edit/data', '-m', 'fast', '-w', '-t', '20', 'stop'], env=self.env)
                if stopped.returncode:
                    # PostgreSQL is PID 1; its clean exit can end docker exec
                    # before pg_ctl reports completion. Reconcile that exit.
                    state = run(['docker', 'inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', self.cid], env=self.env)
                    if state.returncode or state.stdout.strip() != b'exited 0':
                        raise RuntimeError('OWNED_CONTAINER_PG_STOP_FAILED')
                waited = run(['docker', 'wait', self.cid], env=self.env)
                if waited.returncode:
                    raise RuntimeError('OWNED_CONTAINER_EXIT_UNCONFIRMED')
                removed = run(['docker', 'rm', self.cid], env=self.env)
                if removed.returncode:
                    raise RuntimeError('OWNED_CONTAINER_CLEANUP_FAILED')
            after = run(['docker', 'ps', '-aq', '--no-trunc'], env=self.env)
            if after.returncode or not self.before.issubset(set(after.stdout.decode().split())):
                raise RuntimeError('PREEXISTING_CONTAINER_ID_NOT_PRESERVED')
        elif self.pid:
            if int((self.data / 'postmaster.pid').read_text().splitlines()[0]) != self.pid:
                raise RuntimeError('OWNED_POSTGRES_PID_MISMATCH')
            stopped = run([str(self.pg17 / 'pg_ctl'), '-D', str(self.data), '-m', 'fast', '-w', 'stop'], env=self.env)
            if stopped.returncode or (self.data / 'postmaster.pid').exists() or (self.sock / '.s.PGSQL.55432').exists():
                raise RuntimeError('OWNED_POSTGRES_CLEANUP_FAILED')
        self.closed = True
        shutil.rmtree(self.root)


class AtomicEditCases:
    @classmethod
    def setUpClass(cls):
        native = discover_native_pg17() if cls.MAJOR == 17 else None
        cls.db = OwnedDatabase(cls.MAJOR, pg17=native)
        cls.addClassCleanup(cls.db.close)
        cls.db.start()
        cls.source_hash = hashlib.sha256(CANDIDATE.read_bytes()).hexdigest()

    @classmethod
    def tearDownClass(cls):
        if cls.source_hash != hashlib.sha256(CANDIDATE.read_bytes()).hexdigest():
            raise RuntimeError('CANDIDATE_CHANGED_DURING_COMPONENT_TEST')
        OBSERVATIONS.append({'major': cls.MAJOR, 'version': cls.db.version, 'candidateSha256': cls.source_hash,
                             'scope': 'actual component runtime/registration; not full G014 graph'})

    def setUp(self):
        self.db.sql('TRUNCATE public.restaurant_submissions,public.restaurant_submission_items,pipeline_control.restaurant_edit_request_bindings,auth.users,public.restaurants,public.restaurants_backup CASCADE;'
            + f"INSERT INTO auth.users VALUES({literal(USER)}),({literal(OTHER)});"
            + f"INSERT INTO public.restaurants(id,approved_name) VALUES({literal(TARGET)},'기존 가게'),({literal(SIBLING)},'두 번째 가게');"
            + f'INSERT INTO public.restaurants_backup VALUES({literal(TARGET)}),({literal(SIBLING)});')

    def payload(self):
        return {'requestKind': 'edit', 'name': '시험 가게', 'address': '시험 주소', 'phone': '02-1234-5678', 'category': ['한식'],
                'youtube_reviews': [{'youtube_link': 'https://www.youtube.com/watch?v=abcdefghijk', 'tzuyang_review': '시험 설명', 'restaurant_id': TARGET},
                                    {'youtube_link': 'https://www.youtube.com/watch?v=lmnopqrstuv', 'tzuyang_review': '', 'restaurant_id': SIBLING}]}

    def call(self, payload=None, key='edit-fixture-0001', user=USER, target=TARGET, actor='service_role', suffix=''):
        body = literal(json.dumps(payload if payload is not None else self.payload(), ensure_ascii=False)) + '::jsonb'
        return self.db.json(f'SET ROLE {actor}; SELECT public.submit_restaurant_edit_request({literal(user)}::uuid,{literal(key)},{literal(target)}::uuid,{body});' + suffix)

    def failure(self, result, code):
        self.assertEqual(result, {'ok': False, 'code': code})

    def counts(self):
        return self.db.json("SELECT jsonb_build_array((SELECT count(*) FROM public.restaurant_submissions),(SELECT count(*) FROM public.restaurant_submission_items),(SELECT count(*) FROM pipeline_control.restaurant_edit_request_bindings));")

    def test_full_set_pending_and_exact_wire_fields(self):
        result = self.call()
        self.assertEqual(set(result), {'ok', 'code', 'id', 'status', 'itemCount'})
        self.assertEqual((result['ok'], result['code'], result['status'], result['itemCount']), (True, 'EDIT_SUBMISSION_SAVED', 'pending', 2))
        uuid.UUID(result['id'])
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_same_key_sorted_items_and_categories_return_original(self):
        payload = self.payload(); payload['category'] = ['한식', '분식']
        first = self.call(payload)
        payload['youtube_reviews'].reverse(); payload['category'].reverse()
        payload['name'] = ' ' + payload['name'] + ' '
        self.assertEqual(self.call(payload), first)
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_same_key_different_parent_or_items_conflict(self):
        first = self.call()
        for field in ('name', 'address', 'phone', 'category', 'requestKind', 'youtube_reviews'):
            payload = self.payload()
            payload[field] = {'name': '다른 가게', 'address': '다른 주소', 'phone': '02-2345-6789', 'category': ['분식'],
                              'requestKind': 'closure', 'youtube_reviews': [payload['youtube_reviews'][0]]}[field]
            self.failure(self.call(payload), 'EDIT_SUBMISSION_CONFLICT')
        self.assertEqual(self.call(), first)
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_main_target_bound_even_when_item_set_unchanged(self):
        self.call()
        self.failure(self.call(target=SIBLING), 'EDIT_SUBMISSION_CONFLICT')
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_users_and_keys_are_separate_identities(self):
        a = self.call(); b = self.call(user=OTHER); c = self.call(key='edit-fixture-0002')
        self.assertEqual(len({a['id'], b['id'], c['id']}), 3)
        self.assertEqual(self.counts(), [3, 6, 3])

    def test_item_fk_failure_rolls_back_parent_and_all_items(self):
        payload = self.payload(); payload['youtube_reviews'][1]['restaurant_id'] = MISSING
        self.failure(self.call(payload), 'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(), [0, 0, 0])

    def test_unexpected_item_trigger_failure_is_fixed_and_atomic(self):
        self.db.sql("CREATE FUNCTION pipeline_control.fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.youtube_link LIKE '%lmnopqrstuv' THEN RAISE EXCEPTION 'fixture-private-diagnostic'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_failure BEFORE INSERT ON public.restaurant_submission_items FOR EACH ROW EXECUTE FUNCTION pipeline_control.fixture_failure();")
        try:
            self.failure(self.call(), 'EDIT_SUBMISSION_FAILED')
            self.assertEqual(self.counts(), [0, 0, 0])
        finally:
            self.db.sql('DROP TRIGGER fixture_failure ON public.restaurant_submission_items; DROP FUNCTION pipeline_control.fixture_failure();')

    def test_silent_item_suppression_or_mutation_rolls_back_full_set(self):
        for action in ('RETURN NULL;', "NEW.tzuyang_review:='changed-by-trigger'; RETURN NEW;", "NEW.item_status:='rejected'; RETURN NEW;"):
            self.db.sql("CREATE FUNCTION pipeline_control.fixture_silent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.youtube_link LIKE '%lmnopqrstuv' THEN " + action +
                " END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_silent BEFORE INSERT ON public.restaurant_submission_items FOR EACH ROW EXECUTE FUNCTION pipeline_control.fixture_silent();")
            try:
                self.failure(self.call(), 'EDIT_SUBMISSION_FAILED')
                self.assertEqual(self.counts(), [0, 0, 0])
            finally:
                self.db.sql('DROP TRIGGER fixture_silent ON public.restaurant_submission_items; DROP FUNCTION pipeline_control.fixture_silent();')

    def test_silent_parent_mutation_or_binding_suppression_rolls_back(self):
        for table, action in [('public.restaurant_submissions', "NEW.restaurant_name:='changed-by-trigger'; RETURN NEW;"),
                              ('public.restaurant_submissions', "NEW.status:='rejected'; RETURN NEW;"),
                              ('pipeline_control.restaurant_edit_request_bindings', 'RETURN NULL;')]:
            self.db.sql('CREATE FUNCTION pipeline_control.fixture_silent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ' + action +
                ' END $$; CREATE TRIGGER fixture_silent BEFORE INSERT ON ' + table + ' FOR EACH ROW EXECUTE FUNCTION pipeline_control.fixture_silent();')
            try:
                self.failure(self.call(), 'EDIT_SUBMISSION_FAILED')
                self.assertEqual(self.counts(), [0, 0, 0])
            finally:
                self.db.sql('DROP TRIGGER fixture_silent ON ' + table + '; DROP FUNCTION pipeline_control.fixture_silent();')

    def test_outer_rollback_erases_all_three_writes(self):
        payload = literal(json.dumps(self.payload(), ensure_ascii=False))
        self.db.sql(f'BEGIN; SET LOCAL ROLE service_role; SELECT public.submit_restaurant_edit_request({literal(USER)},\'edit-fixture-0001\',{literal(TARGET)},{payload}::jsonb); ROLLBACK;')
        self.assertEqual(self.counts(), [0, 0, 0])

    def test_incomplete_old_parent_is_not_adopted_or_repaired(self):
        self.db.sql(f"INSERT INTO public.restaurant_submissions(user_id,submission_type,client_submission_key,restaurant_name) VALUES({literal(USER)},'edit','edit-fixture-0001','시험 가게');")
        self.failure(self.call(), 'EDIT_SUBMISSION_CONFLICT')
        self.assertEqual(self.counts(), [1, 0, 0])

    def test_changed_or_reviewed_existing_request_never_reapplied(self):
        self.call()
        self.db.sql("UPDATE public.restaurant_submission_items SET tzuyang_review='관리자 수정';")
        self.failure(self.call(), 'EDIT_SUBMISSION_CONFLICT')
        self.db.sql("UPDATE public.restaurant_submissions SET status='approved';")
        self.failure(self.call(), 'EDIT_SUBMISSION_CONFLICT')
        self.assertEqual(self.counts(), [1, 2, 1])

    def test_closure_blank_name_address_preserves_existing_snapshot_note(self):
        payload = self.payload(); payload.update(requestKind='closure', name='', address='', phone='', category=[])
        first = self.call(payload)
        self.assertTrue(first['ok'])
        row = self.db.json('SELECT jsonb_build_object(\'name\',restaurant_name,\'address\',restaurant_address,\'note\',admin_notes) FROM public.restaurant_submissions;')
        self.assertEqual(row['name'], '기존 가게'); self.assertEqual(row['address'], '')
        flow = (ROOT / 'apps/web/lib/edit-restaurant-request-flow.ts').read_text()
        self.assertIn(row['note'], flow)
        self.db.sql("UPDATE public.restaurants SET approved_name='새 표시명';")
        self.assertEqual(self.call(payload), first)

    def test_bad_shapes_bounds_and_target_are_fixed_invalid_no_write(self):
        invalid = [[], {}, None]
        for field, value in [('requestKind','other'), ('name','x'*161), ('address','x'*501), ('phone','010-1234-5678'),
                             ('category',['x']*11), ('category',['x','x']), ('category',[None]), ('youtube_reviews',[])]:
            payload=self.payload(); payload[field]=value; invalid.append(payload)
        for field, value in [('youtube_link','x'),('youtube_link','https://'+'x'*2049),('tzuyang_review','x'*4001),('restaurant_id','bad-uuid')]:
            payload=self.payload(); payload['youtube_reviews'][0][field]=value; invalid.append(payload)
        payload=self.payload(); payload['extra']='x'; invalid.append(payload)
        payload=self.payload(); payload['youtube_reviews'][0]['extra']='x'; invalid.append(payload)
        payload=self.payload(); payload['youtube_reviews']=payload['youtube_reviews']*51; invalid.append(payload)
        for payload in invalid:
            if payload is None:
                result=self.db.json('SET ROLE service_role; SELECT public.submit_restaurant_edit_request(NULL,NULL,NULL,NULL);')
            else:
                result=self.call(payload)
            self.failure(result,'EDIT_SUBMISSION_INVALID')
        self.failure(self.call(target=MISSING),'EDIT_SUBMISSION_INVALID')
        self.failure(self.call(key='bad'),'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(),[0,0,0])

    def test_existing_db_100_name_and_five_category_constraints_remain(self):
        for field,value in [('name','x'*101),('category',['a','b','c','d','e','f'])]:
            payload=self.payload(); payload[field]=value
            self.failure(self.call(payload),'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(),[0,0,0])

    def test_duplicate_item_multiplicity_is_preserved(self):
        payload=self.payload(); payload['youtube_reviews']*=2
        result=self.call(payload)
        self.assertEqual(result['itemCount'],4); self.assertEqual(self.counts(),[1,4,1])
        self.assertEqual(self.call(payload),result)

    def test_64k_json_bound_and_hundred_item_bound(self):
        payload=self.payload(); payload['youtube_reviews']=[dict(payload['youtube_reviews'][0]) for _ in range(100)]
        self.assertTrue(self.call(payload)['ok'])
        payload['youtube_reviews'][0]['tzuyang_review']='한'*4000
        payload['youtube_reviews']=[dict(payload['youtube_reviews'][0]) for _ in range(20)]
        self.failure(self.call(payload,key='edit-fixture-0002'),'EDIT_SUBMISSION_INVALID')
        self.assertEqual(self.counts(),[1,100,1])

    def test_role_acl_private_core_and_registry_metadata(self):
        for actor in ('anon','authenticated'):
            with self.assertRaises(SqlFailure) as failure: self.call(actor=actor)
            self.assertEqual(failure.exception.code,'42501')
        with self.assertRaises(SqlFailure) as failure: self.call(actor='postgres')
        self.assertEqual(failure.exception.code,'42501')
        self.failure(self.db.json('SET ROLE postgres; SELECT pipeline_control.submit_restaurant_edit_request(NULL,NULL,NULL,NULL);'),
                     'EDIT_SUBMISSION_UNAUTHORIZED')
        self.failure(self.db.json('SET ROLE service_role; SELECT public.submit_restaurant_edit_request(NULL,NULL,NULL,NULL);'),
                     'EDIT_SUBMISSION_INVALID')
        with self.assertRaises(SqlFailure) as failure:
            self.db.sql('SET ROLE service_role; SELECT pipeline_control.submit_restaurant_edit_request(NULL,NULL,NULL,NULL);')
        self.assertEqual(failure.exception.code,'42501')
        result=self.db.json("SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',(SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable) ORDER BY a.grantee) FROM aclexplode(proacl) a)) FROM pg_proc WHERE oid='public.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'::regprocedure;")
        self.assertEqual(result['owner'],'privacy_workflow_owner'); self.assertTrue(result['definer'])
        self.assertIn('search_path=""',result['config'])
        self.assertEqual({tuple(row) for row in result['acl']},{('privacy_workflow_owner','EXECUTE',False),('service_role','EXECUTE',False)})
        self.db.sql('SELECT privacy_retention.assert_g014_public_rpc_allowlist();')
        nested=self.db.json("SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantee),a.privilege_type,a.is_grantable) ORDER BY a.grantee) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'::regprocedure;")
        self.assertEqual({tuple(row) for row in nested},{('postgres','EXECUTE',False),('privacy_workflow_owner','EXECUTE',False)})
        self.assertEqual(self.counts(),[0,0,0])

    def test_concurrent_same_key_creates_one_complete_set(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:self.call(),range(2)))
        self.assertEqual(results[0],results[1]); self.assertTrue(results[0]['ok'])
        self.assertEqual(self.counts(),[1,2,1])

    def test_parent_delete_cascades_minimal_binding_no_retention_addition(self):
        self.call(); self.db.sql('DELETE FROM public.restaurant_submissions;')
        self.assertEqual(self.counts(),[0,0,0])

    def test_whole_candidate_denies_statement_autocommit(self):
        before=self.db.sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;")
        with self.assertRaises(SqlFailure) as failure:
            self.db.sql(CANDIDATE.read_text(),actor='postgres')
        self.assertEqual(failure.exception.code,'25000')
        self.assertEqual(self.db.sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m;"),before)
        self.assertEqual(self.counts(),[0,0,0])

    def test_whole_candidate_denies_wrong_executor_or_missing_custody(self):
        for actor,code in [(BOOTSTRAP,'42501'),('postgres','55000')]:
            with self.assertRaises(SqlFailure) as failure:
                self.db.sql('BEGIN;\n'+CANDIDATE.read_text()+'\nCOMMIT;',actor=actor)
            self.assertEqual(failure.exception.code,code)
            self.assertEqual(self.counts(),[0,0,0])


class AtomicEditPG15(AtomicEditCases, unittest.TestCase):
    MAJOR=15


class AtomicEditPG17(AtomicEditCases, unittest.TestCase):
    MAJOR=17


if __name__ == '__main__':
    unittest.main()
