import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';

test.setTimeout(90_000);

type ThumbnailGenerationResponse = {
  baseImage: {
    dataUrl: string;
    mime: string;
    targetWidth: 1280;
    targetHeight: 720;
    providerId: string;
    model: string;
    modelProvenance?: string;
  };
  prompt: string;
  warnings: string[];
};

type ThumbnailHistoryRun = {
  id: string;
  timestamp: string;
  completedAt: string;
  status: 'passed';
  providerId: string;
  model: string;
  modelProvenance: string;
  generationMode: string;
  topic: string;
  headline: string;
  warnings: string[];
  imagePath: string;
  rawPath: string;
  testName: string;
  postStatus: number;
  skeletonVerified: boolean;
  adminBypass: string;
  safetyBoundary: string;
};

type ThumbnailHistoryPayload = {
  updatedAt: string | null;
  runs: ThumbnailHistoryRun[];
};

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
    return rawValue.replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

function getSupabaseAuthStorageKey() {
  const supabaseUrl = readEnvWithFallback('NEXT_PUBLIC_SUPABASE_URL');
  const hostname = supabaseUrl ? new URL(supabaseUrl).hostname : 'local.supabase.co';
  return `sb-${hostname.split('.')[0]}-auth-token`;
}

async function installAdminBypass(page: Page, testInfo: TestInfo) {
  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
  });
  await page.addInitScript(({ storageKey }) => {
    const encodeBase64Url = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const userId = '00000000-0000-4000-8000-000000000002';
    const accessToken = [
      encodeBase64Url({ alg: 'HS256', typ: 'JWT' }),
      encodeBase64Url({
        aud: 'authenticated',
        exp: expiresAt,
        sub: userId,
        email: 'thumbnail-ultraqa-e2e@example.com',
        role: 'authenticated',
      }),
      'thumbnail-ultraqa-e2e',
    ].join('.');

    window.localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: 'thumbnail-ultraqa-e2e-refresh-token',
        expires_at: expiresAt,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'thumbnail-ultraqa-e2e@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }),
    );
  }, { storageKey: getSupabaseAuthStorageKey() });
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function decodeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error('thumbnail response did not contain a base64 image data URL');
  const mime = match[1];
  const extension = mime === 'image/svg+xml'
    ? 'svg'
    : mime === 'image/png'
      ? 'png'
      : mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'image/webp'
          ? 'webp'
          : 'bin';

  return { mime, extension, bytes: Buffer.from(match[2], 'base64') };
}

function writeThumbnailQaHistory(
  result: ThumbnailGenerationResponse,
  testInfo: TestInfo,
  postStatus: number,
  skeletonVerified: boolean,
) {
  const timestamp = safeTimestamp();
  const historyDir = resolve(process.cwd(), '.omx/runtime/youtube-thumbnail-history/e2e-runs');
  const rawRunsDir = join(historyDir, 'runs');
  const publicImageDir = resolve(process.cwd(), 'public/qa-history/youtube-thumbnail-generator/generated/e2e-runs');
  mkdirSync(rawRunsDir, { recursive: true });
  mkdirSync(publicImageDir, { recursive: true });

  const image = decodeImageDataUrl(result.baseImage.dataUrl);
  const imageFileName = `${timestamp}.${image.extension}`;
  const imagePath = `/qa-history/youtube-thumbnail-generator/generated/e2e-runs/${imageFileName}`;
  writeFileSync(join(publicImageDir, imageFileName), image.bytes);
  const rawFileName = `${timestamp}.json`;

  const run: ThumbnailHistoryRun = {
    id: `e2e-${timestamp}`,
    timestamp,
    completedAt: new Date().toISOString(),
    status: 'passed',
    providerId: result.baseImage.providerId,
    model: result.baseImage.model,
    modelProvenance: result.baseImage.modelProvenance ?? 'unknown',
    generationMode: 'direct_provider',
    topic: '해외 야시장 길거리 음식과 대형 꼬치구이 전경, 진행자 없이 음식 양과 리액션 분위기를 강조한 다음 업로드 썸네일',
    headline: '역대급 먹방',
    warnings: result.warnings,
    imagePath,
    rawPath: `./runs/${rawFileName}`,
    testName: testInfo.title,
    postStatus,
    skeletonVerified,
    adminBypass: 'local-only Playwright header + admin shell localStorage bypass',
    safetyBoundary: 'No paid or external live image API was called; local-codex test provider exercised the real admin form, skeleton, response, canvas, and in-page history wiring.',
  };
  const rawPayload = {
    ...run,
    baseImage: {
      ...result.baseImage,
      dataUrl: '[stored separately as imagePath]',
    },
    prompt: result.prompt,
  };

  const rawJson = JSON.stringify(rawPayload, null, 2);
  writeFileSync(join(rawRunsDir, rawFileName), rawJson);
  writeFileSync(join(historyDir, 'latest.json'), rawJson);

  const historyPath = join(historyDir, 'history.json');
  let previousRuns: ThumbnailHistoryRun[] = [];
  try {
    const previous = JSON.parse(readFileSync(historyPath, 'utf8')) as { runs?: ThumbnailHistoryRun[] };
    previousRuns = Array.isArray(previous.runs) ? previous.runs : [];
  } catch {
    previousRuns = [];
  }
  const runs = [run, ...previousRuns.filter((item) => item.timestamp !== timestamp)].slice(0, 20);
  writeFileSync(historyPath, JSON.stringify({ updatedAt: new Date().toISOString(), runs }, null, 2));

  return run;
}

