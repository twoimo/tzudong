import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  createWriteStream,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, '..');
const healthTimeoutMs = 120_000;
const healthPollMs = 1_000;
const healthRequestTimeoutMs = 2_000;
const repositoryRoot = realpathSync(path.resolve(appRoot, '..', '..'));
const localProjectName = `tzudong-local-${createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 12)}`;
const localInputManifestPath = path.join(repositoryRoot, 'backend', 'supabase', 'local-inputs', 'manifest.v1.json');
const localGeneratorVersion = 'local-stack-v1';
const localComposeVersion = 'v2.39.4';
const localInputProvenanceFilename = 'stack.inputs.provenance.json';
const localStackReceiptFilename = 'last-receipt.json';
const localMigrationReceiptFilename = 'local-receipt-v1.json';
const localExpectedServices = [
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
const localServicesWithoutDockerHealthcheck = new Set(['functions', 'rest']);
const localMigrationReceiptExpectedKeys = [
  'catalog_sha256',
  'closure_binding_sha256',
  'commit_sha256',
  'compose_evidence_sha256',
  'config_sha256',
  'env_provenance_sha256',
  'environment_contract_sha256',
  'function_source_sha256',
  'image_digests',
  'image_service_digests',
  'input_evidence_sha256',
  'input_provenance_sha256',
  'input_source_manifest_sha256',
  'ledger',
  'ledger_sha256',
  'prerequisite_sha256',
  'platform_bootstrap_evidence_sha256',
  'platform_bootstrap_sha256',
  'project_name',
  'readback',
  'readback_sha256',
  'readback_sql_sha256',
  'schema',
  'seed_sha256',
  'seed_source_sha256',
  'sequence',
  'sequence_sha256',
  'serializer',
  'service',
  'service_sha256',
  'source_chain_sha256',
  'source_manifest_sha256',
  'stack_provenance',
].sort().join(',');
const localStackProvenanceExpectedKeys = [
  'commit_sha256',
  'compose_evidence_sha256',
  'config_sha256',
  'environment_contract_sha256',
  'env_provenance_sha256',
  'function_source_sha256',
  'generator_version',
  'image_digests',
  'image_service_digests',
  'input_evidence_sha256',
  'input_provenance_sha256',
  'input_source_manifest_sha256',
  'project_name',
  'readback_sql_sha256',
  'renderer',
  'schema',
].sort().join(',');
const localReceiptSequenceMarkers = ['prerequisite', 'migration', 'closure', 'platform-bootstrap', 'seed'];
const localReceiptSourceBindings = [
  'source_manifest_sha256',
  'source_chain_sha256',
  'input_source_manifest_sha256',
  'input_evidence_sha256',
  'compose_evidence_sha256',
  'function_source_sha256',
  'seed_source_sha256',
  'prerequisite_sha256',
  'readback_sql_sha256',
  'platform_bootstrap_evidence_sha256',
  'platform_bootstrap_sha256',
  'environment_contract_sha256',
];
const localReceiptDigestPattern = /^[a-f0-9]{64}$/;
const localBrowserDiagnosticsFilename = 'nightly-route-diagnostics.json';
const localBrowserDiagnosticsArtifact = path.join(
  appRoot,
  'test-results',
  'local-browser-route-diagnostics.json',
);
const maxLocalBrowserDiagnosticsFileBytes = 64 * 1024;
const maxLocalBrowserDiagnosticsRecords = 1024;
const maxLocalBrowserDiagnosticsArtifactBytes = 256 * 1024;
const localStateRoot = path.join(repositoryRoot, 'backend', 'supabase', 'volumes', '.local-stack', localProjectName);
const hostedIdentityKeys = [
  'NIGHTLY_SUPABASE_PROJECT_REF',
  'TS7_RELEASE_ID',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_PROJECT_ID',
];
const browserEnvironmentKeys = [
  'PATH',
  'HOME',
  'USER',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'CI',
  'NO_COLOR',
  'NODE_ENV',
  'APP_PORT',
  'HOST',
  'HOSTNAME',
  'NIGHTLY_MODE',
  'NIGHTLY_LOCAL_ENV_ONLY',
  'NIGHTLY_ENV_FILE_ONLY',
  'NIGHTLY_ENV_PROVENANCE',
  'NIGHTLY_ENV_PROVENANCE_SHA256',
  'NIGHTLY_ENV_FILE',
  'NIGHTLY_BROWSER_RUNTIME',
  'NIGHTLY_ADMIN_EMAIL',
  'NIGHTLY_ADMIN_PASSWORD',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME',
  'SUPABASE_URL',
  'SUPABASE_PUBLIC_URL',
  'API_EXTERNAL_URL',
  'NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL',
  'PLAYWRIGHT_BASE_URL',
  'PLAYWRIGHT_WEB_SERVER_URL',
  'PLAYWRIGHT_REUSE_EXISTING_SERVER',
  ...hostedIdentityKeys,
];
const localRuntimeKeys = new Set(browserEnvironmentKeys.filter((name) => ![
  'PLAYWRIGHT_BASE_URL',
  'PLAYWRIGHT_WEB_SERVER_URL',
  'PLAYWRIGHT_REUSE_EXISTING_SERVER',
  ...hostedIdentityKeys,
].includes(name)));
const hostedRuntimeKeys = new Set([
  ...[...localRuntimeKeys].filter((name) => ![
    'SUPABASE_URL',
    'SUPABASE_PUBLIC_URL',
    'API_EXTERNAL_URL',
    'NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL',
  ].includes(name)),
  ...hostedIdentityKeys,
]);
const curatedBrowserSpecs = [
  'tests/smoke.spec.ts',
  'tests/navigation.spec.ts',
  'tests/browser-title.spec.ts',
  'tests/mobile-home-map.spec.ts',
  'tests/local-supabase-admin.spec.ts',
];
const hostedRequiredEnvironment = [
  ...hostedIdentityKeys,
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NIGHTLY_ADMIN_EMAIL',
  'NIGHTLY_ADMIN_PASSWORD',
];
const localUrlEnvironment = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLIC_URL',
  'API_EXTERNAL_URL',
];
const localDbEnvironment = ['SUPABASE_DB_URL', 'POSTGRES_URL', 'DATABASE_URL'];
const cloudEnvironment = [
  'SUPABASE_ACCESS_TOKEN',
  'VERCEL_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'POSTGRES_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'NCP_ACCESS_KEY',
  'NCP_SECRET_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'RCLONE_CONFIG',
];
const activeChildren = new Set();
let terminating = false;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const pickEnvironment = (environment, keys) => Object.fromEntries(
  keys.flatMap((key) => {
    const value = environment[key];
    return value === undefined ? [] : [[key, value]];
  }),
);

function usage() {
  return [
    'Usage: node scripts/run-nightly-regression.mjs --mode local|hosted [--suite all|unit|e2e] [--env-file PATH] [--provenance-file PATH]',
    'Commands may also be written as validate-only, unit, e2e, or all.',
    'Local mode requires an explicitly generated env file and adjacent provenance receipt.',
  ].join('\n');
}

