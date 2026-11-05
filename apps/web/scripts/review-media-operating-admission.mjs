#!/usr/bin/env node
/** Pure, local producer for private review-media successor admissions. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPOSITORY_ROOT,
  loadSuccessorManifest,
  validateSuccessorAdmission,
  validateSuccessorRehearsalAdmission,
} from './review-media-sql-successor.mjs';
import {
  TZUDONG_GITHUB_REPOSITORY,
  TZUDONG_PRODUCTION_ALIASES,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  normalizeVercelRollbackExpected,
} from './vercel-rollback-readback.mjs';
import { elevenMigrationBundleSuffixRoot } from './supabase-migration-bundle.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_WINDOW_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;
const MAX_PRIVATE_FILE_BYTES = 1024 * 1024;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL_ID = /^[1-9][0-9]*$/;
const QUIESCENCE_RELATIONS = Object.freeze([
  'pipeline_control.admin_record_media_cleanup',
  'pipeline_control.admin_record_operations',
  'public.reviews',
  'storage.objects',
]);

const FILES = Object.freeze({
  applyAdmission: 'apply-admission.json',
  applyEvidenceMap: 'apply-operating-evidence-map.json',
  applyJournal: 'apply-journal.jsonl',
  applyMachine: 'apply-machine-operating-observations.json',
  applyQuiescence: 'apply-quiescence-readback.json',
  checkout: 'checkout-readback.json',
  protectedMain: 'protected-main-receipt.json',
  rehearsalAdmission: 'rehearsal-admission.json',
  rehearsalJournal: 'rehearsal-journal.jsonl',
  rehearsalReceipt: 'rehearsal-receipt.json',
  rollback: 'rollback-readback-receipt.json',
  source: 'source-receipt.json',
});
const applyWriterFenceFile = fence => `apply-writer-fence-${fence}.json`;

const PUBLIC_CODES = new Set([
  'SUCCESSOR_OPERATING_ADMISSION_ARGUMENT_INVALID',
  'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID',
  'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID',
  'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID',
  'SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS',
  'SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED',
]);

const operationError = code => {
  const error = new Error(code);
  error.code = code;
  return error;
};
const fail = code => { throw operationError(code); };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function safeCode(error) {
  try { return typeof error?.code === 'string' ? error.code : ''; } catch { return ''; }
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

function exactKeys(value, keys, code = 'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function assertHex(value) {
  if (typeof value !== 'string' || !HEX_SHA256.test(value)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
}

function assertUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
}

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (safeCode(error) === 'ENOENT') return false;
    fail('SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID');
  }
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

function readBoundedDescriptor(descriptor, status, code) {
  if (!Number.isSafeInteger(status.size)
    || status.size <= 0
    || status.size > MAX_PRIVATE_FILE_BYTES) fail(code);
  const buffer = Buffer.allocUnsafe(status.size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (!Number.isSafeInteger(count) || count < 0) fail(code);
    if (count === 0) break;
    offset += count;
  }
  const finalStatus = fstatSync(descriptor);
  if (offset !== status.size || finalStatus.size !== status.size) fail(code);
  return buffer.subarray(0, offset);
}

function readPrivateCanonicalJson(path, code = 'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID') {
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
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !bytes.equals(canonicalBytes(value))) fail(code);
    return Object.freeze({ absolute, bytes, value });
  } catch (error) {
    if (safeCode(error) === code) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded failure above */ }
    }
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(written) || written <= 0) {
      fail('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
    }
    offset += written;
  }
}

function writeExclusiveCanonical(path, value, fsyncImpl = fsyncSync) {
  const bytes = canonicalBytes(value);
  if (bytes.length === 0 || bytes.length > MAX_PRIVATE_FILE_BYTES) {
    fail('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
  }
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeAll(descriptor, bytes);
    fsyncImpl(descriptor);
    return bytes;
  } catch (error) {
    const errorCode = safeCode(error);
    if (errorCode === 'EEXIST') fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
    if (errorCode.startsWith('SUCCESSOR_OPERATING_ADMISSION_')) throw error;
    fail('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* file fsync already established the bounded outcome */ }
    }
  }
}

function syncDirectory(path, fsyncImpl = fsyncSync) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    fsyncImpl(descriptor);
  } catch {
    fail('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded outcome above */ }
    }
  }
}

