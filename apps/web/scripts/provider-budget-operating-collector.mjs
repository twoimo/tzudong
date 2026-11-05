#!/usr/bin/env node
/**
 * Publish one durable provider-budget admission, then use the fixed existing caller.
 * Custody records attest to the authenticated owner's privileged-writer control;
 * they do not claim to observe stopped processes or ordinary Storage HTTP.
 * A trusted owner must preserve this same host/HOME, including partial attempts.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  realpathSync, writeSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { selectDirectDatabaseTransport } from './apply-supabase-migration.mjs';
import { assertSuccessorDatabaseTarget } from './admin-record-sql-successor.mjs';
import { observeThumbnailLocalOwner, validateThumbnailLocalOwner } from './thumbnail-local-owner.mjs';
import {
  CUSTODY_DIRECTORY, FENCE_COVERAGE, MANIFEST_SHA256, PROJECT_REF,
  RELEASE_ADMISSION_SHA256, REPOSITORY_ROOT, REQUIRED_FENCES, OWNER_AUTHORITY,
  createBudgetPsqlRunner, currentBudgetProtectedRevision, currentBudgetSource, loadBudgetRecord,
  loadBudgetRelease, readBudgetPrior, runBudgetSuccessor,
  budgetReleaseContract, validateBudgetAdmission, validateBudgetLiveSource,
  observeBudgetPredecessor, validateBudgetPredecessor,
} from './provider-budget-production-successor.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha = raw => createHash('sha256').update(raw).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(canonical(value)) + '\n');

function statIfPresent(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function assertDirectory(path, { privateMode = false } = {}) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
    || stat.uid !== process.getuid() || (stat.mode & 0o022)
    || (privateMode && (stat.mode & 0o777) !== 0o700)) fail('PROVIDER_BUDGET_CUSTODY_INVALID');
  return stat;
}
function publicationPath(directory) {
  const absolute = resolve(directory), rel = relative(REPOSITORY_ROOT, absolute);
  if (!rel.startsWith('..' + sep) && rel !== '..') fail('PROVIDER_BUDGET_CUSTODY_INVALID');
  // Includes dangling symlinks and incomplete publication. Never adopt a path.
  if (statIfPresent(absolute)) fail('PROVIDER_BUDGET_CUSTODY_ALREADY_EXISTS');
  let parent = dirname(absolute);
  while (!statIfPresent(parent)) parent = dirname(parent);
  // Existing owned ancestors may be readable, but never writable by others.
  // Newly created managed directories and the final custody are exactly 0700.
  assertDirectory(parent);
  return absolute;
}
function syncDirectory(path, fsyncImpl) {
  const before = assertDirectory(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory() || stat.dev !== before.dev || stat.ino !== before.ino) fail('PROVIDER_BUDGET_CUSTODY_INVALID');
    fsyncImpl(fd);
  } finally { closeSync(fd); }
}
function createPrivateDirectory(path) {
  mkdirSync(path, { mode: 0o700 }); // Exclusive: EEXIST is never reused.
  assertDirectory(path, { privateMode: true });
}
function publishInputs(directory, inputs, fsyncImpl) {
  const missingParents = [];
  let parent = dirname(directory);
  while (!statIfPresent(parent)) { missingParents.unshift(parent); parent = dirname(parent); }
  assertDirectory(parent);
  try {
    for (const path of missingParents) createPrivateDirectory(path);
    createPrivateDirectory(directory);
    // Reserve the final path before the first fallible fsync. Any subsequent
    // durability failure leaves a visible consumed publication, even when
    // this is the first operation to create the managed parent directories.
    for (const path of [...missingParents, directory]) {
      syncDirectory(path, fsyncImpl);
      syncDirectory(dirname(path), fsyncImpl);
    }
    for (const [name, raw] of inputs) {
      if (raw.length > 128 * 1024) fail('PROVIDER_BUDGET_CUSTODY_INVALID');
      assertDirectory(directory, { privateMode: true });
      const fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()
          || (stat.mode & 0o777) !== 0o600) fail('PROVIDER_BUDGET_CUSTODY_INVALID');
        let offset = 0;
        while (offset < raw.length) {
          const written = writeSync(fd, raw, offset, raw.length - offset);
          if (!Number.isSafeInteger(written) || written <= 0) fail('PROVIDER_BUDGET_CUSTODY_PUBLICATION_UNCONFIRMED');
          offset += written;
        }
        // Validate again before publication; the caller independently validates
        // inode type/link count/permissions and canonical bytes before sending.
        const after = fstatSync(fd);
        if (after.nlink !== 1 || after.uid !== process.getuid() || (after.mode & 0o777) !== 0o600
          || after.size !== raw.length) fail('PROVIDER_BUDGET_CUSTODY_INVALID');
        fsyncImpl(fd);
      } finally { closeSync(fd); }
      syncDirectory(directory, fsyncImpl);
    }
  } catch {
    // Keep all artifacts. Even an empty/partial final directory consumes this
    // publication; there is no deletion, overwrite, repair or automatic retry.
    fail('PROVIDER_BUDGET_CUSTODY_PUBLICATION_UNCONFIRMED');
  }
}

export function prepareBudgetOperation({ environment = process.env, confirmation } = {}, dependencies = {}) {
  const {
    loadReleaseImpl = loadBudgetRelease, loadRecordImpl = loadBudgetRecord,
    custodyDirectory = CUSTODY_DIRECTORY, predecessorImpl = observeBudgetPredecessor, now = () => new Date(), uuidImpl = randomUUID,
    sourceImpl = currentBudgetSource, protectedRevisionImpl = currentBudgetProtectedRevision,
    attestationImpl = observeThumbnailLocalOwner, runPsqlImpl, fsyncImpl = fsyncSync,
  } = dependencies;
  // Intentionally first: an absent fixed release does not inspect source,
  // credentials, custody or the database, and cannot publish anything.
  if (loadReleaseImpl().sha256 !== RELEASE_ADMISSION_SHA256) fail('PROVIDER_BUDGET_RELEASE_ADMISSION_INVALID');
  const record = loadRecordImpl(), source = sourceImpl();
  const sourceRevision = source.revision;
  validateBudgetLiveSource({ sourceRevision }, source, protectedRevisionImpl());
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) fail('PROVIDER_BUDGET_SOURCE_DRIFT');
  if (environment.PROVIDER_BUDGET_PRIVILEGED_CUSTODY !== 'true') fail('PROVIDER_BUDGET_PRIVILEGED_CUSTODY_REQUIRED');
  if (confirmation !== `apply:${sourceRevision}:${MANIFEST_SHA256}`) fail('PROVIDER_BUDGET_CONFIRMATION_INVALID');
  const created = now();
  if (!Number.isFinite(created.getTime())) fail('PROVIDER_BUDGET_ADMISSION_INVALID');
  const operationId = uuidImpl();
  let owner;
  try {
    owner = attestationImpl({ environment, clock: now, operationId });
    validateThumbnailLocalOwner(owner, { sourceRevision, now: now(), operationId });
  }
  catch { fail('PROVIDER_BUDGET_OWNER_ATTESTATION_INVALID'); }
  const contract = budgetReleaseContract();
  const directory = publicationPath(custodyDirectory);
  let databaseUrl;
  try {
    ({ databaseUrl } = selectDirectDatabaseTransport(environment));
    assertSuccessorDatabaseTarget(databaseUrl, { projectRef: PROJECT_REF, databaseName: 'postgres' });
  } catch { fail('PROVIDER_BUDGET_DATABASE_TARGET_INVALID'); }
  let previous;
  try { previous = predecessorImpl(environment); }
  catch { fail('PROVIDER_BUDGET_PREDECESSOR_UNCONFIRMED'); }
  if (previous?.status !== 'reconciliation' || previous.disposition !== 'committed'
    || previous.replayAllowed !== false) fail('PROVIDER_BUDGET_PREDECESSOR_UNCONFIRMED');
  const predecessor = {
    kind: 'provider-budget-thumbnail-predecessor-v1',
    manifestSha256: budgetReleaseContract().predecessorManifestSha256,
    attemptId: previous.attemptId, disposition: previous.disposition,
    replayAllowed: false, observedAt: now().toISOString(),
  };
  const transport = runPsqlImpl ?? createBudgetPsqlRunner(databaseUrl, { environment });
  let prior;
  try { prior = readBudgetPrior(transport, databaseUrl, record); }
  catch (error) {
    if (error.code === 'PROVIDER_BUDGET_PRIOR_STATE_DRIFT') throw error;
    fail('PROVIDER_BUDGET_PRIOR_READBACK_UNCONFIRMED');
  }
  // Only the exact fixed, non-personal expected result can reach the receipt.
  // No database URL, raw output, diagnostics or row contents are persisted.
  const observed = now(), expires = new Date(created.getTime() + contract.admissionLifetimeMs);
  if (!Number.isFinite(observed.getTime()) || observed < created) fail('PROVIDER_BUDGET_ADMISSION_INVALID');
  if (observed >= expires) fail('PROVIDER_BUDGET_ADMISSION_EXPIRED');
  const observedAt = observed.toISOString(), createdAt = created.toISOString(), expiresAt = expires.toISOString();
  const evidence = Object.entries(REQUIRED_FENCES).map(([fence, state]) => {
    const raw = bytes({
      kind: 'provider-budget-writer-observation-v1', fence, state,
      projectRef: PROJECT_REF, sourceRevision, manifestSha256: MANIFEST_SHA256,
      operationId, observedAt,
      scope: 'privileged-custody-until-reconciled', coverage: [...FENCE_COVERAGE],
      basis: 'authenticated-owner-custody',
    });
    return { name: fence, raw };
  });
  const fence = {
    kind: 'provider-budget-writer-fence-readback-v1', authority: OWNER_AUTHORITY,
    projectRef: PROJECT_REF, sourceRevision, manifestSha256: MANIFEST_SHA256,
    observedAt, expiresAt, operationId, ownerObservation: owner,
    fences: { ...REQUIRED_FENCES }, coverage: [...FENCE_COVERAGE],
    evidenceSha256: Object.fromEntries(evidence.map(item => [item.name, sha(item.raw)])),
  };
  const fenceBytes = bytes(fence);
  const admission = {
    kind: 'provider-budget-production-admission-v1', attemptId: operationId, projectRef: PROJECT_REF,
    databaseName: 'postgres', executorRole: 'postgres', serverVersionNum: 170006,
    manifestSha256: MANIFEST_SHA256, releaseAdmissionSha256: RELEASE_ADMISSION_SHA256,
    sourceSha256: record.migration.sha256, vectorSha256: record.migration.originalVectorSha256,
    sourceRevision, createdAt, expiresAt, writerFenceSha256: sha(fenceBytes), predecessorSha256: sha(bytes(predecessor)),
  };
  validateBudgetAdmission(admission, fence, fenceBytes, record, now());
  validateBudgetPredecessor(predecessor, admission);
  validateBudgetLiveSource(admission, sourceImpl(), protectedRevisionImpl());
  if (loadReleaseImpl().sha256 !== RELEASE_ADMISSION_SHA256) fail('PROVIDER_BUDGET_RELEASE_ADMISSION_INVALID');
  // The caller reloads exact source/vector and reobserves prior immediately
  // before its journal. SQL locks and in-transaction guards close that gap.
  publicationPath(directory);
  publishInputs(directory, [
    ...evidence.map(item => [`writer-fence-${item.name}.json`, item.raw]),
    ['writer-fence.json', fenceBytes],
    ['thumbnail-predecessor.json', bytes(predecessor)],
    ['prior-readback.json', bytes({
      kind: 'provider-budget-prior-readback-v1', projectRef: PROJECT_REF, sourceRevision,
      manifestSha256: MANIFEST_SHA256, attemptId: admission.attemptId, observedAt, prior,
    })],
    ['admission.json', bytes(admission)], // Admission is published last.
  ], fsyncImpl);
  return { status: 'prepared', attemptId: admission.attemptId, sourceRevision, manifestSha256: MANIFEST_SHA256, expiresAt };
}

export function operateBudgetSuccessor({ mode = 'inspect', environment = process.env, confirmation } = {}, dependencies = {}) {
  if (!['inspect', 'apply', 'reconcile'].includes(mode)
    || (mode !== 'apply' && confirmation !== undefined)) fail('PROVIDER_BUDGET_ARGUMENT_INVALID');
  if (mode === 'apply') prepareBudgetOperation({ environment, confirmation }, dependencies);
  // Reconciliation must remain read-only and must not republish, refresh or
  // delete historical custody. No mode resumes privileged writers.
  return runBudgetSuccessor({ mode, environment }, dependencies);
}

export function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!['--mode', '--confirmation'].includes(flag) || !value || value.startsWith('--')
      || Object.hasOwn(args, flag.slice(2))) fail('PROVIDER_BUDGET_ARGUMENT_INVALID');
    args[flag.slice(2)] = value;
  }
  // All path/transport/validation injection is in the unit-test dependency
  // argument; production has no ready, SQL, source or custody-path override.
  return operateBudgetSuccessor(args);
}
if (import.meta.url === 'file://' + process.argv[1]) {
  try { console.log(JSON.stringify(main())); }
  catch (error) {
    const code = /^PROVIDER_BUDGET_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'PROVIDER_BUDGET_OPERATION_FAILED';
    console.error(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  }
}
