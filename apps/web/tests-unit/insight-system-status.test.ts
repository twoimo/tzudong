import { describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
    AdminInsightSystemStatusChecklistItem,
    AdminInsightSystemStatusResponse,
} from '@/types/insight';

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

type WithChecklist = {
    checklist: AdminInsightSystemStatusChecklistItem[];
};

function setAuthMock(state: AuthState) {
    mock.module('@/lib/auth/require-admin', () => ({
        requireAdmin: async () => {
            if (state === 'ok') {
                return { ok: true, userId: 'admin-user' };
            }

            return {
                ok: false,
                response:
                    state === 'unauthorized'
                        ? new Response(JSON.stringify({ error: 'Unauthorized' }), {
                              status: 401,
                              headers: { 'Content-Type': 'application/json' },
                          })
                        : new Response(JSON.stringify({ error: 'Forbidden' }), {
                              status: 403,
                              headers: { 'Content-Type': 'application/json' },
                          }),
            };
        },
    }));
}

function withEnv(updates: Partial<NodeJS.ProcessEnv>): () => void {
    const previous: Partial<NodeJS.ProcessEnv> = {};

    for (const [key, value] of Object.entries(updates)) {
        previous[key as keyof NodeJS.ProcessEnv] = process.env[key as keyof NodeJS.ProcessEnv];
        if (value === undefined) {
            delete process.env[key as keyof NodeJS.ProcessEnv];
        } else {
            process.env[key as keyof NodeJS.ProcessEnv] = value;
        }
    }

    return () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key as keyof NodeJS.ProcessEnv];
            } else {
                process.env[key as keyof NodeJS.ProcessEnv] = value;
            }
        }
    };
}

function detectRunDailyScriptPath(): string | undefined {
    const candidates = [
        path.resolve(process.cwd(), 'backend', 'run_daily.sh'),
        path.resolve(process.cwd(), '..', 'backend', 'run_daily.sh'),
        path.resolve(process.cwd(), '..', '..', 'backend', 'run_daily.sh'),
        path.resolve(process.cwd(), '..', '..', '..', 'backend', 'run_daily.sh'),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }

    return undefined;
}

async function loadSystemStatusRoute() {
    const moduleId = `../app/api/admin/insight/system-status/route.ts?cache=${Math.random()}`;
    return import(moduleId);
}

async function loadSystemStatusHelper() {
    const moduleId = `../lib/insight/chat-system-status.ts?cache=${Math.random()}`;
    return import(moduleId);
}

function findChecklistItem(payload: WithChecklist, id: string) {
    return payload.checklist.find((entry) => entry.id === id);
}

function expectChecklistHasAction(payload: WithChecklist, id: string, action: string) {
    const item = findChecklistItem(payload, id);
    expect(item).toBeDefined();
    expect(item?.action).toBe(action);
}

