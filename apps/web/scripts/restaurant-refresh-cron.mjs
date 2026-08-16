#!/usr/bin/env node
/**
 * Scheduled approved-restaurant freshness scanner.
 *
 * It only writes refresh runs/candidates. It never auto-applies restaurant row
 * changes; operators must approve candidates from the admin console first.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const operationError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const DEFAULT_OUT = 'apps/web/reports/restaurant-refresh-cron';
const DEFAULT_LIMIT = 50;
const NAVER_LOCAL_ENDPOINT = 'https://openapi.naver.com/v1/search/local.json';
const CHANGE_TYPES = ['name', 'phone', 'address'];

function parseArgs(argv) {
  const args = {
    mode: 'both',
    limit: DEFAULT_LIMIT,
    out: DEFAULT_OUT,
    dryRun: true,
    allowDbWrite: false,
    json: false,
    now: new Date().toISOString(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') args.mode = argv[++i] || args.mode;
    else if (arg === '--limit') args.limit = Number(argv[++i] || DEFAULT_LIMIT);
    else if (arg === '--out') args.out = argv[++i] || args.out;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--allow-db-write') { args.allowDbWrite = true; args.dryRun = false; }
    else if (arg === '--json') args.json = true;
    else if (arg === '--now') args.now = argv[++i] || args.now;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node apps/web/scripts/restaurant-refresh-cron.mjs [--mode candidates|readback|both] [--limit N] [--dry-run|--allow-db-write] [--json]');
      process.exit(0);
    } else {
      throw operationError('RESTAURANT_REFRESH_ARGUMENT_INVALID');
    }
  }
  if (!['candidates', 'readback', 'both'].includes(args.mode)) throw operationError('RESTAURANT_REFRESH_MODE_INVALID');
  if (!Number.isFinite(args.limit) || args.limit < 0) throw operationError('RESTAURANT_REFRESH_LIMIT_INVALID');
  return args;
}

function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function createSupabaseClientFromEnv() {
  const url = envValue('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const key = envValue('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw operationError('RESTAURANT_REFRESH_CREDENTIALS_MISSING');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '')
    .replace(/&gt;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(value) {
  return stripHtml(value).replace(/\s+/g, ' ').trim();
}

function comparable(value) {
  return norm(value).replace(/[\s·・()[\]{}'"“”‘’,.~-]/g, '').toLowerCase();
}

function nonEmpty(value) {
  const text = norm(value);
  return text ? text : null;
}

function normalizePhone(value) {
  return norm(value).replace(/[^0-9]/g, '');
}

function isLikelyKoreanLocalSearchTarget(row) {
  const address = norm([row.road_address, row.jibun_address, row.english_address].filter(Boolean).join(' '));
  if (/[가-힣]+(?:특별시|광역시|특별자치도|도)\s+[가-힣]+/.test(address)) return true;
  if (/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/.test(address)) return true;
  const phoneText = norm(row.phone);
  const digits = normalizePhone(phoneText);
  return !phoneText.startsWith('+') && digits.startsWith('0') && digits.length >= 8;
}

function canonicalSnapshot(row) {
  return {
    name: row.approved_name || row.naver_name || row.google_name || row.origin_name || null,
    phone: row.phone || null,
    road_address: row.road_address || null,
    jibun_address: row.jibun_address || null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    business_state: row.business_state || 'unknown',
    checked_at: row.checked_at || null,
    source: row.source || 'restaurants',
    updated_at: row.updated_at || null,
  };
}

function regionFromRestaurant(row) {
  const text = norm([row.road_address, row.jibun_address, row.english_address].filter(Boolean).join(' '));
  const match = text.match(/[가-힣]+(?:특별시|광역시|특별자치도|도)\s+[가-힣]+(?:시|군|구)(?:\s+[가-힣0-9]+(?:읍|면|동|리|역))?/);
  if (match) return match[0];
  return text.split(/\s+/).slice(0, 3).join(' ');
}

export function buildQueriesForRestaurant(row, maxQueries = 3) {
  const name = nonEmpty(row.approved_name || row.naver_name || row.google_name || row.origin_name);
  const phone = nonEmpty(row.phone);
  const region = regionFromRestaurant(row);
  const address = nonEmpty(row.road_address || row.jibun_address || row.english_address);
  const queries = [
    phone,
    name && region && phone ? `${name} ${region} ${phone}` : '',
    name && region ? `${region} ${name}` : '',
    name && address ? `${name} ${address}` : '',
    name ? `${name} ${region} 전화번호 주소` : '',
    name ? `${name} ${region} 폐업 상호변경` : '',
  ].filter((item) => item && String(item).trim().length >= 2);
  return [...new Set(queries)].slice(0, Math.max(1, maxQueries));
}

function coordinateFromNaver(value, kind) {
  const raw = Number(String(value ?? '').trim());
  if (!Number.isFinite(raw)) return null;
  const candidate = Math.abs(raw) > 1000 ? raw / 10_000_000 : raw;
  if (kind === 'lat' && candidate >= -90 && candidate <= 90) return candidate;
  if (kind === 'lng' && candidate >= -180 && candidate <= 180) return candidate;
  return null;
}

function localItemSnapshot(item, now) {
  const name = nonEmpty(item.title);
  const phone = nonEmpty(item.telephone);
  const roadAddress = nonEmpty(item.roadAddress);
  const jibunAddress = nonEmpty(item.address);
  const lat = coordinateFromNaver(item.mapy, 'lat');
  const lng = coordinateFromNaver(item.mapx, 'lng');
  return {
    name,
    phone,
    road_address: roadAddress,
    jibun_address: jibunAddress,
    lat,
    lng,
    business_state: 'listed',
    checked_at: now,
    source: 'naver_local_api',
    category: nonEmpty(item.category),
    link: nonEmpty(item.link),
  };
}

function addressesDiffer(previous, candidate) {
  const prev = comparable(previous.road_address || previous.jibun_address);
  const next = comparable(candidate.road_address || candidate.jibun_address);
  return Boolean(prev && next && prev !== next && !prev.includes(next) && !next.includes(prev));
}

export function diffSnapshots(previous, candidate) {
  const changes = [];
  const previousName = comparable(previous.name);
  const candidateName = comparable(candidate.name);
  if (previousName && candidateName && previousName !== candidateName && !previousName.includes(candidateName) && !candidateName.includes(previousName)) {
    changes.push('name');
  }
  const previousPhone = normalizePhone(previous.phone);
  const candidatePhone = normalizePhone(candidate.phone);
  if (previousPhone && candidatePhone && previousPhone !== candidatePhone) changes.push('phone');
  if (addressesDiffer(previous, candidate)) changes.push('address');
  if (candidate.business_state === 'not_found_needs_review') changes.push('closure');
  return [...new Set(changes)];
}

function candidateScore(previous, candidate, query) {
  let score = 0;
  const prevName = comparable(previous.name);
  const nextName = comparable(candidate.name);
  const prevAddress = comparable(previous.road_address || previous.jibun_address);
  const nextAddress = comparable(candidate.road_address || candidate.jibun_address);
  const prevPhone = normalizePhone(previous.phone);
  const nextPhone = normalizePhone(candidate.phone);
  const queryText = comparable(query);
  if (prevPhone && nextPhone && prevPhone === nextPhone) score += 6;
  if (prevName && nextName && (prevName.includes(nextName) || nextName.includes(prevName))) score += 4;
  if (prevAddress && nextAddress && (prevAddress.includes(nextAddress) || nextAddress.includes(prevAddress))) score += 4;
  if (nextName && queryText.includes(nextName)) score += 2;
  if (candidate.road_address || candidate.jibun_address) score += 1;
  return score;
}

export function buildCandidateFromLocalItems(row, items, now, query) {
  const previous = canonicalSnapshot(row);
  const snapshots = (items || []).map((item) => ({ snapshot: localItemSnapshot(item, now) }));
  snapshots.sort((a, b) => candidateScore(previous, b.snapshot, query) - candidateScore(previous, a.snapshot, query));
  const selectedPair = snapshots[0] || null;
  const selected = selectedPair?.snapshot || null;
  if (!selected) return null;
  if (candidateScore(previous, selected, query) < 4) return null;
  const detected = diffSnapshots(previous, selected).filter((type) => CHANGE_TYPES.includes(type));
  if (detected.length === 0) return null;
  return {
    restaurant_id: row.id,
    detected_change_types: detected,
    previous_snapshot: previous,
    candidate_snapshot: selected,
    evidence: {
      source: 'naver_local_api',
      query,
      checked_at: now,
      result_count: items.length,
      selected_reason: 'highest_name_phone_address_score',
    },
  };
}

export function buildNoResultCandidate(row, attempts, now) {
  if (!attempts.length || attempts.some((attempt) => attempt.status === 'ok' && attempt.items.length > 0)) return null;
  if (attempts.some((attempt) => attempt.status !== 'ok')) return null;
  if (!isLikelyKoreanLocalSearchTarget(row)) return null;
  const previous = canonicalSnapshot(row);
  return {
    restaurant_id: row.id,
    detected_change_types: ['closure'],
    previous_snapshot: previous,
    candidate_snapshot: {
      ...previous,
      business_state: 'not_found_needs_review',
      checked_at: now,
      source: 'naver_local_api',
    },
    evidence: {
      source: 'naver_local_api',
      checked_at: now,
      decision_boundary: 'no_result_is_review_only_not_closure_fact',
      attempts: attempts.map((attempt) => ({ query: attempt.query, status: attempt.status, result_count: attempt.items.length })),
    },
  };
}

export function buildReadbackMismatchCandidate(candidate, restaurant, now) {
  const expected = candidate.candidate_snapshot || {};
  const actual = canonicalSnapshot({ ...restaurant, checked_at: now, source: 'restaurants_readback' });
  const mismatches = [];
  for (const [key, label] of [['name', 'name'], ['phone', 'phone'], ['road_address', 'address'], ['jibun_address', 'address']]) {
    const expectedValue = key === 'phone' ? normalizePhone(expected[key]) : comparable(expected[key]);
    const actualValue = key === 'phone' ? normalizePhone(actual[key]) : comparable(actual[key]);
    if (expectedValue && actualValue && expectedValue !== actualValue) mismatches.push(label);
  }
  const unique = [...new Set(mismatches)];
  if (unique.length === 0) return null;
  return {
    restaurant_id: candidate.restaurant_id,
    detected_change_types: ['readback_mismatch', ...unique],
    previous_snapshot: expected,
    candidate_snapshot: actual,
    evidence: {
      source: 'restaurants_readback',
      checked_at: now,
      applied_candidate_id: candidate.id,
      reason: 'applied candidate no longer matches restaurant row during readback/recrawl',
    },
  };
}

async function queryNaverLocal(query) {
  const clientId = envValue('NAVER_CLIENT_ID_BYEON', 'NAVER_CLIENT_ID');
  const clientSecret = envValue('NAVER_CLIENT_SECRET_BYEON', 'NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return {
      query,
      status: 'missing_credentials',
      items: [],
      errorCode: 'RESTAURANT_REFRESH_PROVIDER_CREDENTIALS_MISSING',
    };
  }
  const url = new URL(NAVER_LOCAL_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('display', '5');
  url.searchParams.set('sort', 'random');

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        Accept: 'application/json',
      },
    });
  } catch {
    throw operationError('RESTAURANT_REFRESH_PROVIDER_REQUEST_FAILED');
  }

  if (!response.ok) {
    return {
      query,
      status: 'http_error',
      items: [],
      errorCode: 'RESTAURANT_REFRESH_PROVIDER_HTTP_FAILED',
    };
  }

  try {
    const payload = await response.json();
    return {
      query,
      status: 'ok',
      items: Array.isArray(payload.items) ? payload.items : [],
      total: payload.total ?? null,
    };
  } catch {
    throw operationError('RESTAURANT_REFRESH_PROVIDER_RESPONSE_INVALID');
  }
}

async function safeSelect(supabase, table, select, transform) {
  const query = transform(supabase.from(table).select(select));
  const { data, error } = await query;
  if (error) throw operationError('RESTAURANT_REFRESH_DB_SELECT_FAILED');
  return data || [];
}

async function fetchApprovedRestaurants(supabase, limit) {
  const rows = await safeSelect(
    supabase,
    'restaurants',
    'id, approved_name, origin_name, naver_name, google_name, phone, road_address, jibun_address, english_address, lat, lng, status, is_missing, is_not_selected, updated_at, created_at',
    (query) => query
      .eq('status', 'approved')
      .not('is_missing', 'is', true)
      .not('is_not_selected', 'is', true)
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(limit || DEFAULT_LIMIT),
  );
  return rows.filter((row) => row.is_missing !== true && row.is_not_selected !== true);
}

async function fetchOpenCandidateRestaurantIds(supabase, restaurantIds) {
  if (!restaurantIds.length) return new Set();
  const rows = await safeSelect(
    supabase,
    'restaurant_refresh_candidates',
    'restaurant_id',
    (query) => query.in('restaurant_id', restaurantIds).eq('candidate_status', 'needs_review'),
  );
  return new Set(rows.map((row) => row.restaurant_id));
}

async function insertRunAndCandidate(supabase, candidate, runType, now, write) {
  if (!write) return { dry_run: true, candidate_id: null, run_id: null };
  const { data: run, error: runError } = await supabase
    .from('restaurant_refresh_runs')
    .insert({
      restaurant_id: candidate.restaurant_id,
      run_type: runType,
      status: 'completed',
      query: candidate.evidence || {},
      source_snapshot: candidate.previous_snapshot || {},
      notes: runType === 'readback_recrawl' ? 'scheduled readback/recrawl after guarded apply' : 'scheduled approved restaurant freshness scan',
      completed_at: now,
    })
    .select('id')
    .single();
  if (runError) throw operationError('RESTAURANT_REFRESH_RUN_INSERT_FAILED');
  const { data: inserted, error: candidateError } = await supabase
    .from('restaurant_refresh_candidates')
    .insert({
      restaurant_id: candidate.restaurant_id,
      run_id: run.id,
      detected_change_types: candidate.detected_change_types,
      previous_snapshot: candidate.previous_snapshot,
      candidate_snapshot: candidate.candidate_snapshot,
      evidence: candidate.evidence,
      candidate_status: 'needs_review',
    })
    .select('id')
    .single();
  if (candidateError) throw operationError('RESTAURANT_REFRESH_CANDIDATE_INSERT_FAILED');
  return { dry_run: false, candidate_id: inserted.id, run_id: run.id };
}

async function writeReadbackRun(supabase, candidate, restaurant, now, write) {
  if (!write) return { dry_run: true, run_id: null };
  const { data, error } = await supabase
    .from('restaurant_refresh_runs')
    .insert({
      restaurant_id: candidate.restaurant_id,
      run_type: 'readback_recrawl',
      status: 'completed',
      query: { applied_candidate_id: candidate.id, applied_at: candidate.applied_at },
      source_snapshot: canonicalSnapshot({ ...restaurant, checked_at: now, source: 'restaurants_readback' }),
      notes: 'scheduled readback/recrawl matched applied candidate',
      completed_at: now,
    })
    .select('id')
    .single();
  if (error) throw operationError('RESTAURANT_REFRESH_READBACK_RUN_INSERT_FAILED');
  return { dry_run: false, run_id: data.id };
}

async function runCandidateScan(supabase, args) {
  const restaurants = await fetchApprovedRestaurants(supabase, args.limit);
  const openIds = await fetchOpenCandidateRestaurantIds(supabase, restaurants.map((row) => row.id));
  const results = [];
  for (const row of restaurants) {
    if (openIds.has(row.id)) {
      results.push({ restaurant_id: row.id, status: 'skipped_open_candidate' });
      continue;
    }
    const queries = buildQueriesForRestaurant(row, 3);
    const attempts = [];
    let candidate = null;
    for (const query of queries) {
      const attempt = await queryNaverLocal(query);
      attempts.push(attempt);
      if (attempt.status === 'ok') {
        candidate = buildCandidateFromLocalItems(row, attempt.items, args.now, query);
        if (candidate) break;
      }
    }
    if (!candidate) candidate = buildNoResultCandidate(row, attempts, args.now);
    if (!candidate) {
      results.push({
        status: 'no_candidate',
        attempts: attempts.map((attempt) => ({
          status: attempt.status,
          result_count: attempt.items.length,
          error_code: attempt.errorCode || null,
        })),
      });
      continue;
    }
    const writeResult = await insertRunAndCandidate(supabase, candidate, 'scheduled_check', args.now, args.allowDbWrite && !args.dryRun);
    results.push({ status: 'candidate_recorded', detected_change_types: candidate.detected_change_types, ...writeResult });
  }
  return results;
}

async function runReadback(supabase, args) {
  const candidates = await safeSelect(
    supabase,
    'restaurant_refresh_candidates',
    'id, restaurant_id, candidate_status, candidate_snapshot, applied_at, created_at',
    (query) => query.eq('candidate_status', 'applied').not('applied_at', 'is', null).order('applied_at', { ascending: true }).limit(args.limit || DEFAULT_LIMIT),
  );
  const results = [];
  for (const candidate of candidates) {
    const existingReadback = await safeSelect(
      supabase,
      'restaurant_refresh_runs',
      'id',
      (query) => query.eq('restaurant_id', candidate.restaurant_id).eq('run_type', 'readback_recrawl').contains('query', { applied_candidate_id: candidate.id }).limit(1),
    );
    if (existingReadback.length > 0) {
      results.push({ status: 'skipped_existing_readback' });
      continue;
    }
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('id, approved_name, origin_name, naver_name, google_name, phone, road_address, jibun_address, english_address, lat, lng, status, updated_at')
      .eq('id', candidate.restaurant_id)
      .single();
    if (error || !restaurant) throw operationError('RESTAURANT_REFRESH_READBACK_FETCH_FAILED');
    const mismatch = buildReadbackMismatchCandidate(candidate, restaurant, args.now);
    if (mismatch) {
      const writeResult = await insertRunAndCandidate(supabase, mismatch, 'readback_recrawl', args.now, args.allowDbWrite && !args.dryRun);
      results.push({ status: 'readback_mismatch_candidate_recorded', detected_change_types: mismatch.detected_change_types, ...writeResult });
    } else {
      const writeResult = await writeReadbackRun(supabase, candidate, restaurant, args.now, args.allowDbWrite && !args.dryRun);
      results.push({ status: 'readback_ok', ...writeResult });
    }
  }
  return results;
}

function countStatuses(results) {
  return results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {});
}

async function writeReport(args, summary) {
  await fs.mkdir(args.out, { recursive: true });
  const slug = args.now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const file = path.join(args.out, `restaurant-refresh-cron-${slug}.json`);
  await fs.writeFile(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return file;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const supabase = createSupabaseClientFromEnv();
  const candidateResults = args.mode === 'candidates' || args.mode === 'both' ? await runCandidateScan(supabase, args) : [];
  const readbackResults = args.mode === 'readback' || args.mode === 'both' ? await runReadback(supabase, args) : [];
  const summary = {
    generated_at: args.now,
    mode: args.mode,
    db_write_performed: args.allowDbWrite && !args.dryRun,
    auto_apply_performed: false,
    limit: args.limit,
    candidate_scan: {
      scanned: candidateResults.length,
      recorded: candidateResults.filter((row) => row.status === 'candidate_recorded').length,
      skipped_open_candidate: candidateResults.filter((row) => row.status === 'skipped_open_candidate').length,
      no_candidate: candidateResults.filter((row) => row.status === 'no_candidate').length,
      status_counts: countStatuses(candidateResults),
    },
    readback: {
      scanned: readbackResults.length,
      ok: readbackResults.filter((row) => row.status === 'readback_ok').length,
      mismatch_candidates: readbackResults.filter((row) => row.status === 'readback_mismatch_candidate_recorded').length,
      skipped_existing_readback: readbackResults.filter((row) => row.status === 'skipped_existing_readback').length,
      status_counts: countStatuses(readbackResults),
    },
  };
  summary.report_path = await writeReport(args, summary);
  if (args.json) {
    console.log(redactCliText(JSON.stringify(summary), 1024));
  } else {
    console.log(`restaurant refresh cron complete: ${redactCliText(summary.report_path, 512)}`);
  }
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logCliError(error, (line) =>
      process.stderr.write(`[restaurant-refresh-cron] ${line}`),
    );
    process.exitCode = 1;
  });
}
