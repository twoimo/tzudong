import { describe, expect, test } from 'bun:test';
import { answerAdminInsightChat, streamAdminInsightChat } from '@/lib/insight/chat';

describe('admin insight chat system-status hints', () => {
    test('adds LLM key readiness hint to fallback meta', async () => {
        const response = await answerAdminInsightChat('최근 트렌드 추천해줘', {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: '',
        });

        expect(response.meta?.fallbackReason).toBe('llm_unavailable');
        expect(response.meta?.systemStatusHints).toContain('LLM 키 없음: openai');
        expect(response.meta?.toolTrace ?? []).toContain('dependency:llm-key-unavailable:openai');
    });

    test('adds system-status hints on stream fallback when provider key is unavailable', async () => {
        const result = await streamAdminInsightChat(
            '요약해줘',
            {
                provider: 'gemini',
                model: 'gemini-3-flash-preview',
                apiKey: '',
            },
            undefined,
            'stream-hint',
            'fast',
        );

        expect('local' in result).toBe(true);
        const meta = result.local?.meta;
        expect(meta?.fallbackReason).toBe('llm_unavailable');
        expect(meta?.systemStatusHints).toContain('LLM 키 없음: gemini');
        expect(meta?.toolTrace ?? []).toContain('dependency:llm-key-unavailable:gemini');
    });

    test('returns dependency hints for operator onboarding commands', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('', { status: 204 });

        const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
        const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
        const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
        const prevStoryboardBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
        const prevStoryboardBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
        const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const prevNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
        const prevNanoBananaKey = process.env.NANO_BANANA_API_KEY;
        const prevNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
        const prevStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;

        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
        process.env.STORYBOARD_AGENT_ENABLED = 'true';
        process.env.STORYBOARD_AGENT_API_URL = '';
        process.env.STORYBOARD_BGE_ENABLED = 'true';
        process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';
        process.env.NANO_BANANA_2_API_KEY = '';
        process.env.NANO_BANANA_API_KEY = '';
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';

        try {
            const response = await answerAdminInsightChat('/operator-todo');

            expect(response.meta?.source).toBe('local');
            expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
            expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
            expect(response.content).toContain('## 운영자 TODO');
        } finally {
            global.fetch = originalFetch;
            if (prevCacheTtl === undefined) {
                delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
            } else {
                process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
            }
            if (prevStoryboardEnabled === undefined) {
                delete process.env.STORYBOARD_AGENT_ENABLED;
            } else {
                process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
            }
            if (prevStoryboardApiUrl === undefined) {
                delete process.env.STORYBOARD_AGENT_API_URL;
            } else {
                process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
            }
            if (prevStoryboardBgeEnabled === undefined) {
                delete process.env.STORYBOARD_BGE_ENABLED;
            } else {
                process.env.STORYBOARD_BGE_ENABLED = prevStoryboardBgeEnabled;
            }
            if (prevStoryboardBgeUrl === undefined) {
                delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
            } else {
                process.env.STORYBOARD_BGE_EMBEDDING_URL = prevStoryboardBgeUrl;
            }
            if (prevSupabaseUrl === undefined) {
                delete process.env.NEXT_PUBLIC_SUPABASE_URL;
            } else {
                process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
            }
            if (prevSupabaseRoleKey === undefined) {
                delete process.env.SUPABASE_SERVICE_ROLE_KEY;
            } else {
                process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
            }
            if (prevNanoBanana2Key === undefined) {
                delete process.env.NANO_BANANA_2_API_KEY;
            } else {
                process.env.NANO_BANANA_2_API_KEY = prevNanoBanana2Key;
            }
            if (prevNanoBananaKey === undefined) {
                delete process.env.NANO_BANANA_API_KEY;
            } else {
                process.env.NANO_BANANA_API_KEY = prevNanoBananaKey;
            }
            if (prevNanoBananaAgentKey === undefined) {
                delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
            } else {
                process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = prevNanoBananaAgentKey;
            }
            if (prevStoryboardImageAgentKey === undefined) {
                delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
            } else {
                process.env.STORYBOARD_AGENT_IMAGE_API_KEY = prevStoryboardImageAgentKey;
            }
        }
    });

    test('normalizes /ops-todo operator alias and keeps secret-like values out of meta', async () => {
        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);
            if (endpoint.includes('/health')) {
                return new Response('', { status: 204 });
            }
            if (endpoint.includes('embeddings')) {
                return new Response('', { status: 200 });
            }
            return new Response('', { status: 500 });
        };

        const prevCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
        const prevStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
        const prevStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
        const prevStoryboardBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
        const prevStoryboardBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
        const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const prevSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
        process.env.STORYBOARD_AGENT_ENABLED = 'true';
        process.env.STORYBOARD_AGENT_API_URL = 'https://ops-user:ops-token@storyboard.internal/api/v1?x=1&token=ops-secret';
        process.env.STORYBOARD_BGE_ENABLED = 'true';
        process.env.STORYBOARD_BGE_EMBEDDING_URL = 'https://bge-user:bge-token@bge.internal/v1/embeddings?secret=bge-secret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';

        try {
            const response = await answerAdminInsightChat('/OPs-todo  상태 다시 확인');

            expect(response.meta?.source).toBe('local');
            expect(response.content).toContain('## 운영자 TODO');
            expect(response.meta?.systemStatusHints).toContain('Supabase: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
            expect(response.meta?.systemStatusHints).toContain('Nano Banana 2: NANO_BANANA_2_API_KEY 미설정');
            expect(JSON.stringify(response.meta)).not.toContain('ops-secret');
            expect(JSON.stringify(response.meta)).not.toContain('bge-secret');
            expect(response.meta?.toolTrace ?? []).toContain('local:operator-todo');
        } finally {
            global.fetch = originalFetch;
            if (prevCacheTtl === undefined) {
                delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
            } else {
                process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = prevCacheTtl;
            }
            if (prevStoryboardEnabled === undefined) {
                delete process.env.STORYBOARD_AGENT_ENABLED;
            } else {
                process.env.STORYBOARD_AGENT_ENABLED = prevStoryboardEnabled;
            }
            if (prevStoryboardApiUrl === undefined) {
                delete process.env.STORYBOARD_AGENT_API_URL;
            } else {
                process.env.STORYBOARD_AGENT_API_URL = prevStoryboardApiUrl;
            }
            if (prevStoryboardBgeEnabled === undefined) {
                delete process.env.STORYBOARD_BGE_ENABLED;
            } else {
                process.env.STORYBOARD_BGE_ENABLED = prevStoryboardBgeEnabled;
            }
            if (prevStoryboardBgeUrl === undefined) {
                delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
            } else {
                process.env.STORYBOARD_BGE_EMBEDDING_URL = prevStoryboardBgeUrl;
            }
            if (prevSupabaseUrl === undefined) {
                delete process.env.NEXT_PUBLIC_SUPABASE_URL;
            } else {
                process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
            }
            if (prevSupabaseRoleKey === undefined) {
                delete process.env.SUPABASE_SERVICE_ROLE_KEY;
            } else {
                process.env.SUPABASE_SERVICE_ROLE_KEY = prevSupabaseRoleKey;
            }
        }
    });
});
