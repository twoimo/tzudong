#!/usr/bin/env node
/**
 * Build a file-backed evidence ledger for Tzuyang address mismatch review.
 *
 * The script is intentionally read-only against Supabase. It gathers the current
 * false/failed address rows, enriches them from local video/transcript/frame
 * artifacts, and writes a strict apply-vs-review ledger for administrator HITL.
 */
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const BACKEND_ROOT = path.resolve(path.dirname(__filename), '..');
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), override: false });

const DEFAULT_REPORT_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'reports');
const DEFAULT_EVALUATION_ROOT = path.join(BACKEND_ROOT, 'restaurant-evaluation', 'data', 'tzuyang', 'evaluation');
const DEFAULT_CRAWLING_ROOT = path.join(BACKEND_ROOT, 'restaurant-crawling', 'data', 'tzuyang');
const SCHEMA_VERSION = 1;

const BASE_COLUMNS = [
  'id', 'status', 'approved_name', 'origin_name', 'naver_name', 'google_name',
  'youtube_link', 'geocoding_success', 'geocoding_false_stage',
  'updated_by_admin_id', 'is_missing', 'is_not_selected', 'origin_address',
  'road_address', 'jibun_address', 'english_address', 'lat', 'lng',
  'evaluation_results', 'db_error_message', 'db_error_details', 'updated_at',
  'created_at', 'channel_name', 'phone', 'reasoning_basis', 'youtube_meta',
  'description_map_url', 'trace_id_name_source',
];

export const EVIDENCE_FAMILIES = Object.freeze([
  'transcript_region',
  'multimodal_region',
  'visual_signage',
  'visual_phone',
  'neighbor_street',
  'map_provider',
  'web_blog',
  'same_origin_history',
  'legacy_location_match',
]);

const VIDEO_FAMILIES = new Set(['transcript_region', 'multimodal_region', 'visual_signage', 'visual_phone', 'neighbor_street']);
const EXTERNAL_FAMILIES = new Set(['map_provider', 'web_blog']);
const RISK_BLOCKERS = new Set([
  'conflicting_high_precedence_evidence',
  'insufficient_video_evidence',
  'insufficient_external_evidence',
  'insufficient_family_count',
  'stale_db_row',
  'same_youtube_duplicate',
  'deleted_or_admin_touched',
  'missing_or_not_selected',
  'stage0_not_applyable',
  'provider_blocked',
  'rate_limited',
  'ambiguous_candidates',
  'no_precise_address',
  'missing_all_evidence_inputs',
  'candidate_place_not_precise',
  'candidate_place_not_evidence_derived',
]);

function timestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv) {
  const args = {
    out: '',
    evaluationRoot: DEFAULT_EVALUATION_ROOT,
    crawlingRoot: DEFAULT_CRAWLING_ROOT,
    guardedReportDir: '',
    format: 'text',
    limit: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--evaluation-root') args.evaluationRoot = argv[++i] || '';
    else if (arg === '--crawling-root') args.crawlingRoot = argv[++i] || '';
    else if (arg === '--from-guarded-report') args.guardedReportDir = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--json') args.format = 'json';
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node bin/build_tzuyang_address_evidence_ledger.mjs [--out DIR] [--from-guarded-report DIR] [--limit N] [--json]\n\nBuilds a read-only evidence ledger for Tzuyang address mismatch review.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) args.out = path.join(DEFAULT_REPORT_ROOT, `tzuyang-address-evidence-ledger-${timestampSlug()}`);
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function pgSslConfig() {
  return /^(0|false|disable)$/i.test(process.env.SUPABASE_DB_SSL || '') ? false : { rejectUnauthorized: false };
}

function getPgClient() {
  return new pg.Client({
    host: requireEnv('SUPABASE_DB_HOST'),
    port: Number(requireEnv('SUPABASE_DB_PORT')),
    database: requireEnv('SUPABASE_DB_NAME'),
    user: requireEnv('SUPABASE_DB_USER'),
    password: requireEnv('SUPABASE_DB_PASSWORD'),
    ssl: pgSslConfig(),
  });
}

function norm(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function compact(items) {
  return items.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

function uniq(items) {
  return [...new Set(items.filter((item) => item !== null && item !== undefined && String(item).trim() !== ''))];
}

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function readJsonlLines(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

async function readJsonlFile(file) {
  try {
    return readJsonlLines(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function youtubeVideoId(link) {
  const text = norm(link);
  if (!text) return '';
  const direct = text.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (direct) return direct[1];
  const short = text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  if (short) return short[1];
  return '';
}

function originAddressText(value) {
  const parsed = parseJsonMaybe(value);
  if (!parsed) return '';
  if (typeof parsed === 'string') return norm(parsed);
  if (typeof parsed === 'object') return norm(parsed.address || parsed.roadAddress || parsed.jibunAddress || parsed.fullAddress || '');
  return '';
}

function sourceLatLng(value) {
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== 'object') return { lat: null, lng: null };
  const lat = parsed.lat ?? parsed.y ?? null;
  const lng = parsed.lng ?? parsed.x ?? null;
  return { lat, lng };
}

function locationMatch(row) {
  const evalResults = parseJsonMaybe(row.evaluation_results);
  if (!evalResults || typeof evalResults !== 'object') return {};
  const value = evalResults.location_match_TF;
  return value && typeof value === 'object' ? value : {};
}

function isTargetFailure(row) {
  return row.geocoding_success === false || row.geocoding_success === 'false';
}

function targetKind(row) {
  if (!isTargetFailure(row)) return 'other';
  return row.geocoding_false_stage === null || row.geocoding_false_stage === undefined ? 'failed' : 'false';
}

function isDeleted(row) {
  return row.status === 'deleted';
}

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeName(value) {
  return norm(value).replace(/^\[비공개\]\s*/, '').replace(/[\s·・]/g, '').toLowerCase();
}

function coordinateKey(row) {
  if (!isPresent(row.lat) || !isPresent(row.lng)) return '';
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(7)},${lng.toFixed(7)}`;
}

function precisePlacePayload(source, roadAddress, jibunAddress, lat, lng, derivedFromCurrentEvidence) {
  return {
    source,
    road_address: roadAddress || '',
    jibun_address: jibunAddress || '',
    lat: lat ?? null,
    lng: lng ?? null,
    derived_from_current_evidence: Boolean(derivedFromCurrentEvidence),
  };
}

function providerPlacePayload(row, local, localLoc) {
  const naverCandidate = Array.isArray(localLoc?.naver_address) ? localLoc.naver_address[0] || {} : {};
  if (isPresent(naverCandidate.roadAddress) || isPresent(naverCandidate.jibunAddress) || isPresent(naverCandidate.lat) || isPresent(naverCandidate.lng)) {
    return precisePlacePayload('location_match_naver_address', naverCandidate.roadAddress, naverCandidate.jibunAddress, naverCandidate.lat, naverCandidate.lng, true);
  }
  if (isPresent(local?.roadAddress) || isPresent(local?.jibunAddress) || isPresent(local?.lat) || isPresent(local?.lng)) {
    return precisePlacePayload('transform_place', local?.roadAddress, local?.jibunAddress, local?.lat, local?.lng, true);
  }
  return precisePlacePayload('db_snapshot', row.road_address, row.jibun_address, row.lat, row.lng, false);
}

function regionTokens(...values) {
  const text = values.map((value) => norm(value)).filter(Boolean).join(' ');
  const tokens = [];
  const regexes = [
    /[가-힣]+(?:특별시|광역시|도|시|군|구|읍|면|동|리|역)/g,
    /[가-힣0-9]+(?:대로|로|길)(?:\d+길)?/g,
  ];
  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) tokens.push(match[0]);
  }
  return uniq(tokens).slice(0, 20);
}

function phoneTokens(...values) {
  const text = values.map((value) => norm(value)).join(' ');
  return uniq([...text.matchAll(/(?:0\d{1,2}[-.\s]?)?\d{3,4}[-.\s]?\d{4}/g)].map((match) => match[0].trim())).slice(0, 8);
}

function textIncludesAny(text, needles) {
  const hay = norm(text).replace(/\s/g, '');
  return needles.some((needle) => needle && hay.includes(String(needle).replace(/\s/g, '')));
}

function snippet(text, needles, maxLen = 220) {
  const normalized = norm(text);
  if (!normalized) return '';
  const compactText = normalized.replace(/\s/g, '');
  let idx = 0;
  for (const needle of needles) {
    const pos = compactText.indexOf(String(needle).replace(/\s/g, ''));
    if (pos >= 0) { idx = Math.max(0, pos - 60); break; }
  }
  return normalized.slice(idx, idx + maxLen);
}

function evidence(family, source, summary, payload = {}, confidence = 'medium') {
  return { family, source, summary: norm(summary), confidence, payload };
}

async function loadLocalArtifacts(evaluationRoot, crawlingRoot) {
  const transformRows = await readJsonlFile(path.join(evaluationRoot, 'transforms.jsonl'));
  const transformsByVideo = new Map();
  for (const row of transformRows) {
    const vid = youtubeVideoId(row.youtube_link);
    if (!vid) continue;
    if (!transformsByVideo.has(vid)) transformsByVideo.set(vid, []);
    transformsByVideo.get(vid).push(row);
  }

  const transcriptByVideo = new Map();
  const frameCaptionByVideo = new Map();
  for (const [dirName, target] of [['transcript', transcriptByVideo], ['frame-caption', frameCaptionByVideo]]) {
    const dir = path.join(crawlingRoot, dirName);
    let files = [];
    try { files = await fs.readdir(dir); } catch { files = []; }
    await Promise.all(files.filter((file) => file.endsWith('.jsonl')).map(async (file) => {
      const vid = file.replace(/\.jsonl$/, '');
      target.set(vid, await readJsonlFile(path.join(dir, file)));
    }));
  }

  const metaByVideo = new Map();
  const metaDir = path.join(crawlingRoot, 'meta');
  let metaFiles = [];
  try { metaFiles = await fs.readdir(metaDir); } catch { metaFiles = []; }
  await Promise.all(metaFiles.filter((file) => file.endsWith('.jsonl')).map(async (file) => {
    const vid = file.replace(/\.jsonl$/, '');
    const rows = await readJsonlFile(path.join(metaDir, file));
    if (rows[0]) metaByVideo.set(vid, rows[0]);
  }));

  return { transformsByVideo, transcriptByVideo, frameCaptionByVideo, metaByVideo };
}

function collectKnownByOrigin(rows) {
  const known = new Map();
  for (const row of rows) {
    if (isDeleted(row) || row.geocoding_success !== true || !coordinateKey(row)) continue;
    const key = normalizeName(row.origin_name || row.approved_name || row.naver_name || row.google_name);
    if (!key) continue;
    const entry = known.get(key) || { rows: [], coordinateKeys: new Set() };
    entry.rows.push(row);
    entry.coordinateKeys.add(coordinateKey(row));
    known.set(key, entry);
  }
  return known;
}

function collectDuplicateYoutube(rows) {
  const byVideo = new Map();
  for (const row of rows) {
    const vid = youtubeVideoId(row.youtube_link);
    if (!vid || isDeleted(row)) continue;
    if (!byVideo.has(vid)) byVideo.set(vid, []);
    byVideo.get(vid).push(row);
  }
  return byVideo;
}

function buildSearchQueries(row, local, tokens) {
  const name = row.origin_name || row.approved_name || row.naver_name || row.google_name || '';
  const address = originAddressText(row.origin_address) || row.road_address || row.jibun_address || '';
  const phoneValues = phoneTokens(row.phone, local?.reasoning_basis, JSON.stringify(local?.evaluation_results || {}));
  const region = tokens[0] || '';
  return uniq(compact([
    `${name} ${address}`,
    region ? `${region} ${name}` : '',
    phoneValues[0] ? `${phoneValues[0]}` : '',
    phoneValues[0] ? `${name} ${region} ${phoneValues[0]}` : '',
    `${name} ${region} 상호변경 폐업 블로그`,
  ])).map((query) => ({ query: norm(query), purpose: query.match(/\d{3,4}/) ? 'phone_or_name_region_lookup' : 'name_region_address_lookup' }));
}

function collectEvidence(row, artifacts, knownByOrigin, duplicateByVideo) {
  const videoId = youtubeVideoId(row.youtube_link);
  const localRows = artifacts.transformsByVideo.get(videoId) || [];
  const local = localRows.find((item) => normalizeName(item.origin_name) === normalizeName(row.origin_name)) || localRows[0] || null;
  const meta = artifacts.metaByVideo.get(videoId) || null;
  const transcriptRows = artifacts.transcriptByVideo.get(videoId) || [];
  const frameRows = artifacts.frameCaptionByVideo.get(videoId) || [];
  const evalResults = parseJsonMaybe(row.evaluation_results) || {};
  const localEval = parseJsonMaybe(local?.evaluation_results) || {};
  const loc = locationMatch(row);
  const localLoc = localEval.location_match_TF || {};
  const addrText = originAddressText(row.origin_address) || originAddressText(local?.origin_address) || row.road_address || row.jibun_address || local?.roadAddress || local?.jibunAddress || '';
  const regions = regionTokens(addrText, row.road_address, row.jibun_address, local?.reasoning_basis, localEval.rb_grounding_TF?.eval_basis, meta?.title, local?.youtube_meta?.title);
  const nameNeedles = uniq(compact([row.origin_name, row.approved_name, row.naver_name, row.google_name, local?.origin_name, local?.naver_name]));
  const needles = uniq([...regions, ...nameNeedles]);
  const evidences = [];

  if (local?.reasoning_basis || localEval.rb_grounding_TF?.eval_basis || localEval.rb_inference_score?.eval_basis) {
    const basis = compact([local.reasoning_basis, localEval.rb_grounding_TF?.eval_basis, localEval.rb_inference_score?.eval_basis]).join(' / ');
    const family = regions.length ? 'multimodal_region' : 'visual_signage';
    evidences.push(evidence(family, `transform:${videoId}`, snippet(basis, needles), {
      regions,
      title: local.youtube_meta?.title || meta?.title || '',
      source_type: local.source_type || '',
    }, 'high'));
  }

  const transcriptTexts = transcriptRows.flatMap((rowItem) => Array.isArray(rowItem.transcript) ? rowItem.transcript : []).filter((item) => item && typeof item.text === 'string');
  const transcriptHit = transcriptTexts.find((item) => textIncludesAny(item.text, needles));
  if (transcriptHit) {
    evidences.push(evidence('transcript_region', `transcript:${videoId}`, snippet(transcriptHit.text, needles), {
      start: transcriptHit.start,
      duration: transcriptHit.duration,
      regions: regions.filter((token) => textIncludesAny(transcriptHit.text, [token])),
    }, 'high'));
  }

  const frameHit = frameRows.find((item) => textIncludesAny(item.raw_caption || JSON.stringify(item.parsed_json || ''), needles));
  if (frameHit) {
    evidences.push(evidence('visual_signage', `frame-caption:${videoId}`, snippet(frameHit.raw_caption || JSON.stringify(frameHit.parsed_json), needles), {
      start_sec: frameHit.start_sec,
      end_sec: frameHit.end_sec,
      file_names: Array.isArray(frameHit.file_names) ? frameHit.file_names.slice(0, 3) : [],
    }, 'medium'));
  }

  const phones = phoneTokens(row.phone, local?.reasoning_basis, localEval.rb_grounding_TF?.eval_basis, frameRows.map((item) => item.raw_caption).join(' '));
  if (phones.length) {
    evidences.push(evidence('visual_phone', `phone-hints:${videoId || row.id}`, `전화번호 후보 ${phones.join(', ')}`, { phones }, 'medium'));
  }

  if (regions.some((token) => /(?:대로|로|길|역|동|읍|면|리)$/.test(token))) {
    evidences.push(evidence('neighbor_street', `region-token:${videoId || row.id}`, `지역/거리 단서: ${regions.slice(0, 8).join(', ')}`, { regions }, 'medium'));
  }

  const provider = providerPlacePayload(row, local, localLoc);
  const providerAddress = provider.road_address || provider.jibun_address || '';
  if (providerAddress || isPresent(provider.lat) || isPresent(provider.lng)) {
    evidences.push(evidence('map_provider', `db-or-transform-provider:${row.id}`, `지도/지오코딩 주소 후보: ${providerAddress || addrText || '좌표 후보만 있음'}`, provider, 'medium'));
  }

  if (local?.description_map_url || /웹 검색|블로그|리뷰|전화번호/.test(norm(local?.reasoning_basis))) {
    evidences.push(evidence('web_blog', `web-context:${videoId || row.id}`, snippet(local?.reasoning_basis || local.description_map_url, needles), {
      description_map_url: local?.description_map_url || '',
    }, 'medium'));
  }

  const sameOrigin = knownByOrigin.get(normalizeName(row.origin_name || row.approved_name || row.naver_name || row.google_name));
  if (sameOrigin && sameOrigin.coordinateKeys.size === 1) {
    const first = sameOrigin.rows[0];
    evidences.push(evidence('same_origin_history', `restaurants:${first.id}`, `같은 원본 상호의 기존 성공 좌표 1개: ${first.road_address || first.jibun_address || coordinateKey(first)}`, {
      source_ids: sameOrigin.rows.slice(0, 10).map((item) => item.id),
      coordinate_key: coordinateKey(first),
      road_address: first.road_address,
      jibun_address: first.jibun_address,
    }, 'low'));
  }

  if (loc.falseMessage || localLoc.falseMessage || loc.eval_value !== undefined || localLoc.eval_value !== undefined) {
    evidences.push(evidence('legacy_location_match', `location_match_TF:${row.id}`, norm(loc.falseMessage || localLoc.falseMessage || `legacy eval=${loc.eval_value ?? localLoc.eval_value}`), {
      row_eval_value: loc.eval_value,
      local_eval_value: localLoc.eval_value,
      pending_reason: loc.pending_reason || localLoc.pending_reason || '',
    }, loc.eval_value === true || localLoc.eval_value === true ? 'medium' : 'low'));
  }

  const duplicateRows = (duplicateByVideo.get(videoId) || []).filter((item) => item.id !== row.id);
  const sourceTexts = compact([
    local?.reasoning_basis,
    local?.youtuber_review,
    localEval.rb_grounding_TF?.eval_basis,
    localEval.rb_inference_score?.eval_basis,
    loc.falseMessage,
    localLoc.falseMessage,
    frameRows.map((item) => item.raw_caption).join(' '),
  ]).join(' ');
  const riskFlags = [];
  if (/폐업|휴업|영업\s*종료|이전|상호\s*변경|구상호|옛\s*상호|리뉴얼/.test(sourceTexts)) riskFlags.push('business_state_or_rename_hint');
  if (phones.length) riskFlags.push('phone_hint_present');
  if (sameOrigin && sameOrigin.coordinateKeys.size === 1) riskFlags.push('same_origin_address_candidate');
  if (isDeleted(row) || row.updated_by_admin_id) riskFlags.push('deleted_or_admin_touched');
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected') riskFlags.push('missing_or_not_selected');
  if (row.geocoding_false_stage === 0) riskFlags.push('stage0_not_applyable');
  if (!addrText && !row.road_address && !row.jibun_address) riskFlags.push('no_precise_address');
  if (!evidences.length) riskFlags.push('missing_all_evidence_inputs');
  if (duplicateRows.some((item) => normalizeName(item.origin_name) === normalizeName(row.origin_name))) riskFlags.push('same_youtube_duplicate');

  return {
    evidences,
    regions,
    local,
    meta,
    searchQueries: buildSearchQueries(row, local, regions),
    duplicateRows,
    riskFlags,
  };
}

export function strictPredicate(evidences, riskFlags = []) {
  const families = uniq(evidences.map((item) => item.family));
  const hasVideo = families.some((family) => VIDEO_FAMILIES.has(family));
  const hasExternal = families.some((family) => EXTERNAL_FAMILIES.has(family));
  const blocking = riskFlags.filter((flag) => RISK_BLOCKERS.has(flag));
  const missing = [];
  if (families.length < 3) missing.push('insufficient_family_count');
  if (!hasVideo) missing.push('insufficient_video_evidence');
  if (!hasExternal) missing.push('insufficient_external_evidence');
  return {
    pass: families.length >= 3 && hasVideo && hasExternal && blocking.length === 0,
    families,
    has_video_derived_evidence: hasVideo,
    has_external_provider_evidence: hasExternal,
    blocking_risk_flags: blocking,
    missing_requirements: missing,
  };
}

function candidatePlaces(row, collected) {
  const local = collected.local;
  const provider = collected.evidences.find((item) => item.family === 'map_provider')?.payload || providerPlacePayload(row, local, {}, {});
  return [{
    name: row.origin_name || row.approved_name || local?.origin_name || '',
    aliases: uniq(compact([row.approved_name, row.naver_name, row.google_name, local?.naver_name, local?.google_name])),
    phone: row.phone || '',
    origin_address_text: originAddressText(row.origin_address) || originAddressText(local?.origin_address) || '',
    road_address: provider.road_address || '',
    jibun_address: provider.jibun_address || '',
    lat: provider.lat ?? null,
    lng: provider.lng ?? null,
    evidence_source: provider.source || 'none',
    derived_from_current_evidence: Boolean(provider.derived_from_current_evidence),
    confidence: provider.derived_from_current_evidence ? 'review_required' : 'not_applyable_without_current_place_evidence',
  }];
}

function candidateHasPrecisePlace(candidate) {
  return (isPresent(candidate.road_address) || isPresent(candidate.jibun_address)) && isPresent(candidate.lat) && isPresent(candidate.lng);
}

function candidateRiskFlags(candidates) {
  const first = candidates[0] || {};
  const flags = [];
  if (!candidateHasPrecisePlace(first)) flags.push('candidate_place_not_precise');
  if (!first.derived_from_current_evidence) flags.push('candidate_place_not_evidence_derived');
  return flags;
}

function scopeStatus(row) {
  if (isDeleted(row)) return { status: 'excluded', reason: 'deleted' };
  if (row.updated_by_admin_id) return { status: 'excluded', reason: 'admin_touched' };
  if (truthy(row.is_missing) || truthy(row.is_not_selected) || row.status === 'missing' || row.status === 'not_selected') return { status: 'excluded', reason: 'missing_or_not_selected' };
  if (row.geocoding_false_stage === 0) return { status: 'excluded', reason: 'stage0' };
  return { status: 'target', reason: targetKind(row) };
}

export function buildLedgerRows(rows, artifacts, generatedAt = new Date().toISOString()) {
  const localVideoIds = new Set(artifacts.transformsByVideo.keys());
  const knownByOrigin = collectKnownByOrigin(rows);
  const duplicateByVideo = collectDuplicateYoutube(rows);
  const targets = rows.filter((row) => isTargetFailure(row)).filter((row) => {
    const vid = youtubeVideoId(row.youtube_link);
    return row.channel_name === 'tzuyang' || localVideoIds.has(vid) || /tzuyang/i.test(norm(row.channel_name));
  });

  return targets.map((row) => {
    const videoId = youtubeVideoId(row.youtube_link);
    const collected = collectEvidence(row, artifacts, knownByOrigin, duplicateByVideo);
    const candidates = candidatePlaces(row, collected);
    const scope = scopeStatus(row);
    const preflightRiskFlags = uniq([...collected.riskFlags, ...candidateRiskFlags(candidates)]);
    const strict = strictPredicate(collected.evidences, preflightRiskFlags);
    const decision = scope.status === 'excluded'
      ? 'excluded'
      : strict.pass ? 'apply_candidate' : 'manual_review';
    const missingFlags = strict.missing_requirements.filter((flag) => !preflightRiskFlags.includes(flag));
    const riskFlags = uniq([...preflightRiskFlags, ...missingFlags]);
    return {
      schema_version: SCHEMA_VERSION,
      generated_at: generatedAt,
      id: row.id,
      scope_status: scope.status,
      scope_reason: scope.reason,
      exclusion_reason: scope.status === 'excluded' ? scope.reason : null,
      db_snapshot: {
        status: row.status,
        channel_name: row.channel_name || null,
        origin_name: row.origin_name || null,
        approved_name: row.approved_name || null,
        naver_name: row.naver_name || null,
        google_name: row.google_name || null,
        phone: row.phone || null,
        geocoding_success: row.geocoding_success,
        geocoding_false_stage: row.geocoding_false_stage,
        updated_by_admin_id: row.updated_by_admin_id || null,
        is_missing: row.is_missing || false,
        is_not_selected: row.is_not_selected || false,
        origin_address_text: originAddressText(row.origin_address),
        road_address: row.road_address || null,
        jibun_address: row.jibun_address || null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        updated_at: row.updated_at || null,
      },
      video_id: videoId,
      youtube_link: row.youtube_link || null,
      evidence: collected.evidences,
      evidence_families: strict.families,
      evidence_classes: {
        video_derived: strict.has_video_derived_evidence,
        external_provider: strict.has_external_provider_evidence,
        legacy_only: strict.families.length > 0 && strict.families.every((family) => family === 'legacy_location_match'),
      },
      candidate_places: candidates,
      search_queries: collected.searchQueries,
      cross_checks: [
        { name: 'strict_family_count', passed: strict.families.length >= 3, value: strict.families.length, required: 3 },
        { name: 'video_evidence_required', passed: strict.has_video_derived_evidence },
        { name: 'external_evidence_required', passed: strict.has_external_provider_evidence },
        { name: 'blocking_risks_absent', passed: strict.blocking_risk_flags.length === 0, value: strict.blocking_risk_flags },
        { name: 'business_state_or_rename_hint', passed: !riskFlags.includes('business_state_or_rename_hint'), value: riskFlags.includes('business_state_or_rename_hint') },
        { name: 'phone_hint_present', passed: true, value: riskFlags.includes('phone_hint_present') },
        { name: 'same_origin_address_candidate', passed: true, value: riskFlags.includes('same_origin_address_candidate') },
      ],
      risk_flags: riskFlags,
      strict_predicate_result: { ...strict, pass: strict.pass && scope.status === 'target' },
      decision,
      decision_reason_ko: decision === 'apply_candidate'
        ? '자동 적용 전 dry-run 후보입니다. 실제 DB 쓰기는 별도 guarded apply와 readback 검증이 필요합니다.'
        : decision === 'excluded'
          ? `자동 적용 제외: ${scope.reason}`
          : '증거 family/영상/외부 근거 또는 위험 플래그 조건이 부족해 관리자 검토가 필요합니다.',
      source_artifacts: compact([
        collected.local ? `backend/restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl#${videoId}` : '',
        artifacts.transcriptByVideo.has(videoId) ? `backend/restaurant-crawling/data/tzuyang/transcript/${videoId}.jsonl` : '',
        artifacts.frameCaptionByVideo.has(videoId) ? `backend/restaurant-crawling/data/tzuyang/frame-caption/${videoId}.jsonl` : '',
        artifacts.metaByVideo.has(videoId) ? `backend/restaurant-crawling/data/tzuyang/meta/${videoId}.jsonl` : '',
      ]),
    };
  });
}