function optionValue(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArguments(argumentsList) {
  let mode;
  let suite = 'all';
  let envFile;
  let provenanceFile;
  let validateOnly = false;
  let positionalSuite;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--validate-only' || argument === 'validate-only') {
      validateOnly = true;
      continue;
    }
    if (argument === '--mode') {
      if (mode !== undefined) {
        throw new Error('--mode may only be supplied once.');
      }
      mode = optionValue(argumentsList, index, argument);
      index += 1;
      continue;
    }
    if (argument.startsWith('--mode=')) {
      if (mode !== undefined) {
        throw new Error('--mode may only be supplied once.');
      }
      mode = argument.slice('--mode='.length);
      continue;
    }
    if (argument === '--suite' || argument === '--env-file' || argument === '--provenance-file') {
      const value = optionValue(argumentsList, index, argument);
      if (argument === '--suite') {
        suite = value;
      } else if (argument === '--env-file') {
        envFile = value;
      } else {
        provenanceFile = value;
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--suite=')) {
      suite = argument.slice('--suite='.length);
      continue;
    }
    if (argument.startsWith('--env-file=')) {
      envFile = argument.slice('--env-file='.length);
      continue;
    }
    if (argument.startsWith('--provenance-file=')) {
      provenanceFile = argument.slice('--provenance-file='.length);
      continue;
    }
    if (!argument.startsWith('--') && ['all', 'unit', 'e2e'].includes(argument)) {
      if (positionalSuite !== undefined) {
        throw new Error('Only one nightly suite may be selected.');
      }
      positionalSuite = argument;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (positionalSuite !== undefined) {
    if (suite !== 'all' && suite !== positionalSuite) {
      throw new Error('Positional suite and --suite select different nightly lanes.');
    }
    suite = positionalSuite;
  }
  if (!['local', 'hosted'].includes(mode)) {
    throw new Error('Nightly mode is required. Use --mode local or --mode hosted.');
  }
  if (suite === 'validate-only') {
    validateOnly = true;
    suite = 'all';
  }
  if (!['all', 'unit', 'e2e'].includes(suite)) {
    throw new Error(`Unsupported nightly suite: ${suite}. Use all, unit, or e2e.`);
  }

  return { mode, suite, envFile, provenanceFile, validateOnly };
}

function resolveExplicitPath(value, label) {
  if (!value || value.trim() === '') {
    throw new Error(`${label} must be an explicit non-empty path.`);
  }
  return path.resolve(process.cwd(), value);
}

function isDedicatedNightlyEnvFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === '.env.local' || basename === '.env' || basename === 'backend.env') {
    return false;
  }
  return basename === 'stack.env'
    || (basename.includes('nightly') && (basename.endsWith('.local') || basename.endsWith('.env')));
}

function loadExplicitEnvironment(mode, envFileArgument) {
  const inheritedFile = process.env.NIGHTLY_ENV_FILE?.trim();
  const selectedArgument = envFileArgument ?? inheritedFile;
  if (mode === 'local' && !selectedArgument) {
    throw new Error('Local nightly mode requires --env-file (or NIGHTLY_ENV_FILE) for generated inputs.');
  }
  if (!selectedArgument) {
    return { envFilePath: undefined };
  }

  const envFilePath = resolveExplicitPath(selectedArgument, 'Nightly env file');
  if (!isDedicatedNightlyEnvFile(envFilePath)) {
    throw new Error('Nightly env files must be dedicated stack.env or nightly .env files; .env.local and backend/.env are rejected.');
  }
  if (mode === 'local' && (path.basename(envFilePath) !== 'stack.env' || path.resolve(envFilePath) !== path.join(localStateRoot, 'stack.env'))) {
    throw new Error('Local nightly env files must be the generated project-scoped stack.env.');
  }
  if (!existsSync(envFilePath)) {
    throw new Error(`Nightly env file was not found: ${envFilePath}`);
  }
  if (mode === 'local' && lstatSync(envFilePath).isSymbolicLink()) {
    throw new Error('Local nightly env files may not be symbolic links.');
  }

  if (mode === 'local') {
    for (const name of [
      ...localUrlEnvironment,
      ...localDbEnvironment,
      'ANON_KEY',
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'NIGHTLY_LOCAL_ENV_ONLY',
      'NIGHTLY_ENV_FILE_ONLY',
      'NODE_ENV',
    ]) {
      delete process.env[name];
    }
  }
  const result = loadEnv({ path: envFilePath, override: true });
  if (result.error) {
    throw new Error(`Unable to load the nightly env file: ${envFilePath}`);
  }
  if (mode === 'local') {
    process.env.NIGHTLY_LOCAL_ENV_ONLY = '1';
    process.env.NIGHTLY_ENV_FILE_ONLY = '1';
    process.env.NODE_ENV = 'test';
  }
  return { envFilePath };
}

function assertOwnerOnlyRegularFile(filePath, label) {
  let fileStat;
  try {
    fileStat = lstatSync(filePath);
  } catch {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o077) !== 0) {
    throw new Error(`${label} must be an owner-only regular file.`);
  }
  return fileStat;
}
function assertRepositoryInputFile(filePath, label) {
  let fileStat;
  try {
    fileStat = lstatSync(filePath);
  } catch {
    throw new Error(`${label} was not found: ${filePath}`);
  }
  if (
    !fileStat.isFile()
    || fileStat.isSymbolicLink()
    || fileStat.uid !== process.getuid?.()
    || (fileStat.mode & 0o400) === 0
    || (fileStat.mode & 0o022) !== 0
  ) {
    throw new Error(`${label} must be an owner-readable regular file without group/world write access.`);
  }
  return fileStat;
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
}

function assertOwnerOnlyDirectory(directoryPath, label) {
  let directoryStat;
  try {
    directoryStat = lstatSync(directoryPath);
  } catch {
    throw new Error(`${label} was not found: ${directoryPath}`);
  }
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || directoryStat.uid !== process.getuid?.()
    || (directoryStat.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} must be an owner-only directory.`);
  }
  return directoryStat;
}

function assertLocalStateFile(filePath, label, expectedMode = '0600') {
  const fileStat = assertOwnerOnlyRegularFile(filePath, label);
  if (fileStat.uid !== process.getuid?.() || (fileStat.mode & 0o777).toString(8).padStart(4, '0') !== expectedMode) {
    throw new Error(`${label} must be an owner-only ${expectedMode} file.`);
  }
  return fileStat;
}

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || path.isAbsolute(value)
    || value.split(/[\\/]/u).some((part) => part === '..')
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  return value;
}
function resolveLocalInputPath(root, relativePath, label) {
  const safePath = assertSafeRelativePath(relativePath, label);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, safePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its declared root.`);
  }
  return resolvedPath;
}
function assertLocalStatePath(root, relativePath, label) {
  const safePath = assertSafeRelativePath(relativePath, label);
  const rootPath = path.resolve(root);
  let current = rootPath;
  const parts = safePath.split(/[\\/]/u);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let fileStat;
    try {
      fileStat = lstatSync(current);
    } catch {
      throw new Error(`${label} was not found: ${current}`);
    }
    if (
      fileStat.isSymbolicLink()
      || fileStat.uid !== process.getuid?.()
      || (index < parts.length - 1 && (!fileStat.isDirectory() || (fileStat.mode & 0o077) !== 0))
    ) {
      throw new Error(`${label} has invalid owner or symlink custody: ${current}`);
    }
    if (index === parts.length - 1) {
      if (!fileStat.isFile() || (fileStat.mode & 0o777).toString(8).padStart(4, '0') !== '0600') {
        throw new Error(`${label} must be an owner-only 0600 regular file.`);
      }
      return fileStat;
    }
  }
  throw new Error(`${label} must be a regular file.`);
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function parseProvenanceHash(provenance) {
  const hash = provenance?.env_file_sha256;
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}

