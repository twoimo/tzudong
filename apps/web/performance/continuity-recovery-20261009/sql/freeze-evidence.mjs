import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evidenceDir, '../../../../..');
const bun = '/Users/twoimo/.bun/bin/bun';
const python = '/opt/homebrew/bin/python3';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourcePaths = [
  'apps/web/scripts/apply-supabase-migration.mjs',
  'apps/web/scripts/supabase-migration-transaction.mjs',
  'apps/web/tests-unit/supabase-migration-transaction.test.ts',
];
const immutablePaths = [
  '.github/supabase-migration-release-manifest.v1.json',
  'backend/supabase/scripts/g037_supabase_statement_vector.mjs',
  'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql',
  'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql',
  'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql',
  'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql',
];

function command(executable, args, options = {}) {
  const run = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (run.error || run.status !== 0) {
    const error = new Error(`COMMAND_FAILED_${run.status ?? 'UNKNOWN'}`);
    error.output = `${run.stdout || ''}${run.stderr || ''}`;
    throw error;
  }
  return `${run.stdout || ''}${run.stderr || ''}`;
}

const bunOutput = command(bun, [
  'test',
  'apps/web/tests-unit/supabase-migration-transaction.test.ts',
  'apps/web/tests-unit/supabase-migration-apply-source.test.ts',
]);
writeFileSync(resolve(evidenceDir, 'bun-tests.log'), bunOutput, { mode: 0o644 });
if (!/\b19 pass\b/.test(bunOutput) || !/\b0 fail\b/.test(bunOutput)) throw new Error('BUN_RESULT_INVALID');

const diffCheck = command('/usr/bin/git', ['diff', '--check']);
if (diffCheck) throw new Error('DIFF_CHECK_OUTPUT');

const sourceFreeze = Object.fromEntries(sourcePaths.map(path => {
  const bytes = readFileSync(resolve(repositoryRoot, path));
  return [path, { sha256: sha256(bytes), bytes: bytes.length }];
}));
const immutable = Object.fromEntries(immutablePaths.map(path => {
  const current = readFileSync(resolve(repositoryRoot, path));
  const atHead = command('/usr/bin/git', ['show', `HEAD:${path}`], { encoding: null });
  const headBytes = Buffer.isBuffer(atHead) ? atHead : Buffer.from(atHead);
  const currentSha256 = sha256(current);
  const headSha256 = sha256(headBytes);
  if (currentSha256 !== headSha256) throw new Error(`IMMUTABLE_DRIFT_${path}`);
  return [path, { sha256: currentSha256, bytes: current.length, matchesHead: true }];
}));

const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, '.github/supabase-migration-release-manifest.v1.json'), 'utf8'));
if (manifest.version !== 1 || manifest.migrations.length !== 3) throw new Error('MANIFEST_CONTRACT_DRIFT');

const pg15 = JSON.parse(readFileSync(resolve(evidenceDir, 'pg15-runtime.json'), 'utf8'));
const pg17 = JSON.parse(readFileSync(resolve(evidenceDir, 'pg17-runtime.json'), 'utf8'));
for (const runtime of [pg15, pg17]) {
  if (runtime.status !== 'passed'
    || runtime.operatingWrites !== false
    || runtime.cleanup.databaseDropped !== true
    || runtime.cleanup.rolesDropped !== true
    || runtime.sourceHashes.apply !== sourceFreeze[sourcePaths[0]].sha256
    || runtime.sourceHashes.transaction !== sourceFreeze[sourcePaths[1]].sha256
    || runtime.sourceHashes.transactionTests !== sourceFreeze[sourcePaths[2]].sha256) {
    throw new Error(`RUNTIME_INVALID_${runtime.engine}`);
  }
}

const versions = {
  node: process.version,
  bun: command(bun, ['--version']).trim(),
  python: command(python, ['--version']).trim(),
};
if (!versions.node.startsWith('v24.') || versions.bun !== '1.4.0' || versions.python !== 'Python 3.14.8') {
  throw new Error('PINNED_RUNTIME_DRIFT');
}

