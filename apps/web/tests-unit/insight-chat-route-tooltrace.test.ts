import { expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

type MockInsightResponse = {
    asOf: string;
    content: string;
    sources: unknown[];
    meta: {
        source: string;
        fallbackReason?: string;
        requestId?: string;
        toolTrace?: unknown[];
    };
};

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

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

function setChatRouteMocks(overrides?: {
    chatToolTrace?: unknown[];
    streamLocalToolTrace?: unknown[];
}) {
    mock.module('@/lib/insight/chat', () => ({
        answerAdminInsightChat: async (
            _message: string,
            _llmConfig: unknown,
            requestId: string | undefined,
        ) => ({
            asOf: '2026-02-27T00:00:00.000Z',
            content: 'chat-success',
            sources: [],
            meta: {
                source: 'mock',
                requestId,
                ...(overrides?.chatToolTrace ? { toolTrace: overrides.chatToolTrace } : {}),
            },
        }) as MockInsightResponse,
        streamAdminInsightChat: async (
            _message: string,
            _llmConfig: unknown,
            _signal: AbortSignal | undefined,
            requestId: string | undefined,
        ) => ({
            local: {
                asOf: '2026-02-27T00:00:00.000Z',
                content: 'stream-local-fallback',
                sources: [],
                meta: {
                    source: 'fallback',
                    fallbackReason: 'llm_unavailable',
                    requestId,
                    ...(overrides?.streamLocalToolTrace ? { toolTrace: overrides.streamLocalToolTrace } : {}),
                },
            } as MockInsightResponse,
        }),
        getAdminInsightChatBootstrap: async () => ({
            asOf: '2026-02-27T00:00:00.000Z',
            message: {
                content: 'mock bootstrap',
                sources: [],
            },
        }),
    }));
}

function createRequest(path: string, body?: Record<string, unknown>) {
    return new NextRequest(`http://localhost:8080${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
}

test('chat route normalizes mixed toolTrace entries and keeps memory mode context', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;

    mock.restore();
    setAuthMock('ok');
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'false';
    setChatRouteMocks({
        chatToolTrace: ['  route:chat ', 'provider:openai', '', 'provider:openai', 'memoryMode:session'],
    });
    const { POST } = await import('@/app/api/admin/insight/chat/route');

    try {
        const response = await POST(createRequest('/api/admin/insight/chat', {
            message: '안녕',
            requestId: 'trace-chat',
            memoryMode: 'session',
        }));
        expect(response.status).toBe(200);

        const payload = await response.json();
        expect(payload.meta.toolTrace).toEqual(['route:chat', 'provider:openai', 'memoryMode:session']);
    } finally {
        if (typeof originalGuardrailsEnabled === 'undefined') {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        mock.restore();
    }
});

test('stream route normalizes local fallback toolTrace and deduplicates memory mode entries', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;

    mock.restore();
    setAuthMock('ok');
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'false';
    setChatRouteMocks({
        streamLocalToolTrace: ['  route:stream ', 'provider:gemini', '', 'memoryMode:session', 'provider:gemini'],
    });
    const { POST } = await import('@/app/api/admin/insight/chat/stream/route');

    try {
        const response = await POST(createRequest('/api/admin/insight/chat/stream', {
            message: '안녕',
            requestId: 'trace-stream',
            memoryMode: 'session',
        }));
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.meta.toolTrace).toEqual(['route:stream', 'provider:gemini', 'memoryMode:session']);
    } finally {
        if (typeof originalGuardrailsEnabled === 'undefined') {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        mock.restore();
    }
});

test('stream local fallback keeps route tooltrace consistent with memory mode and strips dirty entries', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;

    mock.restore();
    setAuthMock('ok');
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'false';
    setChatRouteMocks({
        streamLocalToolTrace: ['  route:stream ', 'provider:gemini', '', 'memoryMode:session', 'provider:gemini', 100],
    });
    const { POST } = await import('@/app/api/admin/insight/chat/stream/route');

    try {
        const response = await POST(createRequest('/api/admin/insight/chat/stream', {
            message: '안녕',
            requestId: 'trace-stream-success',
            memoryMode: 'session',
        }));
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.meta.toolTrace).toEqual([
            'route:stream',
            'provider:gemini',
            'memoryMode:session',
        ]);
    } finally {
        if (typeof originalGuardrailsEnabled === 'undefined') {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        mock.restore();
    }
});

test('chat route normalizes mixed success toolTrace payload and keeps requested memory mode', async () => {
    const originalGuardrailsEnabled = process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;

    mock.restore();
    setAuthMock('ok');
    process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = 'false';
    setChatRouteMocks({
        chatToolTrace: ['  route:chat ', 'provider:openai', '', 'provider:openai', 'request.timeout', 'memoryMode:session'],
    });
    const { POST } = await import('@/app/api/admin/insight/chat/route');

    try {
        const response = await POST(createRequest('/api/admin/insight/chat', {
            message: '안녕',
            requestId: 'trace-chat-success',
            memoryMode: 'session',
        }));
        expect(response.status).toBe(200);

        const payload = await response.json();
        expect(payload.meta.toolTrace).toEqual([
            'route:chat',
            'provider:openai',
            'request.timeout',
            'memoryMode:session',
        ]);
    } finally {
        if (typeof originalGuardrailsEnabled === 'undefined') {
            delete process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED;
        } else {
            process.env.INSIGHT_CHAT_GUARDRAILS_ENABLED = originalGuardrailsEnabled;
        }
        mock.restore();
    }
});
