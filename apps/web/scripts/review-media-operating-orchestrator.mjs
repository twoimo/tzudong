#!/usr/bin/env node
/**
 * Supported split-authority operating runner for the review-media SQL successor.
 *
 * `capture-vercel` runs locally with the existing Vercel CLI/admin session and
 * emits only a source-bound, sanitized bundle. `operate` accepts that bundle
 * only inside an authenticated repository-owner workflow_dispatch, captures
 * the GitHub/DB observations available in Actions, binds the four operator
 * custody attestations separately, and delegates admission/rehearsal/apply to
 * the existing controllers.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureAdminRecordMutationsHold,
  captureAutomaticReviewer,
  captureCurrentProductionRollback,
  captureG037WriteFreeze,
  captureGitEvidence,
  createAdminRecordMutationsHoldProbeTransport,
  createGithubVariableTransport,
  createOwnerDatabaseReadback,
} from './review-media-operating-capture.mjs';
import {
  prepareReviewMediaApplyAdmission,
  prepareReviewMediaRehearsalAdmission,
} from './review-media-operating-admission.mjs';
import {
  REPOSITORY_ROOT,
  assertLaunchReady,
  assertSuccessorDatabaseTarget,
  currentProtectedMainReadback,
  loadSuccessorManifest,
  runReviewMediaSuccessor,
  runReviewMediaSuccessorRehearsal,
  successorFailureResult,
} from './review-media-sql-successor.mjs';
import {
  runPsql,
  selectDirectDatabaseTransport,
} from './apply-supabase-migration.mjs';
import {
  TZUDONG_GITHUB_REPOSITORY,
  TZUDONG_PRODUCTION_ALIASES,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  createScopedVercelApiTransport,
} from './vercel-rollback-readback.mjs';
import {
  STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
  fetchLiveStoryboardCompatibilityAliases,
  observeStoryboardRuntimeCompatibilityAliases,
} from './observe-storyboard-runtime-compatibility.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CAPTURE_WINDOW_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL_ID = /^[1-9][0-9]*$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;

export const OPERATOR_FENCES = Object.freeze([
  'browserRpc',
  'dashboard',
  'directSql',
  'providerIngress',
]);

export const QUIESCENCE_RELATIONS = Object.freeze([
  'pipeline_control.admin_record_media_cleanup',
  'pipeline_control.admin_record_operations',
  'public.reviews',
  'storage.objects',
]);

const PROVENANCE_FILES = Object.freeze({
  attestation: 'operator-custody-attestation.json',
  input: 'operating-admission-input.json',
  machine: 'machine-operating-observations.json',
  map: 'operating-evidence-map.json',
  vercel: 'vercel-operating-bundle.json',
});

const APPLY_PROVENANCE_FILES = Object.freeze({
  map: 'apply-operating-evidence-map.json',
  machine: 'apply-machine-operating-observations.json',
  quiescence: 'apply-quiescence-readback.json',
});
const applyWriterFenceFile = fence => `apply-writer-fence-${fence}.json`;

const PUBLIC_CODES = new Set([
  'SUCCESSOR_LAUNCH_HELD',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_ATTESTATION_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_STALE',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_COVERAGE_UNPROVED',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_DB_AUTHORITY_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_OUTPUT_EXISTS',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_ROLLBACK_POLICY_UNPROVED',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_SOURCE_MISMATCH',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID',
  'SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED',
]);

export const ADMIN_IN_FLIGHT_QUIESCENCE_SQL = String.raw`
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='2s';
LOCK TABLE
  pipeline_control.admin_record_media_cleanup,
  pipeline_control.admin_record_operations,
  public.reviews,
  storage.objects
IN SHARE MODE NOWAIT;
WITH covered(relid, relation_name) AS (
  VALUES
    ('pipeline_control.admin_record_media_cleanup'::regclass,'pipeline_control.admin_record_media_cleanup'),
    ('pipeline_control.admin_record_operations'::regclass,'pipeline_control.admin_record_operations'),
    ('public.reviews'::regclass,'public.reviews'),
    ('storage.objects'::regclass,'storage.objects')
), writer_intent AS (
  SELECT count(*)::int AS count
  FROM pg_catalog.pg_locks AS held
  JOIN covered ON covered.relid=held.relation
  WHERE held.pid<>pg_backend_pid()
    AND held.mode IN (
      'RowShareLock','RowExclusiveLock','ShareUpdateExclusiveLock',
      'ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock'
    )
)
SELECT jsonb_build_object(
  'coverage',(SELECT jsonb_agg(relation_name ORDER BY relation_name) FROM covered),
  'inFlightWriters',(SELECT count FROM writer_intent),
  'lockMode','SHARE'
)::text;
ROLLBACK;
`;

export class OperatingOrchestratorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OperatingOrchestratorError';
    this.code = code;
  }
}

const fail = code => { throw new OperatingOrchestratorError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function safeCode(error) {
  try { return typeof error?.code === 'string' ? error.code : ''; } catch { return ''; }
}

function exactObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, code) {
  if (!exactObject(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(code);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalBytes = value => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function assertDate(value, code = 'SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID') {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail(code);
  return value;
}

function assertOutsideRepository(path, code, { mustExist = true } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  let comparison;
  try {
    comparison = mustExist ? realpathSync(absolute) : realpathSync(dirname(absolute));
  } catch {
    fail(code);
  }
  const repository = realpathSync(REPOSITORY_ROOT);
  const rel = relative(repository, comparison);
  if (!rel || (rel !== '..' && !rel.startsWith(`..${sep}`))) fail(code);
  return absolute;
}

function assertPrivateDirectory(path, code) {
  let status;
  try { status = lstatSync(path); } catch { fail(code); }
  if (!status.isDirectory()
    || status.isSymbolicLink()
    || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) fail(code);
  return realpathSync(path);
}

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (safeCode(error) === 'ENOENT') return false;
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID');
  }
}

function readBoundedDescriptor(descriptor, status, code) {
  if (!Number.isSafeInteger(status.size)
    || status.size <= 0
    || status.size > MAX_PRIVATE_FILE_BYTES) fail(code);
  const bytes = Buffer.allocUnsafe(status.size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
    if (!Number.isSafeInteger(count) || count < 0) fail(code);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== status.size || fstatSync(descriptor).size !== status.size) fail(code);
  return bytes.subarray(0, offset);
}

function readPrivateCanonicalJson(path, code = 'SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID') {
  const absolute = assertOutsideRepository(path, code);
  const parent = assertPrivateDirectory(dirname(absolute), code);
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const status = fstatSync(descriptor);
    const named = lstatSync(absolute);
    if (!status.isFile()
      || named.isSymbolicLink()
      || status.dev !== named.dev
      || status.ino !== named.ino
      || dirname(realpathSync(absolute)) !== parent
      || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) fail(code);
    const bytes = readBoundedDescriptor(descriptor, status, code);
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { fail(code); }
    const expected = canonicalBytes(value);
    if (!exactObject(value)
      || (!bytes.equals(expected) && !bytes.equals(expected.subarray(0, expected.length - 1)))) {
      fail(code);
    }
    return Object.freeze({ bytes, path: absolute, value });
  } catch (error) {
    if (safeCode(error) === code) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* read outcome is already bounded */ }
    }
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(written) || written <= 0) {
      fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED');
    }
    offset += written;
  }
}

