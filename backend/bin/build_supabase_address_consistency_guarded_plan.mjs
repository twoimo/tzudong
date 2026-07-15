#!/usr/bin/env node
/**
 * Build a guarded, read-only Supabase remediation plan for address consistency failures.
 *
 * This script deliberately does not UPDATE Supabase. It partitions the current
 * restaurants table into safe queues so an operator can review before any
 * destructive production write happens.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifiedPgClient } from '../utils/verified-pg-client.mjs';
import { logSafeError } from '../utils/privacy-log.mjs';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_REPORT_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'reports');
const CONSISTENCY_SNAPSHOT_FIELDS = Object.freeze([
  'status', 'channel_name', 'origin_name', 'approved_name', 'naver_name', 'google_name',
  'phone', 'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'origin_address_text', 'road_address', 'jibun_address',
  'english_address', 'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details',
  'updated_at',
]);

const TARGET_SELECT = `
  select
    id,
    status,
    channel_name,
    approved_name,
    origin_name,
    naver_name,
    google_name,
    phone,
    youtube_link,
    geocoding_success,
    geocoding_false_stage,
    updated_by_admin_id,
    is_missing,
    is_not_selected,
    origin_address,
    road_address,
    jibun_address,
    english_address,
    lat,
    lng,
    evaluation_results,
    db_error_message,
    db_error_details,
    updated_at,
    created_at
  from restaurants
`;

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = { out: '', format: 'text' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--json') args.format = 'json';
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node bin/build_supabase_address_consistency_guarded_plan.mjs [--out DIR] [--json]\n\nBuilds read-only remediation queues for Supabase restaurants address-consistency failures.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `address-consistency-guarded-${timestampSlug()}`);
  return args;
}


function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function originAddressText(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { /* Plain address text is already handled below. */ }
  }
  if (parsed && typeof parsed === 'object') parsed = parsed.address || parsed.roadAddress || parsed.jibunAddress || parsed.fullAddress || '';
  return normalizeText(parsed);
}

function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
      value[key] === undefined ? [] : [[key, canonicalize(value[key])]]
    )));
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function consistencySnapshot(row) {
  const snapshot = {
    status: row.status,
    channel_name: row.channel_name,
    origin_name: row.origin_name,
    approved_name: row.approved_name,
    naver_name: row.naver_name,
    google_name: row.google_name,
    phone: row.phone,
    youtube_link: row.youtube_link,
    geocoding_success: row.geocoding_success,
    geocoding_false_stage: row.geocoding_false_stage,
    updated_by_admin_id: row.updated_by_admin_id,
    is_missing: row.is_missing,
    is_not_selected: row.is_not_selected,
    origin_address: canonicalize(row.origin_address),
    origin_address_text: originAddressText(row.origin_address),
    road_address: row.road_address,
    jibun_address: row.jibun_address,
    english_address: row.english_address,
    lat: row.lat,
    lng: row.lng,
    evaluation_results: row.evaluation_results,
    db_error_message: row.db_error_message,
    db_error_details: row.db_error_details,
    updated_at: row.updated_at,
  };
  return Object.fromEntries(CONSISTENCY_SNAPSHOT_FIELDS.map((field) => [field, canonicalize(snapshot[field])]));
}

function originLatLng(value) {
  if (!value || typeof value !== 'object') return { lat: null, lng: null };
  const lat = value.lat ?? value.y ?? null;
  const lng = value.lng ?? value.x ?? null;
  return { lat, lng };
}

function locationMatch(record) {
  const evalResults = record.evaluation_results;
  if (!evalResults || typeof evalResults !== 'object') return {};
  const value = evalResults.location_match_TF;
  return value && typeof value === 'object' ? value : {};
}

function allCoreEvaluationSignalsPass(record) {
  const evalResults = record.evaluation_results;
  if (!evalResults || typeof evalResults !== 'object') return false;
  const checks = [
    evalResults.location_match_TF?.eval_value,
    evalResults.category_validity_TF?.eval_value ?? evalResults.category_TF?.eval_value,
    evalResults.rb_grounding_TF?.eval_value,
  ];
  const numeric = [
    evalResults.visit_authenticity?.eval_value,
    evalResults.review_faithfulness_score?.eval_value,
    evalResults.rb_inference_score?.eval_value,
  ];
  return checks.every((value) => value === true) && numeric.every((value) => Number(value) >= 0.8);
}

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

