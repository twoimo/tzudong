/**
 * Read-only rendered audit against the synthetic loopback preview, never production.
 * Launch agent-browser --session tzudong-sidebar-audit-astra, obtain `get cdp-url`,
 * then run with the project's Node 24: node <this-file> <owned-CDP-url>.
 * Optional --modules=a,b and --widths=390,834,1423 support changed/failed-only reruns.
 * Every server-bound HTTP mutation and non-fixture request is denied before navigation.
 * Confirmed read-only POST contracts below are synthetic browser-only fulfills.
 */
import { chromium, type Request } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdminSentryResponse } from '../types/admin-sentry.ts';
import { isKnowledgeGraphPage } from '../types/knowledge-graph.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:18794';
const allowedOrigins = new Set([origin, 'http://127.0.0.1:18793']);
const connection = process.argv[2];
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+$/i.test(connection ?? '')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const modules = [
  ['overview', '대시보드 (KPI)', '대시보드 \\(KPI\\)|쯔양 성과 대시보드|Tzuyang KPI Dashboard'],
  ['restaurants', '맛집 관리', '맛집 관리|관리자 데이터 검수|데이터 검수'],
  ['submissions', '제보 관리', '제보 관리|사용자 제보'],
  ['reviews', '리뷰 관리', '리뷰 관리|리뷰 검수'],
  ['users', '사용자 관리', '사용자 관리'],
  ['banners', '배너 관리', '배너 관리'],
  ['insights', '영상 성과 분석', '영상 성과 분석'],
  ['pipeline', '크롤러 파이프라인', '크롤러 파이프라인'],
  ['sentry', '오류 모니터링', 'Sentry 오류 모니터링'],
  ['youtube-thumbnail-generator', '유튜브 썸네일 생성', '유튜브 썸네일 생성'],
  ['storyboard', '스토리보드 생성', '스토리보드'],
  ['routes', '맛집 동선 추천', '맛집 동선 추천'],
  ['llm', '운영 보조', '운영 보조'],
  ['audit', '감사 로그', '감사 로그'],
  ['knowledge-graph', '지식 그래프', '쯔양 지식 그래프'],
] as const;
const requestedModules = argument('modules')?.split(',');
if (requestedModules?.some(id => !modules.some(module => module[0] === id))) throw new Error('UNKNOWN_MODULE');
const selectedModules = modules.filter(module => !requestedModules || requestedModules.includes(module[0]));
const widths = argument('widths')?.split(',').map(Number) ?? [390, 834, 1423];
if (widths.some(width => ![390, 834, 1423].includes(width))) throw new Error('UNSUPPORTED_VIEWPORT');
const colors = (argument('colors')?.split(',') ?? ['light', 'dark']) as Array<'light' | 'dark'>;
if (colors.some(color => !['light', 'dark'].includes(color))) throw new Error('UNSUPPORTED_COLOR');
const suffix = argument('report-suffix') ?? '20261004';
if (!/^[a-z0-9-]{1,80}$/.test(suffix)) throw new Error('INVALID_REPORT_SUFFIX');
const captureScreenshots = argument('screenshots') === 'true';
const browserSession = argument('browser-session') ?? 'tzudong-sidebar-audit-astra';
if (!/^[a-z0-9-]{1,80}$/.test(browserSession)) throw new Error('INVALID_BROWSER_SESSION');
const output = resolve(root, `performance/ui-renewal-20261003/admin-sidebar-pages-browser-${suffix}.json`);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourceRoots = ['app/admin', 'app/api/admin', 'app/insights', 'components/admin', 'components/ui', 'contexts', 'hooks', 'config', 'integrations', 'lib', 'styles', 'types', 'data/knowledge-graph'];

function sources() {
  const paths: string[] = [];
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css|json)$/.test(entry.name)) paths.push(full);
    }
  };
  for (const path of sourceRoots) walk(resolve(root, path));
  paths.push(resolve(root, 'scripts/preview-design-fixtures.mjs'), fileURLToPath(import.meta.url));
  const manifest = paths.sort().map(path => ({ path: relative(root, path), sha256: sha256(readFileSync(path)) }));
  return { signature: sha256(JSON.stringify(manifest)), manifest };
}
const sourceStart = sources();
const startedAt = new Date().toISOString();
const browser = await chromium.connectOverCDP(connection);
const context = browser.contexts()[0];
const foundPage = context.pages().find(candidate => candidate.url().startsWith(origin))
  ?? context.pages().find(candidate => candidate.url() === 'about:blank');
const blankUrls = new Set(['about:blank', 'chrome://new-tab-page/', 'chrome://newtab/']);
if (!foundPage || context.pages().some(candidate => !blankUrls.has(candidate.url()) && !candidate.url().startsWith(origin))) throw new Error('ISOLATED_OWNED_TARGET_REQUIRED');
const page = foundPage;
page.setDefaultTimeout(8_000);
page.setDefaultNavigationTimeout(20_000);
await context.unrouteAll({ behavior: 'wait' });
await context.addInitScript(() => {
  localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
  localStorage.setItem('tzudong-admin-theme', 'system');
  localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false');
  localStorage.removeItem('adminEvaluationPageState');
});