function syncDirectory(path, fsyncImpl = fsyncSync) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    fsyncImpl(descriptor);
  } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded above */ }
    }
  }
}

function writeExclusiveCanonical(path, value, fsyncImpl = fsyncSync) {
  const absolute = assertOutsideRepository(
    path,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
    { mustExist: false },
  );
  const parent = assertPrivateDirectory(
    dirname(absolute),
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  );
  const bytes = canonicalBytes(value);
  if (bytes.length === 0 || bytes.length > MAX_PRIVATE_FILE_BYTES) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED');
  }
  let descriptor;
  try {
    descriptor = openSync(absolute, 'wx', 0o600);
    writeAll(descriptor, bytes);
    fsyncImpl(descriptor);
  } catch (error) {
    if (safeCode(error) === 'EEXIST') fail('SUCCESSOR_OPERATING_ORCHESTRATOR_OUTPUT_EXISTS');
    if (safeCode(error).startsWith('SUCCESSOR_OPERATING_ORCHESTRATOR_')) throw error;
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* fsync established the bounded outcome */ }
    }
  }
  syncDirectory(parent, fsyncImpl);
  return Object.freeze({ bytes, path: absolute, sha256: sha256(bytes) });
}

function createExclusivePrivateDirectory(path, fsyncImpl = fsyncSync) {
  const absolute = assertOutsideRepository(
    path,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
    { mustExist: false },
  );
  assertPrivateDirectory(
    dirname(absolute),
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  );
  try {
    mkdirSync(absolute, { mode: 0o700 });
  } catch (error) {
    if (safeCode(error) === 'EEXIST') fail('SUCCESSOR_OPERATING_ORCHESTRATOR_OUTPUT_EXISTS');
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WRITE_FAILED');
  }
  const custody = assertPrivateDirectory(
    absolute,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  );
  syncDirectory(dirname(custody), fsyncImpl);
  return custody;
}

function parseBoundedJson(raw, code) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) fail(code);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > MAX_PRIVATE_FILE_BYTES) fail(code);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!exactObject(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof OperatingOrchestratorError) throw error;
    fail(code);
  }
}

