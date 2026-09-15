import { mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = import.meta.dir;
const sha = value => createHash('sha256').update(value).digest('hex');
const frozen = JSON.parse(readFileSync(path.join(root, 'freeze.json'), 'utf8'));
for (const [name, hash] of Object.entries(frozen.inputs)) {
  if (sha(readFileSync(path.join(root, name))) !== hash) throw new Error('FROZEN_INPUT_DRIFT');
}
Bun.plugin({ name: 'frozen-kpi-source', setup(build) {
  build.onResolve({ filter: /^@\/lib\/public-insights\/treemap$/ }, () => ({ path: path.join(root, 'treemap.source') }));
  build.onLoad({ filter: /\.source$/ }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'ts' }));
} });
const latest = '2026-09-08T12:00:00.000Z';
const comparison = '2026-09-08T11:00:00.000Z';
const requestDelayMs = 10;
let database = {};
let state;
function response(table, filters, ordering, limit) {
  const data = database[table].filter(row => filters.every(fn => fn(row)));
  if (ordering) data.sort((a, b) => (a[ordering.key] < b[ordering.key] ? -1 : a[ordering.key] === b[ordering.key] ? 0 : 1) * (ordering.ascending ? 1 : -1));
  return data.slice(0, limit);
}
class Query {
  filters = []; ordering = null; limitCount = Infinity; kind = 'latest';
  constructor(table) { this.table = table; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  neq(key, value) { this.filters.push(row => row[key] != null && row[key] !== value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); if (key === 'video_id') this.kind = 'previous-map'; return this; }
  ilike(key, value) { this.filters.push(row => row[key]?.toLowerCase() === value.toLowerCase()); return this; }
  lte(key, value) { this.filters.push(row => row[key] <= value); this.kind = 'comparison'; return this; }
  gt(key, value) { this.filters.push(row => row[key] > value); return this; }
  gte(key, value) { this.filters.push(row => row[key] >= value); return this; }
  order(key, options) { this.ordering = { key, ...options }; return this; }
  limit(count) { this.limitCount = count; return this; }
  async execute(kind = this.kind) {
    const event = { table: this.table === 'youtube_video_kpi_snapshots' ? 'video' : 'channel', kind, startMs: performance.now() - state.started };
    state.events.push(event); state.active++; state.peak = Math.max(state.peak, state.active);
    await new Promise(resolve => setTimeout(resolve, requestDelayMs));
    const data = response(this.table, this.filters, this.ordering, this.limitCount);
    state.active--; event.endMs = performance.now() - state.started;
    return { data, error: null };
  }
  async maybeSingle() { const r = await this.execute(); return { ...r, data: r.data[0] ?? null }; }
  async range(from, to) { const r = await this.execute('current-page'); return { ...r, data: r.data.slice(from, to + 1) }; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}
mock.module('@/lib/supabase/service-role', () => ({ createSupabaseServiceRoleClient: () => {
  state.clientFactoryCalls++; return { from: table => new Query(table) };
} }));
mock.module('@supabase/supabase-js', () => ({ createClient: () => { throw new Error('REAL_CLIENT_FORBIDDEN'); } }));
for (const key of ['YOUTUBE_CHANNEL_ID', 'NEXT_PUBLIC_YOUTUBE_CHANNEL_ID', 'YOUTUBE_CHANNEL_HANDLE', 'NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE']) delete process.env[key];
Date.now = () => Date.parse(latest);
const modules = {
  baseline: await import('./baseline.source'), candidate: await import('./candidate.source'),
};
function seed(size) {
  const videos = Array.from({ length: size }, (_, i) => ({ video_id: `synthetic-${i}`, title: 'Synthetic',
    published_at: '2020-01-01T00:00:00.000Z', category_id: 'test', duration_seconds: 60,
    view_count: 1000 + i, like_count: 100, comment_count: 10, bucket_started_at: latest, fetched_at: latest }));
  const channel = { channel_id: 'synthetic-channel', channel_title: 'Synthetic', channel_handle: '@tzuyang6145',
    subscriber_count: 120, view_count: 1000, video_count: size, hidden_subscriber_count: false,
    bucket_started_at: latest, fetched_at: latest, source: 'youtube-data-api-v3' };
  database = { youtube_video_kpi_snapshots: [...videos, ...videos.map(row => ({ ...row, bucket_started_at: comparison, fetched_at: comparison, view_count: row.view_count - 10 }))],
    youtube_channel_kpi_snapshots: [channel, { ...channel, bucket_started_at: comparison, fetched_at: comparison, subscriber_count: 100 }] };
}
async function run(variant, scenario) {
  seed(scenario.rows);
  state = { started: performance.now(), events: [], peak: 0, active: 0, clientFactoryCalls: 0 };
  // Match the current caller: channel and video reads are already concurrent.
  const payload = await Promise.all([
    modules[variant].getYouTubeKpiSnapshotData('1H', { filterByPublishedPeriod: scenario.filter }),
    modules[variant].getLatestYouTubeChannelSnapshot('1H'),
  ]);
  return { variant, elapsedMs: performance.now() - state.started, queryCount: state.events.length,
    clientFactoryCalls: state.clientFactoryCalls, peakConcurrentReads: state.peak,
    payloadSha256: sha(JSON.stringify(payload)), events: state.events };
}
const scenarios = [{ id: 'empty-publication-cohort', rows: 100, filter: true },
  { id: 'single-page-100', rows: 100, filter: false }, { id: 'two-pages-1200', rows: 1200, filter: false }];
const raw = { schemaVersion: 'youtube-kpi-scheduling-controlled.v1', evidenceClass: 'synthetic-query-delay-experiment',
  productionEvidence: false, g003AdmittedSlices: 0, runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  requestDelayMs, pairsPerScenario: 30, warmupPairs: 2,
  budgets: { absoluteImprovementFloorMs: 5, relativeImprovementFloorPercent: 5, pairedDifferenceMadNoiseBudgetMs: 2,
    productBudgetReference: '../performance-budgets.v1.json', productBudgetEvaluated: false },
  scenarios: [] };
for (const scenario of scenarios) {
  for (let i = 0; i < 2; i++) { await run('baseline', scenario); await run('candidate', scenario); }
  const pairs = [];
  for (let i = 0; i < 30; i++) {
    const order = i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    const pair = {};
    for (const variant of order) pair[variant] = await run(variant, scenario);
    if (pair.baseline.payloadSha256 !== pair.candidate.payloadSha256) throw new Error('OUTPUT_PARITY_FAILED');
    if (pair.baseline.queryCount !== pair.candidate.queryCount) throw new Error('QUERY_COUNT_CHANGED');
    pairs.push({ index: i, order, ...pair });
  }
  raw.scenarios.push({ ...scenario, pairs });
}
writeFileSync(path.join(root, 'raw.json'), JSON.stringify(raw, null, 2) + '\n');
console.log(JSON.stringify({ scenarios: raw.scenarios.length, pairs: 90, outputParity: true, productionEvidence: false }));
