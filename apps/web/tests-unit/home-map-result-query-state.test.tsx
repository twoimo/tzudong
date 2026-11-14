import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    QueryClient, QueryClientProvider, QueryObserver, useQueryClient,
    type QueryObserverOptions,
} from '@tanstack/react-query';
import { QueryProvider } from '../app/providers';
import { useHomeMapResults } from '../hooks/use-home-map-results';
import * as queryHelpers from '../lib/map-query-helpers';
import * as summaryHelpers from '../lib/home-map-result-summary';
import * as initialLoadMilestones from '../lib/performance/initial-load-milestones';
import type { Restaurant } from '../types/restaurant';

type Input = Parameters<typeof useHomeMapResults>[0];
type Options = QueryObserverOptions<Restaurant[]>;
const input = (category?: string): Input => ({
    mapMode: 'domestic', selectedRegion: null, selectedCountry: null,
    filters: { categories: category ? [category] : [], minRating: 0, minReviews: 0, minUserVisits: 0, minJjyangVisits: 0 },
});
const row = (id: string, category: string) => ({
    id, name: `합성 ${id}`, approved_name: `합성 ${id}`, status: 'approved',
    lat: 37.5, lng: 127, road_address: `서울특별시 중구 ${id}`, categories: [category], review_count: 0,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}
const json = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), { status });
const originalFetch = globalThis.fetch;
const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const cleanup: Array<() => void> = [];
let responses: Map<string, () => Promise<Response>>;

beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://map-query-state-test.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'unit-fixture-only';
    responses = new Map([['all', async () => json([row('old', '한식')])]]);
    // Only the HTTP transport is synthetic: production pagination/queryFn still runs.
    globalThis.fetch = (async (request: RequestInfo | URL) => {
        const url = new URL(String(request));
        if (url.origin !== 'https://map-query-state-test.invalid' || url.pathname !== '/rest/v1/restaurants') {
            throw new Error('UNEXPECTED_TEST_ENDPOINT');
        }
        if (Number(url.searchParams.get('offset')) > 0) return json([]);
        const category = url.searchParams.get('categories')?.match(/^ov\.\{"(.+)"\}$/)?.[1] ?? 'all';
        const response = responses.get(category);
        if (!response) throw new Error('UNEXPECTED_TEST_FILTER');
        return response();
    }) as typeof fetch;
});

afterEach(() => {
    cleanup.splice(0).reverse().forEach((close) => close());
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
});

