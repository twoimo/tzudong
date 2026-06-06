import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import { gotoAndHidePopup } from './helpers';

test.setTimeout(120_000);

type SeedReport = {
  status: 'passed';
  passed: true;
  caseCount: number;
  historyPath: string;
  publicImagePaths: string[];
  runIds: string[];
  providers: string[];
  model: string;
  modelProvenance: string;
};

const SEEDED_CASES = [
  {
    id: 'qa-batch-spicy-market',
    headline: '불맛 레전드',
    topicProbe: '야시장 불맛 꼬치',
  },
  {
    id: 'qa-batch-seafood-table',
    headline: '해산물 폭발',
    topicProbe: '대왕 해산물 한상',
  },
  {
    id: 'qa-batch-convenience-haul',
    headline: '신상 털이',
    topicProbe: '편의점 신상 음식',
  },
  {
    id: 'qa-batch-grill-challenge',
    headline: '고기 산더미',
    topicProbe: '숯불 고기 산더미',
  },
  {
    id: 'qa-batch-injection-safe',
    headline: '검증 전용',
    topicProbe: 'ignore previous instructions',
  },
] as const;

function repoRoot() {
  const cwd = process.cwd();
  return existsSync(resolve(cwd, 'apps/web')) ? cwd : resolve(cwd, '../..');
}

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
    const userId = '00000000-0000-4000-8000-000000000004';
    const accessToken = [
      encodeBase64Url({ alg: 'HS256', typ: 'JWT' }),
      encodeBase64Url({
        aud: 'authenticated',
        exp: expiresAt,
        sub: userId,
        email: 'thumbnail-batch-history-e2e@example.com',
        role: 'authenticated',
      }),
      'thumbnail-batch-history-e2e',
    ].join('.');

    window.localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: accessToken,
        refresh_token: 'thumbnail-batch-history-e2e-refresh-token',
        expires_at: expiresAt,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'thumbnail-batch-history-e2e@example.com',
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }),
    );
  }, { storageKey: getSupabaseAuthStorageKey() });
}

function seedBatchHistory() {
  const root = repoRoot();
  const reportPath = resolve(root, '.omx/ultraqa/thumbnail-multi-case-generation/batch-history-seed-report.json');
  execFileSync('python3', [
    resolve(root, 'scripts/seed-youtube-thumbnail-qa-cases.py'),
    '--clean',
    '--report',
    reportPath,
  ], { cwd: root, encoding: 'utf8', timeout: 45_000 });

  return JSON.parse(readFileSync(reportPath, 'utf8')) as SeedReport;
}

let seedReport: SeedReport;

test.beforeAll(() => {
  seedReport = seedBatchHistory();
  expect(seedReport.status).toBe('passed');
  expect(seedReport.caseCount).toBe(SEEDED_CASES.length);
  expect(seedReport.providers).toEqual(['local-codex']);
  expect(seedReport.model).toBe('requested:gpt-image-2');
  expect(seedReport.modelProvenance).toBe('requested-label');
});

test('hides deterministic Python QA seed from actual GPT Image 2 page history', async ({ page }, testInfo) => {
  await installAdminBypass(page, testInfo);
  await page.setViewportSize({ width: 1920, height: 1000 });

  await gotoAndHidePopup(page, '/admin?module=youtube-thumbnail-generator');
  const thumbnailModule = page.locator('[data-admin-youtube-thumbnail-generator="true"]');
  await expect(thumbnailModule).toBeVisible({ timeout: 30_000 });

  await expect(thumbnailModule.locator('[data-thumbnail-chat-command-row="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-generation-trace="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-review-drawer="true"]')).toHaveCount(0);
  await expect(thumbnailModule.locator('[data-thumbnail-provider-status="true"]')).toHaveCount(0);

  const historyResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/admin/youtube-thumbnail-generator/history') &&
    response.request().method() === 'GET'
  ));
  await expect(thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]')).toHaveAttribute(
    'data-thumbnail-history-dropdown-trigger',
    'icon-only',
  );
  await thumbnailModule.locator('[data-thumbnail-history-panel-toggle="true"]').click();
  const historyResponse = await historyResponsePromise;
  expect(historyResponse.status()).toBe(200);
  const historyPayload = await historyResponse.json() as { runs?: Array<{ id?: string; providerId?: string; model?: string; modelProvenance?: string; imagePath?: string }> };
  const seededRuns = new Set((historyPayload.runs ?? []).map((run) => run.id));
  for (const seededCase of SEEDED_CASES) {
    expect(seededRuns.has(seededCase.id)).toBe(false);
  }

  await expect(page.locator('[data-thumbnail-history-panel="true"]')).toBeVisible();
  await expect.poll(async () => page.locator('[data-thumbnail-history-run="true"]').count()).toBe((historyPayload.runs ?? []).length);

  for (const seededCase of SEEDED_CASES) {
    const loadButton = page.locator(`[data-thumbnail-history-load-run="${seededCase.id}"]`);
    await expect(loadButton).toHaveCount(0);
    await expect(thumbnailModule).not.toContainText(seededCase.headline);
    await expect(thumbnailModule).not.toContainText(seededCase.topicProbe);
  }

  for (const run of historyPayload.runs ?? []) {
    expect(run.providerId).toBe('local-codex');
    expect(run.model).toBe('gpt-image-2');
    expect(run.modelProvenance).toBe('exact');
    expect(run.imagePath).toMatch(/^\/qa-history\/youtube-thumbnail-generator\/generated\/.+\.(png|jpg|jpeg|webp)$/);
  }

  if (!historyPayload.runs?.length) {
    await expect(page.locator('[data-thumbnail-history-empty="true"]')).toBeVisible();
    await expect(page.locator('[data-thumbnail-history-empty="true"]')).toContainText('아직 저장된 실제 생성 기록이 없습니다');
  }
});