type NetworkEvent = { endpoint: string; method: string; status?: number; result: string };
type ApiSchema = { endpoint: string; valid: boolean; state?: string; nodes?: number; edges?: number; revision?: string; verifiedEvidence?: number; unverifiedEvidence?: number };
let network: NetworkEvent[] = [], pageErrors: string[] = [], consoleErrors = 0;
let apiSchemas: ApiSchema[] = [];
const schemaChecks = new Set<Promise<void>>();
let externalBlocked = 0, mutationsBlocked = 0, totalExternalBlocked = 0, totalMutationsBlocked = 0;
const syntheticReadMockCounts: Record<string, number> = {};
const fixtureProfiles = Array.from({ length: 3 }, (_, index) => ({
  user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  nickname: `검증 사용자 ${index + 1}`, avatar_url: null,
}));
// Exact contracts inspected in AuthContext, privacy/eligibility, require-admin,
// public-profile-read, and preview-design-fixtures. No wildcard RPC allowlist.
const syntheticReadUrls = {
  eligibility: 'http://127.0.0.1:18793/rest/v1/rpc/get_current_privacy_eligibility',
  activeSession: 'http://127.0.0.1:18793/rest/v1/rpc/is_current_auth_session_active',
  profile: 'http://127.0.0.1:18793/rest/v1/rpc/read_public_profile_summaries',
  adminProfile: `${origin}/api/admin/profile-summaries`,
};
const pending = new Set<Request>();
const endpoints = new Set([
  '/api/admin/evaluations', '/api/admin/evaluations/automation', '/api/admin/pending-counts',
  '/api/dashboard/restaurants', '/api/dashboard/summary', '/api/admin/youtube-kpis', '/api/admin/youtube-channel',
  '/api/admin/youtube-kpi-collection-logs', '/api/admin/users', '/api/admin/profile-summaries',
  '/api/admin/restaurant-refresh-history', '/api/admin/audit-events', '/api/admin/storyboard/production',
  '/api/admin/sentry', '/api/admin/knowledge-graph', '/api/admin/pipeline', '/api/insights/treemap',
  '/api/admin/routes/directions', '/api/admin/routes/candidates', '/api/admin/map-overlays', '/api/admin/trend-proposals',
  '/rest/v1/restaurant_submissions', '/rest/v1/restaurant_submission_items', '/rest/v1/reviews',
  '/rest/v1/user_roles', '/rest/v1/rpc/get_current_privacy_eligibility', '/rest/v1/rpc/read_public_profile_summaries',
]);
function endpoint(url: URL) {
  if (endpoints.has(url.pathname)) return url.pathname;
  if (url.pathname.startsWith('/rest/v1/')) return '/rest/v1/(fixture-resource)';
  if (url.pathname.startsWith('/api/')) return '/api/(other)';
  return '/(asset-or-document)';
}
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (!allowedOrigins.has(url.origin)) {
    externalBlocked++; totalExternalBlocked++;
    network.push({ endpoint: '(external-blocked)', method: request.method(), result: 'denied-external' });
    await route.abort('blockedbyclient'); return;
  }
  if (url.origin === origin && url.pathname === '/api/admin/audit-events' && request.method() === 'GET') {
    // This exact bounded synthetic read model is never forwarded to an operating API.
    const stamp = '2026-10-03T00:00:00.000Z';
    syntheticReadMockCounts.audit = (syntheticReadMockCounts.audit ?? 0) + 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      asOf: stamp, source: 'admin_audit_events', unavailable: null,
      coverage: { universal: false, mode: 'truthful-partial-domain-specific', domains: ['admin_user_management'], sources: ['admin_audit_events'] },
      events: ['applied','intent','failed'].map((status, index) => ({ id: `fixture-audit-${index + 1}`, actorUserId: fixtureProfiles[0].user_id,
        targetUserId: fixtureProfiles[index].user_id, action: ['admin_user_profile_updated','admin_user_role_granted','admin_user_disabled'][index], status,
        reasonCode: 'operator-review', correlationId: `fixture-correlation-${index + 1}`, appliedAt: status === 'applied' ? stamp : null,
        errorCode: status === 'failed' ? 'FIXTURE_REJECTED' : null, createdAt: stamp, counts: {}, flags: {} })),
    }) }); return;
  }
  if (request.method() === 'POST' && Object.values(syntheticReadUrls).includes(url.href)) {
    let value: unknown;
    if (url.href === syntheticReadUrls.eligibility) value = { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE',
      policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1',
      contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' };
    else if (url.href === syntheticReadUrls.activeSession) value = true;
    else {
      const body = request.postData() ?? '';
      let ids: unknown;
      try { ids = body.length <= 65_536 ? JSON.parse(body)[url.href === syntheticReadUrls.profile ? 'p_user_ids' : 'userIds'] : null; } catch { ids = null; }
      if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' }); return;
      }
      value = url.href === syntheticReadUrls.profile ? fixtureProfiles.filter(profile => ids.includes(profile.user_id))
        : { rows: ids.map(id => ({ userId: id, nickname: fixtureProfiles.find(profile => profile.user_id === id)?.nickname ?? null })) };
    }
    syntheticReadMockCounts[url.pathname] = (syntheticReadMockCounts[url.pathname] ?? 0) + 1;
    network.push({ endpoint: endpoint(url), method: 'POST', result: 'synthetic-read-fulfilled-no-server-request' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) }); return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    mutationsBlocked++; totalMutationsBlocked++;
    network.push({ endpoint: endpoint(url), method: request.method(), result: 'denied-method' });
    await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"FIXTURE_WRITE_DENIED"}' }); return;
  }
  await route.continue();
});
await context.routeWebSocket('**/*', socket => {
  const url = new URL(socket.url());
  if (url.origin === origin.replace('http:', 'ws:') && url.pathname.startsWith('/_next/')) socket.connectToServer();
  else { externalBlocked++; totalExternalBlocked++; socket.close(); }
});
page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) pending.add(request); });
page.on('requestfinished', request => pending.delete(request));
page.on('requestfailed', request => {
  pending.delete(request);
  const url = new URL(request.url());
  if (allowedOrigins.has(url.origin) && ['fetch', 'xhr'].includes(request.resourceType())) {
    network.push({ endpoint: endpoint(url), method: request.method(), result: request.failure()?.errorText.includes('ABORTED') ? 'cancelled' : 'failed' });
  }
});
page.on('response', response => {
  const url = new URL(response.url()), request = response.request();
  if (allowedOrigins.has(url.origin) && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/v1/'))) {
    network.push({ endpoint: endpoint(url), method: request.method(), status: response.status(), result: response.ok() ? 'http-ok' : 'http-error' });
  }
  if (allowedOrigins.has(url.origin) && ['/api/admin/sentry', '/api/admin/knowledge-graph'].includes(url.pathname)) {
    const target = apiSchemas;
    const check = (async () => {
      try {
        const value: unknown = await response.json();
        if (url.pathname === '/api/admin/sentry') target.push({ endpoint: url.pathname, valid: isAdminSentryResponse(value), ...(isAdminSentryResponse(value) ? { state: value.state } : {}) });
        else target.push({ endpoint: url.pathname, valid: isKnowledgeGraphPage(value), ...(isKnowledgeGraphPage(value) ? {
          nodes: value.nodes.length, edges: value.edges.length, revision: value.revision,
          verifiedEvidence: value.nodes.flatMap(node => node.evidence).filter(evidence => evidence.status === 'verified').length,
          unverifiedEvidence: value.nodes.flatMap(node => node.evidence).filter(evidence => evidence.status === 'unverified').length,
        } : {}) });
      } catch { target.push({ endpoint: url.pathname, valid: false }); }
    })();
    schemaChecks.add(check); void check.finally(() => schemaChecks.delete(check));
  }
});
page.on('pageerror', error => pageErrors.push(sha256(`${error.name}:${error.message}`)));
page.on('console', message => { if (message.type() === 'error') consoleErrors++; });