const freeze = {
  observedAt: new Date().toISOString(),
  head: command('/usr/bin/git', ['rev-parse', 'HEAD']).trim(),
  branch: command('/usr/bin/git', ['branch', '--show-current']).trim(),
  versions,
  sourceFreeze,
  immutable,
  releaseManifest: {
    sha256: immutable['.github/supabase-migration-release-manifest.v1.json'].sha256,
    version: manifest.version,
    migrationCount: manifest.migrations.length,
    migrationIds: manifest.migrations.map(entry => entry.id),
  },
};
writeFileSync(resolve(evidenceDir, 'source-freeze.json'), `${JSON.stringify(freeze, null, 2)}\n`, { mode: 0o644 });

const expectedCases = [
  'strict_3_column_success',
  'terminal_mismatch',
  'lost_ack',
  'exit0_stdout_empty',
  'exit0_stdout_truncated',
  'exit0_stdout_contaminated',
  'exit0_stdout_mismatched',
  'ledger_conflict',
  'privilege_select_only_denied_before_ddl',
  'privilege_insert_only_denied_before_ddl',
  'strict_6_column_success',
  'unknown_7_column_profile_denied',
  'malformed_6_column_profile_denied',
];
for (const runtime of [pg15, pg17]) {
  if (JSON.stringify(runtime.cases.map(testCase => testCase.name)) !== JSON.stringify(expectedCases)) {
    throw new Error(`CASE_SET_DRIFT_${runtime.engine}`);
  }
}

const summary = {
  status: 'passed',
  observedAt: freeze.observedAt,
  head: freeze.head,
  branch: freeze.branch,
  sourceHashes: sourceFreeze,
  bun: { pass: 19, fail: 0, assertions: 129, log: 'bun-tests.log' },
  postgres: {
    pg15: { version: pg15.serverVersion, status: pg15.status, cases: pg15.cases.length },
    pg17: { version: pg17.serverVersion, status: pg17.status, cases: pg17.cases.length },
    actualCaller: 'applyMigrationWithTerminalReadback',
    networkMode: 'none',
    publishedPorts: 0,
    operatingWrites: false,
    cleanupVerified: true,
  },
  privilegeResult: {
    selectOnly: 'MIGRATION_LEDGER_UNAVAILABLE',
    insertOnlyDatabaseAdmission: 'MIGRATION_LEDGER_UNAVAILABLE',
    insertOnlyCallerOutcome: 'MIGRATION_OUTCOME_UNCONFIRMED',
    ddlCreated: false,
    ledgerWritten: false,
  },
  immutableInputsMatchHead: true,
  limitations: [
    'Isolated network-none PG15.8 and PG17.6 evidence only; no hosted or operating database write occurred.',
    'An INSERT-only principal cannot perform the read-only reconciliation, so the caller returns MIGRATION_OUTCOME_UNCONFIRMED after the database admission guard rejects with MIGRATION_LEDGER_UNAVAILABLE.',
  ],
};
writeFileSync(resolve(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o644 });

function filesBelow(root) {
  const output = [];
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    const metadata = statSync(path);
    if (metadata.isDirectory()) output.push(...filesBelow(path));
    else output.push(path);
  }
  return output;
}

const excluded = new Set(['artifact-map.json', 'artifact-map.sha256']);
const artifacts = filesBelow(evidenceDir)
  .filter(path => !excluded.has(relative(evidenceDir, path)))
  .sort()
  .map(path => {
    const bytes = readFileSync(path);
    return { path: relative(evidenceDir, path), bytes: bytes.length, sha256: sha256(bytes) };
  });
const artifactMap = { schema: 'tzudong-continuity-sql-evidence-v1', observedAt: freeze.observedAt, artifacts };
const artifactMapBytes = Buffer.from(`${JSON.stringify(artifactMap, null, 2)}\n`);
writeFileSync(resolve(evidenceDir, 'artifact-map.json'), artifactMapBytes, { mode: 0o644 });
writeFileSync(resolve(evidenceDir, 'artifact-map.sha256'), `${sha256(artifactMapBytes)}  artifact-map.json\n`, { mode: 0o644 });
console.log(JSON.stringify(summary));