describe('admin insight system status helper', () => {
    test('reports storyboard/BGE readiness and key availability from env', async () => {
        const runDailyScriptPath = detectRunDailyScriptPath();
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
            STORYBOARD_BGE_EMBEDDING_TOKEN: 'bge-secret-token',
            GEMINI_OCR_YEON: 'gemini-server-key-secret',
            OPENAI_API_KEY: 'openai-server-key-secret',
            ANTHROPIC_API_KEY: undefined,
            STORYBOARD_AGENT_ANTHROPIC_API_KEY: undefined,
            NANO_BANANA_2_API_KEY: undefined,
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? '',
        });

        const originalFetch = global.fetch;
        const seen: string[] = [];
        global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const endpoint = String(input);
            seen.push(`${init?.method ?? 'GET'} ${endpoint}`);

            if (endpoint.includes('/health')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 204,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (endpoint.includes('bge.internal')) {
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response('not found', { status: 500, headers: { 'Content-Type': 'text/plain' } });
        };

        try {
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.storyboardAgent.enabled).toBe(true);
            expect(payload.storyboardAgent.configured).toBe(true);
            expect(payload.storyboardAgent.reachable).toBe(true);
            expect(payload.storyboardAgent.endpoint).toBe('https://storyboard.internal/api');
            expect(payload.bgeEmbedding.enabled).toBe(true);
            expect(payload.bgeEmbedding.configured).toBe(true);
            expect(payload.bgeEmbedding.reachable).toBe(true);
            expect(payload.keys.geminiServerKey).toBe(true);
            expect(payload.keys.openaiServerKey).toBe(true);
            expect(payload.keys.anthropicServerKey).toBe(false);
            expect(payload.keys.nanoBanana2Key).toBe(false);
            expect(payload.checklist).toBeInstanceOf(Array);
            expect(JSON.stringify(payload)).not.toContain('gemini-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('openai-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('bge-secret-token');
            expect(payload.checklist.some((item) => item.id === 'provider-key-anthropic')).toBe(true);
            expect(payload.checklist.some((item) => item.id === 'provider-key-nano-banana-2')).toBe(true);
            expectChecklistHasAction(
                payload,
                'provider-key-anthropic',
                'Anthropic 서버 키가 없습니다. `ANTHROPIC_API_KEY` 또는 `STORYBOARD_AGENT_ANTHROPIC_API_KEY`를 설정하거나, 설정 패널에서 브라우저 키를 추가하세요.',
            );
            expectChecklistHasAction(
                payload,
                'provider-key-nano-banana-2',
                'Nano Banana 2 이미지 생성 키를 준비하세요 (NANO_BANANA_2_API_KEY).',
            );
            if (runDailyScriptPath) {
                expect(payload.checklist.some((entry) => entry.id === 'run-daily-script-missing')).toBe(false);
            } else {
                expectChecklistHasAction(
                    payload,
                    'run-daily-script-missing',
                    'run_daily 자동 수집 파이프라인이 감지되지 않았습니다. 운영 서버에서 `backend/run_daily.sh`(또는 RUN_DAILY_SCRIPT_PATH)를 배치하고, `chmod +x` 후 crontab(`0 4 * * * /path/to/backend/run_daily.sh >> ...`)에 등록해 실행되게 설정하세요.',
                );
            }
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.category).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.source).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.severity).toBe('medium');
            if (runDailyScriptPath) {
                expect(findChecklistItem(payload, 'run-daily-script-missing')).toBeUndefined();
            } else {
                expect(findChecklistItem(payload, 'run-daily-script-missing')?.source).toBe('run_daily');
                expect(findChecklistItem(payload, 'run-daily-script-missing')?.category).toBe('environment');
                expect(findChecklistItem(payload, 'run-daily-script-missing')?.severity).toBe('high');
            }
            expect(seen.some((entry) => entry.startsWith('GET https://storyboard.internal/health'))).toBe(true);
            expect(seen.some((entry) => entry.startsWith('POST https://bge.internal/v1/embeddings'))).toBe(true);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('marks storyboard and bge integration issues with source metadata', async () => {
        const runDailyScriptPath = detectRunDailyScriptPath();
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
            STORYBOARD_BGE_EMBEDDING_TOKEN: 'bge-secret-token',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? 'backend/run_daily_missing.sh',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
        });

        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);

            if (endpoint.includes('/health')) {
                return new Response(JSON.stringify({}), { status: 503 });
            }

            if (endpoint.includes('bge.internal')) {
                return new Response(null, { status: 500 });
            }

            return new Response(null, { status: 500 });
        };

        try {
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.storyboardAgent.configured).toBe(true);
            expect(payload.bgeEmbedding.configured).toBe(true);
            expect(payload.storyboardAgent.reachable).toBe(false);
            expect(payload.bgeEmbedding.reachable).toBe(false);

            const storyboardHealthItem = findChecklistItem(payload, 'storyboard-health-failed');
            const bgeHealthItem = findChecklistItem(payload, 'bge-health-failed');

            expect(storyboardHealthItem?.source).toBe('storyboard-agent');
            expect(storyboardHealthItem?.severity).toBe('high');
            expect(storyboardHealthItem?.category).toBe('integration');
            expect(bgeHealthItem?.source).toBe('bge-embedding');
            expect(bgeHealthItem?.severity).toBe('high');
            expect(bgeHealthItem?.category).toBe('integration');
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });
});

