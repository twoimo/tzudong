#!/usr/bin/env node
/** Read-only live validation for same-origin address correction candidates. */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

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
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim().replace(/\s+/g, ' ');
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

function naverCoord(value) {
  const n = num(value);
  if (n === null) return null;
  return Math.abs(n) > 1000 ? n / 10000000 : n;
}

function haversineM(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return null;
  const R = 6371000;
  const p1 = Number(lat1) * Math.PI / 180;
  const p2 = Number(lat2) * Math.PI / 180;
  const dp = (Number(lat2) - Number(lat1)) * Math.PI / 180;
  const dl = (Number(lon2) - Number(lon1)) * Math.PI / 180;
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
  const items = (payload.items || []).map((item) => ({
    title: norm(item.title),
    category: norm(item.category),
    address: norm(item.address),
    roadAddress: norm(item.roadAddress),
    mapx: item.mapx,
    mapy: item.mapy,
    lng: naverCoord(item.mapx),
    lat: naverCoord(item.mapy),
  }));
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
  const addresses = (payload.addresses || []).slice(0, 3).map((item) => ({
    roadAddress: norm(item.roadAddress),
    jibunAddress: norm(item.jibunAddress),
    englishAddress: norm(item.englishAddress),
    x: item.x,
    y: item.y,
    lng: num(item.x),
    lat: num(item.y),
  }));
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
  const sourceDistanceM = distanceFromOriginToSuggested(candidate, origin, originGeocode);
  const suggestedGeocodeDistanceM = suggestedGeocode.addresses?.[0]
    ? haversineM(candidate.suggested_lat, candidate.suggested_lng, suggestedGeocode.addresses[0].lat, suggestedGeocode.addresses[0].lng)
    : null;
  const originToSuggestedAddressScore = addressOverlapScore(origin.text, candidate.suggested_road_address || candidate.suggested_jibun_address);
  const localStrong = localMatch && localMatch.titleHit && localMatch.suggestedDistanceM !== null && localMatch.suggestedDistanceM <= 30;
  const ncpExactOrigin = originGeocode.ok && suggestedGeocodeDistanceM !== null && suggestedGeocodeDistanceM <= 30 && sourceDistanceM !== null && sourceDistanceM <= 30 && originToSuggestedAddressScore >= 0.85;
  const exactOrNearAddress = originToSuggestedAddressScore >= 0.45 || (sourceDistanceM !== null && sourceDistanceM <= 80);
  if (ncpExactOrigin) {
    return { verdict: 'apply_ready', reason_ko: '원본 주소와 후보 주소가 NCP 지오코딩에서 같은 좌표로 확인되어 자동 보정 적용 후보입니다.' };
  }
  if (localStrong && exactOrNearAddress && suggestedGeocodeDistanceM !== null && suggestedGeocodeDistanceM <= 30) {
    return { verdict: 'apply_ready', reason_ko: '네이버 지역검색 상호/좌표와 NCP 지오코딩 좌표가 일치하고 원본 주소와도 충분히 가깝습니다.' };
  }
  if (localStrong && suggestedGeocodeDistanceM !== null && suggestedGeocodeDistanceM <= 30) {
    return { verdict: 'needs_manual_review', reason_ko: '지도 후보 자체는 강하지만 원본 주소와 후보 주소 간 차이가 있어 사람 확인이 필요합니다.' };
  }
  return { verdict: 'hold', reason_ko: '동명이점/주소 불일치/지도 후보 불확실성 때문에 자동 적용하지 않습니다.' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.join(args.reportDir, 'same-origin-known-coordinate-candidates.jsonl');
  const raw = await fs.readFile(inputPath, 'utf8');
  const candidates = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
  const results = [];
  for (const candidate of candidates) {
    const origin = parseOriginAddress(candidate.origin_address_text);
    const query = norm(`${candidate.origin_name} ${origin.text || candidate.suggested_road_address || ''}`);
    const local = await naverLocal(query);
    const suggestedGeocode = await geocode(candidate.suggested_road_address || candidate.suggested_jibun_address || origin.text);
    const originGeocode = origin.text ? await geocode(origin.text) : { ok: false, status: 'empty_query', addresses: [] };
    const localMatch = bestLocalMatch(candidate, local);
    const resultDecision = decision(candidate, origin, localMatch, suggestedGeocode, originGeocode);
    results.push({
      id: candidate.id,
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
      verdict: resultDecision.verdict,
      reason_ko: resultDecision.reason_ko,
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const summary = results.reduce((acc, row) => {
    acc[row.verdict] = (acc[row.verdict] || 0) + 1;
    return acc;
  }, {});
  const payload = { generated_at: new Date().toISOString(), mode: 'read_only_live_api_validation', db_write_performed: false, summary, results };
  await fs.writeFile(path.join(args.reportDir, 'same-origin-live-validation.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const csvFields = ['id','origin_name','verdict','reason_ko','origin_address_text','suggested_road_address','source_to_suggested_distance_m','origin_to_suggested_address_score','naver_query','naver_local_status','suggested_geocode_status'];
  const csv = [csvFields.join(','), ...results.map((r) => csvFields.map((f) => `"${String(r[f] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(args.reportDir, 'same-origin-live-validation.csv'), csv, 'utf8');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
