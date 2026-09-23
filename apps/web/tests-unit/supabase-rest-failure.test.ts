import { afterEach, describe, expect, test } from 'bun:test';

import {
    fetchSupabaseExactCount,
    fetchSupabaseRows,
    supabaseRestFailureCode,
    supabaseRestRpcClient,
} from '../lib/supabase-rest-client';

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function restoreEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = value;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('NEXT_PUBLIC_SUPABASE_URL', originalUrl);
    restoreEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', originalKey);
});

describe('supabaseRestFailureCode', () => {
    test('keeps http status codes and collapses invalid status to 0', () => {
        expect(supabaseRestFailureCode('rows', 500)).toBe('supabase_rest_rows_failed:500');
        expect(supabaseRestFailureCode('count', 404)).toBe('supabase_rest_count_failed:404');
        expect(supabaseRestFailureCode('rows', 99)).toBe('supabase_rest_rows_failed:0');
        expect(supabaseRestFailureCode('rows', 600)).toBe('supabase_rest_rows_failed:0');
        expect(supabaseRestFailureCode('rows', 200.5)).toBe('supabase_rest_rows_failed:0');
        expect(supabaseRestFailureCode('count', Number.NaN)).toBe('supabase_rest_count_failed:0');
    });
});

describe('supabase rest failure boundaries', () => {
    test('rejects missing or blank credentials before calling fetch', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return new Response('[]', { status: 200 });
        }) as typeof fetch;

        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        await expect(fetchSupabaseRows('restaurants', [])).rejects.toThrow('supabase_rest_config_missing');

        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '   ';
        await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toThrow('supabase_rest_config_missing');
        await expect(supabaseRestRpcClient.rpc('match_rows', {})).rejects.toThrow('supabase_rest_config_missing');
        expect(calls).toBe(0);
    });

    test('returns rows for a successful payload and an empty list', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        globalThis.fetch = (async () => new Response('[]', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;

        await expect(fetchSupabaseRows('restaurants', [['select', 'id']])).resolves.toEqual([]);
    });

    test('hides provider body text when a row query fails', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        globalThis.fetch = (async () => new Response('secret-schema-detail permission denied for table restaurants', {
            status: 500,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;

        await expect(fetchSupabaseRows('restaurants', [])).rejects.toThrow('supabase_rest_rows_failed:500');
        try {
            await fetchSupabaseRows('restaurants', []);
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).not.toContain('secret-schema-detail');
            expect((error as Error).message).not.toContain('permission denied');
        }
    });

    test('uses an empty fallback for restricted public announcement reads', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        globalThis.fetch = (async () => new Response('raw-auth-error', { status: 401 })) as typeof fetch;

        await expect(fetchSupabaseRows('announcements', [])).resolves.toEqual([]);
        globalThis.fetch = (async () => new Response('raw-auth-error', { status: 403 })) as typeof fetch;
        await expect(fetchSupabaseRows('ad_banners', [])).resolves.toEqual([]);
        globalThis.fetch = (async () => new Response('raw-auth-error', { status: 401 })) as typeof fetch;
        await expect(fetchSupabaseRows('restaurants', [])).rejects.toThrow('supabase_rest_rows_failed:401');
    });

    test('reads an exact count and fails closed without a content range', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        globalThis.fetch = (async () => new Response(null, {
            status: 200,
            headers: { 'content-range': '0-0/12' },
        })) as typeof fetch;
        await expect(fetchSupabaseExactCount('restaurants', [])).resolves.toBe(12);

        globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
        await expect(fetchSupabaseExactCount('restaurants', [])).rejects.toThrow('supabase_rest_count_missing');

        globalThis.fetch = (async () => new Response('count-secret', { status: 503 })) as typeof fetch;
        try {
            await fetchSupabaseExactCount('restaurants', []);
        } catch (error) {
            expect((error as Error).message).toBe('supabase_rest_count_failed:503');
            expect((error as Error).message).not.toContain('count-secret');
        }
    });

    test('returns a status-only rpc failure and encodes unsafe function names', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
        const calls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(String(input));
            return new Response('rpc-secret', { status: 403 });
        }) as typeof fetch;

        await expect(supabaseRestRpcClient.rpc('../secrets', { q: 'unused' })).resolves.toEqual({
            data: null,
            error: { status: 403 },
        });
        expect(calls[0]).toContain(encodeURIComponent('../secrets'));
        expect(calls[0]).not.toContain('/rpc/../');

        globalThis.fetch = (async () => new Response('not-json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
        await expect(supabaseRestRpcClient.rpc('match_rows', {})).resolves.toEqual({
            data: null,
            error: null,
        });
    });
});