function hasUsableAddressAndCoordinate(record) {
  return validCoordinates(record.lat, record.lng)
    && (isPresent(record.road_address) || isPresent(record.jibun_address) || isPresent(record.english_address));
}

function isActive(row) {
  return row.status !== 'deleted';
}

function isTargetFailure(row) {
  return row.geocoding_success === false;
}

function targetKind(row) {
  if (row.geocoding_success === false && row.geocoding_false_stage === null) return 'failed';
  if (row.geocoding_success === false && row.geocoding_false_stage !== null) return 'false';
  return 'other';
}

function coordinateKey(row) {
  if (!validCoordinates(row.lat, row.lng)) return '';
  return `${row.lat.toFixed(7)},${row.lng.toFixed(7)}`;
}

function collectKnownByOrigin(rows) {
  const byName = new Map();
  for (const row of rows) {
    if (!isActive(row) || row.geocoding_success !== true || !coordinateKey(row)) continue;
    const key = normalizeName(row.origin_name || row.approved_name || row.naver_name || row.google_name);
    if (!key) continue;
    const entry = byName.get(key) || { rows: [], coordinateKeys: new Set() };
    entry.rows.push(row);
    entry.coordinateKeys.add(coordinateKey(row));
    byName.set(key, entry);
  }
  return byName;
}

function compactRow(row) {
  const {
    phone,
    updated_by_admin_id,
    origin_address,
    db_error_message,
    db_error_details,
    evaluation_results,
    ...snapshot
  } = consistencySnapshot(row);
  return { id: row.id, ...snapshot };
}

function buildKnownCoordinateSuggestion(row, knownByOrigin) {
  const key = normalizeName(row.origin_name);
  if (!key) return null;
  const known = knownByOrigin.get(key);
  if (!known || known.coordinateKeys.size !== 1) return null;
  const sourceRows = known.rows;
  const first = sourceRows[0];
  return {
    origin_name: key,
    confidence: 'review_required',
    reason_ko: '같은 원본 상호명의 기존 정합 성공 행이 하나의 좌표만 갖고 있어 후보로 제시합니다. 동명이점/지점 가능성 때문에 자동 적용하지 않습니다.',
    source_count: sourceRows.length,
    source_ids: sourceRows.slice(0, 10).map((item) => item.id),
    suggested_lat: first.lat,
    suggested_lng: first.lng,
    suggested_road_address: first.road_address,
    suggested_jibun_address: first.jibun_address,
    suggested_english_address: first.english_address,
  };
}

