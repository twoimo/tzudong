"""Native PG17 role/transaction lifecycle harness, not hosted G014 proof.

The original recovery bytes run unchanged. Three full-catalog assertions are
explicit fixture functions with substituted hash anchors only in local copies.
Production SQL rejects these fixture functions without that test substitution.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest
from urllib.parse import quote
import uuid

from backend.supabase.scripts import g014_owner_recovery_plan as plan
from backend.supabase.scripts.materialize_migration_workspace import _history_mirror

BIN = Path('/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6-icu78/installed/bin')
CLI = '/Users/twoimo/.codex/runtime-cache/tzudong-supabase-cli-2.119.0/node_modules/.bin/supabase'
SOURCE = plan.ROOT / 'backend/supabase/migrations' / plan.VERIFIER
ORIGINAL = plan.ROOT / 'backend/supabase/migrations' / plan.ORIGINAL


class SourceContract(unittest.TestCase):
    def test_observed_hosted_definer_hash_follows_manual_then_page_chain(self):
        from backend.supabase.tests.test_service_invoker_contract import definitions, tagged, replace_exact, MIGRATION, MIGRATIONS
        # The observed hosted branch still has the original three invokers and
        # public.vector. Do not substitute the broader clean-replay branch.
        body = tagged(definitions()[1]['definer'], 'function').replace('extensions.vector', 'public.vector')
        base = MIGRATION.read_text()
        body = replace_exact(body, tagged(base, 'definer_anchor'), tagged(base, 'definer_addition') + tagged(base, 'definer_anchor'))
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), '065ace73391eac29c07ef05e3ca7ddd4e6caf41612b1f5898e19f8bea641b7a7')
        for filename in ['20261003172126_restaurant_review_manual_invoker_contract.sql', '20261003220841_admin_evaluation_page_invoker_contract.sql']:
            patch = (MIGRATIONS / filename).read_text()
            body = replace_exact(body, tagged(patch, 'anchor'), tagged(patch, 'signature' if 'manual' in filename else 'addition') + tagged(patch, 'anchor'))
            if 'manual' in filename:
                anchor = tagged(patch, 'definer_lock')
                body = replace_exact(body, anchor, anchor.replace(tagged(patch, 'tick'), tagged(patch, 'manual')))
                self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), '3a367f4fbe71cd16b77e446042f8f4675f87a7fd233ab171c6cc401ed242aeb9')
        self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), plan.ASSERTION_BODIES['assert_g014_definer_contract'])

    def test_original_immutable_and_stages_separate(self):
        self.assertEqual(hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(), plan.ORIGINAL_SHA256)
        self.assertEqual(SOURCE.read_text(), plan.verifier_source())
        self.assertNotIn(ORIGINAL.read_text(), SOURCE.read_text())
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / 'stages'
            report = plan.prepare(directory)
            self.assertEqual([x['expectedLedgerCountBefore'] for x in report['phases']], [75, 76, 77])
            self.assertFalse(report['hostedPostChainAdmissionVerified'])
            self.assertFalse(report['ledgerReceiptsSynthesized'])
            self.assertEqual((directory / '2-original-recovery' / plan.ORIGINAL).read_bytes(), ORIGINAL.read_bytes())
            self.assertEqual((directory / '3-identity-correction' / plan.CORRECTION).read_bytes(), (plan.ROOT / 'backend/supabase/migrations' / plan.CORRECTION).read_bytes())
            self.assertEqual((directory / '4-final-verifier' / plan.VERIFIER).read_bytes(), SOURCE.read_bytes())
            self.assertEqual(len(list(directory.glob('**/*.sql'))), 5)
            preflight = (directory / 'before-recovery-read-only.sql').read_text()
            self.assertIn('READ ONLY', preflight)
            for write in ['GRANT ', 'REVOKE ', 'CREATE ', 'ALTER ', 'UPDATE ', 'INSERT ', 'DELETE ']:
                self.assertNotIn(write, preflight)


@unittest.skipUnless(os.environ.get('TZUDONG_OWNER_FINAL_PG') == '1', 'private native cluster opt-in required')
class PG17Harness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='g014f-', dir='/tmp')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.directory = Path(cls.tmp.name)
        cls.cluster = cls.directory / 'cluster'
        cls.socket = cls.directory / 'socket'
        cls.socket.mkdir()
        cls.env = {'PATH': '/opt/homebrew/opt/node@24/bin:' + os.defpath,
                   'LC_ALL': 'C', 'PGPASSFILE': '/dev/null', 'PGCONNECT_TIMEOUT': '5'}
        cls.execute([str(BIN / 'initdb'), '-D', str(cls.cluster), '-U', 'supabase_admin',
                 '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions'])
        cls.start()
        cls.addClassCleanup(cls.stop)
        cls.q("""CREATE ROLE postgres LOGIN NOSUPERUSER INHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
