import { describe, expect, test } from 'bun:test';
import { answerAdminInsightChat, normalizeFollowUpPromptsForQuery, streamAdminInsightChat } from '@/lib/insight/chat';

describe('admin insight chat follow-up prompt mapping', () => {
    test('returns prompt set for video keyword', () => {
        const prompts = normalizeFollowUpPromptsForQuery('최근 숏폼 조회 성과가 궁금해');

        expect(prompts).toHaveLength(3);
        expect(prompts[0].prompt).toBe('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
        expect(prompts[0].prompt).toBe('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
        expect(prompts[0].label).toBe('쯔양 숏폼 영상 확장');
    });

    test('returns combined prompts for multi-topic query', () => {
        const prompts = normalizeFollowUpPromptsForQuery('식당과 피크 구간, 그리고 숏폼 관련 인사이트를 보려면');
        const promptSet = new Set(prompts.map((item) => item.prompt));

        expect(promptSet.size).toBe(3);
        expect(promptSet).toContain('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
        expect(promptSet).toContain('/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘');
        expect(promptSet).toContain('/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘');
    });

    test('adds video-focused follow-up prompts on llm_unavailable fallback', async () => {
        const response = await answerAdminInsightChat('영상 조회가 잘 나온 최근 포맷의 특징을 정리해줘', {
            provider: 'gemini',
            model: 'gemini-test',
            apiKey: '',
        });

        expect(response.meta?.source).toBe('local');
        expect(response.meta?.fallbackReason).toBe('llm_unavailable');
        const prompts = response.followUpPrompts?.map((entry) => entry.prompt) ?? [];
        expect(prompts[0]).toBe('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
        expect(prompts).toContain('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
    });

    test('adds restaurant-focused follow-up prompts on llm_unavailable fallback', async () => {
        const response = await answerAdminInsightChat('레스토랑 성과가 잘 나오는 영상 운영 데이터를 분석해줘', {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: '',
        });

        expect(response.meta?.fallbackReason).toBe('llm_unavailable');
        const prompts = response.followUpPrompts?.map((entry) => entry.prompt) ?? [];
        expect(prompts).toContain('/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘');
    });

    test('stream fallback returns topic-aware follow-up prompts', async () => {
        const result = await streamAdminInsightChat(
            '조회 수치가 높은 영상의 공통점이 뭘까',
            {
                provider: 'anthropic',
                model: 'claude-opus-4-6',
                apiKey: '',
            },
        );

        expect('local' in result).toBe(true);
        const prompts = result.local?.followUpPrompts?.map((entry) => entry.prompt) ?? [];
        expect(result.local?.meta?.toolTrace).toContain('dependency:llm-key-unavailable:anthropic');
        expect(prompts).toContain('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
    });

    test('ranked follow-up prompts prioritize strongest intent match first', () => {
        const prompts = normalizeFollowUpPromptsForQuery('조회수가 잘 나온 숏폼 영상의 연출 보완점이 궁금해');

        expect(prompts.map((item) => item.prompt)).toEqual([
            '/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘',
            '/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘',
            '/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘',
        ]);
    });

    test('fallback coverage keeps up to MAX prompts even when single intent matches', () => {
        const prompts = normalizeFollowUpPromptsForQuery('숏폼 성과 요약');

        expect(prompts.map((item) => item.label)).toEqual([
            '쯔양 숏폼 영상 확장',
            '쯔양 레스토랑 디테일',
            '쯔양 피크 프레임 보강',
        ]);
        expect(prompts).toHaveLength(3);
    });

    test('empty query returns empty follow-up list', () => {
        expect(normalizeFollowUpPromptsForQuery('')).toEqual([]);
    });

    test('non-stream llm_unavailable fallback adds llm dependency trace', async () => {
        const response = await answerAdminInsightChat('영상 조회가 잘 나온 최근 포맷의 특징을 정리해줘', {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: '',
        });

        expect(response.meta?.toolTrace).toContain('dependency:llm-key-unavailable:openai');
        expect(response.meta?.toolTrace).toContain('provider-unavailable');
    });

    test('stream llm_unavailable fallback adds llm dependency trace', async () => {
        const result = await streamAdminInsightChat(
            'Could you summarize the recent growth momentum by the most relevant performance signals?',
            {
                provider: 'gemini',
                model: 'gemini-test',
                apiKey: '',
            },
        );

        expect('local' in result).toBe(true);
        expect(result.local?.meta?.toolTrace).toContain('dependency:llm-key-unavailable:gemini');
        expect(result.local?.meta?.toolTrace).not.toContain('route:storyboard');
    });

    test('generic peak keyword remains in llm path without forcing peak-frame routing', async () => {
        const result = await streamAdminInsightChat(
            'Peak response trends are improving this quarter',
            {
                provider: 'gemini',
                model: 'gemini-test',
                apiKey: '',
            },
        );

        expect('local' in result).toBe(true);
        const toolTrace = result.local?.meta?.toolTrace ?? [];
        expect(toolTrace).toContain('dependency:llm-key-unavailable:gemini');
        expect(toolTrace).not.toContain('local:peak-frame');
    });

    test('storyboard-local fallback adds BGE dependency trace when embedding URL is missing', async () => {
        const previousBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
        const previousBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
        const previousRemoteEnabled = process.env.STORYBOARD_AGENT_REMOTE_ENABLED;
        process.env.STORYBOARD_BGE_ENABLED = 'true';
        delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
        process.env.STORYBOARD_AGENT_REMOTE_ENABLED = 'false';

        try {
            const response = await answerAdminInsightChat('인기 영상 스토리보드', {
                provider: 'gemini',
                model: 'gemini-test',
                apiKey: 'invalid-key',
            });

            expect(response.meta?.fallbackReason).toBe('storyboard_internal_fallback');
            expect(response.meta?.toolTrace).toContain('dependency:bge-embedding-unavailable');
        } finally {
            if (previousBgeEnabled === undefined) {
                delete process.env.STORYBOARD_BGE_ENABLED;
            } else {
                process.env.STORYBOARD_BGE_ENABLED = previousBgeEnabled;
            }
            if (previousBgeUrl === undefined) {
                delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
            } else {
                process.env.STORYBOARD_BGE_EMBEDDING_URL = previousBgeUrl;
            }
            if (previousRemoteEnabled === undefined) {
                delete process.env.STORYBOARD_AGENT_REMOTE_ENABLED;
            } else {
                process.env.STORYBOARD_AGENT_REMOTE_ENABLED = previousRemoteEnabled;
            }
        }
    });

    test('setup command flow uses setup-aware follow-up prompts', async () => {
        const originalFetch = global.fetch;
        const previousCacheTtl = process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
        const previousStoryboardEnabled = process.env.STORYBOARD_AGENT_ENABLED;
        const previousStoryboardApiUrl = process.env.STORYBOARD_AGENT_API_URL;
        const previousBgeEnabled = process.env.STORYBOARD_BGE_ENABLED;
        const previousBgeUrl = process.env.STORYBOARD_BGE_EMBEDDING_URL;
        const previousNanoBanana2Key = process.env.NANO_BANANA_2_API_KEY;
        const previousNanoBananaKey = process.env.NANO_BANANA_API_KEY;
        const previousNanoBananaAgentKey = process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
        const previousStoryboardImageAgentKey = process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
        const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const previousSupabaseRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = '0';
        process.env.STORYBOARD_AGENT_ENABLED = 'true';
        process.env.STORYBOARD_AGENT_API_URL = '';
        process.env.STORYBOARD_BGE_ENABLED = 'true';
        process.env.STORYBOARD_BGE_EMBEDDING_URL = '';
        process.env.NANO_BANANA_2_API_KEY = '';
        process.env.NANO_BANANA_API_KEY = '';
        process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = '';
        process.env.STORYBOARD_AGENT_IMAGE_API_KEY = '';
        process.env.NEXT_PUBLIC_SUPABASE_URL = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = '';
        global.fetch = async (input: RequestInfo | URL) => {
            const endpoint = String(input);
            if (endpoint.includes('/health')) {
                return new Response(null, { status: 204 });
            }
            return new Response(null, { status: 500 });
        };

        try {
            const response = await answerAdminInsightChat('/setup-keys');
            const prompts = response.followUpPrompts?.map((entry) => entry.prompt) ?? [];
            const labels = response.followUpPrompts?.map((entry) => entry.label) ?? [];

            expect(prompts).toContain('/setup');
            expect(prompts).toContain('/setup-checklist');
            expect(prompts).toContain('/operator-todo');
            expect(prompts).toContain('/ops-status');
            expect(prompts).toContain('/system-status');
            expect(labels).toContain('운영 상태 요약');
            expect(prompts).not.toContain('/tzuyang-video 최근 조회가 잘 나온 숏폼 기획안을 3개 비교해줘');
            expect(prompts).not.toContain('/tzuyang-restaurant 오늘 운영 영상용 상호 브리핑(메뉴·세팅·컷 추천)을 정리해줘');
            expect(prompts).not.toContain('/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘');
        } finally {
            global.fetch = originalFetch;
            if (previousCacheTtl === undefined) {
                delete process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS;
            } else {
                process.env.INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS = previousCacheTtl;
            }
            if (previousStoryboardEnabled === undefined) {
                delete process.env.STORYBOARD_AGENT_ENABLED;
            } else {
                process.env.STORYBOARD_AGENT_ENABLED = previousStoryboardEnabled;
            }
            if (previousStoryboardApiUrl === undefined) {
                delete process.env.STORYBOARD_AGENT_API_URL;
            } else {
                process.env.STORYBOARD_AGENT_API_URL = previousStoryboardApiUrl;
            }
            if (previousBgeEnabled === undefined) {
                delete process.env.STORYBOARD_BGE_ENABLED;
            } else {
                process.env.STORYBOARD_BGE_ENABLED = previousBgeEnabled;
            }
            if (previousBgeUrl === undefined) {
                delete process.env.STORYBOARD_BGE_EMBEDDING_URL;
            } else {
                process.env.STORYBOARD_BGE_EMBEDDING_URL = previousBgeUrl;
            }
            if (previousNanoBanana2Key === undefined) {
                delete process.env.NANO_BANANA_2_API_KEY;
            } else {
                process.env.NANO_BANANA_2_API_KEY = previousNanoBanana2Key;
            }
            if (previousNanoBananaKey === undefined) {
                delete process.env.NANO_BANANA_API_KEY;
            } else {
                process.env.NANO_BANANA_API_KEY = previousNanoBananaKey;
            }
            if (previousNanoBananaAgentKey === undefined) {
                delete process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY;
            } else {
                process.env.STORYBOARD_AGENT_NANO_BANANA_API_KEY = previousNanoBananaAgentKey;
            }
            if (previousStoryboardImageAgentKey === undefined) {
                delete process.env.STORYBOARD_AGENT_IMAGE_API_KEY;
            } else {
                process.env.STORYBOARD_AGENT_IMAGE_API_KEY = previousStoryboardImageAgentKey;
            }
            if (previousSupabaseUrl === undefined) {
                delete process.env.NEXT_PUBLIC_SUPABASE_URL;
            } else {
                process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
            }
            if (previousSupabaseRoleKey === undefined) {
                delete process.env.SUPABASE_SERVICE_ROLE_KEY;
            } else {
                process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseRoleKey;
            }
        }
    });
});
