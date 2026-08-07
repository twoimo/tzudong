import { expect, test, type TestInfo } from './nightly/nightly-test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup, hidePopupOverlay } from './helpers';

test.setTimeout(90_000);

function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.');
  }

  return token;
}

function readEnvWithFallback(key: string) {
  const value = process.env[key]?.trim();
  if (value) return value;

  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const line = readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.trim().startsWith(`${key}=`));
    const rawValue = line?.slice(line.indexOf('=') + 1).trim() ?? '';
    return rawValue.replace(/^['"]|['"]$/g, '');
  } catch {
    return '';
  }
}

function getSupabaseAuthStorageKey() {
  const supabaseUrl = process.env.NIGHTLY_OFFLINE === '1'
    ? 'http://127.0.0.1:54321'
    : readEnvWithFallback('NEXT_PUBLIC_SUPABASE_URL');
  const hostname = supabaseUrl ? new URL(supabaseUrl).hostname : 'local.supabase.co';
  return `sb-${hostname.split('.')[0]}-auth-token`;
}

test('thumbnail generator omits trace review drawer and keeps toolbar viewport-bounded', async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
  });
  await page.addInitScript(({ storageKey }) => {
    const encodeBase64Url = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const userId = '00000000-0000-4000-8000-000000000001';
    const accessToken = [
      encodeBase64Url({ alg: 'HS256', typ: 'JWT' }),
      encodeBase64Url({
        aud: 'authenticated',
        exp: expiresAt,
        sub: userId,
        email: 'thumbnail-ui-e2e@example.com',
        role: 'authenticated',
      }),
      'thumbnail-ui-e2e',
    ].join('.');

    window.localStorage.setItem(
      'tzudong:e2e-admin-shell-bypass',
      '1',
    );
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: 'thumbnail-ui-e2e-refresh-token',
        expires_at: expiresAt,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'thumbnail-ui-e2e@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }),
    );
  }, { storageKey: getSupabaseAuthStorageKey() });

  await page.setViewportSize({ width: 1366, height: 900 });
  const chatRequestBodies: unknown[] = [];
  const generationRequestBodies: unknown[] = [];
  const localBridgeRequestBodies: unknown[] = [];
  const localBridgeOptionsPaths: string[] = [];
  const localBridgeToken = 'playwright-local-bridge-token-123456';
  const localBridgeObservedRequests: Array<{ method: string; path: string; authorization: string; origin: string }> = [];
  const localBridgeSessionStorageKey = 'tzudong.admin.youtubeThumbnail.localBridge.v1';
  const getLocalBridgeCorsHeaders = (origin: string | undefined) => ({
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, X-Tzudong-Local-Bridge',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '0',
    vary: 'Origin',
  });
  let shouldDeferNextGenerationResponse = false;
  let markDeferredGenerationRequestStarted: (() => void) | null = null;
  let releaseDeferredGenerationResponse: (() => void) | null = null;
  function releaseDeferredGenerationResponseOrThrow() {
    if (!releaseDeferredGenerationResponse) {
      throw new Error('Deferred thumbnail generation response was not captured.');
    }
    releaseDeferredGenerationResponse();
  }
  await page.context().route('http://127.0.0.1:17873/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const origin = request.headers().origin;
    const corsHeaders = getLocalBridgeCorsHeaders(origin);
    if (request.method() === 'GET' && url.pathname === '/helper') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'text/html; charset=utf-8' },
        body: String.raw`<!doctype html>
<html>
  <body>
    <script>
      const params = new URLSearchParams(location.search);
      const sessionId = params.get('session') || '';
      const expectedOrigin = params.get('origin') || '*';
      const channel = new MessageChannel();
      const port = channel.port1;
      async function requestJson(url, init) {
        const response = await fetch(url, init);
        const payload = await response.json().catch(() => null);
        return { ok: response.ok, payload };
      }
      port.onmessage = async (event) => {
        const data = event.data || {};
        if (data.kind !== 'tzudong-local-bridge-helper-request' || data.sessionId !== sessionId) return;
        try {
          if (data.command === 'checkStatus') {
            const health = await requestJson(
              data.bridgeUrl + '/health',
              { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
            );
            const auth = await requestJson(
              data.bridgeUrl + '/auth-status',
              {
                method: 'GET',
                headers: {
                  Accept: 'application/json',
                  Authorization: 'Bearer ' + data.token,
                  'Content-Type': 'application/json',
                  'X-Tzudong-Local-Bridge': 'youtube-thumbnail',
                },
                cache: 'no-store',
              },
            );
            port.postMessage({
              kind: 'tzudong-local-bridge-helper-response',
              sessionId,
              requestId: data.requestId,
              ok: true,
              payload: {
                healthOk: health.ok,
                health: health.payload,
                authOk: auth.ok,
                auth: auth.payload,
              },
            });
            return;
          }
          if (data.command === 'generateThumbnail') {
            const response = await fetch(data.bridgeUrl + '/v1/youtube-thumbnail/images', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                Authorization: 'Bearer ' + data.token,
                'Content-Type': 'application/json',
                'X-Tzudong-Local-Bridge': 'youtube-thumbnail',
              },
              body: JSON.stringify(data.payload),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              port.postMessage({
                kind: 'tzudong-local-bridge-helper-response',
                sessionId,
                requestId: data.requestId,
                ok: false,
                errorCode: String(payload?.error || 'helper_request_failed'),
                message: String(payload?.detail || payload?.error || 'helper_request_failed'),
              });
              return;
            }
            port.postMessage({
              kind: 'tzudong-local-bridge-helper-response',
              sessionId,
              requestId: data.requestId,
              ok: true,
              payload,
            });
            return;
          }
          port.postMessage({
            kind: 'tzudong-local-bridge-helper-response',
            sessionId,
            requestId: data.requestId,
            ok: false,
            errorCode: 'unsupported_helper_command',
            message: 'unsupported_helper_command',
          });
        } catch (error) {
          port.postMessage({
            kind: 'tzudong-local-bridge-helper-response',
            sessionId,
            requestId: data.requestId,
            ok: false,
            errorCode: 'helper_request_failed',
            message: error instanceof Error ? error.message : 'helper_request_failed',
          });
        }
      };
      port.start();
      window.addEventListener('beforeunload', () => {
        try {
          port.postMessage({ kind: 'tzudong-local-bridge-helper-closed', sessionId });
        } catch {}
      });
      window.opener?.postMessage(
        {
          kind: 'tzudong-local-bridge-helper-ready',
          sessionId,
          surface: 'thumbnail',
          protocolVersion: 1,
        },
        expectedOrigin,
        [channel.port2],
      );
    </script>
  </body>
</html>`,
      });
      return;
    }
    if (request.method() === 'OPTIONS') {
      localBridgeOptionsPaths.push(url.pathname);
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }
    localBridgeObservedRequests.push({
      method: request.method(),
      path: url.pathname,
      authorization: request.headers().authorization ?? '',
      origin: origin ?? '',
    });
    if (request.method() === 'GET' && url.pathname === '/health') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          bridge: 'tzudong-storyboard-local-bridge',
          version: 1,
          status: 'ok',
          tokenRequired: true,
          providerId: 'local-codex',
          model: 'gpt-image-2',
          endpoints: {
            storyboardImages: '/v1/storyboard/images',
            thumbnailImages: '/v1/youtube-thumbnail/images',
          },
        }),
      });
      return;
    }
    const authorization = request.headers().authorization ?? '';
    if (authorization !== `Bearer ${localBridgeToken}`) {
      await route.fulfill({
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          bridge: 'tzudong-storyboard-local-bridge',
          status: 'unpaired',
          providerId: 'local-codex',
          model: 'gpt-image-2',
          detail: 'pairing mismatch',
        }),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/auth-status') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          bridge: 'tzudong-storyboard-local-bridge',
          status: 'ready',
          providerId: 'local-codex',
          model: 'gpt-image-2',
        }),
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/v1/youtube-thumbnail/images') {
      localBridgeRequestBodies.push(request.postDataJSON());
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          providerId: 'local-codex',
          model: 'gpt-image-2',
          result: {
            baseImage: {
              dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
              mime: 'image/png',
              targetWidth: 1280,
              targetHeight: 720,
              providerId: 'local-codex',
              model: 'gpt-image-2',
              modelProvenance: 'exact',
            },
            prompt: 'Playwright local bridge thumbnail',
            warnings: [
              'local_bridge_provider: playwright',
              'no_relay_transport: helper window',
              'server_history_persistence: skipped',
              'exact_provenance: image_generation.gpt-image-2 response=playwright-local call=playwright-call',
            ],
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'not_found' }),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          target: { width: 1280, height: 720, aspectRatio: '16:9' },
          providers: {
            localCodex: {
              available: true,
              reason: 'local_codex_command_configured',
              command: 'codex-imagegen-thumbnail-provider.py',
              model: 'gpt-image-2',
            },
          },
          backendAgent: {
            available: true,
            mode: 'local_adapter',
            rootPath: '/home/twoimo/src/tzudong/backend/thumbnail-agent',
            graphEntrypoint: null,
            commandConfigured: false,
            commandAvailable: false,
            localAdapterAvailable: true,
            missingPythonModules: [],
            runtime: 'codex_cli_oauth',
            codexModel: 'gpt-5.5',
            codexEffort: 'high',
            streamingAvailable: true,
          },
          limits: {
            maxFiles: 8,
            maxFileBytes: 8_388_608,
            maxTotalBytes: 33_554_432,
            mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          },
          configuration: {
            liveApiGate: 'THUMBNAIL_GENERATOR_ENABLE_LIVE_API',
            openaiModelEnv: 'THUMBNAIL_OPENAI_IMAGE_MODEL',
            geminiModelEnv: 'THUMBNAIL_GEMINI_IMAGE_MODEL',
            localCodexGate: 'ALLOW_LOCAL_CLI_THUMBNAIL',
            backendAgentCommandEnv: 'THUMBNAIL_AGENT_COMMAND',
            backendAgentRootEnv: 'THUMBNAIL_AGENT_ROOT',
            backendAgentRuntimeEnv: 'THUMBNAIL_AGENT_RUNTIME',
            backendAgentCodexModelEnv: 'THUMBNAIL_AGENT_CODEX_MODEL',
            backendAgentCodexEffortEnv: 'THUMBNAIL_AGENT_CODEX_EFFORT',
          },
        }),
      });
      return;
    }

    generationRequestBodies.push(route.request().postData() ?? null);
    if (shouldDeferNextGenerationResponse) {
      shouldDeferNextGenerationResponse = false;
      await new Promise<void>((resolve) => {
        releaseDeferredGenerationResponse = resolve;
        markDeferredGenerationRequestStarted?.();
        markDeferredGenerationRequestStarted = null;
      });
      releaseDeferredGenerationResponse = null;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        baseImage: {
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          mime: 'image/png',
          targetWidth: 1280,
          targetHeight: 720,
          providerId: 'local-codex',
          model: 'gpt-image-2',
          modelProvenance: 'exact',
        },
        prompt: 'UI 테스트 실제 생성 응답',
        warnings: ['ui_generation_fixture'],
        backendAgent: {
          mode: 'local_adapter',
          runtime: 'codex_cli_oauth',
          concept: 'ui generation concept',
          layoutBrief: 'ui generation layout',
          promptAddendum: 'ui generation addendum',
          safetyReview: 'ui safety review',
          nextActions: ['업로드 전 검수'],
          diagnostics: { model: 'gpt-5.5', effort: 'low' },
        },
      }),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/chat', async (route) => {
    const requestBody = route.request().postDataJSON() as {
      chatThreadId?: string;
      message?: string;
      currentTopic?: string;
      currentHeadline?: string;
      currentSubHeadline?: string;
      conversationMessages?: Array<{ role?: string; content?: string; id?: string }>;
      focusContext?: { kind?: string; label?: string; layerId?: string; role?: string; promptContext?: string };
      referenceImageAttachments?: unknown[];
    };
    chatRequestBodies.push(requestBody);
    const message = requestBody.message ?? '';
    const canvasPatch = {
      topic: message.includes('유튜브 쯔양')
        ? '유튜브 쯔양이 오른쪽에 크게, 매운 철판구이'
        : requestBody.currentTopic ?? '유튜브 쯔양이 오른쪽에 크게, 매운 철판구이',
      headline: requestBody.currentHeadline ?? '역대급 먹방',
      subHeadline: requestBody.currentSubHeadline ?? '한입만 가능?',
    };
    const shouldGenerateThumbnail = message.includes('새 썸네일 이미지를 만들고 캔버스에 넣었습니다 메시지 테스트');
    const shouldKeepProcessSceneProbeState = message.includes('조리 과정이 보이는 썸네일 생성해줘');
    const shouldAnswerEditHelp = message.includes('어떻게 바꾸면');
    const chatResult = message.includes('제육볶음')
      ? {
        assistantMessage: '요청을 이해했어요. 메인 문구를 “제육볶음 먹방”로 바꿨어요.',
        canvasPatch: { ...canvasPatch, headline: '제육볶음 먹방' },
        textLayerPatches: [{ id: 'headline', content: '제육볶음 먹방' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress' },
      }
      : message.includes('레전드 음식')
      ? {
        assistantMessage: '요청을 이해했어요. 메인 문구를 “레전드 음식”로 바꿨어요.',
        canvasPatch: { ...canvasPatch, headline: '레전드 음식' },
        textLayerPatches: [{ id: 'headline', content: '레전드 음식' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress' },
      }
      : shouldGenerateThumbnail
        ? {
          assistantMessage: '요청을 이해했어요 · 이어서 실제 썸네일 이미지까지 만들게요.',
          canvasPatch,
          textLayerPatches: [{ id: 'headline', content: canvasPatch.headline }],
          providerId: 'local-codex',
          generationMode: 'backend_agent',
          shouldGenerate: true,
          shouldReset: false,
          diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress' },
        }
      : shouldKeepProcessSceneProbeState
        ? {
          assistantMessage: '요청을 이해했어요 · 조리 과정 생성 프롬프트 라우팅 확인',
          canvasPatch,
          textLayerPatches: [],
          shouldGenerate: false,
          shouldReset: false,
          diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress' },
        }
      : shouldAnswerEditHelp
        ? {
          assistantMessage: '쉽게 답변드릴게요. 화면은 바꾸지 않았어요.',
          canvasPatch,
          textLayerPatches: [],
          shouldGenerate: false,
          shouldReset: false,
          diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress', chatIntent: 'conversation', canvasMutation: false },
        }
      : {
        assistantMessage: `요청을 이해했어요. 스티커 문구를 다듬고, 메인 문구 “${canvasPatch.headline}”와 스티커 문구 “${canvasPatch.subHeadline}”를 확인했어요.`,
        canvasPatch,
        textLayerPatches: [{ id: 'subHeadline', fontSize: 64, fill: '#fff200' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'low', streaming: 'sse-progress' },
      };
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: [
        'event: status',
        'data: {"message":"요청을 읽고 어떤 썸네일을 만들지 정리하고 있어요 테스트 스트림"}',
        '',
        'event: done',
        `data: ${JSON.stringify(chatResult)}`,
        '',
        '',
      ].join('\n'),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        updatedAt: '2026-06-05T09:20:00.000Z',
        runs: [
          {
            id: 'ui-history-001',
            timestamp: '2026-06-05T09-20-00-000Z',
            completedAt: '2026-06-05T09:20:00.000Z',
            status: 'passed',
            providerId: 'local-codex',
            model: 'gpt-image-2',
            modelProvenance: 'exact',
            generationMode: 'direct_provider',
            topic: 'UI 테스트용 실제 생성 히스토리',
            headline: '역대급 먹방',
            warnings: [],
            imagePath: '/qa-history/youtube-thumbnail-generator/generated/ui-history-001.png',
          },
        ],
      }),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/release-candidates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [] }),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/releases/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ release: null }),
    });
  });
  await gotoAndHidePopup(page, '/admin?module=youtube-thumbnail-generator');

  const thumbnailModule = page.locator('[data-admin-youtube-thumbnail-generator="true"]');
  await expect(thumbnailModule).toBeVisible({ timeout: 30_000 });

  const trace = thumbnailModule.locator('[data-thumbnail-generation-trace="true"]');
  const drawer = thumbnailModule.locator('[data-thumbnail-review-drawer="true"]');
  const toolbar = thumbnailModule.locator('[data-thumbnail-editor-toolbar="true"]');
  const inputPanel = thumbnailModule.locator('[data-thumbnail-generation-input-panel="right-chat"]');
  const canvasPanel = thumbnailModule.locator('[data-thumbnail-canvas-panel="primary-left"]');
  const chatPanel = thumbnailModule.locator('[data-thumbnail-chat-panel="true"]');
  const chatComposer = thumbnailModule.locator('[data-thumbnail-chat-composer="true"] textarea');
  const chatStarterPanel = thumbnailModule.locator('[data-thumbnail-chat-starter-panel="true"]');
  const chatStarterLogo = thumbnailModule.locator('[data-thumbnail-chat-starter-logo="true"]');
  const chatStarterTitle = thumbnailModule.locator('[data-thumbnail-chat-starter-title="true"]');
  const chatStarterExampleCards = thumbnailModule.locator('[data-thumbnail-chat-example-card="true"]');
  const chatHeaderActions = thumbnailModule.locator('[data-thumbnail-chat-header-actions="true"]');
  const canvasContext = thumbnailModule.locator('[data-thumbnail-chat-canvas-context="true"]');
  const canvasContextSummary = thumbnailModule.locator('[data-thumbnail-chat-canvas-context-summary="true"]');
  const canvasContextAction = thumbnailModule.locator('[data-thumbnail-chat-canvas-context-action="true"]');

  await expect(trace).toHaveCount(0);
  await expect(drawer).toHaveCount(0);
  await expect(inputPanel).toBeVisible();
  await expect(canvasPanel).toBeVisible();
  await expect(chatPanel).toBeVisible();
  await expect(chatStarterPanel).toBeVisible();
  await expect(chatStarterPanel).toHaveAttribute(
    'data-thumbnail-chat-starter-panel-layout',
    'centered-thumbnail-guide',
  );
  await expect(chatStarterLogo).toBeVisible();
  await expect(chatStarterTitle).toHaveText('무엇부터 만들까요?');
  await expect(chatStarterExampleCards).toHaveCount(3);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-guide-button="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-guide-example="true"]')).toBeVisible();
  await expect(chatHeaderActions).toBeVisible();
  await expect(chatComposer).toBeVisible();
  await expect(chatComposer).toHaveAttribute('placeholder', '원하는 썸네일 내용을 입력해 주세요');
  await expect(chatComposer).toHaveAttribute('data-thumbnail-chat-ime-safe', 'true');
  await expect(chatComposer).toHaveAttribute('aria-describedby', 'thumbnail-chat-keyboard-hint');
  await thumbnailModule.locator('[data-thumbnail-editor-tool="select-headline"]').click();
  await expect(canvasContext).toBeVisible();
  await expect(canvasContext).toHaveAttribute('data-thumbnail-chat-canvas-context-state', 'selected');
  await expect(canvasContextSummary).toContainText('메인 문구');
  const initialHeadlineSummary = await canvasContextSummary.innerText();
  expect(initialHeadlineSummary).toContain('메인 문구');
  expect(initialHeadlineSummary).not.toContain('제육볶음 먹방');
  const selectedTextTransformFrame = thumbnailModule.locator('[data-thumbnail-canvas-selected-text-transform-frame="true"]');
  await expect(selectedTextTransformFrame).toBeVisible();
  await expect(selectedTextTransformFrame.locator('[data-thumbnail-selected-text-resize-handle]')).toHaveCount(4);
  await expect(selectedTextTransformFrame.locator('[data-thumbnail-selected-text-rotate-handle="true"]')).toBeVisible();

  await chatComposer.fill('제육볶음 먹방 썸네일로 해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(canvasContextSummary).toHaveText(initialHeadlineSummary);
  await expect(canvasContextSummary).not.toContainText('제육볶음 먹방');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('메인 문구를');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('제육볶음 먹방');
  await expect(canvasContextSummary).toContainText('제육볶음 먹방');
  expect(chatRequestBodies.at(-1)).toMatchObject({
    chatThreadId: expect.stringMatching(/^thumbnail-chat-/),
    message: '제육볶음 먹방 썸네일로 해줘',
    activeLayerId: 'headline',
    conversationMessages: [],
    focusContext: expect.objectContaining({
      kind: 'text-layer',
      label: '메인 문구',
      layerId: 'headline',
      role: 'headline',
    }),
    referenceImageAttachments: [],
    currentTextLayers: expect.arrayContaining([
      expect.objectContaining({ id: 'headline', content: '제육볶음 한상' }),
    ]),
  });
  const thumbnailChatThreadId = (chatRequestBodies.at(-1) as { chatThreadId?: string }).chatThreadId;
  const chatRequestsAfterSubmitOnlyProbe = chatRequestBodies.length;
  await chatComposer.fill('');

  await chatComposer.fill('실제 데이터 기반인지 확인해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('현재 상태를 쉽게 정리했어요');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('이미지 만들기:');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('현재 화면:');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('참고 썸네일 검색:');
  await expect(chatPanel).not.toContainText('sk-live-secret-for-ui-only');
  expect(chatRequestBodies).toHaveLength(chatRequestsAfterSubmitOnlyProbe);

  await chatComposer.fill('생성 과정 확인해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('현재 상태를 쉽게 정리했어요');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('이미지 만들기:');
  expect(chatRequestBodies).toHaveLength(chatRequestsAfterSubmitOnlyProbe);

  const chatRequestsBeforeEditHelpProbe = chatRequestBodies.length;
  await chatComposer.fill('선택된 문구를 어떻게 바꾸면 돼?');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('전송 후 답변');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('캔버스는 그대로 두고 답변합니다');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('화면은 바꾸지 않았어요');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeEditHelpProbe + 1);
  expect(chatRequestBodies.at(-1)).toMatchObject({
    chatThreadId: thumbnailChatThreadId,
    message: '선택된 문구를 어떻게 바꾸면 돼?',
  });
  await chatComposer.fill('');
  await thumbnailModule.locator('[data-thumbnail-editor-tool="select-headline"]').click();
  await expect(canvasContextSummary).toContainText('메인 문구');

  await chatComposer.fill('메인 문구를 레전드 음식으로 수정해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('전송 후 편집');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('전송하면 문구를 바꿉니다');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('메인 문구를');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('레전드 음식');
  await expect(canvasContextSummary).toContainText('레전드 음식');
  expect(chatRequestBodies.at(-1)).toMatchObject({
    chatThreadId: thumbnailChatThreadId,
    message: '메인 문구를 레전드 음식으로 수정해줘',
    activeLayerId: 'headline',
    conversationMessages: expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: '제육볶음 먹방 썸네일로 해줘' }),
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('제육볶음 먹방') }),
    ]),
    focusContext: expect.objectContaining({
      kind: 'text-layer',
      label: '메인 문구',
      layerId: 'headline',
      role: 'headline',
    }),
    referenceImageAttachments: [],
  });
  await chatComposer.fill('');

  const chatRequestsBeforeProcessSceneProbe = chatRequestBodies.length;
  await chatComposer.fill('조리 과정이 보이는 썸네일 생성해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('요청을 이해했어요');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeProcessSceneProbe + 1);
  expect(chatRequestBodies.at(-1)).toMatchObject({
    message: '조리 과정이 보이는 썸네일 생성해줘',
  });

  await thumbnailModule.locator('[data-thumbnail-editor-tool="select-sticker"]').click();
  await expect(canvasContextAction).toContainText('스티커 문구 선택됨');
  await expect(canvasContextSummary).toContainText('스티커 문구');
  await expect(canvasContextSummary).toContainText('한입만 가능?');
  const userMessagesBeforeCanvasAsk = await thumbnailModule.locator('[data-thumbnail-chat-message="user"]').count();
  await thumbnailModule.locator('[data-thumbnail-chat-canvas-context-ask="true"]').click();
  await expect(chatComposer).toHaveValue(/선택된 스티커 문구/);
  await expect(chatComposer).toHaveValue(/한입만 가능/);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="user"]')).toHaveCount(userMessagesBeforeCanvasAsk);
  await expect(canvasContextSummary).toContainText(/\d+px/);
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('스티커 문구를 다듬고');
  await expect(canvasContextAction).toContainText('선택 문구 채팅 반영');
  await expect(canvasContextSummary).toContainText('스티커 문구');
  await expect(canvasContextSummary).toContainText(/\d+px/);
  expect(chatRequestBodies.at(-1)).toMatchObject({
    activeLayerId: 'subHeadline',
    editingLayerId: null,
    lastCanvasActionLabel: '채팅 컨텍스트로 연결됨',
    currentTextLayers: expect.arrayContaining([
      expect.objectContaining({ id: 'subHeadline', content: '한입만 가능?' }),
    ]),
  });
  await chatComposer.fill('');

  const chatRequestsBeforeImeProbe = chatRequestBodies.length;
  const userMessagesBeforeImeProbe = await thumbnailModule.locator('[data-thumbnail-chat-message="user"]').count();
  await chatComposer.fill('한글 조합 테스트 생성해줘');
  await chatComposer.dispatchEvent('compositionstart', { data: '한글' });
  await chatComposer.press('Enter');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeImeProbe);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="user"]')).toHaveCount(userMessagesBeforeImeProbe);
  await chatComposer.dispatchEvent('compositionend', { data: '한글 조합 테스트 생성해줘' });
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('요청을 이해했어요');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeImeProbe + 1);

  await expect(thumbnailModule.locator('[data-thumbnail-generation-settings="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-backend-agent-mode="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-brief-preset="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-live-canvas-brief="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-reference-url-import="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-agent-brief-summary="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-generation-warning-summary="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-backend-agent-status="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-safety-group="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-safety-acknowledgement="true"]')).toHaveCount(0);
  await expect(thumbnailModule.getByText('Enter는 채팅 반영, Shift+Enter는 줄바꿈입니다. 실제 이미지는 채팅창 아래 생성 버튼으로 실행됩니다.')).toHaveCount(0);
  await expect(thumbnailModule.getByText('참고 이미지 권리, 실제 인물/브랜드/개인 식별 정보 사용 권한과 안전한 썸네일 사용 조건을 확인했습니다.')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-generation-actions="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-live-canvas-text-summary="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-agent-stream-state]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-command-row="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-command]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-attachments="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-reference-file-input="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-reference-file-chip="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-reference-upload="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-reference-upload="true"]')).toHaveAttribute(
    'aria-label',
    '참고 이미지 첨부',
  );
  await expect(thumbnailModule.locator('[data-thumbnail-chat-reference-file-input="true"]')).toHaveCount(1);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-reference-file-input="true"]')).toHaveClass(/sr-only/);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]')).toHaveAttribute(
    'data-thumbnail-chat-settings-dropdown-trigger',
    'true',
  );
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toHaveText('');
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toHaveAttribute(
    'data-thumbnail-history-dropdown-trigger',
    'icon-only',
  );
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-meta="true"]').first()).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-bubble="true"]').first()).toBeVisible();
  await expect(page.locator('[data-thumbnail-chat-settings-panel="true"]')).toHaveCount(0);
  await thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveAttribute(
    'data-thumbnail-chat-settings-dropdown-parity',
    'storyboard',
  );
  await expect(page.locator('[data-thumbnail-chat-settings-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-chat-settings-panel="true"]')).toHaveAttribute(
    'data-thumbnail-chat-settings-panel-parity',
    'storyboard',
  );
  await expect(page.locator('[data-thumbnail-api-router-choice="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-router-option="local-codex-oauth"]')).toContainText('기본 OAuth');
  await expect(page.locator('[data-thumbnail-api-router-option="local-bridge"]')).toContainText('고급 로컬');
  await expect(page.locator('[data-thumbnail-api-router-option="browser-openai-api-key"]').first()).toContainText('API Key');
  await expect(page.locator('[data-thumbnail-local-bridge-settings="session-only"]')).toHaveCount(0);
  await expect(page.locator('[data-thumbnail-api-router-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-router-panel="true"]')).toHaveAttribute(
    'data-thumbnail-api-router-parity',
    'storyboard',
  );
  const apiKeySettings = page.locator('[data-thumbnail-api-key-settings="memory-only"]');
  await expect(apiKeySettings).toBeVisible();
  await expect(page.locator('[data-thumbnail-browser-api-key-settings="memory-only"]')).toBeVisible();
  await expect(apiKeySettings).toHaveAttribute('data-thumbnail-api-key-storage', 'memory-only');
  await expect(apiKeySettings).toHaveAttribute('data-thumbnail-api-key-persistence', 'none');
  await expect(apiKeySettings).toHaveAttribute('data-thumbnail-api-key-lifetime', 'component');
  await expect(page.locator('[data-thumbnail-api-key-disabled="true"]')).toHaveCount(0);
  await expect(page.locator('[data-thumbnail-api-key-input="openai"]')).toHaveCount(0);
  await expect(page.locator('[data-thumbnail-browser-api-key-input="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-key-save="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-key-session-status="true"]')).toContainText('저장된 키 없음');
  await expect(page.locator('[data-thumbnail-api-key-browser-only-copy="true"]')).toContainText('브라우저 메모리');
  await expect(page.locator('[data-thumbnail-browser-api-key-model-policy="gpt-image-2-only"]')).toContainText('gpt-image-2 전용');
  await expect(chatPanel).not.toContainText('sk-live-secret-for-ui-only');

  await page.locator('[data-thumbnail-api-router-option="local-bridge"]').click();
  const localBridgeSettings = page.locator('[data-thumbnail-local-bridge-settings="session-only"]');
  await expect(localBridgeSettings).toBeVisible();
  await expect(localBridgeSettings).toHaveAttribute(
    'data-thumbnail-local-bridge-settings-visibility',
    'advanced-selected',
  );
  await expect(localBridgeSettings).toHaveAttribute(
    'data-thumbnail-local-bridge-server-relay',
    'forbidden',
  );
  await expect(localBridgeSettings).toHaveAttribute(
    'data-thumbnail-local-bridge-token-persistence',
    'session-only',
  );
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-url-input="true"]')).toBeVisible();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-token-input="true"]')).toBeVisible();
  await expect(localBridgeSettings).toHaveAttribute('data-thumbnail-local-bridge-storage-key', localBridgeSessionStorageKey);

  const generationRequestsBeforeUnpairedLocalBridge = generationRequestBodies.length;
  const localBridgeRequestsBeforeUnpaired = localBridgeRequestBodies.length;
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);
  await chatComposer.fill('새 썸네일 이미지를 만들고 캔버스에 넣었습니다 메시지 테스트 생성해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('고급 로컬 브릿지 연결');
  expect(generationRequestBodies).toHaveLength(generationRequestsBeforeUnpairedLocalBridge);
  expect(localBridgeRequestBodies).toHaveLength(localBridgeRequestsBeforeUnpaired);

  await thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toBeVisible();
  await page.locator('[data-thumbnail-api-router-option="local-bridge"]').click();
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-url-input="true"]').fill('http://127.0.0.1:17873');
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-token-input="true"]').fill(localBridgeToken);
  const localBridgeEventsBeforeSave = localBridgeObservedRequests.length;
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-save="true"]').click();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-status="needs_reconnect"]')).toBeVisible();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText('로컬 브릿지 연결');
  const savedLocalBridgeCache = await page.evaluate((storageKey) => window.sessionStorage.getItem(storageKey), localBridgeSessionStorageKey);
  expect(savedLocalBridgeCache).not.toBeNull();
  expect(JSON.parse(savedLocalBridgeCache ?? '{}')).toMatchObject({
    version: 1,
    bridgeUrl: 'http://127.0.0.1:17873',
    token: localBridgeToken,
    storage: 'browser_session_storage_only',
  });
  expect(localBridgeObservedRequests.slice(localBridgeEventsBeforeSave)).toHaveLength(0);
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-token-input="true"]')).toHaveValue('');
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).not.toContainText(localBridgeToken);

  const localBridgeEventsBeforeConnect = localBridgeObservedRequests.length;
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-connect="true"]').click();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-status="connected"]')).toBeVisible();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText('연결됨');
  const localBridgeEventsAfterConnect = localBridgeObservedRequests.slice(localBridgeEventsBeforeConnect);
  const localBridgeConnectPaths = localBridgeEventsAfterConnect.map((entry) => `${entry.method} ${entry.path}`);
  const connectHealthIndex = localBridgeConnectPaths.indexOf('GET /health');
  const connectAuthIndex = localBridgeEventsAfterConnect.findIndex(
    (entry, index) => index > connectHealthIndex && entry.method === 'GET' && entry.path === '/auth-status' && entry.authorization === `Bearer ${localBridgeToken}`,
  );
  expect(connectHealthIndex).toBeGreaterThanOrEqual(0);
  expect(connectAuthIndex).toBeGreaterThan(connectHealthIndex);
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);

  const localBridgeEventsBeforeReload = localBridgeObservedRequests.length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await hidePopupOverlay(page);
  await expect(thumbnailModule).toBeVisible({ timeout: 30_000 });
  await thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-router-option="local-bridge"]').first()).toHaveAttribute(
    'data-thumbnail-api-router-option-selected',
    'true',
  );
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-status="needs_reconnect"]')).toBeVisible();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText('로컬 브릿지 연결');
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).not.toContainText(localBridgeToken);
  expect(localBridgeObservedRequests.slice(localBridgeEventsBeforeReload)).toHaveLength(0);
  const localBridgeEventsBeforeReconnect = localBridgeObservedRequests.length;
  await localBridgeSettings.locator('[data-thumbnail-local-bridge-connect="true"]').click();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-status="connected"]')).toBeVisible();
  await expect(localBridgeSettings.locator('[data-thumbnail-local-bridge-message="true"]')).toContainText('연결됨');
  const localBridgeEventsAfterReconnect = localBridgeObservedRequests.slice(localBridgeEventsBeforeReconnect);
  const localBridgeReconnectPaths = localBridgeEventsAfterReconnect.map((entry) => `${entry.method} ${entry.path}`);
  const reconnectHealthIndex = localBridgeReconnectPaths.indexOf('GET /health');
  const reconnectAuthIndex = localBridgeEventsAfterReconnect.findIndex(
    (entry, index) => index > reconnectHealthIndex && entry.method === 'GET' && entry.path === '/auth-status' && entry.authorization === `Bearer ${localBridgeToken}`,
  );
  expect(reconnectHealthIndex).toBeGreaterThanOrEqual(0);
  expect(reconnectAuthIndex).toBeGreaterThan(reconnectHealthIndex);
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);
  const fileChooserPromise = page.waitForEvent('filechooser');
  await thumbnailModule.locator('[data-thumbnail-chat-reference-upload="true"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(resolve(process.cwd(), 'public/images/admin/youtube-thumbnail-food-only-preview.png'));
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('참고 이미지 1장');

  const serverGenerationRequestsBeforeLocalBridge = generationRequestBodies.length;
  const localBridgeRequestsBeforePaired = localBridgeRequestBodies.length;
  const localBridgeEventsBeforePaired = localBridgeObservedRequests.length;
  await chatComposer.fill('새 썸네일 이미지를 만들고 캔버스에 넣었습니다 메시지 테스트 생성해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('새 썸네일 이미지를 만들고 화면에 넣었습니다');
  expect(localBridgeRequestBodies).toHaveLength(localBridgeRequestsBeforePaired + 1);
  expect(generationRequestBodies).toHaveLength(serverGenerationRequestsBeforeLocalBridge);
  const localBridgeEventsAfterPaired = localBridgeObservedRequests.slice(localBridgeEventsBeforePaired);
  const localBridgePairedPaths = localBridgeEventsAfterPaired.map((entry) => `${entry.method} ${entry.path}`);
  const pairedHealthIndex = localBridgePairedPaths.indexOf('GET /health');
  const pairedAuthIndex = localBridgeEventsAfterPaired.findIndex(
    (entry, index) => index > pairedHealthIndex && entry.method === 'GET' && entry.path === '/auth-status' && entry.authorization === `Bearer ${localBridgeToken}`,
  );
  const pairedImagePostIndex = localBridgeEventsAfterPaired.findIndex(
    (entry, index) => index > pairedAuthIndex && entry.method === 'POST' && entry.path === '/v1/youtube-thumbnail/images' && entry.authorization === `Bearer ${localBridgeToken}`,
  );
  expect(pairedHealthIndex).toBeGreaterThanOrEqual(0);
  expect(pairedAuthIndex).toBeGreaterThan(pairedHealthIndex);
  expect(pairedImagePostIndex).toBeGreaterThan(pairedAuthIndex);
  expect(localBridgeObservedRequests.every((entry) => entry.authorization === '' || entry.authorization === `Bearer ${localBridgeToken}`)).toBe(true);
  expect(Array.isArray(localBridgeOptionsPaths)).toBe(true);
  const bridgeBody = localBridgeRequestBodies.at(-1) as {
    payload?: { providerId?: string; generationMode?: string };
    referenceImages?: Array<{ role?: string; mime?: string; name?: string; dataBase64?: string }>;
  };
  expect(bridgeBody.payload).toMatchObject({
    providerId: 'local-codex',
    generationMode: 'direct_provider',
  });
  expect(bridgeBody.referenceImages).toHaveLength(1);
  expect(bridgeBody.referenceImages?.[0]).toMatchObject({
    role: 'host',
    mime: 'image/png',
  });
  expect(bridgeBody.referenceImages?.[0]?.name).toContain('youtube-thumbnail-food-only-preview');
  expect(bridgeBody.referenceImages?.[0]?.dataBase64).toMatch(/^[A-Za-z0-9+/=]+$/);

  await thumbnailModule.locator('[data-thumbnail-chat-settings-toggle="true"]').click();
  await page.locator('[data-thumbnail-api-router-option="local-codex-oauth"]').click();
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);

  await thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-history-dropdown="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-history-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-history-run="true"]')).toContainText('역대급 먹방');
  await expect(page.locator('[data-thumbnail-history-load-run]')).toBeVisible();
  await page.locator('[data-thumbnail-history-load-run]').click();
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-history-preview', 'true', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-thumbnail-history-dropdown="true"]')).toHaveCount(0);
  await chatComposer.fill('히스토리 보여줘');
  await chatComposer.press('Enter');
  await expect(page.locator('[data-thumbnail-history-panel="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="user"]').last()).toContainText('히스토리 보여줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('생성 히스토리를 이 페이지 안에서 열었습니다');
  await expect(page.locator('[data-thumbnail-history-panel="true"]')).not.toContainText(localBridgeToken);
  await page.locator('[data-thumbnail-history-close="true"]').click();
  await expect(page.locator('[data-thumbnail-history-dropdown="true"]')).toHaveCount(0);
  expect(JSON.stringify(chatRequestBodies)).not.toContain(localBridgeToken);
  expect(JSON.stringify(generationRequestBodies)).not.toContain(localBridgeToken);
  expect(JSON.stringify(localBridgeRequestBodies)).not.toContain(localBridgeToken);
  await expect(chatPanel).not.toContainText(localBridgeToken);
  await expect(thumbnailModule.locator('[data-thumbnail-generation-skeleton="true"]')).toHaveCount(0);

  const chatRequestsBeforeGuideHide = chatRequestBodies.length;
  await chatComposer.fill('가이드 숨겨줘');
  await expect(chatComposer).toHaveValue('가이드 숨겨줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-safe-area-guide', 'hidden');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('가이드를 숨겼습니다');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeGuideHide);

  await chatComposer.fill('가이드 보여줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-safe-area-guide', 'visible');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('가이드를 표시했습니다');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeGuideHide);

  await thumbnailModule.locator('[data-thumbnail-editor-tool="select-headline"]').click();
  await chatComposer.fill('문구 크게');
  await chatComposer.press('Enter');
  await expect(canvasContextAction).toContainText('크게 적용');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('크게 도구를 화면에 적용했습니다');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeGuideHide);

  const chatRequestsBeforeOvermatchProbe = chatRequestBodies.length;
  await chatComposer.fill('메인 문구 크게 보이게 생성해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('요청을 이해했어요');
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeOvermatchProbe + 1);

  const generationRequestsBeforeCompletionProbe = generationRequestBodies.length;
  await chatComposer.fill('새 썸네일 이미지를 만들고 캔버스에 넣었습니다 메시지 테스트 생성해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('새 썸네일 이미지를 만들고 화면에 넣었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('확인된 실제 이미지입니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('참고 썸네일 검색 없이 만들었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('PNG로 저장하세요');
  expect(generationRequestBodies).toHaveLength(generationRequestsBeforeCompletionProbe + 1);

  await expect(toolbar).toBeVisible();

  const panelBounds = await thumbnailModule.evaluate((element) => {
    const inputRect = element
      .querySelector('[data-thumbnail-generation-input-panel="right-chat"]')
      ?.getBoundingClientRect();
    const canvasRect = element
      .querySelector('[data-thumbnail-canvas-panel="primary-left"]')
      ?.getBoundingClientRect();

    return {
      inputLeft: inputRect?.left ?? 0,
      canvasLeft: canvasRect?.left ?? 0,
    };
  });
  expect(panelBounds.canvasLeft).toBeLessThan(panelBounds.inputLeft);

  await chatComposer.fill('유튜브 쯔양이 오른쪽에 크게, 매운 철판구이, 메인: 역대급 불맛, 스티커: 한입만 가능?');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-live-canvas-text-summary="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('#thumbnail-topic')).not.toHaveValue(/쯔양이 오른쪽/);
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="user"]').last()).toContainText('유튜브 쯔양이');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('요청을 이해했어요');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('#thumbnail-topic')).toHaveValue(/쯔양이 오른쪽/);

  const chatRequestsBeforeGuidedExample = chatRequestBodies.length;
  const generationRequestsBeforeGuidedExample = generationRequestBodies.length;
  const guidedExampleButton = thumbnailModule.locator('[data-thumbnail-chat-guide-example="true"]').first();
  const guidedExampleGenerationRequestStarted = new Promise<void>((resolve) => {
    markDeferredGenerationRequestStarted = resolve;
  });
  shouldDeferNextGenerationResponse = true;
  await guidedExampleButton.scrollIntoViewIfNeeded();
  await expect(guidedExampleButton).toBeVisible();
  await guidedExampleButton.click();
  await guidedExampleGenerationRequestStarted;
  await expect(canvasContextSummary).toContainText('밥도둑 한상');
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-history-preview', 'true');
  await expect(thumbnailModule.locator('[data-thumbnail-canvas-selected-text-transform-frame="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-generation-skeleton="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-generation-skeleton-glass-surface="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-generation-skeleton-shimmer="true"]')).toBeVisible();
  expect(chatRequestBodies).toHaveLength(chatRequestsBeforeGuidedExample);
  expect(generationRequestBodies).toHaveLength(generationRequestsBeforeGuidedExample + 1);
  releaseDeferredGenerationResponseOrThrow();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('새 썸네일 이미지를 만들고 화면에 넣었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-generation-skeleton="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-history-preview', 'false');

  const bounds = await thumbnailModule.evaluate((element) => {
    const moduleRect = element.getBoundingClientRect();
    const toolbarRect = element
      .querySelector('[data-thumbnail-editor-toolbar="true"]')
      ?.getBoundingClientRect();

    return {
      moduleBottom: moduleRect.bottom,
      moduleRight: moduleRect.right,
      toolbarBottom: toolbarRect?.bottom ?? 0,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(bounds.moduleBottom).toBeLessThanOrEqual(bounds.viewportHeight + 2);
  expect(bounds.toolbarBottom).toBeLessThanOrEqual(bounds.viewportHeight + 2);
  expect(bounds.moduleRight).toBeLessThanOrEqual(bounds.viewportWidth + 2);
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth + 2);
  await page.screenshot({ path: testInfo.outputPath('thumbnail-chat-parity.png'), fullPage: true });
});
