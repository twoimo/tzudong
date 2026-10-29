import { describe, expect, mock, test } from 'bun:test';
import type { NextRequest } from 'next/server';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const YOUTUBE_API_KEY = 'youtube-test-key';

function buildRequest(origin: string) {
    return new Request('http://localhost/api/youtube-meta', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: origin,
            'Sec-Fetch-Site': origin === 'http://localhost' ? 'same-origin' : 'cross-site',
        },
        body: JSON.stringify({ youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    }) as unknown as NextRequest;
}

function youtubeResponse(description: string) {
    return new Response(JSON.stringify({
        items: [{
            snippet: {
                title: 'Test video',
                publishedAt: '2026-07-13T00:00:00.000Z',
                description,
            },
            contentDetails: { duration: 'PT1M' },
        }],
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function requestUrl(input: RequestInfo | URL) {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.toString();
    return input;
}

async function loadRoute() {
    return import(`../app/api/youtube-meta/route.ts?cache=${Math.random()}`);
}

function setProviderKeys() {
    const previousYoutubeApiKey = process.env.YOUTUBE_API_KEY;
    const previousOpenaiApiKey = process.env.OPENAI_API_KEY;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.YOUTUBE_API_KEY = YOUTUBE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.NODE_ENV = 'test';
    delete process.env.NEXT_PUBLIC_SITE_URL;

    return () => {
        if (previousYoutubeApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
        else process.env.YOUTUBE_API_KEY = previousYoutubeApiKey;
        if (previousOpenaiApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousOpenaiApiKey;
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
        else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
    };
}

describe('youtube metadata provider security', () => {
    test('metadata retrieval failure never becomes a successful no-ad result', async () => {
        const restoreProviderKeys = setProviderKeys();
        const originalFetch = globalThis.fetch;
        let calls = 0;
        mock.module('@/lib/auth/require-admin', () => ({
            requireAdmin: async () => ({ ok: true, userId: ADMIN_USER_ID }),
        }));
        mock.module('@/lib/security/admin-provider-budget', () => ({
            reserveAdminProviderBudget: async () => ({ allowed: true, retryAfterSeconds: 0 }),
        }));
        globalThis.fetch = (async () => {
            calls++;
            return new Response('private provider diagnostic', { status: 503 });
        }) as typeof fetch;
        try {
            const route = await loadRoute();
            const response = await route.POST(buildRequest('http://localhost'));
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ error: 'Failed to fetch YouTube metadata' });
            expect(calls).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
            restoreProviderKeys();
            mock.restore();
        }
    });

    test('rejects a cross-site mutation before request parsing, budget reservation, or provider egress', async () => {
        let budgetCalls = 0;
        let providerCalls = 0;
        const originalFetch = globalThis.fetch;
        mock.module('@/lib/auth/require-admin', () => ({
            requireAdmin: async () => ({ ok: true, userId: ADMIN_USER_ID }),
        }));
        mock.module('@/lib/security/admin-provider-budget', () => ({
            reserveAdminProviderBudget: async () => {
                budgetCalls += 1;
                throw new Error('budget must not run for cross-site requests');
            },
        }));
        globalThis.fetch = (async () => {
            providerCalls += 1;
            throw new Error('provider must not run for cross-site requests');
        }) as typeof fetch;

        try {
            const route = await loadRoute();
            const response = await route.POST(buildRequest('https://attacker.example'));

            expect(response.status).toBe(403);
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(await response.json()).toEqual({ error: 'Forbidden' });
            expect(budgetCalls).toBe(0);
            expect(providerCalls).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
            mock.restore();
        }
    });

    test('extracts full descriptions offline with only the YouTube budget and no OpenAI key', async () => {
        const restoreProviderKeys = setProviderKeys();
        const originalFetch = globalThis.fetch;
        const budgets: string[] = [];
        const urls: string[] = [];
        let description = '';
        mock.module('@/lib/auth/require-admin', () => ({
            requireAdmin: async () => ({ ok: true, userId: ADMIN_USER_ID }),
        }));
        mock.module('@/lib/security/admin-provider-budget', () => ({
            reserveAdminProviderBudget: async ({ provider }: { provider: string }) => {
                budgets.push(provider);
                if (provider !== 'youtube_metadata') throw new Error('Unexpected sponsor provider budget');
                return { allowed: true, retryAfterSeconds: 0 };
            },
        }));
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = requestUrl(input);
            urls.push(url);
            if (!url.startsWith('https://www.googleapis.com/youtube/v3/videos')) throw new Error('Unexpected egress');
            return youtubeResponse(description);
        }) as typeof fetch;
        try {
            const route = await loadRoute();
            const scenarios = [
                { text: '이야기\n'.repeat(1700) + '본 영상은 ＡＣＭＥ 및 Beta의 유료광고를 포함합니다.', isAds: true, names: ['ＡＣＭＥ', 'Beta'], outcome: 'detected' },
                { text: '본 영상은 광고가 아닙니다.', isAds: false, names: null, outcome: 'confirmed_none' },
                { text: '광고 문의 https://example.invalid', isAds: null, names: null, outcome: 'unknown' },
                { text: '"This video is sponsored by ACME."', isAds: null, names: null, outcome: 'unknown' },
            ];
            for (const scenario of scenarios) {
                description = scenario.text;
                const response = await route.POST(buildRequest('http://localhost'));
                const payload = await response.json();
                expect(response.status).toBe(200);
                expect(response.headers.get('Cache-Control')).toBe('no-store');
                expect(payload.title).toBe('Test video');
                expect(payload.ads_info.is_ads).toBe(scenario.isAds);
                expect(payload.ads_info.what_ads).toEqual(scenario.names);
                expect(payload.ads_info.sponsor_analysis.outcome).toBe(scenario.outcome);
                expect(payload.ads_info.sponsor_analysis.status).toBe(scenario.outcome === 'unknown' ? 'unknown' : 'completed');
                expect(payload.ads_info.sponsor_analysis.source).toBe('description_rules');
                expect(payload.ads_info.sponsor_analysis.version).toBe('first-party-disclosure-v1');
                expect(payload.ads_info.sponsor_analysis.source_sha256).toMatch(/^[a-f0-9]{64}$/);
            }
            expect(budgets).toEqual(scenarios.map(() => 'youtube_metadata'));
            expect(urls.length).toBe(scenarios.length);
        } finally {
            globalThis.fetch = originalFetch;
            restoreProviderKeys();
            mock.restore();
        }
    });
});
