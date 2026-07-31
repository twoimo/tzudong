#!/usr/bin/env node
/** Guarded dry-run/apply boundary for Tzuyang address evidence ledger. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logSafeError } from '../utils/privacy-log.mjs';
import {
  ADDRESS_EVIDENCE_LIMITS,
  canonicalizeIJson,
  computeAddressPredicate,
  loadAddressEvidenceAdminApprovalAnchors,
  loadTrustAnchors,
  verifyAddressEvidenceAdminApproval,
  verifyAddressEvidenceBundle,
} from './address_evidence_trust.mjs';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEDGER_SNAPSHOT_FIELDS = [
  'status', 'channel_name', 'origin_name', 'approved_name', 'naver_name', 'google_name',
  'phone', 'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'origin_address_text', 'road_address', 'jibun_address',
  'english_address', 'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details',
  'updated_at',
];
const LEDGER_CHANGED_FIELDS = [
  'road_address', 'jibun_address', 'lat', 'lng', 'geocoding_success',
  'geocoding_false_stage', 'db_error_message', 'db_error_details',
  'updated_by_admin_id', 'updated_at',
];
const LEDGER_EXPLICITLY_PRESERVED_FIELDS = LEDGER_SNAPSHOT_FIELDS.filter((field) => !LEDGER_CHANGED_FIELDS.includes(field) && field !== 'origin_address_text');
const RESTAURANT_LOCK_FIELDS = [
  'status', 'channel_name', 'origin_name', 'approved_name', 'naver_name', 'google_name',
  'phone', 'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'road_address', 'jibun_address',
  'english_address', 'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details',
  'updated_at',
];
const LEDGER_ARTIFACTS = ['apply-candidates.jsonl', 'operator-ledger-private.jsonl'];

class ArtifactBindingError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ArtifactBindingError';
    this.code = code;
  }
}

class ApplyTransactionError extends Error {
  constructor(reason, guardFailures = []) {
    super('apply_transaction_incomplete');
    this.name = 'ApplyTransactionError';
    this.code = 'APPLY_TRANSACTION_INCOMPLETE';
    this.reason = reason;
    this.guardFailures = guardFailures;
  }
}

function artifactError(code) { return new ArtifactBindingError(code); }
function transactionError(reason, guardFailures = []) { return new ApplyTransactionError(reason, guardFailures); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function line(row) { return `${JSON.stringify(row)}\n`; }
function isPresent(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function sameInstant(a, b) {
  try { return Boolean(a && b) && new Date(a).toISOString() === new Date(b).toISOString(); } catch { return false; }
}
function firstCandidate(row) { return Array.isArray(row.candidate_places) ? row.candidate_places[0] || {} : {}; }
function validCoordinates(lat, lng) {
  return typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function parseArgs(argv) {
  const args = {
    ledgerDir: '',
    reviewManifest: '',
    confirmationDigest: '',
    apply: false,
    allowDbWrite: false,
    fixtureDryRun: false,
    adminUserId: '',
    adminApproval: '',
    operationId: '',
    ids: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ledger-dir') args.ledgerDir = argv[++i] || '';
    else if (arg === '--review-manifest') args.reviewManifest = argv[++i] || '';
    else if (arg === '--confirm-manifest-sha256') args.confirmationDigest = argv[++i] || '';
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--allow-db-write') args.allowDbWrite = true;
    else if (arg === '--fixture-dry-run') args.fixtureDryRun = true;
    else if (arg === '--admin-user-id') args.adminUserId = argv[++i] || '';
    else if (arg === '--admin-approval') args.adminApproval = argv[++i] || '';
    else if (arg === '--operation-id') args.operationId = argv[++i] || '';
    else if (arg === '--ids') args.ids = (argv[++i] || '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/apply_tzuyang_address_evidence_ledger.mjs --ledger-dir DIR --review-manifest NAME --confirm-manifest-sha256 LOWERCASE_SHA256 [--apply --allow-db-write --admin-user-id UUID --admin-approval NAME --operation-id UUID] [--ids id1,id2] [--fixture-dry-run]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.apply && !args.allowDbWrite) throw new Error('--apply requires explicit --allow-db-write');
  if (args.apply && !CANONICAL_UUID_RE.test(args.adminUserId)) throw new Error('--apply requires canonical --admin-user-id');
  if (args.apply && !args.adminApproval) throw artifactError('ADMIN_APPROVAL_REQUIRED');
  if (args.apply && !CANONICAL_UUID_RE.test(args.operationId)) throw artifactError('ADMIN_APPROVAL_OPERATION_REQUIRED');
  if (args.apply) validateInputName(args.adminApproval);
  if (args.fixtureDryRun && (args.apply || args.allowDbWrite)) throw new Error('--fixture-dry-run cannot be combined with write flags');
  if (!args.ledgerDir) throw new Error('--ledger-dir is required');
  if (!args.reviewManifest) throw artifactError('ARTIFACT_MANIFEST_REQUIRED');
  if (!args.confirmationDigest) throw artifactError('ARTIFACT_CONFIRMATION_REQUIRED');
  if (!SHA256_RE.test(args.confirmationDigest)) throw artifactError('ARTIFACT_CONFIRMATION_INVALID');
  return args;
}

function decodeUtf8(buffer, code) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw artifactError(code); }
}

function parseJsonl(buffer) {
  try {
    if (buffer.length > ADDRESS_EVIDENCE_LIMITS.maxLedgerBytes) throw artifactError('ledger_jsonl_bytes_exceeded');
    const rows = [];
    for (const rawLine of decodeUtf8(buffer, 'ARTIFACT_PARSE_INVALID').split('\n')) {
      const item = rawLine.trim();
      if (!item) continue;
      if (Buffer.byteLength(item, 'utf8') > ADDRESS_EVIDENCE_LIMITS.maxJsonlLineBytes) throw artifactError('ledger_jsonl_line_exceeded');
      if (rows.length >= ADDRESS_EVIDENCE_LIMITS.maxLedgerRows) throw artifactError('ledger_row_count_exceeded');
      const row = JSON.parse(item);
      canonicalizeIJson(row);
      rows.push(row);
    }
    return rows;
  } catch (error) {
    if (error instanceof ArtifactBindingError) throw error;
    throw artifactError('ARTIFACT_PARSE_INVALID');
  }
}

function validateInputName(name) {
  if (typeof name !== 'string' || !name || name !== name.normalize('NFC') || name.includes('\\') || name.includes('/') || name.includes('\0') || name === '.' || name === '..') throw artifactError('ARTIFACT_NAME_INVALID');
  return name;
}

function portableName(name) { return validateInputName(name).toLowerCase(); }
function canonicalManifestBytes(manifest) {
  return Buffer.from(`${JSON.stringify({ schema_version: 1, artifacts: manifest.artifacts.map((artifact) => ({ name: artifact.name, byte_length: artifact.byte_length, sha256: artifact.sha256, identity: artifact.identity })) })}\n`, 'utf8');
}

function validateManifest(buffer, confirmationDigest, expectedNames) {
  let manifest;
  try { manifest = JSON.parse(decodeUtf8(buffer, 'ARTIFACT_MANIFEST_MALFORMED')); } catch (error) {
    if (error instanceof ArtifactBindingError) throw error;
    throw artifactError('ARTIFACT_MANIFEST_MALFORMED');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).length !== 2 || manifest.schema_version !== 1 || !Array.isArray(manifest.artifacts)) throw artifactError('ARTIFACT_MANIFEST_MALFORMED');
  const names = new Set();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact) || Object.keys(artifact).length !== 4) throw artifactError('ARTIFACT_MANIFEST_MALFORMED');
    const name = validateInputName(artifact.name);
    const portable = portableName(name);
    if (names.has(portable)) throw artifactError('ARTIFACT_NAME_DUPLICATE');
    names.add(portable);
    if (!Number.isSafeInteger(artifact.byte_length) || artifact.byte_length < 0 || artifact.byte_length > MAX_ARTIFACT_BYTES || !SHA256_RE.test(artifact.sha256) || artifact.identity !== 'regular_file') throw artifactError('ARTIFACT_MANIFEST_MALFORMED');
  }
  if (!buffer.equals(canonicalManifestBytes(manifest))) throw artifactError('ARTIFACT_MANIFEST_MALFORMED');
  const expected = new Set(expectedNames.map(portableName));
  if (manifest.artifacts.length !== expectedNames.length
    || manifest.artifacts.some((artifact, index) => artifact.name !== expectedNames[index])) throw artifactError('ARTIFACT_MANIFEST_ORDER_INVALID');
  if (manifest.artifacts.some((artifact) => !expectedNames.includes(artifact.name))) throw artifactError('ARTIFACT_MANIFEST_INPUT_SET_INVALID');
  if (names.size !== expected.size || [...names].some((name) => !expected.has(name))) throw artifactError('ARTIFACT_MANIFEST_INPUT_SET_INVALID');
  if (!timingSafeEqual(Buffer.from(sha256(buffer), 'hex'), Buffer.from(confirmationDigest, 'hex'))) throw artifactError('ARTIFACT_CONFIRMATION_MISMATCH');
  return manifest.artifacts;
}

function assertRegular(stat, code) {
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_ARTIFACT_BYTES) throw artifactError(code);
}
function stableIdentity(stat) { return { dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }

async function readHandleBounded(handle, size, code) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARTIFACT_BYTES) throw artifactError(code);
  const hash = createHash('sha256');
  const chunks = [];
  let offset = 0;
  while (offset < size) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, size - offset));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (bytesRead === 0) throw artifactError(code);
    const exact = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
    hash.update(exact);
    chunks.push(exact);
    offset += bytesRead;
  }
  const extra = Buffer.allocUnsafe(1);
  if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) throw artifactError(code);
  return { bytes: Buffer.concat(chunks, size), sha256: hash.digest('hex') };
}

async function readStableFile(root, name, maxBytes = MAX_ARTIFACT_BYTES) {
  validateInputName(name);
  const file = path.resolve(root, name);
  if (path.dirname(file) !== root) throw artifactError('ARTIFACT_FILE_INVALID');
  let handle;
  try {
    const before = await fs.lstat(file);
    assertRegular(before, 'ARTIFACT_FILE_INVALID');
    if (before.size > maxBytes) throw artifactError('ARTIFACT_FILE_INVALID');
    const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
    handle = await fs.open(file, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    assertRegular(opened, 'ARTIFACT_FILE_INVALID');
    if (!sameIdentity(stableIdentity(before), stableIdentity(opened))) throw artifactError('ARTIFACT_IDENTITY_CHANGED');
    const content = await readHandleBounded(handle, opened.size, 'ARTIFACT_IDENTITY_CHANGED');
    const after = await fs.lstat(file);
    const ended = await handle.stat();
    assertRegular(after, 'ARTIFACT_IDENTITY_CHANGED');
    assertRegular(ended, 'ARTIFACT_IDENTITY_CHANGED');
    if (!sameIdentity(stableIdentity(before), stableIdentity(after)) || !sameIdentity(stableIdentity(opened), stableIdentity(ended))) throw artifactError('ARTIFACT_IDENTITY_CHANGED');
    return { name, file, handle, identity: stableIdentity(ended), bytes: content.bytes, sha256: content.sha256 };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error instanceof ArtifactBindingError) throw error;
    throw artifactError('ARTIFACT_FILE_INVALID');
  }
}

async function recheckArtifact(artifact, expected) {
  try {
    const before = await fs.lstat(artifact.file);
    const opened = await artifact.handle.stat();
    assertRegular(before, 'ARTIFACT_IDENTITY_CHANGED');
    assertRegular(opened, 'ARTIFACT_IDENTITY_CHANGED');
    if (!sameIdentity(artifact.identity, stableIdentity(before)) || !sameIdentity(artifact.identity, stableIdentity(opened))) throw artifactError('ARTIFACT_IDENTITY_CHANGED');
    const content = await readHandleBounded(artifact.handle, opened.size, 'ARTIFACT_IDENTITY_CHANGED');
    const after = await fs.lstat(artifact.file);
    const ended = await artifact.handle.stat();
    if (!sameIdentity(artifact.identity, stableIdentity(after)) || !sameIdentity(artifact.identity, stableIdentity(ended))) throw artifactError('ARTIFACT_IDENTITY_CHANGED');
    if (content.bytes.length !== expected.byte_length || content.sha256 !== expected.sha256) throw artifactError('ARTIFACT_FILE_MISMATCH');
  } catch (error) {
    if (error instanceof ArtifactBindingError) throw error;
    throw artifactError('ARTIFACT_IDENTITY_CHANGED');
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validateLedgerRows(ledgerRows, candidateRows) {
  const ledgerById = new Map();
  for (const row of ledgerRows) {
    const reviewedIdentity = canonicalYoutubeIdentity(row?.db_snapshot?.youtube_link);
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isPresent(row.id) || ledgerById.has(row.id)
      || row.schema_version !== 2
      || !row.db_snapshot || typeof row.db_snapshot !== 'object' || Array.isArray(row.db_snapshot)
      || row.youtube_link !== row.db_snapshot.youtube_link
      || !reviewedIdentity
      || row.video_id !== reviewedIdentity.slice('youtube:'.length)
      || !['apply', 'hold', 'review'].includes(row.operator_decision)
      || LEDGER_SNAPSHOT_FIELDS.some((field) => !Object.hasOwn(row.db_snapshot, field))) throw artifactError('ARTIFACT_BINDING_INVALID');
    ledgerById.set(row.id, row);
  }
  const candidateIds = new Set();
  for (const row of candidateRows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !isPresent(row.id) || candidateIds.has(row.id)) throw artifactError('ARTIFACT_BINDING_INVALID');
    candidateIds.add(row.id);
    const ledger = ledgerById.get(row.id);
    if (!ledger || stableJson(ledger) !== stableJson(row) || row.decision !== 'apply_candidate' || row.operator_decision !== 'apply') throw artifactError('ARTIFACT_BINDING_INVALID');
  }
  const expectedCandidates = ledgerRows.filter((row) => row.decision === 'apply_candidate' && row.operator_decision === 'apply');
  if (expectedCandidates.length !== candidateRows.length || expectedCandidates.some((row) => !candidateIds.has(row.id))) throw artifactError('ARTIFACT_BINDING_INVALID');
}

export async function bindLedgerReviewArtifacts({ ledgerDir, reviewManifest, confirmationDigest }) {
  const requestedRoot = path.resolve(ledgerDir);
  const opened = [];
  try {
    const rootStat = await fs.lstat(requestedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw artifactError('ARTIFACT_DIRECTORY_INVALID');
    const root = await fs.realpath(requestedRoot);
    validateInputName(reviewManifest);
    if (LEDGER_ARTIFACTS.includes(reviewManifest)) throw artifactError('ARTIFACT_MANIFEST_INPUT_SET_INVALID');
    const manifest = await readStableFile(root, reviewManifest, MAX_MANIFEST_BYTES);
    opened.push(manifest);
    const entries = validateManifest(manifest.bytes, confirmationDigest, LEDGER_ARTIFACTS);
    const expectedByName = new Map([[manifest.name, { byte_length: manifest.bytes.length, sha256: manifest.sha256 }], ...entries.map((entry) => [entry.name, entry])]);
    for (const name of LEDGER_ARTIFACTS) {
      const artifact = await readStableFile(root, name);
      const expected = expectedByName.get(name);
      if (artifact.bytes.length !== expected.byte_length || artifact.sha256 !== expected.sha256) {
        await artifact.handle.close();
        throw artifactError('ARTIFACT_FILE_MISMATCH');
      }
      opened.push(artifact);
    }
    const byName = new Map(opened.map((artifact) => [artifact.name, artifact]));
    const ledgerRows = parseJsonl(byName.get('operator-ledger-private.jsonl').bytes);
    const candidateRows = parseJsonl(byName.get('apply-candidates.jsonl').bytes);
    validateLedgerRows(ledgerRows, candidateRows);
    return {
      root,
      rootIdentity: stableIdentity(rootStat),
      confirmationDigest,
      reviewedArtifacts: entries,
      ledgerRows,
      candidateRows,
      async recheck() { await Promise.all(opened.map((artifact) => recheckArtifact(artifact, expectedByName.get(artifact.name)))); },
      async close() { await Promise.all(opened.map((artifact) => artifact.handle.close().catch(() => {}))); },
    };
  } catch (error) {
    await Promise.all(opened.map((artifact) => artifact.handle.close().catch(() => {})));
    if (error instanceof ArtifactBindingError) throw error;
    throw artifactError('ARTIFACT_FILE_INVALID');
  }
}

function trustedCandidateFromLedgerRow(ledgerRow) {
  const reviewedIdentity = reviewedYoutubeIdentity(ledgerRow);
  const reviewedVideoId = reviewedIdentity.slice('youtube:'.length);
  if (!ledgerRow || typeof ledgerRow !== 'object' || Array.isArray(ledgerRow)
    || !isPresent(ledgerRow.id) || ledgerRow.video_id !== reviewedVideoId || !isPresent(ledgerRow.query_sha256)
    || !Array.isArray(ledgerRow.candidate_places) || ledgerRow.candidate_places.length !== 1) {
    throw artifactError('invalid_trusted_ledger_candidate');
  }
  const place = ledgerRow.candidate_places[0];
  if (!place || typeof place !== 'object' || Array.isArray(place)) throw artifactError('invalid_trusted_ledger_candidate');
  return {
    restaurant_id: String(ledgerRow.id),
    video_id: reviewedVideoId,
    query_sha256: ledgerRow.query_sha256,
    place: {
      name: place.name,
      road_address: place.road_address,
      jibun_address: place.jibun_address,
      lat: place.lat,
      lng: place.lng,
    },
  };
}

function verifierEvidenceClasses(verification) {
  return {
    signed_video_manifest: true,
    signed_provider_receipt_count: verification.providers.length,
    independently_signed_provider_receipts: verification.providers.length >= 2,
  };
}

function expectedDecision(ledgerRow, predicate) {
  if (ledgerRow.scope_status === 'excluded') return 'excluded';
  return ledgerRow.scope_status === 'target' && predicate.pass ? 'apply_candidate' : 'manual_review';
}

function assertVerifierClaims(ledgerRow, verification, predicate) {
  if (ledgerRow.schema_version !== 2) throw artifactError('unsupported_ledger_schema');
  const expectedClasses = verifierEvidenceClasses(verification);
  const expectedVerifierResult = {
    schema_version: 2,
    ok: true,
    code: null,
    predicate,
    trust_summary: predicate.trust_summary,
  };
  const requiredClaims = [
    ['strict_predicate_result', predicate],
    ['trust_summary', verification.trust_summary],
    ['evidence_families', predicate.families],
    ['evidence_classes', expectedClasses],
    ['verifier_result', expectedVerifierResult],
    ['trust_failure_code', null],
    ['decision', expectedDecision(ledgerRow, predicate)],
  ];
  if (Object.hasOwn(ledgerRow, 'blocking_risk_flags')) requiredClaims.push(['blocking_risk_flags', predicate.blocking_risk_flags]);
  if (Object.hasOwn(ledgerRow, 'missing_requirements')) requiredClaims.push(['missing_requirements', predicate.missing_requirements]);
  for (const [field, expected] of requiredClaims) {
    if (!Object.hasOwn(ledgerRow, field) || stableJson(ledgerRow[field]) !== stableJson(expected)) {
      throw artifactError('trust_claim_mismatch');
    }
  }
}

export async function verifyLedgerTrustPreflight(rows) {
  const verifications = [];
  try {
    const anchors = await loadTrustAnchors(process.env);
    for (const ledgerRow of rows) {
      if (ledgerRow?.schema_version !== 2) throw artifactError('unsupported_ledger_schema');
      const verification = await verifyAddressEvidenceBundle({
        anchors,
        candidate: trustedCandidateFromLedgerRow(ledgerRow),
        trusted_evidence: ledgerRow.trusted_evidence,
        source_artifacts: ledgerRow.source_artifacts,
        record_selector_sha256: ledgerRow.record_selector_sha256,
        risk_flags: ledgerRow.risk_flags,
      });
      if (!verification.ok) throw artifactError(verification.code);
      verifications.push(verification);
      const predicate = computeAddressPredicate({ verification, risk_flags: ledgerRow.risk_flags });
      assertVerifierClaims(ledgerRow, verification, predicate);
    }
    return {
      anchors,
      async recheck() {
        for (const verification of verifications) await verification.recheck();
      },
      async close() {
        for (const verification of verifications) await verification.close().catch(() => {});
      },
    };
  } catch (error) {
    for (const verification of verifications) await verification.close().catch(() => {});
    throw error;
  }
}

function localGuardFailures(ledgerRow) {
  const failures = [];
  if (ledgerRow.decision !== 'apply_candidate') failures.push('ledger_decision_not_apply_candidate');
  if (ledgerRow.operator_decision !== 'apply') failures.push('operator_decision_not_apply');
  if (ledgerRow.scope_status !== 'target') failures.push('ledger_scope_not_target');
  return failures;
}

function normalizedOriginAddressText(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { /* The reviewed contract stores normalized text. */ }
  }
  if (parsed && typeof parsed === 'object') parsed = parsed.address || parsed.roadAddress || parsed.jibunAddress || parsed.fullAddress || '';
  return String(parsed ?? '').trim().replace(/\s+/g, ' ');
}

