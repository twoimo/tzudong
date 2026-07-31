#!/usr/bin/env node
/** Build a signed, file-backed evidence ledger for Tzuyang address review. */
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ADDRESS_EVIDENCE_LIMITS,
  canonicalizeIJson,
  computeAddressPredicate,
  loadTrustAnchors,
  verifyAddressEvidenceBundle,
} from './address_evidence_trust.mjs';
import { createVerifiedPgClient } from '../utils/verified-pg-client.mjs';
import { logSafeError } from '../utils/privacy-log.mjs';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_REPORT_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'reports');
const DEFAULT_EVALUATION_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'data', 'tzuyang', 'evaluation');
const SCHEMA_VERSION = 2;
const SHA256_RE = /^[a-f0-9]{64}$/;
const LEDGER_SNAPSHOT_FIELDS = Object.freeze([
  'status', 'channel_name', 'origin_name', 'approved_name', 'naver_name', 'google_name',
  'phone', 'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'origin_address_text', 'road_address', 'jibun_address',
  'english_address', 'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details',
  'updated_at',
]);
const BASE_COLUMNS = Object.freeze([
  'id', 'status', 'approved_name', 'origin_name', 'naver_name', 'google_name',
  'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'road_address', 'jibun_address', 'english_address',
  'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details', 'updated_at', 'created_at',
  'channel_name', 'phone',
]);

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = {
    out: '',
    evaluationRoot: DEFAULT_EVALUATION_ROOT,
    guardedReportDir: '',
    evidenceBundles: '',
    format: 'text',
    limit: 0,
    sourceRoots: Object.create(null),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') args.out = argv[++index] || '';
    else if (arg === '--evaluation-root') args.evaluationRoot = argv[++index] || '';
    else if (arg === '--crawling-root') index += 1; // Retained as a rejected-as-trust input compatibility option.
    else if (arg === '--from-guarded-report') args.guardedReportDir = argv[++index] || '';
    else if (arg === '--evidence-bundles') args.evidenceBundles = argv[++index] || '';
    else if (arg === '--source-root') {
      const value = argv[++index] || '';
      const separator = value.indexOf('=');
      const rootId = value.slice(0, separator);
      const rootPath = value.slice(separator + 1);
      if (separator <= 0 || !rootPath || Object.hasOwn(args.sourceRoots, rootId)) throw new Error('invalid --source-root');
      args.sourceRoots[rootId] = rootPath;
    } else if (arg === '--limit') args.limit = Number(argv[++index] || 0);
    else if (arg === '--json') args.format = 'json';
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/build_tzuyang_address_evidence_ledger.mjs [--out DIR] [--from-guarded-report DIR] [--evidence-bundles FILE] [--source-root ROOT_ID=ABSOLUTE_PATH] [--limit N] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `tzuyang-address-evidence-ledger-${timestampSlug()}`);
  if (!args.evidenceBundles) args.evidenceBundles = path.join(args.evaluationRoot, 'address-evidence-bundles.jsonl');
  if (!Number.isSafeInteger(args.limit) || args.limit < 0) throw new Error('invalid --limit');
  return args;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compact(items) {
  return items.filter((item) => typeof item === 'string' && item.trim());
}

function normalizeName(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function youtubeVideoId(link) {
  const value = String(link ?? '').trim();
  return value.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1]
    ?? value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1]
    ?? '';
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function fileIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

async function readStableBytes(file, maxBytes) {
  let handle;
  try {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 0 || before.size > maxBytes) throw new Error('stable_input_invalid');
    const realPath = await fs.realpath(file);
    const flags = fsConstants.O_RDONLY | (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
    handle = await fs.open(file, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(fileIdentity(before), fileIdentity(opened))) throw new Error('stable_input_changed');
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('stable_input_truncated');
      offset += bytesRead;
    }
    const after = await fs.lstat(file);
    const afterRealPath = await fs.realpath(file);
    const ended = await handle.stat();
    const identity = fileIdentity(opened);
    if (!sameIdentity(identity, fileIdentity(after)) || !sameIdentity(identity, fileIdentity(ended)) || afterRealPath !== realPath) throw new Error('stable_input_changed');
    let closed = false;
    return {
      bytes,
      async recheck() {
        if (closed) throw new Error('stable_input_closed');
        const current = await fs.lstat(file);
        const currentRealPath = await fs.realpath(file);
        const currentHandle = await handle.stat();
        if (!sameIdentity(identity, fileIdentity(current)) || !sameIdentity(identity, fileIdentity(currentHandle)) || currentRealPath !== realPath) throw new Error('stable_input_changed');
      },
      async close() {
        if (!closed) {
          closed = true;
          await handle.close();
        }
      },
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    throw error;
  }
}

