#!/usr/bin/env node
/** Apply one reviewed Supabase SQL migration through direct Postgres. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const RELEASE_MIGRATION_MANIFEST_RELATIVE_PATH = '.github/supabase-migration-release-manifest.v1.json';
export const RELEASE_MIGRATION_MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  RELEASE_MIGRATION_MANIFEST_RELATIVE_PATH,
);
const MIGRATION_ID_PATTERN = /^[a-z0-9_]{1,80}$/;
const MIGRATION_PATH_PATTERN = /^backend\/supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MANAGEMENT_CREDENTIAL_KEYS = Object.freeze([
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]);

const operationError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};
const PROVIDER_RECEIPT_KEYS = Object.freeze([
  'version',
  'provider',
  'migration_id',
  'migration_sha256',
  'manifest_sha256',
  'receipt_id',
]);
const PROVIDER_RECEIPT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,256}$/;

function validateProviderReceipt(receiptText, migration, manifestSha256, expectedReceiptSha256) {
  if (typeof receiptText !== 'string' || !receiptText.trim()) {
    throw operationError('PROVIDER_RECEIPT_REQUIRED');
  }
  if (!SHA256_PATTERN.test(expectedReceiptSha256 || '')) {
    throw operationError('PROVIDER_RECEIPT_DIGEST_INVALID');
  }

  let receipt;
  try {
    receipt = JSON.parse(receiptText);
  } catch {
    throw operationError('PROVIDER_RECEIPT_INVALID');
  }
  assertExactKeys(receipt, PROVIDER_RECEIPT_KEYS);
  if (receipt.version !== 1
    || receipt.provider !== 'supabase'
    || receipt.migration_id !== migration.id
    || receipt.migration_sha256 !== migration.sha256
    || receipt.manifest_sha256 !== manifestSha256
    || !PROVIDER_RECEIPT_ID_PATTERN.test(receipt.receipt_id)) {
    throw operationError('PROVIDER_RECEIPT_INVALID');
  }
  const canonicalReceipt = `${JSON.stringify(receipt)}\n`;
  if (createHash('sha256').update(canonicalReceipt).digest('hex') !== expectedReceiptSha256) {
    throw operationError('PROVIDER_RECEIPT_DIGEST_MISMATCH');
  }
  return receipt;
}



function assertExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
}

function validateExpectedReadbackContract(contract) {
  assertExactKeys(contract, ['query', 'expected']);
  if (typeof contract.query !== 'string' || !contract.query.trim()) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
  if (!contract.expected
    || typeof contract.expected !== 'object'
    || Array.isArray(contract.expected)
    || Object.keys(contract.expected).length === 0) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
}

export function validateReleaseMigrationManifest(manifestDocument) {
  assertExactKeys(manifestDocument, ['version', 'migrations']);
  if (manifestDocument.version !== 1
    || !Array.isArray(manifestDocument.migrations)
    || manifestDocument.migrations.length === 0) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }

  const ids = new Set();
  const paths = new Set();
  const hashes = new Set();
  for (const migration of manifestDocument.migrations) {
    assertExactKeys(migration, ['id', 'path', 'sha256', 'expectedPriorState', 'terminalReadback']);
    validateExpectedReadbackContract(migration.expectedPriorState);
    validateExpectedReadbackContract(migration.terminalReadback);
    if (!MIGRATION_ID_PATTERN.test(migration.id)
      || !MIGRATION_PATH_PATTERN.test(migration.path)
      || !SHA256_PATTERN.test(migration.sha256)) {
      throw operationError('MIGRATION_MANIFEST_INVALID');
    }
    if (ids.has(migration.id) || paths.has(migration.path) || hashes.has(migration.sha256)) {
      throw operationError('MIGRATION_MANIFEST_DUPLICATE');
    }
    ids.add(migration.id);
    paths.add(migration.path);
    hashes.add(migration.sha256);
  }

  return manifestDocument.migrations;
}

function assertCanonicalManifestJson(bytes, manifestDocument) {
  if (bytes.toString('utf8') !== `${JSON.stringify(manifestDocument, null, 2)}\n`) {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
}

export async function loadReleaseMigrationManifest(
  {
    expectedManifestSha256 = process.env.RELEASE_MIGRATION_MANIFEST_SHA256,
    repositoryRoot = REPOSITORY_ROOT,
    manifestPath = RELEASE_MIGRATION_MANIFEST_PATH,
    readFileImpl = readFile,
    lstatImpl = lstat,
    realpathImpl = realpath,
  } = {},
) {
  if (!SHA256_PATTERN.test(expectedManifestSha256 || '')) {
    throw operationError('MIGRATION_MANIFEST_DIGEST_INVALID');
  }

  let canonicalRepositoryRoot;
  let canonicalManifestPath;
  try {
    canonicalRepositoryRoot = await realpathImpl(repositoryRoot);
    const expectedManifestPath = resolve(
      canonicalRepositoryRoot,
      RELEASE_MIGRATION_MANIFEST_RELATIVE_PATH,
    );
    if (resolve(manifestPath) !== expectedManifestPath
      || !isWithinRepository(canonicalRepositoryRoot, expectedManifestPath)) {
      throw operationError('MIGRATION_MANIFEST_INVALID');
    }
    const manifestMetadata = await lstatImpl(expectedManifestPath);
    if (manifestMetadata.isSymbolicLink()
      || await realpathImpl(expectedManifestPath) !== expectedManifestPath) {
      throw operationError('MIGRATION_MANIFEST_SYMBOLIC');
    }
    canonicalManifestPath = expectedManifestPath;
  } catch (error) {
    if (error?.code?.startsWith('MIGRATION_')) throw error;
    throw operationError('MIGRATION_MANIFEST_READ_FAILED');
  }

  let bytes;
  try {
    bytes = await readFileImpl(canonicalManifestPath);
  } catch {
    throw operationError('MIGRATION_MANIFEST_READ_FAILED');
  }

  const actualManifestSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualManifestSha256 !== expectedManifestSha256) {
    throw operationError('MIGRATION_MANIFEST_DIGEST_MISMATCH');
  }

  let manifestDocument;
  try {
    manifestDocument = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw operationError('MIGRATION_MANIFEST_INVALID');
  }
  assertCanonicalManifestJson(bytes, manifestDocument);
  return {
    migrations: validateReleaseMigrationManifest(manifestDocument),
    sha256: actualManifestSha256,
  };
}

export function resolveReviewedMigration(migrationId, manifest) {
  if (!MIGRATION_ID_PATTERN.test(migrationId)) {
    throw operationError('MIGRATION_ID_INVALID');
  }
  const migration = manifest.find((entry) => entry.id === migrationId);
  if (!migration) {
    throw operationError('MIGRATION_ID_NOT_ALLOWLISTED');
  }
  return migration;
}

function parseArgs(argv) {
  const args = {
    migrationId: '',
    dryRun: false,
    verifyTerminalState: false,
    providerReceipt: '',
    json: false,
  };
  const seen = new Set();
  const readValue = (option, index) => {
    if (seen.has(option)) throw operationError('MIGRATION_ARGUMENT_DUPLICATE');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw operationError('MIGRATION_ARGUMENT_INVALID');
    seen.add(option);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--migration-id') {
      args.migrationId = readValue(arg, index);
      index += 1;
    } else if (arg === '--dry-run') {
      if (seen.has(arg)) throw operationError('MIGRATION_ARGUMENT_DUPLICATE');
      seen.add(arg);
      args.dryRun = true;
    } else if (arg === '--verify-terminal-state') {
      if (seen.has(arg)) throw operationError('MIGRATION_ARGUMENT_DUPLICATE');
      seen.add(arg);
      args.verifyTerminalState = true;
    } else if (arg === '--provider-receipt') {
      args.providerReceipt = readValue(arg, index);
      index += 1;
    } else if (arg === '--json') {
      if (seen.has(arg)) throw operationError('MIGRATION_ARGUMENT_DUPLICATE');
      seen.add(arg);
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/apply-supabase-migration.mjs --migration-id ID [--dry-run | --verify-terminal-state --provider-receipt RECEIPT] [--json]');
      process.exit(0);
    } else {
      throw operationError('MIGRATION_ARGUMENT_INVALID');
    }
  }
  if (!args.migrationId) throw operationError('MIGRATION_ID_REQUIRED');
  if (args.dryRun && args.verifyTerminalState) {
    throw operationError('MIGRATION_ARGUMENT_INVALID');
  }
  return args;
}

function isWithinRepository(repositoryRoot, targetPath) {
  const pathRelativeToRoot = relative(repositoryRoot, targetPath);
  return pathRelativeToRoot !== ''
    && !pathRelativeToRoot.startsWith(`..${sep}`)
    && pathRelativeToRoot !== '..'
    && !pathRelativeToRoot.includes(`${sep}..${sep}`);
}

export async function loadReviewedMigration(
  migrationId,
  {
    expectedManifestSha256 = process.env.RELEASE_MIGRATION_MANIFEST_SHA256,
    repositoryRoot = REPOSITORY_ROOT,
    manifestPath = RELEASE_MIGRATION_MANIFEST_PATH,
    readFileImpl = readFile,
    lstatImpl = lstat,
    realpathImpl = realpath,
  } = {},
) {
  const manifest = await loadReleaseMigrationManifest({
    expectedManifestSha256,
    repositoryRoot,
    manifestPath,
    readFileImpl,
    lstatImpl,
    realpathImpl,
  });
  const migration = resolveReviewedMigration(migrationId, manifest.migrations);
  let canonicalRepositoryRoot;
  let migrationFile;
  try {
    canonicalRepositoryRoot = await realpathImpl(repositoryRoot);
    migrationFile = resolve(canonicalRepositoryRoot, migration.path);
    if (!isWithinRepository(canonicalRepositoryRoot, migrationFile)) {
      throw operationError('MIGRATION_MANIFEST_INVALID');
    }
    const fileMetadata = await lstatImpl(migrationFile);
    if (fileMetadata.isSymbolicLink()) {
      throw operationError('MIGRATION_FILE_SYMBOLIC');
    }
    if (await realpathImpl(migrationFile) !== migrationFile) {
      throw operationError('MIGRATION_FILE_SYMBOLIC');
    }
  } catch (error) {
    if (error?.code?.startsWith('MIGRATION_')) throw error;
    throw operationError('MIGRATION_FILE_READ_FAILED');
  }

  let bytes;
  try {
    bytes = await readFileImpl(migrationFile);
  } catch {
    throw operationError('MIGRATION_FILE_READ_FAILED');
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== migration.sha256) {
    throw operationError('MIGRATION_FILE_DIGEST_MISMATCH');
  }
  return {
    manifestSha256: manifest.sha256,
    migration,
    query: bytes.toString('utf8'),
  };
}

function normalizedEnvironmentValue(environment, key) {
  const value = environment[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function selectDirectDatabaseTransport(environment = process.env) {
  if (MANAGEMENT_CREDENTIAL_KEYS.some((key) => normalizedEnvironmentValue(environment, key))) {
    throw operationError('MIGRATION_TRANSPORT_CREDENTIAL_OVERLAP');
  }
  const databaseUrl = normalizedEnvironmentValue(environment, 'SUPABASE_DB_URL');
  if (!databaseUrl) {
    throw operationError('MIGRATION_CREDENTIALS_MISSING');
  }
  return { databaseUrl };
}

function runPsql(databaseUrl, query, singleTransaction) {
  const args = [
    '--set=ON_ERROR_STOP=1',
    '--quiet',
    '--tuples-only',
    '--no-align',
  ];
  if (singleTransaction) args.splice(1, 0, '--single-transaction');
  args.push(databaseUrl);
  const result = spawnSync('psql', args, {
    encoding: 'utf8',
    input: `\\set VERBOSITY verbose\n${query}`,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw operationError('MIGRATION_PSQL_EXECUTION_FAILED');
  }
  if (result.status !== 0) {
    const stderr = result.stderr || '';
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/m.exec(stderr)?.[1];
    const undefinedFunction = sqlstate === '42883'
      ? /function ([a-z_][a-z0-9_.]*\([a-z0-9_., ]*\)) does not exist/i.exec(stderr)?.[1]
      : null;
    const undefinedOperator = sqlstate === '42883'
      ? /operator does not exist:\s*([a-z0-9_[\]. =<>!+-]+)/i.exec(stderr)?.[1]
      : null;
    const classifier = (undefinedFunction ?? undefinedOperator)
      ?.slice(0, 96)
      .replace(/[^a-z0-9_]+/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();
    throw operationError(
      sqlstate
        ? `MIGRATION_PSQL_FAILED_${sqlstate}${classifier ? `_${classifier}` : ''}`
        : 'MIGRATION_PSQL_FAILED',
    );
  }
  return result.stdout || '';
}

function parseReadback(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim());
  try {
    const readback = JSON.parse(lines.at(-1) || '');
    if (!readback || typeof readback !== 'object' || Array.isArray(readback)) {
      throw new Error('readback must be an object');
    }
    return readback;
  } catch {
    throw operationError('MIGRATION_READBACK_INVALID');
  }
}

export function assertExactReadback(readback, expected, code) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
    }
    return value;
  };
  if (JSON.stringify(normalize(readback)) !== JSON.stringify(normalize(expected))) {
    throw operationError(code);
  }
  return readback;
}

export function assertExpectedPriorState(priorState, terminalReadback, migration) {
  try {
    return assertExactReadback(
      priorState,
      migration.expectedPriorState.expected,
      'MIGRATION_PRIOR_STATE_MISMATCH',
    );
  } catch (error) {
    if (error?.code !== 'MIGRATION_PRIOR_STATE_MISMATCH') throw error;
    try {
      assertExactReadback(
        terminalReadback,
        migration.terminalReadback.expected,
        'MIGRATION_TERMINAL_STATE_MISMATCH',
      );
    } catch {
      throw error;
    }
    throw operationError('MIGRATION_ALREADY_APPLIED');
  }
}

function applyMigrationWithTerminalReadback(databaseUrl, migration, query) {
  const output = runPsql(
    databaseUrl,
    `${query.trim()}\n\n${migration.terminalReadback.query.trim()}\n`,
    true,
  );
  const readback = parseReadback(output);
  return assertExactReadback(
    readback,
    migration.terminalReadback.expected,
    'MIGRATION_TERMINAL_READBACK_FAILED',
  );
}

const PROVIDER_OWNED_MIGRATION_IDS = new Set([
  'g016_privacy_audit_owner_policy',
  'g016_onboarding_confirmation_freshness',
]);

export async function main(
  argv = process.argv.slice(2),
  { environment = process.env } = {},
) {
  const args = parseArgs(argv);
  const { manifestSha256, migration, query } = await loadReviewedMigration(args.migrationId, {
    expectedManifestSha256: normalizedEnvironmentValue(
      environment,
      'RELEASE_MIGRATION_MANIFEST_SHA256',
    ),
  });
  const result = {
    manifest_sha256: manifestSha256,
    migration_id: migration.id,
    migration_file: migration.path,
    sha256: migration.sha256,
    apply_method: 'direct_postgres',
    dry_run: args.dryRun,
    verify_terminal_state: args.verifyTerminalState,
    migration_applied: false,
    provider_receipt_id: null,
    terminal_readback: null,
  };
  if (
    !args.dryRun
    && !args.verifyTerminalState
    && PROVIDER_OWNED_MIGRATION_IDS.has(migration.id)
  ) {
    throw operationError('PROVIDER_OWNED_MIGRATION_APPLY_FORBIDDEN');
  }
  if (args.verifyTerminalState && PROVIDER_OWNED_MIGRATION_IDS.has(migration.id)) {
    const receipt = validateProviderReceipt(
      args.providerReceipt,
      migration,
      manifestSha256,
      normalizedEnvironmentValue(environment, 'PROVIDER_MIGRATION_RECEIPT_SHA256'),
    );
    result.provider_receipt_id = receipt.receipt_id;
  }

  if (!args.dryRun) {
    const { databaseUrl } = selectDirectDatabaseTransport(environment);
    const terminalReadback = parseReadback(
      runPsql(databaseUrl, migration.terminalReadback.query, false),
    );
    if (args.verifyTerminalState) {
      result.terminal_readback = assertExactReadback(
        terminalReadback,
        migration.terminalReadback.expected,
        'MIGRATION_TERMINAL_READBACK_FAILED',
      );
    } else {
      const priorState = parseReadback(
        runPsql(databaseUrl, migration.expectedPriorState.query, false),
      );
      assertExpectedPriorState(priorState, terminalReadback, migration);
      result.terminal_readback = applyMigrationWithTerminalReadback(databaseUrl, migration, query);
      result.migration_applied = true;
    }
  }

  if (args.json) {
    console.log(redactCliText(JSON.stringify(result, null, 2)));
  } else {
    const operation = args.dryRun
      ? 'dry-run checked'
      : args.verifyTerminalState
        ? 'terminal state verified'
        : 'applied';
    console.log(`Supabase migration ${operation}: ${redactCliText(migration.id, 128)}`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logCliError(error, (line) => process.stderr.write(`[apply-supabase-migration] ${line}`));
    process.exitCode = 1;
  });
}