const canvas = page.locator('#admin-console-canvas');
async function observation(pattern: string) {
  return page.evaluate(pattern => {
    const root = document.querySelector<HTMLElement>('#admin-console-canvas');
    if (!root) return null;
    const visible = (element: Element) => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && !element.closest('[hidden], [aria-hidden="true"], .sr-only');
    };
    const text = root.innerText;
    const headings = [...root.querySelectorAll('h1,h2')].filter(visible);
    const matchesTitle = (element: Element) => new RegExp(pattern).test(element.textContent ?? '');
    const title = headings.find(element => element.closest('[data-admin-page-header="true"]') && matchesTitle(element))
      ?? headings.find(matchesTitle);
    const titleStyle = title ? getComputedStyle(title) : null;
    const pageHeader = title?.closest<HTMLElement>('[data-admin-page-header="true"], [data-admin-module-header="compact"], header');
    const bounds = (element: Element) => { const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height, centerY: value.y + value.height / 2 }; };
    const headerBox = pageHeader ? bounds(pageHeader) : null;
    const titleBox = title ? bounds(title) : null;
    const headerStyle = pageHeader ? getComputedStyle(pageHeader) : null;
    const headerActions = pageHeader ? [...pageHeader.querySelectorAll<HTMLElement>('button,a[href],select,input')].filter(visible).map(element => ({
      label: element.getAttribute('aria-label') || element.getAttribute('title') || (element instanceof HTMLSelectElement ? element.labels?.[0]?.textContent?.trim() : element.textContent?.trim()) || element.tagName,
      ...bounds(element),
    })) : [];
    const headerSummary = pageHeader?.querySelector<HTMLElement>('.admin-page-header-summary');
    const headerGeometry = headerBox && titleBox && headerStyle ? {
      ...headerBox, title: titleBox, titleInset: titleBox.x - headerBox.x,
      padding: { top: headerStyle.paddingTop, right: headerStyle.paddingRight, bottom: headerStyle.paddingBottom, left: headerStyle.paddingLeft },
      summary: headerSummary && visible(headerSummary) ? bounds(headerSummary) : null,
      summaryGap: headerSummary && visible(headerSummary) ? bounds(headerSummary).x - titleBox.x - titleBox.width : null,
      actionRightInset: headerActions.length ? headerBox.x + headerBox.width - Math.max(...headerActions.map(action => action.x + action.width)) : null,
      actions: headerActions, actionCenterDelta: headerActions.length ? Math.max(...headerActions.map(action => Math.abs(action.centerY - titleBox.centerY))) : null,
      headerOverflow: Math.max(0, pageHeader!.scrollWidth - pageHeader!.clientWidth),
      commonContract: pageHeader!.getAttribute('data-admin-page-header') === 'true',
    } : null;
    const controls = [...root.querySelectorAll<HTMLElement>('a[href],button,input:not([type="hidden"]),textarea,select,[tabindex]:not([tabindex="-1"])')]
      .filter(element => visible(element) && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true');
    const box = root.getBoundingClientRect();
    const escapedControls = controls.filter(element => {
      const bounds = element.getBoundingClientRect();
      if (bounds.left >= box.left - 1 && bounds.right <= box.right + 1) return false;
      // Nested table/graph carousels intentionally scroll; overflow:hidden does not count.
      let parent = element.parentElement;
      while (parent && parent !== root) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) return false;
        parent = parent.parentElement;
      }
      return true;
    }).length;
    const named = (element: HTMLElement) => Boolean(element.getAttribute('aria-label')?.trim()
      || element.getAttribute('title')?.trim() || element.textContent?.trim()
      || element.getAttribute('aria-labelledby')?.split(' ').some(id => document.getElementById(id)?.textContent?.trim())
      || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && element.labels?.length);
    const loading = [...root.querySelectorAll('[aria-busy="true"], [data-slot="skeleton"], .animate-pulse, [aria-label*="화면 로딩 중"]')].filter(visible).length;
    return {
      activeModule: root.getAttribute('data-admin-console-active-module'),
      characters: text.length, headingCount: headings.length,
      titleMatched: headings.some(element => new RegExp(pattern).test(element.textContent ?? '')),
      headerGeometry,
      titleStyle: titleStyle ? { fontSize: titleStyle.fontSize, fontWeight: titleStyle.fontWeight, lineHeight: titleStyle.lineHeight } : null,
      titleCount: headings.filter(element => element.tagName === 'H1').length,
      loading, controls: controls.length, unnamedControls: controls.filter(element => !named(element)).length,
      escapedControls, rows: root.querySelectorAll('tbody tr').length,
      images: [...root.querySelectorAll('img')].filter(visible).length,
      brokenImages: [...root.querySelectorAll('img')].filter(element => visible(element) && element.complete && element.naturalWidth === 0).length,
      graphs: [...root.querySelectorAll('svg[role],canvas')].filter(visible).length,
      graphNodes: root.querySelectorAll('svg[aria-label="지식 연결 그래프"] [role="button"]').length,
      graphEdges: root.querySelectorAll('svg[aria-label="지식 연결 그래프"] line').length,
      operationsRows: root.querySelectorAll('[data-operations-row]').length,
      operationsPending: (() => { const value = Number(root.querySelector('[data-operations-summary="pending"]')?.textContent?.match(/^\s*([0-9,]+)/)?.[1]?.replaceAll(',', '') ?? NaN); return Number.isFinite(value) ? value : null; })(),
      boundedHorizontalScrollRegions: [...root.querySelectorAll<HTMLElement>('[data-allow-horizontal-scroll="true"]')].filter(visible)
        .map(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX })),
      errorState: Boolean(root.querySelector('[data-admin-audit-unavailable-state="true"], [data-admin-sentry-state="unavailable"]')) || /조회 실패|읽지 못|불러올 수 없|불러오지 못|로드 실패|오류가 발생|Application error|예기치 않은 오류/.test(text),
      authenticationBlocked: /접근 권한이 없습니다|로그인이 필요합니다|관리자만 접근할 수/.test(text),
      notConfigured: Boolean(root.querySelector('[data-admin-sentry-state="not_configured"]')) || /Sentry 연결 (설정이 필요합니다|미설정)/.test(text),
      providerFallback: /도로 경로 대신 로컬 후보|지도 .*불러올 수 없|지도 API 로딩 실패/.test(text),
      emptyState: /검색 결과가 없|일치하는 지식이 없|아직 없|등록된 .*없|내역이 없|이력이 없|기록이 없|데이터가 없|결과가 없|제보가 없|리뷰가 없|사용자가 없|항목이 없/.test(text),
      documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      bodyOverflow: Math.max(0, document.body.scrollWidth - document.documentElement.clientWidth),
      darkApplied: document.documentElement.classList.contains('dark'),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      documentTitlePresent: document.title.trim().length > 0,
    };
  }, pattern);
}

