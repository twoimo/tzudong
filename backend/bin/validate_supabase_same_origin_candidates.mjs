#!/usr/bin/env node
/** Read-only live validation for same-origin address correction candidates. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logSafeError } from '../utils/privacy-log.mjs';

const __filename = fileURLToPath(import.meta.url);

const LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';
const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';

function parseArgs(argv) {
  const args = { reportDir: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-dir') args.reportDir = argv[++i] || '';
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/validate_supabase_same_origin_candidates.mjs --report-dir DIR');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.reportDir) throw new Error('--report-dir is required');
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function norm(value) {
  return String(value || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/[<>]/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '').replace(/&gt;/g, '').replace(/&amp;/g, '&').trim().replace(/\s+/g, ' ');
}

function tokens(value) {
  return norm(value).replace(/[()\[\],]/g, ' ').split(/\s+/).filter(Boolean);
}

function parseOriginAddress(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object') return { text: norm(parsed.address), lat: num(parsed.lat), lng: num(parsed.lng) };
  } catch {}
  return { text: norm(value), lat: null, lng: null };
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
const CONSISTENCY_SNAPSHOT_FIELDS = Object.freeze([
  'status', 'channel_name', 'origin_name', 'approved_name', 'naver_name', 'google_name',
  'phone', 'youtube_link', 'geocoding_success', 'geocoding_false_stage', 'updated_by_admin_id',
  'is_missing', 'is_not_selected', 'origin_address', 'origin_address_text', 'road_address', 'jibun_address',
  'english_address', 'lat', 'lng', 'evaluation_results', 'db_error_message', 'db_error_details',
  'updated_at',
]);
const SAME_ORIGIN_CANDIDATE_FIELDS = Object.freeze([
  ...CONSISTENCY_SNAPSHOT_FIELDS,
  'id', 'queue', 'action', 'reason_ko', 'target_kind', 'location_match_false_message',
  'suggested_lat', 'suggested_lng', 'suggested_road_address', 'suggested_jibun_address',
  'suggested_english_address', 'suggestion_source_count', 'operator_decision', 'operator_note',
]);

function candidateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function candidateSha256(candidate) {
  return createHash('sha256').update(Buffer.from(`${stableJson(candidate)}\n`, 'utf8')).digest('hex');
}
function providerResponseEvidence(type, response, receivedAt) {
  return {
    type,
    received_at: receivedAt,
    content_digest: `sha256:${createHash('sha256').update(stableJson(response)).digest('hex')}`,
  };
}

function canonicalText(value, { allowEmpty = false } = {}) {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && value === value.normalize('NFC')
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function canonicalInstant(value) {
  try { return typeof value === 'string' && new Date(value).toISOString() === value; } catch { return false; }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateSameOriginCandidate(candidate) {
  if (!isPlainObject(candidate)
    || SAME_ORIGIN_CANDIDATE_FIELDS.some((field) => !Object.hasOwn(candidate, field))
    || !canonicalText(candidate.id)
    || candidate.queue !== 'review_same_origin_known_coordinate'
    || candidate.action !== 'operator_review'
    || !canonicalText(candidate.origin_name)
    || !canonicalText(candidate.origin_address_text, { allowEmpty: true })
    || !canonicalText(candidate.operator_decision)
    || !['apply', 'hold', 'review'].includes(candidate.operator_decision)
    || !canonicalInstant(candidate.updated_at)
    || !validCoordinates(candidate.suggested_lat, candidate.suggested_lng)
    || !canonicalText(candidate.suggested_road_address, { allowEmpty: true })
    || !canonicalText(candidate.suggested_jibun_address, { allowEmpty: true })
    || (!candidate.suggested_road_address && !candidate.suggested_jibun_address)) {
    throw candidateError('CANDIDATE_INVALID');
  }
  return candidate;
}

export function parseCanonicalCandidateRows(buffer) {
  let raw;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw candidateError('CANDIDATE_ENCODING_INVALID');
  }
  if (!raw.endsWith('\n') || raw.includes('\r')) throw candidateError('CANDIDATE_NONCANONICAL');
  const lines = raw.slice(0, -1).split('\n');
  if (lines.length === 1 && lines[0] === '') return [];
  const ids = new Set();
  const candidates = lines.map((line) => {
    if (!line) throw candidateError('CANDIDATE_NONCANONICAL');
    let candidate;
    try { candidate = JSON.parse(line); } catch { throw candidateError('CANDIDATE_INVALID'); }
    validateSameOriginCandidate(candidate);
    if (line !== stableJson(candidate)) throw candidateError('CANDIDATE_NONCANONICAL');
    if (ids.has(candidate.id)) throw candidateError('CANDIDATE_ID_DUPLICATE');
    ids.add(candidate.id);
    return candidate;
  });
  return candidates.sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
}

function naverCoord(value) {
  const n = num(value);
  return n === null ? null : (Math.abs(n) > 1000 ? n / 10000000 : n);
}

function boundedCoordinatePair(lat, lng) {
  return validCoordinates(lat, lng) ? { lat, lng } : { lat: null, lng: null };
}

function haversineM(lat1, lon1, lat2, lon2) {
  if (!validCoordinates(lat1, lon1) || !validCoordinates(lat2, lon2)) return null;
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

async function naverLocal(query) {
  const response = await fetch(`${LOCAL_URL}?${new URLSearchParams({ query, display: '5', sort: 'comment' })}`, {
    headers: {
      'X-Naver-Client-Id': requireEnv('NAVER_CLIENT_ID_BYEON'),
      'X-Naver-Client-Secret': requireEnv('NAVER_CLIENT_SECRET_BYEON'),
    },
  });
  if (!response.ok) return { ok: false, status: `http_${response.status}`, items: [] };
  const payload = await response.json();
  const items = (payload.items || []).map((item) => {
    const { lat, lng } = boundedCoordinatePair(naverCoord(item.mapy), naverCoord(item.mapx));
    return {
      title: norm(item.title),
      category: norm(item.category),
      address: norm(item.address),
      roadAddress: norm(item.roadAddress),
      mapx: item.mapx ?? null,
      mapy: item.mapy ?? null,
      lng,
      lat,
    };
  }).sort((left, right) => stableJson(left).localeCompare(stableJson(right), 'en-US'));
  return { ok: items.length > 0, status: items.length ? 'ok' : 'no_result', items };
}

async function geocode(query) {
  const response = await fetch(`${GEOCODE_URL}?${new URLSearchParams({ query })}`, {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': requireEnv('NCP_MAPS_KEY_ID_BYEON'),
      'X-NCP-APIGW-API-KEY': requireEnv('NCP_MAPS_KEY_BYEON'),
    },
  });
  if (!response.ok) return { ok: false, status: `http_${response.status}`, addresses: [] };
  const payload = await response.json();
  const addresses = (payload.addresses || []).map((item) => {
    const { lat, lng } = boundedCoordinatePair(num(item.y), num(item.x));
    return {
      roadAddress: norm(item.roadAddress),
      jibunAddress: norm(item.jibunAddress),
      englishAddress: norm(item.englishAddress),
      x: item.x ?? null,
      y: item.y ?? null,
      lng,
      lat,
    };
  }).filter((item) => validCoordinates(item.lat, item.lng))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right), 'en-US')).slice(0, 3);
  return { ok: addresses.length > 0, status: addresses.length ? 'ok' : 'no_result', addresses };
}

function addressOverlapScore(a, b) {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const t of left) if (right.has(t)) hits += 1;
  return hits / Math.max(left.size, right.size);
}

function bestLocalMatch(candidate, local) {
  let best = null;
  for (const item of local.items || []) {
    const titleHit = norm(item.title).includes(norm(candidate.origin_name)) || norm(candidate.origin_name).includes(norm(item.title));
    const roadScore = addressOverlapScore(candidate.suggested_road_address, item.roadAddress || item.address);
    const suggestedDistanceM = haversineM(candidate.suggested_lat, candidate.suggested_lng, item.lat, item.lng);
    const score = (titleHit ? 1 : 0) + roadScore + (suggestedDistanceM !== null && suggestedDistanceM <= 30 ? 1 : 0);
    const enriched = { ...item, titleHit, roadScore: Math.round(roadScore * 100) / 100, suggestedDistanceM, score: Math.round(score * 100) / 100 };
    if (!best || enriched.score > best.score) best = enriched;
  }
  return best;
}

function distanceFromOriginToSuggested(candidate, origin, originGeocode) {
  if (origin.lat !== null && origin.lng !== null) {
    return haversineM(origin.lat, origin.lng, candidate.suggested_lat, candidate.suggested_lng);
  }
  const top = originGeocode.addresses?.[0];
  if (top) return haversineM(top.lat, top.lng, candidate.suggested_lat, candidate.suggested_lng);
  return null;
}

function decision(candidate, origin, localMatch, suggestedGeocode, originGeocode) {
  if (candidate.operator_decision !== 'apply') {
    return { verdict: 'hold', reason_ko: '운영자 결정이 정확히 apply가 아니므로 자동 적용하지 않습니다.' };
  }
  const sourceDistanceM = distanceFromOriginToSuggested(candidate, origin, originGeocode);
  const suggestedGeocodeDistanceM = suggestedGeocode.addresses?.[0]
    ? haversineM(candidate.suggested_lat, candidate.suggested_lng, suggestedGeocode.addresses[0].lat, suggestedGeocode.addresses[0].lng)
    : null;
  const originToSuggestedAddressScore = addressOverlapScore(origin.text, candidate.suggested_road_address || candidate.suggested_jibun_address);
  const localStrong = localMatch && localMatch.titleHit && localMatch.suggestedDistanceM !== null && localMatch.suggestedDistanceM <= 30;
  const ncpCoordinateAndAddressStrong = originGeocode.ok
    && suggestedGeocodeDistanceM !== null
    && suggestedGeocodeDistanceM <= 30
    && sourceDistanceM !== null
    && sourceDistanceM <= 30
    && originToSuggestedAddressScore >= 0.85;
  if (localStrong && ncpCoordinateAndAddressStrong) {
    return { verdict: 'apply_ready', reason_ko: '운영자 apply 결정, 네이버 독립 상호/좌표 일치, NCP 주소/좌표 검증이 모두 충족되었습니다.' };
  }
  if (localStrong && suggestedGeocodeDistanceM !== null && suggestedGeocodeDistanceM <= 30) {
    return { verdict: 'needs_manual_review', reason_ko: '네이버 상호/좌표는 강하지만 NCP 원본 주소 검증이 충분하지 않아 사람 확인이 필요합니다.' };
  }
  return { verdict: 'hold', reason_ko: '네이버 독립 상호 근거 또는 NCP 주소/좌표 검증이 부족해 자동 적용하지 않습니다.' };
}

export async function buildLiveValidationPayload(
  candidates,
  {
    generatedAt = new Date().toISOString(),
    naverLocalFn = naverLocal,
    geocodeFn = geocode,
    delayMs = 120,
  } = {},
) {
  const results = [];
  for (const candidate of [...candidates].sort((left, right) => left.id.localeCompare(right.id, 'en-US'))) {
    validateSameOriginCandidate(candidate);
    const origin = parseOriginAddress(candidate.origin_address_text);
    const query = norm(`${candidate.origin_name} ${origin.text || candidate.suggested_road_address || ''}`);
    const local = await naverLocalFn(query);
    const localReceivedAt = new Date().toISOString();
    const suggestedGeocode = await geocodeFn(candidate.suggested_road_address || candidate.suggested_jibun_address || origin.text);
    const suggestedReceivedAt = new Date().toISOString();
    const originGeocode = origin.text ? await geocodeFn(origin.text) : { ok: false, status: 'empty_query', addresses: [] };
    const originReceivedAt = new Date().toISOString();
    const localMatch = bestLocalMatch(candidate, local);
    const resultDecision = decision(candidate, origin, localMatch, suggestedGeocode, originGeocode);
    results.push({
      id: candidate.id,
      candidate_sha256: candidateSha256(candidate),
      candidate_decision: candidate.operator_decision,
      origin_name: candidate.origin_name,
      origin_address_text: origin.text,
      suggested_road_address: candidate.suggested_road_address,
      suggested_jibun_address: candidate.suggested_jibun_address,
      suggested_lat: candidate.suggested_lat,
      suggested_lng: candidate.suggested_lng,
      source_to_suggested_distance_m: distanceFromOriginToSuggested(candidate, origin, originGeocode),
      origin_to_suggested_address_score: Math.round(addressOverlapScore(origin.text, candidate.suggested_road_address || candidate.suggested_jibun_address) * 100) / 100,
      naver_query: query,
      naver_local_status: local.status,
      best_naver_local_match: localMatch,
      suggested_geocode_status: suggestedGeocode.status,
      suggested_geocode_top: suggestedGeocode.addresses?.[0] || null,
      origin_geocode_status: originGeocode.status,
      origin_geocode_top: originGeocode.addresses?.[0] || null,
      provider_responses: [
        providerResponseEvidence('naver_local_response', local, localReceivedAt),
        providerResponseEvidence('ncp_suggested_geocode_response', suggestedGeocode, suggestedReceivedAt),
        providerResponseEvidence('ncp_origin_geocode_response', originGeocode, originReceivedAt),
      ],
      verdict: resultDecision.verdict,
      reason_ko: resultDecision.reason_ko,
    });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const summaryCounts = results.reduce((acc, row) => {
    acc.set(row.verdict, (acc.get(row.verdict) || 0) + 1);
    return acc;
  }, new Map());
  const summary = Object.fromEntries([...summaryCounts.entries()].sort(([left], [right]) => left.localeCompare(right, 'en-US')));
  return {
    generated_at: generatedAt,
    mode: 'read_only_live_api_validation',
    db_write_performed: false,
    summary,
    results,
  };
}

async function main() {
  await import('dotenv/config');
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.join(args.reportDir, 'same-origin-known-coordinate-candidates.jsonl');
  const candidates = parseCanonicalCandidateRows(await fs.readFile(inputPath));
  const payload = await buildLiveValidationPayload(candidates);
  await fs.writeFile(path.join(args.reportDir, 'same-origin-live-validation.json'), `${stableJson(payload)}\n`, 'utf8');
  const csvFields = ['id','candidate_sha256','candidate_decision','origin_name','verdict','reason_ko','origin_address_text','suggested_road_address','source_to_suggested_distance_m','origin_to_suggested_address_score','naver_query','naver_local_status','suggested_geocode_status'];
  const csv = [csvFields.join(','), ...payload.results.map((row) => csvFields.map((field) => `"${String(row[field] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(args.reportDir, 'same-origin-live-validation.csv'), csv, 'utf8');
  console.log(JSON.stringify({
    generated_at: payload.generated_at,
    mode: payload.mode,
    db_write_performed: payload.db_write_performed,
    summary: payload.summary,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    logSafeError(error, (line) => process.stderr.write(`same_origin_validation_failed ${line}`));
    process.exitCode = 1;
  });
}
