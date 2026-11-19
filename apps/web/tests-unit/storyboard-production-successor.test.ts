import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  REPOSITORY_ROOT, MANIFEST_PATH, PROJECT_REF, TLS_ROOT_PATH, TLS_ROOT_SHA256,
  loadStoryboardMigration, assertStoryboardDatabaseTarget, createStoryboardPsqlRunner,
  runStoryboardSuccessor,
} from '../scripts/storyboard-production-successor.mjs';
import { statementSpans } from '../scripts/supabase-migration-transaction.mjs';
import { selectDirectDatabaseTransport } from '../scripts/apply-supabase-migration.mjs';

const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const goodUrl = `postgres://postgres.${PROJECT_REF}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const digest = 'a'.repeat(64);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'storyboard-caller-'));
  mkdirSync(join(root, '.github'), { recursive: true });
  const source = readFileSync(resolve(REPOSITORY_ROOT, 'backend/supabase/migrations/20261013093518_storyboard_gemini_execution_v1.sql'));
  const pin = { id: 'storyboard_gemini_execution_v1', path: 'backend/supabase/migrations/20261013093518_storyboard_gemini_execution_v1.sql', sha256: hash(source) };
  mkdirSync(join(root, 'backend/supabase/migrations'), { recursive: true });
  writeFileSync(join(root, pin.path), source);
  const query = 'SELECT 1 AS ok';
  const entry = { ...pin, expectedPriorState: { query, expected: { ok: 1 } }, terminalReadback: { query, expected: { ok: 2 } } };
  const manifest = Buffer.from(JSON.stringify({ version: 1, migrations: [entry, {
    id: 'storyboard_openai_execution', path: 'backend/supabase/migrations/20261113090000_storyboard_openai_execution.sql',
    sha256: 'e2cf79eb435de2b760a3cc218371dafbe64a3344e41bdb9034437e2d2ae6f4a3',
    expectedPriorState: entry.expectedPriorState, terminalReadback: entry.terminalReadback,
  }] }, null, 2) + '\n');
  writeFileSync(join(root, MANIFEST_PATH), manifest);
  return { root, source, manifest, entry, env: { STORYBOARD_RELEASE_MANIFEST_SHA256: hash(manifest) }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const vector = (_migration: any, source: Buffer) => statementSpans(source.toString('utf8')).map(s => s.token);

describe('bounded storyboard production successor', () => {
  it('validates pinned ID, manifest, path and source; dry-run is local only', () => {
    const f = fixture();
    try {
      const record = loadStoryboardMigration('storyboard_gemini_execution_v1', { repositoryRoot: f.root, environment: f.env, readVectorImpl: vector });
      assert.equal(record.migration.id, f.entry.id);
      const result = runStoryboardSuccessor({ migrationId: f.entry.id, mode: 'dry-run', environment: f.env }, {
        loadImpl: (id: string, opts: any) => loadStoryboardMigration(id, { ...opts, repositoryRoot: f.root, readVectorImpl: vector }),
      });
      assert.equal(result.applied, false);
      assert.throws(() => loadStoryboardMigration('other', { repositoryRoot: f.root, environment: f.env, readVectorImpl: vector }), /STORYBOARD_MIGRATION_ID_INVALID/);
      assert.throws(() => loadStoryboardMigration(f.entry.id, { repositoryRoot: f.root, environment: { ...f.env, STORYBOARD_RELEASE_MANIFEST_SHA256: digest }, readVectorImpl: vector }), /STORYBOARD_MANIFEST_DIGEST_MISMATCH/);
      const broken = JSON.parse(f.manifest.toString()); broken.migrations[0].sha256 = 'b'.repeat(64);
      writeFileSync(join(f.root, MANIFEST_PATH), JSON.stringify(broken, null, 2) + '\n');
      assert.throws(() => loadStoryboardMigration(f.entry.id, { repositoryRoot: f.root, environment: { STORYBOARD_RELEASE_MANIFEST_SHA256: hash(readFileSync(join(f.root, MANIFEST_PATH))) }, readVectorImpl: vector }), /STORYBOARD_MANIFEST_INVALID/);
      const originalManifest = f.manifest;
      writeFileSync(join(f.root, MANIFEST_PATH), originalManifest);
      writeFileSync(join(f.root, f.entry.path), Buffer.from('changed source'));
      assert.throws(() => loadStoryboardMigration(f.entry.id, { repositoryRoot: f.root, environment: f.env, readVectorImpl: vector }), /STORYBOARD_SOURCE_HASH_INVALID/);
    } finally { f.cleanup(); }
  });
  it('rejects symlink source and unsupported target/SSL variants', () => {
    const f = fixture();
    try {
      const file = join(f.root, f.entry.path); const copy = file + '.copy';
      writeFileSync(copy, f.source); rmSync(file); symlinkSync(copy, file);
      assert.throws(() => loadStoryboardMigration(f.entry.id, { repositoryRoot: f.root, environment: f.env, readVectorImpl: vector }), /STORYBOARD_PATH_INVALID/);
    } finally { f.cleanup(); }
    assertStoryboardDatabaseTarget(goodUrl);
    assert.throws(() => selectDirectDatabaseTransport({ SUPABASE_DB_URL: goodUrl, SUPABASE_ACCESS_TOKEN: 'hidden' }), /MIGRATION_TRANSPORT_CREDENTIAL_OVERLAP/);
    for (const url of [goodUrl.replace('aws-1-ap-southeast-1', 'aws-2-ap-southeast-1'), goodUrl.replace(':5432/', ':6543/'), goodUrl.replace(`postgres.${PROJECT_REF}`, 'postgres'), goodUrl + '?sslmode=require']) {
      assert.throws(() => assertStoryboardDatabaseTarget(url), /STORYBOARD_DATABASE_TARGET_INVALID/);
    }
  });
  it('pins verify-full TLS after libpq environment cleanup and enforces timeout', () => {
    let observed: any;
    const runner = createStoryboardPsqlRunner(goodUrl, { environment: { SUPABASE_DB_URL: goodUrl, PGSSLMODE: 'disable' }, spawnImpl: (_cmd: string, _args: any, options: any) => { observed = options; return { status: 0, stdout: '{}\n', stderr: '' }; } });
    runner(goodUrl, 'SELECT 1', false);
    assert.equal(observed.env.PGSSLMODE, 'verify-full');
    assert.equal(observed.env.PGSSLROOTCERT, resolve(REPOSITORY_ROOT, TLS_ROOT_PATH));
    assert.equal(observed.timeout, 120_000);
    assert.equal(hash(readFileSync(observed.env.PGSSLROOTCERT)), TLS_ROOT_SHA256);
  });
  it('reconciles read-only without locks and locks both storyboard tables before apply transaction', () => {
    const f = fixture();
    try {
      const record = loadStoryboardMigration(f.entry.id, { repositoryRoot: f.root, environment: f.env, readVectorImpl: vector });
      const migration = record.migration;
      let seen = '';
      const reconcileFake = (_url: string, sql: string, txn: boolean) => { seen = sql; assert.equal(txn, false); return JSON.stringify({ ledger_exists: true, ledger_equal: true, prior: null, terminal: { ok: 2 } }); };
      runStoryboardSuccessor({ migrationId: migration.id, mode: 'verify-terminal-state', environment: f.env }, { loadImpl: () => record, transportImpl: () => ({ databaseUrl: goodUrl }), runPsqlImpl: reconcileFake });
      assert.match(seen, /SET TRANSACTION READ ONLY/);
      assert.doesNotMatch(seen, /LOCK TABLE/);
      let applySql = '';
      const applyFake = (_url: string, sql: string, _txn: boolean) => { applySql = sql; return JSON.stringify({ ok: 2 }); };
      runStoryboardSuccessor({ migrationId: migration.id, mode: 'apply', environment: f.env }, { loadImpl: () => record, transportImpl: () => ({ databaseUrl: goodUrl }), runPsqlImpl: (url: string, sql: string, txn: boolean) => { applySql = sql; assert.equal(txn, true); return applyFake(url, sql, txn); }, readVectorImpl: vector });
      assert.match(applySql, /SET LOCAL lock_timeout='2s';\s+LOCK TABLE public\.admin_storyboard_production_projects, public\.admin_storyboard_production_jobs IN SHARE ROW EXCLUSIVE MODE;/);
    } finally { f.cleanup(); }
  });
});