function classify(row, knownByOrigin) {
  const kind = targetKind(row);
  if (row.status === 'deleted') {
    return { queue: 'excluded_deleted', action: 'none', reason_ko: '삭제 상태 행은 주소정합 운영 지표와 자동 보정 대상에서 제외합니다.' };
  }
  if (row.updated_by_admin_id) {
    return { queue: 'excluded_admin_touched', action: 'manual_only', reason_ko: '관리자가 이미 수정/검수한 흔적(updated_by_admin_id)이 있어 자동 처리하지 않습니다.' };
  }
  if (row.geocoding_success === true && hasUsableAddressAndCoordinate(row) && allCoreEvaluationSignalsPass(row) && row.status === 'pending') {
    return { queue: 'auto_approval_candidate', action: 'candidate_only', reason_ko: '좌표·주소·핵심 평가 신호가 모두 통과한 승인 후보입니다. 실제 승인은 관리자 주체와 감사 로그가 필요합니다.' };
  }
  if (!isTargetFailure(row)) {
    return { queue: 'outside_target', action: 'none', reason_ko: '현재 주소정합 False/Failed 개선 대상이 아닙니다.' };
  }
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected' || row.geocoding_false_stage === 0) {
    return { queue: 'excluded_missing_or_not_selected', action: 'manual_only', reason_ko: 'Missing/평가 미대상 또는 0단계 실패라 주소 자동 보정 대상에서 제외합니다.' };
  }

  const suggestion = buildKnownCoordinateSuggestion(row, knownByOrigin);
  if (suggestion) {
    return { queue: 'review_same_origin_known_coordinate', action: 'operator_review', reason_ko: suggestion.reason_ko, suggestion };
  }

  const originAddress = originAddressText(row.origin_address);
  const { lat: originLat, lng: originLng } = originLatLng(row.origin_address);
  if (!originAddress) {
    return { queue: 'recrawl_required_missing_origin_address', action: 'recrawl', reason_ko: '원본 주소 텍스트가 없어 자동 보정 근거가 부족합니다. 원본 영상/후보 재수집이 필요합니다.' };
  }
  if (kind === 'failed') {
    return { queue: 'recrawl_required_geocode_failed', action: 'recrawl', reason_ko: '지오코딩 결과가 실패로 남아 좌표/주소를 승인할 근거가 없습니다. 지도 후보 재조회가 필요합니다.' };
  }
  if (row.geocoding_false_stage === 1) {
    return { queue: 'manual_review_stage_1', action: 'review', reason_ko: `1단계 주소 지오코딩 실패입니다. 원본 주소 “${originAddress}”${isPresent(originLat) && isPresent(originLng) ? '에 좌표 힌트는 있으나' : '만으로'} 지도 후보 확정이 필요합니다.` };
  }
  if (row.geocoding_false_stage === 2) {
    return { queue: 'manual_review_stage_2', action: 'review', reason_ko: `2단계 후보 정합 실패입니다. 원본 주소 “${originAddress}”와 지도 후보 간 거리/상호 검증이 필요합니다.` };
  }
  return { queue: 'manual_review_unknown_stage', action: 'review', reason_ko: '주소정합 실패 단계가 명확하지 않아 수동 검토 큐로 보냅니다.' };
}

function makeReviewRow(row, classification) {
  const loc = locationMatch(row);
  return {
    id: row.id,
    ...consistencySnapshot(row),
    queue: classification.queue,
    action: classification.action,
    reason_ko: classification.reason_ko,
    target_kind: targetKind(row),
    location_match_false_message: loc.falseMessage || '',
    suggested_lat: classification.suggestion?.suggested_lat ?? '',
    suggested_lng: classification.suggestion?.suggested_lng ?? '',
    suggested_road_address: classification.suggestion?.suggested_road_address ?? '',
    suggested_jibun_address: classification.suggestion?.suggested_jibun_address ?? '',
    suggested_english_address: classification.suggestion?.suggested_english_address ?? '',
    suggestion_source_count: classification.suggestion?.source_count ?? '',
    operator_decision: 'hold',
    operator_note: '',
  };
}
function publicReviewRow(row) {
  const {
    phone,
    updated_by_admin_id,
    origin_address,
    evaluation_results,
    db_error_message,
    db_error_details,
    location_match_false_message,
    operator_note,
    ...safe
  } = row;
  return safe;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows, fields) {
  const header = fields.join(',');
  const body = rows.map((row) => fields.map((field) => csvEscape(row[field])).join(',')).join('\n');
  return `${header}\n${body}${body ? '\n' : ''}`;
}

