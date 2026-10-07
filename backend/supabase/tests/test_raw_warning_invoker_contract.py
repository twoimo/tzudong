"""Raw RPC G014 registration, exact source admission and private helper cleanup."""
import hashlib
import os
import re
import unittest
from backend.supabase.tests import test_service_invoker_contract as base

SOURCE = base.MIGRATIONS / '20261004194715_admin_evaluation_raw_warning_invoker_contract.sql'
SIGNATURE = 'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'


class RawInvokerSourceTests(unittest.TestCase):
    def test_exact_canonical_preimage_and_optional_record_extension(self):
        source = SOURCE.read_text()
        for name, definition in base.definitions()[0].items():
            body = base.tagged(definition, 'function')
            original = base.MIGRATION.read_text()
            body = base.replace_exact(body, base.tagged(original, name+'_anchor'), base.tagged(original, name+'_addition')+base.tagged(original,name+'_anchor'))
            for filename in ['20261003172126_restaurant_review_manual_invoker_contract.sql','20261003220841_admin_evaluation_page_invoker_contract.sql','20261004050600_admin_evaluation_warning_invoker_contract.sql']:
                patch=(base.MIGRATIONS/filename).read_text(); anchor=base.tagged(patch,'anchor')
                body=base.replace_exact(body,anchor,base.tagged(patch,'signature' if 'manual' in filename else 'addition')+anchor)
                if 'manual' in filename:
                    anchor=base.tagged(patch,name+'_lock');body=base.replace_exact(body,anchor,anchor.replace(base.tagged(patch,'tick'),base.tagged(patch,'manual')))
            self.assertIn(hashlib.sha256(body.encode()).hexdigest(),source)
            anchor=base.tagged(source,'anchor');addition=base.tagged(source,'addition');record=base.tagged(source,'record_addition')
            for current in [body,base.replace_exact(body,anchor,record+anchor)]:
                rewritten=base.replace_exact(current,anchor,addition+anchor)
                self.assertEqual(rewritten.replace(addition,'',1),current)
                self.assertEqual(rewritten.count(SIGNATURE),1)