function assertWindow(createdAtValue, expiresAtValue, now) {
  const createdAt = Date.parse(createdAtValue);
  const expiresAt = Date.parse(expiresAtValue);
  const nowMs = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(nowMs)
    || expiresAt <= createdAt
    || expiresAt - createdAt > MAX_WINDOW_MS
    || createdAt > nowMs + CLOCK_SKEW_MS
    || nowMs >= expiresAt) fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  return Object.freeze({ createdAt, expiresAt, nowMs });
}

function assertObservedWindow(document, expiresAtValue, window) {
  const observedAt = Date.parse(document.observedAt);
  if (document.expiresAt !== expiresAtValue
    || !Number.isFinite(observedAt)
    || observedAt < window.createdAt
    || observedAt >= window.expiresAt
    || observedAt > window.nowMs + CLOCK_SKEW_MS) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
}

function assertCommonReceipt(receipt, input, manifestRecord, window) {
  const { manifest, manifestSha256 } = manifestRecord;
  if (receipt.schemaVersion !== 1
    || receipt.id !== manifest.id
    || receipt.projectRef !== manifest.projectRef
    || receipt.purpose !== manifest.purpose
    || receipt.manifestSha256 !== manifestSha256
    || receipt.sourceRevision !== input.sourceRevision) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  assertObservedWindow(receipt, input.expiresAt, window);
}