function snapshotValueMatches(field, actual, reviewed) {
  if (field === 'updated_at') return sameInstant(actual, reviewed);
  if (field === 'origin_address') return stableJson(actual) === stableJson(reviewed);
  if (field === 'origin_address_text') return normalizedOriginAddressText(actual) === reviewed;
  if (field === 'lat' || field === 'lng') return (actual === null && reviewed === null) || (Number.isFinite(Number(actual)) && Number(actual) === Number(reviewed));
  if (field === 'evaluation_results' || field === 'db_error_details') return stableJson(actual) === stableJson(reviewed);
  return actual === reviewed;
}

function reviewedSnapshotMatches(dbRow, ledgerRow) {
  const snapshot = ledgerRow.db_snapshot;
  return LEDGER_SNAPSHOT_FIELDS.every((field) => snapshotValueMatches(
    field,
    field === 'origin_address_text' ? dbRow.origin_address : dbRow[field],
    snapshot[field],
  ));
}

function operationReceipt(approval) {
  return {
    review_manifest_sha256: approval.reviewManifestSha256,
    approval_envelope_sha256: approval.approvalEnvelopeSha256,
    approval_signer_id: approval.signerId,
    operation_id: approval.operationId,
    actor_verification: 'verified_active_admin',
    approval_replay: 'consumed',
  };
}

