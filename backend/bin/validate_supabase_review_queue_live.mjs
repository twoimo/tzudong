#!/usr/bin/env node
/** Read-only live validation for the full address consistency review queue. */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logSafeError } from '../utils/privacy-log.mjs';

const LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';
const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const FOOD_CATEGORY_HINTS = ['음식점', '한식', '중식', '일식', '분식', '카페', '술집', '고기', '육류', '치킨', '피자', '양식', '아시아', '패스트푸드'];

function parseArgs(argv) {
  const args = { reportDir: '', limit: 0, offset: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-dir') args.reportDir = argv[++i] || '';
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg === '--offset') args.offset = Number(argv[++i] || 0);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node bin/validate_supabase_review_queue_live.mjs --report-dir DIR [--offset N] [--limit N]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.reportDir) throw new Error('--report-dir is required');
  return args;
}
function requireEnv(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
function norm(value) { return String(value || '').split(/<\/?script\b/i)[0].split(/<\/?style\b/i)[0].replace(/<[^>]+>/g, ' ').replace(/[<>]/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '').replace(/&gt;/g, '').replace(/&amp;/g, '&').trim().replace(/\s+/g, ' '); }
function cleanName(value) { return norm(value).replace(/^\[비공개\]\s*/, '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim(); }
function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function naverCoord(value) { const n = num(value); if (n === null) return null; return Math.abs(n) > 1000 ? n / 10000000 : n; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function tokens(value) { return norm(value).replace(/[()\[\],]/g, ' ').split(/\s+/).filter(Boolean); }
function addressOverlapScore(a, b) { const left = new Set(tokens(a)); const right = new Set(tokens(b)); if (!left.size || !right.size) return 0; let hits = 0; for (const t of left) if (right.has(t)) hits += 1; return hits / Math.max(left.size, right.size); }
function haversineM(lat1, lon1, lat2, lon2) { if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return null; const R=6371000; const p1=Number(lat1)*Math.PI/180; const p2=Number(lat2)*Math.PI/180; const dp=(Number(lat2)-Number(lat1))*Math.PI/180; const dl=(Number(lon2)-Number(lon1))*Math.PI/180; const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*10)/10; }
function hasPreciseAddress(text) { const t = norm(text); return /\d/.test(t) && t.split(/\s+/).length >= 4; }
function hasFoodCategory(category) { const c = norm(category); return FOOD_CATEGORY_HINTS.some((hint) => c.includes(hint)); }
function titleMatches(name, title) { const n = cleanName(name); const t = cleanName(title); if (!n || !t) return false; return t.includes(n) || n.includes(t) || n.replace(/\s/g,'').includes(t.replace(/\s/g,'')) || t.replace(/\s/g,'').includes(n.replace(/\s/g,'')); }
async function naverLocal(query) {
  try {
    const response = await fetch(`${LOCAL_URL}?${new URLSearchParams({ query, display: '5', sort: 'comment' })}`, { headers: { 'X-Naver-Client-Id': requireEnv('NAVER_CLIENT_ID_BYEON'), 'X-Naver-Client-Secret': requireEnv('NAVER_CLIENT_SECRET_BYEON') } });
    if (!response.ok) return { ok: false, status: `http_${response.status}`, items: [] };
    const payload = await response.json();
    const items = (payload.items || []).map((item) => ({ title: norm(item.title), category: norm(item.category), address: norm(item.address), roadAddress: norm(item.roadAddress), mapx: item.mapx, mapy: item.mapy, lng: naverCoord(item.mapx), lat: naverCoord(item.mapy) }));
    return { ok: items.length > 0, status: items.length ? 'ok' : 'no_result', items };
  } catch (error) {
    logSafeError(error, (line) => process.stderr.write(`review_queue_naver_local_failed ${line}`));
    return { ok: false, status: 'api_error', error_type: 'backend_error', items: [] };
  }
}
async function geocode(query) {
  if (!norm(query)) return { ok: false, status: 'empty_query', addresses: [] };
  try {
    const response = await fetch(`${GEOCODE_URL}?${new URLSearchParams({ query })}`, { headers: { 'X-NCP-APIGW-API-KEY-ID': requireEnv('NCP_MAPS_KEY_ID_BYEON'), 'X-NCP-APIGW-API-KEY': requireEnv('NCP_MAPS_KEY_BYEON') } });
    if (!response.ok) return { ok: false, status: `http_${response.status}`, addresses: [] };
    const payload = await response.json();
    const addresses = (payload.addresses || []).slice(0, 3).map((item) => ({ roadAddress: norm(item.roadAddress), jibunAddress: norm(item.jibunAddress), englishAddress: norm(item.englishAddress), x: item.x, y: item.y, lng: num(item.x), lat: num(item.y) }));
    return { ok: addresses.length > 0, status: addresses.length ? 'ok' : 'no_result', addresses };
  } catch (error) {
    logSafeError(error, (line) => process.stderr.write(`review_queue_geocode_failed ${line}`));
    return { ok: false, status: 'api_error', error_type: 'backend_error', addresses: [] };
  }
}
function bestLocalMatch(row, local, geoTop) {
  let best = null;
  for (const item of local.items || []) {
    const titleHit = titleMatches(row.origin_name, item.title);
    const foodHit = hasFoodCategory(item.category);
    const addrText = item.roadAddress || item.address;
    const roadScore = addressOverlapScore(row.origin_address_text, addrText);
    const distanceM = geoTop ? haversineM(geoTop.lat, geoTop.lng, item.lat, item.lng) : null;
    const score = (titleHit ? 2 : 0) + (foodHit ? 0.5 : 0) + roadScore + (distanceM !== null && distanceM <= 50 ? 2 : distanceM !== null && distanceM <= 150 ? 1 : 0);
    const enriched = { ...item, titleHit, foodHit, roadScore: Math.round(roadScore * 100) / 100, distanceM, score: Math.round(score * 100) / 100 };
    if (!best || enriched.score > best.score) best = enriched;
  }
  return best;
}
function verdictFor(row, geocoded, best) {
  const geoTop = geocoded.addresses?.[0] || null;
  if (!geoTop) return { verdict: 'hold', reason_ko: '원본 주소 지오코딩이 회복되지 않아 자동 적용하지 않습니다.' };
  if (!hasPreciseAddress(row.origin_address_text)) return { verdict: 'manual_review', reason_ko: '원본 주소가 시/군/구 수준으로 모호하여 자동 확정하지 않습니다.' };
  if (!best) return { verdict: 'geocode_recovered_review', reason_ko: '주소 지오코딩은 회복되었지만 지도 상호 후보가 없어 수동 확인이 필요합니다.' };
  if (best.titleHit && best.foodHit && best.distanceM !== null && best.distanceM <= 50 && best.roadScore >= 0.35) {
    return { verdict: 'apply_ready_strict', reason_ko: '상호명·음식점 카테고리·주소 지오코딩 좌표·지도 후보 좌표가 엄격 기준 안에서 일치합니다.' };
  }
  if (best.titleHit && best.foodHit && best.distanceM !== null && best.distanceM <= 150) {
    return { verdict: 'manual_review', reason_ko: '상호/카테고리는 맞지만 주소 또는 거리 기준이 엄격 적용 기준보다 약합니다.' };
  }
  return { verdict: 'hold', reason_ko: '지도 후보가 원본 주소·상호와 충분히 일치하지 않습니다.' };
}
function csvEscape(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = (await fs.readFile(path.join(args.reportDir, 'review-queue.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const slice = rows.slice(args.offset, args.limit ? args.offset + args.limit : undefined);
  const results = [];
  for (let i = 0; i < slice.length; i += 1) {
    const row = slice[i];
    const query = norm(`${cleanName(row.origin_name)} ${row.origin_address_text}`);
    const geocoded = await geocode(row.origin_address_text);
    await sleep(80);
    const local = await naverLocal(query);
    const best = bestLocalMatch(row, local, geocoded.addresses?.[0] || null);
    const verdict = verdictFor(row, geocoded, best);
    results.push({
      id: row.id, queue: row.queue, action: row.action, status: row.status, target_kind: row.target_kind, geocoding_false_stage: row.geocoding_false_stage,
      origin_name: row.origin_name, origin_address_text: row.origin_address_text, youtube_link: row.youtube_link, original_reason_ko: row.reason_ko,
      naver_query: query, geocode_status: geocoded.status, geocode_top: geocoded.addresses?.[0] || null,
      naver_local_status: local.status, best_naver_local_match: best,
      verdict: verdict.verdict, reason_ko: verdict.reason_ko,
    });
    if ((i + 1) % 50 === 0) console.error(`validated ${i + 1}/${slice.length}`);
    await sleep(80);
  }
  const summary = results.reduce((acc, row) => { acc[row.verdict] = (acc[row.verdict] || 0) + 1; return acc; }, {});
  const payload = { generated_at: new Date().toISOString(), mode: 'read_only_live_api_full_queue_validation', db_write_performed: false, offset: args.offset, limit: args.limit || null, input_count: slice.length, summary, results };
  const suffix = args.limit ? `-${args.offset}-${args.offset + args.limit}` : '';
  await fs.writeFile(path.join(args.reportDir, `review-queue-live-validation${suffix}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(args.reportDir, `review-queue-live-apply-ready${suffix}.jsonl`), results.filter((r) => r.verdict === 'apply_ready_strict').map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const fields = ['id','origin_name','verdict','reason_ko','origin_address_text','geocoding_false_stage','geocode_status','naver_local_status','youtube_link'];
  const csv = [fields.join(','), ...results.map((r) => fields.map((f) => csvEscape(r[f])).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(args.reportDir, `review-queue-live-validation${suffix}.csv`), csv, 'utf8');
  console.log(JSON.stringify({ ...payload, results: undefined }, null, 2));
}
main().catch((error) => {
  logSafeError(error, (line) => process.stderr.write(`review_queue_validation_failed ${line}`));
  process.exitCode = 1;
});
