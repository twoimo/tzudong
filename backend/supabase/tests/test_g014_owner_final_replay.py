"""Hash/admission tests and isolated PG15 execution; never hosted evidence."""
import hashlib
import json
import os
from pathlib import Path
import unittest

from backend.supabase.scripts import local_replay_contract as contract
from backend.supabase.scripts import verify_g014_owner_final_replay as replay
from backend.supabase.tests import test_g014_pg17_owner_contract as legacy_fixture

ROOT = Path(__file__).resolve().parents[3]
SOURCE_PATH = 'backend/supabase/applied-receipts/owner-recovery-20261004/20261004115554_g014_pg17_owner_final_verifier.sql'
SOURCE = ROOT / SOURCE_PATH
PREDECESSOR = legacy_fixture.MIGRATION


class SourceContract(unittest.TestCase):
    def test_source_and_dependency_admission_and_explicit_nonexecution(self):
        sql = replay.verification_sql(SOURCE.read_bytes(), PREDECESSOR.read_bytes())
        self.assertEqual(sql, contract.generate_verification_sql(SOURCE_PATH))
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), replay.SOURCE_SHA256)
        for statement in (b'GRANT ', b'REVOKE ', b'CREATE ', b'ALTER ', b'INSERT ', b'UPDATE ', b'DELETE '):
            self.assertNotIn(statement, sql)
        self.assertIn(b'READ ONLY;', sql)
        self.assertIn(b"server_version_num')::integer/10000<>15", sql)
        self.assertNotIn(b'supabase_migrations', sql)
        self.assertFalse(replay.RECEIPT['hosted_final_verifier_executed'])
        self.assertFalse(replay.RECEIPT['hosted_ledger_admission_verified'])
        for source, predecessor, code in (
            (SOURCE.read_bytes() + b'\n', PREDECESSOR.read_bytes(), 'source_drift'),
            (SOURCE.read_bytes(), PREDECESSOR.read_bytes() + b'\n', 'predecessor_drift'),
        ):
            with self.assertRaisesRegex(ValueError, code):
                replay.verification_sql(source, predecessor)

    def test_g014_dispatch_and_ci_register_explicit_adapter(self):
        generator = (ROOT / 'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        branch = generator.split(SOURCE.name + ')', 1)[1].split(';;', 1)[0]
        self.assertIn('contract.generate_verification_sql', branch)
        self.assertIn('contract.assemble_proof', branch)
        self.assertIn('contract.validate_proof', branch)
        self.assertNotIn('<"$migration"', branch)
        for workflow in ['g014-catalog-contract-baseline.yml', 'security-audit.yml']:
            text = (ROOT / '.github/workflows' / workflow).read_text()
            self.assertIn('backend/supabase/scripts/verify_g014_owner_final_replay.py', text)
            self.assertIn('backend.supabase.tests.test_g014_owner_final_replay', text)


@unittest.skipUnless(os.environ.get('TZUDONG_ADMIN_IDS_LOCAL_PG') == '1', 'private PG15 opt-in required')
class PrivatePG15Replay(unittest.TestCase):
    setUpClass = classmethod(legacy_fixture.LegacyReplay.setUpClass.__func__)

    def sql(self):
        return contract.generate_verification_sql(SOURCE_PATH).decode()

    def state(self):
        result = self.fixture.query("""SELECT jsonb_build_object(
          'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
          'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),
          'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p),
          'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n));""")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_replay_proves_pg15_legacy_preservation_without_hosted_ledger(self):
        from backend.supabase.tests.test_local_migration_contract import local_migrate
        before = self.state()
        fixture = self.fixture
        class Executor:
            def capture(self, sql, *, role='supabase_admin'):
                result = fixture.query(sql.decode(), role=role)
                if result.returncode:
                    raise AssertionError(result.stderr)
                return result.stdout.encode()
            def run(self, sql):
                raise AssertionError('read-only diagnosis must never write')
        proof = local_migrate.verify_replay(Executor(), SOURCE_PATH)
        self.assertEqual(proof['receipt'], replay.RECEIPT)
        self.assertEqual(before, self.state())
        self.assertEqual(proof['disposition'], 'legacy-contract-preserved')
        denied = self.fixture.query(self.sql(), role='supabase_admin')
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('g014_owner_replay_executor_denied', denied.stderr)
        self.assertEqual(before, self.state())

    def test_body_acl_membership_and_role_drift_are_rejected_unchanged(self):
        body = self.sql().split('READ ONLY;', 1)[1].rsplit('COMMIT;', 1)[0]
        before = self.state()
        for mutation, code in (
            ('GRANT privacy_workflow_owner TO anon;', 'membership_denied'),
            ('GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() TO anon;', 'function_denied'),
            ('ALTER ROLE privacy_auth_bridge NOINHERIT;', 'membership_denied'),
            ("CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NULL; END $$;", 'function_denied'),
        ):
            with self.subTest(code=code):
                result = self.fixture.query('BEGIN; ' + mutation + ' SET SESSION AUTHORIZATION postgres; ' + body + ' ROLLBACK;')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(code, result.stderr)
                self.assertEqual(before, self.state())


if __name__ == '__main__':
    unittest.main()
