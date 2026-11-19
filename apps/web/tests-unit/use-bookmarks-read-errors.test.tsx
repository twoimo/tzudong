import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as react from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as reactQuery from '@tanstack/react-query';
import ts from 'typescript';
import * as visitMatching from '../lib/restaurant-visit-matching';
import * as reviewLookup from '../lib/restaurant-review-lookup';

type BookmarkHooks = typeof import('../hooks/use-bookmarks');
type Call = { table: string; op: 'select' | 'delete' | 'insert'; filters: Array<[string, string, unknown]> };
type Result = { data?: unknown; error?: unknown; count?: number };

const USER_ID = 'user-fixture';
const canonical = {
    id: 'restaurant-canonical', approved_name: '합성 식당', road_address: '서울특별시 중구 합성로 1',
    jibun_address: null, categories: ['한식'], youtube_link: null, review_count: 0, lat: 37.5, lng: 127, status: 'approved',
};
const duplicate = { ...canonical, id: 'restaurant-duplicate', status: 'pending' };
const providerFailure = { data: null, error: { message: 'provider detail' } };

const compiled = ts.transpileModule(
    readFileSync(join(import.meta.dir, '../hooks/use-bookmarks.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
).outputText;

function fixture(respond: (call: Call) => Result) {
    const calls: Call[] = [];
    const supabase = {
        from(table: string) {
            const call: Call = { table, op: 'select', filters: [] };
            calls.push(call);
            const builder = {
                select: () => builder,
                maybeSingle: () => builder,
                delete() { call.op = 'delete'; return builder; },
                insert() { call.op = 'insert'; return builder; },
                eq(column: string, value: unknown) { call.filters.push(['eq', column, value]); return builder; },
                in(column: string, values: unknown) { call.filters.push(['in', column, values]); return builder; },
                then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
                    Promise.resolve({ data: null, error: null, ...respond(call) }).then(resolve, reject),
            };
            return builder;
        },
    };
    const toasts: unknown[] = [];
    const modules: Record<string, unknown> = {
        react,
        '@/hooks/use-toast': { toast: (options: unknown) => { toasts.push(options); } },
        '@tanstack/react-query': reactQuery,
        '@/integrations/supabase/client': { supabase },
        '@/contexts/AuthContext': { useAuth: () => ({ user: { id: USER_ID } }) },
        '@/lib/restaurant-visit-matching': visitMatching,
        '@/lib/restaurant-review-lookup': reviewLookup,
    };
    const hooks = {} as BookmarkHooks;
    new Function('exports', 'require', compiled)(hooks, (name: string) => {
        if (!(name in modules)) throw new Error(`UNEXPECTED_HOOK_IMPORT:${name}`);
        return modules[name];
    });
    const client = new reactQuery.QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function render<T>(useHook: () => T): T {
        let value!: T;
        function Probe() { value = useHook(); return null; }
        renderToStaticMarkup(<reactQuery.QueryClientProvider client={client}><Probe /></reactQuery.QueryClientProvider>);
        return value;
    }
    function fetchRegistered(queryKey: unknown[]) {
        const query = client.getQueryCache().find({ queryKey });
        if (!query) throw new Error('PRODUCTION_QUERY_MISSING');
        return client.fetchQuery(query.options);
    }
    return { hooks, client, calls, toasts, render, fetchRegistered };
}

const has = (call: Call, op: string, column: string) => call.filters.some(([kind, name]) => kind === op && name === column);
const relatedLookup = (failing: 'row' | 'related' | null) => (call: Call): Result => {
    if (call.table !== 'restaurants') return {};
    if (has(call, 'eq', 'id')) return failing === 'row' ? providerFailure : { data: canonical };
    return failing === 'related' ? providerFailure : { data: [canonical, duplicate] };
};
const bookmarkCalls = (calls: Call[]) => calls.filter((call) => call.table === 'user_bookmarks');

describe('bookmark reads that resolve merged duplicate restaurants', () => {
    test('removal deletes every merged duplicate bookmark once the related rows are known', async () => {
        const f = fixture(relatedLookup(null));
        const { toggleBookmark } = f.render(() => f.hooks.useToggleBookmark());

        await toggleBookmark(canonical.id, true);

        const [deletion] = bookmarkCalls(f.calls);
        expect(deletion.op).toBe('delete');
        expect(deletion.filters).toContainEqual(['eq', 'user_id', USER_ID]);
        const deleted = deletion.filters.find(([kind, column]) => kind === 'in' && column === 'restaurant_id')?.[2] as string[];
        expect([...deleted].sort()).toEqual([canonical.id, duplicate.id].sort());
    });

    for (const failing of ['row', 'related'] as const) {
        test(`removal fails and restores the bookmark when the ${failing} lookup fails`, async () => {
            const f = fixture(relatedLookup(failing));
            f.client.setQueryData(['bookmark-ids', USER_ID], [canonical.id]);
            const { toggleBookmark } = f.render(() => f.hooks.useToggleBookmark());

            await toggleBookmark(canonical.id, true);

            expect(f.toasts).toHaveLength(1);
            expect(bookmarkCalls(f.calls)).toEqual([]);
            expect(f.client.getQueryData(['bookmark-ids', USER_ID])).toEqual([canonical.id]);
        });
    }

    for (const [action, isBookmarked, op, title] of [
        ['removal', true, 'delete', '북마크를 해제하지 못했습니다'],
        ['addition', false, 'insert', '북마크를 저장하지 못했습니다'],
    ] as const) {
        test(`a failed ${action} shows one error toast and leaves no unhandled rejection`, async () => {
            const f = fixture((call) => call.op === op ? providerFailure : relatedLookup(null)(call));
            f.client.setQueryData(['bookmark-ids', USER_ID], isBookmarked ? [canonical.id] : []);
            const { toggleBookmark } = f.render(() => f.hooks.useToggleBookmark());
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
            process.on('unhandledRejection', onUnhandled);
            try {
                toggleBookmark(canonical.id, isBookmarked);
                while (f.client.isMutating() > 0 || bookmarkCalls(f.calls).length === 0) await Bun.sleep(1);
                await Bun.sleep(10);
            } finally {
                process.off('unhandledRejection', onUnhandled);
            }

            expect(unhandled).toEqual([]);
            expect(f.toasts).toEqual([{ title, description: '잠시 후 다시 시도해 주세요.', variant: 'destructive' }]);
            expect(f.client.getQueryData(['bookmark-ids', USER_ID])).toEqual(isBookmarked ? [canonical.id] : []);
        });
    }

    test('count includes merged duplicates and fails instead of undercounting when the lookup fails', async () => {
        const ok = fixture((call) => call.table === 'user_bookmarks' ? { count: 2 } : relatedLookup(null)(call));
        ok.render(() => ok.hooks.useBookmarkCount(canonical.id));
        expect(await ok.fetchRegistered(['bookmark-count', canonical.id])).toBe(2);

        const failed = fixture(relatedLookup('related'));
        failed.render(() => failed.hooks.useBookmarkCount(canonical.id));
        await expect(failed.fetchRegistered(['bookmark-count', canonical.id])).rejects.toThrow('BOOKMARK_RESTAURANTS_UNAVAILABLE');
        expect(bookmarkCalls(failed.calls)).toEqual([]);
    });

    const bookmarkIdReads = (restaurantsById: Result) => (call: Call): Result => {
        if (call.table === 'user_bookmarks') return { data: [{ restaurant_id: duplicate.id }] };
        if (has(call, 'in', 'id')) return restaurantsById;
        return { data: [canonical] };
    };

    test('bookmark ids mark the canonical restaurant of a bookmarked duplicate', async () => {
        const f = fixture(bookmarkIdReads({ data: [duplicate] }));
        f.render(() => f.hooks.useBookmarkIds());
        const ids = await f.fetchRegistered(['bookmark-ids', USER_ID]) as string[];
        expect([...ids].sort()).toEqual([canonical.id, duplicate.id].sort());
    });

    test('bookmark ids fail instead of caching a list without canonical restaurants', async () => {
        const f = fixture(bookmarkIdReads(providerFailure));
        f.render(() => f.hooks.useBookmarkIds());
        await expect(f.fetchRegistered(['bookmark-ids', USER_ID])).rejects.toThrow('BOOKMARK_RESTAURANTS_UNAVAILABLE');
    });
});
