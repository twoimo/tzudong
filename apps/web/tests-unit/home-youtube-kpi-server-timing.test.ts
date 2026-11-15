import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  createHomeKpiServerTiming,
  resolveHomeKpiQueryMode,
  type HomeKpiQueryMode,
  type HomeYouTubeKpiObservation,
} from '../lib/performance/home-kpi-server-timing';
import { readBoundedJsonRequest } from '../lib/security/bounded-json-request';
import type { LatestYouTubeKpiMetric } from '../lib/admin/youtube-kpi-snapshots';

const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const PRIVATE_SENTINEL = 'SYNTHETIC_PROVIDER_DETAIL_NOT_FOR_HEADER';
const METRICS: LatestYouTubeKpiMetric[] = [{
  videoId: 'video_A', title: 'Synthetic title', publishedAt: '2026-01-01T00:00:00.000Z',
  duration: 90, viewCount: 100, likeCount: 10, commentCount: 2,
  bucketStartedAt: '2026-01-01T00:15:00.000Z', fetchedAt: '2026-01-01T00:16:00.000Z',
}];

type QueryOptions = { mode: HomeKpiQueryMode; observe: (event: HomeYouTubeKpiObservation) => void };

// Execute the actual POST and bounded JSON reader. Only query I/O,
// NextResponse.json and the monotonic clock are replaced at their boundaries.
// Synthetic elapsed values prove header behavior, not a speed improvement.
function fixture(options: {
  mode?: unknown;
  events?: HomeYouTubeKpiObservation[];
  metrics?: LatestYouTubeKpiMetric[];
  rejectQuery?: boolean;
  clock?: () => number;
} = {}) {
  let clock = 0;
  const calls: { ids: string[]; mode: HomeKpiQueryMode }[] = [];
  const errors: unknown[][] = [];
  let bodyReads = 0;
  const dependencies = {
    'next/server': { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    '@/lib/admin/youtube-kpi-snapshots': {
      async getLatestYouTubeKpiMetricsForVideoIds(ids: string[], queryOptions: QueryOptions) {
        calls.push({ ids: [...ids], mode: queryOptions.mode });
        for (const event of options.events ?? []) queryOptions.observe(event);
        clock += 7;
        if (options.rejectQuery) throw new Error(PRIVATE_SENTINEL);
        return options.metrics ?? METRICS;
      },
    },
    '@/lib/performance/home-kpi-server-timing': {
      resolveHomeKpiQueryMode,
      createHomeKpiServerTiming: () => createHomeKpiServerTiming(options.clock ?? (() => clock)),
    },
    '@/lib/security/bounded-json-request': {
      async readBoundedJsonRequest(request: Request, limit: number) {
        bodyReads++;
        clock += 1;
        const result = await readBoundedJsonRequest(request, limit);
        clock += 2;
        return result;
      },
    },
  };
  const source = readFileSync(new URL('../app/api/home/youtube-kpi/route.ts', import.meta.url), 'utf8');
  const transformed = new Bun.Transpiler({ loader: 'ts', target: 'node' }).transformSync(source)
    .replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
      (_all, names: string, specifier: string) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(specifier)});`)
    .replace(/export (?=(?:const|async function|function) )/g, '');
  if (/^\s*(?:import|export)\b/m.test(transformed)) throw new Error('UNSUPPORTED_FIXTURE_MODULE_SYNTAX');
  const output: { post?: (request: Request) => Promise<Response> } = {};
  runInNewContext(`${transformed}\noutput.post = POST;`, {
    output,
    require(specifier: string) {
      if (!Object.hasOwn(dependencies, specifier)) throw new Error('UNDECLARED_FIXTURE_IMPORT');
      return dependencies[specifier as keyof typeof dependencies];
    },
    process: { env: { TZUDONG_HOME_KPI_QUERY_MODE: options.mode } },
    console: { error: (...args: unknown[]) => errors.push(args) },
  }, { timeout: 1000 });

  return {
    calls, errors,
    get bodyReads() { return bodyReads; },
    async post(body = JSON.stringify({ videoIds: ['video_A'] }),
      headers: Record<string, string> = {}, query = '') {
      return output.post!(new Request(`https://home-kpi.fixture.invalid/api/home/youtube-kpi${query}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
      }));
    },
  };
}

