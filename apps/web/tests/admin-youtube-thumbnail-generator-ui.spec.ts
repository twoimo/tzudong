import { expect, test, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';

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
  const supabaseUrl = readEnvWithFallback('NEXT_PUBLIC_SUPABASE_URL');
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

  await page.setViewportSize({ width: 1920, height: 1000 });
  const chatRequestBodies: unknown[] = [];
  const generationRequestBodies: unknown[] = [];
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
          diagnostics: { model: 'gpt-5.5', effort: 'high' },
        },
      }),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/chat', async (route) => {
    const requestBody = route.request().postDataJSON() as {
      message?: string;
      currentTopic?: string;
      currentHeadline?: string;
      currentSubHeadline?: string;
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
    const chatResult = message.includes('제육볶음')
      ? {
        assistantMessage: '요청을 이해했어요. 메인 문구를 “제육볶음 먹방”로 바꿨어요.',
        canvasPatch: { ...canvasPatch, headline: '제육볶음 먹방' },
        textLayerPatches: [{ id: 'headline', content: '제육볶음 먹방' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'high', streaming: 'sse-progress' },
      }
      : message.includes('레전드 음식')
      ? {
        assistantMessage: '요청을 이해했어요. 메인 문구를 “레전드 음식”로 바꿨어요.',
        canvasPatch: { ...canvasPatch, headline: '레전드 음식' },
        textLayerPatches: [{ id: 'headline', content: '레전드 음식' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'high', streaming: 'sse-progress' },
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
          diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'high', streaming: 'sse-progress' },
        }
      : shouldKeepProcessSceneProbeState
        ? {
          assistantMessage: '요청을 이해했어요 · 조리 과정 생성 프롬프트 라우팅 확인',
          canvasPatch,
          textLayerPatches: [],
          shouldGenerate: false,
          shouldReset: false,
          diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'high', streaming: 'sse-progress' },
        }
      : {
        assistantMessage: `요청을 이해했어요. 스티커 문구를 다듬고, 메인 문구 “${canvasPatch.headline}”와 스티커 문구 “${canvasPatch.subHeadline}”를 확인했어요.`,
        canvasPatch,
        textLayerPatches: [{ id: 'subHeadline', fontSize: 64, fill: '#fff200' }],
        shouldGenerate: false,
        shouldReset: false,
        diagnostics: { runtime: 'codex_cli_oauth', model: 'gpt-5.5', effort: 'high', streaming: 'sse-progress' },
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
  const chatHeaderActions = thumbnailModule.locator('[data-thumbnail-chat-header-actions="true"]');
  const canvasContext = thumbnailModule.locator('[data-thumbnail-chat-canvas-context="true"]');
  const canvasContextSummary = thumbnailModule.locator('[data-thumbnail-chat-canvas-context-summary="true"]');
  const canvasContextAction = thumbnailModule.locator('[data-thumbnail-chat-canvas-context-action="true"]');

  await expect(trace).toHaveCount(0);
  await expect(drawer).toHaveCount(0);
  await expect(inputPanel).toBeVisible();
  await expect(canvasPanel).toBeVisible();
  await expect(chatPanel).toBeVisible();
  await expect(chatHeaderActions).toBeVisible();
  await expect(chatComposer).toBeVisible();
  await expect(chatComposer).toHaveAttribute('data-thumbnail-chat-ime-safe', 'true');
  await expect(chatComposer).toHaveAttribute('aria-describedby', 'thumbnail-chat-keyboard-hint');
  await expect(canvasContext).toBeVisible();
  await expect(canvasContext).toHaveAttribute('data-thumbnail-chat-canvas-context-state', 'selected');
  await expect(canvasContextSummary).toContainText('메인 문구');
  await expect(canvasContextSummary).toContainText('역대급 먹방');
  const selectedTextTransformFrame = thumbnailModule.locator('[data-thumbnail-canvas-selected-text-transform-frame="true"]');
  await expect(selectedTextTransformFrame).toBeVisible();
  await expect(selectedTextTransformFrame.locator('[data-thumbnail-selected-text-resize-handle]')).toHaveCount(4);
  await expect(selectedTextTransformFrame.locator('[data-thumbnail-selected-text-rotate-handle="true"]')).toBeVisible();

  await chatComposer.fill('제육볶음 먹방 썸네일로 해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(canvasContextSummary).toContainText('역대급 먹방');
  await expect(canvasContextSummary).not.toContainText('제육볶음 먹방');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('메인 문구를');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('제육볶음 먹방');
  await expect(canvasContextSummary).toContainText('제육볶음 먹방');
  expect(chatRequestBodies.at(-1)).toMatchObject({
    message: '제육볶음 먹방 썸네일로 해줘',
    activeLayerId: 'headline',
    currentTextLayers: expect.arrayContaining([
      expect.objectContaining({ id: 'headline', content: '역대급 먹방' }),
    ]),
  });
  const chatRequestsAfterSubmitOnlyProbe = chatRequestBodies.length;
  await chatComposer.fill('');

  await chatComposer.fill('실제 데이터 기반인지 확인해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('현재 상태를 쉽게 정리했어요');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('가짜 예시 이미지는 실제 결과로 보지 않고');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('이미지 만들기:');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('썸네일 도우미:');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('gpt-image-2');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('검증 완료');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('히스토리');
  await expect(chatPanel).not.toContainText('sk-live-secret-for-ui-only');
  expect(chatRequestBodies).toHaveLength(chatRequestsAfterSubmitOnlyProbe);

  await chatComposer.fill('생성 과정 확인해줘');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('현재 상태를 쉽게 정리했어요');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('작업 방식');
  expect(chatRequestBodies).toHaveLength(chatRequestsAfterSubmitOnlyProbe);

  await chatComposer.fill('메인 문구를 레전드 음식으로 수정해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toBeVisible();
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('전송 후 편집');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-live-stream="true"]')).toContainText('전송하면 문구를 바꿉니다');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('메인 문구를');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('레전드 음식');
  await expect(canvasContextSummary).toContainText('레전드 음식');
  expect(chatRequestBodies.at(-1)).toMatchObject({
    message: '메인 문구를 레전드 음식으로 수정해줘',
    activeLayerId: 'headline',
    currentTextLayers: expect.arrayContaining([
      expect.objectContaining({ id: 'headline', content: '제육볶음 먹방' }),
    ]),
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
  await expect(canvasContextSummary).toContainText('46px');
  await chatComposer.press('Enter');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('스티커 문구를 다듬고');
  await expect(canvasContextAction).toContainText('선택 문구 채팅 반영');
  await expect(canvasContextSummary).toContainText('스티커 문구');
  await expect(canvasContextSummary).toContainText('64px');
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
  await expect(page.locator('[data-thumbnail-api-router-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-router-panel="true"]')).toHaveAttribute(
    'data-thumbnail-api-router-parity',
    'storyboard',
  );
  await expect(page.locator('[data-thumbnail-api-key-settings="local-storage-only"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-browser-api-key-settings="local-storage-only"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-key-disabled="true"]')).toHaveCount(0);
  await expect(page.locator('[data-thumbnail-api-key-input="openai"]')).toHaveCount(0);
  await expect(page.locator('[data-thumbnail-browser-api-key-input="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-key-save="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-api-key-session-status="true"]')).toContainText('저장된 키 없음');
  await expect(page.locator('[data-thumbnail-api-key-browser-only-copy="true"]')).toContainText('키는 이 브라우저에만 저장');
  await expect(page.locator('[data-thumbnail-browser-api-key-model-policy="gpt-image-2-only"]')).toContainText('모델은 gpt-image-2만 사용합니다.');
  await expect(chatPanel).not.toContainText('sk-live-secret-for-ui-only');
  await page.locator('[data-thumbnail-chat-settings-close="true"]').click();
  await expect(page.locator('[data-thumbnail-chat-settings-dropdown="true"]')).toHaveCount(0);

  await chatComposer.fill('참고 이미지 추가');
  await expect(chatComposer).toHaveValue('참고 이미지 추가');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-submit="true"]')).toBeEnabled();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await thumbnailModule.locator('[data-thumbnail-chat-submit="true"]').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(resolve(process.cwd(), 'public/images/admin/youtube-thumbnail-food-only-preview.png'));
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('참고 이미지 1장');

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
  await page.locator('[data-thumbnail-history-close="true"]').click();
  await expect(page.locator('[data-thumbnail-history-dropdown="true"]')).toHaveCount(0);
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

  await chatComposer.fill('문구 크게');
  await chatComposer.press('Enter');
  await expect(canvasContextAction).toContainText('크게 적용');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message="assistant"]').last()).toContainText('크게 도구를 캔버스에 적용했습니다');
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
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('새 썸네일 이미지를 만들고 캔버스에 넣었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('새 썸네일 이미지를 만들고 캔버스에 넣었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('사용한 이미지 모델도 검증되었습니다');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('기존 썸네일 후보');
  await expect(thumbnailModule.locator('[data-thumbnail-chat-message-mode="live"]').last()).toContainText('문구 위치를 확인한 뒤 필요하면 PNG로 저장하세요');
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
});
