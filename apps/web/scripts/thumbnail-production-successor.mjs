#!/usr/bin/env node
/**
 * One fixed thumbnail installation. The pinned draft is deliberately NOT executable.
 * Future release admission requires a separately reviewed pin; CLI has no override.
 * Dependency injection belongs to unit tests, never CLI arguments or environment.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOriginalStatementVector, selectDirectDatabaseTransport } from './apply-supabase-migration.mjs';
import { migrationEnvelope, atomicMigrationSql, reconciliationSql, reconciliationOutcome } from './supabase-migration-transaction.mjs';
import { assertSuccessorDatabaseTarget, createSuccessorPsqlRunner } from './admin-record-sql-successor.mjs';
import { observeThumbnailLocalOwner, validateThumbnailLocalOwner } from './thumbnail-local-owner.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const MANIFEST_PATH = '.github/thumbnail-production-installation.draft.v1.json';
export const MANIFEST_SHA256 = '51a7c5b61cc268e7a8fe23261548d1950ecfda122e12a6b0d13645e297563bbc';
export const RELEASE_ADMISSION_PATH = '.github/thumbnail-production-successor.v2.json';
export const PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
export const SERIALIZER_KEY = 'tzudong:review-media-sql-successor:workflow:v1';
export const CUSTODY_DIRECTORY = join(userInfo().homedir, '.codex/runtime-cache/thumbnail-production-successor', PROJECT_REF, MANIFEST_SHA256);
export const OWNER_AUTHORITY = 'authenticated-repository-owner-local-cli';
export const TLS_ROOT_PATH = 'backend/supabase/certificates/prod-ca-2021.crt';
export const TLS_ROOT_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
export const REQUIRED_FENCES = Object.freeze({
  privilegedCatalogWriters: 'controlled', workerProvisioning: 'withheld',
});
export const FENCE_COVERAGE = Object.freeze([
  'supabase_migrations.schema_migrations',
  'privacy_retention.g014_public_rpc_allowlist',
  'privacy_retention.g014_catalog_contract_manifest',
  'privacy_retention.assert_g014_workflow_owner_contract()',
  'privacy_retention.assert_g014_public_rpc_allowlist()',
  'privacy_retention.assert_g014_definer_contract()',
  'privacy_retention.assert_g014_catalog_contract()',
  'storage.buckets', 'storage.objects', 'thumbnail_control',
  'public.admin_thumbnail_workers', 'public.admin_thumbnail_jobs',
  'public.admin_thumbnail_events',
]);
const TOOLCHAIN = Object.freeze({
  [TLS_ROOT_PATH]: TLS_ROOT_SHA256,
  'apps/web/scripts/apply-supabase-migration.mjs': '02c404e0be3e81b7c8d4d7766ff29e750b1797f5ad49b5f496168170e21192d4',
  'apps/web/scripts/admin-record-sql-successor.mjs': 'c9b2c3335598bc21a5a721182ae45aae0d009be8684e7a1a2a0871e0cb921466',
  'apps/web/scripts/thumbnail-local-owner.mjs': '1a6e45cd3af10084799f5c5b0824abc99057ecd8fa6484da5282d105bc73afca',
  'apps/web/scripts/privacy-safe-cli-log.mjs': '23acce06424335d2d3597c236d7e5d30731b04d9f75fa75cff7a93bff0cc6e97',
});
const HEX = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
// This separate file is intentionally NOT created by the implementation. Its
// reviewed addition on protected main authorizes this one fixed migration.
// The historical draft remains immutable and executionEnabled=false.
export function thumbnailReleaseContract() {
  return {
    schema: 'thumbnail-production-successor-release-v2', executionEnabled: true,
    projectRef: PROJECT_REF, databaseName: 'postgres', executorRole: 'postgres', serverVersionNum: 170006,
    manifestPath: MANIFEST_PATH, manifestSha256: MANIFEST_SHA256,
    candidateSha256: '8019c4e7788cf6706094937a5d4111958201793192d918817e824791db471ac2',
    originalVectorSha256: '270ca9e0757641543f1d992ca526d2d9cb39324b4ebeb6b195a0b9f59226294e',
    repository: 'twoimo/tzudong', protectedRef: 'refs/heads/main',
    inspectionWorkflowPath: '.github/workflows/thumbnail-production-successor.yml',
    authority: OWNER_AUTHORITY, executionSurface: 'local-owner-cli',
    serializerKey: SERIALIZER_KEY, requiredFences: { ...REQUIRED_FENCES }, coverage: [...FENCE_COVERAGE],
    custodyScope: 'privileged-custody-until-reconciled', normalBusinessDmlMayContinue: true,
    custodyHomeAuthority: 'native-os-account',
    admissionLifetimeMs: 900_000, fenceAgeMs: 60_000, replayPolicy: 'reconcile-only-after-journal',
  };
}
export const RELEASE_ADMISSION_SHA256 = sha(bytes(thumbnailReleaseContract()));
export function validateThumbnailRelease(raw) {
  if (!Buffer.isBuffer(raw) || sha(raw) !== RELEASE_ADMISSION_SHA256
    || !equal(JSON.parse(raw), thumbnailReleaseContract())) fail('THUMBNAIL_RELEASE_ADMISSION_INVALID');
  return { sha256: RELEASE_ADMISSION_SHA256 };
}
export function loadThumbnailRelease() {
  if (!existsSync(resolve(REPOSITORY_ROOT, RELEASE_ADMISSION_PATH))) fail('THUMBNAIL_RELEASE_ADMISSION_REQUIRED');
  return validateThumbnailRelease(sourceBytes(RELEASE_ADMISSION_PATH, readFileSync));
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !equal(Object.keys(value).sort(), [...keys].sort())) fail('THUMBNAIL_ADMISSION_INVALID');
}
function date(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) fail('THUMBNAIL_ADMISSION_INVALID');
  return Date.parse(value);
}
function sourceBytes(path, readBytesImpl) {
  const absolute = resolve(REPOSITORY_ROOT, path);
  if (!absolute.startsWith(REPOSITORY_ROOT + sep) || realpathSync(absolute) !== absolute
    || !lstatSync(absolute).isFile()) fail('THUMBNAIL_SOURCE_DRIFT');
  return readBytesImpl(absolute);
}

export function loadThumbnailRecord({ readBytesImpl = readFileSync, readVectorImpl = readOriginalStatementVector } = {}) {
  const raw = sourceBytes(MANIFEST_PATH, readBytesImpl);
  if (sha(raw) !== MANIFEST_SHA256) fail('THUMBNAIL_MANIFEST_DRIFT');
  const manifest = JSON.parse(raw);
  if (manifest.schema !== 'thumbnail-production-installation-draft-v1'
    || manifest.status !== 'DRAFT_UNAPPLIED' || manifest.executionEnabled !== false
    || manifest.projectRef !== PROJECT_REF) fail('THUMBNAIL_MANIFEST_DRIFT');
  for (const component of manifest.components) {
    const actual = sourceBytes(component.path, readBytesImpl);
    if (actual.length !== component.bytes || sha(actual) !== component.sha256) fail('THUMBNAIL_COMPONENT_DRIFT');
  }
  for (const [path, digest] of Object.entries(TOOLCHAIN)) {
    if (sha(sourceBytes(path, readBytesImpl)) !== digest) fail('THUMBNAIL_TOOLCHAIN_DRIFT');
  }
  const migration = manifest.migration;
  const source = sourceBytes(migration.candidatePath, readBytesImpl);
  if (source.length !== migration.bytes || sha(source) !== migration.sha256) fail('THUMBNAIL_SOURCE_DRIFT');
  // The official parser reads the candidate; the compiler retains the future ledger identity.
  const vector = readVectorImpl({ ...migration, path: migration.candidatePath }, source);
  if (vector.length !== migration.statementCount
    || sha(JSON.stringify(vector)) !== migration.originalVectorSha256) fail('THUMBNAIL_VECTOR_DRIFT');
  const envelope = migrationEnvelope(source, migration, vector);
  return { manifest, manifestSha256: MANIFEST_SHA256, migration, envelope };
}

export function createThumbnailPsqlRunner(databaseUrl, { environment = process.env, spawnImpl = spawnSync } = {}) {
  assertSuccessorDatabaseTarget(databaseUrl, { projectRef: PROJECT_REF, databaseName: 'postgres' });
  return createSuccessorPsqlRunner(databaseUrl, {
    environment, psql: 'psql',
    spawnImpl: (command, args, options) => {
      // The common transport clears inherited PG settings. Bind trust after
      // that cleanup; never change the user's default libpq trust store.
      if (sha(sourceBytes(TLS_ROOT_PATH, readFileSync)) !== TLS_ROOT_SHA256) fail('THUMBNAIL_TLS_ROOT_DRIFT');
      return spawnImpl(command, args, { ...options, env: {
        ...options.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: resolve(REPOSITORY_ROOT, TLS_ROOT_PATH),
      } });
    },
  });
}

function privateBytes(path, { journal = false } = {}) {
  if (realpathSync(path) !== resolve(path)) fail('THUMBNAIL_CUSTODY_INVALID');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128 * 1024 || (stat.mode & 0o077)
      || (journal && (stat.mode & 0o777) !== 0o600)
      || stat.uid !== process.getuid()) fail('THUMBNAIL_CUSTODY_INVALID');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function custodyPaths(directory) {
  const absolute = resolve(directory);
  const rel = relative(REPOSITORY_ROOT, absolute);
  const stat = lstatSync(absolute);
  if (realpathSync(absolute) !== absolute || !stat.isDirectory() || stat.isSymbolicLink()
    || (stat.mode & 0o077) || stat.uid !== process.getuid()
    || (!rel.startsWith('..' + sep) && rel !== '..')) fail('THUMBNAIL_CUSTODY_INVALID');
  return { admission: join(absolute, 'admission.json'), fence: join(absolute, 'writer-fence.json'), journal: join(absolute, 'apply-journal.jsonl') };
}
function privateJson(path) {
  const raw = privateBytes(path);
  const value = JSON.parse(raw);
  if (!raw.equals(bytes(value))) fail('THUMBNAIL_CUSTODY_INVALID');
  return { value, raw };
}

export function validateThumbnailAdmission(admission, fence, fenceBytes, record, now, { reconciliation = false } = {}) {
  exactKeys(admission, [
    'kind', 'attemptId', 'projectRef', 'databaseName', 'executorRole', 'serverVersionNum',
    'manifestSha256', 'releaseAdmissionSha256', 'sourceSha256', 'vectorSha256', 'sourceRevision',
    'createdAt', 'expiresAt', 'writerFenceSha256',
  ]);
  if (admission.kind !== 'thumbnail-production-admission-v2' || !UUID.test(admission.attemptId)
    || admission.projectRef !== PROJECT_REF || admission.databaseName !== 'postgres'
    || admission.executorRole !== 'postgres' || admission.serverVersionNum !== 170006
    || admission.manifestSha256 !== record.manifestSha256
    || admission.releaseAdmissionSha256 !== RELEASE_ADMISSION_SHA256
    || admission.sourceSha256 !== record.migration.sha256
    || admission.vectorSha256 !== record.migration.originalVectorSha256
    || !REVISION.test(admission.sourceRevision) || sha(fenceBytes) !== admission.writerFenceSha256) {
    fail('THUMBNAIL_ADMISSION_INVALID');
  }
  const created = date(admission.createdAt), expires = date(admission.expiresAt);
  if (expires <= created || expires - created > 15 * 60_000) fail('THUMBNAIL_ADMISSION_INVALID');
  exactKeys(fence, [
    'kind', 'authority', 'projectRef', 'sourceRevision', 'manifestSha256', 'observedAt',
    'expiresAt', 'operationId', 'ownerObservation', 'fences', 'coverage', 'evidenceSha256',
  ]);
  if (fence.kind !== 'thumbnail-writer-fence-readback-v2'
    || fence.authority !== OWNER_AUTHORITY
    || fence.projectRef !== PROJECT_REF || fence.sourceRevision !== admission.sourceRevision
    || fence.manifestSha256 !== record.manifestSha256 || fence.expiresAt !== admission.expiresAt
    || fence.operationId !== admission.attemptId
    || !equal(fence.fences, REQUIRED_FENCES) || !equal(fence.coverage, FENCE_COVERAGE)
    || !equal(Object.keys(fence.evidenceSha256 ?? {}).sort(), Object.keys(REQUIRED_FENCES).sort())
    || Object.values(fence.evidenceSha256).some(value => !HEX.test(value))) fail('THUMBNAIL_FENCE_INVALID');
  const observed = date(fence.observedAt);
  if (observed < created || observed >= expires) fail('THUMBNAIL_FENCE_INVALID');
  if (!reconciliation) {
    if (!Number.isFinite(now.getTime()) || now.getTime() < created || now.getTime() >= expires) fail('THUMBNAIL_ADMISSION_EXPIRED');
    if (observed > now.getTime() || now.getTime() - observed > 60_000) fail('THUMBNAIL_FENCE_STALE');
  }
  try {
    validateThumbnailLocalOwner(fence.ownerObservation, {
      sourceRevision: admission.sourceRevision, operationId: admission.attemptId,
      now: reconciliation ? new Date(fence.ownerObservation?.observedAt) : now,
    });
  } catch { fail('THUMBNAIL_FENCE_INVALID'); }
  if (date(fence.ownerObservation.observedAt) < created
    || date(fence.ownerObservation.observedAt) > observed) fail('THUMBNAIL_FENCE_INVALID');
}

// The SQL's actual prior/locks/G014/readback enforce the machine boundary.
// These separate receipts attest only to the trusted owner's control of
// privileged contract changes and withholding worker provisioning. They do not
// claim that ordinary DML, uploads or processes were observed to be stopped.
function readFenceEvidence(directory, admission, fence, now, { reconciliation = false } = {}) {
  for (const [name, state] of Object.entries(REQUIRED_FENCES)) {
    const { value, raw } = privateJson(join(directory, 'writer-fence-' + name + '.json'));
    if (sha(raw) !== fence.evidenceSha256[name]) fail('THUMBNAIL_FENCE_EVIDENCE_DRIFT');
    exactKeys(value, [
      'kind', 'fence', 'state', 'projectRef', 'sourceRevision', 'manifestSha256',
      'operationId', 'observedAt', 'scope', 'coverage', 'basis',
    ]);
    if (value.kind !== 'thumbnail-writer-observation-v2' || value.fence !== name || value.state !== state
      || value.projectRef !== PROJECT_REF || value.sourceRevision !== admission.sourceRevision
      || value.manifestSha256 !== MANIFEST_SHA256 || value.operationId !== admission.attemptId
      || value.scope !== 'privileged-custody-until-reconciled' || !equal(value.coverage, FENCE_COVERAGE)
      || value.basis !== 'authenticated-owner-custody') fail('THUMBNAIL_FENCE_EVIDENCE_INVALID');
    const observed = date(value.observedAt);
    if (observed < date(admission.createdAt) || observed > date(fence.observedAt)
      || (!reconciliation && (observed > now.getTime() || now.getTime() - observed > 60_000))) {
      fail('THUMBNAIL_FENCE_STALE');
    }
  }
}

function git(args) {
  const result = spawnSync('/usr/bin/git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8', timeout: 15_000 });
  if (result.error || result.status !== 0) fail('THUMBNAIL_SOURCE_UNVERIFIED');
  return result.stdout.trim();
}
export function currentThumbnailSource() {
  return {
    revision: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain']) === '',
    detached: git(['rev-parse', '--abbrev-ref', 'HEAD']) === 'HEAD',
    origin: git(['remote', 'get-url', 'origin']),
  };
}
export function currentThumbnailProtectedRevision() {
  const result = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const match = /^([a-f0-9]{40})\trefs\/heads\/main$/.exec(result);
  if (!match) fail('THUMBNAIL_SOURCE_UNVERIFIED');
  return match[1];
}
export function validateThumbnailLiveSource(admission, source, protectedRevision) {
  if (source.revision !== admission.sourceRevision || !source.clean || !source.detached
    || source.origin !== 'https://github.com/twoimo/tzudong.git'
    || protectedRevision !== admission.sourceRevision) fail('THUMBNAIL_SOURCE_DRIFT');
}
const IDENTITY_GUARD = "DO $thumbnail_identity$ BEGIN IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres' OR current_setting('server_version_num')::integer<>170006 OR current_setting('is_superuser')<>'off' THEN RAISE EXCEPTION 'THUMBNAIL_DATABASE_IDENTITY_DRIFT'; END IF; END $thumbnail_identity$;";
function expiryGuard(admission) {
  return "DO $thumbnail_expiry$ BEGIN IF clock_timestamp()>=" + quote(admission.expiresAt) + "::timestamptz THEN RAISE EXCEPTION 'THUMBNAIL_ADMISSION_EXPIRED'; END IF; END $thumbnail_expiry$;";
}
export function thumbnailApplySql(record, admission) {
  // This caller owns the common lock in the SAME transaction, not a second outer session.
  return "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='120s';\n"
    + 'DO $thumbnail_serializer$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('
    + quote(SERIALIZER_KEY) + ',0)); END $thumbnail_serializer$;\n'
    + IDENTITY_GUARD + '\n' + expiryGuard(admission) + '\n'
    + atomicMigrationSql(record.envelope, record.migration) + '\n' + expiryGuard(admission) + '\n';
}
function parseResult(output) {
  const lines = output.split(/\r?\n/).filter(line => line.trim());
  if (lines.length !== 1) fail('THUMBNAIL_READBACK_INVALID');
  const value = JSON.parse(lines[0]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('THUMBNAIL_READBACK_INVALID');
  return value;
}
export function readThumbnailPrior(transport, databaseUrl, record) {
  const observed = parseResult(transport(databaseUrl,
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + IDENTITY_GUARD + '\n'
    + record.migration.expectedPriorState.query, true));
  if (!equal(observed, record.migration.expectedPriorState.expected)) fail('THUMBNAIL_PRIOR_STATE_DRIFT');
  return observed;
}
function readReconciliation(transport, databaseUrl, record) {
  const query = reconciliationSql(record.envelope, record.migration);
  const sql = 'SET TRANSACTION READ ONLY;\n' + IDENTITY_GUARD + '\n'
    + query.replace('SET TRANSACTION READ ONLY;', '');
  try {
    const outcome = reconciliationOutcome(parseResult(transport(databaseUrl, sql, true)), record.migration);
    // An independent MVCC snapshot can still see the prior state while the
    // original backend is running or its COMMIT has not become visible. This
    // observation does not prove rollback, terminality, or permission to resume
    // writers. Keep the generic compiler's historical enum local to its API.
    return outcome === 'not_applied' ? 'prior_observed' : outcome;
  }
  catch { return 'unknown'; }
}
function writeAll(fd, raw, writeImpl = writeSync) {
  let offset = 0;
  while (offset < raw.length) {
    const n = writeImpl(fd, raw, offset, raw.length - offset);
    if (!Number.isSafeInteger(n) || n <= 0) fail('THUMBNAIL_JOURNAL_UNCONFIRMED');
    offset += n;
  }
}
function journalStart(path, entry, fsyncImpl) {
  let fd;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    assertJournalDescriptor(fd);
    writeAll(fd, bytes(entry));
    fsyncImpl(fd);
    const parent = openSync(dirname(path), constants.O_RDONLY);
    try { fsyncImpl(parent); } finally { closeSync(parent); }
    return fd;
  } catch {
    if (fd !== undefined) closeSync(fd);
    // Preserve any created file. An uncertain publication never permits resend.
    fail('THUMBNAIL_JOURNAL_UNCONFIRMED');
  }
}
export function appendThumbnailJournal(fd, entry, { fsyncImpl = fsyncSync } = {}) {
  assertJournalDescriptor(fd);
  writeAll(fd, bytes(entry));
  fsyncImpl(fd);
}
function assertJournalDescriptor(fd) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()
    || (stat.mode & 0o777) !== 0o600 || stat.size > 128 * 1024) fail('THUMBNAIL_JOURNAL_UNCONFIRMED');
}

export function runThumbnailSuccessor({ mode = 'inspect', environment = process.env } = {}, dependencies = {}) {
  if (!['inspect', 'apply', 'reconcile'].includes(mode)) fail('THUMBNAIL_ARGUMENT_INVALID');
  const {
    loadRecordImpl = loadThumbnailRecord, loadReleaseImpl = loadThumbnailRelease,
    custodyDirectory = CUSTODY_DIRECTORY,
    now = () => new Date(), sourceImpl = currentThumbnailSource,
    protectedRevisionImpl = currentThumbnailProtectedRevision,
    attestationImpl = observeThumbnailLocalOwner, runPsqlImpl,
    fsyncImpl = fsyncSync, appendJournalImpl = appendThumbnailJournal,
  } = dependencies;
  const record = loadRecordImpl();
  if (mode === 'inspect') return {
    status: 'held', executionEnabled: record.manifest.executionEnabled,
    manifestSha256: record.manifestSha256, sourceSha256: record.migration.sha256,
    vectorSha256: record.envelope.vectorSha256, statementCount: record.envelope.originalVector.length,
  };
  // Production only accepts the distinct fixed release file. Tests inject its
  // loader while still exercising validateThumbnailRelease with exact bytes.
  const release = loadReleaseImpl();
  if (release.sha256 !== RELEASE_ADMISSION_SHA256) fail('THUMBNAIL_RELEASE_ADMISSION_INVALID');
  const paths = custodyPaths(custodyDirectory);
  // A fixed project+manifest custody path, not a caller-chosen per-attempt journal.
  if (mode === 'apply' && existsSync(paths.journal)) fail('THUMBNAIL_RECONCILE_REQUIRED');
  const { value: admission, raw: admissionBytes } = privateJson(paths.admission);
  const { value: fence, raw: fenceBytes } = privateJson(paths.fence);
  validateThumbnailAdmission(admission, fence, fenceBytes, record, now(), { reconciliation: mode === 'reconcile' });
  readFenceEvidence(custodyDirectory, admission, fence, now(), { reconciliation: mode === 'reconcile' });
  const revalidate = () => {
    if (!privateBytes(paths.admission).equals(admissionBytes) || !privateBytes(paths.fence).equals(fenceBytes)) {
      fail('THUMBNAIL_FENCE_EVIDENCE_DRIFT');
    }
    if (loadReleaseImpl().sha256 !== release.sha256) fail('THUMBNAIL_RELEASE_ADMISSION_INVALID');
    const current = loadRecordImpl();
    if (current.manifestSha256 !== record.manifestSha256
      || current.migration.sha256 !== record.migration.sha256
      || current.envelope.vectorSha256 !== record.envelope.vectorSha256) fail('THUMBNAIL_SOURCE_DRIFT');
    validateThumbnailLiveSource(admission, sourceImpl(), protectedRevisionImpl());
    validateThumbnailAdmission(admission, fence, fenceBytes, record, now());
    readFenceEvidence(custodyDirectory, admission, fence, now());
  };
  const sql = thumbnailApplySql(record, admission);
  const binding = {
    event: 'started', attemptId: admission.attemptId, admissionSha256: sha(admissionBytes),
    manifestSha256: record.manifestSha256, releaseAdmissionSha256: release.sha256,
    sourceRevision: admission.sourceRevision, sqlSha256: sha(sql),
  };
  if (mode === 'reconcile') {
    // A partial terminal append may exist. Only the complete durable first line grants read-only reconciliation.
    const first = privateBytes(paths.journal, { journal: true }).toString('utf8').split('\n')[0];
    if (!equal(JSON.parse(first), binding)) fail('THUMBNAIL_JOURNAL_BINDING_INVALID');
    const owner = attestationImpl({ environment, clock: now, operationId: admission.attemptId });
    // Authenticate the current owner without rebinding the historical attempt
    // to a main commit that may have advanced since its original admission.
    validateThumbnailLocalOwner(owner, { sourceRevision: owner.sourceRevision, now: now(), operationId: admission.attemptId });
  } else {
    validateThumbnailLiveSource(admission, sourceImpl(), protectedRevisionImpl());
    const owner = attestationImpl({ environment, clock: now, operationId: admission.attemptId });
    validateThumbnailLocalOwner(owner, { sourceRevision: admission.sourceRevision, now: now(), operationId: admission.attemptId });
  }
  const { databaseUrl } = selectDirectDatabaseTransport(environment);
  assertSuccessorDatabaseTarget(databaseUrl, { projectRef: PROJECT_REF, databaseName: 'postgres' });
  const transport = runPsqlImpl ?? createThumbnailPsqlRunner(databaseUrl, { environment });
  if (mode === 'reconcile') return {
    status: 'reconciliation', disposition: readReconciliation(transport, databaseUrl, record),
    attemptId: admission.attemptId, replayAllowed: false,
  };
  readThumbnailPrior(transport, databaseUrl, record);
  revalidate();
  const fd = journalStart(paths.journal, binding, fsyncImpl);
  let acknowledged = false, outcome = 'unknown', code;
  try {
    // Recheck after durable publication too; even a pre-send failure consumes this attempt.
    revalidate();
    try {
      const terminal = parseResult(transport(databaseUrl, sql, true));
      acknowledged = equal(terminal, record.migration.terminalReadback.expected);
    } catch { /* no resend, including a lost COMMIT acknowledgement */ }
    outcome = readReconciliation(transport, databaseUrl, record);
    code = acknowledged && outcome === 'committed' ? 'THUMBNAIL_COMMITTED'
      : outcome === 'partial_conflict' ? 'THUMBNAIL_RECONCILIATION_CONFLICT'
        : 'THUMBNAIL_OUTCOME_UNCONFIRMED';
  } catch { code = 'THUMBNAIL_OUTCOME_UNCONFIRMED'; }
  try { appendJournalImpl(fd, { event: 'terminal', code, disposition: outcome, attemptId: admission.attemptId }, { fsyncImpl }); }
  catch { fail('THUMBNAIL_JOURNAL_UNCONFIRMED'); }
  finally { closeSync(fd); }
  if (code !== 'THUMBNAIL_COMMITTED') fail(code);
  return { status: 'committed', code, attemptId: admission.attemptId, replayAllowed: false };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--mode') fail('THUMBNAIL_ARGUMENT_INVALID');
  // No path, manifest, readiness, validation, transport or dependency override is exposed.
  return runThumbnailSuccessor({ mode: argv[1] });
}
if (import.meta.url === 'file://' + process.argv[1]) {
  try { console.log(JSON.stringify(main())); }
  catch (error) {
    const code = /^THUMBNAIL_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'THUMBNAIL_OPERATION_FAILED';
    console.error(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  }
}
