import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchLatestRestaurantPage } from '../lib/popular-restaurants';
import { createPaintCalibrationInitialLatestQueryMarker,
    type PaintCalibrationLatestQueryPhase } from '../lib/performance/paint-calibration-milestones';
import type { Restaurant } from '../types/restaurant';

const origin = 'https://paint-calibration.invalid';
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const firstVideo = 'abcdefghijk';
const secondVideo = 'lmnopqrstuv';
const queryArgs = { fetchLimit: 2, isKoreanOnly: true, sort: 'latest' as const };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
const rows = freeze([
    { id: 'first', name: '첫 합성 식당', approved_name: '첫 합성 식당', status: 'approved',
        road_address: '서울특별시 합성 주소 1', categories: ['한식'], review_count: 0,
        youtube_link: `https://youtu.be/${firstVideo}`, youtube_meta: { publishedAt: '2026-02-01' } },
    { id: 'second', name: '둘째 합성 식당', approved_name: '둘째 합성 식당', status: 'approved',
        road_address: '서울특별시 합성 주소 2', categories: ['한식'], review_count: 0,
        youtube_link: `https://youtu.be/${secondVideo}`, youtube_meta: { publishedAt: '2026-01-01' } },
]) as unknown as Restaurant[];
const metrics = freeze({ metrics: [
    { videoId: firstVideo, title: '합성 영상 1', publishedAt: '2026-01-01', duration: 30,
        viewCount: 10, likeCount: 1, commentCount: 0 },
    { videoId: secondVideo, title: '합성 영상 2', publishedAt: '2026-03-01', duration: 30,
        viewCount: 10, likeCount: 1, commentCount: 0 },
] });
const json = (value: unknown, status = 200): Response =>
    Object.assign(new Response(null, { status }), { json: async () => value });

let rowResponse: () => Promise<Response>;
let kpiResponse: () => Promise<Response>;
let requests: string[];
beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-unit-fixture-only';
    rowResponse = async () => json(rows);
    kpiResponse = async () => json(metrics);
    requests = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input), origin);
        if (url.origin !== origin) throw new Error('UNEXPECTED_SYNTHETIC_ORIGIN');
        requests.push(url.pathname);
        if (url.pathname === '/rest/v1/restaurants') return rowResponse();
        if (url.pathname === '/api/home/youtube-kpi') return kpiResponse();
        throw new Error('UNEXPECTED_SYNTHETIC_ENDPOINT');
    }) as typeof fetch;
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
});

describe('initial latest-query calibration phases', () => {
    test('records actual await boundaries without publishing cards before KPI sorting', async () => {
        const rowGate = deferred<Response>();
        const kpiGate = deferred<Response>();
        const kpiStarted = deferred<void>();
        rowResponse = () => rowGate.promise;
        kpiResponse = () => { kpiStarted.resolve(); return kpiGate.promise; };
        const phases: PaintCalibrationLatestQueryPhase[] = [];
        const before = JSON.stringify(rows);
        let settled = false;
        const pending = fetchLatestRestaurantPage({ ...queryArgs,
            onCalibrationPhase: (phase) => { phases.push(phase); },
        }).then((result) => { settled = true; return result; });
        try {
            expect(phases).toEqual(['latestQueryStarted']);
            expect(settled).toBe(false);
            rowGate.resolve(json(rows));
            await kpiStarted.promise;
            expect(phases).toEqual(['latestQueryStarted', 'latestRestaurantRowsReady', 'latestKpiStarted']);
            expect(settled).toBe(false);
            kpiGate.resolve(json(metrics));
            const result = await pending;
            expect(phases).toEqual(['latestQueryStarted', 'latestRestaurantRowsReady',
                'latestKpiStarted', 'latestKpiReady', 'latestSortReady']);
            expect(result.restaurants.map((row) => row.id)).toEqual(['second', 'first']);
            expect(result.nextOffset).toBe(2);
            expect(result.hasMore).toBe(true);
            expect(JSON.stringify(rows)).toBe(before);
            expect(requests).toEqual(['/rest/v1/restaurants', '/api/home/youtube-kpi']);
        } finally {
            rowGate.resolve(json(rows)); kpiGate.resolve(json(metrics));
            await pending;
        }
    });

    test('ordinary and diagnostic visits return identical data and make the same reads', async () => {
        const ordinary = await fetchLatestRestaurantPage(queryArgs);
        const ordinaryRequests = [...requests];
        requests = [];
        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
            value: { __tzudongPaintCalibration: {
                mark: () => { throw new Error('synthetic collector failure'); },
                claimInitialLatestQuery: () => true,
            } },
        });
        const onCalibrationPhase = createPaintCalibrationInitialLatestQueryMarker() ?? undefined;
        expect(onCalibrationPhase).toBeDefined();
        const diagnostic = await fetchLatestRestaurantPage({ ...queryArgs, onCalibrationPhase });
        expect(diagnostic).toEqual(ordinary);
        expect(requests).toEqual(ordinaryRequests);
    });

    test('a failed REST read cannot fabricate rows, enrichment or sort readiness', async () => {
        rowResponse = async () => json(null, 403);
        const phases: PaintCalibrationLatestQueryPhase[] = [];
        await expect(fetchLatestRestaurantPage({ ...queryArgs,
            onCalibrationPhase: (phase) => { phases.push(phase); },
        })).rejects.toThrow('supabase_rest_rows_failed:403');
        expect(phases).toEqual(['latestQueryStarted']);
        expect(requests).toEqual(['/rest/v1/restaurants']);
    });

    test('KPI ready retains its existing fallback meaning rather than asserting KPI success', async () => {
        kpiResponse = async () => json(null, 403);
        const phases: PaintCalibrationLatestQueryPhase[] = [];
        const result = await fetchLatestRestaurantPage({ ...queryArgs,
            onCalibrationPhase: (phase) => { phases.push(phase); },
        });
        expect(result.restaurants.map((row) => row.id)).toEqual(['first', 'second']);
        expect(phases).toEqual(['latestQueryStarted', 'latestRestaurantRowsReady',
            'latestKpiStarted', 'latestKpiReady', 'latestSortReady']);
    });
});
