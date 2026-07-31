#!/usr/bin/env node
/**
 * Build a read-only Google Maps browser review queue for address mismatches.
 *
 * This script does not call Google/Naver geocoding APIs and never writes to DB.
 * It only partitions current Supabase restaurant rows into browser-review input
 * so a separate browser verifier can open Google Maps search pages and collect
 * evidence for human review.
 */
import { config } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifiedPgClient } from '../utils/verified-pg-client.mjs';
import { logSafeError } from '../utils/privacy-log.mjs';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
const DEFAULT_REPORT_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'reports');
config({ path: path.join(BACKEND_ROOT, '.env') });

const TARGET_SELECT = `
  select
    id,
    status,
    approved_name,
    origin_name,
    naver_name,
    google_name,
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

const FOREIGN_HINT_RE = new RegExp([
  '\\b(USA|United States|New York|Los Angeles|Las Vegas|Japan|Hokkaido|Sapporo|Tokyo|Osaka|Budapest|Hungary|Thailand|Bangkok|Vietnam|Taiwan|China|Hong Kong|Singapore|Malaysia|Indonesia|Philippines|Australia|France|Italy|Spain|UK|London|Germany|Canada|Mexico)\\b',
  '北海道|札幌|東京|大阪|台湾|香港|日本|中國|中国',
  '태국|베트남|일본|미국|뉴욕|헝가리|부다페스트|라스베이거스|로스앤젤레스|방콕|대만|홍콩|싱가포르',
  '[ぁ-んァ-ン一-龥]'
].join('|'), 'i');

const KOREA_REGION_RE = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|대한민국|한국|Republic of Korea|Korea)/i;

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = { out: '', limit: 0, foreignOnly: false, format: 'text' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--foreign-only') args.foreignOnly = true;
    else if (arg === '--json') args.format = 'json';
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node bin/build_google_maps_browser_review_queue.mjs [--out DIR] [--limit N] [--foreign-only] [--json]\n\nBuilds read-only Google Maps browser-review queues for address mismatches.`);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `google-maps-browser-review-${timestampSlug()}`);
  return args;
}


function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function originAddressText(value) {
  if (!value) return '';
  if (typeof value === 'string') return norm(value);
  if (typeof value === 'object') return norm(value.address || value.roadAddress || value.jibunAddress || value.fullAddress || '');
  return '';
}

function originLatLng(value) {
  if (!value || typeof value !== 'object') return { lat: null, lng: null };
  return { lat: value.lat ?? value.y ?? null, lng: value.lng ?? value.x ?? null };
}

function targetKind(row) {
  if (row.geocoding_success === false && row.geocoding_false_stage === null) return 'failed';
  if (row.geocoding_success === false && row.geocoding_false_stage !== null) return 'false';
  return 'other';
}

function isTargetFailure(row) {
  return row.geocoding_success === false;
}

function isExcluded(row) {
  if (row.status === 'deleted') return 'excluded_deleted';
  if (row.updated_by_admin_id) return 'excluded_admin_touched';
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected' || row.geocoding_false_stage === 0) return 'excluded_missing_or_not_selected';
  if (!isTargetFailure(row)) return 'outside_target';
  return '';
}

function locationMatch(row) {
  const value = row.evaluation_results?.location_match_TF;
  return value && typeof value === 'object' ? value : {};
}

function classifyCandidate(row) {
  const address = originAddressText(row.origin_address) || norm(row.road_address || row.jibun_address || row.english_address);
  const haystack = `${row.origin_name || ''} ${row.approved_name || ''} ${address}`;
  const foreignHint = FOREIGN_HINT_RE.test(haystack);
  const koreaHint = KOREA_REGION_RE.test(haystack);
  if (foreignHint && !koreaHint) return 'overseas_browser_review';
  if (foreignHint) return 'foreign_hint_browser_review';
  if (row.geocoding_false_stage === 1) return 'domestic_stage_1_browser_review';
  if (row.geocoding_false_stage === 2) return 'domestic_stage_2_browser_review';
  return 'browser_review_unknown_stage';
}

function buildQuery(row) {
  const name = norm(row.origin_name || row.approved_name || row.naver_name || row.google_name);
  const address = originAddressText(row.origin_address) || norm(row.road_address || row.jibun_address || row.english_address);
  return norm(`${name} ${address}`);
}

