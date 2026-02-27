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
    };
};

type AuthState = 'ok' | 'unauthorized' | 'forbidden';
type StreamResponseMode = 'error' | 'local' | 'stream';

function installChatRouteMocks(requireAdminState: AuthState, streamResponseMode: StreamResponseMode) {
    mock.module('@/lib/auth/require-admin', () => ({
        requireAdmin: async () => {
            if (requireAdminState === 'ok') {
                return { ok: true, userId: 'admin-user' };
            }

            return {
                ok: false,
                response:
                    requireAdminState === 'unauthorized'
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

    mock.module('@/lib/insight/chat', () => ({
        answerAdminInsightChat: async (message: string, _llmConfig: unknown, requestId?: string) => {
            if (message === '__chat_throw__') {
                throw new Error('mocked chat error');
            }

            return {
                asOf: '2026-02-27T00:00:00.000Z',
                content: `chat-response:${message}`,
                sources: [],
                meta: {
                    source: 'mock',
                    requestId: requestId || message.slice(0, 64) || undefined,
                },
            } as MockInsightResponse;
        },
        streamAdminInsightChat: async (_message: string, _llmConfig: unknown, _signal: AbortSignal | undefined, requestId?: string) => {
            if (streamResponseMode === 'error') {
                throw new Error('mocked stream error');
            }

            if (streamResponseMode === 'stream') {
                const encoder = new TextEncoder();
                return {
                    stream: new ReadableStream({
                        start(controller) {
                            controller.enqueue(encoder.encode(`data: {"text":"hello","requestId":"${requestId || 'stream-pass'}"}\n\n`));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                            controller.close();
                        },
                    }),
                };
            }

            return {
                local: {
                    asOf: '2026-02-27T00:00:00.000Z',
                    content: 'stream-local-fallback',
                    sources: [],
                    meta: {
                        source: 'fallback',
                        fallbackReason: 'llm_unavailable',
                        requestId: requestId || 'stream-local',
                    },
                } as MockInsightResponse,
            };
        },
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

async function readStreamText(streamBody: ReadableStream | null): Promise<string> {
    if (!streamBody) return '';

    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let chunkText = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunkText += decoder.decode(value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    return chunkText;
}

test('insight chat API routes (mocked runtime harness)', async () => {
    let requireAdminState: AuthState = 'ok';
    let streamResponseMode: StreamResponseMode = 'local';

    mock.restore();
    installChatRouteMocks(requireAdminState, streamResponseMode);

    const { POST: chatPOST } = await import('@/app/api/admin/insight/chat/route');
    const { POST: streamPOST } = await import('@/app/api/admin/insight/chat/stream/route');
    const { GET: bootstrapGET } = await import('@/app/api/admin/insight/chat/bootstrap/route');

    try {
        // unauthorized/forbidden should be passed through without handler processing
        requireAdminState = 'unauthorized';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        let response = await chatPOST(createRequest('/api/admin/insight/chat', { message: '테스트' }));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized' });

        requireAdminState = 'forbidden';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await streamPOST(createRequest('/api/admin/insight/chat/stream', { message: '테스트' }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });

        // empty input still returns API fallback payload
        requireAdminState = 'ok';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await chatPOST(createRequest('/api/admin/insight/chat', { message: '   ', requestId: 'req-abc' }));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            content: '질문을 입력해 주세요.',
            meta: {
                source: 'fallback',
                fallbackReason: 'empty_input',
                requestId: 'req-abc',
            },
        });

        // happy path uses mocked service and keeps requestId
        response = await chatPOST(createRequest('/api/admin/insight/chat', {
            message: '인기 키워드',
            requestId: 'req-123',
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            content: 'chat-response:인기 키워드',
            meta: {
                requestId: 'req-123',
            },
        });

        // route-level exception should map to server_error fallback
        response = await chatPOST(createRequest('/api/admin/insight/chat', { message: '__chat_throw__' }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            meta: {
                source: 'fallback',
                fallbackReason: 'server_error',
            },
        });

        // stream local fallback
        streamResponseMode = 'local';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await streamPOST(createRequest('/api/admin/insight/chat/stream', {
            message: '조회수',
            requestId: 'stream-local',
        }));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toMatchObject({
            content: 'stream-local-fallback',
            meta: {
                source: 'fallback',
                fallbackReason: 'llm_unavailable',
            },
        });

        // stream passthrough should send SSE-formatted bytes
        streamResponseMode = 'stream';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await streamPOST(createRequest('/api/admin/insight/chat/stream', {
            message: '조회수 추적',
            requestId: 'stream-pass',
        }));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const body = await readStreamText(response.body);
        expect(body).toContain('data: {"text":"hello","requestId":"stream-pass"}');
        expect(body).toContain('data: [DONE]');

        // stream handler error -> fallback payload
        streamResponseMode = 'error';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await streamPOST(createRequest('/api/admin/insight/chat/stream', { message: '안녕' }));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toMatchObject({
            meta: {
                source: 'fallback',
                fallbackReason: 'stream_error',
            },
        });

        // bootstrap route success and auth passthrough
        response = await bootstrapGET(new NextRequest('http://localhost:8080/api/admin/insight/chat/bootstrap'));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            asOf: '2026-02-27T00:00:00.000Z',
            message: {
                content: 'mock bootstrap',
            },
        });

        requireAdminState = 'forbidden';
        installChatRouteMocks(requireAdminState, streamResponseMode);
        response = await bootstrapGET(new NextRequest('http://localhost:8080/api/admin/insight/chat/bootstrap'));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Forbidden' });
    } finally {
        mock.restore();
    }
});
