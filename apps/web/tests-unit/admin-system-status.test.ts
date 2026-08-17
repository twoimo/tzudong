import { describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
    AdminSystemStatusChecklistItem,
    AdminSystemStatusResponse,
} from '@/types/admin-system-status';

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

type WithChecklist = {
    checklist: AdminSystemStatusChecklistItem[];
};

function setAuthMock(state: AuthState) {
    mock.module('@/lib/auth/require-admin', () => ({
        requireAdmin: async () => {
            if (state === 'ok') {
                return { ok: true, userId: '11111111-1111-4111-8111-111111111111' };
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
function setProviderBudgetMock() {
    mock.module('@/lib/security/admin-provider-budget', () => ({
        reserveAdminProviderBudget: async () => ({ allowed: true, retryAfterSeconds: 0 }),
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

function withTempDir(prefix: string): {
  dir: string;
  cleanup: () => void;
} {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
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
    const moduleId = `../app/api/admin/system-status/route.ts?cache=${Math.random()}`;
    return import(moduleId);
}

async function loadDirectionsRoute() {
    const moduleId = `../app/api/admin/routes/directions/route.ts?cache=${Math.random()}`;
    return import(moduleId);
}
function directionsRequest(body: string) {
    return new Request('http://localhost/api/admin/routes/directions', {
        method: 'POST',
        headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/json',
        },
        body,
    });
}


async function loadSystemStatusHelper() {
    const moduleId = `../lib/admin/system-status/status.ts?cache=${Math.random()}`;
    return import(moduleId);
}

async function ensureRealSystemStatusModuleForRoute() {
    const actual = await loadSystemStatusHelper();
    mock.module('@/lib/admin/system-status/status', () => ({
        getAdminSystemStatus: actual.getAdminSystemStatus,
    }));
}

function findChecklistItem(payload: WithChecklist, id: string) {
    return payload.checklist.find((entry) => entry.id === id);
}

function expectChecklistHasAction(payload: WithChecklist, id: string, action: string) {
    const item = findChecklistItem(payload, id);
    expect(item).toBeDefined();
    expect(item?.action).toBe(action);
}

function expectChecklistHasCommand(payload: WithChecklist, id: string, expectedFragment: string) {
    const item = findChecklistItem(payload, id);
    expect(item).toBeDefined();
    const command = item?.command ?? item?.commandSnippet;
    expect(typeof command).toBe('string');
    expect(command?.trim()).toContain(expectedFragment);
}

function expectNoSecretLeak(payload: AdminSystemStatusResponse, secrets: string[]) {
    const payloadText = JSON.stringify(payload);

    for (const secret of secrets) {
        expect(payloadText).not.toContain(secret);
        for (const item of payload.checklist) {
            if (item.action?.includes(secret)) {
                expect(false, `checklist action leaked secret: ${secret}`).toBe(false);
            }
            if (item.command?.includes(secret)) {
                expect(false, `checklist command leaked secret: ${secret}`).toBe(false);
            }
            if (item.commandSnippet?.includes(secret)) {
                expect(false, `checklist command snippet leaked secret: ${secret}`).toBe(false);
            }
            if (item.title?.includes(secret)) {
                expect(false, `checklist title leaked secret: ${secret}`).toBe(false);
            }
        }
    }
}

describe('admin system status helper', () => {
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
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);
            const executableExpected = runDailyScriptPath
                ? (() => {
                    try {
                        return (statSync(runDailyScriptPath).mode & 0o111) > 0;
                    } catch {
                        return false;
                    }
                })()
                : false;

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
            expect(payload.runDaily).toBeDefined();
            expect(payload.runDaily?.scriptPath).toBe(runDailyScriptPath || undefined);
            expect(payload.runDaily?.executable).toBe(executableExpected);
            expect(payload.runDaily?.latestLogPath ? existsSync(payload.runDaily?.latestLogPath) : true).toBe(true);
            expect(typeof payload.runDaily?.checkedAt).toBe('string');
            expect(typeof payload.runDaily?.stale).toBe('boolean');
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
                if (executableExpected) {
                    expect(findChecklistItem(payload, 'run-daily-script-not-executable')).toBeUndefined();
                } else {
                    expect(findChecklistItem(payload, 'run-daily-script-not-executable')).toBeDefined();
                }

                if (payload.runDaily?.stale) {
                    expect(findChecklistItem(payload, 'run-daily-log-stale')).toBeDefined();
                }
            } else {
                expectChecklistHasAction(
                    payload,
                    'run-daily-script-missing',
                    '자동 수집 파이프라인이 감지되지 않았습니다. crontab에 `python3 -m backend.pipeline_control.worker` 를 등록하세요.',
                );
            }
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.category).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.source).toBe('provider-key');
            expect(findChecklistItem(payload, 'provider-key-anthropic')?.severity).toBe('medium');
            if (runDailyScriptPath) {
                expect(findChecklistItem(payload, 'run-daily-script-missing')).toBeUndefined();
                if (payload.runDaily?.executable) {
                    expect(findChecklistItem(payload, 'run-daily-script-not-executable')).toBeUndefined();
                } else {
                    expect(findChecklistItem(payload, 'run-daily-script-not-executable')?.source).toBe('run_daily');
                }
                if (payload.runDaily?.stale) {
                    expect(findChecklistItem(payload, 'run-daily-log-stale')?.severity).toBe('medium');
                } else {
                    expect(findChecklistItem(payload, 'run-daily-log-stale')).toBeUndefined();
                }
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

    test('adds command snippets for missing run_daily/storyboard/BGE checks', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_BGE_ENABLED: 'true',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expectChecklistHasCommand(payload, 'run-daily-script-missing', 'pipeline_control.worker');
            expectChecklistHasCommand(payload, 'run-daily-script-missing', 'crontab');
            expectChecklistHasCommand(payload, 'storyboard-url-missing', 'STORYBOARD_AGENT_API_URL');
            expectChecklistHasCommand(payload, 'storyboard-url-missing', 'health');
            expectChecklistHasCommand(payload, 'storyboard-url-missing', 'curl');
            expectChecklistHasCommand(payload, 'bge-url-missing', 'STORYBOARD_BGE_EMBEDDING_URL');
            expectChecklistHasCommand(payload, 'bge-url-missing', 'POST');
            expect(JSON.stringify(payload)).not.toContain('bge-secret-token');
        } finally {
            restoreEnv();
        }
    });

    test('redacts endpoint credentials and query fragments while checking system status', async () => {
        const runDailyScriptPath = detectRunDailyScriptPath();
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard-user:storyboard-token@example.com/api/v1/health?token=leak-token',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge-user:embed-token@example.com/v1/embeddings?token=embed-leak',
            STORYBOARD_BGE_EMBEDDING_TOKEN: 'bge-secret-token',
            GEMINI_OCR_YEON: 'gemini-server-key-secret',
            OPENAI_API_KEY: 'openai-server-key-secret',
            ANTHROPIC_API_KEY: 'anthropic-server-key-secret',
            NANO_BANANA_2_API_KEY: 'nanobanana-secret',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? '',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
        });

        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);

            if (endpoint.includes('/health')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 204,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            if (new URL(endpoint).hostname === 'bge.example.com') {
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response('not found', { status: 500, headers: { 'Content-Type': 'text/plain' } });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.storyboardAgent.endpoint).toBe('https://example.com/api/v1/health');
            expect(payload.bgeEmbedding.endpoint).toBe('https://example.com/v1/embeddings');
            expect(payload.storyboardAgent.endpoint).not.toContain('storyboard-user');
            expect(payload.storyboardAgent.endpoint).not.toContain('storyboard-token');
            expect(payload.bgeEmbedding.endpoint).not.toContain('bge-user');
            expect(payload.bgeEmbedding.endpoint).not.toContain('embed-token');
            expect(JSON.stringify(payload)).not.toContain('leak-token');
            expect(JSON.stringify(payload)).not.toContain('embed-leak');
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('omits raw provider token values when they are configured', async () => {
        const runDailyScriptPath = detectRunDailyScriptPath();
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'true',
            STORYBOARD_AGENT_API_URL: 'https://storyboard.internal/api',
            STORYBOARD_BGE_ENABLED: 'true',
            STORYBOARD_BGE_EMBEDDING_URL: 'https://bge.internal/v1/embeddings',
            STORYBOARD_BGE_EMBEDDING_TOKEN: 'bge-super-secret-token',
            GEMINI_OCR_YEON: 'gemini-super-secret-key',
            OPENAI_API_KEY: 'openai-super-secret-key',
            ANTHROPIC_API_KEY: 'anthropic-super-secret-key',
            NANO_BANANA_2_API_KEY: 'nanobanana-super-secret-key',
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'supabase-service-role-super-secret-key',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? 'backend/run_daily_missing.sh',
        });

        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);
            if (endpoint.includes('/health')) {
                return new Response(null, { status: 204 });
            }
            if (endpoint.includes('bge.internal')) {
                return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(null, { status: 500 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expectNoSecretLeak(payload, [
                'bge-super-secret-token',
                'gemini-super-secret-key',
                'openai-super-secret-key',
                'anthropic-super-secret-key',
                'nanobanana-super-secret-key',
                'supabase-service-role-super-secret-key',
            ]);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-gemini')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-openai')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-anthropic')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'provider-key-nano-banana-2')).toBe(false);
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
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.storyboardAgent.configured).toBe(true);
            expect(payload.bgeEmbedding.configured).toBe(true);
            expect(payload.storyboardAgent.reachable).toBe(false);
            expect(payload.bgeEmbedding.reachable).toBe(false);

            const storyboardHealthItem = findChecklistItem(payload, 'storyboard-health-failed');
            const bgeHealthItem = findChecklistItem(payload, 'bge-health-failed');

            expect(storyboardHealthItem?.source).toBe('storyboard-agent');
            expect(storyboardHealthItem?.severity).toBe('high');
            expect(storyboardHealthItem?.category).toBe('integration');
            expectChecklistHasCommand(payload, 'storyboard-health-failed', 'STORYBOARD_AGENT_API_URL');
            expect(bgeHealthItem?.source).toBe('bge-embedding');
            expect(bgeHealthItem?.severity).toBe('high');
            expect(bgeHealthItem?.category).toBe('integration');
            expectChecklistHasCommand(payload, 'bge-health-failed', 'STORYBOARD_BGE_EMBEDDING_URL');
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('reports frame-caption readiness from local path and redacts gdrive credentials', async () => {
        const localFrameCaptionDir = withTempDir('tzudong-frame-caption-');
        const runDailyScriptPath = detectRunDailyScriptPath();
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_FRAME_CAPTION_BASE_PATH: localFrameCaptionDir.dir,
            INSIGHT_GDRIVE_FRAME_CAPTION_PATH: 'https://fc-user:fc-token@example.com/peak/frame-captions?token=frame-leak',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? '',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.frameCaption.configured).toBe(true);
            expect(payload.frameCaption.localPathConfigured).toBe(true);
            expect(payload.frameCaption.localPathAvailable).toBe(true);
            expect(payload.frameCaption.gdrivePathConfigured).toBe(true);
            expect(payload.frameCaption.reachable).toBe(true);
            expect(payload.frameCaption.localPath).toBe(localFrameCaptionDir.dir);
            expect(payload.frameCaption.gdrivePath).toBe('https://example.com/peak/frame-captions');
            expect(payload.frameCaption.gdrivePath).not.toContain('fc-token');
            expect(payload.frameCaption.gdrivePath).not.toContain('token=frame-leak');
            expect(payload.frameCaption.detail).toBeUndefined();
            expect(JSON.stringify(payload)).not.toContain('fc-token');
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-path-missing')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-gdrive-path-missing')).toBe(false);
        } finally {
            restoreEnv();
            localFrameCaptionDir.cleanup();
        }
    });

    test('emits frame-caption checklist warnings when both local and gdrive paths are unavailable', async () => {
        const missingRoot = withTempDir('tzudong-missing-frame-caption-');
        const missingPath = path.join(missingRoot.dir, 'does-not-exist-frame-caption');
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_FRAME_CAPTION_BASE_PATH: missingPath,
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.frameCaption.configured).toBe(true);
            expect(payload.frameCaption.localPathConfigured).toBe(true);
            expect(payload.frameCaption.localPathAvailable).toBe(false);
            expect(payload.frameCaption.gdrivePathConfigured).toBe(false);
            expect(payload.frameCaption.reachable).toBe(false);

            const missingPathItem = findChecklistItem(payload, 'frame-caption-path-missing');
            expect(missingPathItem).toBeDefined();
            expect(missingPathItem?.source).toBe('frame-caption-storage');
            expect(missingPathItem?.severity).toBe('high');
            expect(missingPathItem?.category).toBe('environment');
            expectChecklistHasCommand(payload, 'frame-caption-path-missing', 'INSIGHT_FRAME_CAPTION_BASE_PATH');

            const missingGdriveItem = findChecklistItem(payload, 'frame-caption-gdrive-path-missing');
            expect(missingGdriveItem).toBeDefined();
            expect(missingGdriveItem?.source).toBe('frame-caption-storage');
            expect(missingGdriveItem?.severity).toBe('medium');
            expect(missingGdriveItem?.category).toBe('environment');
            expectChecklistHasCommand(payload, 'frame-caption-gdrive-path-missing', 'INSIGHT_GDRIVE_FRAME_CAPTION_PATH');
            expectChecklistHasCommand(payload, 'frame-caption-gdrive-path-missing', 'gsutil');
        } finally {
            restoreEnv();
            missingRoot.cleanup();
        }
    });

    test('supports auto-discovered frame-caption path when no explicit env var is set', async () => {
        const tempRoot = withTempDir('tzudong-frame-caption-fallback-');
        const fallbackPath = path.join(tempRoot.dir, 'backend', 'restaurant-crawling', 'data', 'tzuyang', 'frame-caption');
        mkdirSync(fallbackPath, { recursive: true });

        const originalCwd = process.cwd();
        process.chdir(tempRoot.dir);

        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.frameCaption.configured).toBe(false);
            expect(payload.frameCaption.localPathConfigured).toBe(false);
            expect(payload.frameCaption.localPathAvailable).toBe(true);
            expect(payload.frameCaption.localPath).toBe(path.resolve(fallbackPath));
            expect(payload.frameCaption.gdrivePathConfigured).toBe(false);
            expect(payload.frameCaption.reachable).toBe(true);
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-path-missing')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-gdrive-path-missing')).toBe(false);
        } finally {
            process.chdir(originalCwd);
            restoreEnv();
            tempRoot.cleanup();
        }
    });
    test('reports Naver provider readiness through system status without leaking secrets', async () => {
        const restoreEnv = withEnv({
            NEXT_NAVER_CLIENT_ID: undefined,
            NEXT_NAVER_CLIENT_SECRET: undefined,
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const missingPayload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(missingPayload.providerReadiness['naver-directions'].provider).toBe('naver-directions');
            expect(missingPayload.providerReadiness['naver-directions'].status).toBe('unavailable');
            expect(missingPayload.providerReadiness['naver-directions'].reasonCode).toBe('naver-directions-credentials-missing');
            expect(findChecklistItem(missingPayload, 'provider-readiness-naver-directions')?.source).toBe('provider-readiness');
        } finally {
            restoreEnv();
        }

        const restoreConfiguredEnv = withEnv({
            NEXT_NAVER_CLIENT_ID: 'naver-client-id-secretish',
            NEXT_NAVER_CLIENT_SECRET: 'naver-client-secret-value',
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
        });

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const configuredPayload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(configuredPayload.providerReadiness['naver-directions'].status).toBe('ready');
            expect(configuredPayload.providerReadiness['naver-directions'].reasonCode).toBe('naver-directions-ready');
            expect(JSON.stringify(configuredPayload)).not.toContain('naver-client-secret-value');
        } finally {
            restoreConfiguredEnv();
        }
    });

    test('maps thumbnail durable release payloads to stable readiness without module mocks', async () => {
        const { mapThumbnailDurableReleasePayloadToReadiness } = await loadSystemStatusHelper();
        const checkedAt = '2026-07-03T00:00:00.000Z';
        const cases = [
            {
                payload: {
                    status: 'ready',
                    release: { id: 'active-release' },
                    diagnostics: {
                        durableRegistryAvailable: true,
                        releaseKey: 'youtube-thumbnail-generator/current',
                        warnings: [],
                    },
                },
                expectedStatus: 'ready',
                expectedReason: 'thumbnail-durable-release-ready',
            },
            {
                payload: {
                    status: 'empty',
                    release: null,
                    diagnostics: {
                        durableRegistryAvailable: true,
                        releaseKey: 'youtube-thumbnail-generator/current',
                        reason: 'durable_release_empty',
                        warnings: [],
                    },
                },
                expectedStatus: 'unavailable',
                expectedReason: 'thumbnail-durable-release-empty',
            },
            {
                payload: {
                    status: 'ready',
                    release: { id: 'local-release' },
                    diagnostics: {
                        durableRegistryAvailable: false,
                        releaseKey: 'youtube-thumbnail-generator/current',
                        reason: 'local_release_candidate_fallback',
                        warnings: ['durable-registry-unavailable:missing_supabase_env'],
                    },
                },
                expectedStatus: 'degraded',
                expectedReason: 'thumbnail-durable-release-local-fallback',
            },
            {
                payload: {
                    status: 'unavailable',
                    release: null,
                    diagnostics: {
                        durableRegistryAvailable: false,
                        releaseKey: 'youtube-thumbnail-generator/current',
                        reason: 'missing_release_table',
                        warnings: ['local-release-candidate-fallback-unavailable'],
                    },
                },
                expectedStatus: 'unavailable',
                expectedReason: 'thumbnail-durable-release-table-missing',
            },
            {
                payload: {
                    status: 'unavailable',
                    release: null,
                    diagnostics: {
                        durableRegistryAvailable: false,
                        releaseKey: 'youtube-thumbnail-generator/current',
                        reason: 'missing_supabase_env',
                        warnings: ['local-release-candidate-fallback-unavailable'],
                    },
                },
                expectedStatus: 'unavailable',
                expectedReason: 'thumbnail-durable-release-env-missing',
            },
        ] as const;

        for (const item of cases) {
            const readiness = mapThumbnailDurableReleasePayloadToReadiness(item.payload, checkedAt);
            expect(readiness.provider).toBe('youtube-thumbnail-durable-release');
            expect(readiness.status).toBe(item.expectedStatus);
            expect(readiness.reasonCode).toBe(item.expectedReason);
            expect(readiness.checkedAt).toBe(checkedAt);
            expect(JSON.stringify(readiness)).not.toContain('service-role-secret');
            expect(JSON.stringify(readiness)).not.toContain('storage_object_path');
        }
    });
});