@unittest.skipUnless(os.environ.get('TZUDONG_SERVICE_INVOKER_LOCAL_PG')=='1','owned PG17 fixture required')
class RawInvokerPostgresTests(unittest.TestCase):
    setUpClass=classmethod(base.PostgreSQLContract.setUpClass.__func__)
    drop_owned_bridge=classmethod(base.PostgreSQLContract.drop_owned_bridge.__func__)
    setUp=base.PostgreSQLContract.setUp
    drop_owned_database=base.PostgreSQLContract.drop_owned_database
    apply=base.PostgreSQLContract.apply
    state=base.PostgreSQLContract.state
    check=base.PostgreSQLContract.check
    install_loop=base.PostgreSQLContract.install_loop
    prepare_warning_extension=base.PostgreSQLContract.prepare_warning_extension

    def prepare_raw(self, record=False):
        self.cursor.execute(self.prepare_warning_extension().decode())
        self.cursor.execute('ALTER TABLE privacy_retention.g014_public_rpc_allowlist ADD COLUMN function_schema name, ADD COLUMN function_name name, ADD COLUMN identity_arguments text; ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;')
        self.cursor.execute('CREATE FUNCTION '+SIGNATURE+" RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS 'SELECT NULL::jsonb'; REVOKE ALL ON FUNCTION "+SIGNATURE+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+SIGNATURE+' TO service_role;')
        source=SOURCE.read_text()
        if record:
            signature='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'
            self.cursor.execute('CREATE FUNCTION '+signature+" RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS 'SELECT NULL::jsonb'; REVOKE ALL ON FUNCTION "+signature+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+signature+' TO service_role;')
            self.cursor.execute("INSERT INTO privacy_retention.g014_public_rpc_allowlist(source_signature,grantee) VALUES(%s,'service_role')",(signature,))
            for name in ['definer','catalog']:
                self.cursor.execute("SELECT pg_get_functiondef(to_regprocedure(%s))",('privacy_retention.assert_g014_'+name+'_contract()',))
                definition=self.cursor.fetchone()[0]
                self.cursor.execute(base.replace_exact(definition,base.tagged(source,'anchor'),base.tagged(source,'record_addition')+base.tagged(source,'anchor')))
        self.cursor.execute("UPDATE privacy_retention.g014_public_rpc_allowlist a SET function_schema=n.nspname,function_name=p.proname,identity_arguments=p.proargtypes::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(a.source_signature)")
        boundary=(base.MIGRATIONS/'20260713002000_g014_public_api_private_boundary.sql').read_text()
        assertion=re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_public_rpc_allowlist\(\).*?\$function\$;',boundary,re.S).group()
        self.cursor.execute(assertion+' ALTER FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() OWNER TO privacy_workflow_owner; REVOKE ALL ON FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() FROM PUBLIC,anon,authenticated,service_role;')
        return source

    def members(self):
        self.cursor.execute('SELECT to_jsonb(m) FROM pg_auth_members m ORDER BY roleid,member,grantor');return self.cursor.fetchall()

    def test_registration_success_rollback_cleanup_and_exact_record_extension(self):
        source=self.prepare_raw(record=True);before=self.state();members=self.members()
        self.cursor.execute(source.replace('COMMIT;','ROLLBACK;'))
        self.assertEqual(self.state(),before);self.assertEqual(self.members(),members)
        self.cursor.execute(source)
        self.assertEqual([dict(value,prosrc='') for _,value in self.state()],[dict(value,prosrc='') for _,value in before])
        self.assertEqual(self.members(),members)
        self.cursor.execute("SELECT to_regprocedure('pg_temp.admin_raw_warning_registration()')");self.assertIsNone(self.cursor.fetchone()[0])
        self.install_loop();self.check()
        self.cursor.execute("SELECT source_signature,identity_arguments FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=%s",(SIGNATURE,))
        self.assertEqual(self.cursor.fetchone(),(SIGNATURE,'2951 25 3802 23'))
        after=self.state()
        with self.assertRaisesRegex(self.psycopg2.Error,'G014_RAW_ALLOWLIST_DRIFT'):self.cursor.execute(source)
        self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),after)

    def test_bad_rpc_acl_rolls_back_then_clean_restart_succeeds(self):
        source=self.prepare_raw();before=self.state();members=self.members()
        self.cursor.execute('GRANT EXECUTE ON FUNCTION '+SIGNATURE+' TO authenticated')
        with self.assertRaises(self.psycopg2.Error):self.cursor.execute(source)
        self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),before);self.assertEqual(self.members(),members)
        self.cursor.execute("SELECT to_regprocedure('pg_temp.admin_raw_warning_registration()')");self.assertIsNone(self.cursor.fetchone()[0])
        self.cursor.execute('REVOKE EXECUTE ON FUNCTION '+SIGNATURE+' FROM authenticated')
        self.cursor.execute(source);self.install_loop();self.check()

    def test_unknown_assertion_body_is_not_admitted(self):
        source=self.prepare_raw()
        self.cursor.execute("SELECT pg_get_functiondef('privacy_retention.assert_g014_catalog_contract()'::regprocedure)")
        definition=self.cursor.fetchone()[0];self.cursor.execute(definition.replace('BEGIN','BEGIN\n-- unapproved drift',1))
        before=self.state()
        with self.assertRaisesRegex(self.psycopg2.Error,'G014_RAW_SOURCE_DRIFT'):self.cursor.execute(source)
        self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),before)

    def test_unexpected_rpc_overload_cannot_be_registered(self):
        source=self.prepare_raw();before=self.state()
        self.cursor.execute("CREATE FUNCTION public.admin_evaluation_raw_warning_groups(text,text) RETURNS boolean LANGUAGE sql AS 'SELECT true'")
        with self.assertRaisesRegex(self.psycopg2.Error,'unexpected overload'):self.cursor.execute(source)
        self.cursor.execute('ROLLBACK');self.assertEqual(self.state(),before)
        self.cursor.execute("SELECT to_regprocedure('pg_temp.admin_raw_warning_registration()')");self.assertIsNone(self.cursor.fetchone()[0])


if __name__=='__main__':unittest.main()