async function settle(pattern: string) {
  const began = Date.now();
  let last = '', stable = 0, value = await observation(pattern);
  while (Date.now() - began < 10_000) {
    value = await observation(pattern);
    const signature = JSON.stringify(value);
    stable = signature === last ? stable + 1 : 0;
    last = signature;
    if (value && value.loading === 0 && value.characters > 30 && stable >= 3 && pending.size === 0 && schemaChecks.size === 0 && Date.now() - began >= 1_200) break;
    await page.waitForTimeout(200); // Bounded readiness polling, never a network-idle claim.
  }
  return { value, readinessTimedOut: Date.now() - began >= 10_000, pendingRequests: pending.size };
}

let interactionPhase = 'not-started';
async function safeInteraction(moduleId: string) {
  // Only explicit, read-only view controls are clicked. No generic first-button clicks.
  const search = canvas.locator('input[placeholder*="검색"], input[aria-label="지식 검색"]').filter({ visible: true }).first();
  if (await search.count()) {
    interactionPhase = 'search-fill';
    const before = network.length;
    await search.fill('fixture-no-match-731');
    const accepted = await search.inputValue() === 'fixture-no-match-731';
    await settle('.*');
    const requestObserved = network.slice(before).some(event => event.method === 'GET');
    const state = await observation('.*');
    const auditSearchEmpty = moduleId === 'audit' ? await canvas.locator('[data-admin-audit-event-list] tbody button[aria-expanded]').count() === 0 : null;
    interactionPhase = 'search-reset';
    await search.fill('');
    await settle('.*');
    let detailVerified: boolean | null = null, graphKeyboardVerified: boolean | null = null, statusFilterVerified: boolean | null = null;
    if (moduleId === 'users') {
      const detail = canvas.locator('[data-admin-users-detail-button]').filter({ visible: true }).first();
      if (await detail.count()) { await detail.click(); detailVerified = await page.locator('[aria-label="사용자 상세"]').filter({ visible: true }).isVisible(); }
    } else if (moduleId === 'banners') {
      const detail = canvas.locator('[aria-label="배너 목록"] button[aria-pressed]').filter({ visible: true }).first();
      if (await detail.isVisible()) { await detail.click(); detailVerified = await detail.getAttribute('aria-pressed') === 'true' && (await page.locator('input#title').filter({ visible: true }).inputValue()).length > 0; }
    } else if (moduleId === 'audit') {
      const status = canvas.getByLabel('감사 처리 상태', { exact: true });
      await status.selectOption('failed');
      statusFilterVerified = await canvas.locator('[data-admin-audit-event-list] tbody button[aria-expanded]').count() === 1;
      await status.selectOption('');
      const detail = canvas.locator('[data-admin-audit-event-list] button[aria-expanded]').first();
      if (await detail.isVisible()) { await detail.click(); detailVerified = await detail.getAttribute('aria-expanded') === 'true' && await canvas.locator('[aria-label="감사 항목 상세"]').isVisible(); }
    } else if (moduleId === 'llm') {
      const detail = canvas.locator('[aria-label="운영 우선순위 목록"] button[aria-pressed]').last();
      if (await detail.isVisible()) { await detail.click(); detailVerified = await detail.getAttribute('aria-pressed') === 'true' && await page.locator('[aria-label="운영 항목 상세"] h2').filter({ visible: true }).isVisible(); }
    } else if (moduleId === 'sentry') {
      const detail = canvas.locator('[data-sentry-issue] button[aria-pressed]').first();
      if (await detail.isVisible()) { await detail.click(); detailVerified = await detail.getAttribute('aria-pressed') === 'true' && await page.locator('[aria-label="Sentry 오류 상세"] h2').filter({ visible: true }).isVisible(); }
    } else if (moduleId === 'knowledge-graph') {
      const graphNode = canvas.locator('svg[aria-label="지식 연결 그래프"] [role="button"]').first();
      if (await graphNode.count()) {
        interactionPhase = 'graph-keyboard-focus';
        await graphNode.scrollIntoViewIfNeeded(); await graphNode.focus();
        const focused = await graphNode.evaluate(element => document.activeElement === element);
        interactionPhase = 'graph-keyboard-enter';
        if (focused) await page.keyboard.press('Enter');
        await settle('.*');
        interactionPhase = 'graph-selection-readback';
        graphKeyboardVerified = focused && await graphNode.getAttribute('aria-pressed') === 'true';
        const detailDrawer = page.getByRole('dialog', { name: '지식 근거', exact: true });
        await detailDrawer.waitFor({ state: 'visible' });
        detailVerified = await detailDrawer.locator('[aria-label="지식 근거 상세"] h2').isVisible();
        if (detailVerified) {
          await page.keyboard.press('Escape');
          await detailDrawer.waitFor({ state: 'detached' });
          graphKeyboardVerified &&= await graphNode.evaluate(element => document.activeElement === element);
        }
      }
    }
    if (detailVerified && (['users', 'banners', 'llm', 'sentry'].includes(moduleId))) {
      const inspector = page.getByRole('dialog').filter({ visible: true });
      if (await inspector.count()) {
        await page.keyboard.press('Escape');
        await inspector.waitFor({ state: 'detached' });
      }
    }
    return { kind: 'search', accepted, requestObserved, emptyStateObserved: auditSearchEmpty ?? state?.emptyState ?? false,
      detailVerified, graphKeyboardVerified, statusFilterVerified, conclusion: (auditSearchEmpty ?? state?.emptyState) ? 'filtered-empty-state' : 'input-only-filter-semantics-unverified' };
  }
  if (moduleId === 'overview') {
    const table = canvas.getByRole('button', { name: '표', exact: true }).first();
    if (await table.isVisible()) {
      await table.click();
      return { kind: 'table-view', accepted: true, tableVisible: await canvas.locator('table').filter({ visible: true }).count() > 0 };
    }
  }
  if (['restaurants', 'submissions', 'reviews'].includes(moduleId)) {
    const slide = canvas.getByRole('button', { name: '슬라이드 뷰', exact: true }).first();
    if (await slide.isVisible() && await slide.isEnabled()) {
      await slide.click();
      return { kind: 'slide-view', accepted: await slide.getAttribute('aria-pressed') === 'true' };
    }
  }
  return { kind: 'not-exercised', reason: 'no-allowlisted-read-only-control' };
}

