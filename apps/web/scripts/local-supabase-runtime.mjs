import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = realpathSync(path.resolve(moduleDirectory, '..', '..', '..'));
const MAX_ENV_BYTES = 64 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024 * 1024;
const EXPECTED_SERVICES = [
  'analytics',
  'auth',
  'db',
  'functions',
  'imgproxy',
  'kong',
  'mail',
  'meta',
  'realtime',
  'rest',
  'storage',
  'studio',
  'supavisor',
  'vector',
];
const SERVICES_WITHOUT_DOCKER_HEALTHCHECK = new Set(['functions', 'rest']);
const REQUIRED_ENV_KEYS = [
  'PROJECT_NAME',
  'LOCAL_STATE_ROOT',
  'LOCAL_INPUT_ROOT',
  'POSTGRES_PASSWORD',
  'POSTGRES_HOST_PORT',
  'POOLER_TENANT_ID',
  'KONG_HTTP_PORT',
  'SITE_URL',
  'ADDITIONAL_REDIRECT_URLS',
  'API_EXTERNAL_URL',
  'SUPABASE_PUBLIC_URL',
  'SUPABASE_DB_URL',
  'ANON_KEY',
  'SERVICE_ROLE_KEY',
  'STORAGE_SERVICE_KEY',
  'NIGHTLY_ADMIN_EMAIL',
  'NIGHTLY_ADMIN_PASSWORD',
  'LOCAL_STACK_GENERATOR_VERSION',
];
function fail(code) {
  throw new Error(`[local-supabase] ${code}`);
}

function mergeLocalEnvironment(target, filePath, { required = false } = {}) {
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile()
      || metadata.size > MAX_ENV_BYTES
      || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())
      || (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
    ) {
      fail('local_env_shape');
    }
    const parsed = parseDotenv(readFileSync(descriptor));
    for (const [key, value] of Object.entries(parsed)) {
      if (target[key] === undefined) target[key] = value;
    }
  } catch (error) {
    if (
      !required
      && error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) return;
    if (error instanceof Error && error.message.startsWith('[local-supabase]')) throw error;
    fail('local_env_read');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function loadLocalWebInputEnvironment({
  repositoryRoot = defaultRepositoryRoot,
  inherited = process.env,
  operatorEnvFile,
} = {}) {
  const root = realpathSync(repositoryRoot);
  const environment = { ...inherited };
  if (operatorEnvFile !== undefined) {
    if (
      typeof operatorEnvFile !== 'string'
      || !path.isAbsolute(operatorEnvFile)
      || operatorEnvFile.length > 4096
      || /[\0\r\n]/.test(operatorEnvFile)
    ) {
      fail('operator_env_path');
    }
    mergeLocalEnvironment(environment, operatorEnvFile, { required: true });
  }
  // Shell values win, then the explicit operator file, app-local file, and
  // repository-local file. Every source still passes through the DB scrub.
  // The result is only an input to buildLocalWebEnvironment's database scrub.
  mergeLocalEnvironment(environment, path.join(root, 'apps', 'web', '.env.local'));
  mergeLocalEnvironment(environment, path.join(root, '.env.local'));
  return environment;
}

function isHostedDatabaseEnvironmentKey(key) {
  const normalized = key.toUpperCase();
  return normalized === 'SERVICE_ROLE_KEY'
    || normalized === 'STORAGE_SERVICE_KEY'
    || normalized.includes('SUPABASE')
    || /^PG[A-Z0-9_]*$/.test(normalized)
    || normalized === 'POSTGRES'
    || normalized.startsWith('POSTGRES_')
    || normalized === 'DATABASE_URL'
    || normalized.startsWith('DATABASE_URL_')
    || normalized.endsWith('_DATABASE_URL')
    || normalized === 'DIRECT_URL'
    || normalized.startsWith('DIRECT_URL_')
    || normalized.endsWith('_DIRECT_URL');
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function canonicalGithubRepository(value) {
  if (typeof value !== 'string') return undefined;
  const parts = value.trim().split('/');
  if (
    parts.length !== 2
    || !GITHUB_OWNER_PATTERN.test(parts[0])
    || !GITHUB_REPOSITORY_NAME_PATTERN.test(parts[1])
  ) {
    return undefined;
  }
  return `${parts[0]}/${parts[1]}`;
}

function resolveLocalGithubRepository(environment) {
  return canonicalGithubRepository(environment.INSIGHT_GITHUB_REPOSITORY)
    ?? canonicalGithubRepository(environment.GITHUB_REPOSITORY)
    ?? canonicalGithubRepository(`${environment.GITHUB_OWNER ?? ''}/${environment.GITHUB_REPO ?? ''}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function projectName(repositoryRoot) {
  return `tzudong-local-${sha256(repositoryRoot).slice(0, 12)}`;
}

function readOwnerOnlyFile(filePath, label, maxBytes = MAX_ENV_BYTES) {
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) {
      fail(`${label}_shape`);
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
      fail(`${label}_owner`);
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600) {
      fail(`${label}_mode`);
    }
    return readFileSync(descriptor);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[local-supabase]')) throw error;
    fail(`${label}_read`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseGeneratedEnvironment(raw) {
  const values = {};
  let source;
  try {
    source = raw.toString('utf8');
  } catch {
    fail('env_encoding');
  }
  for (const line of source.split('\n')) {
    if (!line) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      separator < 1
      || !/^[A-Z][A-Z0-9_]*$/.test(key)
      || Object.hasOwn(values, key)
      || /[\0\r\n]/.test(value)
    ) {
      fail('env_shape');
    }
    values[key] = value;
  }
  if (REQUIRED_ENV_KEYS.some((key) => !Object.hasOwn(values, key))) fail('env_missing_key');
  return values;
}

function assertLoopbackOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label}_url`);
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || (value !== parsed.origin && value !== `${parsed.origin}/`)
  ) {
    fail(`${label}_url`);
  }
  return parsed.origin;
}

function safeProcessEnvironment() {
  const selected = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']) {
    if (process.env[key]) selected[key] = process.env[key];
  }
  selected.PATH ??= '/usr/bin:/bin';
  selected.HOME ??= process.cwd();
  return selected;
}

