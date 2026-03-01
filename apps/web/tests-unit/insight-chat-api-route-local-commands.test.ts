import { expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

type AuthState = 'ok' | 'unauthorized' | 'forbidden';

type MockLocalInsightResponse = {
  asOf: string;
  content: string;
  sources: unknown[];
  visualComponent?: 'heatmap';
  meta: {
    source: string;
    toolTrace?: string[];
    requestId?: string;
    systemStatusHints?: string[];
    responseMode?: string;
    memoryMode?: string;
  };
};

type StreamAdminInsightChatMockResult =
  | { local: MockLocalInsightResponse }
  | { stream: ReadableStream<Uint8Array> };

const localCommandFixtures = [
  {
    label: 'setup checklist',
    message: '/setup',
    expectedToolTrace: 'local:setup-checklist',
  },
  {
    label: 'operator todo',
    message: '/operator-todo',
    expectedToolTrace: 'local:operator-todo',
  },
  {
    label: 'ops status',
    message: '/ops-status',
    expectedToolTrace: 'local:ops-status',
  },
  {
    label: 'peak-frame',
    message: '/tzuyang-peak-frame 피크 프레임 구간에서 후킹/클로징 보강 컷을 제안해줘',
    expectedToolTrace: 'local:peak-frame',
    hasVisualComponent: true,
  },
] as const;

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

function setLocalInsightChatMocks() {
  const resolveLocalRouteFixture = (message: string) => {
    const fixture = localCommandFixtures.find((entry) =>
      message === entry.message || message === `${entry.message} `,
    );

    const commandToolTrace = fixture?.expectedToolTrace;
    if (!commandToolTrace) {
      return null;
    }

    return {
      message: `local response for ${fixture.label}`,
      meta: {
        source: 'local',
        requestId: `route-${fixture.expectedToolTrace.replace(':', '-')}`,
        toolTrace: [commandToolTrace],
        memoryMode: 'off',
      },
      hasVisualComponent: commandToolTrace === 'local:peak-frame',
      commandToolTrace,
    };
  };

  mock.module('@/lib/insight/chat', () => ({
    answerAdminInsightChat: async (message: string, _llmConfig: unknown, requestId: string | undefined) => {
      const resolved = resolveLocalRouteFixture(message);
      if (!resolved) {
        return {
          asOf: '2026-02-27T00:00:00.000Z',
          content: `chat-response:${message}`,
          sources: [],
          meta: {
            source: 'mock',
            requestId,
            toolTrace: ['provider:gemini'],
          },
        } as MockLocalInsightResponse;
      }

      return {
        asOf: '2026-02-27T00:00:00.000Z',
        content: resolved.message,
        sources: [],
      ...(resolved.hasVisualComponent ? { visualComponent: 'heatmap' as const } : {}),
      meta: {
        ...resolved.meta,
        requestId,
      },
    } as MockLocalInsightResponse;
    },
    streamAdminInsightChat: async (message: string, _llmConfig: unknown, _signal: AbortSignal | undefined, requestId: string | undefined) => {
      const resolved = resolveLocalRouteFixture(message);
      if (!resolved) {
        return {
          stream: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('data: [DONE]\\n\\n'));
              controller.close();
            },
          }),
        } as StreamAdminInsightChatMockResult;
      }

      return {
        local: {
          asOf: '2026-02-27T00:00:00.000Z',
          content: resolved.message,
          sources: [],
          ...(resolved.hasVisualComponent ? { visualComponent: 'heatmap' as const } : {}),
          meta: {
            ...resolved.meta,
            fallbackReason: undefined,
            requestId,
            source: 'local',
          },
        },
      } as StreamAdminInsightChatMockResult;
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

test('chat route preserves local setup/operator/ops-status/peak-frame responses', async () => {
  mock.restore();
  setAuthMock('ok');
  setLocalInsightChatMocks();

  const { POST: chatPOST } = await import('@/app/api/admin/insight/chat/route');

  for (const fixture of localCommandFixtures) {
    const response = await chatPOST(
      createRequest('/api/admin/insight/chat', {
        message: fixture.message,
        requestId: `local-chat-${fixture.expectedToolTrace.replace(':', '-')}`,
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.meta?.source).toBe('local');
    expect(payload.meta?.toolTrace).toContain(fixture.expectedToolTrace);
    expect(payload.meta?.requestId).toBe(`local-chat-${fixture.expectedToolTrace.replace(':', '-')}`);
    if (fixture.expectedToolTrace === 'local:peak-frame') {
      expect(payload.visualComponent).toBe('heatmap');
    }
  }

  mock.restore();
});

test('stream route preserves local setup/operator/ops-status/peak-frame responses', async () => {
  mock.restore();
  setAuthMock('ok');
  setLocalInsightChatMocks();

  const { POST: streamPOST } = await import('@/app/api/admin/insight/chat/stream/route');

  for (const fixture of localCommandFixtures) {
    const response = await streamPOST(
      createRequest('/api/admin/insight/chat/stream', {
        message: fixture.message,
        requestId: `local-stream-${fixture.expectedToolTrace.replace(':', '-')}`,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const payload = await response.json();
    expect(payload.meta?.source).toBe('local');
    expect(payload.meta?.toolTrace).toContain(fixture.expectedToolTrace);
    expect(payload.meta?.requestId).toBe(`local-stream-${fixture.expectedToolTrace.replace(':', '-')}`);
    if (fixture.expectedToolTrace === 'local:peak-frame') {
      expect(payload.visualComponent).toBe('heatmap');
    }
  }

  mock.restore();
});