const cases: Array<Record<string, unknown>> = [];
function withReadEvidence(records: typeof cases) {
  const reads = new Map<string, { caseIndex: number; module: unknown }>();
  return records.map((record, caseIndex) => {
    const group = `${record.width}:${record.colorScheme}`;
    for (const event of (record.network ?? []) as NetworkEvent[]) {
      if (event.method === 'GET' && event.result === 'http-ok') reads.set(`${group}:${event.endpoint}`, { caseIndex, module: record.module });
    }
    const expected = record.module === 'submissions' ? '/rest/v1/restaurant_submissions' : record.module === 'reviews' ? '/rest/v1/reviews' : null;
    if (!expected) return record;
    const evidence = reads.get(`${group}:${expected}`);
    const state = record.observation as Awaited<ReturnType<typeof observation>>;
    const issues = record.issues as string[];
    return { ...record, dataReadObserved: Boolean(evidence), dataReadEvidence: evidence ? { ...evidence, endpoint: expected,
      timing: evidence.caseIndex === caseIndex ? 'same-navigation' : 'earlier-navigation-shared-query-cache' } : null,
      bodyState: evidence && record.bodyState === 'rendered-query-not-exercised' ? (state?.emptyState ? 'rendered-empty' : 'rendered-content') : record.bodyState,
      verdict: evidence && record.verdict === 'fixture-or-feature-limited' && issues.length === 0 ? 'rendered-checks-pass' : record.verdict };
  });
}
const progress = () => {
  const sourceEnd = sources();
  const report = {
    kind: 'admin-sidebar-rendered-synthetic-fixture-audit', schemaVersion: 1,
    startedAt, observedThrough: new Date().toISOString(), synthetic: true, syntheticLogin: true, origin,
    browserSession, agentBrowser: '0.38.1', browser: browser.version(), node: process.version,
    limitations: ['Synthetic local fixture cannot establish production behavior, source-data correctness, provider availability, or deployment.',
      'Source manifests are frozen evidence; a matching running bundle is not assumed. HMR may change during observation.',
      'Synthetic login cookies are restricted to this isolated browser. No provider, generation, approval, deletion, application persistence, or hosted operation is exercised.',
      'HTTP 200 alone is not success. Error, skeleton, unsupported fixture, and not-configured states are reported separately.',
      'No raw admin body, table rows, request bodies, headers, cookies, local storage, or provider diagnostics are retained.'],
    matrix: { modules: selectedModules.map(module => module[0]), widths, colors, reducedMotion: 'reduce', expectedCases: selectedModules.length * widths.length * colors.length },
    safety: { allowedOrigins: [...allowedOrigins], serverBoundMethods: ['GET', 'HEAD', 'OPTIONS'], allowedMutations: 0, deniedNonReadMethodAttempts: totalMutationsBlocked, deniedExternalAttempts: totalExternalBlocked,
      syntheticReadScenario: { exactUrls: Object.values(syntheticReadUrls), fulfillCounts: syntheticReadMockCounts, forwardedPostRequests: 0, provesRealAuthOrDatabase: false } },
    sourceRoots, sourceStart, sourceEnd, sourceStableAcrossRun: sourceStart.signature === sourceEnd.signature,
    cases: withReadEvidence(cases),
  };
  const encoded = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(output, encoded); writeFileSync(output + '.sha256', sha256(encoded) + '\n');
};