function readbackMatchesPayload(readback, payload, locked) {
  const changedMatches = LEDGER_CHANGED_FIELDS.every((field) => {
    const actual = readback[field];
    const expected = payload[field];
    if (field === 'updated_at') return sameInstant(actual, expected);
    if (field === 'lat' || field === 'lng') return typeof expected === 'number' && Number.isFinite(Number(actual)) && Number(actual) === expected;
    if (expected && typeof expected === 'object') return stableJson(actual) === stableJson(expected);
    return actual === expected;
  });
  return changedMatches
    && validCoordinates(readback.lat, readback.lng)
    && LEDGER_EXPLICITLY_PRESERVED_FIELDS.every((field) => snapshotValueMatches(field, readback[field], locked[field]));
}

async function assertVerifiedAdminActor(client, adminUserId) {
  const { rows } = await client.query(
    `select role_row.user_id
     from user_roles as role_row
     inner join user_account_status as status_row on status_row.user_id = role_row.user_id
     where role_row.user_id = $1
       and role_row.role = 'admin'
       and status_row.account_status = 'active'
     for update of role_row, status_row`,
    [adminUserId],
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.user_id !== adminUserId) throw transactionError('actor_verification_failed');
}

async function consumeAdminApproval(client, approval) {
  let result;
  try {
    result = await client.query(
      `select consumed, reason
       from public.consume_tzuyang_address_evidence_admin_approval(
         $1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8::timestamptz, $9::timestamptz
       )`,
      [
        approval.operationId,
        approval.approvalEnvelopeSha256,
        approval.nonceSha256,
        approval.actorUserId,
        approval.reviewManifestSha256,
        approval.signerId,
        approval.action,
        approval.issuedAt,
        approval.expiresAt,
      ],
    );
  } catch (error) {
    if (error?.code === '42883') throw transactionError('admin_approval_replay_migration_required');
    throw error;
  }
  const receipt = result?.rows?.length === 1 ? result.rows[0] : null;
  if (!receipt || typeof receipt.consumed !== 'boolean') throw transactionError('admin_approval_consume_contract_invalid');
  if (!receipt.consumed) throw transactionError(receipt.reason === 'replayed' ? 'admin_approval_replayed' : 'admin_approval_rejected');
}