function loadProvenance(mode, envFilePath, provenanceFileArgument) {
  const explicitProvenance = provenanceFileArgument ?? process.env.NIGHTLY_ENV_PROVENANCE_FILE?.trim();
  if (mode !== 'local' && !explicitProvenance) {
    return { provenanceFilePath: undefined, digest: undefined };
  }
  if (!envFilePath) {
    throw new Error('Nightly provenance requires the explicitly loaded env file.');
  }

  const derivedPath = `${envFilePath}.provenance.json`;
  const provenanceFilePath = resolveExplicitPath(explicitProvenance ?? derivedPath, 'Nightly provenance file');
  if (mode === 'local' && path.resolve(provenanceFilePath) !== path.resolve(derivedPath)) {
    throw new Error('Local nightly provenance must be adjacent to the generated stack.env.');
  }
  const provenanceStat = mode === 'local'
    ? assertLocalStateFile(provenanceFilePath, 'Nightly env provenance')
    : assertOwnerOnlyRegularFile(provenanceFilePath, 'Nightly env provenance');
  if (mode === 'local' && (provenanceStat.mode & 0o777) !== 0o600) {
    throw new Error('Local nightly env provenance must be owner-only mode 0600.');
  }
  const provenance = readJsonFile(provenanceFilePath, 'Nightly env provenance');

  const envFileStat = mode === 'local'
    ? assertLocalStateFile(envFilePath, 'Nightly env file')
    : statSync(envFilePath);
  const envBytes = readFileSync(envFilePath);
  const digest = createHash('sha256').update(envBytes).digest('hex');
  const expectedDigest = parseProvenanceHash(provenance);
  if (!expectedDigest || expectedDigest !== digest) {
    throw new Error('Nightly env provenance does not match the explicit env file.');
  }
  if (
    (mode === 'local' && (envFileStat.mode & 0o777) !== 0o600)
    || (mode !== 'local' && (envFileStat.mode & 0o077) !== 0)
    || (mode === 'local' && provenance.env_file_mode !== '0600')
  ) {
    throw new Error('Nightly env files must be owner-only mode 0600 files.');
  }
  if (
    mode === 'local'
    && (
      provenance.schema !== 'local-stack-env-provenance-v1'
      || provenance.generator_version !== localGeneratorVersion
      || provenance.project_name !== localProjectName
      || provenance.env_file !== 'stack.env'
      || provenance.secret_values_included !== false
    )
  ) {
    throw new Error('Local nightly provenance is not bound to the generated stack.');
  }

  let inputProvenanceFilePath;
  let inputMetadata;
  if (mode === 'local') {
    inputProvenanceFilePath = path.join(path.dirname(envFilePath), localInputProvenanceFilename);
    assertOwnerOnlyDirectory(localStateRoot, 'Local stack state root');
    assertOwnerOnlyDirectory(path.join(localStateRoot, 'inputs'), 'Local stack input root');
    const inputProvenanceStat = assertLocalStateFile(inputProvenanceFilePath, 'Nightly input provenance');
    inputMetadata = readJsonFile(inputProvenanceFilePath, 'Nightly input provenance');
    const manifestStat = assertRepositoryInputFile(localInputManifestPath, 'Local input manifest');
    const manifestMode = (manifestStat.mode & 0o777).toString(8).padStart(4, '0');
    const manifest = readJsonFile(localInputManifestPath, 'Local input manifest');
    const manifestDigest = sha256File(localInputManifestPath);
    if (
      inputMetadata.schema !== 'local-stack-input-provenance-v2'
      || inputMetadata.generator_version !== localGeneratorVersion
      || inputMetadata.project_name !== localProjectName
      || inputMetadata.input_root !== 'inputs'
      || inputMetadata.source_manifest !== 'local-inputs/manifest.v1.json'
      || inputMetadata.source_manifest_sha256 !== manifestDigest
      || inputMetadata.source_manifest_mode !== manifestMode
      || inputMetadata.socket_mount !== 'removed'
      || manifest.schema !== 'local-stack-input-manifest-v1'
      || manifest.generator_version !== localGeneratorVersion
      || (manifestStat.mode & 0o022) !== 0
      || !Array.isArray(manifest.inputs)
      || !Array.isArray(inputMetadata.records)
      || inputMetadata.records.length !== manifest.inputs.length
    ) {
      throw new Error('Local nightly input provenance is not bound to the generated input manifest.');
    }

    const entriesByOutput = new Map();
    const actualOutputPaths = new Set();
    for (const entry of manifest.inputs) {
      if (
        !entry
        || typeof entry !== 'object'
        || !['source', 'template'].includes(entry.kind)
        || typeof entry.output !== 'string'
        || typeof entry.output_sha256 !== 'string'
        || !/^[a-f0-9]{64}$/i.test(entry.output_sha256)
        || entry.output_mode !== '0600'
        || entriesByOutput.has(entry.output)
      ) {
        throw new Error('Local nightly input manifest entries are malformed.');
      }
      const sourceKey = entry.kind === 'template' ? 'template' : 'source';
      const sourceHashKey = `${sourceKey}_sha256`;
      const sourceModeKey = `${sourceKey}_mode`;
      const source = entry[sourceKey];
      const sourceDigest = entry[sourceHashKey];
      const sourceMode = entry[sourceModeKey];
      if (
        typeof source !== 'string'
        || typeof sourceDigest !== 'string'
        || !/^[a-f0-9]{64}$/i.test(sourceDigest)
        || typeof sourceMode !== 'string'
        || !/^[0-7]{4}$/.test(sourceMode)
        || entry.output_sha256.toLowerCase() !== sourceDigest.toLowerCase()
      ) {
        throw new Error('Local nightly input manifest source declarations are malformed.');
      }

      const sourceRoot = entry.kind === 'template'
        ? path.join(repositoryRoot, 'backend', 'supabase', 'local-inputs')
        : path.join(repositoryRoot, 'backend', 'supabase');
      const sourcePath = resolveLocalInputPath(sourceRoot, source, `Local ${entry.kind} input`);
      const sourceStat = assertRepositoryInputFile(sourcePath, `Local ${entry.kind} input`);
      const actualSourceMode = (sourceStat.mode & 0o777).toString(8).padStart(4, '0');
      if (actualSourceMode !== sourceMode || sha256File(sourcePath) !== sourceDigest.toLowerCase()) {
        throw new Error(`Local ${entry.kind} input bytes or mode are stale: ${source}`);
      }

      const outputPath = resolveLocalInputPath(path.join(localStateRoot, 'inputs'), entry.output, 'Local generated input output');
      const outputStat = assertLocalStatePath(
        path.join(localStateRoot, 'inputs'),
        entry.output,
        'Local generated input output',
      );
      const actualOutputMode = (outputStat.mode & 0o777).toString(8).padStart(4, '0');
      const actualOutputDigest = sha256File(outputPath);
      if (actualOutputMode !== entry.output_mode || actualOutputDigest !== entry.output_sha256.toLowerCase()) {
        throw new Error(`Local generated input output bytes or mode are stale: ${entry.output}`);
      }
      actualOutputPaths.add(entry.output);
      entriesByOutput.set(entry.output, entry);
    }
    if (entriesByOutput.size !== manifest.inputs.length) {
      throw new Error('Local nightly input manifest contains duplicate outputs.');
    }

    const recordsByPath = new Map();
    for (const record of inputMetadata.records) {
      if (!record || typeof record !== 'object' || typeof record.path !== 'string' || recordsByPath.has(record.path)) {
        throw new Error('Local nightly input provenance records are malformed.');
      }
      const entry = entriesByOutput.get(record.path);
      if (!entry) {
        throw new Error('Local nightly input provenance records contain an unexpected output.');
      }
      const sourceKey = entry.kind === 'template' ? 'template' : 'source';
      const source = entry[sourceKey];
      const sourceDigest = entry[`${sourceKey}_sha256`].toLowerCase();
      const sourceMode = entry[`${sourceKey}_mode`];
      const outputPath = resolveLocalInputPath(path.join(localStateRoot, 'inputs'), record.path, 'Local generated input output');
      const outputStat = assertLocalStatePath(
        path.join(localStateRoot, 'inputs'),
        record.path,
        'Local generated input output',
      );
      const outputDigest = sha256File(outputPath);
      if (
        record.source !== source
        || record.source_sha256 !== sourceDigest
        || record.source_mode !== sourceMode
        || record.output_sha256 !== entry.output_sha256.toLowerCase()
        || record.sha256 !== entry.output_sha256.toLowerCase()
        || record.output_mode !== entry.output_mode
        || record.bytes !== readFileSync(outputPath).byteLength
        || (outputStat.mode & 0o777).toString(8).padStart(4, '0') !== record.output_mode
        || outputDigest !== record.output_sha256
        || (entry.kind === 'template' && (
          record.template_sha256 !== sourceDigest
          || record.template_mode !== sourceMode
        ))
      ) {
        throw new Error('Local nightly input provenance records do not match current generated input bytes.');
      }
      recordsByPath.set(record.path, record);
    }
    if (recordsByPath.size !== actualOutputPaths.size || [...actualOutputPaths].some((output) => !recordsByPath.has(output))) {
      throw new Error('Local nightly input provenance records do not cover every generated input output.');
    }
  }
  return { provenanceFilePath, inputProvenanceFilePath, digest, metadata: provenance, inputMetadata };
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function assertLoopbackUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid loopback URL.`);
  }
  if (parsed.protocol !== 'http:' || !isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${label} must use an http loopback URL.`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function assertLoopbackDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL loopback URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !isLoopbackHostname(parsed.hostname)) {
    throw new Error('SUPABASE_DB_URL must point to a loopback PostgreSQL endpoint.');
  }
  return parsed;
}

function containsCloudEndpoint(value) {
  return /(?:supabase\.co|supabase\.in|vercel\.app|amazonaws\.com|api\.naver\.com|googleapis\.com)/i.test(value);
}

