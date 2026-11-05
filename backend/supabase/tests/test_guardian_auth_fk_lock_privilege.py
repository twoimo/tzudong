"""Opt-in real PG15/17 component regression; no hosted or original fixture reuse.

Uses the existing pinned disposable PostgreSQL harnesses. Tests are prepared for
the parent's DB runner; importing/collecting them never starts a database.
"""
import json
import os
from pathlib import Path
import re
import unittest
import uuid

from backend.supabase.tests import test_admin_user_ids_replay as pg15
from backend.supabase.tests import test_admin_user_ids_catalog_slice as pg17

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / 'backend/supabase/migrations/20261026140000_g014_guardian_auth_fk_lock_privilege.sql'
FOUNDATION = ROOT / 'backend/supabase/migrations/20260712000100_g010_privacy_foundation.sql'
CATALOG = ROOT / 'backend/supabase/migrations/20260713002500_g014_catalog_contract.sql'
TABLE = 'privacy_retention.privacy_guardian_verifications'
OWNER = 'privacy_workflow_owner'
USER_A = '00000000-0000-4000-8000-000000000101'
USER_B = '00000000-0000-4000-8000-000000000102'


def component_sql():
    """Use real guardian DDL, security-baseline function and manifest grant arm.

    Only the inventory helper is narrowed to this relation. This component does
    not replace a canonical replay or validate the whole G014 manifest universe.
    """
    ddl = re.search(r'CREATE TABLE public\.privacy_guardian_verifications \(.*?\n\);',
                    FOUNDATION.read_text(), re.S).group()
    ddl = ddl.replace('public.privacy_guardian_verifications', TABLE)
    catalog = CATALOG.read_text()
    baseline = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention\.assert_g014_catalog_security_baseline\(\).*?\$function\$;',
                         catalog, re.S).group()
    grant = re.search(r"  SELECT\n    'grant',.*?\n  \) AS acl", catalog, re.S).group()
    return f"""
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE SCHEMA privacy_retention AUTHORIZATION {OWNER};
GRANT USAGE ON SCHEMA privacy_retention TO postgres,anon,authenticated,service_role;
{ddl}
ALTER TABLE {TABLE} OWNER TO {OWNER};
ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY;
CREATE POLICY g014_account_deletion_source_access ON {TABLE} TO {OWNER} USING(true) WITH CHECK(true);
REVOKE ALL ON {TABLE} FROM PUBLIC,anon,authenticated,service_role,{OWNER};
GRANT SELECT,DELETE ON {TABLE} TO {OWNER};
CREATE TABLE public.account_deletion_requests(source_manifest_hash text NOT NULL,
  CONSTRAINT g014_account_deletion_applied_receipt_check CHECK(source_manifest_hash<>''));
CREATE FUNCTION privacy_retention.g014_catalog_protected_relations()
RETURNS TABLE(schema_name name,relation_name name) LANGUAGE sql AS $$
  SELECT 'privacy_retention'::name,'privacy_guardian_verifications'::name $$;
ALTER FUNCTION privacy_retention.g014_catalog_protected_relations() OWNER TO {OWNER};
{baseline}
ALTER FUNCTION privacy_retention.assert_g014_catalog_security_baseline() OWNER TO {OWNER};
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_catalog_security_baseline() FROM PUBLIC;
CREATE TABLE privacy_retention.g014_catalog_contract_manifest(
  manifest_kind text,manifest_key jsonb,manifest_value jsonb,PRIMARY KEY(manifest_kind,manifest_key));
ALTER TABLE privacy_retention.g014_catalog_contract_manifest OWNER TO {OWNER};
GRANT SELECT ON privacy_retention.g014_catalog_contract_manifest TO postgres;
CREATE FUNCTION privacy_retention.g014_catalog_manifest_rows()
RETURNS TABLE(manifest_kind text,manifest_key jsonb,manifest_value jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $function$
  WITH relation_row AS (
    SELECT 'privacy_retention'::name AS schema_name,'privacy_guardian_verifications'::name AS relation_name,
      c.relacl,c.relowner FROM pg_catalog.pg_class c WHERE c.oid='{TABLE}'::regclass
  )
{grant}
$function$;
ALTER FUNCTION privacy_retention.g014_catalog_manifest_rows() OWNER TO {OWNER};
REVOKE ALL ON FUNCTION privacy_retention.g014_catalog_manifest_rows() FROM PUBLIC;
INSERT INTO auth.users VALUES('{USER_A}'),('{USER_B}');
"""