async function fixture() {
    let client!: QueryClient;
    function CaptureClient() { client = useQueryClient(); return null; }
    renderToStaticMarkup(<QueryProvider><CaptureClient /></QueryProvider>);
    // Keep the real shared defaults, including previous-data placeholders/retry count.
    // Only remove the retry delay and GC timer from this deterministic test.
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0, gcTime: Infinity } });
    cleanup.push(() => client.clear());
    const optionsByInput = new Map<string, Options>();
    function optionsFor(props: Input): Options {
        const key = JSON.stringify(props);
        const existing = optionsByInput.get(key);
        if (existing) return existing;
        const before = new Set(client.getQueryCache().getAll());
        function Probe() { useHomeMapResults(props); return null; }
        // Obtain actual useRestaurants queryKey/queryFn/options through the real hook.
        renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
        const query = client.getQueryCache().getAll().find((candidate) => !before.has(candidate));
        if (!query) throw new Error('PRODUCTION_MAP_QUERY_MISSING');
        const options = query.options as Options;
        optionsByInput.set(key, options);
        return options;
    }
    const initial = optionsFor(input());
    await client.fetchQuery(initial);
    const observer = new QueryObserver<Restaurant[]>(client, initial);
    cleanup.push(observer.subscribe(() => {}));

    // SSR cannot retain a mounted React observer across renders. Execute the unchanged
    // production summary hook with that lifecycle bridged to a persistent real observer.
    // No query flags, query options, queryFn, or summary implementation are fabricated.
    const source = readFileSync(new URL('../hooks/use-home-map-results.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {} as { useHomeMapResults: typeof useHomeMapResults };
    vm.runInNewContext(compiled, { exports, require(name: string) {
        if (name === 'react') return { useMemo: (calculate: () => unknown) => calculate(), useEffect() {} };
        if (name === '@/hooks/use-restaurants') return { useRestaurants: () => observer.getCurrentResult() };
        if (name === '@/lib/map-query-helpers') return queryHelpers;
        if (name === '@/lib/home-map-result-summary') return summaryHelpers;
        if (name === '@/lib/performance/initial-load-milestones') return initialLoadMilestones;
        throw new Error('UNEXPECTED_HOOK_IMPORT');
    } });
    let selected = input();
    return {
        client, observer,
        select(props: Input) { selected = props; observer.setOptions(optionsFor(props)); },
        read: () => exports.useHomeMapResults(selected),
        settled: (props: Input) => client.getQueryCache().find({ queryKey: optionsFor(props).queryKey })!.promise,
    };
}

function expectUnpublished(result: ReturnType<typeof useHomeMapResults>, status: 'pending' | 'error') {
    expect(result.status).toBe(status);
    expect(result.isPending).toBe(status === 'pending');
    expect(result.isLoading).toBe(status === 'pending' && result.isFetching);
    expect(result.isSuccess).toBe(false);
    expect(result.summary.status).toBe(status);
    expect(result.summary.count).toBeNull();
    expect(result.summary.restaurants).toEqual([]);
    expect(result.summary.categoryCounts).toEqual({});
    expect(result.summary.regionCounts).toEqual({});
    expect(result.data).toBeUndefined(); // Map renderers cannot receive old membership.
}

describe('shared map query state under actual provider defaults', () => {
    test('an old-filter placeholder is pending and unpublished until the complete new result arrives', async () => {
        const gate = deferred<Response>();
        responses.set('중식', () => gate.promise);
        const f = await fixture();
        f.select(input('중식'));
        expect(f.observer.getCurrentResult().isPlaceholderData).toBe(true);
        expect(f.observer.getCurrentResult().isPending).toBe(false);
        expectUnpublished(f.read(), 'pending');
        gate.resolve(json([row('new', '중식')]));
        await f.settled(input('중식'));
        expect(f.read().summary.status).toBe('ready');
        expect(f.read().summary.count).toBe(1);
        expect(f.read().data?.map((restaurant) => restaurant.id)).toEqual(['new']);
        const placeholder = f.client.getDefaultOptions().queries?.placeholderData;
        expect(typeof placeholder).toBe('function');
    });

    test('fast switches and late older success preserve the last selection, including a cached return', async () => {
        const older = deferred<Response>();
        const latest = deferred<Response>();
        responses.set('중식', () => older.promise);
        responses.set('일식', () => latest.promise);
        const f = await fixture();
        f.select(input('중식'));
        expectUnpublished(f.read(), 'pending');
        f.select(input('일식'));
        expectUnpublished(f.read(), 'pending');
        latest.resolve(json([row('latest', '일식')]));
        await f.settled(input('일식'));
        older.resolve(json([row('late-old', '중식')]));
        await f.settled(input('중식'));
        expect(f.read().data?.map((restaurant) => restaurant.id)).toEqual(['latest']);
        f.select(input());
        expect(f.read().summary.status).toBe('ready');
        expect(f.read().data?.map((restaurant) => restaurant.id)).toEqual(['old']);
    });

    test('a completed empty response is ready zero, never pending or an error', async () => {
        const gate = deferred<Response>();
        responses.set('중식', () => gate.promise);
        const f = await fixture();
        f.select(input('중식'));
        expectUnpublished(f.read(), 'pending');
        gate.resolve(json([]));
        await f.settled(input('중식'));
        expect(f.read().summary.status).toBe('ready');
        expect(f.read().summary.count).toBe(0);
        expect(f.read().data).toEqual([]);
    });

    test('current failure remains an error after a late older success and can explicitly recover', async () => {
        const older = deferred<Response>();
        responses.set('중식', () => older.promise);
        responses.set('일식', async () => json({}, 503));
        const f = await fixture();
        f.select(input('중식'));
        f.select(input('일식'));
        await f.settled(input('일식'))?.catch(() => {});
        expectUnpublished(f.read(), 'error');
        older.resolve(json([row('late-old', '중식')]));
        await f.settled(input('중식'));
        expectUnpublished(f.read(), 'error');
        responses.set('일식', async () => json([]));
        await f.observer.refetch();
        expect(f.read().summary.status).toBe('ready');
        expect(f.read().summary.count).toBe(0);
    });

    test('a same-filter background refetch keeps current complete membership ready', async () => {
        const f = await fixture();
        const gate = deferred<Response>();
        responses.set('all', () => gate.promise);
        const pending = f.observer.refetch();
        expect(f.observer.getCurrentResult().isFetching).toBe(true);
        expect(f.observer.getCurrentResult().isPlaceholderData).toBe(false);
        expect(f.read().summary.status).toBe('ready');
        expect(f.read().summary.count).toBe(1);
        gate.resolve(json([]));
        await pending;
        expect(f.read().summary.count).toBe(0);
    });
});
