#!/usr/bin/env node
/** Bounded local caller for the two reviewed storyboard production migrations. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readOriginalStatementVector, selectDirectDatabaseTransport, validateReleaseMigrationManifest,
  runPsql, applyMigrationWithTerminalReadback,
} from './apply-supabase-migration.mjs';
import {
  migrationEnvelope, reconciliationSql, reconciliationOutcome,
} from './supabase-migration-transaction.mjs';
import { assertSuccessorDatabaseTarget } from './admin-record-sql-successor.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const MANIFEST_PATH = '.github/storyboard-migration-release-manifest.v1.json';
export const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
export const TLS_ROOT_PATH = 'backend/supabase/certificates/prod-ca-2021.crt';
export const TLS_ROOT_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const allowed = Object.freeze({
  storyboard_gemini_execution_v1: Object.freeze({ path: 'backend/supabase/migrations/20261013093518_storyboard_gemini_execution_v1.sql', sha256: '84d351dead86ef90040b6949fe4a6dc93eb91a783c1b7a78531c7f564ea4ff4e' }),
  storyboard_openai_execution: Object.freeze({ path: 'backend/supabase/migrations/20261113090000_storyboard_openai_execution.sql', sha256: 'e2cf79eb435de2b760a3cc218371dafbe64a3344e41bdb9034437e2d2ae6f4a3' }),
});
const TABLE_LOCKS = "SET LOCAL lock_timeout='2s';\nLOCK TABLE public.admin_storyboard_production_projects, public.admin_storyboard_production_jobs IN SHARE ROW EXCLUSIVE MODE;\n";
const safeRoot = root => {
  const canonical = realpathSync(root);
  if (canonical !== resolve(root)) fail('STORYBOARD_PATH_INVALID');
  return canonical;
};
function readRegular(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.split(/[\\/]/).includes('..')) fail('STORYBOARD_PATH_INVALID');
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) fail('STORYBOARD_PATH_INVALID');
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(target) !== target) fail('STORYBOARD_PATH_INVALID');
    return readFileSync(target);
  } catch (error) { if (error?.code === 'STORYBOARD_PATH_INVALID') throw error; fail('STORYBOARD_FILE_UNAVAILABLE'); }
}
export function loadStoryboardMigration(id, {
  environment = process.env, repositoryRoot = REPOSITORY_ROOT,
  readBytesImpl = readRegular, readVectorImpl = readOriginalStatementVector,
} = {}) {
  const root = safeRoot(repositoryRoot);
  const expectedDigest = environment.STORYBOARD_RELEASE_MANIFEST_SHA256;
  if (!/^[a-f0-9]{64}$/.test(expectedDigest || '')) fail('STORYBOARD_MANIFEST_DIGEST_INVALID');
  let manifestBytes;
  try { manifestBytes = readBytesImpl(root, MANIFEST_PATH); }
  catch (error) { if (error?.code?.startsWith('STORYBOARD_')) throw error; fail('STORYBOARD_MANIFEST_UNAVAILABLE'); }
  if (sha(manifestBytes) !== expectedDigest) fail('STORYBOARD_MANIFEST_DIGEST_MISMATCH');
  let document;
  try { document = JSON.parse(manifestBytes.toString('utf8')); }
  catch { fail('STORYBOARD_MANIFEST_INVALID'); }
  let migrations;
  try { migrations = validateReleaseMigrationManifest(document); }
  catch { fail('STORYBOARD_MANIFEST_INVALID'); }
  if (migrations.length !== 2 || Object.keys(allowed).some(key => !migrations.some(item => item.id === key))) fail('STORYBOARD_MANIFEST_INVALID');
  for (const item of migrations) {
    const pin = allowed[item.id];
    if (!pin || item.path !== pin.path || item.sha256 !== pin.sha256) fail('STORYBOARD_MANIFEST_INVALID');
  }
  if (!Object.hasOwn(allowed, id)) fail('STORYBOARD_MIGRATION_ID_INVALID');
  const migration = migrations.find(item => item.id === id);
  const source = readBytesImpl(root, migration.path);
  if (sha(source) !== allowed[id].sha256 || sha(source) !== migration.sha256) fail('STORYBOARD_SOURCE_HASH_INVALID');
  const vector = readVectorImpl(migration, source);
  const plan = migrationEnvelope(source, migration, vector);
  return { manifestSha256: expectedDigest, migration, source, plan };
}

export function assertStoryboardDatabaseTarget(databaseUrl) {
  try {
    assertSuccessorDatabaseTarget(databaseUrl, { projectRef: PROJECT_REF, databaseName: 'postgres' });
    const target = new URL(databaseUrl);
    if (target.hostname !== 'aws-1-ap-southeast-1.pooler.supabase.com' || target.port !== '5432'
      || decodeURIComponent(target.username) !== `postgres.${PROJECT_REF}` || target.pathname !== '/postgres'
      || [...target.searchParams.keys()].some(key => key !== 'sslmode')
      || (target.searchParams.has('sslmode') && target.searchParams.get('sslmode') !== 'verify-full')) fail('STORYBOARD_DATABASE_TARGET_INVALID');
  } catch { fail('STORYBOARD_DATABASE_TARGET_INVALID'); }
}
export function createStoryboardPsqlRunner(databaseUrl, {
  environment = process.env, spawnImpl = spawnSync, readBytesImpl = readRegular, repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  assertStoryboardDatabaseTarget(databaseUrl);
  const root = safeRoot(repositoryRoot);
  const ca = readBytesImpl(root, TLS_ROOT_PATH);
  if (sha(ca) !== TLS_ROOT_SHA256) fail('STORYBOARD_TLS_ROOT_INVALID');
  return (_url, sql, transaction = false) => runPsql(databaseUrl, sql, transaction, {
    environment, psql: 'psql', spawnImpl: (command, args, options) => spawnImpl(command, args, {
      ...options, timeout: 120_000, killSignal: 'SIGKILL',
      env: { ...options.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: resolve(root, TLS_ROOT_PATH) },
    }),
  });
}
function parseOutput(output) {
  const rows = output.split(/\r?\n/).filter(line => line.trim());
  try { const value = JSON.parse(rows.at(-1)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { fail('STORYBOARD_READBACK_INVALID'); }
}
export function runStoryboardSuccessor({ migrationId, mode, environment = process.env }, {
  loadImpl = loadStoryboardMigration, transportImpl, runPsqlImpl,
  readVectorImpl = readOriginalStatementVector,
} = {}) {
  if (!['dry-run', 'verify-terminal-state', 'apply'].includes(mode)) fail('STORYBOARD_MODE_INVALID');
  const record = loadImpl(migrationId, { environment, readVectorImpl });
  const result = { migration_id: migrationId, manifest_sha256: record.manifestSha256, migration_sha256: record.migration.sha256, mode, applied: false };
  if (mode === 'dry-run') return result;
  const { databaseUrl } = (transportImpl ?? selectDirectDatabaseTransport)(environment);
  assertStoryboardDatabaseTarget(databaseUrl);
  const run = runPsqlImpl ?? createStoryboardPsqlRunner(databaseUrl, { environment });
  if (mode === 'verify-terminal-state') {
    const reconcile = reconciliationSql(record.plan, record.migration);
    const value = parseOutput(run(databaseUrl, reconcile, false));
    const disposition = reconciliationOutcome(value, record.migration);
    if (disposition !== 'committed') fail(disposition === 'not_applied' ? 'STORYBOARD_NOT_APPLIED' : 'STORYBOARD_RECONCILIATION_UNCONFIRMED');
    result.terminal_readback = record.migration.terminalReadback.expected;
    return result;
  }
  const lockedRunner = (url, sql, transaction) => run(url, sql.includes('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE') ? TABLE_LOCKS + sql : sql, transaction);
  result.terminal_readback = applyMigrationWithTerminalReadback(databaseUrl, record.migration, record.source.toString('utf8'), { runPsqlImpl: lockedRunner, readVectorImpl });
  result.applied = true;
  return result;
}

export function parseStoryboardArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--migration-id' || arg === '--mode') {
      const key = arg === '--migration-id' ? 'migrationId' : 'mode';
      if (values[key] || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('STORYBOARD_ARGUMENT_INVALID');
      values[key] = argv[++i];
    } else fail('STORYBOARD_ARGUMENT_INVALID');
  }
  if (!values.migrationId || !values.mode) fail('STORYBOARD_ARGUMENT_INVALID');
  return values;
}

export function main(argv = process.argv.slice(2), dependencies) {
  const result = runStoryboardSuccessor({ ...parseStoryboardArgs(argv) }, dependencies);
  console.log(JSON.stringify(result));
  return result;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (error) {
    const code = typeof error?.code === 'string' && /^STORYBOARD_[A-Z0-9_]+$/.test(error.code) ? error.code : 'STORYBOARD_OPERATION_FAILED';
    process.stderr.write(`[storyboard-production-successor] ${code}\n`);
    process.exitCode = 1;
  }
}