describe('admin system status API route', () => {
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
        await ensureRealSystemStatusModuleForRoute();

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
        await ensureRealSystemStatusModuleForRoute();

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            expect(response.headers.get('Cache-Control')).toBe('no-store');

            const payload = (await response.json()) as AdminSystemStatusResponse;
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
                '자동 수집 파이프라인이 감지되지 않았습니다. crontab에 `python3 -m backend.pipeline_control.worker` 를 등록하세요.',
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
        await ensureRealSystemStatusModuleForRoute();

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            const payload = (await response.json()) as AdminSystemStatusResponse;

            expect(payload.keys.geminiServerKey).toBe(true);
            expect(payload.keys.openaiServerKey).toBe(true);
            expect(payload.keys.anthropicServerKey).toBe(true);
            expect(payload.keys.nanoBanana2Key).toBe(true);
            expect(JSON.stringify(payload)).not.toContain('openai-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('gemini-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('anthropic-server-key-secret');
            expect(JSON.stringify(payload)).not.toContain('nanobanana-secret-key');

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

    test('returns frame caption status payload via API route without exposing credential fragments', async () => {
        const tempFrameCaptionDir = withTempDir('tzudong-route-frame-caption-');
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_FRAME_CAPTION_BASE_PATH: tempFrameCaptionDir.dir,
            INSIGHT_GDRIVE_FRAME_CAPTION_PATH: 'https://fc-user:fc-token@example.com/peak',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            INSIGHT_SYSTEM_STATUS_TIMEOUT_MS: '500',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
        });

        const originalFetch = global.fetch;
        global.fetch = async () => new Response(null, { status: 500 });

        mock.restore();
        setAuthMock('ok');
        await ensureRealSystemStatusModuleForRoute();

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            expect(response.headers.get('Cache-Control')).toBe('no-store');

            const payload = (await response.json()) as AdminSystemStatusResponse;
            expect(payload.frameCaption.configured).toBe(true);
            expect(payload.frameCaption.localPathConfigured).toBe(true);
            expect(payload.frameCaption.localPathAvailable).toBe(true);
            expect(payload.frameCaption.gdrivePathConfigured).toBe(true);
            expect(payload.frameCaption.gdrivePath).toBe('https://example.com/peak');
            expect(payload.frameCaption.reachable).toBe(true);
            expect(payload.frameCaption.localPath).toBe(tempFrameCaptionDir.dir);
            expect(payload.frameCaption.detail).toBeUndefined();
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-path-missing')).toBe(false);
            expect(payload.checklist.some((entry) => entry.id === 'frame-caption-gdrive-path-missing')).toBe(false);
            expect(JSON.stringify(payload)).not.toContain('fc-token');
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
            tempFrameCaptionDir.cleanup();
        }
    });

    test('prefers run_daily manifest failure state and keeps remote probes disabled by default', async () => {
        const runDailyScriptPath = detectRunDailyScriptPath();
        const tempDir = withTempDir('tzudong-run-daily-manifest-');
        const manifestPath = path.join(tempDir.dir, 'current-summary.json');
        await Bun.write(manifestPath, JSON.stringify({
            generatedAt: '2026-04-23T15:00:00Z',
            date: '2026-04-23',
            finalStatus: 'ERROR',
            finalExitCode: 1,
            failedRequiredSteps: ['Step 13 (Supabase) - exit=23'],
            optionalSkips: ['Step 1 (URL Collection) - missing key'],
            downstreamSkips: [],
            latestLogPath: '/tmp/backend/log/cron/daily_2026-04-23.log',
            summaryPath: '/tmp/summary.md',
            noWorkShortCircuit: false,
            policyMode: 'end_to_end',
            stepEvents: [
                { name: 'Step 3 (Transcript)', status: 'completed', durationSeconds: 12 },
                { name: 'Step 13 (Supabase)', status: 'failed', reason: 'exit=23' },
            ],
            runtime: {
                githubRunId: '25206693886',
                githubRunUrl: 'https://github.com/twoimo/tzudong/actions/runs/25206693886',
                githubWorkflow: 'Crawler',
                executionBranch: 'main',
                targetBranch: 'data',
            },
            gdriveUpload: {
                status: 'backfill_required',
                exitCode: 124,
                expectedCount: 10,
                residualCount: 3,
                pendingBacklogCount: 3,
                terminalIncomplete: true,
                completionProof: 'rclone_exit_zero',
                operatorMessage: {
                    severity: 'warning',
                    summary: 'GDrive upload requires backfill (status=backfill_required)',
                    action: 'Run the GDrive frame backfill workflow or verify remote proof.',
                },
            },
        }));

        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: runDailyScriptPath ?? '',
            RUN_DAILY_MANIFEST_PATH: manifestPath,
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: undefined,
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: undefined,
        });

        const originalFetch = global.fetch;
        const seen: string[] = [];
        global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
            return new Response('unexpected', { status: 500 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.runDaily?.latestManifestPath).toBe(manifestPath);
            expect(payload.runDaily?.manifestStatus).toBe('available');
            expect(payload.runDaily?.finalStatus).toBe('ERROR');
            expect(payload.runDaily?.finalExitCode).toBe(1);
            expect(payload.runDaily?.failedRequiredSteps).toContain('Step 13 (Supabase) - exit=23');
            expect(payload.runDaily?.runtime?.githubRunId).toBe('25206693886');
            expect(payload.runDaily?.runtime?.githubRunUrl).toBe('https://github.com/twoimo/tzudong/actions/runs/25206693886');
            expect(payload.runDaily?.runtime?.executionBranch).toBe('main');
            expect(payload.runDaily?.runtime?.targetBranch).toBe('data');
            expect(payload.runDaily?.stepEvents?.map((event) => event.status)).toEqual(['completed', 'failed']);
            expect(payload.runDaily?.gdriveUpload?.status).toBe('backfill_required');
            expect(payload.runDaily?.gdriveUpload?.residualCount).toBe(3);
            expect(payload.runDaily?.gdriveUpload?.operatorMessage?.severity).toBe('warning');
            expect(payload.runDaily?.gdriveUpload?.operatorMessage?.action).toContain('backfill workflow');
            expect(payload.checklist.some((item) => item.id === 'run-daily-required-failed')).toBe(true);
            const gdriveChecklist = payload.checklist.find((item) => item.id === 'run-daily-gdrive-upload-incomplete');
            expect(gdriveChecklist?.action).toContain('backfill workflow');
            expect(payload.githubActions?.enabled).toBe(false);
            expect(payload.githubActions?.detail).toBe('disabled');
            expect(payload.supabaseCounters?.enabled).toBe(false);
            expect(payload.supabaseCounters?.detail).toBe('disabled');
            expect(seen).toEqual([]);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
            tempDir.cleanup();
        }
    });

    test('reports missing run_daily current-summary as explicit unknown state', async () => {
        const tempDir = withTempDir('tzudong-run-daily-missing-manifest-');
        const scriptPath = path.join(tempDir.dir, 'run_daily.sh');
        const logDir = path.join(tempDir.dir, 'log', 'cron');
        mkdirSync(logDir, { recursive: true });
        await Bun.write(scriptPath, '#!/bin/sh\n');
        await Bun.write(path.join(logDir, 'daily_2026-06-27.log'), [
            '[00:00] 실패한 필수 단계 요약',
            '  - Step 13 (Supabase) - exit=23',
            '[00:01] 완료',
        ].join('\n'));
        const missingManifestPath = path.join(tempDir.dir, 'current-summary.json');
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: scriptPath,
            RUN_DAILY_MANIFEST_PATH: missingManifestPath,
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: undefined,
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: undefined,
        });

        const originalFetch = global.fetch;
        const seen: string[] = [];
        global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
            return new Response('unexpected', { status: 500 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.runDaily?.latestManifestPath).toBe(missingManifestPath);
            expect(payload.runDaily?.manifestStatus).toBe('missing');
            expect(payload.runDaily?.finalStatus).toBe('UNKNOWN');
            expect(payload.runDaily?.detail).toBeUndefined();
            expect(payload.runDaily?.failedRequiredSteps).toContain('Step 13 (Supabase) - exit=23');
            expect(payload.checklist.some((item) => item.id === 'run-daily-required-failed')).toBe(true);
            expect(payload.checklist.some((item) => item.id === 'run-daily-manifest-missing')).toBe(true);
            expect(payload.githubActions?.enabled).toBe(false);
            expect(payload.supabaseCounters?.enabled).toBe(false);
            expect(seen).toEqual([]);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
            tempDir.cleanup();
        }
    });

    test('uses opt-in read-only GitHub and Supabase status probes without leaking tokens', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'github-secret-token',
            INSIGHT_GITHUB_WORKFLOW: 'daily-crawler.yml',
            INSIGHT_GITHUB_BRANCH: 'main',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '1',
            NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'supabase-secret-token',
        });

        const originalFetch = global.fetch;
        const seen: string[] = [];
        global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const endpoint = String(input);
            seen.push(`${init?.method ?? 'GET'} ${endpoint}`);
            if (new URL(endpoint).hostname === 'api.github.com') {
                return new Response(JSON.stringify({
                    workflow_runs: [{
                        id: 24834262595,
                        status: 'completed',
                        conclusion: 'success',
                        html_url: 'https://github.com/twoimo/tzudong/actions/runs/24834262595?token=hidden',
                        event: 'workflow_dispatch',
                        run_attempt: 2,
                        created_at: '2026-04-23T10:00:00Z',
                        updated_at: '2026-04-23T10:05:00Z',
                    }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (endpoint.includes('/rest/v1/restaurants')) {
                const total = endpoint.includes('evaluation_results=not.is.null') ? 7 : 42;
                return new Response('[]', { status: 206, headers: { 'content-range': `0-0/${total}` } });
            }
            return new Response('not found', { status: 404 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.githubActions?.enabled).toBe(true);
            expect(payload.githubActions?.configured).toBe(true);
            expect(payload.githubActions?.reachable).toBe(true);
            expect(payload.githubActions?.latestRunId).toBe(24834262595);
            expect(payload.githubActions?.latestRunConclusion).toBe('success');
            expect(payload.githubActions?.latestRunEvent).toBe('workflow_dispatch');
            expect(payload.githubActions?.latestRunAttempt).toBe(2);
            expect(payload.githubActions?.latestRunUrl).toBe('https://github.com/twoimo/tzudong/actions/runs/24834262595');
            expect(payload.checklist.some((item) => item.id === 'github-actions-budget-posture')).toBe(true);
            expect(payload.supabaseCounters?.enabled).toBe(true);
            expect(payload.supabaseCounters?.configured).toBe(true);
            expect(payload.supabaseCounters?.reachable).toBe(true);
            expect(payload.supabaseCounters?.restaurantsTotal).toBe(42);
            expect(payload.supabaseCounters?.evaluatedRestaurants).toBe(7);
            expect(seen.every((entry) => entry.startsWith('GET '))).toBe(true);
            expect(seen.join('\n')).not.toContain('dispatches');
            expect(JSON.stringify(payload)).not.toContain('github-secret-token');
            expect(JSON.stringify(payload)).not.toContain('supabase-secret-token');
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('keeps daily GitHub responses bounded, strict, and fixed-code only', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '1',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '0',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'daily-bounded-secret-token',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
        });
        const originalFetch = global.fetch;
        let oversized = false;
        global.fetch = async (): Promise<Response> => oversized
            ? new Response('{}', {
                status: 200,
                headers: { 'Content-Length': String(256 * 1024 + 1) },
            })
            : new Response(JSON.stringify({
                workflow_runs: [{
                    id: 1,
                    status: 'provider-secret-status',
                    conclusion: 'success',
                    event: 'schedule',
                    html_url: 'https://github.com/twoimo/tzudong/actions/runs/1',
                    created_at: '2026-08-12T00:00:00Z',
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });

        try {
            const first = await loadSystemStatusHelper();
            const malformed: AdminSystemStatusResponse = await first.getAdminSystemStatus(process.env as NodeJS.ProcessEnv);
            expect(malformed.githubActions?.reachable).toBe(false);
            expect(malformed.githubActions?.detail).toBe('response_shape_invalid');
            expectNoSecretLeak(malformed, ['daily-bounded-secret-token', 'provider-secret-status']);

            oversized = true;
            const second = await loadSystemStatusHelper();
            const tooLarge: AdminSystemStatusResponse = await second.getAdminSystemStatus(process.env as NodeJS.ProcessEnv);
            expect(tooLarge.githubActions?.reachable).toBe(false);
            expect(tooLarge.githubActions?.detail).toBe('REQUEST_FAILED');
            expectNoSecretLeak(tooLarge, ['daily-bounded-secret-token']);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('uses credential-free GitHub reads only in strict local runtime after a rejected token', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '1',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'rejected-local-token-secret',
            INSIGHT_GITHUB_BRANCH: undefined,
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
            NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
        });
        const originalFetch = global.fetch;
        const authorizationStates: boolean[] = [];
        global.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const headers = new Headers(init?.headers);
            const hasAuthorization = headers.has('Authorization');
            authorizationStates.push(hasAuthorization);
            if (hasAuthorization) {
                return new Response('rejected-provider-body-secret', { status: 401 });
            }
            return new Response(JSON.stringify({
                total_count: 1,
                workflow_runs: [{
                    id: 8080,
                    status: 'completed',
                    conclusion: 'success',
                    event: 'schedule',
                    html_url: 'https://github.com/twoimo/tzudong/actions/runs/8080',
                    created_at: '2026-08-12T00:00:00Z',
                }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.githubActions?.reachable).toBe(true);
            expect(payload.nightlyRegression?.reachable).toBe(true);
            expect(payload.nightlyRegression?.tokenConfigured).toBe(true);
            expect(payload.nightlyRegression?.localCanonical.branch).toBe('main');
            expect(payload.nightlyRegression?.hostedManualFallback.branch).toBe('main');
            expect(authorizationStates).toHaveLength(6);
            expect(authorizationStates.filter(Boolean)).toHaveLength(3);
            expect(authorizationStates.filter((state) => !state)).toHaveLength(3);
            expectNoSecretLeak(payload, [
                'rejected-local-token-secret',
                'rejected-provider-body-secret',
            ]);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('allows public workflow status without a token only in strict local runtime', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '1',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: undefined,
            GITHUB_TOKEN: undefined,
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
            NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
        });
        const originalFetch = global.fetch;
        let requestCount = 0;
        global.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            requestCount += 1;
            expect(new Headers(init?.headers).has('Authorization')).toBe(false);
            return new Response(JSON.stringify({
                total_count: 0,
                workflow_runs: [],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.githubActions?.configured).toBe(true);
            expect(payload.githubActions?.reachable).toBe(true);
            expect(payload.nightlyRegression?.configured).toBe(true);
            expect(payload.nightlyRegression?.reachable).toBe(true);
            expect(payload.nightlyRegression?.tokenConfigured).toBe(false);
            expect(requestCount).toBe(3);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('keeps partial Supabase counts unreachable and returns fixed failure codes', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '0',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '0',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '1',
            NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'supabase-fixed-code-secret',
        });
        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);
            if (endpoint.includes('evaluation_results=not.is.null')) {
                return new Response('provider-body-secret', { status: 503 });
            }
            return new Response('[]', { status: 206, headers: { 'content-range': '0-0/42' } });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.supabaseCounters?.reachable).toBe(false);
            expect(payload.supabaseCounters?.restaurantsTotal).toBe(42);
            expect(payload.supabaseCounters?.evaluatedRestaurants).toBeUndefined();
            expect(payload.supabaseCounters?.detail).toBe('count_incomplete');
            expectNoSecretLeak(payload, ['supabase-fixed-code-secret', 'provider-body-secret']);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('reports bounded local canonical and hosted fallback nightly history without leaking tokens', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '0',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'nightly-read-secret-token',
            INSIGHT_GITHUB_BRANCH: 'main',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
            NEXT_PUBLIC_SUPABASE_URL: undefined,
            SUPABASE_SERVICE_ROLE_KEY: undefined,
        });
        const originalFetch = global.fetch;
        const seen: string[] = [];
        global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const endpoint = String(input);
            seen.push(`${init?.method ?? 'GET'} ${endpoint}`);
            if (endpoint.includes('/nightly-local-regression.yml/')) {
                return new Response(JSON.stringify({
                    total_count: 3,
                    workflow_runs: [
                        {
                            id: 303,
                            status: 'completed',
                            conclusion: 'failure',
                            event: 'schedule',
                            html_url: 'https://github.com/twoimo/tzudong/actions/runs/303?token=redacted',
                            created_at: '2026-08-12T18:30:00Z',
                            updated_at: '2026-08-12T18:40:00Z',
                        },
                        {
                            id: 302,
                            status: 'completed',
                            conclusion: 'startup_failure',
                            event: 'schedule',
                            html_url: 'https://github.com/twoimo/tzudong/actions/runs/302',
                            created_at: '2026-08-11T18:30:00Z',
                        },
                        {
                            id: 301,
                            status: 'completed',
                            conclusion: 'success',
                            event: 'schedule',
                            html_url: 'https://github.com/twoimo/tzudong/actions/runs/301',
                            created_at: '2026-08-10T18:30:00Z',
                        },
                    ],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (endpoint.includes('/nightly-regression.yml/')) {
                return new Response(JSON.stringify({
                    total_count: 40,
                    workflow_runs: [
                        {
                            id: 402,
                            status: 'completed',
                            conclusion: 'startup_failure',
                            event: 'workflow_dispatch',
                            html_url: 'https://github.com/twoimo/tzudong/actions/runs/402',
                            created_at: '2026-08-09T18:30:00Z',
                        },
                        {
                            id: 401,
                            status: 'completed',
                            conclusion: 'failure',
                            event: 'workflow_dispatch',
                            html_url: 'https://github.com/twoimo/tzudong/actions/runs/401',
                            created_at: '2026-08-08T18:30:00Z',
                        },
                    ],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('not found', { status: 404 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);
            const local = payload.nightlyRegression?.localCanonical;
            const hosted = payload.nightlyRegression?.hostedManualFallback;

            expect(payload.nightlyRegression?.enabled).toBe(true);
            expect(payload.nightlyRegression?.configured).toBe(true);
            expect(payload.nightlyRegression?.reachable).toBe(true);
            expect(local?.workflow).toBe('nightly-local-regression.yml');
            expect(local?.latestRunId).toBe(303);
            expect(local?.latestRunConclusion).toBe('failure');
            expect(local?.consecutiveFailures).toBe(2);
            expect(local?.lastSuccessfulRunId).toBe(301);
            expect(local?.lastSuccessfulRunUrl).toBe('https://github.com/twoimo/tzudong/actions/runs/301');
            expect(hosted?.workflow).toBe('nightly-regression.yml');
            expect(hosted?.latestRunConclusion).toBe('startup_failure');
            expect(hosted?.consecutiveFailures).toBe(2);
            expect(hosted?.lastSuccessfulRunId).toBeUndefined();
            expect(hosted?.historyWindowTruncated).toBe(true);
            expect(payload.checklist.some((item) => item.id === 'nightly-local-regression-failing')).toBe(true);
            expect(payload.checklist.some((item) => item.id === 'nightly-hosted-fallback-failing')).toBe(true);
            expect(seen).toHaveLength(2);
            expect(seen.every((entry) => entry.startsWith('GET '))).toBe(true);
            expect(seen.every((entry) => entry.includes('per_page=25'))).toBe(true);
            expect(seen.every((entry) => entry.includes('branch=main'))).toBe(true);
            expect(seen.join('\n')).not.toContain('dispatches');
            expectNoSecretLeak(payload, ['nightly-read-secret-token', 'token=redacted']);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('fails closed on malformed or unreachable nightly history without returning provider bodies', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '0',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'nightly-fail-closed-token',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
            NEXT_PUBLIC_SUPABASE_URL: undefined,
            SUPABASE_SERVICE_ROLE_KEY: undefined,
        });
        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);
            if (endpoint.includes('/nightly-local-regression.yml/')) {
                return new Response(JSON.stringify({
                    workflow_runs: 'raw-provider-secret-body',
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (endpoint.includes('/nightly-regression.yml/')) {
                return new Response('raw-provider-secret-body', { status: 503 });
            }
            return new Response('not found', { status: 404 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.nightlyRegression?.reachable).toBe(false);
            expect(payload.nightlyRegression?.detail).toBe('workflow_status_unreachable');
            expect(payload.nightlyRegression?.localCanonical.detail).toBe('response_shape_invalid');
            expect(payload.nightlyRegression?.hostedManualFallback.detail).toBe('HTTP_503');
            expect(payload.nightlyRegression?.localCanonical.branch).toBe('main');
            expect(payload.nightlyRegression?.hostedManualFallback.branch).toBe('main');
            expect(payload.checklist.some((item) => item.id === 'nightly-local-status-unreachable')).toBe(true);
            expect(payload.checklist.some((item) => item.id === 'nightly-hosted-fallback-unreachable')).toBe(true);
            expectNoSecretLeak(payload, ['nightly-fail-closed-token', 'raw-provider-secret-body']);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('fails closed on malformed run rows and oversized nightly provider responses', async () => {
        const restoreEnv = withEnv({
            STORYBOARD_AGENT_ENABLED: 'false',
            STORYBOARD_BGE_ENABLED: 'false',
            INSIGHT_SYSTEM_STATUS_CACHE_TTL_MS: '0',
            RUN_DAILY_SCRIPT_PATH: '__invalid__/run_daily_missing.sh',
            INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED: '0',
            INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED: '1',
            INSIGHT_GITHUB_REPOSITORY: 'twoimo/tzudong',
            INSIGHT_GITHUB_TOKEN: 'nightly-bounded-secret-token',
            INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED: '0',
            NEXT_PUBLIC_SUPABASE_URL: undefined,
            SUPABASE_SERVICE_ROLE_KEY: undefined,
        });
        const originalFetch = global.fetch;
        global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
            const endpoint = String(input);
            if (endpoint.includes('/nightly-local-regression.yml/')) {
                return new Response(JSON.stringify({
                    total_count: 1,
                    workflow_runs: [{ raw_provider_secret: 'do-not-return' }],
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (endpoint.includes('/nightly-regression.yml/')) {
                return new Response('{}', {
                    status: 200,
                    headers: { 'Content-Length': String(256 * 1024 + 1) },
                });
            }
            return new Response('not found', { status: 404 });
        };

        try {
            const { getAdminSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminSystemStatusResponse = await getAdminSystemStatus(process.env as NodeJS.ProcessEnv);

            expect(payload.nightlyRegression?.reachable).toBe(false);
            expect(payload.nightlyRegression?.localCanonical.detail).toBe('response_shape_invalid');
            expect(payload.nightlyRegression?.hostedManualFallback.detail).toBe('REQUEST_FAILED');
            expectNoSecretLeak(payload, ['nightly-bounded-secret-token', 'do-not-return']);
        } finally {
            global.fetch = originalFetch;
            restoreEnv();
        }
    });

    test('adds stable readiness to Directions local fallback and validation errors', async () => {
        const restoreEnv = withEnv({
            NEXT_NAVER_CLIENT_ID: undefined,
            NEXT_NAVER_CLIENT_SECRET: undefined,
        });
        const originalFetch = global.fetch;
        let fetchCalls = 0;

        mock.restore();
        setAuthMock('ok');
        setProviderBudgetMock();
        global.fetch = async () => {
            fetchCalls += 1;
            throw new Error('missing credentials should not call provider');
        };

        try {
            const { POST } = await loadDirectionsRoute();
            const response = await POST(directionsRequest(
                JSON.stringify({ points: [{ lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.2 }] }),
            ) as never);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.provider).toBe('local-heuristic');
            expect(payload.fallbackReasonCode).toBe('naver-directions-credentials-missing');
            expect(payload.mode).toBe('read_only_local_heuristic');
            expect(payload.readOnly).toBe(true);
            expect(payload.path).toEqual([]);
            expect(payload.summary).toBeNull();
            expect(payload.fallbackContract).toMatchObject({
                mode: 'read_only_local_heuristic',
                readOnly: true,
                localHeuristic: true,
                roadRouteAvailable: false,
                roadDistanceTrusted: false,
                routeGeometrySource: 'none',
                distanceSource: 'none',
                providerRequestAttempted: false,
            });
            expect(fetchCalls).toBe(0);
            expect(payload.readiness.provider).toBe('naver-directions');
            expect(payload.readiness.status).toBe('unavailable');
            expect(payload.readiness.reasonCode).toBe('naver-directions-credentials-missing');
            expect(payload.readiness.diagnostics.configured).toBe(false);

            const invalidJsonResponse = await POST(directionsRequest('{not-json') as never);
            const invalidJsonPayload = await invalidJsonResponse.json();
            expect(invalidJsonResponse.status).toBe(400);
            expect(invalidJsonPayload.readiness.provider).toBe('naver-directions');
            expect(invalidJsonPayload.readiness.status).toBe('unknown');
            expect(invalidJsonPayload.readiness.reasonCode).toBe('naver-directions-request-invalid');

            const tooFewPointsResponse = await POST(directionsRequest(
                JSON.stringify({ points: [{ lat: 37.1, lng: 127.1 }] }),
            ) as never);
            const tooFewPointsPayload = await tooFewPointsResponse.json();
            expect(tooFewPointsResponse.status).toBe(400);
            expect(tooFewPointsPayload.readiness.provider).toBe('naver-directions');
            expect(tooFewPointsPayload.readiness.status).toBe('unknown');
            expect(tooFewPointsPayload.readiness.reasonCode).toBe('naver-directions-points-invalid');
            expect(tooFewPointsPayload.readiness.diagnostics.validPointCount).toBe(1);
        } finally {
            mock.restore();
            restoreEnv();
            global.fetch = originalFetch;
        }
    });

    test('adds redacted Directions readiness for provider auth failure, provider non-OK, and fetch exceptions', async () => {
        const restoreEnv = withEnv({
            NEXT_NAVER_CLIENT_ID: 'naver-client-id',
            NEXT_NAVER_CLIENT_SECRET: 'naver-client-secret-no-leak',
        });
        const originalFetch = global.fetch;
        let fetchCalls = 0;

        mock.restore();
        setAuthMock('ok');
        setProviderBudgetMock();

        const requestBody = JSON.stringify({
            points: [{ lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.2 }],
        });

        try {
            const { POST } = await loadDirectionsRoute();

            global.fetch = async () => {
                fetchCalls += 1;
                return new Response('raw provider body naver-client-secret-no-leak', { status: 401 });
            };
            const authResponse = await POST(directionsRequest(requestBody) as never);
            const authPayload = await authResponse.json();
            expect(authPayload.provider).toBe('local-heuristic');
            expect(authPayload.fallbackReasonCode).toBe('naver-directions-auth-failed');
            expect(authPayload.mode).toBe('read_only_local_heuristic');
            expect(authPayload.readOnly).toBe(true);
            expect(authPayload.path).toEqual([]);
            expect(authPayload.summary).toBeNull();
            expect(authPayload.fallbackContract).toMatchObject({
                fallbackReasonCode: 'naver-directions-auth-failed',
                roadRouteAvailable: false,
                roadDistanceTrusted: false,
                providerRequestAttempted: true,
            });
            expect(fetchCalls).toBe(1);
            expect(authPayload.readiness.status).toBe('unavailable');
            expect(authPayload.readiness.reasonCode).toBe('naver-directions-auth-failed');
            expect(JSON.stringify(authPayload)).not.toContain('naver-client-secret-no-leak');
            expect(JSON.stringify(authPayload)).not.toContain('raw provider body');

            global.fetch = async () => {
                fetchCalls += 1;
                return new Response('raw provider body naver-client-secret-no-leak', { status: 429 });
            };
            const nonOkResponse = await POST(directionsRequest(requestBody) as never);
            const nonOkPayload = await nonOkResponse.json();
            expect(nonOkResponse.status).toBe(429);
            expect(nonOkPayload.error).toBe('Naver Directions request failed');
            expect(nonOkPayload.message).toBe('Unable to calculate route');
            expect(nonOkPayload.readiness.status).toBe('degraded');
            expect(nonOkPayload.readiness.reasonCode).toBe('naver-directions-provider-non-ok');
            expect(nonOkPayload.readiness.diagnostics.httpStatus).toBe(429);
            expect(fetchCalls).toBe(2);
            expect(JSON.stringify(nonOkPayload)).not.toContain('raw provider body');
            expect(JSON.stringify(nonOkPayload)).not.toContain('naver-client-secret-no-leak');

            global.fetch = async () => {
                throw new Error('raw network naver-client-secret-no-leak');
            };
            const exceptionResponse = await POST(directionsRequest(requestBody) as never);
            const exceptionPayload = await exceptionResponse.json();
            expect(exceptionResponse.status).toBe(500);
            expect(exceptionPayload.readiness.status).toBe('unavailable');
            expect(exceptionPayload.readiness.reasonCode).toBe('naver-directions-request-failed');
            expect(JSON.stringify(exceptionPayload)).not.toContain('naver-client-secret-no-leak');
            expect(JSON.stringify(exceptionPayload)).not.toContain('raw network');
        } finally {
            global.fetch = originalFetch;
            mock.restore();
            restoreEnv();
        }
    });
});

function buildTestProviderReadiness(): AdminSystemStatusResponse['providerReadiness'] {
    return {
        'naver-directions': {
            provider: 'naver-directions',
            status: 'ready',
            reasonCode: 'naver-directions-ready',
            checkedAt: '2026-06-21T00:00:00.000Z',
            remediation: 'ready',
            diagnostics: {},
        },
        'youtube-thumbnail-durable-release': {
            provider: 'youtube-thumbnail-durable-release',
            status: 'ready',
            reasonCode: 'thumbnail-durable-release-ready',
            checkedAt: '2026-06-21T00:00:00.000Z',
            remediation: 'ready',
            diagnostics: {},
        },
    };
}

function buildStatusCenterPayload(
    runDailyPatch: Partial<NonNullable<AdminSystemStatusResponse['runDaily']>> = {},
): AdminSystemStatusResponse {
    return {
        asOf: '2026-06-21T00:00:00.000Z',
        keys: {
            supabaseUrl: true,
            supabaseServiceRoleKey: true,
            geminiServerKey: true,
            openaiServerKey: true,
            anthropicServerKey: true,
            nanoBanana2Key: true,
        },
        storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
        bgeEmbedding: { enabled: false, configured: false, reachable: false, checkedAt: '2026-06-21T00:00:00.000Z' },
        frameCaption: { configured: true, localPathConfigured: true, localPathAvailable: true, gdrivePathConfigured: false, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
        runDaily: {
            executable: true,
            latestManifestPath: '/tmp/current-summary.json',
            latestLogPath: '/tmp/daily.log',
            finalStatus: 'OK',
            failedRequiredSteps: [],
            optionalSkips: [],
            downstreamSkips: [],
            stale: false,
            checkedAt: '2026-06-21T00:00:00.000Z',
            ...runDailyPatch,
        },
        providerReadiness: buildTestProviderReadiness(),
        checklist: [],
    };
}
describe('admin system status center view model', () => {
    test('renders healthy only when all evidence is current, complete, and queues are empty', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel(buildStatusCenterPayload({
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        }), { submissions: 0, reviews: 0 });

        expect(viewModel.overallState).toBe('healthy');
        expect(viewModel.metrics.every((metric) => metric.state === 'healthy')).toBe(true);
    });

    test('fails closed when run_daily evidence is stale', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel(buildStatusCenterPayload({
            stale: true,
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        }), { submissions: 0, reviews: 0 });

        expect(viewModel.overallState).toBe('degraded');
        expect(viewModel.metrics.find((metric) => metric.id === 'run_daily')?.state).toBe('degraded');
        expect(viewModel.metrics.find((metric) => metric.id === 'artifacts')?.state).toBe('degraded');
    });

    test('surfaces nightly current conclusion, failure streak, and last success as degraded', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const status = buildStatusCenterPayload({
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        });
        status.nightlyRegression = {
            enabled: true,
            configured: true,
            reachable: true,
            repositoryConfigured: true,
            tokenConfigured: true,
            localCanonical: {
                role: 'canonical-local',
                workflow: 'nightly-local-regression.yml',
                reachable: true,
                latestRunId: 303,
                latestRunStatus: 'completed',
                latestRunConclusion: 'failure',
                lastSuccessfulRunId: 301,
                lastSuccessfulRunCreatedAt: '2026-08-10T18:30:00.000Z',
                consecutiveFailures: 2,
                examinedRuns: 3,
                historyWindowTruncated: false,
                checkedAt: status.asOf,
            },
            hostedManualFallback: {
                role: 'hosted-manual-fallback',
                workflow: 'nightly-regression.yml',
                reachable: true,
                latestRunId: 401,
                latestRunStatus: 'completed',
                latestRunConclusion: 'success',
                lastSuccessfulRunId: 401,
                consecutiveFailures: 0,
                examinedRuns: 1,
                historyWindowTruncated: false,
                checkedAt: status.asOf,
            },
            checkedAt: status.asOf,
        };

        const viewModel = buildAdminStatusCenterViewModel(status, { submissions: 0, reviews: 0 });
        const nightlyMetric = viewModel.metrics.find((metric) => metric.id === 'nightly');

        expect(viewModel.overallState).toBe('degraded');
        expect(nightlyMetric?.state).toBe('degraded');
        expect(nightlyMetric?.value).toContain('failure');
        expect(nightlyMetric?.detail).toContain('최신 #303 failure');
        expect(nightlyMetric?.detail).toContain('연속 실패 2회');
        expect(nightlyMetric?.detail).toContain('마지막 성공 #301');
        expect(nightlyMetric?.detail).toContain('호스티드 수동 fallback');
    });

    test('keeps WARN and skipped run_daily evidence partial instead of healthy', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel(buildStatusCenterPayload({
            finalStatus: 'WARN',
            optionalSkips: ['gdrive_upload'],
            downstreamSkips: ['admin_data_quality'],
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        }), { submissions: 0, reviews: 0 });

        expect(viewModel.overallState).toBe('partial');
        expect(viewModel.metrics.find((metric) => metric.id === 'run_daily')?.state).toBe('partial');
        expect(viewModel.metrics.find((metric) => metric.id === 'gdrive')?.state).toBe('healthy');
    });
    test('keeps UNKNOWN run_daily final status out of healthy state', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel(buildStatusCenterPayload({
            finalStatus: 'UNKNOWN',
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        }), { submissions: 0, reviews: 0 });

        expect(viewModel.overallState).toBe('unknown');
        expect(viewModel.metrics.find((metric) => metric.id === 'run_daily')?.state).toBe('unknown');
        expect(viewModel.metrics.find((metric) => metric.id === 'artifacts')?.state).toBe('healthy');
    });
    test('fails closed when manifest evidence is missing', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel({
            asOf: '2026-06-21T00:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            bgeEmbedding: { enabled: false, configured: false, reachable: false, checkedAt: '2026-06-21T00:00:00.000Z' },
            frameCaption: { configured: true, localPathConfigured: true, localPathAvailable: true, gdrivePathConfigured: false, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            runDaily: {
                executable: true,
                latestLogPath: '/tmp/daily.log',
                failedRequiredSteps: [],
                optionalSkips: [],
                downstreamSkips: [],
                stale: false,
                checkedAt: '2026-06-21T00:00:00.000Z',
            },
            providerReadiness: buildTestProviderReadiness(),
            checklist: [],
        }, { submissions: 0, reviews: 0 });

        expect(viewModel.overallState).toBe('degraded');
        expect(viewModel.metrics.find((metric) => metric.id === 'run_daily')?.state).toBe('degraded');
        expect(viewModel.metrics.find((metric) => metric.id === 'artifacts')?.value).toBe('manifest 없음');
    });

    test('treats malformed manifest reads as unknown instead of healthy', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel({
            asOf: '2026-06-21T00:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            bgeEmbedding: { enabled: false, configured: false, reachable: false, checkedAt: '2026-06-21T00:00:00.000Z' },
            frameCaption: { configured: true, localPathConfigured: true, localPathAvailable: true, gdrivePathConfigured: false, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            runDaily: {
                executable: true,
                latestManifestPath: '/tmp/current-summary.json',
                latestLogPath: '/tmp/daily.log',
                detail: 'Unexpected token',
                failedRequiredSteps: [],
                optionalSkips: [],
                downstreamSkips: [],
                stale: false,
                checkedAt: '2026-06-21T00:00:00.000Z',
            },
            providerReadiness: buildTestProviderReadiness(),
            checklist: [],
        }, { submissions: 1, reviews: 2 });

        expect(viewModel.overallState).not.toBe('healthy');
        expect(viewModel.metrics.find((metric) => metric.id === 'artifacts')?.state).toBe('unknown');
        expect(viewModel.metrics.find((metric) => metric.id === 'run_daily')?.value).toBe('읽기 실패');
    });

    test('keeps partial GDrive proof and pending work out of healthy state', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel({
            asOf: '2026-06-21T00:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            bgeEmbedding: { enabled: false, configured: false, reachable: false, checkedAt: '2026-06-21T00:00:00.000Z' },
            frameCaption: { configured: true, localPathConfigured: true, localPathAvailable: true, gdrivePathConfigured: false, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            runDaily: {
                executable: true,
                latestManifestPath: '/tmp/current-summary.json',
                latestLogPath: '/tmp/daily.log',
                finalStatus: 'OK',
                failedRequiredSteps: [],
                optionalSkips: [],
                downstreamSkips: [],
                gdriveUpload: {
                    status: 'backfill_required',
                    terminalIncomplete: true,
                    completionProof: 'rclone_exit_zero',
                },
                stale: false,
                checkedAt: '2026-06-21T00:00:00.000Z',
            },
            providerReadiness: buildTestProviderReadiness(),
            checklist: [],
        }, { submissions: 3, reviews: 4 });

        expect(viewModel.overallState).toBe('partial');
        expect(viewModel.metrics.find((metric) => metric.id === 'gdrive')?.state).toBe('partial');
        expect(viewModel.metrics.find((metric) => metric.id === 'pending')?.value).toBe('7건');
    });

    test('surfaces canonical pending-count domains and lifecycle degraded state', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel(buildStatusCenterPayload({
            gdriveUpload: {
                status: 'complete',
                terminalIncomplete: false,
                completionProof: 'remote_size_check',
            },
        }), {
            submissions: 5,
            recommendationRequests: 2,
            reviews: 4,
            recommendationRequestsLifecycleReady: false,
            total: 9,
            domains: {
                restaurant_submissions: {
                    id: 'restaurant_submissions',
                    count: 3,
                    ready: true,
                    status: 'ready',
                },
                restaurant_recommendation_requests: {
                    id: 'restaurant_recommendation_requests',
                    count: 2,
                    ready: false,
                    status: 'degraded',
                },
                reviews: {
                    id: 'reviews',
                    count: 4,
                    ready: true,
                    status: 'ready',
                },
            },
            readiness: {
                status: 'degraded',
                recommendationRequestsLifecycleReady: false,
            },
        });

        const pendingMetric = viewModel.metrics.find((metric) => metric.id === 'pending');
        expect(viewModel.overallState).toBe('degraded');
        expect(pendingMetric?.state).toBe('degraded');
        expect(pendingMetric?.value).toBe('9건');
        expect(pendingMetric?.detail).toContain('제보 3건 · 추천 2건 · 리뷰 4건');
        expect(pendingMetric?.detail).toContain('lifecycle 확인 필요');
    });

    test('keeps missing log or unreadable pending counts out of healthy state', async () => {
        const { buildAdminStatusCenterViewModel } = await import(`../lib/admin/system-status/view-model.ts?cache=${Math.random()}`);
        const viewModel = buildAdminStatusCenterViewModel({
            asOf: '2026-06-21T00:00:00.000Z',
            keys: {
                supabaseUrl: true,
                supabaseServiceRoleKey: true,
                geminiServerKey: true,
                openaiServerKey: true,
                anthropicServerKey: true,
                nanoBanana2Key: true,
            },
            storyboardAgent: { enabled: true, configured: true, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            bgeEmbedding: { enabled: false, configured: false, reachable: false, checkedAt: '2026-06-21T00:00:00.000Z' },
            frameCaption: { configured: true, localPathConfigured: true, localPathAvailable: true, gdrivePathConfigured: false, reachable: true, checkedAt: '2026-06-21T00:00:00.000Z' },
            runDaily: {
                executable: true,
                latestManifestPath: '/tmp/current-summary.json',
                finalStatus: 'OK',
                failedRequiredSteps: [],
                optionalSkips: [],
                downstreamSkips: [],
                stale: false,
                checkedAt: '2026-06-21T00:00:00.000Z',
            },
            providerReadiness: buildTestProviderReadiness(),
            checklist: [],
        }, { submissions: null, reviews: null });

        expect(viewModel.overallState).not.toBe('healthy');
        expect(viewModel.metrics.find((metric) => metric.id === 'artifacts')?.value).toBe('로그 없음');
        expect(viewModel.metrics.find((metric) => metric.id === 'pending')?.state).toBe('unknown');
    });
});