function parseBoundedJsonl(bytes, label) {
  if (bytes.length > ADDRESS_EVIDENCE_LIMITS.maxLedgerBytes) throw new Error(`${label}_too_large`);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error(`${label}_invalid_utf8`);
  }
  const rows = [];
  for (const rawLine of text.split('\n')) {
    if (Buffer.byteLength(rawLine, 'utf8') > ADDRESS_EVIDENCE_LIMITS.maxJsonlLineBytes) throw new Error(`${label}_line_too_large`);
    const line = rawLine.trim();
    if (!line) continue;
    if (rows.length >= ADDRESS_EVIDENCE_LIMITS.maxLedgerRows) throw new Error(`${label}_row_limit_exceeded`);
    try {
      const row = JSON.parse(line);
      if (!isPlainObject(row)) throw new Error();
      rows.push(row);
    } catch {
      throw new Error(`${label}_invalid_json`);
    }
  }
  return rows;
}

async function tryReadStableJsonl(file, label, holds) {
  try {
    const read = await readStableBytes(file, ADDRESS_EVIDENCE_LIMITS.maxLedgerBytes);
    holds.push(read);
    return parseBoundedJsonl(read.bytes, label);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function originAddressText(value) {
  if (typeof value === 'string') return value.trim();
  return isPlainObject(value) ? String(value.address ?? value.roadAddress ?? value.jibunAddress ?? '').trim() : '';
}

function jsonTimestamp(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('invalid_updated_at');
    return value.toISOString();
  }
  return value ?? null;
}

function ledgerSnapshot(row) {
  const snapshot = {
    status: row.status ?? null,
    channel_name: row.channel_name ?? null,
    origin_name: row.origin_name ?? null,
    approved_name: row.approved_name ?? null,
    naver_name: row.naver_name ?? null,
    google_name: row.google_name ?? null,
    phone: row.phone ?? null,
    youtube_link: row.youtube_link ?? null,
    geocoding_success: row.geocoding_success ?? null,
    geocoding_false_stage: row.geocoding_false_stage ?? null,
    updated_by_admin_id: row.updated_by_admin_id ?? null,
    is_missing: row.is_missing ?? null,
    is_not_selected: row.is_not_selected ?? null,
    origin_address: row.origin_address ?? null,
    origin_address_text: originAddressText(row.origin_address),
    road_address: row.road_address ?? null,
    jibun_address: row.jibun_address ?? null,
    english_address: row.english_address ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    evaluation_results: row.evaluation_results ?? null,
    db_error_message: row.db_error_message ?? null,
    db_error_details: row.db_error_details ?? null,
    updated_at: jsonTimestamp(row.updated_at),
  };
  return Object.fromEntries(LEDGER_SNAPSHOT_FIELDS.map((field) => [field, snapshot[field]]));
}

function scopeStatus(row) {
  if (row.status === 'deleted') return { status: 'excluded', reason: 'deleted_or_admin_touched' };
  if (row.updated_by_admin_id) return { status: 'excluded', reason: 'deleted_or_admin_touched' };
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected') return { status: 'excluded', reason: 'missing_or_not_selected' };
  if (row.geocoding_false_stage === 0) return { status: 'excluded', reason: 'stage0_not_applyable' };
  return { status: 'target', reason: row.geocoding_false_stage === null || row.geocoding_false_stage === undefined ? 'failed' : 'false' };
}

function candidateRiskFlags(row, candidate) {
  const flags = [];
  if (row.status === 'deleted' || row.updated_by_admin_id) flags.push('deleted_or_admin_touched');
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected') flags.push('missing_or_not_selected');
  if (row.geocoding_false_stage === 0) flags.push('stage0_not_applyable');
  const place = candidate?.place;
  const coordinatesValid = typeof place?.lat === 'number' && typeof place?.lng === 'number'
    && Number.isFinite(place.lat) && Number.isFinite(place.lng)
    && place.lat >= -90 && place.lat <= 90 && place.lng >= -180 && place.lng <= 180;
  if (!place || !(typeof place.name === 'string' && place.name.trim())
    || !(typeof place.road_address === 'string' && place.road_address.trim())
    && !(typeof place.jibun_address === 'string' && place.jibun_address.trim())
    || !coordinatesValid) flags.push('candidate_place_not_precise');
  return [...new Set(flags)].sort();
}

function emptyTrustedEvidence() {
  return { video: null, providers: [] };
}

function rawCandidate(snapshot, restaurantId, bundle) {
  const place = isPlainObject(bundle?.candidate_place) ? bundle.candidate_place : {};
  return {
    restaurant_id: String(restaurantId ?? ''),
    video_id: youtubeVideoId(snapshot.youtube_link),
    query_sha256: typeof bundle?.query_sha256 === 'string' ? bundle.query_sha256 : '',
    place: {
      name: typeof place.name === 'string' ? place.name : '',
      road_address: typeof place.road_address === 'string' ? place.road_address : '',
      jibun_address: typeof place.jibun_address === 'string' ? place.jibun_address : '',
      lat: place.lat ?? null,
      lng: place.lng ?? null,
    },
  };
}

function publicCandidate(candidate) {
  return {
    name: candidate.place.name,
    road_address: candidate.place.road_address,
    jibun_address: candidate.place.jibun_address,
    lat: candidate.place.lat,
    lng: candidate.place.lng,
    evidence_source: 'signed_provider_receipts',
    derived_from_current_evidence: true,
    confidence: 'review_required',
  };
}

function isV2Bundle(value) {
  return isPlainObject(value)
    && value.schema_version === 2
    && Object.keys(value).sort().join(',') === 'candidate_place,query_sha256,record_selector_sha256,schema_version,source_artifacts,trusted_evidence';
}

function bundleForRow(row, bundlesByRestaurantId) {
  const inline = row.address_evidence;
  if (inline !== undefined) return inline;
  return bundlesByRestaurantId.get(String(row.id)) ?? null;
}

function buildSearchQueries(row, candidate) {
  const name = normalizeName(candidate.place.name || row.origin_name || row.approved_name || row.naver_name || row.google_name);
  const address = normalizeName(candidate.place.road_address || candidate.place.jibun_address || originAddressText(row.origin_address));
  return compact([name && address ? `${name} ${address}` : '', name ? `${name} 주소` : ''])
    .map((query) => ({ query, purpose: 'signed_provider_receipt_review' }));
}

function verifierRecord(verification, predicate) {
  return Object.freeze({
    schema_version: 2,
    ok: verification?.ok === true,
    code: verification?.ok === true ? null : (verification?.code ?? 'trust_verification_failed'),
    predicate,
    trust_summary: predicate.trust_summary,
  });
}
function evidenceClasses(verification) {
  return Object.freeze({
    signed_video_manifest: verification?.ok === true,
    signed_provider_receipt_count: verification?.ok === true ? verification.providers.length : 0,
    independently_signed_provider_receipts: verification?.ok === true && verification.providers.length >= 2,
  });
}

async function buildLedgerRow(row, bundlesByRestaurantId, anchors, anchorFailure, generatedAt, verifications) {
  const snapshot = ledgerSnapshot(row);
  const scope = scopeStatus(snapshot);
  const supplied = bundleForRow(row, bundlesByRestaurantId);
  const bundle = isV2Bundle(supplied) ? supplied : null;
  const candidate = rawCandidate(snapshot, row.id, bundle);
  const riskFlags = candidateRiskFlags(snapshot, candidate);
  let verification = null;
  let trustFailureCode = anchorFailure || 'trust_verification_failed';

  if (anchors) {
    verification = await verifyAddressEvidenceBundle({
      anchors,
      candidate,
      record_selector_sha256: bundle?.record_selector_sha256,
      trusted_evidence: bundle?.trusted_evidence ?? emptyTrustedEvidence(),
      source_artifacts: bundle?.source_artifacts ?? [],
      risk_flags: riskFlags,
      now: generatedAt,
    });
    trustFailureCode = verification.ok ? null : verification.code;
    if (verification.ok) verifications.push(verification);
  }

  const predicate = verification?.ok
    ? verification.predicate
    : computeAddressPredicate({ verification: null, risk_flags: riskFlags });
  const decision = scope.status === 'excluded'
    ? 'excluded'
    : predicate.pass ? 'apply_candidate' : 'manual_review';
  const trustedEvidence = bundle ? cloneJson(bundle.trusted_evidence) : emptyTrustedEvidence();
  const sourceArtifacts = bundle && Array.isArray(bundle.source_artifacts) ? cloneJson(bundle.source_artifacts) : [];
  const publicPlace = publicCandidate(candidate);

  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    id: row.id,
    scope_status: scope.status,
    scope_reason: scope.reason,
    exclusion_reason: scope.status === 'excluded' ? scope.reason : null,
    db_snapshot: snapshot,
    video_id: candidate.video_id || null,
    youtube_link: snapshot.youtube_link,
    query_sha256: candidate.query_sha256 || null,
    record_selector_sha256: bundle?.record_selector_sha256 ?? null,
    trusted_evidence: trustedEvidence,
    source_artifacts: sourceArtifacts,
    candidate_places: [publicPlace],
    evidence_classes: evidenceClasses(verification),
    evidence_families: predicate.families,
    blocking_risk_flags: predicate.blocking_risk_flags,
    missing_requirements: predicate.missing_requirements,
    risk_flags: riskFlags,
    trust_summary: predicate.trust_summary,
    strict_predicate_result: predicate,
    verifier_result: verifierRecord(verification, predicate),
    trust_failure_code: trustFailureCode,
    decision,
    operator_decision: 'review',
    decision_reason_ko: decision === 'apply_candidate'
      ? '서명된 독립 증거가 검증되었습니다. 실제 DB 반영 전에는 별도 운영자 검토와 guarded apply가 필요합니다.'
      : decision === 'excluded'
        ? `자동 적용 제외: ${scope.reason}`
        : '서명된 v2 영상 manifest와 독립 provider receipt 검증을 통과하지 못해 관리자 검토가 필요합니다.',
    search_queries: buildSearchQueries(snapshot, candidate),
  });
}