function dbGuardFailures(dbRow, ledgerRow) {
  const failures = [];
  if (!dbRow) return ['row_not_found'];
  const reviewedIdentity = reviewedYoutubeIdentity(ledgerRow);
  if (canonicalYoutubeIdentity(dbRow.youtube_link) !== reviewedIdentity) failures.push('reviewed_youtube_identity_mismatch');
  if (!reviewedSnapshotMatches(dbRow, ledgerRow)) failures.push('reviewed_snapshot_mismatch');
  if (dbRow.status === 'deleted') failures.push('deleted_status');
  if (dbRow.updated_by_admin_id) failures.push('admin_touched');
  if (dbRow.geocoding_success !== false) failures.push('not_currently_geocoding_false');
  if (dbRow.is_missing || dbRow.is_not_selected || dbRow.status === 'missing' || dbRow.status === 'not_selected') failures.push('missing_or_not_selected');
  if (dbRow.geocoding_false_stage === 0) failures.push('stage0_not_applyable');
  return failures;
}

function buildPayload(row, nowIso, adminUserId, receipt) {
  const candidate = firstCandidate(row);
  return {
    road_address: candidate.road_address || null,
    jibun_address: candidate.jibun_address || null,
    lat: Number(candidate.lat),
    lng: Number(candidate.lng),
    geocoding_success: true,
    geocoding_false_stage: null,
    db_error_message: null,
    db_error_details: {
      address_evidence_ledger: {
        schema_version: row.schema_version,
        generated_at: row.generated_at,
        decision: row.decision,
        evidence_families: row.evidence_families,
        source_artifacts: row.source_artifacts,
        applied_by_script: 'apply_tzuyang_address_evidence_ledger.mjs',
        applied_at: nowIso,
        operation_receipt: receipt,
      },
    },
    updated_by_admin_id: adminUserId,
    updated_at: nowIso,
  };
}

