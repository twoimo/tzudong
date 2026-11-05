import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installTasteFixture } from './taste-fixture.mjs';

const origin = 'http://127.0.0.1:18822';
const focusedGaps = process.argv.includes('--focused-gaps');
const outputDirectory = focusedGaps ? 'interaction-gap-audit' : 'interaction-audit';
const outputRoot = resolve(import.meta.dirname, outputDirectory);
const modules = [
  ['overview', '대시보드 (KPI)'],
  ['restaurants', '맛집 관리'],
  ['submissions', '제보 관리'],
  ['reviews', '리뷰 관리'],
  ['users', '사용자 관리'],
  ['banners', '배너 관리'],
  ['insights', '영상 성과 분석'],
  ['pipeline', '크롤러 파이프라인'],
  ['knowledge-graph', '지식 그래프'],
  ['sentry', '오류 모니터링'],
  ['youtube-thumbnail-generator', '유튜브 썸네일 생성'],
  ['storyboard', '스토리보드 생성'],
  ['routes', '맛집 동선 추천'],
  ['llm', '운영 보조'],
  ['audit', '감사 로그'],
];
const titleByModule = Object.fromEntries(modules);
const allowedLoopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const syntheticSupabaseOrigin = 'http://127.0.0.1:18821';
const syntheticReadRpcPaths = new Set([
  '/rest/v1/rpc/get_current_privacy_eligibility',
  '/rest/v1/rpc/read_public_profile_summaries',
]);
const fixtureUserId = '00000000-0000-4000-9000-000000000001';
const fixtureProfiles = Array.from({ length: 3 }, (_, index) => ({
  user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  nickname: `검증 사용자 ${index + 1}`,
  avatar_url: null,
}));
const sourceFiles = [
  'components/admin/AdminConsoleOverview.tsx',
  'components/admin/AdminUsersPanel.tsx',
  'components/admin/SubmissionListView.tsx',
  'components/admin/pipeline/AdminPipelineDashboard.tsx',
  'components/admin/AdminKnowledgeGraphPanel.tsx',
  'components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx',
  'styles/admin-ui.css',
  'performance/admin-taste-20261015/taste-fixture.mjs',
];

class AuditError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const report = {
  schemaVersion: 1,
  kind: 'admin-taste-read-only-interaction-audit',
  scope: {
    origin,
    syntheticFixture: true,
    productionEvidence: false,
    taskSpeedEvidence: false,
    moduleCount: modules.length,
    mode: focusedGaps ? 'focused-gaps' : 'full',
    permittedMethods: ['GET', 'HEAD'],
  },
  environment: {},
  sourceSha256: {},
  cases: [],
  screenshots: [],
  network: {
    permittedRequests: 0,
    blockedExternalRequests: 0,
    blockedExternalWebSockets: 0,
    blockedNonReadMethodRequests: 0,
    blockedNonReadMethodRequestCounts: {},
    sentNonReadMethodRequests: 0,
    syntheticPreflightResponses: 0,
    syntheticSessionGets: 0,
    syntheticReadRpcFulfillments: {},
    sanitizedSupabaseRequestCounts: {},
    loopbackWebSocketsObserved: 0,
  },
};

function assert(condition, code) {
  if (!condition) throw new AuditError(code);
}

function round(value) {
  return Number(value.toFixed(2));
}

async function geometry(locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  return {
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
  };
}

async function screenshot(page, name) {
  const file = `${name}.png`;
  const path = resolve(outputRoot, file);
  await page.screenshot({ path, animations: 'disabled' });
  const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
  report.screenshots.push({ file: `${outputDirectory}/${file}`, sha256 });
  return file;
}

async function recordCase(id, run) {
  try {
    const metrics = await run();
    report.cases.push({ id, passed: true, metrics });
    process.stdout.write(`${JSON.stringify({ id, passed: true })}\n`);
  } catch (error) {
    const errorCode = error instanceof AuditError ? error.code : 'PLAYWRIGHT_ACTION_FAILED';
    report.cases.push({ id, passed: false, errorCode });
    process.stdout.write(`${JSON.stringify({ id, passed: false, errorCode })}\n`);
  }
}

