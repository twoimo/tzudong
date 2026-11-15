import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pruneTimedCache } from '../lib/public-insights/timed-cache';
import { readBoundedJsonRequest } from '../lib/security/bounded-json-request';
import { createHomeKpiServerTiming, resolveHomeKpiQueryMode } from '../lib/performance/home-kpi-server-timing';
import type { HomeKpiQueryMode, HomeYouTubeKpiObservation } from '../lib/performance/home-kpi-server-timing';

type SnapshotRow = {
    video_id: string;
    title: string | null;
    published_at: string | null;
    category_id: string | null;
    duration_seconds: number | string | null;
    view_count: number | string | null;
    like_count: number | string | null;
    comment_count: number | string | null;
    bucket_started_at: string;
    fetched_at: string | null;
};
type Metric = {
    videoId: string; title: string | null; publishedAt: string | null;
    duration: number; viewCount: number; likeCount: number; commentCount: number;
    bucketStartedAt: string; fetchedAt: string | null;
};
type Stage = 'bucket' | 'rows';
type Query = {
    columns: string[];
    filters: { column: keyof SnapshotRow; values: readonly unknown[] }[];
    order?: { column: keyof SnapshotRow; ascending: boolean };
    limit?: number;
    single: boolean;
};
type QueryResult = { data: Record<string, unknown>[] | Record<string, unknown> | null; error: unknown };
type HelperOptions = { mode?: HomeKpiQueryMode; observe?: (event: HomeYouTubeKpiObservation) => void };

const OLD_BUCKET = '2026-01-01T00:00:00.000Z';
const LATEST_BUCKET = '2026-01-01T00:15:00.000Z';
const PUBLIC_METRICS_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const SYNTHETIC_PRIVATE_DETAIL = 'SYNTHETIC_PROVIDER_DETAIL_NOT_FOR_RESPONSE';