function validateLocalEnvironment(environment) {
  if (environment.NIGHTLY_LOCAL_ENV_ONLY !== '1' || environment.NIGHTLY_ENV_FILE_ONLY !== '1') {
    throw new Error('Local nightly mode requires NIGHTLY_LOCAL_ENV_ONLY=1 and NIGHTLY_ENV_FILE_ONLY=1.');
  }
  const appPortValue = environment.APP_PORT?.trim();
  const appPort = Number(appPortValue);
  if (
    !appPortValue
    || !Number.isInteger(appPort)
    || appPort < 1024
    || appPort > 65535
    || appPort === 8080
  ) {
    throw new Error('Local nightly mode requires an explicit APP_PORT that is not the protected 8080 listener.');
  }
  const reservedPorts = [
    environment.KONG_HTTP_PORT,
    environment.KONG_HTTPS_PORT,
    environment.POSTGRES_HOST_PORT,
    environment.META_PORT,
    environment.STUDIO_PORT,
    environment.ANALYTICS_PORT,
    environment.POOLER_PROXY_PORT_TRANSACTION,
    environment.MAIL_SMTP_PORT,
    environment.MAIL_WEB_PORT,
    environment.MAIL_POP3_PORT,
  ].map(Number);
  if (reservedPorts.includes(appPort)) {
    throw new Error('Local nightly APP_PORT must not overlap a generated Supabase service port.');
  }
  const naverScriptUrl = environment.NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL?.trim();
  if (naverScriptUrl && naverScriptUrl !== '/__local/naver-maps.js') {
    let parsedNaverScript;
    try {
      parsedNaverScript = new URL(naverScriptUrl);
    } catch {
      throw new Error('Local nightly mode requires the loopback Naver fixture route.');
    }
    if (
      parsedNaverScript.protocol !== 'http:'
      || !isLoopbackHostname(parsedNaverScript.hostname)
      || parsedNaverScript.pathname !== '/__local/naver-maps.js'
    ) {
      throw new Error('Local nightly mode forbids the hosted Naver SDK URL.');
    }
  }
  if (environment.NODE_ENV !== 'test') {
    throw new Error('Local nightly mode requires NODE_ENV=test.');
  }
  if (environment.NIGHTLY_SUPABASE_PROJECT_REF?.trim()) {
    throw new Error('Local nightly mode forbids NIGHTLY_SUPABASE_PROJECT_REF.');
  }
  if (environment.NIGHTLY_SUPABASE_URL?.trim()) {
    throw new Error('Local nightly mode forbids hosted NIGHTLY_SUPABASE_URL.');
  }
  for (const name of cloudEnvironment) {
    if (environment[name]?.trim()) {
      throw new Error(`Local nightly mode forbids cloud credential ${name}.`);
    }
  }

  if (environment.PROJECT_NAME !== localProjectName) {
    throw new Error('Local nightly mode requires the generated local Compose project.');
  }
  if (
    path.resolve(environment.LOCAL_STATE_ROOT ?? '') !== localStateRoot
    || path.resolve(environment.LOCAL_INPUT_ROOT ?? '') !== path.join(localStateRoot, 'inputs')
    || environment.LOCAL_STACK_GENERATOR_VERSION !== 'local-stack-v1'
  ) {
    throw new Error('Local nightly mode requires generated project-scoped stack inputs.');
  }
  if (environment.POSTGRES_HOST !== 'db' || environment.POSTGRES_PORT !== '5432') {
    throw new Error('Local nightly mode requires the internal db service port contract.');
  }
  const hostDatabasePort = Number(environment.POSTGRES_HOST_PORT);
  if (!Number.isInteger(hostDatabasePort) || hostDatabasePort < 1 || hostDatabasePort > 65535 || hostDatabasePort === 5432) {
    throw new Error('Local nightly mode requires a distinct generated host database port.');
  }

  const selectedUrl = localUrlEnvironment.map((name) => environment[name]?.trim()).find(Boolean);
  if (!selectedUrl) {
    throw new Error('Local nightly mode requires an explicit loopback Supabase URL.');
  }
  const normalizedUrl = assertLoopbackUrl(selectedUrl, 'Local Supabase URL');
  const publicUrl = new URL(normalizedUrl);
  if (Number(publicUrl.port || 80) !== Number(environment.KONG_HTTP_PORT)) {
    throw new Error('Local nightly Supabase URL must match the generated Kong port.');
  }
  for (const name of [...localUrlEnvironment, 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (environment[name]?.trim()) {
      assertLoopbackUrl(environment[name].trim(), name);
      if (containsCloudEndpoint(environment[name])) {
        throw new Error(`Local nightly mode rejects cloud endpoint ${name}.`);
      }
    }
  }

  const databaseUrl = localDbEnvironment.map((name) => environment[name]?.trim()).find(Boolean);
  if (!databaseUrl) {
    throw new Error('Local nightly mode requires an explicit loopback SUPABASE_DB_URL.');
  }
  const database = assertLoopbackDatabaseUrl(databaseUrl);
  if (Number(database.port || 5432) !== hostDatabasePort) {
    throw new Error('Local nightly database URL must match the generated host database port.');
  }
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    || environment.SUPABASE_ANON_KEY?.trim()
    || environment.ANON_KEY?.trim();
  if (!anonKey) {
    throw new Error('Local nightly mode requires an explicit generated Supabase anon key.');
  }
  const serviceRoleKey = environment.SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey || serviceRoleKey.length < 64 || /[\r\n]/.test(serviceRoleKey)) {
    throw new Error('Local nightly mode requires the generated Supabase service-role key.');
  }
  const storageServerKey = environment.STORAGE_SERVICE_KEY?.trim();
  if (!storageServerKey || storageServerKey.length < 64 || /[\r\n]/.test(storageServerKey)) {
    throw new Error('Local nightly mode requires the generated Storage server key.');
  }
  if (!environment.NIGHTLY_ADMIN_EMAIL?.trim() || environment.NIGHTLY_ADMIN_EMAIL.trim() !== 'nightly-ci@local.invalid') {
    throw new Error('Local nightly mode requires the fixed nightly-ci@local.invalid identity.');
  }
  const localPassword = environment.NIGHTLY_ADMIN_PASSWORD?.trim();
  if (!localPassword || localPassword.length < 16 || /[\r\n]/.test(localPassword)) {
    throw new Error('Local nightly mode requires a generated local nightly password.');
  }
  const requestedPortEnvironment = appPortValue;

  return {
    ...pickEnvironment(environment, [...localRuntimeKeys]),
    NEXT_PUBLIC_SUPABASE_URL: normalizedUrl,
    SUPABASE_URL: environment.SUPABASE_URL?.trim() || normalizedUrl,
    SUPABASE_PUBLIC_URL: environment.SUPABASE_PUBLIC_URL?.trim() || normalizedUrl,
    API_EXTERNAL_URL: environment.API_EXTERNAL_URL?.trim() || normalizedUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_STORAGE_SERVER_KEY: storageServerKey,
    NIGHTLY_ADMIN_EMAIL: environment.NIGHTLY_ADMIN_EMAIL,
    NIGHTLY_ADMIN_PASSWORD: localPassword,
    APP_PORT: requestedPortEnvironment,
    NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
    NIGHTLY_MODE: 'local',
    NIGHTLY_LOCAL_ENV_ONLY: '1',
    NIGHTLY_ENV_FILE_ONLY: '1',
    NODE_ENV: 'test',
  };
}