describe('admin insight system status API route', () => {
    test('requires admin authorization before checks', async () => {
        const restoreEnv = withEnv({
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
        });

        mock.restore();
        setAuthMock('unauthorized');

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(401);
            expect(await response.json()).toEqual({ error: 'Unauthorized' });
        } finally {
            restoreEnv();
        }
    });

    test('returns system status payload with no-store and hides secrets', async () => {
        const restoreEnv = withEnv({
            RUN_DAILY_SCRIPT_PATH: 'backend/run_daily_missing.sh',
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
            STORYBOARD_BGE_EMBEDDING_TOKEN: 'bge-secret-token',
            GEMINI_OCR_YEON: 'gemini-server-key-secret',
            ANTHROPIC_API_KEY: undefined,
            STORYBOARD_AGENT_ANTHROPIC_API_KEY: undefined,
            OPENAI_API_KEY: undefined,
            STORYBOARD_AGENT_OPENAI_API_KEY: undefined,
            NANO_BANANA_2_API_KEY: undefined,
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
        });

        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);

            if (endpoint.includes('/health')) {
                return new Response(null, { status: 204 });
            }

            if (endpoint.includes('bge.internal')) {
                return new Response(null, { status: 200 });
            }

            return new Response(null, { status: 500 });
        };

        mock.restore();
        setAuthMock('ok');

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            expect(response.headers.get('Cache-Control')).toBe('no-store');

            const payload = (await response.json()) as AdminInsightSystemStatusResponse;
            expect(payload.storyboardAgent.enabled).toBe(true);
            expect(payload.bgeEmbedding.enabled).toBe(true);
            expect(payload.storyboardAgent.configured).toBe(true);
            expect(payload.bgeEmbedding.configured).toBe(true);
            expect(payload.keys.geminiServerKey).toBe(true);
            expect(payload.keys.openaiServerKey).toBe(false);
            expect(payload.keys.anthropicServerKey).toBe(false);
            expect(JSON.stringify(payload)).not.toContain('gemini-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('bge-secret-token');
            expectChecklistHasAction(
                payload,
                'provider-key-nano-banana-2',
                'Nano Banana 2 이미지 생성 키를 준비하세요 (NANO_BANANA_2_API_KEY).',
            );
            expectChecklistHasAction(
                payload,
                'provider-key-openai',
                'OpenAI 서버 키가 없습니다. `OPENAI_API_KEY` 또는 `STORYBOARD_AGENT_OPENAI_API_KEY`를 설정하거나, 설정 패널에서 브라우저 키를 추가하세요.',
            );
            expectChecklistHasAction(
                payload,
                'provider-key-anthropic',
                'Anthropic 서버 키가 없습니다. `ANTHROPIC_API_KEY` 또는 `STORYBOARD_AGENT_ANTHROPIC_API_KEY`를 설정하거나, 설정 패널에서 브라우저 키를 추가하세요.',
            );
            expectChecklistHasAction(
                payload,
                'run-daily-script-missing',
                'run_daily 자동 수집 파이프라인이 감지되지 않았습니다. 운영 서버에서 `backend/run_daily.sh`(또는 RUN_DAILY_SCRIPT_PATH)를 배치하고, `chmod +x` 후 crontab(`0 4 * * * /path/to/backend/run_daily.sh >> ...`)에 등록해 실행되게 설정하세요.',
            );
            expect(findChecklistItem(payload, 'provider-key-openai')?.severity).toBe('medium');
            expect(findChecklistItem(payload, 'provider-key-openai')?.source).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-openai')?.category).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.source).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.category).toBe('provider-key');
            expect(findChecklistItem(payload, 'run-daily-script-missing')?.severity).toBe('high');
            expect(findChecklistItem(payload, 'run-daily-script-missing')?.source).toBe('run_daily');
            expect(findChecklistItem(payload, 'storyboard-health-failed')?.category).toBeUndefined();
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('returns no server-key checklist when provider keys are configured', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
            OPENAI_API_KEY: 'openai-server-key-secret',
            GEMINI_OCR_YEON: 'gemini-server-key-secret',
            ANTHROPIC_API_KEY: 'anthropic-server-key-secret',
            NANO_BANANA_2_API_KEY: 'nanobanana-secret-key',
            RUN_DAILY_SCRIPT_PATH: detectRunDailyScriptPath() ?? '',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
        });

        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);

            if (endpoint.includes('/health')) {
                return new Response(null, { status: 204 });
            }

            if (endpoint.includes('bge.internal')) {
                return new Response(null, { status: 200 });
            }

            return new Response(null, { status: 500 });
        };

        mock.restore();
        setAuthMock('ok');

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            const payload = (await response.json()) as AdminInsightSystemStatusResponse;

            expect(payload.keys.geminiServerKey).toBe(true);
            expect(payload.keys.openaiServerKey).toBe(true);
            expect(payload.keys.anthropicServerKey).toBe(true);
            expect(payload.keys.nanoBanana2Key).toBe(true);

            expect(payload.checklist.some((entry) => entry.id === 'provider-key-nano-banana-2')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-openai')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-anthropic')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-gemini')).toBe(false);
            if (!detectRunDailyScriptPath()) {
                expect(payload.checklist.some((entry) => entry.id === 'run-daily-script-missing')).toBe(true);
            } else {
                expect(payload.checklist.some((entry) => entry.id === 'run-daily-script-missing')).toBe(false);
            }
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });
});