function makeReviewRow(row) {
  const origin = originLatLng(row.origin_address);
  const loc = locationMatch(row);
  const address = originAddressText(row.origin_address);
  return {
    id: row.id,
    queue: classifyCandidate(row),
    action: 'browser_review',
    status: row.status,
    target_kind: targetKind(row),
    geocoding_false_stage: row.geocoding_false_stage,
    origin_name: row.origin_name,
    approved_name: row.approved_name,
    naver_name: row.naver_name,
    google_name: row.google_name,
    origin_address_text: address,
    road_address: row.road_address,
    jibun_address: row.jibun_address,
    english_address: row.english_address,
    origin_lat: origin.lat,
    origin_lng: origin.lng,
    current_lat: row.lat,
    current_lng: row.lng,
    search_query: buildQuery(row),
    google_maps_search_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(buildQuery(row))}`,
    location_match_false_message: loc.falseMessage || '',
    db_error_message: row.db_error_message || '',
    youtube_link: row.youtube_link,
    updated_at: row.updated_at,
    operator_decision: '',
    operator_note: '',
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, fields) {
  return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => csvEscape(row[field])).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
}

async function writeJson(pathname, payload) {
  await fs.writeFile(pathname, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(pathname, rows) {
  await fs.writeFile(pathname, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.out, { recursive: true });

  const client = await createVerifiedPgClient({ applicationName: 'tzudong-google-maps-review-queue' });
  await client.connect();
  let rows;
  try {
    ({ rows } = await client.query(`${TARGET_SELECT} order by created_at asc nulls last, id asc`));
  } finally {
    await client.end();
  }

  const targets = rows.filter(isTargetFailure);
  const excludedCounts = {};
  for (const row of rows) {
    const key = isExcluded(row);
    if (key) excludedCounts[key] = (excludedCounts[key] || 0) + 1;
  }
  let reviewRows = targets.filter((row) => !isExcluded(row)).map(makeReviewRow);
  if (args.foreignOnly) reviewRows = reviewRows.filter((row) => row.queue === 'overseas_browser_review' || row.queue === 'foreign_hint_browser_review');
  const unboundedCount = reviewRows.length;
  if (args.limit > 0) reviewRows = reviewRows.slice(0, args.limit);

  const queueCounts = reviewRows.reduce((acc, row) => {
    acc[row.queue] = (acc[row.queue] || 0) + 1;
    return acc;
  }, {});
  const summary = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: 'read_only_browser_review_queue',
    db_write_performed: false,
    google_api_used: false,
    output_dir: args.out,
    total_rows: rows.length,
    target_false_or_failed: targets.length,
    excluded_counts: Object.fromEntries(Object.entries(excludedCounts).sort(([a], [b]) => a.localeCompare(b))),
    review_queue_count_unbounded: unboundedCount,
    review_queue_count_written: reviewRows.length,
    queue_counts_written: Object.fromEntries(Object.entries(queueCounts).sort(([a], [b]) => a.localeCompare(b))),
    next_safe_step_ko: 'validate_google_maps_browser_candidates.mjs로 소량 검증을 실행하고, 생성된 후보/스크린샷을 관리자 승인 대상으로만 사용하세요.',
  };

  await writeJson(path.join(args.out, 'summary.json'), summary);
  await writeJsonl(path.join(args.out, 'google-maps-browser-review-queue.jsonl'), reviewRows);
  const fields = ['id','queue','action','status','target_kind','geocoding_false_stage','origin_name','approved_name','origin_address_text','search_query','google_maps_search_url','origin_lat','origin_lng','current_lat','current_lng','location_match_false_message','db_error_message','youtube_link','updated_at','operator_decision','operator_note'];
  await fs.writeFile(path.join(args.out, 'google-maps-browser-review-queue.csv'), toCsv(reviewRows, fields), 'utf8');

  if (args.format === 'json') console.log(JSON.stringify(summary, null, 2));
  else console.log(`Wrote ${args.out}\nreviewQueue=${summary.review_queue_count_written}/${summary.review_queue_count_unbounded} googleApiUsed=false`);
}

main().catch((error) => {
  process.stderr.write('build_google_maps_browser_review_queue failed: ');
  logSafeError(error);
  process.exitCode = 1;
});