class GuardianLockCases:
    @classmethod
    def setUpClass(cls):
        # The inherited harness owns its own network=none, pinned-image container.
        base = pg15.LocalPostgresContract if cls.major == 15 else pg17.PostgresContract
        cls.tools = type('GuardianPgTools', (base,), {})
        cls.tools.setUpClass()
        if cls.major == 15:
            cls.addClassCleanup(cls.tools.doClassCleanups)
            cls.root_role = 'supabase_admin'
        else:
            cls.addClassCleanup(cls.tools.tearDownClass)
            cls.root_role = 'bootstrap'

    @classmethod
    def q(cls, sql, db='postgres', role=None):
        role = role or cls.root_role
        args = ['exec', '-i']
        if cls.major == 15:
            args += ['-e', 'PGPASSWORD']
        args += [cls.tools.container, 'psql', '-XAtq', '-h', '127.0.0.1', '-U', role,
                 '-d', db, '-v', 'ON_ERROR_STOP=1']
        return cls.tools.docker(*args, input=sql, **({'check': False} if cls.major == 17 else {}))

    def sql(self, statement, role=None):
        result = self.q(statement, self.db, role)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def setUp(self):
        self.db = 'guardian_' + uuid.uuid4().hex[:10]
        self.assertEqual(self.q('CREATE DATABASE ' + self.db + ' OWNER postgres;').returncode, 0)
        self.addCleanup(lambda: self.q('DROP DATABASE ' + self.db + ';'))
        self.sql(component_sql())
        self.source = MIGRATION.read_text()
        self.assertEqual(int(self.sql("SELECT current_setting('server_version_num')::int/10000;")), self.major)

    def membership(self):
        return self.sql("""SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb)
          FROM pg_auth_members m WHERE roleid='privacy_workflow_owner'::regrole;""")

    def boundary(self):
        return self.sql(f"""SELECT jsonb_build_object(
          'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
          'attributes',(SELECT jsonb_agg(jsonb_build_array(attname,attacl) ORDER BY attnum)
            FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped),
          'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
          'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY polname) FROM pg_policy p WHERE polrelid=c.oid),
          'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) FROM pg_trigger t WHERE tgrelid=c.oid))
          FROM pg_class c WHERE c.oid='{TABLE}'::regclass;""")

    def snapshot(self):
        return self.sql(f"""SELECT jsonb_build_object(
          'acl',(SELECT relacl FROM pg_class WHERE oid='{TABLE}'::regclass),
          'manifest',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key),'[]'::jsonb)
            FROM privacy_retention.g014_catalog_contract_manifest m));""")

    def denied(self, statement, code, relation=None):
        result = self.q('\\set VERBOSITY verbose\n' + statement, self.db)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(code, result.stderr)
        if relation:
            self.assertIn(relation, result.stderr)

    def test_negative_42501_then_source_fix_positive_and_rollback(self):
        self.denied(f"DELETE FROM auth.users WHERE id='{USER_A}';", '42501', 'privacy_guardian_verifications')
        boundary, membership, before = self.boundary(), self.membership(), self.snapshot()
        # Test rollback with the exact body, changing only its outer transaction end.
        rollback = self.source.rsplit('COMMIT;', 1)
        self.assertEqual(len(rollback), 2)
        self.sql(rollback[0] + 'ROLLBACK;' + rollback[1], role='postgres')
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.membership(), membership)
        self.sql(self.source, role='postgres')
        self.assertEqual(self.boundary(), boundary)
        self.assertEqual(self.membership(), membership)
        self.sql(f"BEGIN; DELETE FROM auth.users WHERE id IN ('{USER_A}','{USER_B}');"
                 "DO $$BEGIN IF EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'fixture_delete_missing'; END IF; END$$; ROLLBACK;")
        self.assertEqual(self.sql('SELECT count(*) FROM auth.users;'), '2')
        self.sql('SELECT privacy_retention.assert_g014_catalog_security_baseline();')

    def test_column_update_allows_fk_but_existing_catalog_rejects_it(self):
        self.sql(f'GRANT UPDATE(id) ON {TABLE} TO {OWNER};')
        self.assertEqual(self.sql(f"SELECT has_table_privilege('{OWNER}','{TABLE}','UPDATE'),"
                                 f"has_column_privilege('{OWNER}','{TABLE}','id','UPDATE');"), 'f|t')
        self.sql(f"BEGIN; DELETE FROM auth.users WHERE id='{USER_A}'; ROLLBACK;")
        self.denied('SELECT privacy_retention.assert_g014_catalog_security_baseline();',
                    'G014 protected column ACL baseline drifted')
        self.denied(self.source, 'g014_guardian_fk_column_acl_drift')

    def test_reference_restrict_and_api_direct_writes_stay_denied(self):
        self.sql(self.source, role='postgres')
        self.sql(f"""INSERT INTO {TABLE}(id,child_user_id,status,provider,provider_reference_hash)
          VALUES(gen_random_uuid(),'{USER_A}','pending','fixture',repeat('a',64));""")
        self.denied(f"DELETE FROM auth.users WHERE id='{USER_A}';", '23503')
        self.sql(f"BEGIN; DELETE FROM auth.users WHERE id='{USER_B}'; ROLLBACK;")
        before = self.snapshot()
        for role in ('anon', 'authenticated', 'service_role'):
            for statement in (f'UPDATE {TABLE} SET id=id;', f'DELETE FROM {TABLE};',
                              f"INSERT INTO {TABLE}(id) VALUES(gen_random_uuid());"):
                with self.subTest(role=role, statement=statement.split()[0]):
                    self.denied('SET ROLE ' + role + ';' + statement, '42501')
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.sql(f"SELECT count(*) FROM {TABLE};"), '1')

    def test_idempotency_and_all_membership_rows_restored(self):
        # PG17 tests restore an existing SET FALSE and SET TRUE self grant.
        # PG15 tests restore absent/present membership (no set_option column).
        states = ('absent', 'present') if self.major == 15 else ('absent', 'set-false', 'set-true')
        original = self.membership()
        for state in states:
            with self.subTest(state=state):
                if self.major == 15:
                    self.sql(f'REVOKE {OWNER} FROM postgres;')
                    if state == 'present':
                        self.sql(f'GRANT {OWNER} TO postgres;')
                else:
                    # The PG17 fixture has a bootstrap-granted ADMIN lease and
                    # a self-granted non-SET row, matching the existing harness.
                    self.sql(f'REVOKE {OWNER} FROM postgres GRANTED BY postgres;', role='postgres')
                    if state != 'absent':
                        setting = 'TRUE' if state == 'set-true' else 'FALSE'
                        self.sql(f'GRANT {OWNER} TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET {setting} GRANTED BY postgres;', role='postgres')
                before = self.membership()
                self.sql(self.source, role='postgres')
                self.assertEqual(self.membership(), before)
                first = self.snapshot()
                self.sql(self.source, role='postgres')
                self.assertEqual(self.snapshot(), first)
                self.assertEqual(self.membership(), before)
        # Roles are cluster-global: restore fixture membership for the next case.
        rows = json.loads(original)
        if self.major == 15:
            self.sql(f'REVOKE {OWNER} FROM postgres;')
            if rows:
                self.sql(f'GRANT {OWNER} TO postgres;')
        else:
            self.sql(f'GRANT {OWNER} TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;', role='postgres')

    def test_manifest_adds_only_one_owner_update_grant(self):
        self.sql(self.source, role='postgres')
        rows = json.loads(self.sql('SELECT jsonb_agg(to_jsonb(m)) FROM privacy_retention.g014_catalog_contract_manifest m;'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0], {'manifest_kind': 'grant', 'manifest_key': {
            'schema': 'privacy_retention', 'relation': 'privacy_guardian_verifications',
            'grantee': OWNER, 'grantor': OWNER, 'privilege': 'UPDATE'},
            'manifest_value': {'grantable': False}})
        self.assertEqual(self.sql(f"SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid='{TABLE}'::regclass;"), '0')


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'parent-owned disposable PG15 opt-in required')
class Pg15GuardianLock(GuardianLockCases, unittest.TestCase):
    major = 15


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'parent-owned disposable PG17 opt-in required')
class Pg17GuardianLock(GuardianLockCases, unittest.TestCase):
    major = 17


if __name__ == '__main__':
    unittest.main()
