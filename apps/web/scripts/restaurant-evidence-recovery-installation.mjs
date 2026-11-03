#!/usr/bin/env node
/** One reviewed installation; default is offline dry-run. No automatic retry. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrationWithTerminalReadback, readOriginalStatementVector, runPsql,
  selectDirectDatabaseTransport, validateReleaseMigrationManifest } from './apply-supabase-migration.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const INSTALLATION_MANIFEST_PATH = resolve(ROOT, '.github/restaurant-evidence-recovery-installation.v1.json');
export const INSTALLATION_MANIFEST_SHA256 = 'e141be705b10e550239c2a5d48128f80846757480dc454b5e4f76b89c6b0c48b';
const PROJECT = 'aqlcofblfxdrjhhdmarw', REPOSITORY = 'twoimo/tzudong';
const REMOTE = 'https://github.com/twoimo/tzudong.git';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/;
const CODES = new Set(['INSTALL_ARGUMENT_INVALID', 'INSTALL_SOURCE_DRIFT', 'INSTALL_ADMISSION_INVALID',
  'INSTALL_ADMISSION_EXPIRED', 'INSTALL_CONTEXT_INVALID', 'INSTALL_TARGET_INVALID', 'INSTALL_PRIOR_MISMATCH',
  'INSTALL_TERMINAL_MISMATCH', 'INSTALL_JOURNAL_INVALID', 'INSTALL_JOURNAL_EXISTS',
  'INSTALL_OUTCOME_UNCONFIRMED', 'INSTALL_RECONCILIATION_CONFLICT', 'INSTALL_ALREADY_APPLIED']);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function keys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !equal(Object.keys(value).sort(), [...expected].sort())) fail(code);
}
function parse(bytes, code) { try { return JSON.parse(bytes); } catch { fail(code); } }
export function boundedInstallationError(error) {
  const code = CODES.has(error?.code) ? error.code : 'INSTALL_OUTCOME_UNCONFIRMED';
  const bounded = new Error(code); bounded.code = code; return bounded;
}
function source(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path || info.size > 2 ** 20) fail('INSTALL_SOURCE_DRIFT');
  return readFileSync(path);
}
export function loadInstallationManifest() {
  try {
    const bytes = source(INSTALLATION_MANIFEST_PATH), manifest = parse(bytes, 'INSTALL_SOURCE_DRIFT');
    if (sha(bytes) !== INSTALLATION_MANIFEST_SHA256) fail('INSTALL_SOURCE_DRIFT');
    keys(manifest, ['schemaVersion', 'id', 'projectRef', 'protectedSource', 'legacyManifest', 'helpers', 'applyPolicy', 'migration'], 'INSTALL_SOURCE_DRIFT');
    if (manifest.schemaVersion !== 1 || manifest.projectRef !== PROJECT) fail('INSTALL_SOURCE_DRIFT');
    const [migration] = validateReleaseMigrationManifest({ version: 1, migrations: [manifest.migration] });
    for (const binding of [manifest.legacyManifest, ...manifest.helpers, migration]) {
      if (sha(source(resolve(ROOT, binding.path))) !== binding.sha256) fail('INSTALL_SOURCE_DRIFT');
    }
    return { manifestSha256: sha(bytes), migration, query: source(resolve(ROOT, migration.path)).toString('utf8') };
  } catch { fail('INSTALL_SOURCE_DRIFT'); }
}
function privatePath(path, directory = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail('INSTALL_ADMISSION_INVALID');
  const info = lstatSync(path);
  if (realpathSync(path) !== path || info.isSymbolicLink() || info.uid !== process.getuid()
      || (info.mode & 0o777) !== (directory ? 0o700 : 0o600)
      || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > 16384)) fail('INSTALL_ADMISSION_INVALID');
}
function readAdmission(path, record, journalPath) {
  try {
    privatePath(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes;
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1 || info.size > 16384) fail('INSTALL_ADMISSION_INVALID');
      bytes = readFileSync(fd);
    } finally { closeSync(fd); }
    const value = parse(bytes, 'INSTALL_ADMISSION_INVALID');
    keys(value, ['schemaVersion', 'operator', 'operationId', 'projectRef', 'manifestSha256', 'sqlSha256',
      'protectedMainSha', 'treeSha', 'issuedAt', 'expiresAt', 'journalPathSha256', 'freezeException'], 'INSTALL_ADMISSION_INVALID');
    keys(value.freezeException, ['variable', 'value', 'approvalRef'], 'INSTALL_ADMISSION_INVALID');
    if (value.schemaVersion !== 1 || value.operator !== 'twoimo' || !UUID.test(value.operationId)
        || value.projectRef !== PROJECT || value.manifestSha256 !== record.manifestSha256
        || value.sqlSha256 !== record.migration.sha256 || !REVISION.test(value.protectedMainSha)
        || !REVISION.test(value.treeSha) || !SHA.test(value.journalPathSha256)
        || value.journalPathSha256 !== sha(journalPath) || value.freezeException.variable !== 'G037_WRITE_FREEZE'
        || value.freezeException.value !== 'active'
        || !/^[A-Za-z0-9][A-Za-z0-9:/._#-]{0,199}$/.test(value.freezeException.approvalRef ?? '')) fail('INSTALL_ADMISSION_INVALID');
    const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt), now = Date.now();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now || expires <= now
        || expires <= issued || expires - issued > 900000) fail('INSTALL_ADMISSION_EXPIRED');
    return { ...value, admissionSha256: sha(bytes) };
  } catch (error) {
    if (error?.code === 'INSTALL_ADMISSION_EXPIRED') throw error;
    fail('INSTALL_ADMISSION_INVALID');
  }
}
function command(program, args) {
  const result = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) fail('INSTALL_CONTEXT_INVALID');
  return result.stdout.trim();
}
function readLiveContext() {
  const branch = parse(command('gh', ['api', `repos/${REPOSITORY}/branches/main`]), 'INSTALL_CONTEXT_INVALID');
  const freeze = parse(command('gh', ['api', `repos/${REPOSITORY}/actions/variables/G037_WRITE_FREEZE`]), 'INSTALL_CONTEXT_INVALID');
  const remote = command('/usr/bin/git', ['ls-remote', '--exit-code', '--refs', 'origin', 'refs/heads/main']);
  if (!/^[a-f0-9]{40}\trefs\/heads\/main$/.test(remote)) fail('INSTALL_CONTEXT_INVALID');
  return { repository: REPOSITORY, operator: command('gh', ['api', 'user', '--jq', '.login']),
    protected: branch.protected, mainSha: branch.commit?.sha,
    headSha: command('/usr/bin/git', ['rev-parse', 'HEAD']), treeSha: command('/usr/bin/git', ['rev-parse', 'HEAD^{tree}']),
    remoteUrl: command('/usr/bin/git', ['remote', 'get-url', 'origin']), remoteSha: remote.split('\t')[0],
    clean: command('/usr/bin/git', ['status', '--porcelain=v1', '--untracked-files=all']) === '',
    freezeName: freeze.name, freezeValue: freeze.value };
}
function checkContext(value, admission) {
  if (!value || value.operator !== admission.operator || value.repository !== REPOSITORY || value.protected !== true || value.clean !== true
      || value.remoteUrl !== REMOTE || value.mainSha !== admission.protectedMainSha
      || value.headSha !== admission.protectedMainSha || value.remoteSha !== admission.protectedMainSha
      || value.treeSha !== admission.treeSha || value.freezeName !== admission.freezeException.variable
      || value.freezeValue !== admission.freezeException.value) fail('INSTALL_CONTEXT_INVALID');
}
function databaseTarget(environment) {
  try {
    const { databaseUrl } = selectDirectDatabaseTransport(environment), target = new URL(databaseUrl);
    const user = decodeURIComponent(target.username);
    const direct = target.hostname === `db.${PROJECT}.supabase.co` && user === 'postgres';
    const pooler = /^aws-[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/.test(target.hostname) && user === `postgres.${PROJECT}`;
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || !(direct || pooler)
        || target.pathname !== '/postgres' || (target.port && target.port !== '5432') || target.hash
        || target.searchParams.getAll('sslmode').length !== 1
        || !['require', 'verify-full'].includes(target.searchParams.get('sslmode'))
        || [...target.searchParams.keys()].some(key => key !== 'sslmode')) fail('INSTALL_TARGET_INVALID');
    return databaseUrl;
  } catch { fail('INSTALL_TARGET_INVALID'); }
}
function readOnly(query) {
  return `BEGIN READ ONLY;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='2s';\n${query}\nROLLBACK;\n`;
}
function checkReadback(output, expected, code) {
  if (typeof output !== 'string' || output.length > 65536) fail(code);
  const actual = parse(output.trim().split(/\r?\n/).at(-1), code);
  if (!equal(actual, expected)) fail(code);
  return actual;
}
function journalWrite(fd, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  let offset = 0;
  while (offset < bytes.length) { const count = writeSync(fd, bytes, offset); if (count <= 0) fail('INSTALL_JOURNAL_INVALID'); offset += count; }
  fsyncSync(fd);
}
function journalIntent(path, admission) {
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600);
    journalWrite(fd, { schemaVersion: 1, stage: 'ddl_intent', operationId: admission.operationId,
      admissionSha256: admission.admissionSha256, manifestSha256: admission.manifestSha256,
      sqlSha256: admission.sqlSha256, protectedMainSha: admission.protectedMainSha, treeSha: admission.treeSha });
    const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return fd;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    fail(error?.code === 'EEXIST' ? 'INSTALL_JOURNAL_EXISTS' : 'INSTALL_JOURNAL_INVALID');
  }
}
function execute(argv, { environment = process.env, readLiveContext: context = readLiveContext, runPsqlImpl } = {}) {
  let mode = 'dry-run', admissionPath, journalPath, explicitMode = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (['--dry-run', '--apply', '--verify-terminal-state'].includes(arg)) {
      if (explicitMode) fail('INSTALL_ARGUMENT_INVALID'); explicitMode = true; mode = arg.slice(2);
    } else if (['--admission', '--journal'].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--') || (arg === '--admission' ? admissionPath : journalPath)) fail('INSTALL_ARGUMENT_INVALID');
      if (arg === '--admission') admissionPath = value; else journalPath = value;
    } else fail('INSTALL_ARGUMENT_INVALID');
  }
  if ((mode === 'apply') !== Boolean(admissionPath && journalPath)
      || (mode !== 'apply' && (admissionPath || journalPath))) fail('INSTALL_ARGUMENT_INVALID');
  const record = loadInstallationManifest();
  const report = { schemaVersion: 1, mode, projectRef: PROJECT, manifestSha256: record.manifestSha256,
    sqlSha256: record.migration.sha256, migrationApplied: false };
  if (mode === 'dry-run') return report;
  const sql = runPsqlImpl ?? ((url, query, transaction) => runPsql(url, query, transaction, { environment,
    spawnImpl: (program, args, options) => spawnSync(program, args, { ...options, timeout: 120000, killSignal: 'SIGKILL' }) }));
  if (mode === 'verify-terminal-state') {
    const url = databaseTarget(environment);
    return { ...report, terminalReadback: checkReadback(sql(url, readOnly(record.migration.terminalReadback.query), false),
      record.migration.terminalReadback.expected, 'INSTALL_TERMINAL_MISMATCH') };
  }
  const admission = readAdmission(admissionPath, record, journalPath);
  try { privatePath(dirname(journalPath), true); } catch { fail('INSTALL_JOURNAL_INVALID'); }
  if (!isAbsolute(journalPath) || resolve(journalPath) !== journalPath) fail('INSTALL_JOURNAL_INVALID');
  if (existsSync(journalPath)) fail('INSTALL_JOURNAL_EXISTS');
  try { lstatSync(journalPath); fail('INSTALL_JOURNAL_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  checkContext(context(), admission);
  const url = databaseTarget(environment);
  checkReadback(sql(url, readOnly(record.migration.expectedPriorState.query), false), record.migration.expectedPriorState.expected, 'INSTALL_PRIOR_MISMATCH');
  checkContext(context(), admission);
  if (Date.now() >= Date.parse(admission.expiresAt)) fail('INSTALL_ADMISSION_EXPIRED');
  const fd = journalIntent(journalPath, admission);
  try {
    let terminal;
    try {
      terminal = applyMigrationWithTerminalReadback(url, record.migration, record.query,
        { runPsqlImpl: sql, readVectorImpl: readOriginalStatementVector });
    } catch (error) {
      try { journalWrite(fd, { schemaVersion: 1, stage: 'unconfirmed', operationId: admission.operationId }); } catch { /* Keep the original intent. */ }
      fail(error?.code === 'MIGRATION_RECONCILIATION_CONFLICT' ? 'INSTALL_RECONCILIATION_CONFLICT'
        : error?.code === 'MIGRATION_ALREADY_APPLIED' ? 'INSTALL_ALREADY_APPLIED' : 'INSTALL_OUTCOME_UNCONFIRMED');
    }
    // A lost durable outcome write does not authorize another DDL attempt.
    try { journalWrite(fd, { schemaVersion: 1, stage: 'confirmed', operationId: admission.operationId, terminalSha256: sha(JSON.stringify(terminal)) }); }
    catch { fail('INSTALL_OUTCOME_UNCONFIRMED'); }
    return { ...report, operationId: admission.operationId, migrationApplied: true, terminalReadback: terminal };
  } finally { closeSync(fd); }
}
export function main(argv = process.argv.slice(2), dependencies = {}) {
  try { return execute(argv, dependencies); } catch (error) { throw boundedInstallationError(error); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(main()) + '\n'); }
  catch (error) { process.stderr.write(boundedInstallationError(error).message + '\n'); process.exitCode = 1; }
}