async function loadRuntimeEnv() {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), override: false });
}

async function createDatabaseClient() {
  const { createVerifiedPgClient } = await import('../utils/verified-pg-client.mjs');
  return createVerifiedPgClient({ applicationName: 'tzuyang-evidence-apply' });
}

function outputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requiresPosixPrivateMode() { return process.platform !== 'win32'; }

async function assertSafeDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw outputError('OUTPUT_DIRECTORY_INVALID');
}

async function assertPrivateDirectory(directory) {
  await assertSafeDirectory(directory);
  const stat = await fs.lstat(directory);
  if (requiresPosixPrivateMode() && (stat.mode & 0o077) !== 0) throw outputError('OUTPUT_DIRECTORY_INVALID');
}

async function createPrivateOutputDirectory(root, name, expectedRootIdentity) {
  validateInputName(name);
  const outputDir = path.resolve(root, name);
  if (path.dirname(outputDir) !== root) throw outputError('OUTPUT_DIRECTORY_INVALID');
  const rootStat = await fs.lstat(root);
  if (expectedRootIdentity && !sameIdentity(expectedRootIdentity, stableIdentity(rootStat))) throw outputError('OUTPUT_DIRECTORY_INVALID');
  await assertSafeDirectory(root);
  try {
    await fs.mkdir(outputDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw outputError('OUTPUT_DIRECTORY_EXISTS');
    throw outputError('OUTPUT_DIRECTORY_CREATE_FAILED');
  }
  await fs.chmod(outputDir, 0o700);
  await assertPrivateDirectory(outputDir);
  return outputDir;
}

async function syncDirectory(directory) {
  await assertPrivateDirectory(directory);
  if (process.platform === 'win32') return;
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw outputError('OUTPUT_DIRECTORY_INVALID');
    await handle.sync();
  } catch (error) {
    if (error?.code?.startsWith('OUTPUT_')) throw error;
    throw outputError('OUTPUT_DIRECTORY_SYNC_FAILED');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function assertOutputPathAbsent(file) {
  try {
    await fs.lstat(file);
    throw outputError('OUTPUT_FILE_EXISTS');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

async function atomicWritePrivateFile(outputDir, name, content) {
  validateInputName(name);
  await assertPrivateDirectory(outputDir);
  const finalPath = path.resolve(outputDir, name);
  if (path.dirname(finalPath) !== outputDir) throw outputError('OUTPUT_FILE_INVALID');
  await assertOutputPathAbsent(finalPath);
  const tempPath = path.join(outputDir, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow, 0o600);
    await fs.chmod(tempPath, 0o600);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.isSymbolicLink() || (requiresPosixPrivateMode() && (stat.mode & 0o077) !== 0)) throw outputError('OUTPUT_FILE_INVALID');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await assertPrivateDirectory(outputDir);
    await assertOutputPathAbsent(finalPath);
    await fs.link(tempPath, finalPath);
    await fs.unlink(tempPath);
    await syncDirectory(outputDir);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    if (error?.code?.startsWith('OUTPUT_')) throw error;
    if (error?.code === 'EEXIST') throw outputError('OUTPUT_FILE_EXISTS');
    throw outputError('OUTPUT_FILE_WRITE_FAILED');
  }
}

async function writeResultFiles(outputDir, readbacks, result) {
  await atomicWritePrivateFile(outputDir, 'readback.jsonl', readbacks.map(line).join(''));
  await atomicWritePrivateFile(outputDir, 'summary.json', `${JSON.stringify(result, null, 2)}\n`);
}

function orderedTargets(rows, ids) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const selected = ids.length ? ids.map((id) => byId.get(id)).filter(Boolean) : rows;
  if (ids.length && selected.length !== new Set(ids).size) throw transactionError('requested_target_missing');
  return [...selected].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function lockTargets(client, targets) {
  const ids = targets.map((row) => row.id);
  const { rows } = await client.query(
    `select id,${RESTAURANT_LOCK_FIELDS.join(',')} from restaurants where id = any($1) order by id for update`,
    [ids],
  );
  if (!Array.isArray(rows) || rows.length !== ids.length) throw transactionError('target_lock_incomplete');
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) throw transactionError('target_lock_incomplete');
  return byId;
}

function compactReadback(id, payload) {
  return { id, payload_sha256: sha256(Buffer.from(stableJson(payload), 'utf8')) };
}
function canonicalYoutubeIdentity(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (/^[A-Za-z0-9_-]{6,}$/.test(raw)) return `youtube:${raw}`;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);
  const videoId = host === 'youtu.be'
    ? parts[0]
    : (host === 'youtube.com' || host.endsWith('.youtube.com'))
      ? (parts[0] === 'watch' ? parsed.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : '')
      : '';
  return /^[A-Za-z0-9_-]{6,}$/.test(videoId || '') ? `youtube:${videoId}` : null;
}