async function createOwnedContext(browser, viewport, contextId, fixtureOptions = {}) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
    localStorage.setItem('theme', 'light');
    localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false');
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        const parsed = new URL(String(args[0]), location.href);
        if (['ws:', 'wss:'].includes(parsed.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
          window.__adminTasteBlockedExternalWebSockets = (window.__adminTasteBlockedExternalWebSockets ?? 0) + 1;
          throw new DOMException('Blocked external WebSocket', 'SecurityError');
        }
        return Reflect.construct(Target, args);
      },
    });
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let parsed;
    try {
      parsed = new URL(request.url());
    } catch {
      report.network.blockedExternalRequests += 1;
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(method)) {
      report.network.blockedNonReadMethodRequests += 1;
      const countKey = `${method} ${parsed.pathname}`;
      report.network.blockedNonReadMethodRequestCounts[countKey] = (report.network.blockedNonReadMethodRequestCounts[countKey] ?? 0) + 1;
      return route.abort('blockedbyclient');
    }
    if (['http:', 'https:'].includes(parsed.protocol) && !allowedLoopbackHosts.has(parsed.hostname)) {
      report.network.blockedExternalRequests += 1;
      return route.abort('blockedbyclient');
    }
    report.network.permittedRequests += 1;
    return route.continue();
  });
  const page = await context.newPage();
  await page.route('http://127.0.0.1:18821/**', async route => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const parsed = new URL(request.url());
    const isSyntheticReadRpc = syntheticReadRpcPaths.has(parsed.pathname);
    const corsHeaders = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'accept-profile, apikey, authorization, content-profile, content-type, prefer, range, x-client-info, x-supabase-api-version',
      'cache-control': 'no-store',
      vary: 'Origin',
    };
    if (method === 'POST' && isSyntheticReadRpc) {
      let body;
      try {
        const raw = request.postData() ?? '{}';
        if (raw.length > 65_536) throw new Error('FIXTURE_READ_INPUT_LIMIT');
        body = JSON.parse(raw);
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('FIXTURE_READ_INPUT_INVALID');
      } catch {
        return route.fulfill({ status: 400, contentType: 'application/json', headers: corsHeaders, body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' });
      }
      let value;
      if (parsed.pathname.endsWith('/get_current_privacy_eligibility')) {
        value = {
          schemaVersion: 1,
          eligible: true,
          reasonCode: 'PRIVACY_ELIGIBLE',
          policyVersionId: '00000000-0000-4000-8000-000000000001',
          policyVersion: '2026-08-04.1',
          contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b',
        };
      } else {
        const ids = body.p_user_ids;
        if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) {
          return route.fulfill({ status: 400, contentType: 'application/json', headers: corsHeaders, body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' });
        }
        value = fixtureProfiles.filter(profile => ids.includes(profile.user_id));
      }
      const countKey = `POST ${parsed.pathname}`;
      report.network.syntheticReadRpcFulfillments[countKey] = (report.network.syntheticReadRpcFulfillments[countKey] ?? 0) + 1;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify(value) });
    }
    if (method !== 'OPTIONS') return route.fallback();
    report.network.syntheticPreflightResponses += 1;
    return route.fulfill({
      status: 204,
      headers: {
        ...corsHeaders,
        'access-control-allow-methods': isSyntheticReadRpc ? 'GET, HEAD, POST' : 'GET, HEAD',
      },
      body: '',
    });
  });
  const fixture = await installTasteFixture(page, fixtureOptions);
  const runtime = { contextId, pageErrors: 0, consoleErrors: 0, requestFailures: 0 };
  page.on('pageerror', () => { runtime.pageErrors += 1; });
  page.on('console', message => { if (message.type() === 'error') runtime.consoleErrors += 1; });
  page.on('requestfailed', () => { runtime.requestFailures += 1; });
  page.on('websocket', () => { report.network.loopbackWebSocketsObserved += 1; });
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (parsed.origin !== syntheticSupabaseOrigin || !parsed.pathname.startsWith('/rest/v1/')) return;
    const countKey = `${request.method().toUpperCase()} ${parsed.pathname}`;
    report.network.sanitizedSupabaseRequestCounts[countKey] = (report.network.sanitizedSupabaseRequestCounts[countKey] ?? 0) + 1;
  });
  return { context, page, runtime, fixture };
}

