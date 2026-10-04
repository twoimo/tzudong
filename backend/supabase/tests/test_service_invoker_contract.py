"""Exact-source contract patch and isolated PG17 permission drift checks."""
import hashlib
import os
from pathlib import Path
import re
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / 'backend/supabase/migrations'
MIGRATION = MIGRATIONS / '20261003113923_g014_service_invoker_contract.sql'


def tagged(source, tag):
    return source.split('$' + tag + '$', 2)[1]


def replace_exact(source, anchor, replacement):
    if source.count(anchor) != 1:
        raise ValueError('contract reconstruction anchor drift')
    return source.replace(anchor, replacement, 1)


def definitions():
    result = {}
    for name, filename in (
        ('definer', '20260713002400_g014_retention_adapters_receipts.sql'),
        ('catalog', '20260713002500_g014_catalog_contract.sql'),
    ):
        source = (MIGRATIONS / filename).read_text()
        pattern = r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_' + name + r'_contract\(\).*?\$function\$;'
        result[name] = re.search(pattern, source, re.S).group()
    bridge = (MIGRATIONS / '20260804000500_g041_auth_workflow_bridge.sql').read_text()
    result['definer'] = replace_exact(result['definer'], tagged(bridge, 'definer_predicate'), tagged(bridge, 'definer_replacement'))
    for tag in ('helper', 'rpc'):
        result['catalog'] = replace_exact(result['catalog'], tagged(bridge, tag + '_predicate'), tagged(bridge, tag + '_replacement'))
    legacy = dict(result)
    thumbnail = (MIGRATIONS / '20260812000500_local_youtube_thumbnail_rpc_allowlist_convergence.sql').read_text()
    result['definer'] = replace_exact(result['definer'], tagged(thumbnail, 'definer_invoker_anchor_extensions'), tagged(thumbnail, 'definer_invoker_replacement'))
    result['catalog'] = replace_exact(result['catalog'], tagged(thumbnail, 'invoker_anchor'), tagged(thumbnail, 'invoker_replacement'))
    for filename in ('20260812000600_local_profile_read_boundary_convergence.sql', '20260812000700_local_profile_leaderboard_page_convergence.sql'):
        source = (MIGRATIONS / filename).read_text()
        for name in result:
            result[name] = replace_exact(result[name], tagged(source, name + '_anchor'), tagged(source, name + '_replacement'))
    profile = (MIGRATIONS / '20260813085342_current_profile_mutation_boundary.sql').read_text()
    result['definer'] = replace_exact(result['definer'], tagged(profile, 'definer_anchor'), tagged(profile, 'definer_replacement'))
    for tag in ('definer', 'matrix'):
        result['catalog'] = replace_exact(result['catalog'], tagged(profile, 'catalog_' + tag + '_anchor'), tagged(profile, 'catalog_' + tag + '_replacement'))
    return result, legacy


class SourceContract(unittest.TestCase):
    def test_frozen_source_variants_and_existing_guards_are_preserved(self):
        source = MIGRATION.read_text()
        current, legacy = definitions()
        expected = {
            'definer': '6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d',
            'catalog': 'c58fa9c66865db3f5e81513f9537084a9024ebe77863a1b22f4ddb37936c6998',
        }
        for name, definition in current.items():
            body = tagged(definition, 'function')
            self.assertEqual(hashlib.sha256(body.encode()).hexdigest(), expected[name])
            self.assertIn(expected[name], source)
            anchor = tagged(source, name + '_anchor')
            addition = tagged(source, name + '_addition')
            after = replace_exact(body, anchor, addition + anchor)
            self.assertEqual(after.replace(addition, '', 1), body)
        self.assertNotRegex(source, r'\b(?:GRANT|REVOKE|ALTER ROLE)\b')
        self.assertIn('metadata_after IS DISTINCT FROM metadata_before', source)


