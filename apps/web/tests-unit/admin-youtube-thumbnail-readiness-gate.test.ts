import { describe, expect, mock, test } from 'bun:test';
import type { NextRequest } from 'next/server';
import * as actualRetrieval from '../lib/admin/youtube-thumbnail-generator/retrieval';
import * as actualBackendAgent from '../lib/admin/youtube-thumbnail-generator/backend-agent';
import * as actualProviders from '../lib/admin/youtube-thumbnail-generator/providers';
import * as actualAnyCapReadiness from '../lib/admin/anycap-gpt-image-readiness';

const nonReadyAnyCap = {
  providerId: 'anycap' as const,
  model: 'gpt-image-2' as const,
  strictExactModelRequired: true as const,
  fallbackAllowed: false as const,
  status: 'auth_required' as const,
  reason: 'AnyCap authentication is required before gpt-image-2 generation.',
  trace: {
    checkedAt: '2026-07-04T00:00:00.000Z',
    requestedModel: 'gpt-image-2',
    statusCommand: ['anycap', 'status'],
    statusExitCode: 1,
    modelsCommand: ['anycap', 'image', 'models'],
    modelsExitCode: 0,
    snippets: ['please log in'],
  },
  remediation: ['Run anycap login and confirm anycap image models lists gpt-image-2.'],
};

const safePayload = {
  providerId: 'local-codex',
  generationMode: 'direct_provider',
  topic: '부산 야시장 길거리 음식',
  headline: '역대급 먹방',
  subHeadline: '한입만 가능?',
  stylePreset: 'night-market-reaction',
  referenceImageRoles: [],
  acknowledgedSafety: true,
  textLayers: [],
};

async function multipartThumbnailRequest(payload: unknown) {
  const boundary = '----TzudongThumbnailBoundary';
  const bytes = new TextEncoder().encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="payload"\r\n\r\n'
    + `${JSON.stringify(payload)}\r\n`
    + `--${boundary}--\r\n`,
  );

  return new Request('http://localhost/api/admin/youtube-thumbnail-generator', {
    method: 'POST',
    body: bytes,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(bytes.byteLength),
      Origin: 'http://localhost',
      'Sec-Fetch-Site': 'same-origin',
    },
  }) as unknown as NextRequest;
}

describe('thumbnail AnyCap gpt-image-2 readiness gate', () => {
  test('maps AnyCap non-ready state to an exact typed blocker without fallback', async () => {
    const { buildThumbnailProviderReadinessBlocker } = await import('../lib/admin/youtube-thumbnail-generator/readiness-gate');

    const blocker = buildThumbnailProviderReadinessBlocker(nonReadyAnyCap);

    expect(blocker).toMatchObject({
      error: 'provider_unavailable',
      code: 'thumbnail_anycap_gpt_image_2_not_ready',
      readiness: {
        providerId: 'anycap',
        model: 'gpt-image-2',
        strictExactModelRequired: true,
        fallbackAllowed: false,
        status: 'auth_required',
        reason: nonReadyAnyCap.reason,
        remediation: nonReadyAnyCap.remediation,
        diagnostics: {
          requestedModel: 'gpt-image-2',
          snippets: ['please log in'],
        },
      },
    });
  });

  test('retired direct POST cannot start readiness probes, retrieval or any provider generation', async () => {
    let readinessCalls = 0;
    let retrievalCalls = 0;
    let providerCalls = 0;
    let backendAgentCalls = 0;

    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: 'admin-user' }),
    }));
    mock.module('@/lib/admin/anycap-gpt-image-readiness', () => ({
      ...actualAnyCapReadiness,
      probeAnyCapGptImageReadiness: async () => {
        readinessCalls += 1;
        return nonReadyAnyCap;
      },
    }));
    mock.module('@/lib/admin/youtube-thumbnail-generator/retrieval', () => ({
      ...actualRetrieval,
      resolveThumbnailRetrievalReferences: async () => {
        retrievalCalls += 1;
        throw new Error('retrieval should not run when readiness blocks');
      },
    }));
    mock.module('@/lib/admin/youtube-thumbnail-generator/providers', () => ({
      ...actualProviders,
      generateYoutubeThumbnail: async () => {
        providerCalls += 1;
        throw new Error('provider should not run when readiness blocks');
      },
    }));
    mock.module('@/lib/admin/youtube-thumbnail-generator/backend-agent', () => ({
      ...actualBackendAgent,
      generateYoutubeThumbnailWithBackendAgent: async () => {
        backendAgentCalls += 1;
        throw new Error('backend agent should not run when readiness blocks');
      },
    }));

    try {
      // Auth is an explicit seam. A cached default factory must not depend on
      // global module mocks or try to read Next cookies outside request scope.
      const { createRetiredThumbnailGenerationApi } = await import('../lib/admin/youtube-thumbnail-generator/retired-api');
      const route = createRetiredThumbnailGenerationApi((async () => ({ ok: true,
        userId: '6f5d42d6-d122-4d32-b8bb-2779de58b423' })) as never);
      const response = await route.POST(await multipartThumbnailRequest(safePayload));
      const payload = await response.json();

      expect(response.status).toBe(410);
      expect(payload).toMatchObject({ error: 'thumbnail_legacy_generation_retired' });
      expect(readinessCalls).toBe(0);
      expect(retrievalCalls).toBe(0);
      expect(providerCalls).toBe(0);
      expect(backendAgentCalls).toBe(0);
    } finally {
      mock.restore();
    }
  });

  for (const [kind, message] of [['generation', '이 주제로 썸네일 생성해줘'], ['help', 'help']] as const) {
    test(`retired ${kind} chat returns 410 before body, persistence or old model work`, async () => {
      let readinessCalls = 0;
      let backendCalls = 0;
      let persistenceReads = 0;
      mock.module('@/lib/admin/anycap-gpt-image-readiness', () => ({
        ...actualAnyCapReadiness,
        probeAnyCapGptImageReadiness: async () => { readinessCalls += 1; return nonReadyAnyCap; },
      }));
      mock.module('@/lib/admin/youtube-thumbnail-generator/backend-agent', () => ({
        ...actualBackendAgent,
        generateYoutubeThumbnailChatWithBackendAgent: async () => {
          backendCalls += 1;
          throw new Error('retired chat must not invoke an old backend');
        },
      }));
      try {
        const { createThumbnailQueueApi } = await import('../lib/admin/youtube-thumbnail-generator/queue-api');
        const store = new Proxy({}, { get() { persistenceReads += 1; throw new Error('retired chat must not use persistence'); } });
        const api = createThumbnailQueueApi({ store: store as never,
          authorize: (async () => ({ ok: true, userId: '6f5d42d6-d122-4d32-b8bb-2779de58b423' })) as never });
        const request = new Request('http://localhost/api/admin/youtube-thumbnail-generator/chat', {
          method: 'POST', body: JSON.stringify({ message }),
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
        });
        const response = await api.chatLegacyPOST(request);
        expect(response.status).toBe(410);
        expect(await response.json()).toEqual({ ok: false, error: 'thumbnail_chat_route_retired',
          replacement: '/api/admin/youtube-thumbnail-generator/chat/jobs' });
        expect(request.bodyUsed).toBe(false);
        expect(response.headers.get('content-type')).not.toContain('text/event-stream');
        expect(readinessCalls).toBe(0);
        expect(backendCalls).toBe(0);
        expect(persistenceReads).toBe(0);
      } finally { mock.restore(); }
    });
  }
});