// Load complete, actual module bodies with the repository's Bun/VM pattern.
// Only the SDK I/O and NextResponse JSON boundary are replaced. The actual
// normalizer, bounded body reader, helper and POST execute without credentials,
// global module mocks, project dependencies or network. This is not a DB/RLS,
// middleware, deployed Next-server, or performance test.
function evaluateModule<T>(path: string, expression: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const transformed = new Bun.Transpiler({ loader: 'ts', target: 'node' }).transformSync(source)
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
            (_all, names: string, specifier: string) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(specifier)});`)
        .replace(/export (?=(?:const|async function|function) )/g, '');
    if (/^\s*(?:import|export)\b/m.test(transformed)) throw new Error('UNSUPPORTED_FIXTURE_MODULE_SYNTAX');
    const output: { value?: T } = {};
    runInNewContext(`${transformed}\noutput.value = ${expression};`, {
        output,
        require(specifier: string) {
            if (!Object.hasOwn(dependencies, specifier)) throw new Error('UNDECLARED_FIXTURE_IMPORT');
            return dependencies[specifier];
        },
        process: { env: {} },
        fetch() { throw new Error('FIXTURE_NETWORK_FORBIDDEN'); },
        ...globals,
    }, { timeout: 1000 });
    return output.value as T;
}

const treemap = evaluateModule<Record<string, unknown>>('../lib/public-insights/treemap.ts', `({
    buildInsightTreemapResponseQualityMeta, buildInsightTreemapComparisonCoverageFromVideos,
    createInsightTreemapQualityFlag, enrichInsightTreemapVideosWithQuality, normalizeInsightTreemapMetric
})`, {
    '@supabase/supabase-js': { createClient() { throw new Error('UNEXPECTED_TREEMAP_CLIENT'); } },
    './timed-cache': { pruneTimedCache },
});

function snapshot(videoId: string, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
    return {
        video_id: videoId, title: `Synthetic ${videoId}`, published_at: '2025-12-01T00:00:00.000Z',
        category_id: '24', duration_seconds: 90, view_count: 100, like_count: 10, comment_count: 2,
        bucket_started_at: LATEST_BUCKET, fetched_at: '2026-01-01T00:16:00.000Z', ...overrides,
    };
}

function fixture(options: {
    rows?: readonly SnapshotRow[];
    mode?: HomeKpiQueryMode;
    errorAt?: Stage;
    throwAt?: Stage | 'factory' | 'rpc';
    rpcData?: unknown;
    rpcError?: boolean;
    clock?: () => number;
} = {}) {
    let rows = options.rows ?? [];
    const mode = options.mode ?? 'legacy';
    const state = { factoryCalls: 0, reads: [] as Query[], rpcCalls: [] as { name: string; ids: string[] }[], warnings: [] as unknown[][], errors: [] as unknown[][], violations: [] as string[] };
    function unexpected(code: string): never {
        state.violations.push(code);
        throw new Error(code);
    }
    function bounded<T extends object>(value: T): T {
        return new Proxy(value, {
            get(target, key, receiver) {
                if (!Reflect.has(target, key)) return unexpected('UNDECLARED_FIXTURE_OPERATION');
                return Reflect.get(target, key, receiver);
            },
        });
    }
    const client = bounded({
        async rpc(name: string, args: { p_video_ids: string[] }) {
            if (name !== 'get_home_youtube_kpi_metrics' || Object.keys(args).join() !== 'p_video_ids') unexpected('UNDECLARED_FIXTURE_RPC');
            if (state.rpcCalls.length >= 8) unexpected('FIXTURE_RPC_LIMIT');
            state.rpcCalls.push({ name, ids: [...args.p_video_ids] });
            if (options.throwAt === 'rpc') throw new Error(SYNTHETIC_PRIVATE_DETAIL);
            if (options.rpcError) return { data: null, error: { message: SYNTHETIC_PRIVATE_DETAIL } };
            if (Object.hasOwn(options, 'rpcData')) return { data: options.rpcData, error: null };
            // This replaces the SDK response only; the exact SQL/role contract
            // is executed by backend/supabase/tests/home_youtube_kpi_rpc.sql.
            const bucket = [...rows].map(row => row.bucket_started_at).sort().at(-1);
            const status = options.errorAt === 'bucket' ? 'bucket_error' : options.errorAt === 'rows' ? 'rows_error' : 'ok';
            const selected = status === 'ok' ? rows.filter(row => row.bucket_started_at === bucket && args.p_video_ids.includes(row.video_id)) : [];
            return { data: {
                schemaVersion: 1, status, rows: selected, timingValid: true,
                timings: { bucketMs: 1, rowsMs: status === 'bucket_error' || !bucket ? null : 2, totalMs: 4 },
            }, error: null };
        },
        from(table: string) {
            if (table !== 'youtube_video_kpi_snapshots') unexpected('UNDECLARED_FIXTURE_TABLE');
            const query: Query = { columns: [], filters: [], single: false };
            async function execute(): Promise<QueryResult> {
                if (state.reads.length >= 8) unexpected('FIXTURE_READ_LIMIT');
                state.reads.push({ ...query, columns: [...query.columns], filters: [...query.filters] });
                const stage: Stage = query.single ? 'bucket' : 'rows';
                if (options.throwAt === stage) throw new Error(SYNTHETIC_PRIVATE_DETAIL);
                if (options.errorAt === stage) return { data: null, error: { message: SYNTHETIC_PRIVATE_DETAIL } };
                let selected = rows.filter(row => query.filters.every(filter => filter.values.includes(row[filter.column])));
                if (query.order) {
                    const { column, ascending } = query.order;
                    selected.sort((left, right) => String(left[column]).localeCompare(String(right[column])) * (ascending ? 1 : -1));
                }
                if (query.limit !== undefined) selected = selected.slice(0, query.limit);
                const projected = selected.map(row => Object.fromEntries(query.columns.map(column => [column, row[column as keyof SnapshotRow]])));
                if (query.single && projected.length > 1) return { data: null, error: { message: 'SYNTHETIC_MULTIPLE_ROWS' } };
                return { data: query.single ? projected[0] ?? null : projected, error: null };
            }
            const builder = bounded({
                select(columns: string) { query.columns = columns.split(','); return builder; },
                order(column: keyof SnapshotRow, order: { ascending: boolean }) { query.order = { column, ascending: order.ascending }; return builder; },
                limit(count: number) { query.limit = count; return builder; },
                eq(column: keyof SnapshotRow, value: unknown) { query.filters.push({ column, values: [value] }); return builder; },
                in(column: keyof SnapshotRow, values: readonly string[]) { query.filters.push({ column, values: [...values] }); return builder; },
                maybeSingle() { query.single = true; return execute(); },
                then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject); },
            });
            return builder;
        },
    });
    const logger = { warn: (...args: unknown[]) => state.warnings.push(args), error: (...args: unknown[]) => state.errors.push(args) };
    const helper = evaluateModule<(ids: string[], options?: HelperOptions) => Promise<Metric[]>>('../lib/admin/youtube-kpi-snapshots.ts', 'getLatestYouTubeKpiMetricsForVideoIds', {
        '@/lib/supabase/service-role': { createSupabaseServiceRoleClient() {
            state.factoryCalls += 1;
            if (options.throwAt === 'factory') throw new Error(SYNTHETIC_PRIVATE_DETAIL);
            return client;
        } },
        '@/lib/public-insights/treemap': treemap,
    }, { console: logger, ...(options.clock ? { performance: { now: options.clock } } : {}) });
    const handler = evaluateModule<(request: Request) => Promise<Response>>('../app/api/home/youtube-kpi/route.ts', 'POST', {
        'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
        '@/lib/admin/youtube-kpi-snapshots': { getLatestYouTubeKpiMetricsForVideoIds: helper },
        '@/lib/security/bounded-json-request': { readBoundedJsonRequest },
        '@/lib/performance/home-kpi-server-timing': { createHomeKpiServerTiming, resolveHomeKpiQueryMode },
    }, { console: logger, process: { env: { TZUDONG_HOME_KPI_QUERY_MODE: mode } } });
    function assertBoundaries() { expect(state.violations).toEqual([]); }
    return {
        state,
        replaceRows(next: readonly SnapshotRow[]) { rows = next; },
        async metrics(ids: string[], helperOptions: HelperOptions = {}) { try { return await helper(ids, { mode, ...helperOptions }); } finally { assertBoundaries(); } },
        async defaultMetrics(ids: string[]) { try { return await helper(ids); } finally { assertBoundaries(); } },
        async post(body: string, headers: Record<string, string> = {}) {
            const request = new Request('https://home-kpi.fixture.invalid/api/home/youtube-kpi', {
                method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
            });
            try { return await handler(request); } finally { assertBoundaries(); }
        },
    };
}

async function expectEmptyResponse(response: Response, cacheControl: string) {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(cacheControl);
    expect(await response.json()).toEqual({ metrics: [] });
}

describe('home YouTube KPI server behavior', () => {
    test('uses the global latest bucket even when it contains no requested video', async () => {
        const harness = fixture({ rows: [
            snapshot('video_A', { bucket_started_at: OLD_BUCKET }),
            snapshot('unrelated_new'),
        ] });
        expect(await harness.metrics(['video_A'])).toEqual([]);
        expect(harness.state.reads).toHaveLength(2);
        expect(harness.state.reads[0].filters).toEqual([]);
    });

    test('deduplicates trimmed IDs, preserves requested order, omits missing rows and never falls back to older rows', async () => {
        const rows = Object.freeze([
            Object.freeze(snapshot('video_A', { title: 'Current A' })),
            Object.freeze(snapshot('old_only', { bucket_started_at: OLD_BUCKET })),
            Object.freeze(snapshot('video_B', { title: 'Current B' })),
            Object.freeze(snapshot('video_A', { title: 'Old A', bucket_started_at: OLD_BUCKET })),
        ]);
        const before = JSON.stringify(rows);
        const harness = fixture({ rows });
        const metrics = await harness.metrics([' video_B ', 'video_A', 'video_B', 'old_only', 'missing_video', '', '  ']);
        expect(metrics.map(row => row.videoId)).toEqual(['video_B', 'video_A']);
        expect(metrics.map(row => row.title)).toEqual(['Current B', 'Current A']);
        expect(metrics.every(row => row.bucketStartedAt === LATEST_BUCKET)).toBe(true);
        expect(metrics[0]).toEqual({
            videoId: 'video_B', title: 'Current B', publishedAt: '2025-12-01T00:00:00.000Z',
            duration: 90, viewCount: 100, likeCount: 10, commentCount: 2,
            bucketStartedAt: LATEST_BUCKET, fetchedAt: '2026-01-01T00:16:00.000Z',
        });
        expect(JSON.stringify(rows)).toBe(before);
    });

    test('uses the actual metric normalizer and floors only duration', async () => {
        const harness = fixture({ rows: [
            snapshot('video_A', { title: null, published_at: null, duration_seconds: '93.9', view_count: '1,234.5', like_count: '-3', comment_count: 'NaN' }),
            snapshot('video_B', { duration_seconds: -8, view_count: null, like_count: ' ', comment_count: Infinity }),
            snapshot('video_C', { duration_seconds: '1:30', view_count: '1e3', like_count: '12oops', comment_count: 47.8 }),
        ] });
        const metrics = await harness.metrics(['video_A', 'video_B', 'video_C']);
        expect(metrics.map(({ duration, viewCount, likeCount, commentCount }) => ({ duration, viewCount, likeCount, commentCount }))).toEqual([
            { duration: 93, viewCount: 1234.5, likeCount: 0, commentCount: 0 },
            { duration: 0, viewCount: 0, likeCount: 0, commentCount: 0 },
            { duration: 0, viewCount: 0, likeCount: 0, commentCount: 47.8 },
        ]);
        expect(metrics[0].title).toBeNull();
        expect(metrics[0].publishedAt).toBeNull();
    });

    test('does not cache a missing latest-bucket row or a later same-bucket correction', async () => {
        const harness = fixture({ rows: [snapshot('video_A', { bucket_started_at: OLD_BUCKET }), snapshot('unrelated_new')] });
        expect(await harness.metrics(['video_A'])).toEqual([]);
        harness.replaceRows([snapshot('unrelated_new'), snapshot('video_A', { title: 'Published later', view_count: 200 })]);
        expect((await harness.metrics(['video_A']))[0]).toMatchObject({ title: 'Published later', viewCount: 200 });
        harness.replaceRows([snapshot('video_A', { title: 'Corrected in the same bucket', view_count: 240 })]);
        expect((await harness.metrics(['video_A']))[0]).toMatchObject({ title: 'Corrected in the same bucket', viewCount: 240 });
    });

    test('empty helper input does not construct a privileged client', async () => {
        const harness = fixture();
        expect(await harness.metrics(['', '  '])).toEqual([]);
        expect(harness.state.factoryCalls).toBe(0);
        expect(harness.state.reads).toEqual([]);
    });

    test('POST validates IDs before the real helper and retains the successful response fields and cache policy', async () => {
        const maxLengthId = 'v'.repeat(64);
        const harness = fixture({ rows: [snapshot('video_B'), snapshot(maxLengthId), snapshot('video_A')] });
        const response = await harness.post(JSON.stringify({ videoIds: [
            ' video_A ', null, 42, {}, 'short', 'bad/id', 'v'.repeat(65), 'video_B', 'video_A', maxLengthId,
        ] }));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(PUBLIC_METRICS_CACHE);
        const body = await response.json() as { metrics: Metric[] };
        expect(body.metrics.map(row => row.videoId)).toEqual(['video_A', 'video_B', maxLengthId]);
        expect(Object.keys(body)).toEqual(['metrics']);
        expect(Object.keys(body.metrics[0]).sort()).toEqual([
            'bucketStartedAt', 'commentCount', 'duration', 'fetchedAt', 'likeCount', 'publishedAt', 'title', 'videoId', 'viewCount',
        ]);
    });

    test('POST caps unique valid IDs at 120 without spending the cap on invalid or duplicate entries', async () => {
        const ids = Array.from({ length: 122 }, (_, index) => `video_${String(index).padStart(3, '0')}`);
        const harness = fixture({ rows: ids.map(id => snapshot(id)).reverse() });
        const response = await harness.post(JSON.stringify({ videoIds: [null, 'bad/id', ids[0], ids[0], ...ids] }));
        const body = await response.json() as { metrics: Metric[] };
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(PUBLIC_METRICS_CACHE);
        expect(body.metrics.map(row => row.videoId)).toEqual(ids.slice(0, 120));
        expect(harness.state.reads[1].filters.find(filter => filter.column === 'video_id')?.values).toHaveLength(120);
    });

    test('valid JSON without eligible IDs uses the short public cache policy and performs no privileged reads', async () => {
        for (const body of [null, [], {}, { videoIds: 'video_A' }, { videoIds: [] }, { videoIds: [null, false, 'short', 'bad/id'] }]) {
            const harness = fixture();
            await expectEmptyResponse(await harness.post(JSON.stringify(body)), 'public, max-age=60');
            expect(harness.state.factoryCalls).toBe(0);
            expect(harness.state.reads).toEqual([]);
        }
    });

    test('an empty snapshot table returns empty public metrics without a second read', async () => {
        const harness = fixture();
        await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), PUBLIC_METRICS_CACHE);
        expect(harness.state.reads).toHaveLength(1);
    });

    test('missing requested rows in an existing latest bucket retain the public metrics cache policy', async () => {
        const harness = fixture({ rows: [snapshot('unrelated_new')] });
        await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), PUBLIC_METRICS_CACHE);
        expect(harness.state.reads).toHaveLength(2);
    });

    test('a returned first-query error retains public empty metrics and only the fixed bucket warning', async () => {
        const harness = fixture({ errorAt: 'bucket' });
        await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), PUBLIC_METRICS_CACHE);
        expect(harness.state.reads).toHaveLength(1);
        expect(harness.state.warnings).toEqual([['[youtube-kpi-snapshots] latest bucket unavailable:']]);
        expect(harness.state.errors).toEqual([]);
    });

    test('a returned row-query error produces no-store empty metrics and only the fixed route error', async () => {
        const harness = fixture({ rows: [snapshot('video_A')], errorAt: 'rows' });
        await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), 'no-store');
        expect(harness.state.reads).toHaveLength(2);
        expect(harness.state.warnings).toEqual([]);
        expect(harness.state.errors).toEqual([['[home/youtube-kpi] failed:']]);
    });

    for (const stage of ['factory', 'bucket', 'rows'] as const) {
        test(`an escaped ${stage} exception retains no-store without exposing diagnostic details`, async () => {
            const harness = fixture({ rows: [snapshot('video_A')], throwAt: stage });
            await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), 'no-store');
            expect(harness.state.reads).toHaveLength(stage === 'factory' ? 0 : stage === 'bucket' ? 1 : 2);
            expect(harness.state.warnings).toEqual([]);
            expect(harness.state.errors).toEqual([['[home/youtube-kpi] failed:']]);
        });
    }

    const invalidBodies: { name: string; body: string; headers?: Record<string, string> }[] = [
        { name: 'malformed JSON', body: '{"videoIds":' },
        { name: 'duplicate JSON member names', body: '{"videoIds":["video_A"],"videoIds":["video_B"]}' },
        { name: 'non-JSON media', body: '{"videoIds":["video_A"]}', headers: { 'content-type': 'text/plain' } },
        { name: 'declared body over 8 KiB', body: '{"videoIds":["video_A"]}', headers: { 'content-length': '8193' } },
        { name: 'actual body over 8 KiB', body: JSON.stringify({ videoIds: ['video_A'], padding: 'x'.repeat(8192) }) },
        { name: 'mismatched declared length', body: '{"videoIds":["video_A"]}', headers: { 'content-length': '1' } },
    ];
    for (const input of invalidBodies) {
        test(`${input.name} reaches the actual bounded reader and rejects before privileged client creation`, async () => {
            const harness = fixture();
            await expectEmptyResponse(await harness.post(input.body, input.headers), 'no-store');
            expect(harness.state.factoryCalls).toBe(0);
            expect(harness.state.reads).toEqual([]);
        });
    }
});

function rpcEnvelope(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1, status: 'ok', rows: [snapshot('video_A')], timingValid: true,
        timings: { bucketMs: 1, rowsMs: 2, totalMs: 4 }, ...overrides,
    };
}

describe('home YouTube KPI one-RPC server behavior', () => {
    test('defaults to one RPC and restores input order without per-video fallback', async () => {
        const harness = fixture({ rows: [
            snapshot('video_A'), snapshot('old_only', { bucket_started_at: OLD_BUCKET }), snapshot('video_B'),
        ] });
        const metrics = await harness.defaultMetrics(['\u00a0video_B\u00a0', 'video_A', 'video_B', 'old_only', 'missing_video', '', '  ']);
        expect(metrics.map(row => row.videoId)).toEqual(['video_B', 'video_A']);
        expect(harness.state.rpcCalls).toEqual([{
            name: 'get_home_youtube_kpi_metrics', ids: ['video_B', 'video_A', 'old_only', 'missing_video'],
        }]);
        expect(harness.state.factoryCalls).toBe(1);
        expect(harness.state.reads).toEqual([]);
    });

    test('preserves the actual normalizer and nullable metadata identically to legacy mode', async () => {
        const rows = [
            snapshot('video_A', { title: null, published_at: null, duration_seconds: '93.9', view_count: '1,234.5', like_count: '-3', comment_count: 'NaN' }),
            snapshot('video_B', { duration_seconds: -8, view_count: null, like_count: ' ', comment_count: Infinity }),
            snapshot('video_C', { duration_seconds: '1:30', view_count: '1e3', like_count: '12oops', comment_count: 47.8 }),
        ];
        const ids = ['video_C', 'video_A', 'video_B'];
        expect(await fixture({ mode: 'rpc', rows }).metrics(ids)).toEqual(await fixture({ mode: 'legacy', rows }).metrics(ids));
    });

    test('keeps the unrestricted helper contract above the route cap and old chunk size in one request', async () => {
        const ids = Array.from({ length: 245 }, (_, index) => `video_${index}`);
        const harness = fixture({ mode: 'rpc', rows: ids.map(id => snapshot(id)).reverse() });
        expect((await harness.metrics(ids)).map(row => row.videoId)).toEqual(ids);
        expect(harness.state.rpcCalls).toHaveLength(1);
        expect(harness.state.rpcCalls[0].ids).toHaveLength(245);
        expect(harness.state.reads).toEqual([]);
    });

    test('does not cache a missing row or a same-bucket correction', async () => {
        const harness = fixture({ mode: 'rpc', rows: [snapshot('video_A', { bucket_started_at: OLD_BUCKET }), snapshot('unrelated_new')] });
        expect(await harness.metrics(['video_A'])).toEqual([]);
        harness.replaceRows([snapshot('video_A', { view_count: 200 })]);
        expect((await harness.metrics(['video_A']))[0].viewCount).toBe(200);
        harness.replaceRows([snapshot('video_A', { view_count: 240 })]);
        expect((await harness.metrics(['video_A']))[0].viewCount).toBe(240);
        expect(harness.state.rpcCalls).toHaveLength(3);
    });

    test('empty normalized helper input never creates the service client', async () => {
        const harness = fixture({ mode: 'rpc' });
        expect(await harness.metrics(['', '\u00a0'])).toEqual([]);
        expect(harness.state.factoryCalls).toBe(0);
        expect(harness.state.rpcCalls).toEqual([]);
    });

    test('POST still filters, deduplicates and caps at 120 before the one RPC', async () => {
        const ids = Array.from({ length: 122 }, (_, index) => `video_${String(index).padStart(3, '0')}`);
        const harness = fixture({ mode: 'rpc', rows: ids.map(id => snapshot(id)).reverse() });
        const response = await harness.post(JSON.stringify({ videoIds: [null, 'bad/id', ids[0], ids[0], ...ids] }));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(PUBLIC_METRICS_CACHE);
        expect((await response.json() as { metrics: Metric[] }).metrics.map(row => row.videoId)).toEqual(ids.slice(0, 120));
        expect(harness.state.rpcCalls[0].ids).toEqual(ids.slice(0, 120));
        expect(harness.state.reads).toEqual([]);
    });

    test('empty table and a global latest bucket without requested rows retain public empty metrics', async () => {
        for (const rows of [[], [snapshot('video_A', { bucket_started_at: OLD_BUCKET }), snapshot('unrelated_new')]]) {
            const harness = fixture({ mode: 'rpc', rows });
            await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), PUBLIC_METRICS_CACHE);
            expect(harness.state.rpcCalls).toHaveLength(1);
        }
    });

    test('fixed bucket_error retains the existing public-empty behavior without leaking diagnostics', async () => {
        const harness = fixture({ mode: 'rpc', errorAt: 'bucket' });
        await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), PUBLIC_METRICS_CACHE);
        expect(harness.state.warnings).toEqual([['[youtube-kpi-snapshots] latest bucket unavailable:']]);
        expect(harness.state.errors).toEqual([]);
        expect(harness.state.rpcCalls).toHaveLength(1);
        expect(harness.state.reads).toEqual([]);
    });

    for (const failure of [
        { name: 'fixed rows_error', errorAt: 'rows' as const },
        { name: 'unclassified RPC transport error', rpcError: true },
        { name: 'thrown RPC error', throwAt: 'rpc' as const },
        { name: 'service factory error', throwAt: 'factory' as const },
    ]) {
        test(`${failure.name} returns no-store and never retries through legacy queries`, async () => {
            const harness = fixture({ mode: 'rpc', rows: [snapshot('video_A')], ...failure });
            await expectEmptyResponse(await harness.post('{"videoIds":["video_A"]}'), 'no-store');
            expect(harness.state.warnings).toEqual([]);
            expect(harness.state.errors).toEqual([['[home/youtube-kpi] failed:']]);
            expect(harness.state.reads).toEqual([]);
            expect(harness.state.rpcCalls.length).toBeLessThanOrEqual(1);
        });
    }

    test('malformed data envelopes fail closed with a fixed error and no partial metrics', async () => {
        const malformed = [
            null, [], {}, rpcEnvelope({ schemaVersion: 2 }), rpcEnvelope({ status: 'provider_error' }),
            rpcEnvelope({ debug: SYNTHETIC_PRIVATE_DETAIL }), rpcEnvelope({ rows: null }),
            rpcEnvelope({ status: 'bucket_error' }), rpcEnvelope({ status: 'rows_error' }),
            rpcEnvelope({ rows: [snapshot('unrequested')] }),
            rpcEnvelope({ rows: [snapshot('video_A'), snapshot('video_A')] }),
            rpcEnvelope({ rows: [snapshot('video_A'), snapshot('video_B', { bucket_started_at: OLD_BUCKET })] }),
            rpcEnvelope({ rows: [{ ...snapshot('video_A'), title: {} }] }),
            rpcEnvelope({ rows: [{ ...snapshot('video_A'), view_count: {} }] }),
            rpcEnvelope({ rows: [{ ...snapshot('video_A'), fetched_at: undefined }] }),
            rpcEnvelope({ rows: [{ ...snapshot('video_A'), extra: SYNTHETIC_PRIVATE_DETAIL }] }),
        ];
        for (const rpcData of malformed) {
            const harness = fixture({ mode: 'rpc', rpcData });
            await expectEmptyResponse(await harness.post('{"videoIds":["video_A","video_B"]}'), 'no-store');
            expect(harness.state.errors).toEqual([['[home/youtube-kpi] failed:']]);
            expect(harness.state.warnings).toEqual([]);
            expect(harness.state.reads).toEqual([]);
        }
    });

    test('emits numeric request and DB timings only, and observer failure cannot alter data', async () => {
        let tick = 0;
        const events: HomeYouTubeKpiObservation[] = [];
        const harness = fixture({ mode: 'rpc', rows: [snapshot('video_A')], clock: () => ++tick });
        const expected = await harness.metrics(['video_A'], { observe: event => events.push(event) });
        expect(events).toEqual([
            { name: 'rpcRequest', durationMs: 1 }, { name: 'dbBucket', durationMs: 1 },
            { name: 'dbRows', durationMs: 2 }, { name: 'dbTotal', durationMs: 4 },
        ]);
        expect(await harness.metrics(['video_A'], { observe() { throw new Error(SYNTHETIC_PRIVATE_DETAIL); } })).toEqual(expected);
        expect(harness.state.errors).toEqual([]);
        expect(harness.state.warnings).toEqual([]);
    });

    test('legacy observations span the same actual query awaits including all row chunks', async () => {
        let tick = 0;
        const events: HomeYouTubeKpiObservation[] = [];
        const ids = Array.from({ length: 201 }, (_, index) => `video_${index}`);
        const harness = fixture({ rows: ids.map(id => snapshot(id)), clock: () => ++tick });
        expect(await harness.metrics(ids, { observe: event => events.push(event) })).toHaveLength(201);
        expect(events).toEqual([{ name: 'bucketRequest', durationMs: 1 }, { name: 'rowsRequest', durationMs: 1 }]);
        expect(harness.state.reads).toHaveLength(3);
        expect(harness.state.rpcCalls).toEqual([]);
    });

    test('missing, throwing or backward request clocks leave normal data intact', async () => {
        let tick = 10;
        for (const clock of [undefined, () => { throw new Error(SYNTHETIC_PRIVATE_DETAIL); }, () => --tick]) {
            const events: HomeYouTubeKpiObservation[] = [];
            const harness = fixture({ mode: 'rpc', rows: [snapshot('video_A')], clock });
            expect(await harness.metrics(['video_A'], { observe: event => events.push(event) })).toHaveLength(1);
            expect(events.map(event => event.name)).toEqual(['dbBucket', 'dbRows', 'dbTotal']);
        }
    });

    test('invalid DB telemetry is marked and omitted without changing metrics or cache policy', async () => {
        const telemetry = [
            { timingValid: false }, { timingValid: undefined }, { timings: undefined },
            { timings: { bucketMs: -1, rowsMs: 2, totalMs: 4 } },
            { timings: { bucketMs: '1', rowsMs: 2, totalMs: 4 } },
            { timings: { bucketMs: 1, rowsMs: 2, totalMs: Infinity } },
            { timings: { bucketMs: 1, rowsMs: 2, totalMs: Number.MAX_SAFE_INTEGER + 1 } },
            { timings: { bucketMs: 2, rowsMs: 2, totalMs: 3 } },
            { timings: { bucketMs: 1, rowsMs: null, totalMs: 4 } },
            { timings: { bucketMs: 1, rowsMs: 2, totalMs: 4, private: SYNTHETIC_PRIVATE_DETAIL } },
        ];
        for (const patch of telemetry) {
            const events: HomeYouTubeKpiObservation[] = [];
            const harness = fixture({ mode: 'rpc', rpcData: rpcEnvelope(patch) });
            expect(await harness.metrics(['video_A'], { observe: event => events.push(event) })).toHaveLength(1);
            expect(events).toEqual([{ name: 'dbTimingInvalid' }]);
            const response = await harness.post('{"videoIds":["video_A"]}');
            expect(response.headers.get('cache-control')).toBe(PUBLIC_METRICS_CACHE);
            expect(response.headers.get('server-timing')).toContain('kpi-db-invalid');
            expect(response.headers.get('server-timing')).not.toContain('kpi-db-total;');
            expect((await response.json() as { metrics: Metric[] }).metrics).toHaveLength(1);
        }
    });

    test('zero is a valid measured duration, and rows-not-attempted remains absent', async () => {
        const events: HomeYouTubeKpiObservation[] = [];
        const harness = fixture({ mode: 'rpc', rpcData: rpcEnvelope({ rows: [], timings: { bucketMs: 0, rowsMs: null, totalMs: 0 } }) });
        expect(await harness.metrics(['video_A'], { observe: event => events.push(event) })).toEqual([]);
        expect(events).toEqual([{ name: 'dbBucket', durationMs: 0 }, { name: 'dbTotal', durationMs: 0 }]);
    });

    test('throwing telemetry accessors cannot change otherwise valid metrics', async () => {
        const rpcData = rpcEnvelope();
        Object.defineProperty(rpcData, 'timings', { enumerable: true, get() { throw new Error(SYNTHETIC_PRIVATE_DETAIL); } });
        const events: HomeYouTubeKpiObservation[] = [];
        const harness = fixture({ mode: 'rpc', rpcData });
        expect(await harness.metrics(['video_A'], { observe: event => events.push(event) })).toHaveLength(1);
        expect(events).toEqual([{ name: 'dbTimingInvalid' }]);
        expect(harness.state.errors).toEqual([]);
    });
});