function runJson(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env ?? safeProcessEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? MAX_RECEIPT_BYTES,
  });
  if (result.error || result.signal || result.status !== 0) fail(options.code ?? 'command_failed');
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(options.code ?? 'command_output');
  }
}

export function loadLocalSupabaseEnvironment({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const root = realpathSync(repositoryRoot);
  const project = projectName(root);
  const stateRoot = path.join(
    root,
    'backend',
    'supabase',
    'volumes',
    '.local-stack',
    project,
  );
  const envFile = path.join(stateRoot, 'stack.env');
  const provenanceFile = path.join(stateRoot, 'stack.env.provenance.json');
  const raw = readOwnerOnlyFile(envFile, 'env');
  const values = parseGeneratedEnvironment(raw);
  const provenanceRaw = readOwnerOnlyFile(provenanceFile, 'provenance');
  let provenance;
  try {
    provenance = JSON.parse(provenanceRaw.toString('utf8'));
  } catch {
    fail('provenance_shape');
  }
  if (
    provenance?.schema !== 'local-stack-env-provenance-v1'
    || provenance.project_name !== project
    || provenance.generator_version !== 'local-stack-v1'
    || provenance.env_file !== 'stack.env'
    || provenance.env_file_mode !== '0600'
    || provenance.secret_values_included !== false
    || provenance.env_file_sha256 !== sha256(raw)
    || !Array.isArray(provenance.keys)
    || provenance.keys.slice().sort().join('\0') !== Object.keys(values).sort().join('\0')
  ) {
    fail('provenance_mismatch');
  }
  if (
    values.PROJECT_NAME !== project
    || realpathSync(values.LOCAL_STATE_ROOT) !== realpathSync(stateRoot)
    || realpathSync(values.LOCAL_INPUT_ROOT) !== realpathSync(path.join(stateRoot, 'inputs'))
    || values.LOCAL_STACK_GENERATOR_VERSION !== 'local-stack-v1'
    || values.NIGHTLY_ADMIN_EMAIL !== 'nightly-ci@local.invalid'
    || values.NIGHTLY_ADMIN_PASSWORD.length < 16
  ) {
    fail('env_provenance');
  }
  const supabaseOrigin = assertLoopbackOrigin(values.API_EXTERNAL_URL, 'api');
  if (
    assertLoopbackOrigin(values.SUPABASE_PUBLIC_URL, 'public') !== supabaseOrigin
    || Number(new URL(supabaseOrigin).port) !== Number(values.KONG_HTTP_PORT)
  ) {
    fail('url_binding');
  }
  let database;
  try {
    database = new URL(values.SUPABASE_DB_URL);
  } catch {
    fail('database_url');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || database.username !== 'postgres'
    || !database.password
    || Number(database.port) !== Number(values.POSTGRES_HOST_PORT)
    || database.pathname !== '/postgres'
  ) {
    fail('database_url');
  }
  return {
    repositoryRoot: root,
    projectName: project,
    stateRoot,
    envFile,
    provenanceFile,
    provenanceSha256: sha256(provenanceRaw),
    values,
    supabaseOrigin,
  };
}

function readCurrentMigrationLedger(local, databaseContainer) {
  const manifest = runJson(
    'python3',
    [
      path.join(local.repositoryRoot, 'backend', 'supabase', 'scripts', 'local-migrate.py'),
      'manifest',
    ],
    { cwd: local.repositoryRoot, code: 'migration_manifest', timeout: 120_000 },
  );
  const query = [
    "SELECT COALESCE(json_agg(json_build_object('path', migration_id, 'ordinal', ordinal, 'sha256', source_sha256, 'byteLength', source_byte_length, 'status', status, 'readbackSha256', readback_sha256) ORDER BY ordinal)::text, '[]')",
    'FROM _tzudong_local.migration_ledger;',
  ].join(' ');
  const result = spawnSync(
    'docker',
    [
      'exec', '-i', databaseContainer,
      'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
      '--username', 'postgres', '--dbname', 'postgres', '--command', query,
    ],
    {
      cwd: local.repositoryRoot,
      env: safeProcessEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: MAX_RECEIPT_BYTES,
    },
  );
  let ledger;
  try {
    ledger = JSON.parse(result.stdout?.trim() ?? '');
  } catch {
    fail('migration_ledger');
  }
  const expected = manifest?.source?.files;
  if (
    result.error
    || result.signal
    || result.status !== 0
    || !Array.isArray(expected)
    || !Array.isArray(ledger)
    || ledger.length !== expected.length
    || ledger.some((row, index) => {
      const source = expected[index];
      return row?.path !== source?.path
        || row?.ordinal !== source?.ordinal
        || row?.sha256 !== source?.sha256
        || row?.byteLength !== source?.byteLength
        || row?.status !== 'applied'
        || !/^[a-f0-9]{64}$/.test(row?.readbackSha256 ?? '');
    })
  ) {
    fail('migration_ledger');
  }
  return { manifest, ledger };
}

export function assertLocalSupabaseReady(local, { requireDeterministicReceipt = false } = {}) {
  const stackReceipt = runJson(
    'python3',
    [
      path.join(local.repositoryRoot, 'backend', 'supabase', 'scripts', 'local-stack.py'),
      'status',
      '--repository-root',
      local.repositoryRoot,
    ],
    { cwd: local.repositoryRoot, code: 'stack_status', timeout: 180_000 },
  );
  if (
    stackReceipt?.schema !== 'local-stack-receipt-v1'
    || stackReceipt.action !== 'status'
    || stackReceipt.ok !== true
    || stackReceipt.project_name !== local.projectName
    || !Array.isArray(stackReceipt.services)
    || stackReceipt.services.length !== EXPECTED_SERVICES.length
  ) {
    fail('stack_receipt');
  }
  const observed = new Set();
  for (const service of stackReceipt.services) {
    if (
      !EXPECTED_SERVICES.includes(service?.service)
      || observed.has(service.service)
      || service.state !== 'running'
      || (
        service.health !== 'healthy'
        && !(SERVICES_WITHOUT_DOCKER_HEALTHCHECK.has(service.service) && service.health === '')
      )
    ) {
      fail('stack_service');
    }
    observed.add(service.service);
  }
  const dockerRows = spawnSync(
    'docker',
    [
      'ps',
      '--filter', `label=com.docker.compose.project=${local.projectName}`,
      '--filter', 'label=com.docker.compose.service=db',
      '--format', '{{.ID}}',
    ],
    {
      cwd: local.repositoryRoot,
      env: safeProcessEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );
  const containers = dockerRows.stdout?.trim().split('\n').filter(Boolean) ?? [];
  if (
    dockerRows.error
    || dockerRows.signal
    || dockerRows.status !== 0
    || containers.length !== 1
    || !/^[a-f0-9]{12,64}$/.test(containers[0])
  ) {
    fail('database_container');
  }
  const schema = readCurrentMigrationLedger(local, containers[0]);
  let migrationReceipt;
  if (requireDeterministicReceipt) {
    const binding = [
      '--container', containers[0],
      '--allow-local',
      '--project', local.projectName,
      '--state-dir', local.stateRoot,
      '--env-file', local.envFile,
    ];
    migrationReceipt = runJson(
      'python3',
      [
        path.join(local.repositoryRoot, 'backend', 'supabase', 'scripts', 'local-migrate.py'),
        'receipt',
        ...binding,
      ],
      { cwd: local.repositoryRoot, code: 'migration_receipt', timeout: 300_000 },
    );
    if (
      migrationReceipt?.schema !== 'local-receipt-v1'
      || migrationReceipt.project_name !== local.projectName
      || !Array.isArray(migrationReceipt.ledger)
      || migrationReceipt.ledger.length !== schema.ledger.length
      || !/^[a-f0-9]{64}$/.test(migrationReceipt.catalog_sha256 ?? '')
    ) {
      fail('migration_receipt');
    }
  }
  return { stackReceipt, migrationReceipt, schema, databaseContainer: containers[0] };
}

export function buildLocalWebEnvironment(local, inherited = process.env) {
  const environment = { ...inherited };
  for (const key of Object.keys(environment)) {
    if (isHostedDatabaseEnvironmentKey(key)) delete environment[key];
  }
  const githubRepository = resolveLocalGithubRepository(environment);
  delete environment.GITHUB_REPOSITORY;
  delete environment.INSIGHT_GITHUB_REPOSITORY;
  return {
    ...environment,
    ...(githubRepository
      ? {
        GITHUB_REPOSITORY: githubRepository,
        INSIGHT_GITHUB_REPOSITORY: githubRepository,
      }
      : {}),
    INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '1',
    INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: local.supabaseOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.values.ANON_KEY,
    SUPABASE_URL: local.supabaseOrigin,
    SUPABASE_SERVICE_ROLE_KEY: local.values.SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_SERVER_KEY: local.values.STORAGE_SERVICE_KEY,
    INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '1',
    TZUDONG_LOCAL_SUPABASE_DEV: '1',
    NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
    LOCAL_SUPABASE_STATE_ROOT: local.stateRoot,
    NODE_ENV: 'development',
  };
}

export function buildLocalNightlyEnvironment(local, inherited = process.env) {
  return {
    ...buildLocalWebEnvironment(local, inherited),
    ANON_KEY: local.values.ANON_KEY,
    SERVICE_ROLE_KEY: local.values.SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: local.values.SUPABASE_DB_URL,
    POSTGRES_HOST_PORT: local.values.POSTGRES_HOST_PORT,
    KONG_HTTP_PORT: local.values.KONG_HTTP_PORT,
    PROJECT_NAME: local.projectName,
    LOCAL_STATE_ROOT: local.stateRoot,
    LOCAL_INPUT_ROOT: local.values.LOCAL_INPUT_ROOT,
    LOCAL_STACK_GENERATOR_VERSION: local.values.LOCAL_STACK_GENERATOR_VERSION,
    API_EXTERNAL_URL: local.supabaseOrigin,
    SUPABASE_PUBLIC_URL: local.supabaseOrigin,
    NIGHTLY_ADMIN_EMAIL: local.values.NIGHTLY_ADMIN_EMAIL,
    NIGHTLY_ADMIN_PASSWORD: local.values.NIGHTLY_ADMIN_PASSWORD,
    NIGHTLY_LOCAL_ENV_ONLY: '1',
    NIGHTLY_ENV_FILE_ONLY: '1',
    NIGHTLY_ENV_FILE: local.envFile,
    NIGHTLY_ENV_PROVENANCE: local.provenanceSha256,
    NIGHTLY_ENV_PROVENANCE_SHA256: local.provenanceSha256,
    NIGHTLY_MODE: 'local',
    NODE_ENV: 'test',
  };
}

export const __localSupabaseRuntimeForTests = {
  projectName,
  parseGeneratedEnvironment,
};