@unittest.skipUnless(os.environ.get('TZUDONG_SERVICE_INVOKER_LOCAL_PG') == '1', 'owned private PG17 opt-in required')
class PostgreSQLContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg2
        cls.psycopg2 = psycopg2
        socket = os.environ['TZUDONG_TEST_PG_SOCKET']
        if not socket.startswith('/'):
            raise ValueError('absolute Unix socket required')
        cls.params = dict(host=socket, port=int(os.environ.get('TZUDONG_TEST_PG_PORT', '18797')), user='postgres')
        cls.admin = psycopg2.connect(dbname='postgres', **cls.params)
        cls.admin.autocommit = True
        cls.addClassCleanup(cls.admin.close)
        with cls.admin.cursor() as cursor:
            cursor.execute("SELECT current_setting('server_version_num')::int / 10000")
            if cursor.fetchone()[0] != 17:
                raise ValueError('private PG17 required')
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname='privacy_auth_bridge'")
            if cursor.fetchone() is None:
                cursor.execute('CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT')
                cls.addClassCleanup(cls.drop_owned_bridge)

    @classmethod
    def drop_owned_bridge(cls):
        with cls.admin.cursor() as cursor:
            cursor.execute('DROP ROLE privacy_auth_bridge')

    def setUp(self):
        self.db = 'invoker_' + uuid.uuid4().hex
        with self.admin.cursor() as cursor:
            cursor.execute('CREATE DATABASE ' + self.db + " TEMPLATE template0 ENCODING 'UTF8'")
        self.conn = None
        self.addCleanup(self.drop_owned_database)
        self.conn = self.psycopg2.connect(dbname=self.db, **self.params)
        self.conn.autocommit = True
        self.cursor = self.conn.cursor()
        self.cursor.execute('CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner; CREATE TABLE privacy_retention.g014_public_rpc_allowlist(source_signature text,grantee name); GRANT SELECT ON privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner; CREATE TABLE privacy_retention.privacy_retention_runs(id uuid); CREATE TABLE public.admin_storyboard_production_projects(id uuid); CREATE TABLE public.admin_storyboard_production_jobs(id uuid);')
        self.source = MIGRATION.read_text()
        for name, definition in definitions()[0].items():
            self.cursor.execute(definition + ' ALTER FUNCTION privacy_retention.assert_g014_' + name + '_contract() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_' + name + '_contract() FROM PUBLIC,anon,authenticated,service_role;')
        # Synthetic identities exercise the actual assertions; operation bodies
        # and the complete catalog are independently covered by canonical replay.
        signatures = re.findall(r"^      '(public\.[^']+)'", tagged(self.source, 'definer_addition'), re.M)
        self.signatures = signatures
        self.assertEqual(len(signatures), 21)
        for signature in signatures:
            settings = "search_path=''"
            if signature in ('public.extract_youtube_video_id(text)', 'public.normalize_restaurant_identity_name(text)', 'public.resolve_restaurant_identity_name(text,text,text,text)'):
                settings = 'search_path=pg_catalog,public,extensions'
            if 'automation_tick' in signature or 'automation_worker' in signature:
                settings += " SET lock_timeout='2s'"
            self.cursor.execute('CREATE FUNCTION ' + signature + " RETURNS boolean LANGUAGE sql SECURITY INVOKER SET " + settings + " AS 'SELECT true'; REVOKE ALL ON FUNCTION " + signature + ' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ' + signature + ' TO service_role;')
            self.cursor.execute('INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES(%s,\'service_role\')', (signature,))
        body = tagged(definitions()[0]['definer'], 'function')
        extra = body.split('UNION ALL VALUES', 1)[1].split('  LOOP', 1)[0]
        for signature in re.findall(r"'([^']+)'", extra):
            self.cursor.execute('CREATE FUNCTION ' + signature + " RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT true'; ALTER FUNCTION " + signature + ' OWNER TO ' + ('privacy_auth_bridge' if 'append_audit' in signature else 'privacy_workflow_owner') + ';')

    def drop_owned_database(self):
        if self.conn is not None:
            self.conn.close()
        with self.admin.cursor() as cursor:
            cursor.execute('DROP DATABASE ' + self.db + ' WITH (FORCE)')

    def state(self):
        self.cursor.execute("SELECT oid,to_jsonb(p) FROM pg_proc p WHERE oid IN (to_regprocedure('privacy_retention.assert_g014_definer_contract()'),to_regprocedure('privacy_retention.assert_g014_catalog_contract()')) ORDER BY oid")
        return self.cursor.fetchall()

    def apply(self):
        self.cursor.execute(self.source)

    def check(self):
        self.cursor.execute('SELECT privacy_retention.assert_g014_definer_contract(); SELECT pg_temp.catalog_invoker_loop();')

    def install_loop(self):
        self.cursor.execute("SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('privacy_retention.assert_g014_catalog_contract()')")
        body = self.cursor.fetchone()[0]
        start = body.index('  FOR v_expected IN\n    SELECT allowed.source_signature')
        end = body.index('  END LOOP;', start) + len('  END LOOP;')
        self.cursor.execute("CREATE FUNCTION pg_temp.catalog_invoker_loop() RETURNS void LANGUAGE plpgsql AS $loop$ DECLARE v_expected record; v_procedure oid; v_search_path text; v_is_definer boolean; BEGIN " + body[start:end] + ' END; $loop$;')

    def test_known_invokers_metadata_and_rollback(self):
        before = self.state()
        self.cursor.execute(self.source.replace('COMMIT;', 'ROLLBACK;'))
        self.assertEqual(self.state(), before)
        self.apply()
        after = self.state()
        self.assertEqual([dict(row, prosrc='') for _, row in before], [dict(row, prosrc='') for _, row in after])
        self.install_loop()
        self.check()
        self.assertEqual(len(self.signatures), 21)
        with self.assertRaisesRegex(self.psycopg2.Error, 'SOURCE_DRIFT'):
            self.apply()
        self.cursor.execute('ROLLBACK')
        self.assertEqual(self.state(), after)

    def test_replay_uses_owner_and_restores_memberships(self):
        from backend.supabase.scripts.transform_service_invoker_replay import transform
        bundle = ROOT / 'backend/supabase/baselines/historical/pre-20260214-application/G026_RECONSTRUCTION_BUNDLE.v4.json'
        def memberships():
            self.cursor.execute('SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY roleid,member,grantor')
            return self.cursor.fetchall()
        before = memberships()
        transformed = transform(MIGRATION.read_bytes(), bundle.read_bytes()).decode()
        self.cursor.execute(transformed.replace('COMMIT;', 'ROLLBACK;'))
        self.assertEqual(memberships(), before)
        self.cursor.execute(transformed)
        self.assertEqual(memberships(), before)
        self.install_loop()
        self.check()

    def test_security_owner_path_and_grant_drift(self):
        self.apply()
        self.install_loop()
        for signature in self.signatures:
            for change in ('SECURITY DEFINER', "SET search_path=public", 'OWNER TO privacy_workflow_owner'):
                with self.subTest(signature=signature, change=change):
                    self.cursor.execute('BEGIN; ALTER FUNCTION ' + signature + ' ' + change)
                    with self.assertRaisesRegex(self.psycopg2.Error, 'SECURITY INVOKER contract mismatch'):
                        self.check()
                    self.cursor.execute('ROLLBACK')
            for command in ('GRANT EXECUTE ON FUNCTION ' + signature + ' TO anon', 'GRANT EXECUTE ON FUNCTION ' + signature + ' TO PUBLIC', 'REVOKE EXECUTE ON FUNCTION ' + signature + ' FROM service_role', 'GRANT EXECUTE ON FUNCTION ' + signature + ' TO service_role WITH GRANT OPTION'):
                with self.subTest(signature=signature, command=command):
                    self.cursor.execute('BEGIN; ' + command)
                    with self.assertRaisesRegex(self.psycopg2.Error, 'SECURITY INVOKER contract mismatch'):
                        self.check()
                    self.cursor.execute('ROLLBACK')
        self.check()

    def test_unknown_invoker_and_legacy_definer_still_fail(self):
        self.apply()
        self.install_loop()
        self.cursor.execute("CREATE FUNCTION public.known_legacy() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT true'; ALTER FUNCTION public.known_legacy() OWNER TO privacy_workflow_owner; INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public.known_legacy()','service_role'); GRANT EXECUTE ON FUNCTION public.known_legacy() TO service_role;")
        self.check()
        self.cursor.execute('BEGIN; ALTER FUNCTION public.known_legacy() SECURITY INVOKER')
        with self.assertRaisesRegex(self.psycopg2.Error, 'required SECURITY DEFINER'):
            self.check()
        self.cursor.execute('ROLLBACK')
        self.cursor.execute("CREATE FUNCTION public.unknown_invoker() RETURNS boolean LANGUAGE sql SECURITY INVOKER AS 'SELECT true'; INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES('public.unknown_invoker()','service_role');")
        with self.assertRaisesRegex(self.psycopg2.Error, 'required SECURITY DEFINER'):
            self.check()

    def test_second_contract_source_drift_is_atomic(self):
        self.cursor.execute("SELECT pg_get_functiondef(to_regprocedure('privacy_retention.assert_g014_catalog_contract()'))")
        definition = self.cursor.fetchone()[0]
        self.cursor.execute(definition.replace('END;\n', 'END;\n\n'))
        before = self.state()
        with self.assertRaisesRegex(self.psycopg2.Error, 'SOURCE_DRIFT'):
            self.apply()
        self.cursor.execute('ROLLBACK')
        self.assertEqual(self.state(), before)

    def test_manual_extension_preserves_metadata_and_checks_its_acl(self):
        self.apply()
        signature='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'
        self.cursor.execute('CREATE FUNCTION '+signature+" RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS 'SELECT true'; REVOKE ALL ON FUNCTION "+signature+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+signature+' TO service_role;')
        self.cursor.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES(%s,'service_role')",(signature,))
        source=(MIGRATIONS/'20261003172126_restaurant_review_manual_invoker_contract.sql').read_text()
        before=self.state()
        self.cursor.execute(source.replace('COMMIT;','ROLLBACK;'))
        self.assertEqual(self.state(),before)
        self.cursor.execute(source)
        after=self.state()
        self.assertEqual([dict(row,prosrc='') for _,row in before],[dict(row,prosrc='') for _,row in after])
        self.install_loop();self.check()
        for change in ('SECURITY DEFINER',"SET search_path=public",'OWNER TO privacy_workflow_owner'):
            self.cursor.execute('BEGIN; ALTER FUNCTION '+signature+' '+change)
            with self.assertRaisesRegex(self.psycopg2.Error,'SECURITY INVOKER contract mismatch'):
                self.check()
            self.cursor.execute('ROLLBACK')
        self.cursor.execute('BEGIN; GRANT EXECUTE ON FUNCTION '+signature+' TO authenticated')
        with self.assertRaisesRegex(self.psycopg2.Error,'SECURITY INVOKER contract mismatch'):
            self.check()
        self.cursor.execute('ROLLBACK');self.check()
        with self.assertRaisesRegex(self.psycopg2.Error,'SOURCE_DRIFT'):
            self.cursor.execute(source)
        self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),after)

    def test_page_read_extension_preserves_existing_invoker_contract(self):
        self.apply()
        manual='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'
        page='public.admin_evaluation_page(jsonb,integer,uuid,text)'
        for signature in [manual,page]:
            config="search_path=''"+(" SET lock_timeout='2s'" if signature==manual else '')
            self.cursor.execute('CREATE FUNCTION '+signature+" RETURNS boolean LANGUAGE sql SECURITY INVOKER SET "+config+" AS 'SELECT true'; REVOKE ALL ON FUNCTION "+signature+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+signature+' TO service_role;')
            self.cursor.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES(%s,'service_role')",(signature,))
        self.cursor.execute((MIGRATIONS/'20261003172126_restaurant_review_manual_invoker_contract.sql').read_text())
        before=self.state()
        source=(MIGRATIONS/'20261003220841_admin_evaluation_page_invoker_contract.sql').read_text()
        self.cursor.execute(source.replace('COMMIT;','ROLLBACK;'));self.assertEqual(self.state(),before)
        self.cursor.execute(source);self.install_loop();self.check()
        after=self.state()
        self.assertEqual([dict(row,prosrc='') for _,row in before],[dict(row,prosrc='') for _,row in after])
        self.cursor.execute('BEGIN; GRANT EXECUTE ON FUNCTION '+page+' TO authenticated')
        with self.assertRaisesRegex(self.psycopg2.Error,'SECURITY INVOKER contract mismatch'):self.check()
        self.cursor.execute('ROLLBACK');self.check()


if __name__ == '__main__':
    unittest.main()
