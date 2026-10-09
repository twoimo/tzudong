import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(verifierPath), '../../../../../..');
const anchoredHead = '71da8656c45981e927821e935a09e00820e0bbd8';
const sourcePaths = [
  'apps/web/scripts/apply-supabase-migration.mjs',
  'apps/web/scripts/supabase-migration-transaction.mjs',
  'apps/web/tests-unit/supabase-migration-apply-source.test.ts',
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

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function executable(override, candidates) {
  const requested = typeof override === 'string' && override.trim() ? [override.trim()] : [];
  for (const candidate of [...requested, ...candidates]) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error(`COMMAND_UNAVAILABLE_${candidates[0].toUpperCase()}`);
}

function command(executablePath, args, options = {}) {
  const run = spawnSync(executablePath, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (run.error || run.status !== 0) throw new Error('COMMAND_FAILED');
  if (options.encoding === null) return run.stdout;
  return `${run.stdout || ''}${run.stderr || ''}`;
}

const bun = executable(process.env.TZUDONG_BUN_EXECUTABLE, ['bun']);
const python = executable(process.env.TZUDONG_PYTHON_EXECUTABLE, ['python3', 'python']);
const git = executable(process.env.TZUDONG_GIT_EXECUTABLE, ['git']);
const versions = {
  node: process.version,
  bun: command(bun, ['--version']).trim(),
  python: command(python, ['--version']).trim(),
};
if (!versions.node.startsWith('v24.') || versions.bun !== '1.4.0' || versions.python !== 'Python 3.14.8') {
  throw new Error('PINNED_RUNTIME_DRIFT');
}

const testOutput = command(bun, [
  'test',
  'apps/web/tests-unit/supabase-migration-transaction.test.ts',
  'apps/web/tests-unit/supabase-migration-apply-source.test.ts',
]);
if (!/\b25 pass\b/.test(testOutput) || !/\b0 fail\b/.test(testOutput) || !/\b169 expect\(\) calls\b/.test(testOutput)) {
  throw new Error('BUN_RESULT_INVALID');
}
if (command(git, ['diff', '--check', '--', ...sourcePaths])) throw new Error('DIFF_CHECK_OUTPUT');

const sourceHashes = Object.fromEntries(sourcePaths.map(path => {
  const bytes = readFileSync(resolve(repositoryRoot, path));
  return [path, { bytes: bytes.length, sha256: sha256(bytes) }];
}));
const immutable = Object.fromEntries(immutablePaths.map(path => {
  const bytes = readFileSync(resolve(repositoryRoot, path));
  const atAnchor = command(git, ['show', `${anchoredHead}:${path}`], { encoding: null });
  const anchorBytes = Buffer.isBuffer(atAnchor) ? atAnchor : Buffer.from(atAnchor);
  if (!bytes.equals(anchorBytes)) throw new Error(`IMMUTABLE_DRIFT_${path}`);
  return [path, { bytes: bytes.length, sha256: sha256(bytes), matchesAnchoredHead: true }];
}));
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, '.github/supabase-migration-release-manifest.v1.json'), 'utf8'));
if (manifest.version !== 1 || manifest.migrations.length !== 3) throw new Error('MANIFEST_CONTRACT_DRIFT');

const result = {
  status: 'passed',
  anchoredHead,
  currentHead: command(git, ['rev-parse', 'HEAD']).trim(),
  versions,
  tests: { pass: 25, fail: 0, assertions: 169 },
  sourceHashes,
  immutable,
  manifest: {
    version: manifest.version,
    migrationCount: manifest.migrations.length,
    migrationIds: manifest.migrations.map(entry => entry.id),
  },
  verifier: { bytes: readFileSync(verifierPath).length, sha256: sha256(readFileSync(verifierPath)) },
  limitations: [
    'This portable verifier proves current source, unit behavior, pinned tools, and anchored immutable inputs only.',
    'Historical PG15/PG17 runtime JSON is not promoted to the changed source hashes.',
    'The separate isolated PG17 receipt covers state-specific readback and reconciliation behavior.',
  ],
  operatingDatabaseWrites: false,
};
console.log(JSON.stringify(result));
