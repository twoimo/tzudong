import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as helpers from '../lib/dashboard/helpers';

// Isolated module scopes keep route doubles out of other suites; no env or network.
const require = createRequire(import.meta.url);
const next = require('next/server') as typeof import('next/server');
const routes = [
    { path: 'summary', method: 'getDashboardSummary', code: 'DASHBOARD_SUMMARY_FAILED', message: 'Failed to build dashboard summary.' },
    { path: 'restaurants', method: 'getDashboardRestaurants', code: 'DASHBOARD_RESTAURANTS_FAILED', message: 'Failed to build dashboard restaurants.' },
    { path: 'video/[videoId]', method: 'getDashboardVideoDetail', code: 'DASHBOARD_VIDEO_FAILED', message: 'Failed to build dashboard video detail.' },
] as const;

function routeFixture(route: typeof routes[number], options: { failure?: unknown; result?: unknown } = {}) {
    const calls: unknown[][] = [];
    const logs: unknown[][] = [];
    const summary = { [route.method]: async (...args: unknown[]) => {
        calls.push(args);
        if ('failure' in options) throw options.failure;
        return 'result' in options ? options.result : { marker: 'fixture' };
    } };
    const source = readFileSync(resolve(import.meta.dir, `../app/api/dashboard/${route.path}/route.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports: { GET?: (request: Request, context: { params: Promise<{ videoId: string }> }) => Promise<Response> } = {};
    vm.runInNewContext(compiled, {
        exports, console: { error: (...args: unknown[]) => logs.push(args) },
        require: (name: string) => {
            if (name === 'next/server') return next;
            if (name === '@/lib/dashboard/summary') return summary;
            if (name === '@/lib/dashboard/helpers') return helpers;
            throw new Error('UNEXPECTED_TEST_DEPENDENCY');
        },
    });
    return { calls, logs, get: (videoId = 'abc123DEF45', query = '') => exports.GET!(
        new next.NextRequest(`https://fixture.invalid/api/dashboard/${route.path}${query}`),
        { params: Promise.resolve({ videoId }) },
    ) };
}

describe('dashboard route contracts', () => {
    for (const route of routes) {
        test(`${route.path} fixes responses and logs even for hostile error names`, async () => {
            const namedError = new Error('UNTRUSTED_FIXTURE');
            namedError.name = 'UNTRUSTED_FIXTURE'.repeat(512);
            const unreadableError = Object.defineProperty(new Error(), 'name', {
                get() { throw new Error('ERROR_NAME_MUST_NOT_BE_READ'); },
            });
            for (const failure of [namedError, unreadableError, 'UNTRUSTED_FIXTURE', null]) {
                const fixture = routeFixture(route, { failure });
                const response = await fixture.get();
                expect(response.status).toBe(500);
                expect(await response.json()).toEqual({ error: route.message });
                expect(fixture.logs).toEqual([[route.code]]);
                expect(fixture.calls).toHaveLength(1);
            }
        });
    }
    test('rejects missing and invalid IDs before loading any rows', async () => {
        for (const id of ['', '   ', 'short', '../path', '<script>', 'a'.repeat(129), 'a'.repeat(8192)]) {
            const fixture = routeFixture(routes[2]);
            const response = await fixture.get(id);
            const missing = id.trim().length === 0;
            expect(response.status).toBe(missing ? 400 : 404);
            expect(await response.json()).toEqual({ error: missing ? 'videoId is required.' : 'Video not found.' });
            expect(fixture.calls).toHaveLength(0);
            expect(fixture.logs).toEqual([]);
        }
    });
    test('serves allowed boundaries with a trimmed lookup key', async () => {
        for (const id of ['Ab_12-', 'a'.repeat(128)]) {
            const fixture = routeFixture(routes[2]);
            const response = await fixture.get(`  ${id}  `);
            expect(response.status).toBe(200);
            expect(fixture.calls).toEqual([[id]]);
            expect(await response.json()).toEqual({ marker: 'fixture' });
        }
    });
    test('retains the fixed 404 for an absent stored video', async () => {
        const fixture = routeFixture(routes[2], { result: null });
        const response = await fixture.get();
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Video not found.' });
    });
    test('retains summary freshness headers', async () => {
        const data = { freshness: { source: 'row-derived-cache', generatedAt: '2026-10-04T00:00:00.000Z',
            checksum: 'fixture-checksum', cacheStatus: 'hit', videoLimit: 2 } };
        const fixture = routeFixture(routes[0], { result: data });
        const response = await fixture.get();
        expect(response.status).toBe(200);
        expect(fixture.calls).toEqual([[false]]);
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=60, stale-while-revalidate=240');
        expect(response.headers.get('X-Dashboard-Summary-Checksum')).toBe('fixture-checksum');
        expect(response.headers.get('X-Dashboard-Summary-Video-Limit')).toBe('2');
        expect(await response.json()).toEqual(data);
    });
    test('retains restaurant filter and paging arguments', async () => {
        const fixture = routeFixture(routes[1]);
        const response = await fixture.get('', '?q=fixture&category=food&sourceType=fixture&status=approved&limit=5&offset=2&onlyWithCoordinates=false');
        expect(response.status).toBe(200);
        expect(fixture.calls).toEqual([[{ q: 'fixture', category: 'food', sourceType: 'fixture',
            status: 'approved', limit: 5, offset: 2, onlyWithCoordinates: false }]]);
    });
});