describe('home KPI diagnostic timing', () => {
  test('accepts only the exact deployment mode and defaults absence to RPC', () => {
    expect(resolveHomeKpiQueryMode(undefined)).toBe('rpc');
    expect(resolveHomeKpiQueryMode('rpc')).toBe('rpc');
    expect(resolveHomeKpiQueryMode('legacy')).toBe('legacy');
    for (const invalid of ['', 'RPC', ' rpc', 'legacy ', null, true, 1, {}, []]) {
      expect(resolveHomeKpiQueryMode(invalid)).toBeNull();
    }
  });

  test('serializes bounded allowlisted durations and keeps real zero distinct from absence', () => {
    let now = 10;
    const timing = createHomeKpiServerTiming(() => now);
    const finishBody = timing.beginBody();
    now = 12.125;
    finishBody();
    timing.observe({ name: 'rpcRequest', durationMs: 3.45678 });
    timing.observe({ name: 'dbBucket', durationMs: 0 });
    timing.observe({ name: 'dbTotal', durationMs: 0.2 });
    now = 20;
    expect(timing.header('rpc')).toBe('kpi-mode;desc="rpc", kpi-body;dur=2.125, kpi-handler;dur=10, '
      + 'kpi-rpc-request;dur=3.457, kpi-db-bucket;dur=0, kpi-db-total;dur=0.2');
    expect(timing.header('rpc')).not.toContain('kpi-db-rows');
  });

  test('invalid database telemetry atomically removes every database duration and stays invalid', () => {
    for (const invalid of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const timing = createHomeKpiServerTiming(() => 0);
      timing.observe({ name: 'rpcRequest', durationMs: 8 });
      timing.observe({ name: 'dbBucket', durationMs: 1 });
      timing.observe({ name: 'dbRows', durationMs: invalid });
      timing.observe({ name: 'dbTotal', durationMs: 2 });
      const header = timing.header('rpc');
      expect(header).toContain('kpi-rpc-request;dur=8');
      expect(header).toContain('kpi-db-invalid');
      expect(header).not.toMatch(/kpi-db-(?:bucket|rows|total);dur=/);
      expect(header).not.toContain('kpi-db-invalid;dur=0');
    }
  });

  test('the explicit database invalid marker cannot be repaired by later observations', () => {
    const timing = createHomeKpiServerTiming(() => 0);
    timing.observe({ name: 'dbTimingInvalid' });
    timing.observe({ name: 'dbBucket', durationMs: 0 });
    timing.observe({ name: 'dbRows', durationMs: 0 });
    timing.observe({ name: 'dbTotal', durationMs: 0 });
    expect(timing.header('rpc')).toBe('kpi-mode;desc="rpc", kpi-handler;dur=0, kpi-db-invalid');
  });

  test('observation accessors and unknown names cannot throw or escape into the header', () => {
    const timing = createHomeKpiServerTiming(() => 0);
    const unknown = { name: `x;desc="${PRIVATE_SENTINEL}"`, durationMs: 1 } as unknown as HomeYouTubeKpiObservation;
    const throwingName = Object.defineProperty({}, 'name', { get() { throw new Error(PRIVATE_SENTINEL); } });
    const throwingDuration = Object.defineProperty({ name: 'dbBucket' }, 'durationMs', {
      get() { throw new Error(PRIVATE_SENTINEL); },
    });
    for (const event of [unknown, throwingName, throwingDuration]) {
      expect(() => timing.observe(event as HomeYouTubeKpiObservation)).not.toThrow();
    }
    const header = timing.header('rpc');
    expect(header).toContain('kpi-db-invalid');
    expect(header).not.toContain(PRIVATE_SENTINEL);
    expect(header).not.toContain('x;');
  });

  test('invalid request durations are omitted without mislabeling them as database work', () => {
    const timing = createHomeKpiServerTiming(() => 0);
    timing.observe({ name: 'bucketRequest', durationMs: 10 });
    timing.observe({ name: 'rowsRequest', durationMs: 20 });
    timing.observe({ name: 'rpcRequest', durationMs: Infinity });
    expect(timing.header('legacy')).toBe('kpi-mode;desc="legacy", kpi-handler;dur=0, '
      + 'kpi-bucket-request;dur=10, kpi-rows-request;dur=20');
    expect(timing.header('legacy')).not.toContain('kpi-db-');
  });

  test('a throwing or nonmonotonic clock does not fabricate handler/body durations', () => {
    for (const clock of [() => { throw new Error(PRIVATE_SENTINEL); }, () => NaN, () => -1]) {
      const timing = createHomeKpiServerTiming(clock);
      timing.beginBody()();
      expect(timing.header('rpc')).toBe('kpi-mode;desc="rpc"');
    }
    const samples = [10, 9, 8, 7];
    const timing = createHomeKpiServerTiming(() => samples.shift()!);
    timing.beginBody()();
    expect(timing.header('rpc')).toBe('kpi-mode;desc="rpc"');
  });

  test('finishing a body measurement twice does not extend its interval', () => {
    let now = 0;
    const timing = createHomeKpiServerTiming(() => now);
    const finish = timing.beginBody();
    now = 3; finish();
    now = 99; finish();
    expect(timing.header('rpc')).toContain('kpi-body;dur=3, kpi-handler;dur=99');
  });
});