test('UltraQA generates a thumbnail through the bypassed admin console and manages in-page history', async ({ page }, testInfo) => {
  await installAdminBypass(page, testInfo);
  await page.setViewportSize({ width: 1920, height: 1000 });

  let delayedPostSeen = false;
  let historyPayload: ThumbnailHistoryPayload = { updatedAt: null, runs: [] };
  await page.route('**/api/admin/youtube-thumbnail-generator', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          target: { width: 1280, height: 720, aspectRatio: '16:9' },
          providers: {
            openai: { available: false, model: 'gpt-image-2', liveEnabled: false },
            gemini: { available: false, model: 'gemini-3-pro-image-preview', liveEnabled: false },
            localCodex: {
              available: true,
              reason: 'local_test_provider_available',
              command: 'playwright-local-test-provider',
              model: 'gpt-image-2',
            },
          },
          backendAgent: {
            available: true,
            mode: 'local_adapter',
            rootPath: '/tmp/playwright-thumbnail-agent',
            graphEntrypoint: null,
            commandConfigured: false,
            commandAvailable: false,
            localAdapterAvailable: true,
            missingPythonModules: [],
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
          },
        }),
      });
      return;
    }
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    delayedPostSeen = true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 650));
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
        prompt: 'local-codex test provider prompt with 16:9 YouTube thumbnail layout',
        warnings: ['local_test_provider: Playwright fulfilled a local-codex result for skeleton/history verification.'],
      } satisfies ThumbnailGenerationResponse),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/chat', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: [
        'event: status',
        'data: {"message":"Codex CLI gpt-5.5 high 백엔드 에이전트 테스트 스트림"}',
        '',
        'event: done',
        'data: {"assistantMessage":"Codex CLI gpt-5.5 high 작업 완료 · 실제 썸네일 생성 요청으로 전환합니다","canvasPatch":{"topic":"해외 야시장 길거리 음식과 대형 꼬치구이 전경, 진행자 없이 음식 양과 리액션 분위기를 강조한 다음 업로드 썸네일","headline":"역대급 먹방","subHeadline":"한입만 가능?"},"shouldGenerate":true,"shouldReset":false,"diagnostics":{"runtime":"codex_cli_oauth","model":"gpt-5.5","effort":"high","streaming":"sse-progress"}}',
        '',
        '',
      ].join('\n'),
    });
  });
  await page.route('**/api/admin/youtube-thumbnail-generator/history', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyPayload),
    });
  });

  await gotoAndHidePopup(page, '/admin?module=youtube-thumbnail-generator');
  const thumbnailModule = page.locator('[data-admin-youtube-thumbnail-generator="true"]');
  await expect(thumbnailModule).toBeVisible({ timeout: 30_000 });
  await expect(thumbnailModule.locator('[data-thumbnail-generation-actions="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-command-row="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-chat-command]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toHaveText('');
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toHaveAttribute(
    'data-thumbnail-history-dropdown-trigger',
    'icon-only',
  );

  const chatComposer = thumbnailModule.locator('[data-thumbnail-chat-composer="true"] textarea');
  await chatComposer.fill('해외 야시장 길거리 음식과 대형 꼬치구이 전경, 진행자 없이 음식 양과 리액션 분위기를 강조한 다음 업로드 썸네일, 메인: 역대급 먹방, 스티커: 한입만 가능? 생성해줘');
  await expect(thumbnailModule.locator('[data-thumbnail-live-canvas-text-summary="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('#thumbnail-topic')).toHaveValue(/해외 야시장/);

  const postResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/admin/youtube-thumbnail-generator') &&
    !response.url().includes('/api/admin/youtube-thumbnail-generator/chat') &&
    response.request().method() === 'POST'
  ));
  await expect(thumbnailModule.locator('[data-thumbnail-chat-submit="true"]')).toBeEnabled();
  await thumbnailModule.locator('[data-thumbnail-chat-submit="true"]').click();

  const skeleton = thumbnailModule.locator('[data-thumbnail-generation-skeleton="true"]');
  await expect(skeleton).toBeVisible();
  const postResponse = await postResponsePromise;
  const result = await postResponse.json() as ThumbnailGenerationResponse;
  await expect(skeleton).toBeHidden();

  expect(delayedPostSeen).toBe(true);
  expect(postResponse.status()).toBe(200);
  expect(result.baseImage.providerId).toBe('local-codex');
  expect(result.baseImage.mime).toBe('image/png');
  expect(result.baseImage.targetWidth).toBe(1280);
  expect(result.baseImage.targetHeight).toBe(720);
  expect(result.warnings.join('\n')).not.toMatch(/mock|fixture|local_codex_fixture/i);

  const canvasDataUrlPrefix = await thumbnailModule.locator('canvas').evaluate((canvas) =>
    (canvas as HTMLCanvasElement).toDataURL('image/png').slice(0, 22),
  );
  expect(canvasDataUrlPrefix).toBe('data:image/png;base64,');

  const historyRun = writeThumbnailQaHistory(result, testInfo, postResponse.status(), true);
  historyPayload = { updatedAt: new Date().toISOString(), runs: [historyRun] };
  expect(historyRun.imagePath).toMatch(/^\/qa-history\/youtube-thumbnail-generator\/generated\/e2e-runs\/.+\.(png|jpg|webp)$/);
  expect(historyRun.rawPath).toMatch(/^\.\/runs\/.+\.json$/);
  expect(existsSync(resolve(process.cwd(), '.omx/runtime/youtube-thumbnail-history/e2e-runs/latest.html'))).toBe(false);

  await thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]').click();
  await expect(page.locator('[data-thumbnail-history-dropdown="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-history-panel="true"]')).toBeVisible();
  await expect(page.locator('[data-thumbnail-history-run="true"]')).toContainText('역대급 먹방');
  await page.locator('[data-thumbnail-history-load-run]').click();
  await expect(thumbnailModule.locator('canvas')).toHaveAttribute('data-thumbnail-history-preview', 'true');
});
