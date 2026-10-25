"""Real PG17 commit/MVCC, actual TS publication code; synthetic Storage only.

The frozen thumbnail DDL/RPC subset is used without changing applied migrations.
This does not validate hosted catalog/G014/Storage/PostgREST or model generation.
"""
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
PG = Path('/opt/homebrew/Cellar/postgresql@17/17.11_1/bin')
BUN = Path('/Users/twoimo/.bun/bin/bun')
MIGRATION = 'backend/supabase/migrations/20260812000100_local_runtime_schema_convergence.sql'
SOURCES = [MIGRATION, 'apps/web/lib/admin/youtube-thumbnail-generator/release-registry.ts',
           'apps/web/tests-unit/fixtures/thumbnail-release-fixture.ts',
           'apps/web/tests-unit/fixtures/thumbnail-publish-pg17.ts',
           'backend/supabase/tests/test_thumbnail_publish_recovery_pg17.py']


def hashes():
    return {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in SOURCES}


class ThumbnailPublishPg17(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != 'darwin' or not all(p.is_file() for p in [PG/'postgres', PG/'initdb', PG/'psql', BUN]):
            raise unittest.SkipTest('installed pinned macOS runtimes required; no installation')
        cls.root = Path(tempfile.mkdtemp(prefix='thumbnail-publish-pg17-', dir='/private/tmp'))
        cls.data = cls.root/'data'; cls.sock = cls.root/'socket'; cls.sock.mkdir(mode=0o700)
        cls.home = cls.root/'home'; cls.home.mkdir(mode=0o700)
        cls.env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'HOME': str(cls.home), 'LANG': 'C', 'LC_ALL': 'C'}
        cls.versions = {name: subprocess.check_output([str(path), '--version'], env=cls.env, text=True).strip()
                        for name, path in [('postgres', PG/'postgres'), ('bun', BUN)]}
        if cls.versions != {'postgres': 'postgres (PostgreSQL) 17.11 (Homebrew)', 'bun': '1.4.0'}:
            raise unittest.SkipTest('pinned version mismatch')
        cls.before = hashes(); cls.observations = {}
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); cls.port = listener.getsockname()[1]
        with (cls.root/'init.log').open('w') as log:
            subprocess.run([str(PG/'initdb'), '-D', str(cls.data), '-U', 'postgres', '--no-locale', '--encoding=UTF8',
                            '--auth-local=trust', '--auth-host=trust'], env=cls.env, stdout=log, stderr=subprocess.STDOUT, check=True)
        with (cls.root/'start.log').open('w') as log:
            subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-l', str(cls.root/'postgres.log'), '-o',
                            f'-h 127.0.0.1 -p {cls.port} -k {cls.sock}', '-w', 'start'], env=cls.env, stdout=log, stderr=subprocess.STDOUT, check=True)
        cls.pid = int((cls.data/'postmaster.pid').read_text().splitlines()[0])
        cls.addClassCleanup(cls.cleanup)
        cls.q('CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
        source = (ROOT/MIGRATION).read_text()
        ddl = source[source.index('CREATE TABLE IF NOT EXISTS public.youtube_thumbnail_releases'):source.index('INSERT INTO storage.buckets')]
        cls.ddl_hash = hashlib.sha256(ddl.encode()).hexdigest()
        cls.q(ddl)
        print('THUMBNAIL_PG17_EVIDENCE='+str(cls.root), flush=True)

    @classmethod
    def q(cls, statement):
        result = subprocess.run([str(PG/'psql'), '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
                                 '-p', str(cls.port), '-U', 'postgres', '-d', 'postgres'], input=statement, env=cls.env,
                                text=True, capture_output=True, timeout=10)
        if result.returncode: raise AssertionError('FIXTURE_SQL_FAILED')
        return result.stdout.strip()

    @classmethod
    def cleanup(cls):
        pidfile = cls.data/'postmaster.pid'
        if not pidfile.exists() or int(pidfile.read_text().splitlines()[0]) != cls.pid:
            raise RuntimeError('OWNED_PG_PID_MISMATCH')
        subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'], env=cls.env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        status = subprocess.run([str(PG/'pg_ctl'), '-D', str(cls.data), 'status'], env=cls.env, capture_output=True).returncode
        with socket.socket() as check: closed = check.connect_ex(('127.0.0.1', cls.port)) != 0
        cleanup = {'ownedPid': cls.pid, 'statusExit': status, 'pidFileAbsent': not pidfile.exists(),
                   'socketAbsent': not (cls.sock/f'.s.PGSQL.{cls.port}').exists(), 'tcpClosed': closed}
        after = hashes()
        receipt = {'versions': cls.versions, 'scope': __doc__, 'sourceBefore': cls.before, 'sourceAfter': after,
                   'sourceStable': cls.before == after, 'ddlSubsetSha256': cls.ddl_hash, 'cases': cls.observations,
                   'cleanup': cleanup, 'hostedWrites': 0, 'providerCalls': 0}
        (cls.root/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
        if status != 3 or not all(cleanup[k] for k in ('pidFileAbsent', 'socketAbsent', 'tcpClosed')):
            raise RuntimeError('OWNED_PG_CLEANUP_FAILED')
        if cls.before != after: raise RuntimeError('SOURCE_CHANGED_DURING_CHECK')

    def probe(self, mode):
        self.q('TRUNCATE public.youtube_thumbnail_releases;')
        env = {**self.env, 'FIXTURE_PSQL': str(PG/'psql'), 'FIXTURE_PG_PORT': str(self.port)}
        policy = '(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))'
        script = ROOT/'apps/web/tests-unit/fixtures/thumbnail-publish-pg17.ts'
        result = subprocess.run(['/usr/bin/sandbox-exec', '-p', policy, str(BUN), '--no-env-file', 'run', str(script), mode],
                                cwd=ROOT/'apps/web', env=env, text=True, capture_output=True, timeout=20)
        (self.root/(mode+'.log')).write_text(result.stdout+'\n'+result.stderr)
        self.assertEqual(0, result.returncode, result.stderr)
        observed = json.loads(result.stdout)
        self.observations[mode] = observed
        self.assertEqual(1, observed['publishCalls']); self.assertEqual(0, observed['deleteCalls'])
        self.assertTrue(observed['imageExact']); self.assertEqual(1, observed['assets'])
        self.assertEqual(1, observed['afterCommitCount'])
        return observed

    def test_committed_rpc_ack_loss_is_reconciled_once(self):
        observed = self.probe('ack-lost')
        self.assertEqual('ready', observed['status']); self.assertIsNone(observed['code'])
        self.assertEqual(1, observed['beforeCommitCount'])

    def test_read_before_commit_is_not_a_rollback_receipt(self):
        observed = self.probe('uncommitted-read')
        self.assertIsNone(observed['status'])
        self.assertEqual('thumbnail_durable_release_publish_unconfirmed', observed['code'])
        self.assertEqual(0, observed['beforeCommitCount'])
