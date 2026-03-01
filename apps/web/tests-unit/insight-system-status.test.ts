import { describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

function withTempDir(prefix: string): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
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

function expectChecklistHasCommand(payload: WithChecklist, id: string, expectedFragment: string) {
    const item = findChecklistItem(payload, id);
    expect(item).toBeDefined();
    const command = item?.command ?? item?.commandSnippet;
    expect(typeof command).toBe('string');
    expect(command?.trim()).toContain(expectedFragment);
}

function expectNoSecretLeak(payload: AdminInsightSystemStatusResponse, secrets: string[]) {
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
                    'run_daily 자동 수집 파이프라인이 감지되지 않았습니다. 운영 서버에서 `backend/run_daily.sh`(또는 RUN_DAILY_SCRIPT_PATH)를 배치하고, `chmod +x` 후 crontab(`0 4 * * * /path/to/backend/run_daily.sh >> ...`)에 등록해 실행되게 설정하세요.',
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
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

            expectChecklistHasCommand(payload, 'run-daily-script-missing', 'run_daily.sh');
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

            if (endpoint.includes('bge.example.com')) {
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response('not found', { status: 500, headers: { 'Content-Type': 'text/plain' } });
        };

        try {
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

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
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

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
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

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
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

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
            const { getAdminInsightSystemStatus } = await loadSystemStatusHelper();
            const payload: AdminInsightSystemStatusResponse = await getAdminInsightSystemStatus(process.env as NodeJS.ProcessEnv);

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

        try {
            const { GET } = await loadSystemStatusRoute();
            const response = await GET();
            expect(response.status).toBe(200);
            expect(response.headers.get('Cache-Control')).toBe('no-store');

            const payload = (await response.json()) as AdminInsightSystemStatusResponse;
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
});