function reviewedYoutubeIdentity(ledgerRow) {
  if (!ledgerRow || ledgerRow.schema_version !== 2 || !ledgerRow.db_snapshot
    || ledgerRow.youtube_link !== ledgerRow.db_snapshot.youtube_link) {
    throw artifactError('reviewed_youtube_link_mismatch');
  }
  const identity = canonicalYoutubeIdentity(ledgerRow.db_snapshot.youtube_link);
  if (!identity || ledgerRow.video_id !== identity.slice('youtube:'.length)) {
    throw artifactError('reviewed_youtube_identity_invalid');
  }
  return identity;
}

function normalizedAddress(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
function sameDestinationAddress(left, right) {
  const leftRoad = normalizedAddress(left.road_address);
  const rightRoad = normalizedAddress(right.road_address);
  const leftJibun = normalizedAddress(left.jibun_address);
  const rightJibun = normalizedAddress(right.jibun_address);
  return Boolean((leftRoad && leftRoad === rightRoad) || (leftJibun && leftJibun === rightJibun));
}

async function lockAddressWriteIdentities(client, targets) {
  const identities = [...new Set(targets.map(reviewedYoutubeIdentity))].sort();
  if (identities.some((identity) => !identity)) throw transactionError('youtube_identity_invalid');
  for (const identity of identities) await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [identity]);
  const { rows } = await client.query(
    `select id,youtube_link,road_address,jibun_address from restaurants where status <> 'deleted' and youtube_link is not null order by id`,
  );
  if (!Array.isArray(rows)) throw transactionError('duplicate_query_invalid');
  const failuresById = new Map(targets.map((row) => [row.id, []]));
  for (const target of targets) {
    const desired = firstCandidate(target);
    const identity = reviewedYoutubeIdentity(target);
    for (const row of rows) {
      if (row.id === target.id || canonicalYoutubeIdentity(row.youtube_link) !== identity) continue;
      failuresById.get(target.id).push(sameDestinationAddress(desired, row) ? 'same_youtube_duplicate' : 'canonical_youtube_address_conflict');
    }
    for (const other of targets) {
      if (String(other.id) <= String(target.id) || reviewedYoutubeIdentity(other) !== identity) continue;
      const code = sameDestinationAddress(desired, firstCandidate(other)) ? 'same_youtube_duplicate' : 'canonical_youtube_address_conflict';
      failuresById.get(target.id).push(code);
      failuresById.get(other.id).push(code);
    }
  }
  return failuresById;
}
async function recheckApplyInputs(bound, trusted, approvalArtifact) {
  try {
    await bound.recheck();
    await trusted.recheck();
    await recheckArtifact(approvalArtifact, {
      byte_length: approvalArtifact.bytes.length,
      sha256: approvalArtifact.sha256,
    });
  } catch (error) {
    throw transactionError('artifact_recheck_failed', [typeof error?.code === 'string' ? error.code : 'artifact_recheck_failed']);
  }
}