async function getExistingColumns(client) {
  const { rows } = await client.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'restaurants'`);
  return new Set(rows.map((row) => row.column_name));
}

async function loadRowsFromSupabase(limit = 0) {
  const client = getPgClient();
  await client.connect();
  try {
    const columns = await getExistingColumns(client);
    const selected = BASE_COLUMNS.filter((column) => columns.has(column));
    const sql = `select ${selected.join(', ')} from restaurants order by created_at asc nulls last, id asc${limit ? ` limit ${Number(limit)}` : ''}`;
    const { rows } = await client.query(sql);
    return rows;
  } finally {
    await client.end();
  }
}

async function loadRowsFromGuardedReport(dir) {
  const rows = [];
  for (const file of ['review-queue.jsonl', 'excluded-deleted.jsonl', 'excluded-admin-touched.jsonl']) {
    const fileRows = await readJsonlFile(path.join(dir, file));
    rows.push(...fileRows.map((row) => ({
      ...row,
      channel_name: row.channel_name || 'tzuyang',
      geocoding_success: false,
      geocoding_false_stage: row.geocoding_false_stage ?? null,
      updated_by_admin_id: file === 'excluded-admin-touched.jsonl' ? 'unknown-admin' : row.updated_by_admin_id,
      is_missing: row.is_missing ?? false,
      is_not_selected: row.is_not_selected ?? false,
      origin_address: row.origin_address || { address: row.origin_address_text || '' },
    })));
  }
  return rows;
}

async function writeJson(file, payload) {
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeJsonl(file, rows) {
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, fields) {
  return [fields.join(','), ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(','))].join('\n') + '\n';
}

function summarize(ledger, out) {
  const decisionCounts = ledger.reduce((acc, row) => { acc[row.decision] = (acc[row.decision] || 0) + 1; return acc; }, {});
  const riskCounts = ledger.flatMap((row) => row.risk_flags).reduce((acc, flag) => { acc[flag] = (acc[flag] || 0) + 1; return acc; }, {});
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: 'read_only_tzuyang_address_evidence_ledger',
    db_write_performed: false,
    output_dir: out,
    total_ledger_rows: ledger.length,
    target_rows: ledger.filter((row) => row.scope_status === 'target').length,
    excluded_rows: ledger.filter((row) => row.scope_status === 'excluded').length,
    decision_counts: Object.fromEntries(Object.entries(decisionCounts).sort(([a], [b]) => a.localeCompare(b))),
    risk_counts: Object.fromEntries(Object.entries(riskCounts).sort(([a], [b]) => a.localeCompare(b))),
    strict_apply_candidates: ledger.filter((row) => row.decision === 'apply_candidate').length,
    manual_review_rows: ledger.filter((row) => row.decision === 'manual_review').length,
    destructive_apply_allowed_by_this_script: false,
    next_safe_step_ko: 'ledger.jsonl과 manual-review-queue.jsonl을 검토하고, apply-candidates.jsonl은 별도 validate/apply dry-run 및 readback 검증 후에만 반영하세요.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.out, { recursive: true });
  const artifacts = await loadLocalArtifacts(args.evaluationRoot, args.crawlingRoot);
  const rows = args.guardedReportDir ? await loadRowsFromGuardedReport(args.guardedReportDir) : await loadRowsFromSupabase(args.limit);
  const ledger = buildLedgerRows(rows, artifacts);
  const summary = summarize(ledger, args.out);
  await writeJson(path.join(args.out, 'summary.json'), summary);
  await writeJsonl(path.join(args.out, 'ledger.jsonl'), ledger);
  await writeJsonl(path.join(args.out, 'apply-candidates.jsonl'), ledger.filter((row) => row.decision === 'apply_candidate'));
  await writeJsonl(path.join(args.out, 'manual-review-queue.jsonl'), ledger.filter((row) => row.decision === 'manual_review'));
  await writeJsonl(path.join(args.out, 'excluded.jsonl'), ledger.filter((row) => row.decision === 'excluded'));
  const queryRows = ledger.flatMap((row) => row.search_queries.map((query) => ({ id: row.id, decision: row.decision, video_id: row.video_id, query: query.query, purpose: query.purpose })));
  await fs.writeFile(path.join(args.out, 'search-queries.csv'), toCsv(queryRows, ['id', 'decision', 'video_id', 'query', 'purpose']), 'utf8');
  const md = `# 쯔양 주소 불일치 evidence ledger\n\n- 생성시각: ${summary.generated_at}\n- 모드: 읽기 전용\n- DB UPDATE 수행: 아니오\n- Ledger rows: ${summary.total_ledger_rows}\n- Strict apply candidates: ${summary.strict_apply_candidates}\n- Manual review: ${summary.manual_review_rows}\n- Excluded: ${summary.excluded_rows}\n\n## 엄격 적용 조건\n\n- 독립 evidence family 3개 이상\n- 영상 유래 근거 1개 이상\n- 외부/provider 근거 1개 이상\n- deleted/admin-touched/missing/not_selected/stage0/stale/duplicate/provider-block 위험 없음\n\n## 산출물\n\n- ledger.jsonl: 전체 증거 원장\n- apply-candidates.jsonl: dry-run 적용 후보(이 스크립트는 쓰기 금지)\n- manual-review-queue.jsonl: 전화번호/상호/지역/블로그/지도 리뷰 추가 확인 대상\n- search-queries.csv: 네이버 지도/구글/블로그 검색용 쿼리\n`;
  await fs.writeFile(path.join(args.out, 'README.md'), md, 'utf8');
  if (args.format === 'json') console.log(JSON.stringify(summary, null, 2));
  else console.log(`Wrote ${args.out} (${summary.total_ledger_rows} rows, apply=${summary.strict_apply_candidates}, review=${summary.manual_review_rows})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
