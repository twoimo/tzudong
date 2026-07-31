#!/usr/bin/env node
/** Recompute signed address evidence trust for every v2 ledger row. */
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ADDRESS_EVIDENCE_LIMITS,
  canonicalizeIJson,
  computeAddressPredicate,
  loadTrustAnchors,
  verifyAddressEvidenceBundle,
} from './address_evidence_trust.mjs';
import { logSafeError } from '../utils/privacy-log.mjs';

const REQUIRED_V2_FIELDS = Object.freeze([
  'schema_version', 'generated_at', 'id', 'scope_status', 'scope_reason', 'exclusion_reason', 'db_snapshot',
  'video_id', 'youtube_link', 'query_sha256', 'record_selector_sha256', 'trusted_evidence', 'source_artifacts',
  'candidate_places', 'evidence_classes', 'evidence_families', 'blocking_risk_flags', 'missing_requirements', 'risk_flags',
  'trust_summary', 'strict_predicate_result', 'verifier_result', 'trust_failure_code', 'decision',
  'operator_decision', 'decision_reason_ko', 'search_queries',
]);

function parseArgs(argv) {
  const args = { ledgerDir: '', json: false, now: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ledger-dir') args.ledgerDir = argv[++index] || '';
    else if (arg === '--now') args.now = argv[++index] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/validate_tzuyang_address_evidence_ledger.mjs --ledger-dir DIR [--now RFC3339_MILLIS] [--json]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.ledgerDir) throw new Error('--ledger-dir is required');
  if (args.now && new Date(args.now).toISOString() !== args.now) throw new Error('invalid --now');
  return args;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function openStableLedger(file) {
  let handle;
  try {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 0 || before.size > ADDRESS_EVIDENCE_LIMITS.maxLedgerBytes) throw new Error('ledger_file_invalid');
    const realPath = await fs.realpath(file);
    const flags = fsConstants.O_RDONLY | (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
    handle = await fs.open(file, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(fileIdentity(before), fileIdentity(opened))) throw new Error('ledger_file_changed');
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('ledger_file_truncated');
      offset += bytesRead;
    }
    const after = await fs.lstat(file);
    const afterRealPath = await fs.realpath(file);
    const identity = fileIdentity(opened);
    if (!sameIdentity(identity, fileIdentity(after)) || afterRealPath !== realPath || !sameIdentity(identity, fileIdentity(await handle.stat()))) throw new Error('ledger_file_changed');
    let closed = false;
    return {
      bytes,
      async recheck() {
        if (closed) throw new Error('ledger_file_closed');
        const current = await fs.lstat(file);
        const currentRealPath = await fs.realpath(file);
        if (!sameIdentity(identity, fileIdentity(current)) || currentRealPath !== realPath || !sameIdentity(identity, fileIdentity(await handle.stat()))) throw new Error('ledger_file_changed');
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

function parseBoundedLedger(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error('ledger_invalid_utf8');
  }
  const rows = [];
  for (const rawLine of text.split('\n')) {
    if (Buffer.byteLength(rawLine, 'utf8') > ADDRESS_EVIDENCE_LIMITS.maxJsonlLineBytes) throw new Error('ledger_line_limit_exceeded');
    const line = rawLine.trim();
    if (!line) continue;
    if (rows.length >= ADDRESS_EVIDENCE_LIMITS.maxLedgerRows) throw new Error('ledger_row_limit_exceeded');
    try {
      const row = JSON.parse(line);
      if (!isPlainObject(row)) throw new Error();
      rows.push(row);
    } catch {
      throw new Error('ledger_invalid_json');
    }
  }
  return rows;
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
function youtubeVideoId(link) {
  const value = String(link ?? '').trim();
  return value.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1]
    ?? value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1]
    ?? '';
}

function scopeStatus(snapshot) {
  if (snapshot?.status === 'deleted' || snapshot?.updated_by_admin_id) return { status: 'excluded', reason: 'deleted_or_admin_touched' };
  if (truthy(snapshot?.is_missing) || truthy(snapshot?.is_not_selected) || snapshot?.status === 'missing' || snapshot?.status === 'not_selected') return { status: 'excluded', reason: 'missing_or_not_selected' };
  if (snapshot?.geocoding_false_stage === 0) return { status: 'excluded', reason: 'stage0_not_applyable' };
  return { status: 'target', reason: snapshot?.geocoding_false_stage === null || snapshot?.geocoding_false_stage === undefined ? 'failed' : 'false' };
}

function candidateFromRow(row) {
  const candidate = Array.isArray(row.candidate_places) && row.candidate_places.length === 1 ? row.candidate_places[0] : null;
  const place = isPlainObject(candidate) ? candidate : {};
  return {
    restaurant_id: String(row.id ?? ''),
    video_id: youtubeVideoId(row.db_snapshot?.youtube_link),
    query_sha256: typeof row.query_sha256 === 'string' ? row.query_sha256 : '',
    place: {
      name: typeof place.name === 'string' ? place.name : '',
      road_address: typeof place.road_address === 'string' ? place.road_address : '',
      jibun_address: typeof place.jibun_address === 'string' ? place.jibun_address : '',
      lat: place.lat,
      lng: place.lng,
    },
  };
}

function candidateIsPrecise(candidate) {
  const place = candidate?.place;
  return isPlainObject(place)
    && typeof place.name === 'string' && place.name.trim()
    && (typeof place.road_address === 'string' && place.road_address.trim() || typeof place.jibun_address === 'string' && place.jibun_address.trim())
    && typeof place.lat === 'number' && Number.isFinite(place.lat) && place.lat >= -90 && place.lat <= 90
    && typeof place.lng === 'number' && Number.isFinite(place.lng) && place.lng >= -180 && place.lng <= 180;
}

function recomputeRiskFlags(row, candidate) {
  const snapshot = row.db_snapshot;
  const flags = [];
  if (snapshot?.status === 'deleted' || snapshot?.updated_by_admin_id) flags.push('deleted_or_admin_touched');
  if (truthy(snapshot?.is_missing) || truthy(snapshot?.is_not_selected) || snapshot?.status === 'missing' || snapshot?.status === 'not_selected') flags.push('missing_or_not_selected');
  if (snapshot?.geocoding_false_stage === 0) flags.push('stage0_not_applyable');
  if (!candidateIsPrecise(candidate)) flags.push('candidate_place_not_precise');
  const candidateRecord = Array.isArray(row.candidate_places) && row.candidate_places.length === 1 ? row.candidate_places[0] : null;
  if (candidateRecord?.derived_from_current_evidence !== true) flags.push('candidate_place_not_evidence_derived');
  return [...new Set(flags)].sort();
}

function sameJson(left, right) {
  try {
    return canonicalizeIJson(left) === canonicalizeIJson(right);
  } catch {
    return false;
  }
}

function expectedVerifierResult(verification, predicate) {
  return {
    schema_version: 2,
    ok: verification?.ok === true,
    code: verification?.ok === true ? null : (verification?.code ?? 'trust_verification_failed'),
    predicate,
    trust_summary: predicate.trust_summary,
  };
}
function expectedEvidenceClasses(verification) {
  return {
    signed_video_manifest: verification?.ok === true,
    signed_provider_receipt_count: verification?.ok === true ? verification.providers.length : 0,
    independently_signed_provider_receipts: verification?.ok === true && verification.providers.length >= 2,
  };
}

function requiredFieldErrors(row) {
  return REQUIRED_V2_FIELDS.filter((field) => !Object.hasOwn(row, field)).map(() => 'missing_required_field');
}

function candidateShapeValid(row, candidate) {
  const stored = Array.isArray(row.candidate_places) && row.candidate_places.length === 1 ? row.candidate_places[0] : null;
  if (!isPlainObject(stored) || Object.keys(stored).sort().join(',') !== 'confidence,derived_from_current_evidence,evidence_source,jibun_address,lat,lng,name,road_address') return false;
  return stored.evidence_source === 'signed_provider_receipts'
    && stored.derived_from_current_evidence === true
    && stored.confidence === 'review_required'
    && sameJson({
      name: stored.name,
      road_address: stored.road_address,
      jibun_address: stored.jibun_address,
      lat: stored.lat,
      lng: stored.lng,
    }, candidate.place);
}

async function validateV2Row(row, anchors, anchorFailure, now) {
  const errors = requiredFieldErrors(row);
  if (row.schema_version !== 2) errors.push('invalid_schema_version');
  if (!isPlainObject(row.db_snapshot)) errors.push('invalid_db_snapshot');
  if (!['apply_candidate', 'manual_review', 'excluded'].includes(row.decision)) errors.push('invalid_decision');
  if (!['apply', 'hold', 'review'].includes(row.operator_decision)) errors.push('invalid_operator_decision');
  const candidate = candidateFromRow(row);
  if (!candidateShapeValid(row, candidate)) errors.push('candidate_claim_mismatch');
  const snapshotVideoId = youtubeVideoId(row.db_snapshot?.youtube_link);
  if (row.youtube_link !== (row.db_snapshot?.youtube_link ?? null)) errors.push('youtube_link_snapshot_mismatch');
  if (row.video_id !== (snapshotVideoId || null)) errors.push('video_id_snapshot_mismatch');
  const expectedScope = scopeStatus(row.db_snapshot);
  if (row.scope_status !== expectedScope.status || row.scope_reason !== expectedScope.reason || row.exclusion_reason !== (expectedScope.status === 'excluded' ? expectedScope.reason : null)) errors.push('scope_claim_mismatch');
  const riskFlags = recomputeRiskFlags(row, candidate);
  if (!sameJson(row.risk_flags, riskFlags)) errors.push('risk_flags_claim_mismatch');

  let verification = null;
  if (anchors) {
    verification = await verifyAddressEvidenceBundle({
      anchors,
      candidate,
      record_selector_sha256: row.record_selector_sha256,
      trusted_evidence: row.trusted_evidence,
      source_artifacts: row.source_artifacts,
      risk_flags: riskFlags,
      now,
    });
  } else {
    verification = { ok: false, code: anchorFailure || 'invalid_trust_anchors' };
  }
  const predicate = verification.ok
    ? verification.predicate
    : computeAddressPredicate({ verification: null, risk_flags: riskFlags });
  const expectedDecision = expectedScope.status === 'excluded'
    ? 'excluded'
    : predicate.pass ? 'apply_candidate' : 'manual_review';
  const expectedVerifier = expectedVerifierResult(verification, predicate);

  if (!sameJson(row.strict_predicate_result, predicate)) errors.push('strict_predicate_claim_mismatch');
  if (!sameJson(row.evidence_classes, expectedEvidenceClasses(verification))) errors.push('evidence_classes_claim_mismatch');
  if (!sameJson(row.evidence_families, predicate.families)) errors.push('evidence_families_claim_mismatch');
  if (!sameJson(row.blocking_risk_flags, predicate.blocking_risk_flags)) errors.push('blocking_flags_claim_mismatch');
  if (!sameJson(row.missing_requirements, predicate.missing_requirements)) errors.push('missing_requirements_claim_mismatch');
  if (!sameJson(row.trust_summary, predicate.trust_summary)) errors.push('trust_summary_claim_mismatch');
  if (!sameJson(row.verifier_result, expectedVerifier)) errors.push('verifier_result_claim_mismatch');
  if ((row.trust_failure_code ?? null) !== expectedVerifier.code) errors.push('trust_failure_code_mismatch');
  if (row.decision !== expectedDecision) errors.push('decision_claim_mismatch');
  if (row.decision === 'apply_candidate' && (!verification.ok || !predicate.pass || expectedScope.status !== 'target')) errors.push('apply_candidate_not_verified');

  return { errors: [...new Set(errors)], verification };
}

async function validateRows(rows, anchors, anchorFailure, now) {
  const errors = [];
  const verifications = [];
  try {
    for (const row of rows) {
      if (row.schema_version !== 2) {
        errors.push({ id: row.id ?? null, code: 'legacy_manual_only' });
        if (row.decision === 'apply_candidate') errors.push({ id: row.id ?? null, code: 'legacy_apply_candidate_forbidden' });
        continue;
      }
      const result = await validateV2Row(row, anchors, anchorFailure, now);
      if (result.verification.ok) verifications.push(result.verification);
      for (const code of result.errors) errors.push({ id: row.id ?? null, code });
    }
    return { errors, verifications };
  } catch (error) {
    await Promise.all(verifications.map((verification) => verification.close().catch(() => {})));
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const ledgerPath = path.join(path.resolve(args.ledgerDir), 'operator-private', 'operator-ledger-private.jsonl');
  const ledger = await openStableLedger(ledgerPath);
  let verifications = [];
  try {
    const rows = parseBoundedLedger(ledger.bytes);
    let anchors = null;
    let anchorFailure = null;
    try {
      anchors = await loadTrustAnchors(process.env);
    } catch (error) {
      anchorFailure = error?.code || 'invalid_trust_anchors';
    }
    const result = await validateRows(rows, anchors, anchorFailure, args.now ?? new Date().toISOString());
    verifications = result.verifications;
    await ledger.recheck();
    for (const verification of verifications) await verification.recheck();
    const summary = {
      generated_at: new Date().toISOString(),
      mode: 'read_only_signed_ledger_validation',
      db_write_performed: false,
      ledger_path: ledgerPath,
      row_count: rows.length,
      ok: result.errors.length === 0,
      error_count: result.errors.length,
      errors: result.errors.slice(0, 100),
      decision_counts: rows.reduce((counts, row) => {
        counts[row.decision] = (counts[row.decision] || 0) + 1;
        return counts;
      }, Object.create(null)),
    };
    await fs.writeFile(path.join(path.resolve(args.ledgerDir), 'ledger-validation.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(args.json ? summary : { ...summary, errors: undefined }, null, 2));
    if (!summary.ok) process.exitCode = 1;
    return summary;
  } finally {
    await Promise.all(verifications.map((verification) => verification.close().catch(() => {})));
    await ledger.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    logSafeError(error, (line) => process.stderr.write(`ledger_validation_failed ${line}`));
    process.exitCode = 1;
  });
}
