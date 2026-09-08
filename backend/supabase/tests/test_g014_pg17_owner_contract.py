"""Private PG17 role-creation compatibility; never opens a hosted connection."""
import os
from pathlib import Path
import re
import secrets
import time
import unittest
import uuid

from backend.supabase.tests import test_admin_user_ids_catalog_slice as pg17_fixture
from backend.supabase.tests import test_admin_user_ids_replay as pg15_fixture
from backend.supabase.scripts import verify_g014_pg17_owner_replay as replay

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'backend/supabase/migrations/20260906064252_g014_pg17_workflow_owner_contract.sql'
PREDECESSOR = ROOT / 'backend/supabase/migrations/20260804000500_g041_auth_workflow_bridge.sql'


class SourceContract(unittest.TestCase):
    def test_read_only_legacy_adapter_and_source_binding(self):
        sql = replay.verification_sql(MIGRATION.read_bytes()).decode()
        for statement in ('GRANT ', 'REVOKE ', 'CREATE ', 'ALTER ', 'DELETE ', 'UPDATE ', 'INSERT '):
            self.assertNotIn(statement, sql)
        self.assertIn('READ ONLY', sql)
        with self.assertRaisesRegex(ValueError, 'source_drift'):
            replay.verification_sql(MIGRATION.read_bytes() + b'\n')


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'private PG17 opt-in required')
class OwnerContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pg17_fixture.PostgresContract.setUpClass()
        pg17_fixture.PostgresContract.q('ALTER ROLE original_bootstrap RENAME TO supabase_admin; ALTER ROLE postgres CREATEROLE;')
        # Actual PG17 CREATE ROLE automatically creates the bootstrap ADMIN row.
        pg17_fixture.PostgresContract.q('CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT;', role='postgres')
        pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;', role='postgres')

    @classmethod
    def tearDownClass(cls):
        pg17_fixture.PostgresContract.tearDownClass()

    def q(self, sql, *, role='bootstrap', check=True):
        return pg17_fixture.PostgresContract.q(sql, db=self.db, role=role, check=check)

    def setUp(self):
        self.db = 'owner_contract_' + uuid.uuid4().hex[:10]
        pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;', role='postgres')
        pg17_fixture.PostgresContract.q('CREATE DATABASE ' + self.db + ' OWNER postgres;')
        self.q('CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;')
        old = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract\(\).*?\$function\$;', PREDECESSOR.read_text(), re.S).group()
        self.q(old + ' ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM PUBLIC;')

    def tearDown(self):
        pg17_fixture.PostgresContract.q('DROP DATABASE ' + self.db + ';')

    def state(self):
        return self.q("SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),'helper',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid='privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure));").stdout.strip()

    def apply(self, end='COMMIT', check=True):
        return self.q('BEGIN; ' + MIGRATION.read_text() + ' ' + end + ';', role='postgres', check=check)

    def assert_rejected_unchanged(self, code):
        before = self.state()
        result = self.apply(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(code, result.stderr)
        self.assertEqual(before, self.state())

    def test_native_creator_model_removes_only_self_access(self):
        before = self.state()
        self.apply('ROLLBACK')
        self.assertEqual(before, self.state())
        self.apply()
        self.assertEqual(self.q("SELECT count(*) FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole;").stdout.strip(), '2')
        self.assertEqual(self.q("SELECT pg_has_role('postgres','privacy_workflow_owner','USAGE') OR pg_has_role('postgres','privacy_workflow_owner','SET');").stdout.strip(), 'f')
        self.assertEqual(self.q("SELECT count(*) FROM pg_auth_members WHERE grantor=10 AND member='postgres'::regrole AND roleid IN ('privacy_workflow_owner'::regrole,'privacy_auth_bridge'::regrole) AND admin_option AND NOT inherit_option AND NOT set_option;").stdout.strip(), '2')
        self.q('SET ROLE privacy_workflow_owner; SELECT privacy_retention.assert_g014_workflow_owner_contract();')
        for role in ('anon', 'authenticated', 'service_role'):
            self.assertNotEqual(self.q('SET ROLE ' + role + '; SELECT privacy_retention.assert_g014_workflow_owner_contract();', check=False).returncode, 0)
        self.assert_rejected_unchanged('g014_owner_recovery_source_drift')

    def test_extra_owner_member_is_not_admitted(self):
        pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO anon WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;', role='postgres')
        try:
            self.assert_rejected_unchanged('g014_pg17_workflow_owner_membership_denied')
        finally:
            pg17_fixture.PostgresContract.q('REVOKE privacy_workflow_owner FROM anon;', role='postgres')

    def test_unexpected_assertion_grant_is_not_admitted(self):
        self.q('GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO anon;')
        self.assert_rejected_unchanged('g014_owner_recovery_source_drift')

    def test_active_set_lease_is_not_admitted(self):
        pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;', role='postgres')
        try:
            self.assert_rejected_unchanged('g014_owner_recovery_membership_admission_denied')
        finally:
            pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;', role='postgres')

    def test_bridge_self_access_is_not_admitted(self):
        pg17_fixture.PostgresContract.q('GRANT privacy_auth_bridge TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;', role='postgres')
        try:
            self.assert_rejected_unchanged('g014_pg17_workflow_owner_membership_denied')
        finally:
            pg17_fixture.PostgresContract.q('REVOKE privacy_auth_bridge FROM postgres GRANTED BY postgres;', role='postgres')

    def test_privileged_workflow_role_is_not_admitted(self):
        pg17_fixture.PostgresContract.q('ALTER ROLE privacy_workflow_owner BYPASSRLS;')
        try:
            self.assert_rejected_unchanged('privacy workflow bridge role attributes are incompatible')
        finally:
            pg17_fixture.PostgresContract.q('ALTER ROLE privacy_workflow_owner NOBYPASSRLS;')

    def test_reintroduced_self_grant_fails_new_contract(self):
        self.apply()
        pg17_fixture.PostgresContract.q('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;', role='postgres')
        result = self.q('SET ROLE privacy_workflow_owner; SELECT privacy_retention.assert_g014_workflow_owner_contract();', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('g014_pg17_workflow_owner_membership_denied', result.stderr)


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'private PG15 opt-in required')
class LegacyReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = type('PG15Tools', (pg15_fixture.LocalPostgresContract,), {})
        cls.fixture.container = 'g014-owner-pg15-' + uuid.uuid4().hex[:10]
        cls.fixture.password = secrets.token_hex(24)
        started = cls.fixture.docker('run', '--rm', '-d', '--network', 'none', '--name', cls.fixture.container,
            '-e', 'POSTGRES_PASSWORD', 'supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b')
        if started.returncode:
            raise AssertionError(started.stderr)
        cls.addClassCleanup(cls.fixture.docker, 'rm', '-f', cls.fixture.container)
        for _ in range(200):
            if cls.fixture.query('SELECT 1;').returncode == 0:
                break
            time.sleep(.1)
        old = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract\(\).*?\$function\$;', PREDECESSOR.read_text(), re.S).group()
        setup = cls.fixture.query('''ALTER ROLE postgres NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT;
CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT;
GRANT privacy_workflow_owner TO privacy_auth_bridge;
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
''' + old + '''
ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM PUBLIC;
''')
        if setup.returncode:
            raise AssertionError(setup.stderr)

    def test_local_replay_uses_required_login_actor(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        sql = replay.verification_sql(MIGRATION.read_bytes())
        rejected = self.fixture.query(sql.decode(), role='supabase_admin')
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('g014_owner_replay_executor_denied', rejected.stderr)
        fixture = self.fixture
        class Executor:
            def capture(self, statement, *, role='supabase_admin'):
                result = fixture.query(statement.decode(), role=role)
                if result.returncode:
                    raise AssertionError(result.stderr)
                return result.stdout.encode()
            def run(self, statement):
                raise AssertionError('Read-only replay must not write')
        proof = local_migrate.verify_replay(Executor(), MIGRATION.relative_to(ROOT).as_posix())
        self.assertEqual(proof['disposition'], 'legacy-contract-preserved')

    def test_legacy_contract_passes_without_private_schema_access(self):
        before = self.fixture.query('SELECT md5(string_agg(row_to_json(p)::text,\',\' ORDER BY oid)) FROM pg_proc p;').stdout
        result = self.fixture.query(replay.verification_sql(MIGRATION.read_bytes()).decode(), role='postgres')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('legacy-contract-preserved', result.stdout)
        after = self.fixture.query('SELECT md5(string_agg(row_to_json(p)::text,\',\' ORDER BY oid)) FROM pg_proc p;').stdout
        self.assertEqual(before, after)

    def test_extra_membership_and_function_acl_are_denied(self):
        body = replay.verification_sql(MIGRATION.read_bytes()).decode().split('READ ONLY;', 1)[1].rsplit('COMMIT;', 1)[0]
        for mutation, code in (
            ('GRANT privacy_workflow_owner TO anon;', 'g014_owner_replay_membership_denied'),
            ('GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO anon;', 'g014_owner_replay_function_denied'),
            ('ALTER ROLE privacy_auth_bridge NOINHERIT;', 'g014_owner_replay_membership_denied'),
        ):
            with self.subTest(mutation=mutation):
                result = self.fixture.query('BEGIN; ' + mutation + ' SET SESSION AUTHORIZATION postgres; ' + body + ' ROLLBACK;')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(code, result.stderr)


if __name__ == '__main__':
    unittest.main()