function validateRehearsalInput(input, manifestRecord, now) {
  exactKeys(input, [
    'attemptId', 'checkoutReadback', 'createdAt', 'expiresAt', 'kind', 'manifestSha256',
    'protectedMainReceipt', 'rollbackReadbackReceipt', 'schemaVersion', 'sourceReceipt',
    'sourceRevision', 'sourceRoot', 'writerFenceReceipts',
  ], 'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID');
  const { manifest, manifestSha256 } = manifestRecord;
  if (input.schemaVersion !== 1
    || input.kind !== 'review-media-successor-rehearsal-admission-input'
    || input.manifestSha256 !== manifestSha256
    || input.sourceRoot !== manifest.sourceRoot
    || !REVISION.test(input.sourceRevision ?? '')) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  assertUuid(input.attemptId);
  const window = assertWindow(input.createdAt, input.expiresAt, now);

  exactKeys(input.checkoutReadback, [
    'clean', 'detached', 'expiresAt', 'kind', 'observedAt', 'revision', 'schemaVersion',
  ]);
  if (input.checkoutReadback.schemaVersion !== 1
    || input.checkoutReadback.kind !== 'successor-checkout-readback'
    || input.checkoutReadback.revision !== input.sourceRevision
    || input.checkoutReadback.clean !== true
    || input.checkoutReadback.detached !== true) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  assertObservedWindow(input.checkoutReadback, input.expiresAt, window);

  exactKeys(input.sourceReceipt, [
    'expiresAt', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef', 'purpose',
    'schemaVersion', 'sourceRevision', 'sourceRoot',
  ]);
  assertCommonReceipt(input.sourceReceipt, input, manifestRecord, window);
  if (input.sourceReceipt.kind !== 'successor-source-receipt'
    || input.sourceReceipt.sourceRoot !== manifest.sourceRoot) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  exactKeys(input.protectedMainReceipt, [
    'expiresAt', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef', 'purpose',
    'ref', 'remote', 'repositoryUrl', 'revision', 'schemaVersion', 'sourceRevision',
  ]);
  assertCommonReceipt(input.protectedMainReceipt, input, manifestRecord, window);
  if (input.protectedMainReceipt.kind !== 'protected-main-readback-receipt'
    || input.protectedMainReceipt.remote !== manifest.protectedSource.remote
    || input.protectedMainReceipt.ref !== manifest.protectedSource.ref
    || input.protectedMainReceipt.repositoryUrl !== manifest.protectedSource.repositoryUrl
    || input.protectedMainReceipt.revision !== input.sourceRevision) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const rollback = input.rollbackReadbackReceipt;
  exactKeys(rollback, [
    'deploymentId', 'deploymentSha', 'deploymentUrl', 'expiresAt', 'gitRef', 'id', 'kind',
    'manifestSha256', 'observedAt', 'productionAliases', 'projectId', 'projectRef',
    'purpose', 'readyState', 'repository', 'schemaVersion', 'sourceRevision', 'state',
    'target', 'teamId',
  ]);
  assertCommonReceipt(rollback, input, manifestRecord, window);
  let normalizedRollback;
  try {
    normalizedRollback = normalizeVercelRollbackExpected({
      deploymentId: rollback.deploymentId,
      deploymentUrl: rollback.deploymentUrl,
      gitRef: rollback.gitRef,
      gitSha: rollback.deploymentSha,
    });
  } catch {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  if (rollback.kind !== 'rollback-readback-receipt'
    || normalizedRollback.deploymentUrl !== rollback.deploymentUrl
    || rollback.projectId !== TZUDONG_VERCEL_PROJECT_ID
    || rollback.teamId !== TZUDONG_VERCEL_TEAM_ID
    || rollback.repository !== TZUDONG_GITHUB_REPOSITORY
    || !equal(rollback.productionAliases, TZUDONG_PRODUCTION_ALIASES)
    || rollback.readyState !== 'READY'
    || rollback.target !== 'production'
    || rollback.state !== 'ready') {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(input.writerFenceReceipts, fenceKeys);
  for (const key of fenceKeys) {
    const receipt = input.writerFenceReceipts[key];
    exactKeys(receipt, [
      'expiresAt', 'fence', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef',
      'purpose', 'schemaVersion', 'sourceRevision', 'state',
    ]);
    assertCommonReceipt(receipt, input, manifestRecord, window);
    if (receipt.kind !== 'writer-fence-readback-receipt'
      || receipt.fence !== key
      || receipt.state !== manifest.requiredWriterFences[key]) {
      fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    }
  }
  return window;
}

function createCustodyDirectory(path, fsyncImpl) {
  const absolute = assertOutsideRepository(path, 'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID', {
    mustExist: false,
  });
  assertPrivateDirectory(dirname(absolute), 'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID');
  if (pathEntryExists(absolute)) fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  try { mkdirSync(absolute, { mode: 0o700 }); } catch (error) {
    if (safeCode(error) === 'EEXIST') fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
    fail('SUCCESSOR_OPERATING_ADMISSION_WRITE_FAILED');
  }
  syncDirectory(dirname(absolute), fsyncImpl);
  return assertPrivateDirectory(absolute, 'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID');
}

function existingCustodyDirectory(path) {
  const absolute = assertOutsideRepository(path, 'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID');
  return assertPrivateDirectory(absolute, 'SUCCESSOR_OPERATING_ADMISSION_CUSTODY_INVALID');
}

export function prepareReviewMediaRehearsalAdmission({
  custodyDirectory,
  fsyncImpl = fsyncSync,
  inputPath,
  manifestRecord = loadSuccessorManifest(),
  now = new Date(),
} = {}) {
  const inputRecord = readPrivateCanonicalJson(inputPath);
  const input = inputRecord.value;
  validateRehearsalInput(input, manifestRecord, now);

  const custody = createCustodyDirectory(custodyDirectory, fsyncImpl);
  const sourceBytes = canonicalBytes(input.sourceReceipt);
  const protectedMainBytes = canonicalBytes(input.protectedMainReceipt);
  const rollbackBytes = canonicalBytes(input.rollbackReadbackReceipt);
  const writerFences = {};
  const receiptDocuments = [
    [FILES.checkout, input.checkoutReadback],
    [FILES.source, input.sourceReceipt],
    [FILES.protectedMain, input.protectedMainReceipt],
    [FILES.rollback, input.rollbackReadbackReceipt],
  ];
  for (const key of Object.keys(manifestRecord.manifest.requiredWriterFences).sort()) {
    const receipt = input.writerFenceReceipts[key];
    const bytes = canonicalBytes(receipt);
    writerFences[key] = Object.freeze({
      evidenceSha256: sha256(bytes),
      state: receipt.state,
    });
    receiptDocuments.push([`writer-fence-${key}.json`, receipt]);
  }

  const journalPath = join(custody, FILES.rehearsalJournal);
  const receiptPath = join(custody, FILES.rehearsalReceipt);
  const admissionPath = join(custody, FILES.rehearsalAdmission);
  const rollback = input.rollbackReadbackReceipt;
  const admission = {
    attemptId: input.attemptId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    id: manifestRecord.manifest.id,
    journalPathSha256: sha256(Buffer.from(journalPath)),
    kind: 'successor-rehearsal-admission',
    manifestSha256: manifestRecord.manifestSha256,
    projectRef: manifestRecord.manifest.projectRef,
    protectedMainReceiptSha256: sha256(protectedMainBytes),
    purpose: manifestRecord.manifest.purpose,
    receiptPathSha256: sha256(Buffer.from(receiptPath)),
    rollback: {
      deploymentId: rollback.deploymentId,
      deploymentSha: rollback.deploymentSha,
      deploymentUrl: rollback.deploymentUrl,
      gitRef: rollback.gitRef,
      productionAliases: rollback.productionAliases,
      projectId: rollback.projectId,
      readbackSha256: sha256(rollbackBytes),
      readyState: rollback.readyState,
      repository: rollback.repository,
      state: rollback.state,
      target: rollback.target,
      teamId: rollback.teamId,
    },
    schemaVersion: 1,
    sourceReceiptSha256: sha256(sourceBytes),
    sourceRevision: input.sourceRevision,
    sourceRoot: input.sourceRoot,
    writerFences,
  };

  for (const [name, document] of receiptDocuments) {
    writeExclusiveCanonical(join(custody, name), document, fsyncImpl);
  }
  const admissionBytes = writeExclusiveCanonical(admissionPath, admission, fsyncImpl);
  syncDirectory(custody, fsyncImpl);
  validateSuccessorRehearsalAdmission(admission, manifestRecord, {
    now,
    receiptDirectory: custody,
  });
  if (pathEntryExists(journalPath) || pathEntryExists(receiptPath)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  }
  return Object.freeze({
    admissionPath,
    admissionSha256: sha256(admissionBytes),
    custodyDirectory: custody,
    expiresAt: admission.expiresAt,
    journalPath,
    mode: 'rehearsal',
    receiptPath,
    status: 'prepared',
  });
}

function readCanonicalCustodyFile(custody, name) {
  return readPrivateCanonicalJson(join(custody, name), 'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
}

function readCanonicalCustodyJournal(custody, name) {
  const path = assertOutsideRepository(
    join(custody, name),
    'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID',
  );
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const status = fstatSync(descriptor);
    const named = lstatSync(path);
    if (!status.isFile()
      || named.isSymbolicLink()
      || status.dev !== named.dev
      || status.ino !== named.ino
      || dirname(realpathSync(path)) !== custody
      || (process.platform !== 'win32' && (status.mode & 0o077) !== 0)) {
      fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    }
    const bytes = readBoundedDescriptor(
      descriptor,
      status,
      'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID',
    );
    const text = bytes.toString('utf8');
    const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : [];
    if (lines.length !== 3 || lines.some(line => !line)) {
      fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    }
    const entries = lines.map(line => {
      let entry;
      try { entry = JSON.parse(line); } catch { fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID'); }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || `${JSON.stringify(canonical(entry))}\n` !== `${line}\n`) {
        fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
      }
      return entry;
    });
    return Object.freeze({ bytes, entries, path });
  } catch (error) {
    if (safeCode(error) === 'SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID') throw error;
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* bounded failure above */ }
    }
  }
}