export async function buildLedgerRows(rows, bundlesByRestaurantId = new Map(), anchors = null, anchorFailure = null, generatedAt = new Date().toISOString()) {
  if (!Array.isArray(rows) || rows.length > ADDRESS_EVIDENCE_LIMITS.maxLedgerRows) throw new Error('invalid_ledger_rows');
  const targets = rows.filter((row) => isPlainObject(row) && (row.geocoding_success === false || row.geocoding_success === 'false'))
    .filter((row) => row.channel_name === 'tzuyang' || /tzuyang/i.test(String(row.channel_name ?? '')))
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'));
  const verifications = [];
  try {
    const ledger = [];
    for (const row of targets) ledger.push(await buildLedgerRow(row, bundlesByRestaurantId, anchors, anchorFailure, generatedAt, verifications));
    return { ledger, verifications };
  } catch (error) {
    await Promise.all(verifications.map((verification) => verification.close().catch(() => {})));
    throw error;
  }
}

async function getExistingColumns(client) {
  const { rows } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'restaurants'");
  return new Set(rows.map((row) => row.column_name));
}

async function loadRowsFromSupabase(limit = 0) {
  const client = await createVerifiedPgClient({ applicationName: 'tzudong-address-evidence-ledger' });
  await client.connect();
  try {
    const columns = await getExistingColumns(client);
    const selected = BASE_COLUMNS.filter((column) => columns.has(column));
    const sql = `select ${selected.join(', ')} from restaurants order by created_at asc nulls last, id asc${limit ? ` limit ${limit}` : ''}`;
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

async function loadRowsFromGuardedReport(dir, holds) {
  const rows = [];
  for (const name of ['review-queue.jsonl', 'excluded-deleted.jsonl', 'excluded-admin-touched.jsonl']) {
    const entries = await tryReadStableJsonl(path.join(dir, name), 'guarded_report', holds);
    rows.push(...entries);
  }
  return rows;
}

async function loadEvidenceBundles(file, holds) {
  const entries = await tryReadStableJsonl(file, 'address_evidence_bundles', holds);
  const bundles = new Map();
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.restaurant_id !== 'string' || !isPlainObject(entry.address_evidence) || bundles.has(entry.restaurant_id)) throw new Error('invalid_address_evidence_bundle_index');
    bundles.set(entry.restaurant_id, entry.address_evidence);
  }
  return bundles;
}