function recordIncomplete(result, targets, error) {
  result.incomplete_status = 'incomplete';
  result.failure_code = error instanceof ApplyTransactionError ? error.reason : 'database_error';
  result.db_write_performed = false;
  result.applied = [];
  result.skipped = targets.map((row) => ({ id: row.id, guard_failures: error instanceof ApplyTransactionError ? error.guardFailures : [] }));
}

export async function main(argv = process.argv.slice(2), { client: injectedClient } = {}) {
  const args = parseArgs(argv);
  const bound = await bindLedgerReviewArtifacts(args);
  let trusted;
  let approvalArtifact;
  let approval;
  let outputDir = '';
  try {
    const targets = orderedTargets(bound.candidateRows, args.ids);
    trusted = await verifyLedgerTrustPreflight(targets);
    if (args.apply) {
      approvalArtifact = await readStableFile(bound.root, args.adminApproval, ADDRESS_EVIDENCE_LIMITS.maxReceiptBytes);
      const approvalAnchors = loadAddressEvidenceAdminApprovalAnchors(process.env, trusted.anchors);
      approval = verifyAddressEvidenceAdminApproval({
        anchors: approvalAnchors,
        approvalBytes: approvalArtifact.bytes,
        actorUserId: args.adminUserId,
        operationId: args.operationId,
        reviewManifestSha256: bound.confirmationDigest,
      });
      if (!approval.ok) throw artifactError(approval.code);
    }
    await bound.recheck();
    await trusted.recheck();
    if (approvalArtifact) await recheckArtifact(approvalArtifact, { byte_length: approvalArtifact.bytes.length, sha256: approvalArtifact.sha256 });
    outputDir = await createPrivateOutputDirectory(bound.root, args.apply ? 'ledger-apply-results' : 'ledger-apply-dry-run', bound.rootIdentity);
    const result = {
      generated_at: new Date().toISOString(), mode: args.apply ? 'apply' : 'dry_run', db_write_performed: false,
      database_connection_attempted: false, output_dir: outputDir, target_count: targets.length,
      review_manifest_sha256: bound.confirmationDigest, reviewed_artifacts: bound.reviewedArtifacts,
      operation_receipt: args.apply
        ? { review_manifest_sha256: bound.confirmationDigest, operation_id: approval.operationId, actor_verification: 'pending' }
        : { review_manifest_sha256: bound.confirmationDigest, actor_verification: 'not_applicable' },
      applied: [], skipped: [],
    };
    const readbacks = [];

    if (args.fixtureDryRun) {
      result.fixture_dry_run = true;
      for (const ledgerRow of targets) {
        const guardFailures = localGuardFailures(ledgerRow);
        if (guardFailures.length) result.skipped.push({ id: ledgerRow.id, guard_failures: guardFailures });
        else result.applied.push({ id: ledgerRow.id, mode: 'fixture_dry_run' });
      }
      await trusted.recheck();
      await writeResultFiles(outputDir, readbacks, result);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    const localFailures = targets.flatMap((row) => localGuardFailures(row).map((failure) => ({ id: row.id, failure })));
    if (args.apply && localFailures.length) {
      const error = transactionError('local_guard_failed', localFailures.map(({ failure }) => failure));
      recordIncomplete(result, targets, error);
      await trusted.recheck();
      await writeResultFiles(outputDir, readbacks, result);
      throw error;
    }

    await bound.recheck();
    await trusted.recheck();
    if (approvalArtifact) await recheckArtifact(approvalArtifact, { byte_length: approvalArtifact.bytes.length, sha256: approvalArtifact.sha256 });
    if (args.apply && !injectedClient) await loadRuntimeEnv();
    const client = injectedClient || await createDatabaseClient();
    result.database_connection_attempted = true;
    await client.connect();
    try {
      if (!args.apply) {
        for (const ledgerRow of targets) {
          const { rows } = await client.query(`select id,${RESTAURANT_LOCK_FIELDS.join(',')} from restaurants where id = $1`, [ledgerRow.id]);
          const guardFailures = [...localGuardFailures(ledgerRow), ...dbGuardFailures(rows?.[0] || null, ledgerRow)];
          if (guardFailures.length) result.skipped.push({ id: ledgerRow.id, guard_failures: guardFailures });
          else result.applied.push({ id: ledgerRow.id, mode: 'dry_run' });
        }
      } else {
        let transactionOpen = false;
        try {
          await client.query('begin');
          transactionOpen = true;
          await assertVerifiedAdminActor(client, approval.actorUserId);
          await consumeAdminApproval(client, approval);
          const receipt = operationReceipt(approval);
          result.operation_receipt = receipt;
          const identityFailures = await lockAddressWriteIdentities(client, targets);
          const lockedById = await lockTargets(client, targets);
          const guardFailures = [];
          for (const ledgerRow of targets) {
            const failures = [
              ...localGuardFailures(ledgerRow),
              ...dbGuardFailures(lockedById.get(ledgerRow.id), ledgerRow),
              ...(identityFailures.get(ledgerRow.id) || []),
            ];
            if (failures.length) guardFailures.push(...failures);
          }
          if (guardFailures.length) throw transactionError('database_guard_failed', [...new Set(guardFailures)].sort());
          await recheckApplyInputs(bound, trusted, approvalArtifact);
          const staged = [];
          for (const ledgerRow of targets) {
            const nowIso = new Date().toISOString();
            const payload = buildPayload(ledgerRow, nowIso, args.adminUserId, receipt);
            const assignments = LEDGER_CHANGED_FIELDS.map((key, index) => `${key} = $${index + 2}`).join(', ');
            const updateResult = await client.query(`update restaurants set ${assignments} where id = $1`, [ledgerRow.id, ...LEDGER_CHANGED_FIELDS.map((field) => payload[field])]);
            if (updateResult.rowCount !== 1) throw transactionError('update_row_count_mismatch');
            const readbackFields = [...new Set([...LEDGER_CHANGED_FIELDS, ...LEDGER_EXPLICITLY_PRESERVED_FIELDS])];
            const { rows: afterRows } = await client.query(`select id,${readbackFields.join(',')} from restaurants where id = $1`, [ledgerRow.id]);
            const readback = afterRows?.length === 1 ? afterRows[0] : null;
            if (!readback || !readbackMatchesPayload(readback, payload, lockedById.get(ledgerRow.id))) throw transactionError('readback_mismatch');
            staged.push({ id: ledgerRow.id, payload });
            readbacks.push(compactReadback(ledgerRow.id, payload));
          }
          await recheckApplyInputs(bound, trusted, approvalArtifact);
          try {
            await client.query('commit');
          } catch {
            throw transactionError('commit_ambiguous');
          }
          transactionOpen = false;
          result.db_write_performed = staged.length > 0;
          result.applied = staged.map(({ id }) => ({ id, mode: 'apply', operation_receipt: receipt }));
        } catch (error) {
          if (transactionOpen) {
            try {
              await client.query('rollback');
              transactionOpen = false;
            } catch {
              throw transactionError('rollback_ambiguous');
            }
          }
          if (error instanceof ApplyTransactionError) throw error;
          throw transactionError('database_error');
        }
      }
    } catch (error) {
      if (args.apply) {
        recordIncomplete(result, targets, error);
        await writeResultFiles(outputDir, [], result);
        throw error;
      }
      throw error;
    } finally {
      await client.end();
    }
    await writeResultFiles(outputDir, readbacks, result);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (approvalArtifact) await approvalArtifact.handle.close().catch(() => {});
    if (trusted) await trusted.close();
    await bound.close();
  }
}

if (process.argv[1] && import.meta.url === (process.argv[1].startsWith('file:')
  ? new URL(process.argv[1]).href
  : pathToFileURL(path.resolve(process.argv[1])).href)) {
  main().catch((error) => {
    process.stderr.write('apply_tzuyang_address_evidence_ledger failed: ');
    logSafeError(error);
    process.exitCode = 1;
  });
}