""", database='postgres')
        cls.q("""CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT;
GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
""", role='postgres', database='postgres')

    @classmethod
    def execute(cls, args, *, text=None, check=True, timeout=30):
        result = subprocess.run(args, input=text, text=True, capture_output=True, env=cls.env, timeout=timeout)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    @classmethod
    def start(cls):
        cls.execute([str(BIN / 'pg_ctl'), '-D', str(cls.cluster), '-l', str(cls.directory / 'postgres.log'),
                 '-o', f"-c listen_addresses='' -c unix_socket_directories='{cls.socket}' -p 18805",
                 '-w', '-t', '20', 'start'])

    @classmethod
    def stop(cls):
        cls.execute([str(BIN / 'pg_ctl'), '-D', str(cls.cluster), '-m', 'immediate', '-w', '-t', '15', 'stop'], check=False)

    @classmethod
    def command(cls, role, database):
        return [str(BIN / 'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', str(cls.socket),
                '-p', '18805', '-U', role, '-d', database]

    @classmethod
    def q(cls, sql, *, role='supabase_admin', database=None, check=True):
        return cls.execute(cls.command(role, database or cls.db), text=sql, check=check)

    def setUp(self):
        type(self).db = 'owner_final_' + uuid.uuid4().hex[:12]
        self.q('CREATE DATABASE ' + self.db + ' OWNER postgres;', database='postgres')
        self.addCleanup(self.q, 'DROP DATABASE ' + self.db + ' WITH(FORCE);', database='postgres')
        self.q('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;', role='postgres', database='postgres')
        self.q('CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;')
        predecessor = (plan.ROOT / 'backend/supabase/migrations/20260804000500_g041_auth_workflow_bridge.sql').read_text()
        old = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract\(\).*?\$function\$;', predecessor, re.S).group()
        self.q(old + ' ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM PUBLIC;')
        self.q('CREATE SCHEMA fixture AUTHORIZATION privacy_workflow_owner; CREATE TABLE fixture.calls(name text PRIMARY KEY); ALTER TABLE fixture.calls OWNER TO privacy_workflow_owner;')
        self.hashes = {}
        for name in plan.ASSERTION_BODIES:
            body = f""" BEGIN
IF current_user<>'privacy_workflow_owner' OR session_user<>'postgres'
 OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
 OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') THEN
 RAISE EXCEPTION 'fixture_owner_context_invalid'; END IF;
IF pg_catalog.current_setting('tzudong.fixture_mode',true)='fail_{name}' THEN
 RAISE EXCEPTION 'fixture_assertion_failure'; END IF;
IF pg_catalog.current_setting('tzudong.fixture_mode',true)='wait_{name}' THEN
 PERFORM pg_catalog.pg_sleep(20); END IF;
