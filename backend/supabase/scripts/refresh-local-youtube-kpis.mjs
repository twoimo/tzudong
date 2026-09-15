#!/usr/bin/env node
// Batch collection stays outside web request handlers and writes only to the
// checkout-bound local stack. Existing restaurant/business records are untouched.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalSupabaseEnvironment, assertLocalSupabaseReady } from '../../../apps/web/scripts/local-supabase-runtime.mjs';
const requireWeb = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { parse } = requireWeb('dotenv');
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function videoIdFromLink(link) {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com'].includes(url.hostname)
        ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1] : null;
    return VIDEO_ID.test(id ?? '') ? id : null;
  } catch { return null; }
}

export function normalizeVideoSnapshot(item, bucket) {
  const stats = item.statistics ?? {};
  const counts = ['viewCount', 'likeCount', 'commentCount'].map(key => {
    const value = stats[key];
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  });
  // Disabled/hidden metrics are unknown; never turn them into fabricated zeroes.
  if (!VIDEO_ID.test(item.id ?? '') || counts.includes(null)) return null;
  const snippet = item.snippet ?? {};
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(snippet.channelId ?? '') || !Number.isFinite(Date.parse(snippet.publishedAt))) return null;
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(item.contentDetails?.duration ?? '');
  if (!duration) return null;
  return {
    video_id: item.id, channel_id: snippet.channelId,
    title: typeof snippet.title === 'string' ? snippet.title.slice(0, 1000) : '',
    published_at: new Date(snippet.publishedAt).toISOString(),
    category_id: typeof snippet.categoryId === 'string' ? snippet.categoryId : null,
    duration_seconds: Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0),
    view_count: counts[0], like_count: counts[1], comment_count: counts[2],
    bucket_started_at: bucket, fetched_at: bucket, source: 'youtube-data-api-v3',
  };
}

export const CHANNEL_HANDLE = '@tzuyang6145';
export const CHANNEL_SOURCE = 'youtube-data-api-v3';
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const channelCount = (value, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= max ? number : null;
};

export function normalizeChannelSnapshot(item, bucket) {
  const snippet = item?.snippet ?? {};
  const stats = item?.statistics ?? {};
  if (!CHANNEL_ID.test(item?.id ?? '') || (typeof snippet.customUrl !== 'string' || snippet.customUrl.toLowerCase() !== CHANNEL_HANDLE)
      || !Number.isFinite(Date.parse(bucket)) || typeof stats.hiddenSubscriberCount !== 'boolean') return null;
  const subscribers = stats.hiddenSubscriberCount ? null : channelCount(stats.subscriberCount);
  const views = channelCount(stats.viewCount);
  const videos = channelCount(stats.videoCount, 2147483647);
  if ((!stats.hiddenSubscriberCount && subscribers === null) || views === null || videos === null) return null;
  return {
    channel_id: item.id, channel_title: typeof snippet.title === 'string' ? snippet.title.slice(0, 1000) : null,
    channel_handle: CHANNEL_HANDLE, subscriber_count: subscribers, view_count: views, video_count: videos,
    hidden_subscriber_count: stats.hiddenSubscriberCount,
    // No trustworthy historical observation is established by this collection.
    previous_bucket_started_at: null, subscriber_delta: null, view_delta: null, video_delta: null,
    bucket_started_at: bucket, fetched_at: bucket, source: CHANNEL_SOURCE,
  };
}

export async function fetchChannelSnapshot(key, bucket, fetcher = fetch) {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.search = new URLSearchParams({ part: 'snippet,statistics', forHandle: CHANNEL_HANDLE, key,
    fields: 'items(id,snippet(title,customUrl),statistics(subscriberCount,viewCount,videoCount,hiddenSubscriberCount))' }).toString();
  let payload;
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error();
    payload = await response.json();
  } catch { throw Error('YOUTUBE_CHANNEL_FETCH_FAILED'); }
  if (!Array.isArray(payload?.items) || payload.items.length !== 1) throw Error('YOUTUBE_CHANNEL_IDENTITY_INVALID');
  const snapshot = normalizeChannelSnapshot(payload.items[0], bucket);
  if (!snapshot) throw Error('YOUTUBE_CHANNEL_SNAPSHOT_INVALID');
  return snapshot;
}

export function sameChannelSnapshot(expected, actual) {
  return Object.keys(expected).every(key => ['bucket_started_at', 'fetched_at'].includes(key)
    ? Date.parse(expected[key]) === Date.parse(actual[key]) : expected[key] === actual[key]);
}

// Each table is atomic independently; never imply a cross-table transaction.
export async function insertAndVerifySnapshots(request, table, snapshots, bucket, identity, same) {
  try {
    await request(table, {}, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(snapshots) });
  } catch { /* Delivery may be uncertain. Read independently; do not retry. */ }
  const response = await request(table, { select: Object.keys(snapshots[0]).join(','), bucket_started_at: `eq.${bucket}`, order: `${identity}.asc`, limit: String(snapshots.length + 1) });
  if (!response.ok) throw Error('LOCAL_SNAPSHOT_READBACK_FAILED');
  const actual = await response.json();
  if (!Array.isArray(actual)) throw Error('LOCAL_SNAPSHOT_READBACK_MISMATCH');
  const byId = new Map(actual.map(row => [row[identity], row]));
  if (actual.length !== snapshots.length || snapshots.some(row => !byId.has(row[identity]) || !same(row, byId.get(row[identity])))) throw Error('LOCAL_SNAPSHOT_READBACK_MISMATCH');
}