export function canonicalJson(value) {
  return canonicalizeIJson(value);
}

export function contentDigest(value) {
  return `sha256:${createHash('sha256').update(canonicalizeIJson(value)).digest('hex')}`;
}

function publicLedgerRow(row) {
  const { phone, evaluation_results, db_error_message, db_error_details, updated_by_admin_id, origin_address, ...safeSnapshot } = row.db_snapshot;
  return { ...row, db_snapshot: safeSnapshot };
}

function summarize(ledger, out) {
  const decisionCounts = ledger.reduce((counts, row) => {
    counts[row.decision] = (counts[row.decision] || 0) + 1;
    return counts;
  }, Object.create(null));
  const trustFailures = ledger.reduce((counts, row) => {
    if (row.trust_failure_code) counts[row.trust_failure_code] = (counts[row.trust_failure_code] || 0) + 1;
    return counts;
  }, Object.create(null));
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: 'read_only_signed_tzuyang_address_evidence_ledger',
    db_write_performed: false,
    output_dir: out,
    total_ledger_rows: ledger.length,
    target_rows: ledger.filter((row) => row.scope_status === 'target').length,
    excluded_rows: ledger.filter((row) => row.scope_status === 'excluded').length,
    decision_counts: Object.fromEntries(Object.entries(decisionCounts).sort(([left], [right]) => left.localeCompare(right))),
    trust_failure_counts: Object.fromEntries(Object.entries(trustFailures).sort(([left], [right]) => left.localeCompare(right))),
    strict_apply_candidates: ledger.filter((row) => row.decision === 'apply_candidate').length,
    manual_review_rows: ledger.filter((row) => row.decision === 'manual_review').length,
    destructive_apply_allowed_by_this_script: false,
  };
}