describe('home KPI POST timing and mode boundary', () => {
  test('default RPC preserves response JSON/cache and exposes only same-response diagnostics', async () => {
    const harness = fixture({ events: [
      { name: 'rpcRequest', durationMs: 6 }, { name: 'dbBucket', durationMs: 1 },
      { name: 'dbRows', durationMs: 2 }, { name: 'dbTotal', durationMs: 3.5 },
    ] });
    const response = await harness.post();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE);
    expect(await response.json()).toEqual({ metrics: METRICS });
    expect(harness.calls).toEqual([{ ids: ['video_A'], mode: 'rpc' }]);
    expect(response.headers.get('server-timing')).toBe('kpi-mode;desc="rpc", kpi-body;dur=3, kpi-handler;dur=10, '
      + 'kpi-rpc-request;dur=6, kpi-db-bucket;dur=1, kpi-db-rows;dur=2, kpi-db-total;dur=3.5');
    expect(response.headers.get('server-timing')).not.toContain('video_A');
  });

  test('explicit legacy is deployment-owned and its request spans are not labeled DB-only', async () => {
    const harness = fixture({ mode: 'legacy', events: [
      { name: 'bucketRequest', durationMs: 2 }, { name: 'rowsRequest', durationMs: 4 },
    ] });
    const response = await harness.post(JSON.stringify({ videoIds: ['video_A'], mode: 'rpc' }),
      { 'x-kpi-query-mode': 'rpc' }, '?mode=rpc');
    expect(harness.calls[0].mode).toBe('legacy');
    expect(await response.json()).toEqual({ metrics: METRICS });
    expect(response.headers.get('server-timing')).toContain('kpi-mode;desc="legacy"');
    expect(response.headers.get('server-timing')).toContain('kpi-bucket-request;dur=2, kpi-rows-request;dur=4');
    expect(response.headers.get('server-timing')).not.toContain('kpi-db-');
  });

  test('request headers, body and query cannot turn the default RPC path into legacy', async () => {
    const harness = fixture();
    const response = await harness.post(JSON.stringify({ videoIds: ['video_A'], mode: 'legacy' }), {
      'x-kpi-query-mode': 'legacy', TZUDONG_HOME_KPI_QUERY_MODE: 'legacy',
    }, '?mode=legacy&queryMode=legacy');
    expect(harness.calls[0].mode).toBe('rpc');
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE);
    expect(await response.json()).toEqual({ metrics: METRICS });
  });

  test('invalid deployment modes fail closed without body/privileged reads or echoing the value', async () => {
    for (const mode of ['', ' RPC ', PRIVATE_SENTINEL, null]) {
      const harness = fixture({ mode });
      const response = await harness.post();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ metrics: [] });
      expect(harness.calls).toEqual([]);
      expect(harness.bodyReads).toBe(0);
      expect(response.headers.get('server-timing')).toBe('kpi-mode-invalid, kpi-handler;dur=0');
      expect(harness.errors).toEqual([]);
    }
  });

  test('invalid bodies keep no-store and never invoke the query helper', async () => {
    for (const [body, headers] of [
      ['{', {}],
      [JSON.stringify({ videoIds: ['video_A'] }), { 'content-type': 'text/plain' }],
      [JSON.stringify({ videoIds: ['video_A'] }), { 'content-length': '8193' }],
    ] as [string, Record<string, string>][]) {
      const harness = fixture();
      const response = await harness.post(body, headers);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ metrics: [] });
      expect(harness.calls).toEqual([]);
      expect(response.headers.get('server-timing')).toBe('kpi-mode;desc="rpc", kpi-body;dur=3, kpi-handler;dur=3');
    }
  });

  test('empty valid IDs keep the existing short public cache and no query', async () => {
    const harness = fixture();
    const response = await harness.post(JSON.stringify({ videoIds: ['short', null, 'bad/id'] }));
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await response.json()).toEqual({ metrics: [] });
    expect(harness.calls).toEqual([]);
  });

  test('RPC failure keeps no-store and fixed logging, with one call and no legacy fallback', async () => {
    const harness = fixture({ rejectQuery: true, events: [{ name: 'rpcRequest', durationMs: 7 }] });
    const response = await harness.post();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ metrics: [] });
    expect(harness.calls).toEqual([{ ids: ['video_A'], mode: 'rpc' }]);
    expect(harness.errors).toEqual([['[home/youtube-kpi] failed:']]);
    expect(response.headers.get('server-timing')).toContain('kpi-rpc-request;dur=7');
    expect(response.headers.get('server-timing')).not.toContain(PRIVATE_SENTINEL);
  });

  test('invalid DB timing does not change data or cache policy', async () => {
    const harness = fixture({ events: [
      { name: 'dbBucket', durationMs: 1 }, { name: 'dbTimingInvalid' },
      { name: 'dbTotal', durationMs: 2 }, { name: 'rpcRequest', durationMs: 7 },
    ] });
    const response = await harness.post();
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE);
    expect(await response.json()).toEqual({ metrics: METRICS });
    expect(response.headers.get('server-timing')).toContain('kpi-db-invalid');
    expect(response.headers.get('server-timing')).not.toMatch(/kpi-db-(?:bucket|rows|total);dur=/);
  });

  test('clock failure does not alter the route result or its query/cache behavior', async () => {
    const harness = fixture({ clock: () => { throw new Error(PRIVATE_SENTINEL); } });
    const response = await harness.post();
    expect(response.headers.get('cache-control')).toBe(PUBLIC_CACHE);
    expect(await response.json()).toEqual({ metrics: METRICS });
    expect(harness.calls).toHaveLength(1);
    expect(response.headers.get('server-timing')).toBe('kpi-mode;desc="rpc"');
    expect(harness.errors).toEqual([]);
  });

  test('timing state is fresh for every request and cannot leak a previous failure', async () => {
    const events: HomeYouTubeKpiObservation[] = [{ name: 'dbTimingInvalid' }];
    const harness = fixture({ events });
    expect((await harness.post()).headers.get('server-timing')).toContain('kpi-db-invalid');
    events.length = 0;
    const response = await harness.post();
    expect(response.headers.get('server-timing')).not.toContain('kpi-db-invalid');
    expect(response.headers.get('server-timing')).toContain('kpi-handler;dur=10');
    expect(await response.json()).toEqual({ metrics: METRICS });
  });
});