async function writeJson(pathname, payload) {
  await fs.writeFile(pathname, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(pathname, rows) {
  await fs.writeFile(pathname, rows.map((row) => canonicalJson(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function loadRows() {
  const client = await createVerifiedPgClient({ applicationName: 'tzudong-address-consistency-plan' });
  await client.connect();
  try {
    const { rows } = await client.query(`${TARGET_SELECT} order by created_at asc nulls last, id asc`);
    return rows;
  } finally {
    await client.end();
  }
}

export function buildGuardedPlan(rows, { generatedAt = new Date().toISOString(), outputDir = '' } = {}) {
  const orderedRows = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'));
  const knownByOrigin = collectKnownByOrigin(orderedRows);
  const classified = orderedRows.map((row) => ({ row, classification: classify(row, knownByOrigin) }));
  const targetRows = classified.filter(({ row }) => isTargetFailure(row));
  const nonDeletedTargets = targetRows.filter(({ row }) => row.status !== 'deleted');
  const queues = new Map();
  for (const item of classified) {
    const key = item.classification.queue;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(item);
  }

  const targetReviewRows = targetRows.map(({ row, classification }) => makeReviewRow(row, classification));
  const reviewQueueRows = targetReviewRows.filter((row) => !row.queue.startsWith('excluded_')).map(publicReviewRow);
  const sameOriginRows = targetReviewRows.filter((row) => row.queue === 'review_same_origin_known_coordinate');
  const autoApprovalRows = classified
    .filter(({ classification }) => classification.queue === 'auto_approval_candidate')
    .map(({ row, classification }) => publicReviewRow(makeReviewRow(row, classification)));
  const excludedDeleted = targetRows
    .filter(({ classification }) => classification.queue === 'excluded_deleted')
    .map(({ row, classification }) => ({ ...compactRow(row), reason_ko: classification.reason_ko }));
  const excludedAdminTouched = targetRows
    .filter(({ classification }) => classification.queue === 'excluded_admin_touched')
    .map(({ row, classification }) => ({ ...compactRow(row), reason_ko: classification.reason_ko }));

  const queueCounts = Object.fromEntries([...queues.entries()].map(([key, value]) => [key, value.length]).sort(([a], [b]) => a.localeCompare(b, 'en-US')));
  const targetQueueCounts = targetReviewRows.reduce((acc, row) => {
    acc[row.queue] = (acc[row.queue] || 0) + 1;
    return acc;
  }, {});
  const stageCounts = nonDeletedTargets.reduce((acc, { row }) => {
    const key = row.geocoding_false_stage === null ? 'failed_null_stage' : `false_stage_${row.geocoding_false_stage}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: 'read_only_dry_run',
    db_write_performed: false,
    output_dir: outputDir,
    total_rows: orderedRows.length,
    current_live_counts: {
      non_deleted_false: nonDeletedTargets.filter(({ row }) => targetKind(row) === 'false').length,
      non_deleted_failed: nonDeletedTargets.filter(({ row }) => targetKind(row) === 'failed').length,
      deleted_false_or_failed: excludedDeleted.length,
      admin_touched_false_or_failed: excludedAdminTouched.length,
      untouched_false_or_failed: nonDeletedTargets.filter(({ row }) => !row.updated_by_admin_id).length,
    },
    stage_counts_non_deleted: Object.fromEntries(Object.entries(stageCounts).sort(([a], [b]) => a.localeCompare(b, 'en-US'))),
    target_queue_counts: Object.fromEntries(Object.entries(targetQueueCounts).sort(([a], [b]) => a.localeCompare(b, 'en-US'))),
    global_queue_counts: queueCounts,
    auto_approval_candidates: autoApprovalRows.length,
    same_origin_known_coordinate_review_candidates: sameOriginRows.length,
    destructive_apply_allowed_by_this_script: false,
    next_safe_step_ko: autoApprovalRows.length > 0
      ? 'auto-approval-candidates.jsonl을 관리자 주체/감사 로그 정책으로 별도 승인한 뒤 별도 적용 스크립트를 실행하세요.'
      : '현재 자동 승인 후보는 0건입니다. review-queue.csv에서 same-origin 후보를 먼저 사람이 확인하고, 나머지는 재수집/재지오코딩 큐로 보내세요.',
  };
  return {
    summary,
    reviewQueueRows,
    sameOriginRows,
    autoApprovalRows,
    excludedDeleted,
    excludedAdminTouched,
  };
}

async function main() {
  await import('dotenv/config');
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.out, { recursive: true });
  const rows = await loadRows();
  const {
    summary,
    reviewQueueRows,
    sameOriginRows,
    autoApprovalRows,
    excludedDeleted,
    excludedAdminTouched,
  } = buildGuardedPlan(rows, { outputDir: args.out });
  await writeJson(path.join(args.out, 'summary.json'), summary);
  await writeJsonl(path.join(args.out, 'review-queue.jsonl'), reviewQueueRows);
  const privateDir = path.join(args.out, 'operator-private');
  await fs.mkdir(privateDir, { mode: 0o700 });
  await fs.chmod(privateDir, 0o700);
  const privateStat = await fs.lstat(privateDir);
  if (!privateStat.isDirectory() || privateStat.isSymbolicLink()) throw new Error('PRIVATE_OUTPUT_DIRECTORY_INVALID');
  await writeJsonl(path.join(privateDir, 'same-origin-known-coordinate-candidates.jsonl'), sameOriginRows);
  await writeJsonl(path.join(args.out, 'auto-approval-candidates.jsonl'), autoApprovalRows);
  await writeJsonl(path.join(args.out, 'excluded-deleted.jsonl'), excludedDeleted);
  await writeJsonl(path.join(args.out, 'excluded-admin-touched.jsonl'), excludedAdminTouched);

  const fields = [
    'id', 'queue', 'action', 'reason_ko', 'status', 'target_kind', 'geocoding_false_stage',
    'origin_name', 'approved_name', 'naver_name', 'google_name', 'origin_address_text',
    'road_address', 'jibun_address', 'english_address', 'lat', 'lng', 'location_match_false_message',
    'youtube_link', 'updated_at', 'suggested_lat', 'suggested_lng',
    'suggested_road_address', 'suggested_jibun_address', 'suggested_english_address', 'suggestion_source_count',
    'operator_decision', 'operator_note',
  ];
  await fs.writeFile(path.join(args.out, 'review-queue.csv'), toCsv(reviewQueueRows, fields), 'utf8');
  await fs.writeFile(path.join(args.out, 'operator-decision-template.csv'), toCsv(reviewQueueRows, fields), 'utf8');

  const planMd = `# 주소정합 False/Failed 안전 처리 계획\n\n- 생성시각: ${summary.generated_at}\n- 모드: 읽기 전용 드라이런\n- DB UPDATE 수행: 아니오\n\n## 현재 라이브 카운트\n\n- 주소정합 False(삭제 제외): ${summary.current_live_counts.non_deleted_false}\n- 주소정합 Failed(삭제 제외): ${summary.current_live_counts.non_deleted_failed}\n- 삭제 제외 대상: ${summary.current_live_counts.deleted_false_or_failed}\n- 관리자 수정 이력 제외 대상: ${summary.current_live_counts.admin_touched_false_or_failed}\n- 미처리(False/Failed) 대상: ${summary.current_live_counts.untouched_false_or_failed}\n\n## 자동 승인 게이트\n\n현재 자동 승인 후보: ${summary.auto_approval_candidates}건\n\n자동 승인 후보가 되려면 삭제/관리자수정/Missing/평가미대상이 아니고, 좌표+주소가 있으며, 위치/카테고리/근거/방문/리뷰 충실도 신호가 모두 통과해야 합니다.\n\n## 우선순위\n\n1. operator-private/same-origin-known-coordinate-candidates.jsonl (${summary.same_origin_known_coordinate_review_candidates}건): 운영자 전용 원본 스냅샷입니다. 정확히 \`apply\`로 기록한 운영자 결정, 네이버 독립 상호/좌표 근거, NCP 주소/좌표 검증이 모두 필요합니다.\n2. review-queue.csv: Failed/null stage와 stage 1/2 실패를 한국어 사유로 검토합니다.\n3. excluded-deleted.jsonl / excluded-admin-touched.jsonl: 운영 지표와 자동 처리에서 제외합니다.\n4. 검토 완료 후 별도 적용 스크립트는 관리자 주체, raw origin_address CAS, shared YouTube lock, protected-field readback, 감사 로그를 갖춘 뒤 실행해야 합니다.\n`;
  await fs.writeFile(path.join(args.out, 'guarded-plan.md'), planMd, 'utf8');

  if (args.format === 'json') console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Wrote ${args.out}`);
    console.log(`False=${summary.current_live_counts.non_deleted_false} Failed=${summary.current_live_counts.non_deleted_failed} autoApproval=${summary.auto_approval_candidates} sameOriginReview=${summary.same_origin_known_coordinate_review_candidates}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write('build_supabase_address_consistency_guarded_plan failed: ');
    logSafeError(error);
    process.exitCode = 1;
  });
}