function assertWindow(createdAtValue, expiresAtValue, now, observations = []) {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  const nowMs = assertDate(now, 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_STALE').getTime();
  if (!Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || expiresAt - createdAt !== CAPTURE_WINDOW_MS
    || createdAt > nowMs + CLOCK_SKEW_MS
    || nowMs >= expiresAt
    || observations.some(value => {
      const observed = Date.parse(value);
      return !Number.isFinite(observed)
        || observed < createdAt
        || observed >= expiresAt
        || observed > nowMs + CLOCK_SKEW_MS;
    })) fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_STALE');
  return Object.freeze({ createdAt, expiresAt, nowMs });
}

function commonReceipt(manifestRecord, sourceRevision, expiresAt, observedAt) {
  return {
    expiresAt,
    id: manifestRecord.manifest.id,
    manifestSha256: manifestRecord.manifestSha256,
    observedAt,
    projectRef: manifestRecord.manifest.projectRef,
    purpose: manifestRecord.manifest.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
}

function writerFenceReceipt(
  fence,
  state,
  observedAt,
  manifestRecord,
  sourceRevision,
  expiresAt,
) {
  return Object.freeze({
    ...commonReceipt(manifestRecord, sourceRevision, expiresAt, observedAt),
    fence,
    kind: 'writer-fence-readback-receipt',
    state,
  });
}

function rollbackReceipt(readback, manifestRecord, sourceRevision, expiresAt) {
  return Object.freeze({
    ...commonReceipt(manifestRecord, sourceRevision, expiresAt, readback.observedAt),
    deploymentId: readback.deploymentId,
    deploymentSha: readback.gitSha,
    deploymentUrl: readback.deploymentUrl,
    gitRef: readback.gitRef,
    kind: 'rollback-readback-receipt',
    productionAliases: [...readback.productionAliases],
    projectId: readback.projectId,
    readyState: readback.readyState,
    repository: readback.repository,
    state: 'ready',
    target: readback.target,
    teamId: readback.teamId,
  });
}

function validateRollbackReadback(readback, bundle) {
  exactKeys(readback, [
    'deploymentId', 'deploymentUrl', 'gitRef', 'gitSha', 'kind', 'observedAt',
    'productionAliases', 'projectId', 'readyState', 'repository', 'schemaVersion',
    'target', 'teamId',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  if (readback.schemaVersion !== 1
    || readback.kind !== 'vercel-rollback-readback'
    || !DEPLOYMENT_ID.test(readback.deploymentId ?? '')
    || !REVISION.test(readback.gitSha ?? '')
    || readback.gitRef !== 'main'
    || readback.projectId !== TZUDONG_VERCEL_PROJECT_ID
    || readback.teamId !== TZUDONG_VERCEL_TEAM_ID
    || readback.repository !== TZUDONG_GITHUB_REPOSITORY
    || readback.readyState !== 'READY'
    || readback.target !== 'production'
    || !equal(readback.productionAliases, TZUDONG_PRODUCTION_ALIASES)) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  let url;
  try { url = new URL(readback.deploymentUrl); } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
    || bundle.adminRecordMutationsHold.commit !== readback.gitSha
    || bundle.adminRecordMutationsHold.deploymentId !== readback.deploymentId) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
}

function validateStoryboardCompatibilityReadback(readback, code) {
  exactKeys(readback, [
    'aliasRoutes', 'canonicalPolicySha256', 'commit', 'deploymentId', 'kind', 'schemaVersion',
  ], code);
  if (readback.schemaVersion !== 1
    || readback.kind !== 'storyboard-runtime-compatibility-alias-set-readback'
    || !validStoryboardAliasRoutes(readback.aliasRoutes)
    || !DEPLOYMENT_ID.test(readback.deploymentId ?? '')
    || !REVISION.test(readback.commit ?? '')
    || !SHA256.test(readback.canonicalPolicySha256 ?? '')) fail(code);
  return readback;
}

function validStoryboardAliasRoutes(routes) {
  if (!Array.isArray(routes) || routes.length !== TZUDONG_PRODUCTION_ALIASES.length) return false;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    if (!exactObject(route)
      || !equal(Object.keys(route).sort(), ['productionAlias', 'redirectTarget', 'route'].sort())
      || route.productionAlias !== TZUDONG_PRODUCTION_ALIASES[index]) return false;
  }
  const apex = routes[0];
  const canonical = routes[1];
  return canonical.route === 'direct' && canonical.redirectTarget === null
    && ((apex.route === 'direct' && apex.redirectTarget === null)
      || (apex.route === 'redirect'
        && apex.redirectTarget === STORYBOARD_PRODUCTION_COMPATIBILITY_URLS[1]));
}

function validateStoryboardPolicy(storyboardPolicy, bundle, code) {
  exactKeys(storyboardPolicy, ['deployment', 'policy', 'schemaVersion'], code);
  exactKeys(storyboardPolicy.deployment, [
    'branch', 'deploymentId', 'sourceCommit',
  ], code);
  exactKeys(storyboardPolicy.policy, ['canonicalPolicySha256'], code);
  if (storyboardPolicy.schemaVersion !== 1
    || storyboardPolicy.deployment.branch !== 'main'
    || !DEPLOYMENT_ID.test(storyboardPolicy.deployment.deploymentId ?? '')
    || !REVISION.test(storyboardPolicy.deployment.sourceCommit ?? '')
    || !SHA256.test(storyboardPolicy.policy.canonicalPolicySha256 ?? '')
    || storyboardPolicy.deployment.deploymentId !== bundle.adminRecordMutationsHold.deploymentId
    || storyboardPolicy.deployment.deploymentId !== bundle.rollbackReadback.deploymentId
    || storyboardPolicy.deployment.sourceCommit !== bundle.adminRecordMutationsHold.commit
    || storyboardPolicy.deployment.sourceCommit !== bundle.rollbackReadback.gitSha) fail(code);
}

function storyboardPolicyFromRuntimeReadback(readback, rollbackReadback) {
  validateStoryboardCompatibilityReadback(
    readback,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID',
  );
  if (readback.deploymentId !== rollbackReadback.deploymentId
    || readback.commit !== rollbackReadback.gitSha) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  return Object.freeze({
    deployment: Object.freeze({
      branch: 'main',
      deploymentId: readback.deploymentId,
      sourceCommit: readback.commit,
    }),
    policy: Object.freeze({ canonicalPolicySha256: readback.canonicalPolicySha256 }),
    schemaVersion: 1,
  });
}

function validateRuntimeCompatibilityObservation(observation, bundle, bundleSha256) {
  exactKeys(observation, [
    'aliasRoutes', 'bundleSha256', 'canonicalPolicySha256', 'commit', 'deploymentId', 'kind',
    'schemaVersion',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  if (observation.schemaVersion !== 1
    || observation.kind !== 'storyboard-runtime-compatibility-alias-set-observation'
    || !validStoryboardAliasRoutes(observation.aliasRoutes)
    || observation.bundleSha256 !== bundleSha256
    || observation.deploymentId !== bundle.storyboardPolicy.deployment.deploymentId
    || observation.commit !== bundle.storyboardPolicy.deployment.sourceCommit
    || observation.canonicalPolicySha256 !== bundle.storyboardPolicy.policy.canonicalPolicySha256) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  return observation;
}

export async function createRuntimeVerifiedRollbackReadback({
  bundle,
  bundleSha256,
  fetchImpl,
  observeRuntimeCompatibilityImpl = observeStoryboardRuntimeCompatibilityAliases,
  urls = STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
} = {}) {
  if (!exactObject(bundle)
    || !SHA256.test(bundleSha256 ?? '')
    || typeof observeRuntimeCompatibilityImpl !== 'function') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  let observation;
  try {
    observation = await observeRuntimeCompatibilityImpl({
      bundle,
      bundleSha256,
      fetchImpl,
      urls,
    });
  } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  validateRuntimeCompatibilityObservation(observation, bundle, bundleSha256);
  return () => bundle.rollbackReadback;
}

export function validateLocalVercelBundle({
  bundle,
  manifestRecord,
  now = new Date(),
  sourceRevision,
} = {}) {
  exactKeys(bundle, [
    'adminRecordMutationsHold', 'createdAt', 'expiresAt', 'kind', 'manifestSha256',
    'protectedMain', 'rollbackPolicy', 'rollbackReadback', 'schemaVersion', 'sourceRevision',
    'sourceRoot', 'storyboardPolicy',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  if (bundle.schemaVersion !== 1
    || bundle.kind !== 'review-media-successor-vercel-operating-bundle'
    || bundle.manifestSha256 !== manifestRecord?.manifestSha256
    || bundle.sourceRoot !== manifestRecord?.manifest?.sourceRoot
    || bundle.sourceRevision !== sourceRevision
    || !REVISION.test(bundle.sourceRevision ?? '')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_SOURCE_MISMATCH');
  }
  exactKeys(bundle.protectedMain, [
    'projectRef', 'ref', 'remote', 'repositoryUrl', 'revision', 'schemaVersion',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  const expected = manifestRecord.manifest.protectedSource;
  if (bundle.protectedMain.schemaVersion !== 1
    || bundle.protectedMain.projectRef !== manifestRecord.manifest.projectRef
    || bundle.protectedMain.ref !== expected.ref
    || bundle.protectedMain.remote !== expected.remote
    || bundle.protectedMain.repositoryUrl !== expected.repositoryUrl
    || bundle.protectedMain.revision !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_SOURCE_MISMATCH');
  }
  exactKeys(bundle.adminRecordMutationsHold, [
    'commit', 'deploymentId', 'holdActive', 'observedAt',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  if (bundle.adminRecordMutationsHold.holdActive !== true
    || !REVISION.test(bundle.adminRecordMutationsHold.commit ?? '')
    || !DEPLOYMENT_ID.test(bundle.adminRecordMutationsHold.deploymentId ?? '')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  validateRollbackReadback(bundle.rollbackReadback, bundle);
  validateStoryboardPolicy(
    bundle.storyboardPolicy,
    bundle,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID',
  );
  exactKeys(bundle.rollbackPolicy, [
    'basis', 'deploymentSha', 'kind', 'sourceRevision', 'state',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_ROLLBACK_POLICY_UNPROVED');
  if (bundle.rollbackPolicy.kind !== 'storyboard-rollback-policy-readback'
    || bundle.rollbackPolicy.state !== 'gemini-only-preserved'
    || bundle.rollbackPolicy.basis !== 'exact-operating-source-deployment'
    || bundle.rollbackPolicy.sourceRevision !== sourceRevision
    || bundle.rollbackPolicy.deploymentSha !== sourceRevision
    || bundle.rollbackReadback.gitSha !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ROLLBACK_POLICY_UNPROVED');
  }
  assertWindow(bundle.createdAt, bundle.expiresAt, now, [
    bundle.adminRecordMutationsHold.observedAt,
    bundle.rollbackReadback.observedAt,
  ]);
  return Object.freeze(bundle);
}

export async function captureLocalVercelBundle({
  adminHoldProbeTransport,
  clock = () => new Date(),
  manifestRecord = loadSuccessorManifest(),
  protectedMainReadbackImpl = currentProtectedMainReadback,
  runtimeCompatibilityFetchImpl,
  runtimeCompatibilityReadbackImpl = fetchLiveStoryboardCompatibilityAliases,
  runtimeCompatibilityUrls = STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
  sourceRevision,
  vercelTransport,
} = {}) {
  if (!REVISION.test(sourceRevision ?? '') || typeof clock !== 'function') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  const created = assertDate(clock());
  const createdAt = created.toISOString();
  const expiresAt = new Date(created.getTime() + CAPTURE_WINDOW_MS).toISOString();
  let protectedMain;
  try { protectedMain = protectedMainReadbackImpl(manifestRecord.manifest); } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_SOURCE_MISMATCH');
  }
  if (protectedMain?.schemaVersion !== 1
    || protectedMain.projectRef !== manifestRecord.manifest.projectRef
    || protectedMain.remote !== manifestRecord.manifest.protectedSource.remote
    || protectedMain.ref !== manifestRecord.manifest.protectedSource.ref
    || protectedMain.repositoryUrl !== manifestRecord.manifest.protectedSource.repositoryUrl
    || protectedMain.revision !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_SOURCE_MISMATCH');
  }
  const rollbackReadback = await captureCurrentProductionRollback({
    clock,
    transport: vercelTransport ?? createScopedVercelApiTransport(),
  });
  const adminRecordMutationsHold = await captureAdminRecordMutationsHold({
    clock,
    deploymentReadback: rollbackReadback,
    transport: adminHoldProbeTransport ?? createAdminRecordMutationsHoldProbeTransport(),
  });
  if (rollbackReadback.gitSha !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ROLLBACK_POLICY_UNPROVED');
  }
  let runtimeCompatibilityReadback;
  try {
    runtimeCompatibilityReadback = await runtimeCompatibilityReadbackImpl({
      fetchImpl: runtimeCompatibilityFetchImpl,
      urls: runtimeCompatibilityUrls,
    });
  } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  }
  const storyboardPolicy = storyboardPolicyFromRuntimeReadback(
    runtimeCompatibilityReadback,
    rollbackReadback,
  );
  const bundle = {
    adminRecordMutationsHold,
    createdAt,
    expiresAt,
    kind: 'review-media-successor-vercel-operating-bundle',
    manifestSha256: manifestRecord.manifestSha256,
    protectedMain,
    rollbackPolicy: Object.freeze({
      basis: 'exact-operating-source-deployment',
      deploymentSha: rollbackReadback.gitSha,
      kind: 'storyboard-rollback-policy-readback',
      sourceRevision,
      state: 'gemini-only-preserved',
    }),
    rollbackReadback,
    schemaVersion: 1,
    sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    storyboardPolicy,
  };
  validateLocalVercelBundle({
    bundle,
    manifestRecord,
    now: assertDate(clock()),
    sourceRevision,
  });
  return Object.freeze(bundle);
}

function boundedEnvironmentValue(environment, key) {
  const value = environment?.[key];
  if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID');
  }
  return value;
}

export function authenticatedOwnerAttestation({
  clock = () => new Date(),
  environment = process.env,
  sourceRevision,
} = {}) {
  const owner = boundedEnvironmentValue(environment, 'GITHUB_REPOSITORY_OWNER');
  const actor = boundedEnvironmentValue(environment, 'GITHUB_ACTOR');
  const triggeringActor = boundedEnvironmentValue(environment, 'GITHUB_TRIGGERING_ACTOR');
  const actorId = boundedEnvironmentValue(environment, 'GITHUB_ACTOR_ID');
  const ownerId = boundedEnvironmentValue(environment, 'GITHUB_REPOSITORY_OWNER_ID');
  const operatorActor = boundedEnvironmentValue(environment, 'OPERATOR_ACTOR');
  const operatorActorId = boundedEnvironmentValue(environment, 'OPERATOR_ACTOR_ID');
  const workflowRef = boundedEnvironmentValue(environment, 'GITHUB_WORKFLOW_REF');
  const runId = boundedEnvironmentValue(environment, 'GITHUB_RUN_ID');
  const runAttempt = boundedEnvironmentValue(environment, 'GITHUB_RUN_ATTEMPT');
  if (environment.GITHUB_ACTIONS !== 'true'
    || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || environment.GITHUB_REPOSITORY !== TZUDONG_GITHUB_REPOSITORY
    || owner !== 'twoimo'
    || actor !== owner
    || triggeringActor !== owner
    || operatorActor !== actor
    || !DECIMAL_ID.test(actorId)
    || actorId !== ownerId
    || operatorActorId !== actorId
    || environment.GITHUB_REF !== 'refs/heads/main'
    || environment.GITHUB_REF_PROTECTED !== 'true'
    || environment.GITHUB_SHA !== sourceRevision
    || !DECIMAL_ID.test(runId)
    || !DECIMAL_ID.test(runAttempt)
    || !workflowRef.startsWith(`${TZUDONG_GITHUB_REPOSITORY}/.github/workflows/`)
    || !workflowRef.endsWith('@refs/heads/main')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID');
  }
  const fences = Object.fromEntries(OPERATOR_FENCES.map(fence => [fence, 'stopped']));
  const assertedAt = assertDate(clock()).toISOString();
  return Object.freeze({
    assertedAt,
    authority: 'authenticated-repository-owner-workflow-dispatch',
    basis: 'standing-custody-confirmation-bound-by-owner-dispatch',
    event: 'workflow_dispatch',
    fences: Object.freeze(fences),
    kind: 'review-media-successor-operator-custody-attestation',
    noticeState: 'not-issued',
    operatorRole: 'repository-owner',
    repository: TZUDONG_GITHUB_REPOSITORY,
    runAttempt,
    runId,
    schemaVersion: 1,
    scope: 'stopped-until-application-result',
    sourceRevision,
    workflowRef,
  });
}

function createDatabaseOperatingReadback({
  environment = process.env,
  manifest,
  psql = 'psql',
  runPsqlImpl = runPsql,
} = {}) {
  let databaseUrl;
  try {
    ({ databaseUrl } = selectDirectDatabaseTransport(environment));
    assertSuccessorDatabaseTarget(databaseUrl, manifest);
  } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_DB_AUTHORITY_INVALID');
  }
  return Object.freeze({
    requestQuiescence() {
      try {
        return runPsqlImpl(databaseUrl, ADMIN_IN_FLIGHT_QUIESCENCE_SQL, false, {
          environment,
          psql,
        });
      } catch {
        fail('SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT');
      }
    },
  });
}

export async function captureInFlightQuiescence({
  clock = () => new Date(),
  readback,
} = {}) {
  if (!readback || typeof readback.requestQuiescence !== 'function') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  let value;
  try {
    value = parseBoundedJson(
      await readback.requestQuiescence(),
      'SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT',
    );
  } catch (error) {
    if (error instanceof OperatingOrchestratorError) throw error;
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT');
  }
  exactKeys(value, ['coverage', 'inFlightWriters', 'lockMode'],
    'SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT');
  if (!equal(value.coverage, QUIESCENCE_RELATIONS)
    || value.inFlightWriters !== 0
    || value.lockMode !== 'SHARE') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT');
  }
  return Object.freeze({
    coverage: [...QUIESCENCE_RELATIONS],
    inFlightWriters: 0,
    lockMode: 'SHARE',
    observedAt: assertDate(clock()).toISOString(),
  });
}

function assertExactFenceCoverage(manifest) {
  const required = Object.keys(manifest.requiredWriterFences).sort();
  const supported = [
    'adminRecordMutationsHold',
    'automaticReviewer',
    ...OPERATOR_FENCES,
    'g037WriteFreeze',
  ].sort();
  if (!equal(required, supported)
    || manifest.requiredWriterFences.adminRecordMutationsHold !== 'active'
    || manifest.requiredWriterFences.automaticReviewer !== 'stopped'
    || manifest.requiredWriterFences.g037WriteFreeze !== 'active'
    || OPERATOR_FENCES.some(fence => manifest.requiredWriterFences[fence] !== 'stopped')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_COVERAGE_UNPROVED');
  }
}

export async function assembleOperatingEvidence({
  attestation,
  bundle,
  clock = () => new Date(),
  databaseReadback,
  environment = process.env,
  gitFactsImpl,
  githubTransport,
  manifestRecord = loadSuccessorManifest(),
  protectedMainReadbackImpl,
  quiescenceReadback,
  sourceRevision,
} = {}) {
  assertExactFenceCoverage(manifestRecord.manifest);
  const now = assertDate(clock());
  validateLocalVercelBundle({ bundle, manifestRecord, now, sourceRevision });
  exactKeys(attestation, [
    'assertedAt', 'authority', 'basis', 'event', 'fences', 'kind', 'noticeState',
    'operatorRole', 'repository', 'runAttempt', 'runId', 'schemaVersion', 'scope',
    'sourceRevision', 'workflowRef',
  ], 'SUCCESSOR_OPERATING_ORCHESTRATOR_ATTESTATION_INVALID');
  if (attestation.schemaVersion !== 1
    || attestation.kind !== 'review-media-successor-operator-custody-attestation'
    || attestation.authority !== 'authenticated-repository-owner-workflow-dispatch'
    || attestation.basis !== 'standing-custody-confirmation-bound-by-owner-dispatch'
    || attestation.event !== 'workflow_dispatch'
    || attestation.noticeState !== 'not-issued'
    || attestation.operatorRole !== 'repository-owner'
    || attestation.repository !== TZUDONG_GITHUB_REPOSITORY
    || attestation.scope !== 'stopped-until-application-result'
    || attestation.sourceRevision !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ATTESTATION_INVALID');
  }
  exactKeys(attestation.fences, OPERATOR_FENCES,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_ATTESTATION_INVALID');
  if (OPERATOR_FENCES.some(fence => attestation.fences[fence] !== 'stopped')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ATTESTATION_INVALID');
  }
  assertWindow(bundle.createdAt, bundle.expiresAt, now, [attestation.assertedAt]);

  const git = captureGitEvidence({
    clock,
    expiresAt: bundle.expiresAt,
    gitFactsImpl,
    manifestRecord,
    protectedMainReadbackImpl,
    sourceRevision,
  });
  const databaseAuthority = (!databaseReadback || !quiescenceReadback)
    ? createDatabaseOperatingReadback({
      environment,
      manifest: manifestRecord.manifest,
    })
    : undefined;
  const automaticReviewer = await captureAutomaticReviewer({
    clock,
    readback: databaseReadback ?? createOwnerDatabaseReadback({ environment }),
  });
  const quiescence = await captureInFlightQuiescence({
    clock,
    readback: quiescenceReadback ?? databaseAuthority,
  });
  const freeze = await captureG037WriteFreeze({
    clock,
    transport: githubTransport ?? createGithubVariableTransport({
      token: environment.GITHUB_TOKEN,
    }),
  });
  assertWindow(bundle.createdAt, bundle.expiresAt, assertDate(clock()), [
    bundle.adminRecordMutationsHold.observedAt,
    bundle.rollbackReadback.observedAt,
    attestation.assertedAt,
    git.checkoutReadback.observedAt,
    automaticReviewer.observedAt,
    quiescence.observedAt,
    freeze.observedAt,
  ]);

  const writerFenceReceipts = {
    adminRecordMutationsHold: writerFenceReceipt(
      'adminRecordMutationsHold',
      'active',
      bundle.adminRecordMutationsHold.observedAt,
      manifestRecord,
      sourceRevision,
      bundle.expiresAt,
    ),
    automaticReviewer: writerFenceReceipt(
      'automaticReviewer',
      automaticReviewer.state,
      automaticReviewer.observedAt,
      manifestRecord,
      sourceRevision,
      bundle.expiresAt,
    ),
    g037WriteFreeze: writerFenceReceipt(
      'g037WriteFreeze',
      freeze.state,
      freeze.observedAt,
      manifestRecord,
      sourceRevision,
      bundle.expiresAt,
    ),
  };
  for (const fence of OPERATOR_FENCES) {
    writerFenceReceipts[fence] = writerFenceReceipt(
      fence,
      attestation.fences[fence],
      attestation.assertedAt,
      manifestRecord,
      sourceRevision,
      bundle.expiresAt,
    );
  }

  const input = Object.freeze({
    attemptId: randomUUID(),
    checkoutReadback: git.checkoutReadback,
    createdAt: bundle.createdAt,
    expiresAt: bundle.expiresAt,
    kind: 'review-media-successor-rehearsal-admission-input',
    manifestSha256: manifestRecord.manifestSha256,
    protectedMainReceipt: git.protectedMainReceipt,
    rollbackReadbackReceipt: rollbackReceipt(
      bundle.rollbackReadback,
      manifestRecord,
      sourceRevision,
      bundle.expiresAt,
    ),
    schemaVersion: 1,
    sourceReceipt: git.sourceReceipt,
    sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    writerFenceReceipts: Object.freeze(writerFenceReceipts),
  });

  const machine = Object.freeze({
    adminRuntimeHold: Object.freeze({
      deploymentId: bundle.adminRecordMutationsHold.deploymentId,
      holdActive: true,
      observedAt: bundle.adminRecordMutationsHold.observedAt,
    }),
    automaticReviewer: Object.freeze({
      observedAt: automaticReviewer.observedAt,
      state: automaticReviewer.state,
    }),
    g037WriteFreeze: Object.freeze({
      observedAt: freeze.observedAt,
      state: freeze.state,
    }),
    inFlightQuiescence: quiescence,
    kind: 'review-media-successor-machine-operating-observations',
    schemaVersion: 1,
    sourceRevision,
  });
  return Object.freeze({ input, machine });
}

function createEvidenceMap({ attestation, bundle, input, machine }) {
  const attestationSha256 = sha256(canonicalBytes(attestation));
  const bundleSha256 = sha256(canonicalBytes(bundle));
  const machineSha256 = sha256(canonicalBytes(machine));
  const receiptProvenance = {};
  for (const [fence, receipt] of Object.entries(input.writerFenceReceipts)) {
    receiptProvenance[fence] = {
      evidenceSha256: OPERATOR_FENCES.includes(fence) ? attestationSha256 : machineSha256,
      provenance: OPERATOR_FENCES.includes(fence)
        ? 'authenticated-owner-custody-commitment'
        : 'machine-observation',
      receiptSha256: sha256(canonicalBytes(receipt)),
    };
  }
  return Object.freeze({
    assembledInputSha256: sha256(canonicalBytes(input)),
    attestationSha256,
    bundleSha256,
    kind: 'review-media-successor-operating-evidence-map',
    machineSha256,
    receiptProvenance: Object.freeze(receiptProvenance),
    schemaVersion: 1,
    sourceRevision: input.sourceRevision,
  });
}

function createApplyQuiescenceReceipt({ machine, manifestRecord, sourceRevision, expiresAt }) {
  const quiescence = machine.inFlightQuiescence;
  return Object.freeze({
    ...commonReceipt(
      manifestRecord,
      sourceRevision,
      expiresAt,
      quiescence.observedAt,
    ),
    coverage: [...quiescence.coverage],
    inFlightWriters: quiescence.inFlightWriters,
    kind: 'apply-in-flight-quiescence-readback',
    lockMode: quiescence.lockMode,
  });
}

function createApplyEvidenceMap({
  attestation,
  bundle,
  input,
  machine,
  quiescenceReceipt,
}) {
  const attestationSha256 = sha256(canonicalBytes(attestation));
  const bundleSha256 = sha256(canonicalBytes(bundle));
  const machineSha256 = sha256(canonicalBytes(machine));
  const quiescenceSha256 = sha256(canonicalBytes(quiescenceReceipt));
  const receiptProvenance = {};
  for (const [fence, receipt] of Object.entries(input.writerFenceReceipts)) {
    let evidenceSha256 = machineSha256;
    let provenance = 'fresh-machine-observation';
    if (OPERATOR_FENCES.includes(fence)) {
      evidenceSha256 = attestationSha256;
      provenance = 'authenticated-owner-custody-commitment';
    } else if (fence === 'adminRecordMutationsHold') {
      evidenceSha256 = bundleSha256;
      provenance = 'immutable-deployment-machine-observation';
    }
    receiptProvenance[fence] = Object.freeze({
      evidenceSha256,
      provenance,
      receiptSha256: sha256(canonicalBytes(receipt)),
    });
  }
  return Object.freeze({
    attestationSha256,
    bundleSha256,
    kind: 'review-media-successor-apply-operating-evidence-map',
    machineSha256,
    quiescenceSha256,
    receiptProvenance: Object.freeze(receiptProvenance),
    schemaVersion: 1,
    sourceRevision: input.sourceRevision,
  });
}

function applyInputFromRehearsal({
  admissionPath,
  applyEvidenceMapSha256,
  applyQuiescenceReadbackSha256,
  clock,
  journalPath,
  manifestRecord,
  receiptPath,
  rehearsalInput,
} = {}) {
  const observedAt = assertDate(clock()).toISOString();
  assertWindow(rehearsalInput.createdAt, rehearsalInput.expiresAt, assertDate(clock()), [observedAt]);
  let admissionBytes;
  let journalBytes;
  let receiptBytes;
  try {
    admissionBytes = readFileSync(admissionPath);
    journalBytes = readFileSync(journalPath);
    receiptBytes = readFileSync(receiptPath);
  } catch {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID');
  }
  return Object.freeze({
    applyEvidenceMapSha256,
    applyQuiescenceReadbackSha256,
    attemptId: randomUUID(),
    expiresAt: rehearsalInput.expiresAt,
    kind: 'review-media-successor-apply-admission-input',
    manifestSha256: manifestRecord.manifestSha256,
    observedAt,
    rehearsalAdmissionSha256: sha256(admissionBytes),
    rehearsalJournalSha256: sha256(journalBytes),
    rehearsalReceiptSha256: sha256(receiptBytes),
    schemaVersion: 1,
    sourceRevision: rehearsalInput.sourceRevision,
  });
}

export async function runOperatingOrchestrator({
  custodyDirectory,
  environment = process.env,
  mode,
  vercelBundlePath,
} = {}, {
  assembleImpl = assembleOperatingEvidence,
  attestationImpl = authenticatedOwnerAttestation,
  clock = () => new Date(),
  fsyncImpl = fsyncSync,
  loadManifestImpl = loadSuccessorManifest,
  observeRuntimeCompatibilityImpl = observeStoryboardRuntimeCompatibilityAliases,
  prepareApplyImpl = prepareReviewMediaApplyAdmission,
  prepareRehearsalImpl = prepareReviewMediaRehearsalAdmission,
  runApplyImpl = runReviewMediaSuccessor,
  runRehearsalImpl = runReviewMediaSuccessorRehearsal,
  runtimeCompatibilityFetchImpl,
  runtimeCompatibilityUrls = STORYBOARD_PRODUCTION_COMPATIBILITY_URLS,
} = {}) {
  if (!['observe', 'rehearsal', 'apply'].includes(mode)
    || typeof custodyDirectory !== 'string'
    || typeof vercelBundlePath !== 'string') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  const manifestRecord = loadManifestImpl();
  if (mode === 'apply') assertLaunchReady(manifestRecord.manifest);
  const sourceRevision = environment.GITHUB_SHA;
  if (!REVISION.test(sourceRevision ?? '')) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID');
  }
  const custodyAbsolute = assertOutsideRepository(
    custodyDirectory,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
    { mustExist: false },
  );
  assertPrivateDirectory(
    dirname(custodyAbsolute),
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  );
  if (pathEntryExists(custodyAbsolute)) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_OUTPUT_EXISTS');
  }

  const bundleRecord = readPrivateCanonicalJson(
    vercelBundlePath,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID',
  );
  const now = assertDate(clock());
  const bundle = validateLocalVercelBundle({
    bundle: bundleRecord.value,
    manifestRecord,
    now,
    sourceRevision,
  });
  const attestation = attestationImpl({ bundle, clock, environment, sourceRevision });
  const { input, machine } = await assembleImpl({
    attestation,
    bundle,
    clock,
    environment,
    manifestRecord,
    sourceRevision,
  });
  const parent = dirname(custodyAbsolute);
  const stem = basename(custodyAbsolute);
  const inputRecord = writeExclusiveCanonical(
    join(parent, `${stem}-${mode === 'observe' ? 'observe' : 'rehearsal'}-input.json`),
    input,
    fsyncImpl,
  );
  if (mode === 'observe') {
    const custody = createExclusivePrivateDirectory(custodyAbsolute, fsyncImpl);
    const evidenceMap = createEvidenceMap({ attestation, bundle, input, machine });
    writeExclusiveCanonical(join(custody, PROVENANCE_FILES.attestation), attestation, fsyncImpl);
    writeExclusiveCanonical(join(custody, PROVENANCE_FILES.input), input, fsyncImpl);
    writeExclusiveCanonical(join(custody, PROVENANCE_FILES.machine), machine, fsyncImpl);
    writeExclusiveCanonical(join(custody, PROVENANCE_FILES.map), evidenceMap, fsyncImpl);
    writeExclusiveCanonical(join(custody, PROVENANCE_FILES.vercel), bundle, fsyncImpl);
    return Object.freeze({
      code: 'SUCCESSOR_OPERATING_EVIDENCE_CAPTURED',
      custodyDirectory: custody,
      expiresAt: input.expiresAt,
      mode,
      sourceRevision,
      status: 'observed',
    });
  }
  const rehearsal = prepareRehearsalImpl({
    custodyDirectory: custodyAbsolute,
    fsyncImpl,
    inputPath: inputRecord.path,
    manifestRecord,
    now: assertDate(clock()),
  });
  const custody = assertPrivateDirectory(
    rehearsal.custodyDirectory,
    'SUCCESSOR_OPERATING_ORCHESTRATOR_PRIVATE_CUSTODY_INVALID',
  );
  const evidenceMap = createEvidenceMap({ attestation, bundle, input, machine });
  writeExclusiveCanonical(join(custody, PROVENANCE_FILES.attestation), attestation, fsyncImpl);
  writeExclusiveCanonical(join(custody, PROVENANCE_FILES.machine), machine, fsyncImpl);
  writeExclusiveCanonical(join(custody, PROVENANCE_FILES.map), evidenceMap, fsyncImpl);
  writeExclusiveCanonical(join(custody, PROVENANCE_FILES.vercel), bundle, fsyncImpl);

  const rehearsalRollbackReadbackImpl = await createRuntimeVerifiedRollbackReadback({
    bundle,
    bundleSha256: sha256(bundleRecord.bytes),
    fetchImpl: runtimeCompatibilityFetchImpl,
    observeRuntimeCompatibilityImpl,
    urls: runtimeCompatibilityUrls,
  });
  const rehearsalResult = await runRehearsalImpl({
    admissionPath: rehearsal.admissionPath,
    environment,
    journalPath: rehearsal.journalPath,
    receiptPath: rehearsal.receiptPath,
  }, { rollbackReadbackImpl: rehearsalRollbackReadbackImpl });
  if (rehearsalResult?.code !== 'SUCCESSOR_REHEARSAL_PASSED'
    || rehearsalResult?.status !== 'rolled_back') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID');
  }
  if (mode === 'rehearsal') {
    return Object.freeze({
      code: rehearsalResult.code,
      custodyDirectory: custody,
      expiresAt: input.expiresAt,
      mode,
      sourceRevision,
      status: rehearsalResult.status,
    });
  }

  const refreshed = await assembleImpl({
    attestation,
    bundle,
    clock,
    environment,
    manifestRecord,
    sourceRevision,
  });
  for (const fence of ['adminRecordMutationsHold', ...OPERATOR_FENCES]) {
    if (!equal(
      refreshed.input.writerFenceReceipts[fence],
      input.writerFenceReceipts[fence],
    )) fail('SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID');
  }
  const applyQuiescenceReceipt = createApplyQuiescenceReceipt({
    expiresAt: input.expiresAt,
    machine: refreshed.machine,
    manifestRecord,
    sourceRevision,
  });
  const applyEvidenceMap = createApplyEvidenceMap({
    attestation,
    bundle,
    input: refreshed.input,
    machine: refreshed.machine,
    quiescenceReceipt: applyQuiescenceReceipt,
  });
  writeExclusiveCanonical(
    join(custody, APPLY_PROVENANCE_FILES.machine),
    refreshed.machine,
    fsyncImpl,
  );
  const applyQuiescenceRecord = writeExclusiveCanonical(
    join(custody, APPLY_PROVENANCE_FILES.quiescence),
    applyQuiescenceReceipt,
    fsyncImpl,
  );
  for (const [fence, receipt] of Object.entries(refreshed.input.writerFenceReceipts)) {
    writeExclusiveCanonical(join(custody, applyWriterFenceFile(fence)), receipt, fsyncImpl);
  }
  const applyEvidenceMapRecord = writeExclusiveCanonical(
    join(custody, APPLY_PROVENANCE_FILES.map),
    applyEvidenceMap,
    fsyncImpl,
  );
  const applyInput = applyInputFromRehearsal({
    admissionPath: rehearsal.admissionPath,
    applyEvidenceMapSha256: applyEvidenceMapRecord.sha256,
    applyQuiescenceReadbackSha256: applyQuiescenceRecord.sha256,
    clock,
    journalPath: rehearsal.journalPath,
    manifestRecord,
    receiptPath: rehearsal.receiptPath,
    rehearsalInput: input,
  });
  const applyInputRecord = writeExclusiveCanonical(
    join(parent, `${stem}-apply-input.json`),
    applyInput,
    fsyncImpl,
  );
  const apply = prepareApplyImpl({
    custodyDirectory: custody,
    fsyncImpl,
    inputPath: applyInputRecord.path,
    manifestRecord,
    now: assertDate(clock()),
  });
  const applyRollbackReadbackImpl = await createRuntimeVerifiedRollbackReadback({
    bundle,
    bundleSha256: sha256(bundleRecord.bytes),
    fetchImpl: runtimeCompatibilityFetchImpl,
    observeRuntimeCompatibilityImpl,
    urls: runtimeCompatibilityUrls,
  });
  const result = await runApplyImpl({
    admissionPath: apply.admissionPath,
    environment,
    journalPath: apply.journalPath,
  }, { rollbackReadbackImpl: applyRollbackReadbackImpl });
  return Object.freeze({
    code: result.code,
    custodyDirectory: custody,
    expiresAt: input.expiresAt,
    mode,
    sourceRevision,
    status: result.status,
  });
}

export function parseOperatingOrchestratorArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  const command = argv[0] === 'capture-vercel' ? 'capture-vercel' : 'operate';
  const offset = argv[0] === 'operate' || argv[0] === 'capture-vercel' ? 1 : 0;
  if (command === 'operate' && offset === 0 && argv[0] !== '--mode') {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  const values = {};
  for (let index = offset; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    const allowed = command === 'capture-vercel'
      ? ['--source-revision', '--output']
      : ['--mode', '--input', '--vercel-bundle', '--custody-dir'];
    if (!allowed.includes(option)
      || !value
      || value.startsWith('--')
      || option.slice(2) in values) {
      fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
    }
    values[option.slice(2)] = value;
  }
  if (command === 'capture-vercel') {
    if (argv.length - offset !== 4
      || !REVISION.test(values['source-revision'] ?? '')
      || !values.output) fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
    return Object.freeze({
      command,
      outputPath: values.output,
      sourceRevision: values['source-revision'],
    });
  }
  const workflowShape = values.input && !values['vercel-bundle'];
  const legacyShape = values['vercel-bundle'] && !values.input;
  if (argv.length - offset !== 6
    || !['observe', 'rehearse', 'rehearsal', 'apply'].includes(values.mode)
    || (!workflowShape && !legacyShape)
    || !values['custody-dir']) {
    fail('SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID');
  }
  return Object.freeze({
    command,
    custodyDirectory: values['custody-dir'],
    mode: values.mode === 'rehearse' ? 'rehearsal' : values.mode,
    vercelBundlePath: values.input ?? values['vercel-bundle'],
  });
}

export function operatingOrchestratorFailureResult(error) {
  const observed = safeCode(error);
  if (PUBLIC_CODES.has(observed)) return Object.freeze({ code: observed, status: 'failed' });
  if (observed.startsWith('SUCCESSOR_')) return successorFailureResult(error);
  return Object.freeze({
    code: 'SUCCESSOR_OPERATING_ORCHESTRATOR_INPUT_INVALID',
    status: 'failed',
  });
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseOperatingOrchestratorArguments(argv);
  if (args.command === 'capture-vercel') {
    const bundle = await captureLocalVercelBundle({
      ...dependencies,
      sourceRevision: args.sourceRevision,
    });
    const written = writeExclusiveCanonical(
      args.outputPath,
      bundle,
      dependencies.fsyncImpl,
    );
    return Object.freeze({
      code: 'SUCCESSOR_VERCEL_BUNDLE_CAPTURED',
      expiresAt: bundle.expiresAt,
      outputPath: written.path,
      sha256: written.sha256,
      sourceRevision: bundle.sourceRevision,
      status: 'captured',
    });
  }
  return runOperatingOrchestrator(args, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(await main()));
  } catch (error) {
    console.error(JSON.stringify(operatingOrchestratorFailureResult(error)));
    process.exitCode = 1;
  }
}
