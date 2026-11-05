"""Actual PG17.11 entry/Storage component checks, not full installation proof.

Reuse the owned G014 fixture's cluster lifecycle, without running its test suite.
The Storage fixture models the observed table columns, owners, browser/server
privileges and exact ten policy expressions. It does not emulate Storage HTTP,
managed triggers, the complete G014 graph or hosted PG17.6. No provider calls.
"""
import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
import subprocess
import unittest

from backend.supabase.tests import test_thumbnail_g014_contract_pg17 as registration

ROOT = registration.ROOT
SOURCE = ROOT/'backend/supabase/candidates/20261024071000_thumbnail_production_install.sql'
STORAGE = ROOT/'backend/supabase/tests/fixtures/thumbnail-install-hosted-storage-20261024.json'
MANIFEST = ROOT/'.github/thumbnail-production-installation.draft.v1.json'
SELF = Path(__file__).resolve()


def block(tag):
    source = SOURCE.read_text()
    start = source.index('DO $'+tag+'$')
    end_token = 'END $'+tag+'$;'
    return source[start:source.index(end_token, start)+len(end_token)]


class ThumbnailInstallBoundaryPg17(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class OwnedCluster(registration.ThumbnailG014Pg17):
            pass
        cls.fixture = OwnedCluster
        cls.fixture.setUpClass()
        cls.addClassCleanup(cls.write_receipt)
        cls.addClassCleanup(cls.fixture.doClassCleanups)
        cls.fixture('test_commit_preserves_old_rows_metadata_and_actor').setUp()
        cls.sources = [SELF, SOURCE, STORAGE, MANIFEST, registration.SELF,
                       ROOT/'apps/web/scripts/supabase-migration-transaction.mjs',
                       ROOT/'backend/supabase/scripts/g037_supabase_statement_vector.mjs']
        cls.before = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in cls.sources}
        cls.observations = {}
        cls.storage = json.loads(STORAGE.read_bytes())
        with cls.fixture.connect() as connection, connection.cursor() as q:
            q.execute("""ALTER ROLE postgres BYPASSRLS;
                CREATE ROLE supabase_storage_admin NOLOGIN NOSUPERUSER NOBYPASSRLS;
                CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
                CREATE TYPE storage.buckettype AS ENUM('STANDARD','ANALYTICS','VECTOR');
                CREATE TABLE storage.buckets(
                  id text PRIMARY KEY,name text NOT NULL,owner uuid,
                  created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
                  public bool DEFAULT false,avif_autodetection bool DEFAULT false,
                  file_size_limit bigint,allowed_mime_types text[],owner_id text,
                  type storage.buckettype NOT NULL DEFAULT 'STANDARD',
                  versioning_status text NOT NULL DEFAULT 'DISABLED',
                  lifecycle_configuration jsonb,lifecycle_configuration_generation uuid);
                CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                  bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,metadata jsonb);
                ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
                ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
                ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
                ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
                GRANT USAGE ON SCHEMA storage TO postgres,service_role,anon,authenticated;
                GRANT SELECT,INSERT,UPDATE ON storage.buckets,storage.objects TO postgres;
                GRANT SELECT,INSERT,UPDATE,DELETE ON storage.buckets,storage.objects TO service_role,anon,authenticated;
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                  AS 'SELECT NULL::uuid';
                CREATE FUNCTION public.is_user_admin(uuid) RETURNS boolean LANGUAGE sql STABLE
                  AS 'SELECT false';
                CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE
                  AS 'SELECT (string_to_array($1,''/''))[1:array_length(string_to_array($1,''/''),1)-1]';
                GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
            """)
            from psycopg2 import sql
            commands = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE'}
            for relation, name, cmd, permissive, roles, using, check in cls.storage['policies']['policy_rows']:
                assert relation == 'objects' and permissive
                statement = sql.SQL('CREATE POLICY {} ON storage.objects FOR {} TO {}').format(
                    sql.Identifier(name), sql.SQL(commands[cmd]),
                    sql.SQL(',').join(sql.SQL('PUBLIC') if role == 'PUBLIC' else sql.Identifier(role) for role in roles))
                if using:
                    statement += sql.SQL(' USING ({})').format(sql.SQL(using))
                if check:
                    statement += sql.SQL(' WITH CHECK ({})').format(sql.SQL(check))
                q.execute(statement)

    @classmethod
    def write_receipt(cls):
        after = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in cls.sources}
        lifecycle = json.loads((cls.fixture.root/'receipt.json').read_bytes())
        receipt = {'version': cls.fixture.version, 'sourceBefore': cls.before, 'sourceAfter': after,
                   'sourceStable': cls.before == after, 'cases': cls.observations,
                   'cleanup': lifecycle['cleanup'], 'hostedWrites': 0, 'providerCalls': 0,
                   'limits': __doc__}
        (cls.fixture.root/'install-boundary-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
        if cls.before != after:
            raise RuntimeError('SOURCE_CHANGED_DURING_CHECK')

    def snapshot(self, q):
        q.execute("""SELECT jsonb_build_object(
          'buckets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM storage.buckets b),
          'objects',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o),
          'relations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_class c WHERE relnamespace='storage'::regnamespace),
          'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p WHERE polrelid='storage.objects'::regclass),
          'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls) ORDER BY rolname) FROM pg_roles),
          'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m))""")
        return q.fetchone()[0]

    @contextmanager
    def transaction(self):
        connection = self.fixture.connect()
        try:
            yield connection
        finally:
            connection.rollback()
            connection.close()

    def apply_bucket(self, q, initial_path=''):
        q.execute('SET SESSION AUTHORIZATION postgres')
        q.execute(block('thumbnail_install_transaction'))
        q.execute("SELECT set_config('search_path',%s,true)", (initial_path,))
        q.execute(block('thumbnail_install_bucket'))
        q.execute("SELECT current_setting('search_path')")
        self.assertEqual(q.fetchone()[0], initial_path)

    def rejected(self, q, reason, state):
        before = self.snapshot(q)
        q.execute('SAVEPOINT attempt')
        with self.assertRaises(registration.psycopg2.Error) as raised:
            self.apply_bucket(q)
        self.assertEqual(raised.exception.pgcode, state)
        self.assertEqual(raised.exception.diag.message_primary, reason)
        q.execute('ROLLBACK TO SAVEPOINT attempt')
        self.assertEqual(self.snapshot(q), before)
        self.observations[self._testMethodName] = {'reason': reason, 'sqlstate': state, 'preserved': True}

    def test_whole_source_autocommit_rejects_before_persistent_changes(self):
        with self.transaction() as connection, connection.cursor() as q:
            before = self.snapshot(q)
        result = subprocess.run([str(registration.PG/'psql'), '-X', '-v', 'ON_ERROR_STOP=1',
            '-h', '127.0.0.1', '-p', str(self.fixture.port), '-U', registration.BOOTSTRAP,
            '-d', 'postgres'], input='SET SESSION AUTHORIZATION postgres;\n'+SOURCE.read_text(),
            text=True, env=self.fixture.env, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 3)
        self.assertIn('thumbnail_install_outer_transaction_required', result.stderr)
        self.assertEqual(result.stderr.count('ERROR:'), 1)
        with self.transaction() as connection, connection.cursor() as q:
            self.assertEqual(self.snapshot(q), before)
        self.observations[self._testMethodName] = {'exit': 3, 'reason': 'thumbnail_install_outer_transaction_required',
            'preserved': True, 'wholeSourceSubmitted': True, 'fullInstallationExecuted': False}

    def test_private_bucket_commit_server_access_and_browser_denial(self):
        connection = self.fixture.connect()
        try:
            with connection.cursor() as q:
                self.apply_bucket(q)
            connection.commit()
            with self.fixture.connect() as readback, readback.cursor() as q:
                q.execute("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='youtube-thumbnail-jobs'")
                self.assertEqual(q.fetchone(), (False, 12582912, ['image/png','image/jpeg','image/webp','application/json']))
                q.execute('SET LOCAL ROLE service_role')
                q.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('youtube-thumbnail-jobs','owned-fixture/output.png')")
                q.execute("SELECT count(*) FROM storage.objects WHERE bucket_id='youtube-thumbnail-jobs'")
                self.assertEqual(q.fetchone()[0], 1)
                for role in ['anon', 'authenticated']:
                    q.execute('SET LOCAL ROLE '+role)
                    q.execute("SELECT count(*) FROM storage.objects WHERE bucket_id='youtube-thumbnail-jobs'")
                    self.assertEqual(q.fetchone()[0], 0)
                    q.execute("SELECT count(*) FROM storage.buckets WHERE id='youtube-thumbnail-jobs'")
                    self.assertEqual(q.fetchone()[0], 0)
                    q.execute("UPDATE storage.objects SET name='forbidden' WHERE bucket_id='youtube-thumbnail-jobs'")
                    self.assertEqual(q.rowcount, 0)
                    q.execute("DELETE FROM storage.objects WHERE bucket_id='youtube-thumbnail-jobs'")
                    self.assertEqual(q.rowcount, 0)
                    q.execute('SAVEPOINT browser_insert')
                    with self.assertRaises(registration.psycopg2.Error) as raised:
                        q.execute("INSERT INTO storage.objects(bucket_id,name) VALUES('youtube-thumbnail-jobs','forbidden.png')")
                    self.assertEqual(raised.exception.pgcode, '42501')
                    self.assertIn('row-level security', raised.exception.diag.message_primary)
                    q.execute('ROLLBACK TO SAVEPOINT browser_insert')
                readback.rollback()
            self.observations[self._testMethodName] = {'bucketCommittedAndIndependentlyRead': True,
                'serverInsertAndSelect': True, 'browserRoles': 2, 'browserSelectUpdateDeleteRows': 0,
                'browserInsert': '42501', 'storageHttpVerified': False}
        finally:
            connection.rollback(); connection.close()
            with self.fixture.connect() as cleanup, cleanup.cursor() as q:
                q.execute("DELETE FROM storage.buckets WHERE id='youtube-thumbnail-jobs'")

    def test_policy_digest_is_independent_of_incoming_search_path(self):
        for initial in ['', 'pg_catalog', 'public', 'pg_catalog, public']:
            with self.subTest(path=initial), self.transaction() as connection, connection.cursor() as q:
                self.apply_bucket(q, initial)
                connection.rollback()
        self.observations[self._testMethodName] = {'incomingPaths': 4, 'restored': True}

    def test_old_deparser_context_reproduces_nominal_policy_rejection(self):
        with self.transaction() as connection, connection.cursor() as q:
            before = self.snapshot(q)
            q.execute('SAVEPOINT old_context')
            q.execute('SET SESSION AUTHORIZATION postgres')
            q.execute(block('thumbnail_install_transaction'))
            mutant = block('thumbnail_install_bucket').replace(
                "PERFORM pg_catalog.set_config('search_path','pg_catalog, public',true);", '')
            self.assertNotEqual(mutant, block('thumbnail_install_bucket'))
            with self.assertRaises(registration.psycopg2.Error) as raised:
                q.execute(mutant)
            self.assertEqual(raised.exception.pgcode, '55000')
            self.assertEqual(raised.exception.diag.message_primary, 'thumbnail_install_bucket_prior_conflict')
            q.execute('ROLLBACK TO SAVEPOINT old_context')
            self.assertEqual(self.snapshot(q), before)
        self.observations[self._testMethodName] = {'inMemoryOldContext': True,
            'reason': 'thumbnail_install_bucket_prior_conflict', 'sourceMutated': False}

    def test_manifest_readback_exact_components_and_policy_contexts(self):
        manifest = json.loads(MANIFEST.read_bytes())['migration']
        self.assertEqual(manifest['expectedPriorState']['query'], manifest['terminalReadback']['query'])
        with self.transaction() as connection, connection.cursor() as q:
            q.execute('ALTER ROLE original_bootstrap RENAME TO supabase_admin;'
                      # Model the observed effective read access, without claiming its hosted grant path.
                      'GRANT pg_read_all_data TO postgres WITH INHERIT TRUE,SET FALSE;'
                      'CREATE SCHEMA supabase_migrations;'
                      'CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);'
                      'GRANT USAGE ON SCHEMA supabase_migrations TO postgres;'
                      'GRANT SELECT ON supabase_migrations.schema_migrations TO postgres;')
            self.apply_bucket(q)
            q.execute(registration.SQL.read_text())
            for path in ['', 'pg_catalog', 'public', 'pg_catalog, public']:
                q.execute("SELECT set_config('search_path',%s,true)", (path,))
                q.execute(manifest['terminalReadback']['query']); observed = q.fetchone()[0]
                for field in ['queueSchema','queueTables','queueFunctions','bucket','storageManagedBoundary',
                              'storagePolicyContract','browserRoleBoundary','storageServerBoundary','storageLockCapability',
                              'registryCount','registryNewRows','oldRegistryDigest','temporaryObjectsAbsent']:
                    self.assertEqual(observed[field], manifest['terminalReadback']['expected'][field], field)
                self.assertEqual(observed['assertions'], [x for x in manifest['terminalReadback']['expected']['assertions']
                    if x[0] in ['assert_g014_catalog_contract','assert_g014_definer_contract']])
                self.assertEqual(observed['ledgerCount'], 0)
        self.observations[self._testMethodName] = {'exactComponents': True, 'incomingPaths': 4,
            'assertionsExecutedForPatch': 2, 'fixtureLedgerRows': 0, 'hosted89RowAdmissionProved': False,
            'fullG014GraphExecuted': False}

    def test_manifest_compiles_with_existing_transaction_and_reconciliation(self):
        node = '/opt/homebrew/Cellar/node@24/24.22.0/bin/node'
        program = """import {readFileSync} from 'node:fs';
          import {execFileSync} from 'node:child_process';
          import {createHash} from 'node:crypto';
          import {migrationEnvelope,atomicMigrationSql,reconciliationSql,reconciliationOutcome} from './apps/web/scripts/supabase-migration-transaction.mjs';
          const manifest=JSON.parse(readFileSync('.github/thumbnail-production-installation.draft.v1.json'));
          const m=manifest.migration, bytes=readFileSync(m.candidatePath);
          const hash=v=>createHash('sha256').update(v).digest('hex');
          if(process.versions.node!=='24.22.0'||manifest.executionEnabled!==false||bytes.length!==m.bytes)throw Error('PIN_OR_HOLD_DRIFT');
          const vector=JSON.parse(execFileSync(process.execPath,['backend/supabase/scripts/g037_supabase_statement_vector.mjs','--source',m.candidatePath,'--version','20261024071000','--sha256',m.sha256,'--size',String(m.bytes)],{encoding:'utf8'})).statements;
          if(vector.length!==m.statementCount||hash(JSON.stringify(vector))!==m.originalVectorSha256)throw Error('VECTOR_DRIFT');
          for(const p of manifest.components){const b=readFileSync(p.path);if(b.length!==p.bytes||hash(b)!==p.sha256)throw Error('COMPONENT_DRIFT');}
          const plan=migrationEnvelope(bytes,m,vector);
          if(plan.execution!==bytes.toString('utf8'))throw Error('UNEXPECTED_TRANSACTION_ENVELOPE');
          const compiled=atomicMigrationSql(plan,m), reconciliation=reconciliationSql(plan,m);
          if(!compiled.includes(plan.execution)||!compiled.includes('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE'))throw Error('COMPILER_BOUNDARY_DRIFT');
          if(reconciliationOutcome({ledger_exists:true,ledger_equal:true,prior:null,terminal:m.terminalReadback.expected},m)!=='committed')throw Error('COMMITTED_RECONCILIATION_DRIFT');
          if(reconciliationOutcome({ledger_exists:false,ledger_equal:false,prior:m.expectedPriorState.expected,terminal:null},m)!=='not_applied')throw Error('ABSENT_RECONCILIATION_DRIFT');
          if(reconciliationOutcome({ledger_exists:true,ledger_equal:false,prior:null,terminal:m.terminalReadback.expected},m)!=='partial_conflict')throw Error('UNCERTAIN_REPLAY_ADMITTED');
          process.stdout.write(JSON.stringify({candidateSha256:hash(bytes),statements:vector.length,compilerSha256:hash(compiled),reconciliationSha256:hash(reconciliation),executionEnabled:manifest.executionEnabled,hostedWrites:0}));"""
        result = subprocess.run([node, '--input-type=module', '-e', program], cwd=ROOT,
                                text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.observations[self._testMethodName] = json.loads(result.stdout)

    def test_existing_select_insert_without_lock_privilege_is_denied(self):
        with self.transaction() as connection, connection.cursor() as q:
            q.execute('REVOKE UPDATE ON storage.objects FROM postgres')
            self.rejected(q, 'thumbnail_install_storage_lock_denied', '42501')

    def test_browser_bypass_and_superuser_are_denied(self):
        for role, attribute in [('anon','BYPASSRLS'),('authenticated','SUPERUSER')]:
            with self.subTest(role=role, attribute=attribute), self.transaction() as connection, connection.cursor() as q:
                q.execute('ALTER ROLE '+role+' '+attribute)
                self.rejected(q, 'thumbnail_install_storage_browser_boundary_denied', '42501')

    def test_browser_effective_owner_or_set_membership_is_denied(self):
        for options in ['INHERIT TRUE, SET FALSE', 'INHERIT FALSE, SET TRUE']:
            with self.subTest(options=options), self.transaction() as connection, connection.cursor() as q:
                q.execute('GRANT supabase_storage_admin TO anon WITH '+options)
                self.rejected(q, 'thumbnail_install_storage_browser_boundary_denied', '42501')

    def test_policy_drift_is_denied_and_preserved(self):
        with self.transaction() as connection, connection.cursor() as q:
            q.execute('ALTER POLICY "Public read access" ON storage.objects USING(true)')
            self.rejected(q, 'thumbnail_install_bucket_prior_conflict', '55000')

    def test_preexisting_private_bucket_is_not_overwritten(self):
        with self.transaction() as connection, connection.cursor() as q:
            q.execute("INSERT INTO storage.buckets(id,name,public) VALUES('youtube-thumbnail-jobs','existing',true)")
            self.rejected(q, 'thumbnail_install_bucket_prior_conflict', '55000')

    def test_late_failure_rolls_back_bucket_and_metadata(self):
        with self.transaction() as connection, connection.cursor() as q:
            before = self.snapshot(q)
            q.execute('SAVEPOINT installation')
            self.apply_bucket(q)
            with self.assertRaises(registration.psycopg2.Error):
                q.execute("DO $$ BEGIN RAISE EXCEPTION 'owned_late_failure'; END $$")
            q.execute('ROLLBACK TO SAVEPOINT installation')
            self.assertEqual(self.snapshot(q), before)
            self.observations[self._testMethodName] = {'bucketComponentRollback': True, 'fullInstallationRollback': False}


if __name__ == '__main__':
    unittest.main()