export function sameSnapshot(expected, actual) {
  const fields = ['video_id', 'channel_id', 'title', 'category_id', 'duration_seconds', 'view_count', 'like_count', 'comment_count', 'source'];
  return fields.every(key => expected[key] === actual[key])
    && ['published_at', 'bucket_started_at', 'fetched_at'].every(key => Date.parse(expected[key]) === Date.parse(actual[key]));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Refresh verified @tzuyang6145 channel and approved restaurant video statistics. Usage: --youtube-env-file <absolute path> [--youtube-key-name YOUTUBE_API_KEY]');
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--youtube-env-file', '--youtube-key-name'].includes(args[i]) || !args[i + 1]) throw Error('ARGUMENTS_INVALID');
    options[args[i]] = args[i + 1];
  }
  const keyName = options['--youtube-key-name'] ?? 'YOUTUBE_API_KEY';
  if (!/^[A-Z][A-Z0-9_]{0,80}$/.test(keyName)) throw Error('KEY_NAME_INVALID');
  const envFile = options['--youtube-env-file'];
  if (envFile && !path.isAbsolute(envFile)) throw Error('ENV_PATH_INVALID');
  const input = envFile ? parse(readFileSync(envFile, 'utf8')) : {};
  const key = process.env[keyName] || input[keyName];
  if (!key) throw Error('YOUTUBE_KEY_MISSING');
  const local = loadLocalSupabaseEnvironment();
  assertLocalSupabaseReady(local);
  const headers = { apikey: local.values.SERVICE_ROLE_KEY, Authorization: `Bearer ${local.values.SERVICE_ROLE_KEY}` };
  const request = async (table, query, init = {}) => {
    const url = new URL(`/rest/v1/${table}`, local.supabaseOrigin);
    url.search = new URLSearchParams(query).toString();
    return fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  };
  const ids = new Set();
  for (let offset = 0; ; offset += 1000) {
    const response = await request('restaurants', { select: 'youtube_link', status: 'eq.approved', order: 'id.asc', offset: String(offset), limit: '1000' });
    if (!response.ok) throw Error('LOCAL_CATALOG_READ_FAILED');
    const rows = await response.json();
    for (const row of rows) { const id = videoIdFromLink(row.youtube_link); if (id) ids.add(id); }
    if (rows.length < 1000) break;
    if (offset >= 9000) throw Error('LOCAL_CATALOG_TOO_LARGE');
  }
  const requested = [...ids].sort();
  if (!requested.length) throw Error('NO_APPROVED_VIDEOS');
  const bucket = new Date().toISOString();
  const channelSnapshot = await fetchChannelSnapshot(key, bucket);
  const snapshots = [];
  let otherChannelExcluded = 0;
  for (let offset = 0; offset < requested.length; offset += 50) {
    const batch = requested.slice(offset, offset + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: batch.join(','), key,
      fields: 'items(id,snippet(channelId,title,publishedAt,categoryId),contentDetails(duration),statistics(viewCount,likeCount,commentCount))' }).toString();
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error('YOUTUBE_FETCH_FAILED');
    const payload = await response.json();
    for (const item of payload.items ?? []) {
      if (!batch.includes(item.id)) throw Error('YOUTUBE_ID_MISMATCH');
      const snapshot = normalizeVideoSnapshot(item, bucket);
      if (snapshot && snapshot.channel_id !== channelSnapshot.channel_id) otherChannelExcluded++;
      else if (snapshot) snapshots.push(snapshot);
    }
  }
  if (!snapshots.length || new Set(snapshots.map(row => row.video_id)).size !== snapshots.length) throw Error('SNAPSHOT_INVALID');
  const receiptDir = path.join(local.stateRoot, 'local-operations');
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(receiptDir, `youtube-kpis-${randomUUID()}.json`);
  const receipt = { operation: 'local-youtube-kpi-refresh', target: local.projectName, bucket, requested: requested.length,
    admitted: snapshots.length, unavailableOrIncomplete: requested.length - snapshots.length - otherChannelExcluded, otherChannelExcluded, snapshotSha256: sha(snapshots), channelSnapshotSha256: sha(channelSnapshot),
    channelId: channelSnapshot.channel_id, channelHandle: CHANNEL_HANDLE, channelSource: CHANNEL_SOURCE,
    channelStatus: 'prepared', videoStatus: 'prepared', status: 'prepared' };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const saveReceipt = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  try {
    await insertAndVerifySnapshots(request, 'youtube_channel_kpi_snapshots', [channelSnapshot], bucket, 'channel_id', sameChannelSnapshot);
    receipt.channelStatus = 'verified';
    saveReceipt();
    await insertAndVerifySnapshots(request, 'youtube_video_kpi_snapshots', snapshots, bucket, 'video_id', sameSnapshot);
    receipt.videoStatus = 'verified';
    receipt.status = 'verified';
    saveReceipt();
  } catch {
    receipt.status = 'readback_unverified';
    saveReceipt();
    throw Error('LOCAL_REFRESH_READBACK_UNVERIFIED');
  }
  console.log(JSON.stringify({ ...receipt, status: 'verified', receiptPath }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`local-youtube-kpis: ${/^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'OPERATION_FAILED'}`); process.exitCode = 1; });
}