INSERT INTO fixture.calls VALUES ('{name}') ON CONFLICT DO NOTHING;
RAISE NOTICE 'fixture_assertion_called:{name}';
END """
            self.hashes[name] = hashlib.sha256(body.encode()).hexdigest()
            self.q(f"CREATE FUNCTION privacy_retention.{name}() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub${body}$stub$; ALTER FUNCTION privacy_retention.{name}() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.{name}() FROM PUBLIC;")
        self.q('CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres;')
        historical = json.loads((plan.ROOT / 'apps/web/performance/rollout-preflight/hosted-migration-ledger-20261004.json').read_text())['migrations']
        pairs = [(r['version'], r['name']) for r in historical]
        pairs += [(name[:14], Path(name).stem[15:]) for name in plan.FORWARD_FILES]
        self.q('INSERT INTO supabase_migrations.schema_migrations VALUES ' + ','.join(f"('{version}','{name}',ARRAY['fixture'])" for version, name in pairs) + ';')

    def adapted(self, source):
        for name, original_hash in plan.ASSERTION_BODIES.items():
            if name=='assert_g014_catalog_contract' and plan.PRE_CORRECTION_CATALOG_BODY in source:
                original_hash=plan.PRE_CORRECTION_CATALOG_BODY
            self.assertEqual(source.count(original_hash), 1)
            source = source.replace(original_hash, self.hashes[name])
        return source

    def state(self):
        return self.q(plan.SNAPSHOT + ';').stdout.strip()

    def assert_no_helpers_or_access(self):
        self.assertEqual(self.q("SELECT count(*) FROM pg_proc WHERE proname IN ('g014_pg17_owner_final_check','g014_owner_recovery_check');").stdout.strip(), '0')
        self.assertEqual(self.q("SELECT pg_has_role('postgres','privacy_workflow_owner','USAGE') OR pg_has_role('postgres','privacy_workflow_owner','SET');").stdout.strip(), 'f')

    def record_fixture_correction(self):
        # Local-only synthetic receipt for final-checker lifecycle tests.
        # Real correction mutation/rollback is exercised separately below.
        from backend.supabase.scripts.g016_onboarding_identity_correction import source
        statement = source().strip().removesuffix(';')
        self.q(f"INSERT INTO supabase_migrations.schema_migrations VALUES ('{plan.CORRECTION[:14]}','{Path(plan.CORRECTION).stem[15:]}',ARRAY[$fixture_corrected${statement}$fixture_corrected$]);")

    def recover(self, corrected=True):
        # Local fixture receipt for non-CLI failure tests; never exported as a
        # hosted receipt. The success test below uses the actual pinned CLI.
        original = ORIGINAL.read_text()
        statement = original.strip().removesuffix(';')
        self.assertEqual(hashlib.sha256(statement.encode()).hexdigest(), plan.ORIGINAL_CLI_STATEMENT_SHA256)
        self.q('BEGIN;\n' + original + f"\nINSERT INTO supabase_migrations.schema_migrations VALUES ('{plan.ORIGINAL[:14]}','{Path(plan.ORIGINAL).stem[15:]}',ARRAY[$original${statement}$original$]); COMMIT;", role='postgres')
        if corrected:
            self.record_fixture_correction()

    def final(self, *, mode='', check=True):
        return self.q("BEGIN; SET LOCAL tzudong.fixture_mode='" + mode + "';\n" + self.adapted(SOURCE.read_text()) + '\nCOMMIT;', role='postgres', check=check)

    def cli_phase(self, filename, body):
        directory = self.directory / (self.db + '-' + filename[:14])
        migrations = directory / 'supabase/migrations'
        migrations.mkdir(parents=True)
        rows = json.loads(self.q("SELECT json_agg(r ORDER BY version) FROM (SELECT version,name,cardinality(statements) AS statement_count,CASE WHEN cardinality(statements)=1 THEN encode(sha256(convert_to(statements[1],'UTF8')),'hex') END AS statements_sha256,encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex') AS statements_array_sha256 FROM supabase_migrations.schema_migrations) r;").stdout)
        for row in rows:
            (migrations / f"{row['version']}_{row['name']}.sql").write_bytes(_history_mirror(row))
        (migrations / filename).write_text(body)
        (directory / 'supabase/config.toml').write_text('project_id = "g014-owner-final-fixture"\n[db.seed]\nenabled = false\n')
        uri = f'postgresql://postgres@localhost/{self.db}?host={quote(str(self.socket),safe="")}&port=18805&sslmode=disable'
        return self.execute([CLI, 'db', 'push', '--db-url', uri, '--workdir', str(directory), '--include-all', '--skip-vault', '--yes'])

class OnboardingCorrectionTests(PG17Harness):
    def setUp(self):
        super().setUp()
        from backend.supabase.scripts import g016_onboarding_identity_correction as fix
        self.fix = fix
        self.recover(corrected=False)
        catalog_body=self.q("SELECT prosrc FROM pg_proc WHERE oid='privacy_retention.assert_g014_catalog_contract()'::regprocedure;").stdout.rstrip('\n')
        catalog_body='-- '+fix.OLD+'\n'+catalog_body
        self.q("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $catalog$"+catalog_body+'$catalog$;')
        self.hashes['assert_g014_catalog_contract']=hashlib.sha256(catalog_body.encode()).hexdigest()
        self.corrected_catalog_hash=hashlib.sha256(catalog_body.replace(fix.OLD,fix.NEW).encode()).hexdigest()
        self.q("CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text,PRIMARY KEY(source_signature,grantee)); ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;")
        self.q(f"INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES ('public','confirm_privacy_onboarding','2950 25 2950 25 2950','service_role','{fix.OLD}'),('public','confirm_privacy_onboarding','2950 25 2950 25 2950 25','service_role','{fix.NEW}'),('public','fixture_other','', 'service_role','public.fixture_other()');")
        body = "BEGIN RETURN '{}'::jsonb; END"
        self.nonce_hash = hashlib.sha256(body.encode()).hexdigest()
        self.q("CREATE FUNCTION public.confirm_privacy_onboarding(a uuid,b text,c uuid,d text,e uuid,f text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $nonce$" + body + "$nonce$; ALTER FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) TO service_role;")

    def correction(self):
        # Explicit fixture-only substitutions; production source remains pinned.
        sql = self.fix.source()
        self.assertEqual(sql.count(plan.PRE_CORRECTION_CATALOG_BODY),2)
        sql=sql.replace(plan.PRE_CORRECTION_CATALOG_BODY,self.hashes['assert_g014_catalog_contract'])
        self.assertEqual(sql.count(plan.ASSERTION_BODIES['assert_g014_catalog_contract']),1)
        sql=sql.replace(plan.ASSERTION_BODIES['assert_g014_catalog_contract'],self.corrected_catalog_hash)
        for name in ('assert_g014_public_rpc_allowlist','assert_g014_definer_contract'):
            self.assertEqual(sql.count(plan.ASSERTION_BODIES[name]),1)
            sql=sql.replace(plan.ASSERTION_BODIES[name],self.hashes[name])
        self.assertEqual(sql.count(self.fix.NONCE_BODY_SHA256), 1)
        return sql.replace(self.fix.NONCE_BODY_SHA256, self.nonce_hash)

    def allowlist(self):
        return self.q('SELECT json_agg(a ORDER BY source_signature,grantee) FROM privacy_retention.g014_public_rpc_allowlist a;').stdout.strip()

    def no_correction_helper(self):
        self.assert_no_helpers_or_access()
        self.assertEqual(self.q("SELECT count(*) FROM pg_proc WHERE proname='g016_identity_correction';").stdout.strip(), '0')

    def test_exact_row_removed_real_cli_receipt_and_no_function_or_acl_change(self):
        before = json.loads(self.state())
        allowlist = json.loads(self.allowlist())
        sql = self.correction()
        self.cli_phase(plan.CORRECTION, sql)
        after = json.loads(self.state())
        # Only the catalog assertion's single identity string may change.
        catalog=[f for f in before['functions'] if f['proname']=='assert_g014_catalog_contract'][0]
        catalog['prosrc']=catalog['prosrc'].replace(self.fix.OLD,self.fix.NEW)
        self.assertEqual({k:v for k,v in before.items() if k!='ledger'}, {k:v for k,v in after.items() if k!='ledger'})
        self.assertEqual(len(after['ledger']),77)
        self.assertEqual(json.loads(self.allowlist()), [r for r in allowlist if r['source_signature'] != self.fix.OLD])
        observed = self.q(f"SELECT encode(sha256(convert_to(statements[1],'UTF8')),'hex') FROM supabase_migrations.schema_migrations WHERE version='{plan.CORRECTION[:14]}';").stdout.strip()
        self.assertEqual(observed, hashlib.sha256(sql.strip().removesuffix(';').encode()).hexdigest())
        self.assertEqual(self.q('SELECT count(*) FROM fixture.calls;').stdout.strip(),'3')
        self.no_correction_helper()

    def test_each_assertion_failure_rolls_back_identity_and_all_privileges(self):
        before = self.state(), self.allowlist()
        for name in plan.ASSERTION_BODIES:
            with self.subTest(name=name):
                r = self.q("BEGIN; SET LOCAL tzudong.fixture_mode='fail_"+name+"';\n"+self.correction()+'\nCOMMIT;',role='postgres',check=False)
                self.assertIn('fixture_assertion_failure', r.stderr)
                self.assertEqual((self.state(),self.allowlist()),before)
                self.no_correction_helper()

    def test_nonce_body_or_service_acl_drift_denied_before_identity_changes(self):
        sql = self.correction()
        for mutation in ["GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) TO anon;", "CREATE OR REPLACE FUNCTION public.confirm_privacy_onboarding(a uuid,b text,c uuid,d text,e uuid,f text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN 'null'::jsonb; END$$;"]:
            with self.subTest(mutation=mutation):
                self.q('REVOKE EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) FROM anon;')
                self.q('BEGIN;'+mutation+'COMMIT;')
                before = self.state(),self.allowlist()
                r = self.q('BEGIN;'+sql+'COMMIT;', role='postgres', check=False)
                self.assertIn('G016_NONCE_FUNCTION_DRIFT',r.stderr)
                self.assertEqual((self.state(),self.allowlist()),before)
                self.no_correction_helper()

    def test_allowlist_drift_and_already_corrected_state_reject_without_writes(self):
        for args in ['changed','2950 25 2950 25 2950']:
            self.q(f"UPDATE privacy_retention.g014_public_rpc_allowlist SET identity_arguments='{args}' WHERE source_signature='{self.fix.OLD}';")
            if args=='changed':
                before = self.state(),self.allowlist()
                r=self.q('BEGIN;'+self.correction()+'COMMIT;',role='postgres',check=False)
                self.assertIn('G016_IDENTITY_ALLOWLIST_DRIFT',r.stderr)
                self.assertEqual((self.state(),self.allowlist()),before)
        self.q('BEGIN;'+self.correction()+'COMMIT;',role='postgres')
        before=self.state(),self.allowlist()
        r=self.q('BEGIN;'+self.correction()+'COMMIT;',role='postgres',check=False)
        self.assertIn('G014_OWNER_STAGE_FUNCTION_DRIFT',r.stderr)
        self.assertEqual((self.state(),self.allowlist()),before)
        self.no_correction_helper()


class NativeOwnerFinalTests(PG17Harness):
    def test_separate_cli_history_and_successful_cleanup(self):
        self.q(self.adapted(plan.preflight_source()), role='postgres')
        self.cli_phase(plan.ORIGINAL, ORIGINAL.read_text())
        self.record_fixture_correction()
        before = self.state()
        self.cli_phase(plan.VERIFIER, self.adapted(SOURCE.read_text()))
        self.assertEqual(self.q('SELECT name FROM fixture.calls ORDER BY name;').stdout.splitlines(), sorted(plan.ASSERTION_BODIES))
        after = json.loads(self.state())
        before_data = json.loads(before)
        self.assertEqual({k: v for k, v in after.items() if k != 'ledger'}, {k: v for k, v in before_data.items() if k != 'ledger'})
        self.assertEqual(len(after['ledger']), 78)
        self.assertEqual([row for row in after['ledger'] if row['version'] != plan.VERIFIER[:14]], before_data['ledger'])
        self.assert_no_helpers_or_access()
        # An already-recorded verifier cannot synthesize another receipt.
        rejected = self.final(check=False)
        self.assertIn('G014_OWNER_STAGE_LEDGER_DRIFT', rejected.stderr)
        self.assertEqual(json.loads(self.state()), after)

    def test_prod_hashes_reject_fixture_and_missing_chain_before_changes(self):
        before = self.state()
        result = self.q(plan.preflight_source(), role='postgres', check=False)
        self.assertIn('G014_OWNER_STAGE_FUNCTION_DRIFT', result.stderr)
        self.assertEqual(before, self.state())
        self.q("DELETE FROM supabase_migrations.schema_migrations WHERE version='20261004120000';")
        before = self.state()
        result = self.q(self.adapted(plan.preflight_source()), role='postgres', check=False)
        self.assertIn('G014_OWNER_STAGE_LEDGER_DRIFT', result.stderr)
        self.assertEqual(before, self.state())

    def test_acl_role_and_membership_drift_deny_recovery_admission(self):
        mutations = [
            ('GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO anon;', 'G014_OWNER_STAGE_FUNCTION_DRIFT'),
            ('ALTER ROLE privacy_workflow_owner BYPASSRLS;', 'G014_OWNER_STAGE_ROLE_DRIFT'),
            ('GRANT privacy_workflow_owner TO anon WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;', 'G014_OWNER_STAGE_MEMBERSHIP_DRIFT'),
        ]
        for mutation, code in mutations:
            with self.subTest(code=code):
                before = self.state()
                sql = 'BEGIN; ' + mutation + ' SET SESSION AUTHORIZATION postgres; ' + self.adapted(plan.preflight_source()).split('READ ONLY;', 1)[1].rsplit('COMMIT;', 1)[0] + ' ROLLBACK;'
                result = self.q(sql, check=False)
                self.assertIn(code, result.stderr)
                self.assertEqual(before, self.state())

    def test_final_rejects_pre_recovery_state_and_app_roles(self):
        before = self.state()
        result = self.final(check=False)
        self.assertIn('G014_OWNER_STAGE_MEMBERSHIP_DRIFT', result.stderr)
        self.assertEqual(before, self.state())
        for role in ['anon', 'authenticated', 'service_role']:
            result = self.q('SET ROLE ' + role + ';' + self.adapted(SOURCE.read_text()), check=False)
            self.assertIn('G014_OWNER_STAGE_EXECUTOR_DENIED', result.stderr)
            self.assertEqual(before, self.state())

    def test_each_assertion_failure_rolls_back_helper_and_privileges_then_retry_succeeds(self):
        self.recover()
        before = self.state()
        for name in plan.ASSERTION_BODIES:
            with self.subTest(name=name):
                result = self.final(mode='fail_' + name, check=False)
                self.assertIn('fixture_assertion_failure', result.stderr)
                self.assertEqual(before, self.state())
                self.assert_no_helpers_or_access()
                self.assertEqual(self.q('SELECT count(*) FROM fixture.calls;').stdout.strip(), '0')
        self.final()
        self.assertEqual(before, self.state())
        self.assert_no_helpers_or_access()

    def test_rollback_and_preexisting_helper_are_preserved(self):
        self.recover()
        before = self.state()
        self.q('BEGIN;\n' + self.adapted(SOURCE.read_text()) + '\nROLLBACK;', role='postgres')
        self.assertEqual(before, self.state())
        self.assert_no_helpers_or_access()
        result = self.q("CREATE FUNCTION pg_temp.g014_pg17_owner_final_check() RETURNS void LANGUAGE plpgsql AS $$BEGIN NULL; END$$;\n"
                        "BEGIN; SAVEPOINT attempt;\n\\set ON_ERROR_STOP off\n" + self.adapted(SOURCE.read_text())
                        + "\n\\set ON_ERROR_STOP on\nROLLBACK TO SAVEPOINT attempt;\n"
                        "SELECT to_regprocedure('pg_temp.g014_pg17_owner_final_check()') IS NOT NULL;\nROLLBACK;\n"
                        "DROP FUNCTION pg_temp.g014_pg17_owner_final_check();", role='postgres')
        self.assertIn('G014_OWNER_FINAL_HELPER_CONFLICT', result.stderr)
        self.assertEqual(result.stdout.strip(), 't')
        self.assertEqual(before, self.state())

    def test_unexpected_default_function_grantee_rolls_back_verifier(self):
        self.recover()
        self.q('CREATE ROLE fixture_extra NOLOGIN; ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner GRANT EXECUTE ON FUNCTIONS TO fixture_extra;')
        before = self.state()
        result = self.final(check=False)
        self.assertIn('G014_OWNER_FINAL_HELPER_ACL_DRIFT', result.stderr)
        self.assertEqual(before, self.state())
        self.assert_no_helpers_or_access()

    def test_recorded_recovery_body_drift_is_rejected_before_verifier(self):
        self.recover()
        self.q("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['changed'] WHERE version='20260906064252';")
        before = self.state()
        result = self.final(check=False)
        self.assertIn('G014_OWNER_RECOVERY_RECEIPT_DRIFT', result.stderr)
        self.assertEqual(before, self.state())
        self.assert_no_helpers_or_access()

    def test_owned_cluster_crash_rolls_back_private_helper_and_retry(self):
        self.recover()
        before = self.state()
        application = 'g014_final_restart_' + uuid.uuid4().hex[:10]
        sql = f"SET application_name='{application}'; BEGIN; SET LOCAL tzudong.fixture_mode='wait_assert_g014_catalog_contract';\n" + self.adapted(SOURCE.read_text()) + '\nCOMMIT;'
        process = subprocess.Popen(self.command('postgres', self.db), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=self.env)
        process.stdin.write(sql)
        process.stdin.close()
        try:
            ready = False
            for _ in range(40):
                if process.poll() is not None:
                    self.fail(process.stderr.read())
                count = self.q(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{application}' AND wait_event='PgSleep';").stdout.strip()
                if count == '1':
                    ready = True
                    break
                time.sleep(.05)
            self.assertTrue(ready, 'fixture assertion did not reach interruption boundary')
            self.stop()
            process.wait(timeout=10)
            self.assertNotEqual(process.returncode, 0)
            self.start()
            self.assertEqual(before, self.state())
            self.assert_no_helpers_or_access()
            self.assertEqual(self.q('SELECT count(*) FROM fixture.calls;').stdout.strip(), '0')
            self.final()
            self.assertEqual(before, self.state())
            self.assert_no_helpers_or_access()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()


if __name__ == '__main__':
    unittest.main()