function validateApplyInput(input, rehearsal, manifestRecord, now) {
  exactKeys(input, [
    'applyEvidenceMapSha256', 'applyQuiescenceReadbackSha256',
    'attemptId', 'expiresAt', 'kind', 'manifestSha256', 'observedAt',
    'rehearsalAdmissionSha256', 'rehearsalJournalSha256', 'rehearsalReceiptSha256',
    'schemaVersion', 'sourceRevision',
  ], 'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID');
  if (input.schemaVersion !== 1
    || input.kind !== 'review-media-successor-apply-admission-input'
    || input.manifestSha256 !== manifestRecord.manifestSha256
    || input.sourceRevision !== rehearsal.sourceRevision
    || input.expiresAt !== rehearsal.expiresAt) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  assertUuid(input.attemptId);
  assertHex(input.applyEvidenceMapSha256);
  assertHex(input.applyQuiescenceReadbackSha256);
  assertHex(input.rehearsalAdmissionSha256);
  assertHex(input.rehearsalJournalSha256);
  assertHex(input.rehearsalReceiptSha256);
  const window = assertWindow(rehearsal.createdAt, rehearsal.expiresAt, now);
  const observedAt = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAt)
    || observedAt < window.createdAt
    || observedAt >= window.expiresAt
    || observedAt > window.nowMs + CLOCK_SKEW_MS) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  return Object.freeze({ ...window, observedAt });
}