function validateHostedEnvironment(environment) {
  const missing = hostedRequiredEnvironment.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required hosted nightly environment variable(s): ${missing.join(', ')}`);
  }
  for (const name of hostedIdentityKeys.slice(1)) {
    if (/[\r\n]/.test(environment[name].trim())) {
      throw new Error(`Hosted nightly identity ${name} must not contain newlines.`);
    }
  }
  if (environment.NIGHTLY_LOCAL_ENV_ONLY === '1' || environment.NIGHTLY_ENV_FILE_ONLY === '1') {
    throw new Error('Hosted nightly mode rejects local-only environment markers.');
  }
  const projectRef = environment.NIGHTLY_SUPABASE_PROJECT_REF.trim();
  if (!/^[a-z0-9-]+$/.test(projectRef)) {
    throw new Error('Hosted nightly Supabase project reference is invalid.');
  }
  const parsedUrl = new URL(environment.NEXT_PUBLIC_SUPABASE_URL.trim());
  const expectedHost = `${projectRef}.supabase.co`;
  if (
    parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== expectedHost
    || (parsedUrl.port && parsedUrl.port !== '443')
    || parsedUrl.pathname !== '/'
    || parsedUrl.search
    || parsedUrl.hash
    || parsedUrl.username
    || parsedUrl.password
  ) {
    throw new Error('Hosted nightly Supabase URL must be the exact HTTPS isolated project endpoint.');
  }
  if (!environment.NIGHTLY_ADMIN_EMAIL.trim().toLowerCase().includes('nightly')) {
    throw new Error('Nightly admin identity must be a dedicated non-production account.');
  }

  return {
    ...pickEnvironment(environment, [...hostedRuntimeKeys]),
    NIGHTLY_SUPABASE_PROJECT_REF: projectRef,
    TS7_RELEASE_ID: environment.TS7_RELEASE_ID.trim(),
    VERCEL_GIT_COMMIT_SHA: environment.VERCEL_GIT_COMMIT_SHA.trim(),
    VERCEL_DEPLOYMENT_ID: environment.VERCEL_DEPLOYMENT_ID.trim(),
    VERCEL_PROJECT_ID: environment.VERCEL_PROJECT_ID.trim(),
    NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim(),
    NIGHTLY_MODE: 'hosted',
    NIGHTLY_ENV_FILE_ONLY: '1',
    NIGHTLY_ENV_PROVENANCE: environment.NIGHTLY_ENV_PROVENANCE || 'explicit',
  };
}

function validateEnvironment(mode, environment, provenance) {
  if (mode === 'local') {
    if (!provenance?.digest) {
      throw new Error('Local nightly mode requires a verified env provenance receipt.');
    }
    return {
      ...validateLocalEnvironment(environment),
      NIGHTLY_ENV_PROVENANCE: 'verified',
      NIGHTLY_ENV_PROVENANCE_SHA256: provenance.digest,
      NIGHTLY_ENV_FILE: provenance.envFilePath ? path.resolve(provenance.envFilePath, '..', path.basename(provenance.envFilePath).replace(/\.provenance\.json$/, '')) : undefined,
    };
  }
  return validateHostedEnvironment(environment);
}

function signalChild(child, signal) {
  if (
    child?.pid
    && child.__nightlyProcessGroup === true
    && process.platform !== 'win32'
  ) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child signal when the group already exited.
    }
  }
  try {
    child?.kill(signal);
  } catch {
    // The process may have exited between the status check and signal.
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  signalChild(child, 'SIGTERM');
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    signalChild(child, 'SIGKILL');
  }
}

async function terminateChildren(signal) {
  if (terminating) {
    return;
  }
  terminating = true;
  await Promise.all([...activeChildren].map((child) => stopProcess(child)));
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.once('SIGINT', () => void terminateChildren('SIGINT'));
process.once('SIGTERM', () => void terminateChildren('SIGTERM'));

function spawnTracked(command, argumentsList, options = {}) {
  const detached = options.detached === true;
  const child = spawn(command, argumentsList, {
    cwd: options.cwd ?? appRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    shell: false,
    windowsHide: true,
    detached,
  });
  if (detached) {
    child.__nightlyProcessGroup = true;
  }
  activeChildren.add(child);
  child.once('exit', () => activeChildren.delete(child));
  child.once('error', () => activeChildren.delete(child));
  return child;
}

function runCommand(command, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, argumentsList, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: typeof code === 'number' ? code : 1, signal }));
  });
}
function runCommandCapture(command, argumentsList, options = {}) {
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, argumentsList, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let overflow = false;
    const collect = (target, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        overflow = true;
        signalChild(child, 'SIGKILL');
        return target;
      }
      return target + chunk;
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = collect(stderr, chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({
      code: typeof code === 'number' ? code : 1,
      signal,
      stdout,
      stderr,
      overflow,
    }));
  });
}

async function waitForHealth(appProcess, healthUrl, mode, headers = undefined) {
  const deadline = Date.now() + healthTimeoutMs;
  let spawnError;
  appProcess.once('error', (error) => {
    spawnError = error;
  });
  let lastStatus = 'unreachable';

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Unable to start the nightly app: ${spawnError.message}`);
    }
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error('Nightly application exited before the health endpoint became ready.');
    }
    try {
      const response = await fetch(healthUrl, {
        headers: mode === 'local' ? headers : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(healthRequestTimeoutMs),
      });
      lastStatus = `HTTP ${response.status}`;
      if (response.redirected || response.url !== healthUrl) {
        lastStatus = `HTTP ${response.status} at ${response.url || 'unknown URL'}`;
        await response.body?.cancel();
      } else if (response.status !== 200) {
        await response.body?.cancel();
      } else {
        const payload = await response.json().catch(() => undefined);
        const localPayload = payload
          && payload.ok === true
          && payload.service === 'tzudong-web'
          && payload.mode === 'local'
          && Object.keys(payload).length === 3;
        const hostedPayload = payload
          && payload.ok === true
          && payload.service === 'tzudong-web'
          && typeof payload.releaseId === 'string'
          && typeof payload.gitSha === 'string'
          && typeof payload.deploymentId === 'string'
          && typeof payload.projectId === 'string'
          && payload.host === new URL(healthUrl).hostname
          && Object.keys(payload).length === 7;
        if (
          (mode === 'local' && localPayload)
          || (mode === 'hosted' && hostedPayload)
        ) {
          return;
        }
      }
    } catch {
      // Next may still be compiling. Retry until the bounded deadline.
    }
    await sleep(healthPollMs);
  }

  throw new Error(`Application did not become ready within ${healthTimeoutMs}ms (${lastStatus}). See nightly-web.log for diagnostics.`);
}

