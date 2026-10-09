"""Archive custody, fresh-chain boundaries, and private PG15 read-only execution."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

from backend.supabase.scripts import operational_sql_receipts as archive
from backend.supabase.scripts import local_replay_contract as replay
from backend.supabase.tests.test_local_migration_contract import local_migrate

ROOT = archive.ROOT


class SourceContract(unittest.TestCase):
    def test_exact_source_identity_and_actual_78_ledger_receipts_are_bound(self):
        manifest = archive.verify_archive()
        self.assertEqual(2, len(manifest['receipts']))
        self.assertEqual(78, manifest['readback']['ledgerCount'])
        for row in manifest['receipts']:
            data = archive.source_bytes(Path(row['archivePath']).name)
            self.assertEqual(Path(row['originalPath']).name, Path(row['archivePath']).name)
            self.assertEqual(row['version']+'_'+row['name']+'.sql', Path(row['archivePath']).name)
            self.assertEqual(row['sourceSha256'], hashlib.sha256(data).hexdigest())
            self.assertNotEqual(row['sourceSha256'], row['actualStatementSha256'])
            proof = replay.plan(row['archivePath'])
            self.assertNotEqual('applied', proof['disposition'])
            self.assertIn(b'READ ONLY;', replay.generate_verification_sql(row['archivePath']))

    def test_automatic_fresh_chain_excludes_archived_operations_but_preserves_predecessors(self):
        paths = {path.relative_to(ROOT).as_posix() for path in local_migrate.migration_files()}
        for row in archive.verify_archive()['receipts']:
            self.assertNotIn(row['originalPath'], paths)
            self.assertNotIn(row['archivePath'], paths)
            self.assertNotIn(row['originalPath'], replay.supported_sources())
            self.assertIn(row['archivePath'], replay.supported_sources())
        self.assertIn('backend/supabase/migrations/20260906064252_g014_pg17_workflow_owner_contract.sql', paths)
        self.assertIn('backend/supabase/migrations/20260801000300_g016_onboarding_allowlist_freshness.sql', paths)
        generator = (ROOT/'backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh').read_text()
        fresh, archived = generator.split('# Archived operations are NOT effective migrations.', 1)
        for row in archive.verify_archive()['receipts']:
            self.assertNotIn(Path(row['archivePath']).name+')', fresh)
            self.assertIn(row['archivePath'], archived)
        self.assertIn('contract.validate_proof', archived)
        self.assertNotIn('<"$migration"', archived.split('[[ "$g026_phase_b_applied"', 1)[0])

    def fixture(self, destination):
        manifest = archive.verify_archive()
        paths = [archive.ARCHIVE/'manifest.json', Path(manifest['readback']['path'])]
        paths += [Path(row['archivePath']) for row in manifest['receipts']]
        for relative in paths:
            target = destination/relative; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT/relative).read_bytes())
        return paths

    def test_source_manifest_and_historical_readback_drift_all_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); paths = self.fixture(root)
            archive.verify_archive(root=root)
            for relative in paths:
                with self.subTest(path=relative):
                    path = root/relative; data = path.read_bytes(); path.write_bytes(data+b'\n')
                    with self.assertRaisesRegex(ValueError, 'source_drift'): archive.verify_archive(root=root)
                    path.write_bytes(data)
            row = archive.verify_archive(root=root)['receipts'][0]
            original = root/row['originalPath']; original.parent.mkdir(parents=True)
            original.write_bytes(b'-- even a no-op alias is forbidden\n')
            with self.assertRaisesRegex(ValueError, 'in_fresh_chain'): archive.verify_archive(root=root)
            original.unlink()
            original.symlink_to(root/row['archivePath'])
            with self.assertRaisesRegex(ValueError, 'in_fresh_chain'): archive.verify_archive(root=root)

    def test_symlink_custody_and_unknown_source_are_denied(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.fixture(root)
            row = archive.verify_archive(root=root)['receipts'][0]
            path = root/row['archivePath']; path.unlink(); path.symlink_to(ROOT/row['archivePath'])
            with self.assertRaisesRegex(ValueError, 'custody'): archive.verify_archive(root=root)
        with self.assertRaisesRegex(ValueError, 'unknown'): archive.source_bytes('unregistered.sql')


@unittest.skipUnless(os.environ.get('TZUDONG_OPERATIONAL_ARCHIVE_PG15') == '1', 'private native PG15 opt-in required')
class NativePG15Replay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bin = Path('/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-15.8/installed/bin')
        cls.tmp = tempfile.TemporaryDirectory(prefix='op15-', dir='/tmp')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.root = Path(cls.tmp.name); cls.socket = cls.root/'socket'; cls.socket.mkdir()
        cls.cluster = cls.root/'cluster'
        cls.env = {'PATH':os.defpath, 'LC_ALL':'C', 'PGPASSFILE':'/dev/null'}
        cls.command([str(cls.bin/'initdb'), '-D', str(cls.cluster), '-U', 'supabase_admin', '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions'])
        cls.command([str(cls.bin/'pg_ctl'), '-D', str(cls.cluster), '-l', str(cls.root/'postgres.log'), '-o', f"-c listen_addresses='' -c unix_socket_directories='{cls.socket}' -p 18807", '-w', 'start'])
        cls.addClassCleanup(cls.command, [str(cls.bin/'pg_ctl'), '-D', str(cls.cluster), '-m', 'immediate', '-w', 'stop'])
        old = (ROOT/'backend/supabase/migrations/20260804000500_g041_auth_workflow_bridge.sql').read_text()
        owner = re.search(r'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract\(\).*?\$function\$;', old, re.S).group()
        original = (ROOT/'backend/supabase/migrations/20260801000200_g016_onboarding_confirmation_freshness.sql').read_text()
        nonce = re.search(r'CREATE FUNCTION public.confirm_privacy_onboarding\(.*?\$function\$;', original, re.S).group()
        cls.query('''CREATE ROLE postgres LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE ROLE privacy_workflow_owner NOLOGIN NOINHERIT; CREATE ROLE privacy_auth_bridge NOLOGIN INHERIT;
GRANT privacy_workflow_owner TO privacy_auth_bridge;
CREATE SCHEMA privacy_retention AUTHORIZATION privacy_workflow_owner;
'''+owner+nonce+'''
ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract() FROM PUBLIC;
ALTER FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text) TO service_role;
CREATE TABLE privacy_retention.g014_public_rpc_allowlist(function_schema name,function_name name,identity_arguments text,grantee name,source_signature text);
ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;
INSERT INTO privacy_retention.g014_public_rpc_allowlist VALUES ('public','confirm_privacy_onboarding','2950 25 2950 25 2950 25','service_role','public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)');
GRANT USAGE ON SCHEMA privacy_retention TO postgres;
GRANT SELECT ON privacy_retention.g014_public_rpc_allowlist TO postgres;
''')

    @classmethod
    def command(cls, argv, text=None, check=True):
        result = subprocess.run(argv, input=text, text=True, capture_output=True, timeout=30, env=cls.env)
        if check and result.returncode: raise AssertionError(result.stderr)
        return result

    @classmethod
    def query(cls, sql, role='supabase_admin', check=True):
        return cls.command([str(cls.bin/'psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', str(cls.socket), '-p', '18807', '-U', role, '-d', 'postgres'], text=sql, check=check)

    def state(self):
        return self.query("""SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),
 'members',(SELECT jsonb_agg(to_jsonb(r) ORDER BY roleid,member,grantor) FROM pg_auth_members r),
 'schemas',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_namespace r),
 'relations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_class r),
 'functions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_proc r),
 'types',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_type r),
 'allowlist',(SELECT jsonb_agg(to_jsonb(r) ORDER BY source_signature) FROM privacy_retention.g014_public_rpc_allowlist r));""").stdout

    def test_both_registered_verifiers_leave_pg15_schema_types_and_data_unchanged(self):
        fixture = self
        class Executor:
            def capture(self, sql, *, role='supabase_admin'):
                return fixture.query(sql.decode(), role=role).stdout.encode()
            def run(self, sql): raise AssertionError('No ledger or schema mutation is permitted')
        before = self.state()
        for row in archive.verify_archive()['receipts']:
            proof = local_migrate.verify_replay(Executor(), row['archivePath'])
            self.assertTrue(proof['receipt']['read_only'])
            self.assertFalse(proof['receipt']['hosted_ledger_admission_verified'])
            self.assertNotEqual('applied', proof['disposition'])
            self.assertEqual(before, self.state())
        self.assertEqual('t', self.query("SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL").stdout.strip())

    def test_original_hosted_sql_cannot_execute_on_pg15_or_change_state(self):
        before = self.state()
        for row in archive.verify_archive()['receipts']:
            result = self.query(archive.source_bytes(Path(row['archivePath']).name).decode(), role='postgres', check=False)
            self.assertNotEqual(0, result.returncode)
            # PG15 rejects PG17's membership syntax while compiling the DO
            # block, before its version predicate can execute.
            self.assertIn('syntax error', result.stderr)
            self.assertEqual(before, self.state())