function validateApplyOperatingEvidence({
  custody,
  input,
  manifestRecord,
  minimumObservedAt,
  rehearsal,
  window,
}) {
  const { manifest, manifestSha256 } = manifestRecord;
  const attestationRecord = readCanonicalCustodyFile(custody, 'operator-custody-attestation.json');
  const bundleRecord = readCanonicalCustodyFile(custody, 'vercel-operating-bundle.json');
  const machineRecord = readCanonicalCustodyFile(custody, FILES.applyMachine);
  const mapRecord = readCanonicalCustodyFile(custody, FILES.applyEvidenceMap);
  const quiescenceRecord = readCanonicalCustodyFile(custody, FILES.applyQuiescence);
  if (sha256(mapRecord.bytes) !== input.applyEvidenceMapSha256
    || sha256(quiescenceRecord.bytes) !== input.applyQuiescenceReadbackSha256) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const map = mapRecord.value;
  exactKeys(map, [
    'attestationSha256', 'bundleSha256', 'kind', 'machineSha256', 'quiescenceSha256',
    'receiptProvenance', 'schemaVersion', 'sourceRevision',
  ]);
  if (map.schemaVersion !== 1
    || map.kind !== 'review-media-successor-apply-operating-evidence-map'
    || map.sourceRevision !== rehearsal.sourceRevision
    || map.attestationSha256 !== sha256(attestationRecord.bytes)
    || map.bundleSha256 !== sha256(bundleRecord.bytes)
    || map.machineSha256 !== sha256(machineRecord.bytes)
    || map.quiescenceSha256 !== sha256(quiescenceRecord.bytes)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const attestation = attestationRecord.value;
  exactKeys(attestation, [
    'assertedAt', 'authority', 'basis', 'event', 'fences', 'kind', 'noticeState',
    'operatorRole', 'repository', 'runAttempt', 'runId', 'schemaVersion', 'scope',
    'sourceRevision', 'workflowRef',
  ]);
  exactKeys(attestation.fences, ['browserRpc', 'dashboard', 'directSql', 'providerIngress']);
  if (attestation.schemaVersion !== 1
    || attestation.kind !== 'review-media-successor-operator-custody-attestation'
    || attestation.authority !== 'authenticated-repository-owner-workflow-dispatch'
    || attestation.basis !== 'standing-custody-confirmation-bound-by-owner-dispatch'
    || attestation.event !== 'workflow_dispatch'
    || attestation.noticeState !== 'not-issued'
    || attestation.operatorRole !== 'repository-owner'
    || attestation.repository !== TZUDONG_GITHUB_REPOSITORY
    || !DECIMAL_ID.test(attestation.runAttempt ?? '')
    || !DECIMAL_ID.test(attestation.runId ?? '')
    || attestation.scope !== 'stopped-until-application-result'
    || attestation.sourceRevision !== rehearsal.sourceRevision
    || typeof attestation.workflowRef !== 'string'
    || !attestation.workflowRef.startsWith(`${TZUDONG_GITHUB_REPOSITORY}/.github/workflows/`)
    || !attestation.workflowRef.endsWith('@refs/heads/main')
    || Object.values(attestation.fences).some(state => state !== 'stopped')) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const bundle = bundleRecord.value;
  exactKeys(bundle, [
    'adminRecordMutationsHold', 'createdAt', 'expiresAt', 'kind', 'manifestSha256',
    'protectedMain', 'rollbackPolicy', 'rollbackReadback', 'schemaVersion',
    'sourceRevision', 'sourceRoot', 'storyboardPolicy',
  ]);
  exactKeys(bundle.adminRecordMutationsHold, [
    'commit', 'deploymentId', 'holdActive', 'observedAt',
  ]);
  exactKeys(bundle.storyboardPolicy, ['deployment', 'policy', 'schemaVersion']);
  exactKeys(bundle.storyboardPolicy.deployment, [
    'branch', 'deploymentId', 'sourceCommit',
  ]);
  exactKeys(bundle.storyboardPolicy.policy, ['canonicalPolicySha256']);
  if (bundle.schemaVersion !== 1
    || bundle.kind !== 'review-media-successor-vercel-operating-bundle'
    || bundle.manifestSha256 !== manifestSha256
    || bundle.sourceRevision !== rehearsal.sourceRevision
    || bundle.sourceRoot !== manifest.sourceRoot
    || bundle.createdAt !== rehearsal.createdAt
    || bundle.expiresAt !== rehearsal.expiresAt
    || bundle.adminRecordMutationsHold.holdActive !== true
    || bundle.adminRecordMutationsHold.deploymentId !== rehearsal.rollback.deploymentId
    || bundle.adminRecordMutationsHold.commit !== rehearsal.sourceRevision
    || bundle.rollbackReadback?.deploymentId !== rehearsal.rollback.deploymentId
    || bundle.rollbackReadback?.gitSha !== rehearsal.rollback.deploymentSha
    || bundle.storyboardPolicy.schemaVersion !== 1
    || bundle.storyboardPolicy.deployment.branch !== 'main'
    || bundle.storyboardPolicy.deployment.deploymentId !== rehearsal.rollback.deploymentId
    || bundle.storyboardPolicy.deployment.sourceCommit !== rehearsal.sourceRevision
    || !HEX_SHA256.test(bundle.storyboardPolicy.policy.canonicalPolicySha256 ?? '')) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const machine = machineRecord.value;
  exactKeys(machine, [
    'adminRuntimeHold', 'automaticReviewer', 'g037WriteFreeze', 'inFlightQuiescence',
    'kind', 'schemaVersion', 'sourceRevision',
  ]);
  exactKeys(machine.adminRuntimeHold, ['deploymentId', 'holdActive', 'observedAt']);
  exactKeys(machine.automaticReviewer, ['observedAt', 'state']);
  exactKeys(machine.g037WriteFreeze, ['observedAt', 'state']);
  exactKeys(machine.inFlightQuiescence, [
    'coverage', 'inFlightWriters', 'lockMode', 'observedAt',
  ]);
  if (machine.schemaVersion !== 1
    || machine.kind !== 'review-media-successor-machine-operating-observations'
    || machine.sourceRevision !== rehearsal.sourceRevision
    || machine.adminRuntimeHold.holdActive !== true
    || machine.adminRuntimeHold.deploymentId !== rehearsal.rollback.deploymentId
    || machine.adminRuntimeHold.observedAt !== bundle.adminRecordMutationsHold.observedAt
    || machine.automaticReviewer.state !== 'stopped'
    || machine.g037WriteFreeze.state !== 'active') {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const quiescence = quiescenceRecord.value;
  exactKeys(quiescence, [
    'coverage', 'expiresAt', 'id', 'inFlightWriters', 'kind', 'lockMode',
    'manifestSha256', 'observedAt', 'projectRef', 'purpose', 'schemaVersion',
    'sourceRevision',
  ]);
  if (quiescence.schemaVersion !== 1
    || quiescence.kind !== 'apply-in-flight-quiescence-readback'
    || quiescence.id !== manifest.id
    || quiescence.projectRef !== manifest.projectRef
    || quiescence.purpose !== manifest.purpose
    || quiescence.manifestSha256 !== manifestSha256
    || quiescence.sourceRevision !== rehearsal.sourceRevision
    || quiescence.expiresAt !== rehearsal.expiresAt
    || !equal(quiescence.coverage, QUIESCENCE_RELATIONS)
    || !equal(quiescence.coverage, machine.inFlightQuiescence.coverage)
    || quiescence.inFlightWriters !== machine.inFlightQuiescence.inFlightWriters
    || quiescence.lockMode !== machine.inFlightQuiescence.lockMode
    || quiescence.observedAt !== machine.inFlightQuiescence.observedAt
    || quiescence.inFlightWriters !== 0
    || quiescence.lockMode !== 'SHARE') {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const freshTimes = [
    machine.automaticReviewer.observedAt,
    machine.g037WriteFreeze.observedAt,
    machine.inFlightQuiescence.observedAt,
    quiescence.observedAt,
  ].map(value => Date.parse(value));
  if (freshTimes.some(value => !Number.isFinite(value)
    || value < minimumObservedAt
    || value >= window.expiresAt
    || value > window.nowMs + CLOCK_SKEW_MS)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }

  const fenceKeys = Object.keys(manifest.requiredWriterFences).sort();
  exactKeys(map.receiptProvenance, fenceKeys);
  const writerFences = {};
  for (const key of fenceKeys) {
    const receiptRecord = readCanonicalCustodyFile(custody, applyWriterFenceFile(key));
    const receipt = receiptRecord.value;
    exactKeys(receipt, [
      'expiresAt', 'fence', 'id', 'kind', 'manifestSha256', 'observedAt', 'projectRef',
      'purpose', 'schemaVersion', 'sourceRevision', 'state',
    ]);
    exactKeys(map.receiptProvenance[key], ['evidenceSha256', 'provenance', 'receiptSha256']);
    const operator = ['browserRpc', 'dashboard', 'directSql', 'providerIngress'].includes(key);
    const expectedProvenance = operator
      ? 'authenticated-owner-custody-commitment'
      : key === 'adminRecordMutationsHold'
        ? 'immutable-deployment-machine-observation'
        : 'fresh-machine-observation';
    const expectedEvidenceSha256 = operator
      ? map.attestationSha256
      : key === 'adminRecordMutationsHold'
        ? map.bundleSha256
        : map.machineSha256;
    const expectedObservedAt = operator
      ? attestation.assertedAt
      : key === 'adminRecordMutationsHold'
        ? bundle.adminRecordMutationsHold.observedAt
        : key === 'automaticReviewer'
          ? machine.automaticReviewer.observedAt
          : machine.g037WriteFreeze.observedAt;
    if (receipt.schemaVersion !== 1
      || receipt.kind !== 'writer-fence-readback-receipt'
      || receipt.id !== manifest.id
      || receipt.projectRef !== manifest.projectRef
      || receipt.purpose !== manifest.purpose
      || receipt.manifestSha256 !== manifestSha256
      || receipt.sourceRevision !== rehearsal.sourceRevision
      || receipt.expiresAt !== rehearsal.expiresAt
      || receipt.fence !== key
      || receipt.state !== manifest.requiredWriterFences[key]
      || receipt.observedAt !== expectedObservedAt
      || map.receiptProvenance[key].provenance !== expectedProvenance
      || map.receiptProvenance[key].evidenceSha256 !== expectedEvidenceSha256
      || map.receiptProvenance[key].receiptSha256 !== sha256(receiptRecord.bytes)) {
      fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    }
    if (['automaticReviewer', 'g037WriteFreeze'].includes(key)
      && Date.parse(receipt.observedAt) < minimumObservedAt) {
      fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
    }
    writerFences[key] = Object.freeze({
      evidenceSha256: sha256(receiptRecord.bytes),
      state: receipt.state,
    });
  }
  return Object.freeze({ writerFences });
}

export function prepareReviewMediaApplyAdmission({
  custodyDirectory,
  fsyncImpl = fsyncSync,
  inputPath,
  manifestRecord = loadSuccessorManifest(),
  now = new Date(),
} = {}) {
  const inputRecord = readPrivateCanonicalJson(inputPath);
  const custody = existingCustodyDirectory(custodyDirectory);
  const rehearsalAdmissionRecord = readCanonicalCustodyFile(custody, FILES.rehearsalAdmission);
  const rehearsal = rehearsalAdmissionRecord.value;
  const window = validateApplyInput(inputRecord.value, rehearsal, manifestRecord, now);
  if (sha256(rehearsalAdmissionRecord.bytes) !== inputRecord.value.rehearsalAdmissionSha256) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  validateSuccessorRehearsalAdmission(rehearsal, manifestRecord, {
    now,
    receiptDirectory: custody,
  });

  const rehearsalReceiptRecord = readCanonicalCustodyFile(custody, FILES.rehearsalReceipt);
  const rehearsalJournalRecord = readCanonicalCustodyJournal(custody, FILES.rehearsalJournal);
  const rehearsalJournalBytes = rehearsalJournalRecord.bytes;
  if (sha256(rehearsalReceiptRecord.bytes) !== inputRecord.value.rehearsalReceiptSha256
    || sha256(rehearsalJournalBytes) !== inputRecord.value.rehearsalJournalSha256) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  const receipt = rehearsalReceiptRecord.value;
  if (receipt.admissionSha256 !== inputRecord.value.rehearsalAdmissionSha256
    || receipt.expiresAt !== rehearsal.expiresAt) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  const stageStatesSha256 = sha256(JSON.stringify(canonical(receipt.stageStates)));
  const priorStateSha256 = sha256(JSON.stringify(canonical(receipt.stageStates?.[0])));
  const receiptBindings = {
    admissionSha256: HEX_SHA256.test(receipt.admissionSha256 ?? ''),
    attemptId: receipt.attemptId === rehearsal.attemptId,
    common: receipt.schemaVersion === 1
      && receipt.id === manifestRecord.manifest.id
      && receipt.projectRef === manifestRecord.manifest.projectRef
      && receipt.purpose === manifestRecord.manifest.purpose
      && receipt.manifestSha256 === manifestRecord.manifestSha256
      && receipt.sourceRevision === rehearsal.sourceRevision,
    kind: receipt.kind === 'successor-rehearsal-receipt',
    journalPathSha256: receipt.journalPathSha256 === sha256(Buffer.from(rehearsalJournalRecord.path)),
    passed: receipt.passed === true,
    preflightStateSha256: receipt.preflightStateSha256 === priorStateSha256,
    restoredStateSha256: receipt.restoredStateSha256 === priorStateSha256,
    serverMajor: Number.isSafeInteger(receipt.serverVersionNum)
      && Math.floor(receipt.serverVersionNum / 10_000) === manifestRecord.manifest.serverMajor,
    sourceRoot: receipt.sourceRoot === manifestRecord.manifest.sourceRoot,
    stageStatesSha256: receipt.stageStatesSha256 === stageStatesSha256,
    suffixRoot: receipt.suffixRoot === elevenMigrationBundleSuffixRoot(manifestRecord.manifest.migrations),
  };
  if (Object.values(receiptBindings).some(value => !value)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  const publication = rehearsalJournalRecord.entries[2];
  const publishedAt = Date.parse(publication.publishedAt);
  if (!Number.isFinite(publishedAt) || window.observedAt < publishedAt) {
    fail('SUCCESSOR_OPERATING_ADMISSION_EVIDENCE_INVALID');
  }
  const applyOperatingEvidence = validateApplyOperatingEvidence({
    custody,
    input: inputRecord.value,
    manifestRecord,
    minimumObservedAt: publishedAt,
    rehearsal,
    window,
  });

  const applyAdmissionPath = join(custody, FILES.applyAdmission);
  const applyJournalPath = join(custody, FILES.applyJournal);
  if (pathEntryExists(applyAdmissionPath) || pathEntryExists(applyJournalPath)) {
    fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  }
  const admission = {
    applyEvidenceMapSha256: inputRecord.value.applyEvidenceMapSha256,
    applyQuiescenceReadbackSha256: inputRecord.value.applyQuiescenceReadbackSha256,
    attemptId: inputRecord.value.attemptId,
    createdAt: rehearsal.createdAt,
    expiresAt: rehearsal.expiresAt,
    id: rehearsal.id,
    journalPathSha256: sha256(Buffer.from(applyJournalPath)),
    manifestSha256: rehearsal.manifestSha256,
    projectRef: rehearsal.projectRef,
    protectedMainReceiptSha256: rehearsal.protectedMainReceiptSha256,
    purpose: rehearsal.purpose,
    rehearsalAdmissionSha256: sha256(rehearsalAdmissionRecord.bytes),
    rehearsalJournalSha256: inputRecord.value.rehearsalJournalSha256,
    rehearsalReceiptSha256: inputRecord.value.rehearsalReceiptSha256,
    rollback: structuredClone(rehearsal.rollback),
    schemaVersion: 1,
    sourceReceiptSha256: rehearsal.sourceReceiptSha256,
    sourceRevision: rehearsal.sourceRevision,
    sourceRoot: rehearsal.sourceRoot,
    stageStates: receipt.stageStates,
    writerFences: structuredClone(applyOperatingEvidence.writerFences),
  };
  validateSuccessorAdmission(admission, manifestRecord, { now, receiptDirectory: custody });
  const admissionBytes = writeExclusiveCanonical(applyAdmissionPath, admission, fsyncImpl);
  syncDirectory(custody, fsyncImpl);
  if (pathEntryExists(applyJournalPath)) fail('SUCCESSOR_OPERATING_ADMISSION_OUTPUT_EXISTS');
  return Object.freeze({
    admissionPath: applyAdmissionPath,
    admissionSha256: sha256(admissionBytes),
    custodyDirectory: custody,
    expiresAt: admission.expiresAt,
    journalPath: applyJournalPath,
    mode: 'apply',
    status: 'prepared',
  });
}

export function parseOperatingAdmissionArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--mode', '--input', '--custody-dir'].includes(option)
      || !value
      || value.startsWith('--')
      || option.slice(2) in result) {
      fail('SUCCESSOR_OPERATING_ADMISSION_ARGUMENT_INVALID');
    }
    result[option.slice(2)] = value;
  }
  if (argv.length !== 6
    || !['rehearsal', 'apply'].includes(result.mode)
    || !result.input
    || !result['custody-dir']) {
    fail('SUCCESSOR_OPERATING_ADMISSION_ARGUMENT_INVALID');
  }
  return Object.freeze({
    custodyDirectory: result['custody-dir'],
    inputPath: result.input,
    mode: result.mode,
  });
}

export function operatingAdmissionFailureResult(error) {
  const observedCode = safeCode(error);
  const code = PUBLIC_CODES.has(observedCode)
    ? observedCode
    : 'SUCCESSOR_OPERATING_ADMISSION_INPUT_INVALID';
  return Object.freeze({ code, status: 'failed' });
}

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseOperatingAdmissionArguments(argv);
  const producer = args.mode === 'rehearsal'
    ? prepareReviewMediaRehearsalAdmission
    : prepareReviewMediaApplyAdmission;
  return producer({ ...dependencies, ...args });
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(main()));
  } catch (error) {
    console.error(JSON.stringify(operatingAdmissionFailureResult(error)));
    process.exitCode = 1;
  }
}