async function runUnitRegression(environment) {
  const supervisorExecutable = process.env.TZUDONG_NODE24_EXECUTABLE?.trim();
  const boundedEnvironment = pickEnvironment(
    environment,
    [...(environment.NIGHTLY_MODE === 'local' ? localRuntimeKeys : hostedRuntimeKeys)],
  );
  const unitEnvironment = supervisorExecutable
    ? { ...boundedEnvironment, TZUDONG_NODE24_EXECUTABLE: supervisorExecutable }
    : boundedEnvironment;
  const result = await runCommand('bun', ['run', 'test:unit'], { env: unitEnvironment });
  if (result.code !== 0) {
    throw new Error(`Nightly unit regressions failed with exit code ${result.code}.`);
  }
}
function localDockerEnvironment() {
  return pickEnvironment(process.env, ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']);
}

function localComposeArguments(envFilePath) {
  const supabaseRoot = path.join(repositoryRoot, 'backend', 'supabase');
  return [
    'compose',
    '--project-name',
    localProjectName,
    '--env-file',
    envFilePath,
    '-f',
    path.join(supabaseRoot, 'docker-compose.yml'),
    '-f',
    path.join(supabaseRoot, 'docker-compose.local.yml'),
    '-f',
    path.join(supabaseRoot, 'docker-compose.mail.yml'),
  ];
}

async function computeCurrentLocalComposeDigest() {
  const verifier = [
    'import importlib.util, pathlib, sys',
    'root = pathlib.Path(sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("nightly_local_stack", root / "backend/supabase/scripts/local-stack.py")',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'module._check_renderer()',
    'project, state = module._state(root)',
    'env_path = state / "stack.env"',
    'module._regular_owned(env_path, mode=0o600)',
    'module._validate_env(module._parse_env(env_path), project, state)',
    'manifest_path, source_manifest = module._load_input_manifest(root)',
    'manifest = __import__("json").loads((state / "stack.inputs.provenance.json").read_text(encoding="utf-8"))',
    'for compose_file in module._compose_files(root):',
    '    module._regular_owned(compose_file)',
    '    relative = str(compose_file.resolve().relative_to(root.resolve()))',
    '    expected = next(item["sha256"] for item in manifest["compose_files"] if item["path"] == relative)',
    '    if module._hash_file(compose_file) != expected: raise RuntimeError("compose_input_mismatch")',
    'command = module._compose(project, env_path, module._compose_files(root))',
    'model = module._load_model(command)',
    'print(module._scan_model(model, project, state, module._parse_env(env_path), manifest))',
  ].join('\n');
  const result = await runCommandCapture(
    'python3',
    ['-c', verifier, repositoryRoot],
    {
      cwd: repositoryRoot,
      env: localDockerEnvironment(),
      maxOutputBytes: 64 * 1024,
    },
  );
  if (result.overflow || result.code !== 0 || !/^[a-f0-9]{64}\n?$/i.test(result.stdout.trim())) {
    throw new Error('Local stack Compose configuration could not be freshly derived from the repository.');
  }
  return result.stdout.trim().toLowerCase();
}

function parseDockerServiceRows(stdout) {
  let parsed;
  try {
    parsed = stdout.trim().startsWith('[')
      ? JSON.parse(stdout)
      : stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    throw new Error('Local stack service state was not valid Docker Compose JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length !== localExpectedServices.length) {
    throw new Error('Local stack service state did not enumerate every expected service.');
  }
  const services = new Map();
  for (const row of parsed) {
    const service = row?.Service ?? row?.service;
    const state = row?.State ?? row?.state;
    const health = row?.Health ?? row?.health;
    if (
      typeof service !== 'string'
      || !localExpectedServices.includes(service)
      || services.has(service)
      || typeof state !== 'string'
      || state.toLowerCase() !== 'running'
      || (health !== undefined && typeof health !== 'string')
      || (typeof health === 'string' && ['unhealthy', 'starting'].includes(health.toLowerCase()))
    ) {
      throw new Error('Local stack readiness evidence contains a non-running or unhealthy service.');
    }
    services.set(service, {
      state: state.toLowerCase(),
      health: typeof health === 'string' ? health.toLowerCase() : undefined,
    });
  }
  if (services.size !== localExpectedServices.length) {
    throw new Error('Local stack service state did not cover every expected service.');
  }
  return services;
}

async function assertLocalMigrationReceipt(stateRoot, stackReceipt) {
  const receiptPath = path.join(stateRoot, localMigrationReceiptFilename);
  assertLocalStateFile(receiptPath, 'Local migration receipt');
  const receipt = readJsonFile(receiptPath, 'Local migration receipt');
  if (
    !receipt
    || typeof receipt !== 'object'
    || Object.keys(receipt).sort().join(',') !== localMigrationReceiptExpectedKeys
    || receipt.schema !== 'local-receipt-v1'
    || receipt.serializer !== 'receipt-v1'
    || receipt.project_name !== localProjectName
    || !Array.isArray(receipt.ledger)
    || receipt.ledger.length !== 73
    || !Array.isArray(receipt.sequence)
    || receipt.sequence.length !== localReceiptSequenceMarkers.length
    || receipt.config_sha256 !== stackReceipt.config_sha256
    || receipt.input_provenance_sha256 !== stackReceipt.input_provenance_sha256
    || receipt.env_provenance_sha256 !== stackReceipt.env_provenance_sha256
  ) {
    throw new Error('Local migration receipt is not the required source-bound receipt-v1 evidence.');
  }

  for (const field of localReceiptSourceBindings) {
    if (!localReceiptDigestPattern.test(receipt[field])) {
      throw new Error(`Local migration receipt has invalid ${field} evidence.`);
    }
  }
  if (
    !localReceiptDigestPattern.test(receipt.sequence_sha256)
    || !localReceiptDigestPattern.test(receipt.closure_binding_sha256)
    || !localReceiptDigestPattern.test(receipt.readback_sha256)
    || !localReceiptDigestPattern.test(receipt.catalog_sha256)
    || !localReceiptDigestPattern.test(receipt.seed_sha256)
    || !localReceiptDigestPattern.test(receipt.ledger_sha256)
    || !localReceiptDigestPattern.test(receipt.service_sha256)
    || (receipt.commit_sha256 !== null && !/^[a-f0-9]{40}$/.test(receipt.commit_sha256))
  ) {
    throw new Error('Local migration receipt digest evidence is malformed.');
  }

  for (const [index, marker] of localReceiptSequenceMarkers.entries()) {
    const row = receipt.sequence[index];
    if (
      !Array.isArray(row)
      || row.length !== 5
      || row[0] !== 'sequence'
      || row[1] !== marker
      || row[2] !== index + 1
      || !localReceiptDigestPattern.test(row[3])
      || row[4] !== receipt.source_manifest_sha256
    ) {
      throw new Error('Local migration receipt does not prove prerequisite, migration, closure, and seed order.');
    }
  }

  const provenance = receipt.stack_provenance;
  if (
    !provenance
    || typeof provenance !== 'object'
    || Object.keys(provenance).sort().join(',') !== localStackProvenanceExpectedKeys
    || provenance.schema !== 'local-stack-provenance-v1'
    || provenance.project_name !== localProjectName
    || provenance.generator_version !== localGeneratorVersion
    || provenance.renderer !== localComposeVersion
    || provenance.config_sha256 !== receipt.config_sha256
    || provenance.input_provenance_sha256 !== receipt.input_provenance_sha256
    || provenance.env_provenance_sha256 !== receipt.env_provenance_sha256
    || provenance.environment_contract_sha256 !== receipt.environment_contract_sha256
    || provenance.input_source_manifest_sha256 !== receipt.input_source_manifest_sha256
    || provenance.input_evidence_sha256 !== receipt.input_evidence_sha256
    || provenance.compose_evidence_sha256 !== receipt.compose_evidence_sha256
    || provenance.function_source_sha256 !== receipt.function_source_sha256
    || provenance.readback_sql_sha256 !== receipt.readback_sql_sha256
    || !Array.isArray(provenance.image_digests)
    || !provenance.image_digests.length
    || !provenance.image_service_digests
    || typeof provenance.image_service_digests !== 'object'
    || Object.keys(provenance.image_service_digests).sort().join(',') !== localExpectedServices.slice().sort().join(',')
  ) {
    throw new Error('Local migration receipt stack provenance is not current or source-bound.');
  }
  for (const service of localExpectedServices) {
    const digests = provenance.image_service_digests[service];
    if (
      !Array.isArray(digests)
      || digests.length === 0
      || digests.some((digest) => !/^sha256:[a-f0-9]{64}$/.test(digest))
    ) {
      throw new Error('Local migration receipt image provenance is incomplete.');
    }
  }

  const verifier = [
    'import importlib.util, pathlib, sys',
    'root = pathlib.Path(sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("nightly_local_migrate", root / "backend/supabase/scripts/local-migrate.py")',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'module._load_receipt_file(pathlib.Path(sys.argv[2]))',
    'print("receipt-v1-ok")',
  ].join('\n');
  const result = await runCommandCapture(
    'python3',
    ['-c', verifier, repositoryRoot, receiptPath],
    {
      cwd: repositoryRoot,
      env: localDockerEnvironment(),
      maxOutputBytes: 16 * 1024,
    },
  );
  if (result.overflow || result.code !== 0 || result.stdout.trim() !== 'receipt-v1-ok') {
    throw new Error('Local migration receipt is stale or not bound to current prerequisite, migration, closure, seed, and environment sources.');
  }
}
async function assertCurrentLocalReadiness() {
  const verifier = [
    'import importlib.util, pathlib, sys',
    'root = pathlib.Path(sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("nightly_local_stack_readiness", root / "backend/supabase/scripts/local-stack.py")',
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'module._check_renderer()',
    'project, state = module._state(root)',
    'env_path = state / "stack.env"',
    'values = module._parse_env(env_path)',
    'command = module._compose(project, env_path, module._compose_files(root))',
    'services = module._wait_ready(command, values, timeout=120, required=module.READINESS_REQUIRED)',
    'if len(services) != len(module.EXPECTED_SERVICES) or any(item.get("health") != "healthy" for item in services): raise RuntimeError("readiness_not_healthy")',
    'print("readiness-ok")',
  ].join('\n');
  const result = await runCommandCapture(
    'python3',
    ['-c', verifier, repositoryRoot],
    {
      cwd: repositoryRoot,
      env: localDockerEnvironment(),
      maxOutputBytes: 16 * 1024,
    },
  );
  if (result.overflow || result.code !== 0 || result.stdout.trim() !== 'readiness-ok') {
    throw new Error('Local stack readiness evidence was not freshly proven for every service.');
  }
}
async function assertLocalStackAdmission(environment) {
  const stateRoot = localStateRoot;
  const inputRoot = path.join(stateRoot, 'inputs');
  assertOwnerOnlyDirectory(stateRoot, 'Local stack state root');
  assertOwnerOnlyDirectory(inputRoot, 'Local stack input root');
  const envFilePath = path.join(stateRoot, 'stack.env');
  if (path.resolve(environment.NIGHTLY_ENV_FILE ?? '') !== path.resolve(envFilePath)) {
    throw new Error('Local stack receipt must match the generated project-scoped stack.env.');
  }
  const envProvenancePath = `${envFilePath}.provenance.json`;
  const inputProvenancePath = path.join(stateRoot, localInputProvenanceFilename);
  const receiptPath = path.join(stateRoot, localStackReceiptFilename);
  assertLocalStateFile(receiptPath, 'Local stack receipt');
  const receipt = readJsonFile(receiptPath, 'Local stack receipt');
  const expectedReceiptKeys = [
    'action',
    'config_sha256',
    'env_provenance_sha256',
    'error_code',
    'generator_version',
    'input_provenance_sha256',
    'ok',
    'project_name',
    'renderer',
    'schema',
    'services',
  ];
  if (
    !receipt
    || typeof receipt !== 'object'
    || Object.keys(receipt).sort().join(',') !== expectedReceiptKeys.join(',')
    || receipt.schema !== 'local-stack-receipt-v1'
    || receipt.ok !== true
    || !['start', 'reset', 'status'].includes(receipt.action)
    || receipt.error_code !== null
    || receipt.project_name !== localProjectName
    || receipt.generator_version !== localGeneratorVersion
    || receipt.renderer !== localComposeVersion
    || !/^[a-f0-9]{64}$/.test(receipt.config_sha256)
    || !/^[a-f0-9]{64}$/.test(receipt.input_provenance_sha256)
    || !/^[a-f0-9]{64}$/.test(receipt.env_provenance_sha256)
    || !Array.isArray(receipt.services)
  ) {
    throw new Error('Local stack receipt is not a current successful repository-derived receipt.');
  }
  if (
    receipt.input_provenance_sha256 !== sha256File(inputProvenancePath)
    || receipt.env_provenance_sha256 !== sha256File(envProvenancePath)
  ) {
    throw new Error('Local stack receipt provenance does not match current stack provenance files.');
  }
  const currentConfigDigest = await computeCurrentLocalComposeDigest();
  if (receipt.config_sha256 !== currentConfigDigest) {
    throw new Error('Local stack receipt configuration is stale or not repository-derived.');
  }
  const serviceReceipt = new Map();
  for (const service of receipt.services) {
    if (
      !service
      || typeof service !== 'object'
      || typeof service.service !== 'string'
      || !localExpectedServices.includes(service.service)
      || serviceReceipt.has(service.service)
      || service.state !== 'running'
      || (
        service.health !== 'healthy'
        && !(localServicesWithoutDockerHealthcheck.has(service.service) && service.health === '')
      )
    ) {
      throw new Error('Local stack receipt does not prove every expected service is running and healthy.');
    }
    serviceReceipt.set(service.service, service);
  }
  if (serviceReceipt.size !== localExpectedServices.length) {
    throw new Error('Local stack receipt does not cover every expected service.');
  }
  await assertLocalMigrationReceipt(stateRoot, receipt);

  const status = await runCommandCapture(
    'docker',
    [...localComposeArguments(envFilePath), 'ps', '--all', '--format', 'json'],
    {
      cwd: repositoryRoot,
      env: localDockerEnvironment(),
      maxOutputBytes: 256 * 1024,
    },
  );
  if (status.overflow || status.code !== 0) {
    throw new Error('Local stack service state could not be read from the project-scoped Compose stack.');
  }
  parseDockerServiceRows(status.stdout);
  await assertCurrentLocalReadiness();
}

const localDiagnosticClasses = new Set([
  'application-method-denied',
  'application-path-denied',
  'hosted-supabase-allowed',
  'hosted-supabase-denied',
  'hosted-supabase-method-denied',
  'local-dev-websocket',
  'mutation-denied',
  'naver-offline',
  'request-failed',
  'supabase-method-denied',
  'local-supabase-allowed',
  'supabase-offline',
  'supabase-path-denied',
  'third-party-provider-denied',
  'unknown-destination-denied',
  'websocket-denied',
  'websocket-path-denied',
]);
const localDiagnosticDestinations = new Set([
  'local-web',
  'local-supabase',
  'hosted-supabase',
  'naver-maps',
  'third-party-provider',
  'external-other',
  'invalid-url',
]);
const DIAGNOSTIC_COMPATIBILITY = new Set([
    'application-method-denied:local-web',
    'application-path-denied:local-web',
    'hosted-supabase-allowed:hosted-supabase',
    'hosted-supabase-denied:hosted-supabase',
    'hosted-supabase-method-denied:hosted-supabase',
    'local-dev-websocket:local-web',
    'local-supabase-allowed:local-supabase',
    'mutation-denied:local-web',
    'mutation-denied:local-supabase',
    'mutation-denied:hosted-supabase',
    'mutation-denied:naver-maps',
    'mutation-denied:third-party-provider',
    'mutation-denied:external-other',
    'naver-offline:naver-maps',
    'request-failed:local-web',
    'request-failed:local-supabase',
    'request-failed:hosted-supabase',
    'request-failed:naver-maps',
    'request-failed:third-party-provider',
    'request-failed:external-other',
    'supabase-method-denied:local-supabase',
    'supabase-offline:local-supabase',
    'supabase-path-denied:local-supabase',
    'third-party-provider-denied:third-party-provider',
    'unknown-destination-denied:external-other',
    'websocket-denied:hosted-supabase',
    'websocket-denied:naver-maps',
    'websocket-denied:third-party-provider',
    'websocket-denied:external-other',
    'websocket-denied:invalid-url',
    'websocket-path-denied:local-web',
    'websocket-path-denied:local-supabase',
]);
const localDiagnosticSecretPattern = /(?:password|secret|token|authorization|bearer|api[_-]?key|service[_-]?role|database[_-]?url|postgres(?:ql)?)/i;

function sanitizeLocalDiagnostic(record) {
  if (
    !record
    || typeof record !== 'object'
    || Object.keys(record).sort().join(',') !== 'class,count,destination,method,status'
    || typeof record.destination !== 'string'
    || !localDiagnosticDestinations.has(record.destination)
    || typeof record.method !== 'string'
    || !/^[A-Z]{1,12}$/.test(record.method)
    || !Number.isInteger(record.status)
    || record.status < 0
    || record.status > 599
    || typeof record.class !== 'string'
    || !localDiagnosticClasses.has(record.class)
    || !Number.isInteger(record.count)
    || record.count < 1
    || record.count > 65_535
    || !DIAGNOSTIC_COMPATIBILITY.has(`${record.class}:${record.destination}`)
    || localDiagnosticSecretPattern.test(JSON.stringify(record))
  ) {
    throw new Error('Local browser route diagnostics contained a malformed or secret-bearing record.');
  }
  return {
    destination: record.destination,
    method: record.method,
    status: record.status,
    class: record.class,
    count: record.count,
  };
}

function collectLocalBrowserDiagnostics(startedAt) {
  const resultsRoot = path.join(appRoot, 'test-results');
  const files = [];
  const walk = (directory, relativeDirectory = '') => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new Error('Local browser route diagnostics directory was not available.');
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name === localBrowserDiagnosticsFilename) {
          throw new Error('Local browser route diagnostics may not be symbolic links.');
        }
        continue;
      }
      if (entry.isDirectory()) {
        walk(entryPath, relativePath);
        continue;
      }
      if (entry.name !== localBrowserDiagnosticsFilename) continue;
      let fileStat;
      try {
        fileStat = lstatSync(entryPath);
      } catch {
        throw new Error('Local browser route diagnostics disappeared during collection.');
      }
      if (
        !fileStat.isFile()
        || fileStat.isSymbolicLink()
        || fileStat.uid !== process.getuid?.()
        || (fileStat.mode & 0o777) !== 0o600
      ) {
        throw new Error('Local browser route diagnostics must be owner-only regular files.');
      }
      if (fileStat.mtimeMs + 1000 < startedAt) continue;
      if (fileStat.size > maxLocalBrowserDiagnosticsFileBytes) {
        throw new Error('Local browser route diagnostics exceeded the per-test size bound.');
      }
      let payload;
      try {
        payload = JSON.parse(readFileSync(entryPath, 'utf8'));
      } catch {
        throw new Error('Local browser route diagnostics were not valid JSON.');
      }
      if (!Array.isArray(payload) || payload.length > 256) {
        throw new Error('Local browser route diagnostics exceeded the per-test record bound.');
      }
      files.push({ relativePath, payload });
    }
  };
  walk(resultsRoot);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (files.length === 0) {
    throw new Error('Local browser route diagnostics were not produced by the nightly fixture.');
  }
  const tests = [];
  let recordCount = 0;
  let requestCount = 0;
  for (const { payload } of files) {
    const records = payload.map(sanitizeLocalDiagnostic);
    recordCount += records.length;
    requestCount += records.reduce((total, record) => total + record.count, 0);
    if (recordCount > maxLocalBrowserDiagnosticsRecords) {
      throw new Error('Local browser route diagnostics exceeded the aggregate record bound.');
    }
    if (!Number.isSafeInteger(requestCount) || requestCount > maxLocalBrowserDiagnosticsRecords * 65_535) {
      throw new Error('Local browser route diagnostic request count exceeded the aggregate bound.');
    }
    tests.push({ index: tests.length, records });
  }
  const artifact = {
    schema: 'local-browser-route-diagnostics-v1',
    source: 'playwright-nightly-fixture',
    tests,
    record_count: recordCount,
    request_count: requestCount,
  };
  const body = `${JSON.stringify(artifact)}\n`;
  if (Buffer.byteLength(body) > maxLocalBrowserDiagnosticsArtifactBytes) {
    throw new Error('Local browser route diagnostics exceeded the aggregate size bound.');
  }
  let existing;
  try {
    existing = lstatSync(localBrowserDiagnosticsArtifact);
  } catch {
    existing = undefined;
  }
  if (
    existing
    && (
      !existing.isFile()
      || existing.isSymbolicLink()
      || existing.uid !== process.getuid?.()
      || (existing.mode & 0o777) !== 0o600
    )
  ) {
    throw new Error('Local browser route diagnostics artifact must be an owner-only regular file.');
  }
  writeFileSync(localBrowserDiagnosticsArtifact, body, { encoding: 'utf8', mode: 0o600 });
}
function openNightlyWebLog(logPath) {
  let parentStat;
  try {
    parentStat = lstatSync(path.dirname(logPath));
  } catch {
    throw new Error('Nightly web log parent directory was not available.');
  }
  if (
    !parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || parentStat.uid !== process.getuid?.()
    || (parentStat.mode & 0o022) !== 0
  ) {
    throw new Error('Nightly web log parent directory is not in owner custody.');
  }

  let existing;
  try {
    existing = lstatSync(logPath);
  } catch {
    existing = undefined;
  }
  if (
    existing
    && (
      !existing.isFile()
      || existing.isSymbolicLink()
      || existing.uid !== process.getuid?.()
      || (existing.mode & 0o077) !== 0
    )
  ) {
    throw new Error('nightly-web.log must be an owner-only regular file.');
  }

  let descriptor;
  try {
    const flags = fsConstants.O_WRONLY
      | fsConstants.O_NOFOLLOW
      | (existing ? 0 : fsConstants.O_CREAT | fsConstants.O_EXCL);
    descriptor = openSync(logPath, flags, 0o600);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.uid !== process.getuid?.()
      || (opened.mode & 0o077) !== 0
    ) {
      throw new Error('nightly-web.log is not in bounded owner-only custody.');
    }
    ftruncateSync(descriptor, 0);
    return createWriteStream(logPath, { fd: descriptor, autoClose: true });
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original custody failure.
      }
    }
    if (error instanceof Error && error.message.includes('nightly-web.log')) {
      throw error;
    }
    throw new Error('nightly-web.log could not be opened in owner-only custody.');
  }
}
async function runBrowserRegression(environment, mode) {
  const requestedPort = Number(environment.APP_PORT);
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    throw new Error('Nightly application APP_PORT must be an integer between 1024 and 65535.');
  }
  if (mode === 'local') {
    await assertLocalStackAdmission(environment);
  }
  const appPort = requestedPort;
  const healthNonce = mode === 'local' ? randomBytes(32).toString('hex') : undefined;
  const healthToken = mode === 'local'
    ? createHash('sha256').update(`${environment.NIGHTLY_ENV_PROVENANCE_SHA256}:${healthNonce}`).digest('hex')
    : undefined;
  const healthHeaders = mode === 'local'
    ? {
      'x-nightly-env-provenance-sha256': environment.NIGHTLY_ENV_PROVENANCE_SHA256,
      'x-nightly-health-token': healthToken,
    }
    : undefined;
  const healthUrl = `http://127.0.0.1:${appPort}/api/health`;
  const logPath = path.join(appRoot, 'nightly-web.log');
  const logStream = openNightlyWebLog(logPath);
  const appEnvironment = {
    ...pickEnvironment(
      environment,
      [...(mode === 'local' ? localRuntimeKeys : hostedRuntimeKeys)],
    ),
    ...(mode === 'local'
      ? {
        NIGHTLY_HEALTH_NONCE: healthNonce,
        NIGHTLY_HEALTH_TOKEN: healthToken,
        SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_STORAGE_SERVER_KEY: environment.SUPABASE_STORAGE_SERVER_KEY,
      }
      : {
        SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
      }),
    APP_PORT: String(appPort),
    HOST: '127.0.0.1',
    HOSTNAME: '127.0.0.1',
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${appPort}`,
    TZUDONG_NEXT_DIST_DIR: `.next-nightly-${mode}-${appPort}`,
    NODE_ENV: mode === 'local' ? 'test' : environment.NODE_ENV,
    NIGHTLY_BROWSER_RUNTIME: '1',
  };
  const appProcess = spawnTracked('node', [
    'scripts/clean-next.mjs',
    '--',
    'node',
    'node_modules/next/dist/bin/next',
    'dev',
    '--webpack',
    '--port',
    String(appPort),
    '--hostname',
    '127.0.0.1',
  ], {
    env: appEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  appProcess.stdout?.pipe(logStream);
  appProcess.stderr?.pipe(logStream);

  try {
    await waitForHealth(appProcess, healthUrl, mode, healthHeaders);
    const browserEnvironment = {
      ...pickEnvironment(appEnvironment, browserEnvironmentKeys),
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${appPort}`,
      PLAYWRIGHT_WEB_SERVER_URL: `http://127.0.0.1:${appPort}/`,
      PLAYWRIGHT_REUSE_EXISTING_SERVER: '1',
    };
    const diagnosticsStartedAt = Date.now();
    const result = await runCommand(
      'bunx',
      [
        'playwright',
        'test',
        ...curatedBrowserSpecs,
        '--project=chromium',
        '--reporter=line,html',
      ],
      { env: browserEnvironment, detached: true },
    );
    if (mode === 'local') {
      collectLocalBrowserDiagnostics(diagnosticsStartedAt);
    }
    if (result.code !== 0) {
      throw new Error(`Nightly browser regressions failed with exit code ${result.code}.`);
    }
  } finally {
    await stopProcess(appProcess);
    logStream.end();
  }
}

async function main() {
  const { mode, suite, envFile, provenanceFile, validateOnly } = parseArguments(process.argv.slice(2));
  const loaded = loadExplicitEnvironment(mode, envFile);
  const provenance = loadProvenance(mode, loaded.envFilePath, provenanceFile);
  const environment = validateEnvironment(mode, process.env, {
    ...provenance,
    envFilePath: loaded.envFilePath,
  });

  if (validateOnly) {
    console.log(`Nightly ${mode} environment validation passed (${suite}).`);
    return;
  }
  if (suite === 'all' || suite === 'unit') {
    await runUnitRegression(environment);
  }
  if (suite === 'all' || suite === 'e2e') {
    await runBrowserRegression(environment, mode);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Nightly regression failed.';
  console.error(`[nightly] ${message}`);
  process.exitCode = 1;
});