async function settleModule(page, moduleId) {
  await page.locator('[data-admin-console-shell="true"]').waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(({ selectedModule, expectedTitle }) => {
    const canvas = document.querySelector(`[data-admin-console-active-module="${selectedModule}"]`);
    const visible = node => Boolean(node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const headers = canvas ? [...canvas.querySelectorAll('[data-admin-page-header="true"]')].filter(visible) : [];
    const title = headers[0]?.querySelector('.admin-page-header-title')?.textContent?.trim();
    const intersectsViewport = node => {
      if (!visible(node)) return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const busy = canvas ? [...canvas.querySelectorAll('[data-admin-sidebar-module-loading-grid], [data-slot="skeleton"]')].some(intersectsViewport) : true;
    return visible(canvas) && headers.length === 1 && title === expectedTitle && !busy;
  }, { selectedModule: moduleId, expectedTitle: titleByModule[moduleId] }, { timeout: 45_000 });
  await page.evaluate(() => Promise.race([
    document.fonts.ready,
    new Promise(resolvePromise => setTimeout(resolvePromise, 2_000)),
  ]));
  await page.evaluate(() => new Promise(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
}

async function openFixture(page) {
  const response = await page.context().request.get(`${origin}/__fixture/session`, {
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: 45_000,
  });
  report.network.syntheticSessionGets += 1;
  const status = response.status();
  await response.dispose();
  assert(status === 303, 'FIXTURE_SESSION_STATUS');
  await page.goto(`${origin}/admin`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await settleModule(page, 'overview');
}

async function waitForSyntheticAuth(page) {
  const accountButton = page.getByRole('button', { name: '검증 사용자 1 계정 및 사이드바 설정 열기', exact: true }).first();
  await accountButton.waitFor({ state: 'attached', timeout: 45_000 });
  const label = await accountButton.getAttribute('aria-label');
  assert(label === '검증 사용자 1 계정 및 사이드바 설정 열기', 'AUTH_PROFILE_NOT_PUBLISHED');
  return { userId: fixtureUserId, accountLabelPublished: true };
}

function desktopMenuButton(page, moduleId) {
  return page.locator('[data-admin-console-menu-item-mode="desktop-sidebar"]')
    .filter({ hasText: titleByModule[moduleId] }).first();
}

async function openDesktopModule(page, moduleId) {
  const button = desktopMenuButton(page, moduleId);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await settleModule(page, moduleId);
  return button;
}

async function moduleGeometry(page, menuButton) {
  const header = page.locator('[data-admin-console-active-module] [data-admin-page-header="true"]:visible').first();
  const canvas = page.locator('#admin-console-canvas');
  return {
    menu: await geometry(menuButton),
    header: await geometry(header),
    canvas: await geometry(canvas),
    activeMenuItems: await page.locator('[data-admin-console-menu-item-mode="desktop-sidebar"][aria-current="page"]:visible').count(),
    documentOverflowPx: await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
  };
}

await mkdir(outputRoot, { recursive: true });
for (const file of sourceFiles) {
  const bytes = await readFile(resolve(import.meta.dirname, '../..', file));
  report.sourceSha256[file] = createHash('sha256').update(bytes).digest('hex');
}
report.sourceSha256['performance/admin-taste-20261015/interaction-audit.mjs'] = createHash('sha256')
  .update(await readFile(new URL(import.meta.url)))
  .digest('hex');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
report.environment = {
  node: process.version,
  playwright: '1.63',
  browser: browser.version(),
  browserContexts: focusedGaps ? ['desktop-1440', 'error-held-834'] : ['desktop-1440', 'mobile-390', 'error-held-834'],
};

const contexts = [];
try {
  const desktop = await createOwnedContext(browser, { width: 1440, height: 960 }, 'desktop-1440');
  contexts.push(desktop);
  await openFixture(desktop.page);

  await recordCase('synthetic-auth-loaded', async () => waitForSyntheticAuth(desktop.page));

  if (!focusedGaps) {
    for (const [moduleId] of modules) {
    await recordCase(`desktop-sidebar-destination:${moduleId}`, async () => {
      const button = await openDesktopModule(desktop.page, moduleId);
      const metrics = await moduleGeometry(desktop.page, button);
      const renderedModule = await desktop.page.locator('[data-admin-console-active-module]').getAttribute('data-admin-console-active-module');
      const current = new URL(desktop.page.url()).searchParams.get('module') ?? 'overview';
      assert(renderedModule === moduleId, 'DESTINATION_MODULE_MISMATCH');
      assert(current === moduleId, 'DESTINATION_URL_MISMATCH');
      assert(metrics.activeMenuItems === 1, 'DESTINATION_ACTIVE_ITEM_COUNT');
      assert(metrics.documentOverflowPx === 0, 'DESTINATION_DOCUMENT_OVERFLOW');
      assert(metrics.menu && metrics.header && metrics.canvas, 'DESTINATION_GEOMETRY_MISSING');
      const image = await screenshot(desktop.page, `desktop-${moduleId}`);
      return { moduleId, image, ...metrics };
      });
    }

  await recordCase('desktop-collapsed-rail-labels-focus', async () => {
    await openDesktopModule(desktop.page, 'overview');
    const toggle = desktop.page.locator('[data-admin-sidebar-collapse-toggle="true"]');
    await toggle.click();
    await desktop.page.locator('[data-admin-console-layout="sidebar-content"][data-admin-console-sidebar-collapsed="true"]').waitFor({ state: 'visible' });
    const rails = desktop.page.locator('[data-admin-console-menu-item-mode="desktop-sidebar"]:visible');
    assert(await rails.count() === modules.length, 'COLLAPSED_RAIL_COUNT');
    const geometryByModule = [];
    for (const [moduleId, title] of modules) {
      const button = desktopMenuButton(desktop.page, moduleId);
      const label = await button.getAttribute('aria-label');
      assert(label?.startsWith(title), 'COLLAPSED_RAIL_LABEL');
      await button.focus();
      assert(await button.evaluate(element => document.activeElement === element), 'COLLAPSED_RAIL_FOCUS');
      const box = await geometry(button);
      assert(box && box.width >= 36 && box.height >= 36, 'COLLAPSED_RAIL_TARGET_SIZE');
      geometryByModule.push({ moduleId, width: box.width, height: box.height });
    }
    const first = desktopMenuButton(desktop.page, modules[0][0]);
    await first.hover();
    await desktop.page.locator('[data-admin-sidebar-collapsed-tooltip="true"]:visible').waitFor({ state: 'visible' });
    await first.focus();
    const image = await screenshot(desktop.page, 'desktop-collapsed-rail-focus');
    await toggle.click();
    return { image, toggle: await geometry(toggle), items: geometryByModule };
  });

  await recordCase('pipeline-keyboard-detail', async () => {
    await openDesktopModule(desktop.page, 'pipeline');
    const nodes = desktop.page.locator('[data-pipeline-stage]');
    assert(await nodes.count() >= 1, 'PIPELINE_NODE_MISSING');
    const node = nodes.first();
    const stage = await node.getAttribute('data-pipeline-stage');
    await node.focus();
    assert(await node.evaluate(element => document.activeElement === element), 'PIPELINE_NODE_FOCUS');
    await desktop.page.keyboard.press('Enter');
    const detail = desktop.page.locator('[data-pipeline-stage-detail]:visible');
    await detail.waitFor({ state: 'visible' });
    assert(await detail.getAttribute('data-pipeline-stage-detail') === stage, 'PIPELINE_DETAIL_STAGE_MISMATCH');
    assert(await desktop.page.locator('#pipeline-stage-title:visible').count() === 1, 'PIPELINE_DETAIL_TITLE');
    const image = await screenshot(desktop.page, 'pipeline-keyboard-detail');
    const metrics = { image, node: await geometry(node), detail: await geometry(detail) };
    await desktop.page.keyboard.press('Escape');
    return metrics;
  });

  await recordCase('knowledge-graph-filter-keyboard-detail', async () => {
    await openDesktopModule(desktop.page, 'knowledge-graph');
    const filter = desktop.page.getByLabel('지식 종류');
    await filter.selectOption('restaurant');
    await desktop.page.waitForFunction(() => document.querySelector('.admin-cms-toolbar')?.getAttribute('aria-busy') !== 'true');
    const nodes = desktop.page.locator('[data-knowledge-node]');
    assert(await nodes.count() >= 1, 'KNOWLEDGE_FILTER_EMPTY');
    const node = nodes.first();
    await node.focus();
    assert(await node.evaluate(element => document.activeElement === element), 'KNOWLEDGE_NODE_FOCUS');
    await desktop.page.keyboard.press('Enter');
    const detail = desktop.page.getByRole('dialog').filter({ hasText: '지식 근거' });
    await detail.waitFor({ state: 'visible' });
    const image = await screenshot(desktop.page, 'knowledge-filter-detail');
    const metrics = {
      image,
      filteredKind: await filter.inputValue(),
      visibleNodes: await nodes.count(),
      node: await geometry(node),
      detail: await geometry(detail),
    };
    await desktop.page.keyboard.press('Escape');
    return metrics;
  });

    await recordCase('users-read-only-filter-inspector', async () => {
    await openDesktopModule(desktop.page, 'users');
    const filter = desktop.page.getByLabel('사용자 상태 필터');
    await filter.selectOption('admin');
    const buttons = desktop.page.locator('[data-admin-users-detail-button]:visible');
    assert(await buttons.count() >= 1, 'USERS_FILTER_EMPTY');
    await buttons.first().click();
    const inspector = desktop.page.locator('[aria-label="사용자 상세"]:visible');
    await inspector.waitFor({ state: 'visible' });
    assert(await desktop.page.locator('[data-admin-users-detail-button][aria-pressed="true"]:visible').count() >= 1, 'USERS_SELECTION_COUNT');
    return {
      image: await screenshot(desktop.page, 'users-filter-inspector'),
      filteredState: await filter.inputValue(),
      visibleDetailButtons: await buttons.count(),
      inspector: await geometry(inspector),
    };
    });
  }

  for (const moduleId of ['submissions', 'reviews']) {
    await recordCase(`${moduleId}-read-only-filter-inspector`, async () => {
      await openDesktopModule(desktop.page, moduleId);
      const rowSelector = moduleId === 'reviews' ? '[data-admin-review-row]' : '[data-admin-submission-row]';
      const rowsBefore = desktop.page.locator(`${rowSelector}:visible`);
      assert(await rowsBefore.count() >= 1, `${moduleId.toUpperCase()}_LIST_EMPTY`);
      const seed = (await rowsBefore.first().locator('button span').first().textContent())?.trim() ?? '';
      assert(seed.length > 0, `${moduleId.toUpperCase()}_FILTER_SEED_MISSING`);
      const search = desktop.page.getByLabel(moduleId === 'reviews' ? '리뷰 검색' : '제보 검색');
      await search.fill(seed);
      const rows = desktop.page.locator(`${rowSelector}:visible`);
      assert(await rows.count() >= 1, `${moduleId.toUpperCase()}_FILTER_EMPTY`);
      await rows.first().locator('button').first().click();
      const inspector = desktop.page.locator('[data-admin-moderation-inspector="true"]:visible');
      await inspector.waitFor({ state: 'visible' });
      return {
        image: await screenshot(desktop.page, `${moduleId}-filter-inspector`),
        searchApplied: (await search.inputValue()).length > 0,
        visibleRows: await rows.count(),
        inspector: await geometry(inspector),
      };
    });
  }

  if (!focusedGaps) {
    const mobile = await createOwnedContext(browser, { width: 390, height: 844 }, 'mobile-390');
    contexts.push(mobile);
    await openFixture(mobile.page);
    await recordCase('mobile-navigation-open-select', async () => {
    const trigger = mobile.page.locator('[data-admin-console-menu-trigger="hamburger"]:visible');
    assert(await trigger.count() === 1, 'MOBILE_TRIGGER_COUNT');
    await trigger.click();
    assert(await trigger.getAttribute('aria-expanded') === 'true', 'MOBILE_MENU_NOT_OPEN');
    const items = mobile.page.locator('[data-admin-console-menu-item-mode="mobile-dropdown"]:visible');
    const menuItemCount = await items.count();
    assert(menuItemCount === modules.length, 'MOBILE_MENU_ITEM_COUNT');
    const target = items.filter({ hasText: titleByModule.reviews }).first();
    const targetBox = await geometry(target);
    assert(targetBox && targetBox.height >= 40, 'MOBILE_MENU_TARGET_SIZE');
    await target.click();
    await settleModule(mobile.page, 'reviews');
    assert(await trigger.getAttribute('aria-expanded') === 'false', 'MOBILE_MENU_NOT_CLOSED');
    await mobile.page.waitForFunction(() => document.activeElement?.id === 'admin-console-canvas');
    const focusId = await mobile.page.evaluate(() => document.activeElement?.id ?? '');
    assert(focusId === 'admin-console-canvas', 'MOBILE_CANVAS_FOCUS');
    return {
      image: await screenshot(mobile.page, 'mobile-navigation-reviews'),
      trigger: await geometry(trigger),
      selectedTarget: targetBox,
      menuItemCount,
      documentOverflowPx: await mobile.page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
    };
    });
  }

  const errorHeld = await createOwnedContext(
    browser,
    { width: 834, height: 960 },
    'error-held-834',
    { knowledgeGraph: 'error', pipeline: 'error', systemStatus: 'error', storyboard: 'held' },
  );
  contexts.push(errorHeld);
  await openFixture(errorHeld.page);
  if (!focusedGaps) {
    await recordCase('knowledge-graph-explicit-error-state', async () => {
    await openDesktopModule(errorHeld.page, 'knowledge-graph');
    const alerts = errorHeld.page.getByText('지식 그래프를 불러오지 못했습니다.', { exact: true });
    assert(await alerts.count() >= 1, 'KNOWLEDGE_ERROR_STATE_MISSING');
    return {
      image: await screenshot(errorHeld.page, 'knowledge-explicit-error'),
      visibleAlerts: await alerts.count(),
      canvas: await geometry(errorHeld.page.locator('[data-knowledge-canvas]')),
    };
    });
    await recordCase('pipeline-explicit-error-state', async () => {
    await openDesktopModule(errorHeld.page, 'pipeline');
    const runError = errorHeld.page.getByText('실행 조회 실패', { exact: true });
    const manifestError = errorHeld.page.getByText(/기록 조회 실패/);
    assert(await runError.count() >= 1, 'PIPELINE_RUN_ERROR_STATE_MISSING');
    assert(await manifestError.count() >= 1, 'PIPELINE_MANIFEST_ERROR_STATE_MISSING');
    return {
      image: await screenshot(errorHeld.page, 'pipeline-explicit-error'),
      runErrorLabels: await runError.count(),
      manifestErrorLabels: await manifestError.count(),
      canvas: await geometry(errorHeld.page.locator('[data-pipeline-canvas]')),
    };
    });
  }
  await recordCase('storyboard-explicit-held-state', async () => {
    await openDesktopModule(errorHeld.page, 'storyboard');
    const workspace = errorHeld.page.locator('[data-local-storyboard-workspace="true"]:visible');
    await workspace.waitFor({ state: 'visible', timeout: 45_000 });
    const held = errorHeld.page.getByRole('status').filter({ hasText: '데이터베이스 전환이 완료될 때까지 새 생성과 변경은 보류됩니다. 저장된 프로젝트와 이력은 계속 확인할 수 있습니다.' });
    await held.waitFor({ state: 'visible', timeout: 45_000 });
    const createButton = errorHeld.page.getByRole('button', { name: '프로젝트 만들기' });
    assert(await held.count() === 1, 'STORYBOARD_HELD_STATE_MISSING');
    assert(await createButton.isDisabled(), 'STORYBOARD_HELD_CREATE_ENABLED');
    return {
      image: await screenshot(errorHeld.page, 'storyboard-explicit-held'),
      heldNotices: await held.count(),
      createDisabled: await createButton.isDisabled(),
      workspace: await geometry(workspace),
    };
  });

  report.runtime = contexts.map(({ runtime }) => runtime);
  report.network.blockedExternalWebSockets = await Promise.all(contexts.map(async ({ page }) => {
    try { return await page.evaluate(() => window.__adminTasteBlockedExternalWebSockets ?? 0); }
    catch { return 0; }
  })).then(values => values.reduce((sum, value) => sum + value, 0));
} finally {
  for (const { context } of contexts) await context.close().catch(() => undefined);
  await browser.close();
  const failedCases = report.cases.filter(item => !item.passed).length;
  const runtimeErrors = (report.runtime ?? []).reduce((sum, item) => sum + item.pageErrors, 0);
  report.summary = {
    passedCases: report.cases.length - failedCases,
    failedCases,
    screenshots: report.screenshots.length,
    runtimePageErrors: runtimeErrors,
    passed: failedCases === 0 && runtimeErrors === 0 && report.network.sentNonReadMethodRequests === 0,
  };
  await writeFile(resolve(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.summary.passed) process.exitCode = 1;