// Shell bypass alone does not enable user-gated submission/review read queries.
// This GET creates only the fixture's synthetic browser session, never a real login.
await page.goto(origin + '/__fixture/session', { waitUntil: 'domcontentloaded' });
for (const width of widths) for (const colorScheme of colors) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto(origin + '/admin', { waitUntil: 'domcontentloaded' });
  await canvas.waitFor();
  await settle('.*');
  for (const [moduleId, menuTitle, titlePattern] of selectedModules) {
    const sourceBefore = sources().signature;
    const observedAt = new Date().toISOString();
    network = []; pageErrors = []; apiSchemas = []; consoleErrors = 0; externalBlocked = 0; mutationsBlocked = 0;
    const issues: string[] = [];
    interactionPhase = 'not-started';
    let enteredViaMenu = false, menuAttempts = 0, mobileMenuRevealedByScroll = false, action: Record<string, unknown> = { kind: 'not-exercised' };
    try {
      interactionPhase = 'menu-trigger-readiness';
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => {
        const label = button.getAttribute('aria-label') ?? '';
        return ['관리자 메뉴 열기', '대시보드 (KPI)'].includes(label) && button.getBoundingClientRect().width > 0;
      }));
      const openMenu = page.getByRole('button', { name: '관리자 메뉴 열기', exact: true });
      interactionPhase = 'menu-open';
      // Mobile chrome intentionally hides after descendant scrolling. Reveal it
      // through the real scroll owner before clicking, without forcing a click.
      const menuBounds = width === 390 ? await openMenu.boundingBox() : null;
      if (width === 390 && menuBounds && menuBounds.y < 0) {
        interactionPhase = 'mobile-menu-scroll-reveal';
        const scrollTarget = await page.evaluate(() => {
          let element = document.activeElement?.parentElement;
          while (element && element.id !== 'admin-console-canvas') {
            if (/auto|scroll/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight) {
              const box = element.getBoundingClientRect();
              return { x: Math.max(1, Math.min(innerWidth - 1, box.x + box.width / 2)), y: Math.max(1, Math.min(innerHeight - 1, box.y + Math.min(box.height / 2, innerHeight / 2))) };
            }
            element = element.parentElement;
          }
          return { x: innerWidth / 2, y: innerHeight / 2 };
        });
        await page.mouse.move(scrollTarget.x, scrollTarget.y); await page.mouse.wheel(0, -10_000);
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-admin-console-mobile-header="true"]');
          return element && element.getBoundingClientRect().top >= 0 && getComputedStyle(element).pointerEvents !== 'none';
        }, undefined, { timeout: 2_500 });
        mobileMenuRevealedByScroll = true;
      }
      interactionPhase = 'menu-open';
      if (await openMenu.isVisible() && await openMenu.getAttribute('aria-expanded') !== 'true') await openMenu.click();
      const menu = page.getByRole('button', { name: new RegExp(`^${menuTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( 대기 \\d+건)?$`) }).filter({ visible: true }).first();
      await menu.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {});
      // Server HTML can be visible before the popover's event handler hydrates.
      if (!await menu.isVisible() && await openMenu.isVisible() && await openMenu.getAttribute('aria-expanded') !== 'true') {
        await openMenu.click();
        await menu.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => {});
      }
      if (await menu.isVisible()) {
        for (let attempt = 0; attempt < 2; attempt++) {
          interactionPhase = 'menu-target-click';
          await menu.click(); menuAttempts++;
          const changed = await page.waitForFunction(id => document.querySelector('#admin-console-canvas')?.getAttribute('data-admin-console-active-module') === id,
            moduleId, { timeout: 2_500 }).then(() => true).catch(() => false);
          if (changed) { enteredViaMenu = true; break; }
          if (!await menu.isVisible()) break;
        }
      }
      else { issues.push('sidebar-item-missing'); await page.goto(`${origin}/admin?module=${moduleId}`, { waitUntil: 'domcontentloaded' }); }
      await canvas.waitFor();
      interactionPhase = 'module-readiness';
      const settled = await settle(titlePattern), state = settled.value;
      if (!state || state.activeModule !== moduleId) issues.push('wrong-route');
      if (!state?.titleMatched) issues.push('module-title-not-observed');
      if (settled.readinessTimedOut) issues.push('readiness-timeout');
      if (state && (state.documentOverflow > 1 || state.bodyOverflow > 1)) issues.push('page-horizontal-overflow');
      if (state?.escapedControls) issues.push('horizontally-clipped-controls');
      if (state?.darkApplied !== (colorScheme === 'dark')) issues.push('theme-not-applied');
      if (!state?.reducedMotion) issues.push('reduced-motion-not-applied');
      if (state?.errorState) issues.push('rendered-error-state');
      if (state?.authenticationBlocked) issues.push('authentication-blocked');
      if (!state?.controls) issues.push('no-enabled-controls');
      let bodyState = state?.loading ? 'skeleton-or-loading' : state?.notConfigured ? 'not-configured' : state?.errorState ? 'error' : state?.emptyState ? 'rendered-empty' : 'rendered-content';
      if (['sentry', 'knowledge-graph'].includes(moduleId) && state?.errorState) {
        bodyState = apiSchemas.some(schema => !schema.valid) ? 'fixture-response-contract-invalid' : 'api-unavailable';
      }
      if (moduleId === 'llm' && !state?.errorState) bodyState = state?.operationsRows ? 'rendered-read-model' : 'informational-workspace';
      const geometry = await canvas.evaluate(root => {
        const host = root.getBoundingClientRect();
        const graph = root.querySelector('[data-knowledge-canvas]')?.getBoundingClientRect();
        return { panelWidth: host.width, panelHeight: host.height, graphWidth: graph?.width ?? null,
          graphHeight: graph?.height ?? null, graphHeightShare: graph ? graph.height / host.height : null };
      });
      const screenshot = captureScreenshots ? resolve(root, `performance/ui-renewal-20261003/cms-${moduleId}-${width}-${colorScheme}-${suffix}.png`) : null;
      if (screenshot) await page.screenshot({ path: screenshot });
      await canvas.focus(); await page.keyboard.press('Tab');
      const keyboard = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null, canvas = document.querySelector('#admin-console-canvas');
        return { focusEnteredModule: Boolean(active && active !== canvas && canvas?.contains(active)), activeTag: active?.tagName ?? null, focusVisible: active?.matches(':focus-visible') ?? false };
      });
      if (!keyboard.focusEnteredModule) issues.push('keyboard-focus-did-not-enter-module');
      if (!state?.errorState && !state?.loading) action = await safeInteraction(moduleId);
      if (action.detailVerified === false || action.graphKeyboardVerified === false || action.statusFilterVerified === false) issues.push('read-only-detail-interaction-failed');
      if (action.kind !== 'not-exercised') await settle(titlePattern);
      if (pageErrors.length) issues.push('pageerror');
      const requiredFailures = network.filter(event => (event.result === 'http-error' || event.result === 'failed')
        && !network.some(denied => denied.result === 'denied-method' && denied.endpoint === event.endpoint && denied.method === event.method));
      if (requiredFailures.length) issues.push('api-failure');
      const dataReadEndpoint = moduleId === 'submissions' ? '/rest/v1/restaurant_submissions' : moduleId === 'reviews' ? '/rest/v1/reviews' : null;
      const dataReadObserved = dataReadEndpoint === null ? null : network.some(event => event.endpoint === dataReadEndpoint && event.result === 'http-ok');
      if (dataReadObserved === false) bodyState = 'rendered-query-not-exercised';
      const sourceAfter = sources().signature;
      cases.push({ module: moduleId, width, colorScheme, reducedMotion: 'reduce', observedAt, completedAt: new Date().toISOString(), sourceBefore, sourceAfter,
        sourceStableDuringCase: sourceBefore === sourceAfter, enteredViaMenu, menuAttempts, mobileMenuRevealedByScroll, bodyState, observation: state, readinessTimedOut: settled.readinessTimedOut,
        keyboard, safeInteraction: action, dataReadObserved, geometry, screenshot: screenshot ? relative(root, screenshot) : null, issues,
        verdict: issues.length ? 'needs-review' : state?.notConfigured ? 'not-configured' : dataReadObserved === false || moduleId === 'llm' && !state?.operationsRows || state?.providerFallback ? 'fixture-or-feature-limited' : 'rendered-checks-pass',
        network, apiSchemas, pageErrorHashes: pageErrors, consoleErrors, externalBlocked, mutationsBlocked });
    } catch (error) {
      cases.push({ module: moduleId, width, colorScheme, reducedMotion: 'reduce', observedAt, sourceBefore, enteredViaMenu,
        verdict: 'harness-or-navigation-failed', interactionPhase, failureKind: error instanceof Error ? error.name : 'unknown', failureHash: sha256(error instanceof Error ? `${error.name}:${error.message}` : String(error)), issues: [...issues, 'bounded-check-failed'], network, apiSchemas, pageErrorHashes: pageErrors, consoleErrors, externalBlocked, mutationsBlocked });
      // Recovery remains within the same owned fixture tab and read-only guard.
      await page.goto(origin + '/admin', { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    progress();
    const result = cases.at(-1)!;
    console.log(JSON.stringify({ module: moduleId, width, colorScheme, verdict: result.verdict, bodyState: result.bodyState, issues: result.issues }));
  }
}
progress();
console.log(JSON.stringify({ report: relative(root, output), cases: cases.length, deniedNonReadMethodAttempts: totalMutationsBlocked, deniedExternalAttempts: totalExternalBlocked }));
// Disconnect the CDP client without closing the agent-browser-owned session.
await browser.close();