async function writeJson(file, payload) {
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(file, rows) {
  await fs.writeFile(file, rows.map((row) => canonicalizeIJson(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function publishAtomically(out, ledger, recheckInputs) {
  const destination = path.resolve(out);
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('output_parent_invalid');
  try {
    await fs.lstat(destination);
    throw new Error('output_directory_already_exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const stage = await fs.mkdtemp(path.join(parent, `.${path.basename(destination)}.tmp-`));
  try {
    const privateDir = path.join(stage, 'operator-private');
    await fs.mkdir(privateDir, { mode: 0o700 });
    await fs.chmod(privateDir, 0o700);
    const summary = summarize(ledger, destination);
    await writeJson(path.join(stage, 'summary.json'), summary);
    await writeJsonl(path.join(stage, 'ledger.jsonl'), ledger.map(publicLedgerRow));
    await writeJsonl(path.join(privateDir, 'operator-ledger-private.jsonl'), ledger);
    await writeJsonl(path.join(stage, 'operator-ledger-private.jsonl'), ledger);
    await writeJsonl(path.join(stage, 'apply-candidates.jsonl'), ledger.filter((row) => row.decision === 'apply_candidate' && row.operator_decision === 'apply'));
    await writeJsonl(path.join(stage, 'manual-review-queue.jsonl'), ledger.filter((row) => row.decision === 'manual_review').map(publicLedgerRow));
    await writeJsonl(path.join(stage, 'excluded.jsonl'), ledger.filter((row) => row.decision === 'excluded').map(publicLedgerRow));
    await recheckInputs();
    await fs.rename(stage, destination);
    return summary;
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function loadAnchors(args) {
  if (Object.keys(args.sourceRoots).length === 0) return loadTrustAnchors(process.env);
  return loadTrustAnchors(process.env, { explicitRoots: args.sourceRoots });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const holds = [];
  let verifications = [];
  try {
    if (!args.guardedReportDir) {
      let dotenv;
      try {
        ({ default: dotenv } = await import('dotenv'));
      } catch {
        throw new Error('DOTENV_RUNTIME_UNAVAILABLE');
      }
      dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), override: false });
    }
    let anchors = null;
    let anchorFailure = null;
    try {
      anchors = await loadAnchors(args);
    } catch (error) {
      anchorFailure = error?.code || 'invalid_trust_anchors';
    }
    const rows = args.guardedReportDir
      ? await loadRowsFromGuardedReport(args.guardedReportDir, holds)
      : await loadRowsFromSupabase(args.limit);
    const bundles = await loadEvidenceBundles(args.evidenceBundles, holds);
    const built = await buildLedgerRows(rows, bundles, anchors, anchorFailure);
    verifications = built.verifications;
    const summary = await publishAtomically(args.out, built.ledger, async () => {
      for (const hold of holds) await hold.recheck();
      for (const verification of verifications) await verification.recheck();
    });
    if (args.format === 'json') console.log(JSON.stringify(summary, null, 2));
    else console.log(`Wrote ${args.out} (${summary.total_ledger_rows} rows, apply=${summary.strict_apply_candidates}, review=${summary.manual_review_rows})`);
    return summary;
  } finally {
    await Promise.all(verifications.map((verification) => verification.close().catch(() => {})));
    await Promise.all(holds.map((hold) => hold.close().catch(() => {})));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (process.env.TZUYANG_LEDGER_CI_FIXTURE === '1' && error instanceof Error && !error.code) {
      error.code = `ADDRESS_LEDGER_${createHash('sha256').update(error.message).digest('hex').slice(0, 12).toUpperCase()}`;
    }
    process.stderr.write('build_tzuyang_address_evidence_ledger failed: ');
    logSafeError(error);
    process.exitCode = 1;
  });
}
