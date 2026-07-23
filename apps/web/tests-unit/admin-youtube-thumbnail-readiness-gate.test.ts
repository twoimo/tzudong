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

async function loadDirectRoute() {
  return import(`../app/api/admin/youtube-thumbnail-generator/route.ts?cache=${Math.random()}`);
}

async function loadChatRoute() {
  return import(`../app/api/admin/youtube-thumbnail-generator/chat/route.ts?cache=${Math.random()}`);
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

  test('direct POST returns typed 503 before retrieval or provider generation', async () => {
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
      const route = await loadDirectRoute();
      const response = await route.POST(await multipartThumbnailRequest(safePayload));
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload).toMatchObject({
        error: 'provider_unavailable',
        code: 'thumbnail_anycap_gpt_image_2_not_ready',
        readiness: {
          providerId: 'anycap',
          model: 'gpt-image-2',
          fallbackAllowed: false,
          status: 'auth_required',
        },
      });
      expect(readinessCalls).toBe(1);
      expect(retrievalCalls).toBe(0);
      expect(providerCalls).toBe(0);
      expect(backendAgentCalls).toBe(0);
    } finally {
      mock.restore();
    }
  });

  test('generation chat emits SSE readiness blocker before agent_started and backend invocation', async () => {
    let backendAgentCalls = 0;

    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: 'admin-user' }),
    }));
    mock.module('@/lib/admin/anycap-gpt-image-readiness', () => ({
      ...actualAnyCapReadiness,
      probeAnyCapGptImageReadiness: async () => nonReadyAnyCap,
    }));
    mock.module('@/lib/admin/youtube-thumbnail-generator/backend-agent', () => ({
      ...actualBackendAgent,
      generateYoutubeThumbnailChatWithBackendAgent: async () => {
        backendAgentCalls += 1;
        throw new Error('chat backend agent should not run when readiness blocks');
      },
    }));

    try {
      const route = await loadChatRoute();
      const response = await route.POST(new Request('http://localhost/api/admin/youtube-thumbnail-generator/chat', {
        method: 'POST',
        body: JSON.stringify({ message: '이 주제로 썸네일 생성해줘' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
      }) as unknown as NextRequest);
      const streamText = await response.text();

      expect(response.status).toBe(200);
      expect(streamText).toContain('event: provider_readiness_blocker');
      expect(streamText).toContain('thumbnail_anycap_gpt_image_2_not_ready');
      expect(streamText).toContain('"model":"gpt-image-2"');
      expect(streamText).toContain('"fallbackAllowed":false');
      expect(streamText).not.toContain('event: agent_started');
      expect(backendAgentCalls).toBe(0);
    } finally {
      mock.restore();
    }
  });

  test('no-provider help chat is not readiness-blocked', async () => {
    let readinessCalls = 0;
    let backendAgentCalls = 0;

    mock.module('@/lib/auth/require-admin', () => ({
      requireAdmin: async () => ({ ok: true, userId: 'admin-user' }),
    }));
    mock.module('@/lib/admin/anycap-gpt-image-readiness', () => ({
      ...actualAnyCapReadiness,
      probeAnyCapGptImageReadiness: async () => {
        readinessCalls += 1;
        throw new Error('help chat should not check provider readiness');
      },
    }));
    mock.module('@/lib/admin/youtube-thumbnail-generator/backend-agent', () => ({
      ...actualBackendAgent,
      generateYoutubeThumbnailChatWithBackendAgent: async () => {
        backendAgentCalls += 1;
        return {
          assistantMessage: '도움말입니다. 화면은 바꾸지 않았어요.',
          canvasPatch: { topic: '먹방 썸네일', headline: '역대급 먹방', subHeadline: '한입만 가능?' },
          textLayerPatches: [],
          providerId: 'local-codex',
          generationMode: 'direct_provider',
          shouldGenerate: false,
          shouldReset: false,
          backendAgent: {
            mode: 'local_adapter',
            runtime: 'local_thumbnail_chat',
            concept: 'help',
            layoutBrief: 'no provider utility',
            promptAddendum: 'help only',
            safetyReview: 'no generation',
            nextActions: [],
            diagnostics: { externalAgentInvoked: false, chatIntent: 'casual_chat' },
          },
          diagnostics: {
            runtime: 'local_thumbnail_chat',
            model: 'none',
            effort: 'low',
            streaming: 'sse-progress',
            chatIntent: 'casual_chat',
            canvasMutation: false,
          },
        };
      },
    }));

    try {
      const route = await loadChatRoute();
      const response = await route.POST(new Request('http://localhost/api/admin/youtube-thumbnail-generator/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'help' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          'Sec-Fetch-Site': 'same-origin',
        },
      }) as unknown as NextRequest);
      const streamText = await response.text();

      expect(streamText).toContain('event: done');
      expect(streamText).not.toContain('provider_readiness_blocker');
      expect(readinessCalls).toBe(0);
      expect(backendAgentCalls).toBe(1);
    } finally {
      mock.restore();
    }
  });
});
