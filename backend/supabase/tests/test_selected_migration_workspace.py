"""Selected rollout admission and real CLI behavior on a disposable socket DB."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from urllib.parse import quote
import uuid

from backend.supabase.scripts import materialize_migration_workspace as pack

LEDGER = pack.ROOT / 'apps/web/performance/rollout-preflight/hosted-migration-ledger-20261004.json'
CLI = '/Users/twoimo/.codex/runtime-cache/tzudong-supabase-cli-2.119.0/node_modules/.bin/supabase'
PSQL = '/Users/twoimo/.codex/runtime-cache/tzudong-postgresql-17.6-icu78/installed/bin/psql'


def ledger():
    return json.loads(LEDGER.read_text())


class SelectedMigrationWorkspaceTests(unittest.TestCase):
    def rejected(self, value, code, root=pack.ROOT, forward_set=pack.FORWARD_SET):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'rejected'
            with self.assertRaisesRegex(ValueError, code):
                pack.prepare_selected(root, value, destination, forward_set)
            self.assertFalse(destination.exists())

    def test_exact_history_and_pending_with_no_guessed_aliases(self):
        value = ledger()
        self.assertEqual(len(value['migrations']), 62)
        self.assertEqual(sum(len(row['version']) == 8 for row in value['migrations']), 3)
        self.assertEqual(sum(len(row['version']) == 14 for row in value['migrations']), 59)
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'pack'
            report = pack.prepare_selected(pack.ROOT, value, destination)
            directory = destination / 'supabase/migrations'
            self.assertEqual(report['fileCount'], 75)
            self.assertEqual(report['historyMirrorCount'], 62)
            self.assertEqual([row['file'] for row in report['pending']], list(pack.FORWARD_FILES))
            self.assertEqual(report['aliases'], [])
            self.assertEqual(report['dependencyAdapters'], [])
            self.assertFalse(report['ownerRecoveryIncluded'])
            self.assertFalse(report['optionalWarningRpcIncluded'])
            self.assertEqual(len(report['verifiedReceipts']), 2)
            for row in value['migrations']:
                body = (directory / f"{row['version']}_{row['name']}.sql").read_bytes()
                self.assertEqual(body, pack._history_mirror(row))
                self.assertIn(b'MIGRATION_HISTORY_MIRROR_EXECUTION_DENIED', body)
                self.assertNotIn(b'CREATE TABLE', body)
            for name, digest in pack.FORWARD_FILES.items():
                body = (directory / name).read_bytes()
                self.assertEqual(body, (pack.ROOT / 'backend/supabase/migrations' / name).read_bytes())
                self.assertEqual(hashlib.sha256(body).hexdigest(), digest)
            for receipt in report['verifiedReceipts']:
                self.assertFalse((directory / receipt['representedOriginal']).exists())
            # Remote-only version gets a throwing mirror, never fabricated SQL.
            self.assertTrue((directory / '20260509000100_drop_server_costs.sql').exists())
            # Same legacy date does not prove equivalence to either local SQL.
            self.assertTrue((directory / '20260425_allow_ocr_logs_user_insert.sql').exists())
            self.assertFalse((directory / '20260425_create_admin_ai_settings.sql').exists())
            self.assertEqual(len(list(directory.glob('20260425_*.sql'))), 1)
            self.assertFalse((directory / report['separateOwnerRecovery']).exists())
            self.assertFalse((directory / '20261004050500_admin_evaluation_warning_groups.sql').exists())
            self.assertFalse((destination / 'supabase/roles.sql').exists())

    def test_metadata_drift_is_rejected_before_output(self):
        changes = {
            'project': lambda a: a.update(projectRef='other'),
            'name': lambda a: a['migrations'][0].update(name='different'),
            'count': lambda a: a['migrations'][0].update(statement_count=84),
            'array_hash': lambda a: a['migrations'][0].update(statements_array_sha256='0' * 64),
            'body_hash': lambda a: next(r for r in a['migrations'] if r['statement_count'] == 1).update(statements_sha256='0' * 64),
            'raw_statements': lambda a: a['migrations'][0].update(statements=['forbidden']),
            'twelve_digits': lambda a: a['migrations'][0].update(version='202512190000'),
            'padding': lambda a: a['migrations'][0].update(version='20251219000000'),
            'integer_version': lambda a: a['migrations'][0].update(version=20251219),
            'path_traversal': lambda a: a['migrations'][0].update(name='../other'),
            'missing_metadata': lambda a: a['migrations'][0].pop('statements_array_sha256'),
        }
        for name, change in changes.items():
            with self.subTest(name=name):
                value = ledger()
                change(value)
                self.rejected(value, 'migration_workspace_(ledger_invalid|base_ledger_drift)')

    def test_duplicates_and_forward_history_collisions_are_not_silently_skipped(self):
        value = ledger()
        value['migrations'].append(copy.deepcopy(value['migrations'][0]))
        value['rowCount'] += 1
        self.rejected(value, 'ledger_duplicate')
        value = ledger()
        name = next(iter(pack.FORWARD_FILES))
        value['migrations'].append({'version': name[:14], 'name': Path(name).stem[15:],
                                   'statement_count': 1, 'statements_sha256': pack.FORWARD_FILES[name],
                                   'statements_array_sha256': '0' * 64})
        value['rowCount'] += 1
        self.rejected(value, 'base_ledger_drift')
        self.rejected(ledger(), 'forward_set_denied', forward_set='all')

    def test_source_and_receipt_drift_are_rejected(self):
        for target in [next(iter(pack.FORWARD_FILES)), 'receipt', 'manifest']:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / 'source'
                directory = root / 'backend/supabase/migrations'
                directory.mkdir(parents=True)
                shutil.copytree(pack.ROOT / pack.RECEIPTS, root / pack.RECEIPTS)
                manifest = json.loads((root / pack.RECEIPTS / 'manifest.json').read_text())
                for item in manifest['receipts']:
                    source = Path(item['originalMigration'])
                    shutil.copyfile(pack.ROOT / source, root / source)
                for name in pack.FORWARD_FILES:
                    shutil.copyfile(pack.ROOT / 'backend/supabase/migrations' / name, directory / name)
                path = (root / pack.RECEIPTS / 'manifest.json' if target == 'manifest' else
                        root / manifest['receipts'][0]['archivedReceipt'] if target == 'receipt' else directory / target)
                path.write_bytes(path.read_bytes() + b'\n-- drift\n')
                self.rejected(ledger(), 'source_drift', root=root)

    def test_selected_mode_is_cli_default_and_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'pack'
            command = ['python3', str(Path(pack.__file__)), '--ledger', str(LEDGER), '--destination', str(destination)]
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout)['pendingCount'], 13)
            before = (destination / 'migration-workspace-plan.json').read_bytes()
            with self.assertRaisesRegex(ValueError, 'destination_exists'):
                pack.prepare_selected(pack.ROOT, ledger(), destination)
            self.assertEqual((destination / 'migration-workspace-plan.json').read_bytes(), before)


@unittest.skipUnless(os.environ.get('TZUDONG_MIGRATION_PACK_PG') == '1', 'owned socket fixture opt-in required')
class SelectedPackPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.socket = os.environ['TZUDONG_TEST_PG_SOCKET']
        if not Path(cls.socket).is_absolute() or not (Path(cls.socket) / '.s.PGSQL.18802').exists():
            raise ValueError('owned_pg17_socket_required')
        cls.env = {'PATH': '/opt/homebrew/opt/node@24/bin:' + os.defpath,
                   'LC_ALL': 'C', 'PGPASSFILE': '/dev/null', 'PGCONNECT_TIMEOUT': '5'}
        cls.db = 'migration_pack_' + uuid.uuid4().hex
        cls.base = [PSQL, '-X', '-v', 'ON_ERROR_STOP=1', '-h', cls.socket, '-p', '18802', '-U', 'postgres', '-At']
        if cls.sql('SHOW server_version;', database='postgres').stdout.strip() != '17.6':
            raise ValueError('pinned_postgres_required')
        cls.sql('CREATE DATABASE ' + cls.db + " TEMPLATE template0 ENCODING 'UTF8';", database='postgres')
        cls.addClassCleanup(cls.cleanup)
        cls.sql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);')
        # Synthetic statements only; real hosted statement bodies are never read.
        values = ','.join("('%s','%s',ARRAY['local fixture'])" % (row['version'], row['name']) for row in ledger()['migrations'])
        cls.sql('INSERT INTO supabase_migrations.schema_migrations VALUES ' + values + ';')
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.destination = Path(cls.temp.name) / 'pack'
        pack.prepare_selected(pack.ROOT, ledger(), cls.destination)
        version = subprocess.run([CLI, '--version'], env=cls.env, capture_output=True, text=True, check=True, timeout=20)
        if version.stdout.strip() != '2.119.0':
            raise ValueError('pinned_supabase_cli_required')

    @classmethod
    def cleanup(cls):
        cls.sql('DROP DATABASE ' + cls.db + ' WITH (FORCE);', database='postgres')

    @classmethod
    def sql(cls, query, database=None, check=True):
        result = subprocess.run(cls.base + ['-d', database or cls.db], input=query, env=cls.env,
                                capture_output=True, text=True, timeout=30)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    @classmethod
    def rows(cls):
        result = cls.sql("SELECT coalesce(json_agg(r ORDER BY version),'[]'::json) FROM (SELECT version,name,cardinality(statements) AS statement_count,CASE WHEN cardinality(statements)=1 THEN encode(sha256(convert_to(statements[1],'UTF8')),'hex') END AS statements_sha256,encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex') AS statements_array_sha256 FROM supabase_migrations.schema_migrations) r;")
        return json.loads(result.stdout)

    @classmethod
    def cli_push(cls, *flags):
        # CLI URI validation requires a hostname; pgx's host parameter selects
        # the owned Unix socket. No hosted hostname/password/profile is used.
        uri = f'postgresql://postgres@localhost/{cls.db}?host={quote(cls.socket, safe="")}&port=18802&sslmode=disable'
        return subprocess.run([CLI, 'db', 'push', '--db-url', uri, '--workdir', str(cls.destination),
                               '--skip-vault', '--yes', *flags], env=cls.env, capture_output=True, text=True, timeout=45)

    def test_cli_lists_only_thirteen_pending_and_never_changes_history(self):
        before = self.rows()
        for flags in [('--dry-run',), ('--dry-run', '--include-all')]:
            with self.subTest(flags=flags):
                result = self.cli_push(*flags)
                output = result.stdout + result.stderr
                self.assertEqual(result.returncode, 0, output)
                files = re.findall(r'\b\d{8,14}_[a-z0-9_]+\.sql\b', output)
                self.assertEqual(files, list(pack.FORWARD_FILES), output)
                self.assertEqual(self.rows(), before)
        self.assertEqual(self.sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").stdout.strip(), '0')

    def test_missing_history_causes_actual_cli_execution_to_fail_without_rewriting_it(self):
        row = ledger()['migrations'][0]
        self.sql("DELETE FROM supabase_migrations.schema_migrations WHERE version='%s';" % row['version'])
        try:
            before = self.rows()
            result = self.cli_push('--include-all')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('MIGRATION_HISTORY_MIRROR_EXECUTION_DENIED', result.stdout + result.stderr)
            self.assertEqual(self.rows(), before)
        finally:
            self.sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('%s','%s',ARRAY['local fixture']);" % (row['version'], row['name']))

    def test_preflight_checks_full_statement_arrays_and_remains_read_only(self):
        versions = [row['version'] for row in self.rows()[:2]]
        self.sql("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['first','second'] WHERE version='%s';" % versions[0])
        self.sql("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY[]::text[] WHERE version='%s';" % versions[1])
        expected = self.rows()
        try:
            self.assertEqual(expected[0]['statement_count'], 2)
            self.assertIsNone(expected[0]['statements_sha256'])
            self.assertEqual(expected[1]['statement_count'], 0)
            self.sql(pack._base_ledger_check_sql(expected).decode())
            self.assertEqual(self.rows(), expected)
            # Single-statement SHA is null both before/after. Only the array
            # digest catches this change with unchanged version/name/count.
            self.sql("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['first','changed'] WHERE version='%s';" % versions[0])
            before = self.rows()
            result = self.sql(pack._base_ledger_check_sql(expected).decode(), check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('MIGRATION_WORKSPACE_BASE_LEDGER_DRIFT', result.stderr)
            self.assertEqual(self.rows(), before)
        finally:
            for version in versions:
                self.sql("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['local fixture'] WHERE version='%s';" % version)


if __name__ == '__main__':
    unittest.main()
