/** Synthetic, loopback-only recovery checks through an owned agent-browser 0.38.1 CDP session. */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isKnowledgeGraphPage, type KnowledgeGraphPage, type KnowledgeNode } from '../types/knowledge-graph.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:18794', fakeSupabase = 'http://127.0.0.1:18793';
const allowedOrigins = new Set([origin, fakeSupabase]);
const connection = process.argv[2];
if (!/^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-z0-9-]+$/i.test(connection ?? '')) throw new Error('OWNED_LOCAL_BROWSER_REQUIRED');
const output = resolve(root, 'performance/knowledge-graph-20261004/recovery-browser-20261004.json');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const sourcePaths = ['components/admin/AdminKnowledgeGraphPanel.tsx', 'types/knowledge-graph.ts',
  'app/api/admin/knowledge-graph/route.ts', 'scripts/preview-design-fixtures.mjs', 'scripts/verify-knowledge-graph-recovery-browser.ts'];
const sources = () => sourcePaths.map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
const sourceStart = sources();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const assertions: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean) {
  assertions.push({ name, passed });
  if (!passed) throw new Error(name);
}
const fixtureNodes: KnowledgeNode[] = Array.from({ length: 101 }, (_, index) => ({
  id: `fixture-video-${String(index).padStart(3, '0')}`, kind: 'video',
  label: `합성 검증 영상 ${String(index).padStart(3, '0')}`, summary: `합성 검증 설명 ${index}`,
  evidence: [{ videoId: 'fixture0001', startSeconds: 65, endSeconds: 70,
    url: 'https://www.youtube.com/watch?v=fixture0001&t=65s', status: 'verified' }],
}));
const oldCursor = Buffer.from(JSON.stringify({ revision: 'a'.repeat(64), offset: 100 })).toString('base64url');
let initialFailure = true, revisionChanged = false, phase = 'setup', fixtureValidationCount = 0;
const graphRequests: Array<{ phase: string; status: number; cursorPresent: boolean; selectedPresent: boolean; searchPresent: boolean; kindPresent: boolean }> = [];
const syntheticReadMockCounts: Record<string, number> = {};
const pageErrors: string[] = [], unexpectedConsoleErrors: string[] = [];
let consoleErrors = 0, expectedStatusConsoleErrors = 0, externalBlocked = 0, mutationsBlocked = 0;
let allowedReadRequests = 0, allowedReadFailures = 0, recoveryRequests = 0, oldCursorResendsDuringRecovery = 0;
function fixturePage(params: URLSearchParams): KnowledgeGraphPage {
  const q = (params.get('q') ?? '').toLowerCase(), kind = params.get('kind') ?? '';
  const filtered = fixtureNodes.filter(node => (!q || `${node.label} ${node.summary}`.toLowerCase().includes(q)) && (!kind || node.kind === kind));
  const offset = params.has('cursor') ? 100 : 0;
  const value: KnowledgeGraphPage = {
    revision: (revisionChanged ? 'b' : 'a').repeat(64), generatedAt: '2026-10-04T00:00:00.000Z',
    coverage: { inventoryCount: 106, eligibleCount: 101, analyzedCount: 2, failedCount: 1,
      pendingCount: 98, excludedShortsCount: 5, asOf: '2026-10-04T00:00:00.000Z' },
    nodes: filtered.slice(offset, offset + 100), edges: [], selected: fixtureNodes.find(node => node.id === params.get('node')) ?? null,
    totalNodes: 101, totalEdges: 0, filteredTotal: filtered.length, omittedEdges: 0,
    nextCursor: offset + 100 < filtered.length ? oldCursor : null,
  };
  if (!isKnowledgeGraphPage(value)) throw new Error('SYNTHETIC_SCHEMA_INVALID');
  fixtureValidationCount++;
  return value;
}
// Validate complete page/selection shapes before opening the application.
fixturePage(new URLSearchParams());
fixturePage(new URLSearchParams({ cursor: oldCursor, node: fixtureNodes[100].id }));
fixturePage(new URLSearchParams({ q: 'no-matching-fixture' }));
const syntheticReadUrls = {
  eligibility: `${fakeSupabase}/rest/v1/rpc/get_current_privacy_eligibility`,
  activeSession: `${fakeSupabase}/rest/v1/rpc/is_current_auth_session_active`,
  profile: `${fakeSupabase}/rest/v1/rpc/read_public_profile_summaries`,
  adminProfile: `${origin}/api/admin/profile-summaries`,
};
const fixtureProfiles = Array.from({ length: 3 }, (_, index) => ({
  user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`, nickname: `검증 사용자 ${index + 1}`, avatar_url: null,
}));
const startedAt = new Date().toISOString();
const browser = await chromium.connectOverCDP(connection);
let failureCode: string | null = null;
try {
  const context = browser.contexts()[0];
  const blankUrls = new Set(['about:blank', 'chrome://new-tab-page/', 'chrome://newtab/']);
  check('isolated-owned-browser', !!context && context.pages().every(page => blankUrls.has(page.url()) || page.url().startsWith(origin)));
  const page = context.pages().find(page => page.url().startsWith(origin) || blankUrls.has(page.url())) ?? await context.newPage();
  page.setDefaultTimeout(8_000); page.setDefaultNavigationTimeout(20_000);
  await page.setViewportSize({ width: 1423, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await context.unrouteAll({ behavior: 'wait' });
  await context.addInitScript(() => {
    localStorage.setItem('tzudong:e2e-admin-shell-bypass', '1');
    localStorage.setItem('tzudong-admin-theme', 'system');
    localStorage.setItem('tzudong-admin-sidebar-collapsed', 'false');
    localStorage.removeItem('adminEvaluationPageState');
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!allowedOrigins.has(url.origin)) { externalBlocked++; await route.abort('blockedbyclient'); return; }
    // Copied exact synthetic read contracts from verify-admin-sidebar-pages-browser.ts; never forwarded.
    if (request.method() === 'POST' && Object.values(syntheticReadUrls).includes(url.href)) {
      let value: unknown;
      if (url.href === syntheticReadUrls.eligibility) value = { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE',
        policyVersionId: '00000000-0000-4000-8000-000000000001', policyVersion: '2026-08-04.1',
        contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' };
      else if (url.href === syntheticReadUrls.activeSession) value = true;
      else {
        let ids: unknown;
        const body = request.postData() ?? '';
        try { ids = body.length <= 65_536 ? JSON.parse(body)[url.href === syntheticReadUrls.profile ? 'p_user_ids' : 'userIds'] : null; } catch { ids = null; }
        if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"FIXTURE_READ_INPUT_INVALID"}' }); return;
        }
        value = url.href === syntheticReadUrls.profile ? fixtureProfiles.filter(profile => ids.includes(profile.user_id))
          : { rows: ids.map(id => ({ userId: id, nickname: fixtureProfiles.find(profile => profile.user_id === id)?.nickname ?? null })) };
      }
      syntheticReadMockCounts[url.pathname] = (syntheticReadMockCounts[url.pathname] ?? 0) + 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) }); return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutationsBlocked++; await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"FIXTURE_WRITE_DENIED"}' }); return;
    }
    if (url.origin === origin && url.pathname === '/api/admin/knowledge-graph' && request.method() === 'GET') {
      const status = initialFailure ? 503 : revisionChanged && url.searchParams.has('cursor') ? 409 : 200;
      graphRequests.push({ phase, status, cursorPresent: url.searchParams.has('cursor'), selectedPresent: url.searchParams.has('node'), searchPresent: !!url.searchParams.get('q'), kindPresent: !!url.searchParams.get('kind') });
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? fixturePage(url.searchParams) : { error: status === 409 ? 'CURSOR_STALE' : 'FIXTURE_UNAVAILABLE' }) }); return;
    }
    allowedReadRequests++; await route.continue();
  });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.origin === origin.replace('http:', 'ws:') && url.pathname.startsWith('/_next/')) socket.connectToServer();
    else { externalBlocked++; socket.close(); }
  });
  page.on('pageerror', error => pageErrors.push(hash(`${error.name}:${error.message}`)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    consoleErrors++;
    if (/Failed to load resource.*(?:503|409)/.test(message.text())) expectedStatusConsoleErrors++;
    else unexpectedConsoleErrors.push(hash(message.text()));
  });
  page.on('requestfailed', request => {
    if (allowedOrigins.has(new URL(request.url()).origin) && !request.failure()?.errorText.includes('ABORTED')) allowedReadFailures++;
  });
  const panel = page.locator('[data-admin-knowledge-graph-panel]');
  const list = panel.getByRole('list', { name: '지식 목록' });
  const detail = panel.getByRole('complementary', { name: '지식 근거 상세' });
  const refresh = panel.getByRole('button', { name: '지식 그래프 새로고침', exact: true });
  const previous = panel.getByRole('button', { name: '이전 지식 페이지' });
  const next = panel.getByRole('button', { name: '다음 지식 페이지' });
  async function settled() {
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-admin-knowledge-graph-panel] button[aria-label="지식 그래프 새로고침"]');
      return button && !button.disabled;
    });
    // A bounded task turn catches duplicate requests scheduled by the same React event.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  phase = 'initial-503';
  await page.goto(`${origin}/__fixture/session`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${origin}/admin?module=knowledge-graph`, { waitUntil: 'domcontentloaded' });
  await panel.getByRole('alert').filter({ hasText: '지식 그래프를 불러올 수 없습니다.' }).waitFor();
  await settled();
  check('initial-503-rendered', graphRequests.some(request => request.phase === phase && request.status === 503));
  check('unknown-analysis-count-is-dash', /분석 — \/ 대상 확인 중/.test(await panel.locator('header').innerText()));
  check('unknown-failure-count-is-dash', /대기 수 확인 중 · 실패 —/.test(await panel.locator('footer').innerText()));
  check('initial-error-shows-no-success-data', await list.count() === 0);

  phase = 'retry-initial'; initialFailure = false;
  let before = graphRequests.length;
  await panel.getByRole('button', { name: '다시 조회', exact: true }).click();
  await list.getByRole('button').filter({ hasText: fixtureNodes[0].label }).waitFor(); await settled();
  check('initial-retry-one-cursorless-request', graphRequests.length - before === 1 && !graphRequests.at(-1)!.cursorPresent);
  check('first-page-100-nodes', await list.getByRole('button').count() === 100);
  check('known-counts-rendered', /분석 2 \/ 101/.test(await panel.locator('header').innerText()) && /대기 98 · 실패 1/.test(await panel.locator('footer').innerText()));

  phase = 'second-page';
  await next.click();
  await list.getByRole('button').filter({ hasText: fixtureNodes[100].label }).waitFor(); await settled();
  check('second-page-one-node', await list.getByRole('button').count() === 1 && !(await previous.isDisabled()));
  check('second-page-cursor-request', graphRequests.at(-1)!.cursorPresent && graphRequests.at(-1)!.status === 200);

  phase = 'revision-409'; revisionChanged = true;
  await list.getByRole('button').filter({ hasText: fixtureNodes[100].label }).click();
  await panel.getByRole('alert').filter({ hasText: '분석 결과가 갱신되었습니다.' }).waitFor(); await settled();
  check('revision-409-rendered', graphRequests.at(-1)!.status === 409 && graphRequests.at(-1)!.cursorPresent);

  phase = 'recover-first-page'; before = graphRequests.length;
  await panel.getByRole('button', { name: '다시 조회', exact: true }).click();
  await list.getByRole('button').filter({ hasText: fixtureNodes[0].label }).waitFor(); await settled();
  const recovery = graphRequests.slice(before); recoveryRequests = recovery.length;
  oldCursorResendsDuringRecovery = recovery.filter(request => request.cursorPresent).length;
  check('recovery-one-cursorless-request', recoveryRequests === 1 && oldCursorResendsDuringRecovery === 0 && recovery[0].status === 200);
  check('recovered-first-page-controls', await previous.isDisabled() && !(await next.isDisabled()));
  check('recovered-first-page-100-nodes', await list.getByRole('button').count() === 100);
  check('off-page-selection-detail-preserved', (await detail.getByRole('heading', { level: 2 }).innerText()) === fixtureNodes[100].label);
  check('timestamp-evidence-link-rendered', await detail.getByRole('link').getAttribute('href') === fixtureNodes[100].evidence[0].url && /1:05 · 근거 있음/.test(await detail.innerText()));

  phase = 'refresh-first-page'; before = graphRequests.length;
  await refresh.click(); await settled();
  check('first-page-refresh-one-cursorless-request', graphRequests.length - before === 1 && !graphRequests.at(-1)!.cursorPresent);

  phase = 'search';
  await panel.getByRole('textbox', { name: '지식 검색' }).fill(fixtureNodes[3].label);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="지식 목록"] li').length === 1); await settled();
  check('search-one-matching-node', (await list.innerText()).includes(fixtureNodes[3].label) && graphRequests.at(-1)!.searchPresent);
  check('search-resets-pagination', await previous.isDisabled() && await next.isDisabled() && !graphRequests.at(-1)!.cursorPresent);
  phase = 'select-search-result';
  await list.getByRole('button').click();
  await detail.getByRole('heading', { name: fixtureNodes[3].label, exact: true }).waitFor(); await settled();
  check('list-selection-updates-detail', await list.getByRole('button').getAttribute('aria-pressed') === 'true' && graphRequests.at(-1)!.selectedPresent);

  phase = 'empty-search';
  await panel.getByRole('textbox', { name: '지식 검색' }).fill('no-matching-fixture');
  await panel.getByText('일치하는 지식이 없습니다.', { exact: true }).waitFor(); await settled();
  check('empty-search-rendered', await list.getByRole('button').count() === 0);
  phase = 'reset-search';
  await panel.getByRole('textbox', { name: '지식 검색' }).fill('');
  await list.getByRole('button').filter({ hasText: fixtureNodes[0].label }).waitFor(); await settled();
  check('cleared-search-restores-first-page', await list.getByRole('button').count() === 100 && await previous.isDisabled());
  phase = 'select-graph-node';
  await panel.getByRole('group', { name: '지식 연결 그래프' }).getByRole('button', { name: `영상: ${fixtureNodes[0].label}`, exact: true }).click();
  await detail.getByRole('heading', { name: fixtureNodes[0].label, exact: true }).waitFor(); await settled();
  check('graph-click-updates-detail', await list.getByRole('button').filter({ hasText: fixtureNodes[0].label }).getAttribute('aria-pressed') === 'true');
  check('no-browser-page-errors', pageErrors.length === 0);
  check('no-unexpected-console-errors', unexpectedConsoleErrors.length === 0);
  check('no-local-network-failures', allowedReadFailures === 0);
  check('no-mutation-attempts', mutationsBlocked === 0);
  check('source-stable-during-run', JSON.stringify(sourceStart) === JSON.stringify(sources()));
} catch (error) {
  failureCode = assertions.at(-1)?.passed === false ? assertions.at(-1)!.name : `${phase}:${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`;
} finally {
  await browser.close(); // Disconnect CDP; caller closes only its named agent-browser session.
  const report = {
    schemaVersion: 1, startedAt, completedAt: new Date().toISOString(), passed: failureCode === null,
    failureCode, sourceHead: head, sourceStart, sourceEnd: sources(),
    environment: { browserOwner: 'tzudong-kg-recovery-astra-74a1b6', agentBrowserVersion: '0.38.1', viewport: { width: 1423, height: 1000 }, colorScheme: 'light',
      fixtureOrigin: origin, fakeSupabaseOrigin: fakeSupabase, nodeVersion: process.version },
    requests: { graph: graphRequests, graphTotal: graphRequests.length, recoveryRequests, oldCursorResendsDuringRecovery,
      syntheticReadMockCounts, allowedReadRequests, allowedReadFailures, externalBlocked, mutationsBlocked,
      forwardedMutations: 0, forwardedExternalRequests: 0 },
    fixtures: { nodes: 101, initialRevision: 'a'.repeat(64), updatedRevision: 'b'.repeat(64), fixtureValidationCount, validation: 'actual-isKnowledgeGraphPage' },
    diagnostics: { pageErrorCount: pageErrors.length, pageErrorHashes: pageErrors, consoleErrors, expectedStatusConsoleErrors, unexpectedConsoleErrorHashes: unexpectedConsoleErrors },
    assertions,
    limits: ['Synthetic browser-fulfilled graph responses; no live database/provider or deployed API validation.',
      'One desktop light viewport; not a cross-device, performance, statistical, or full accessibility audit.',
      'Evidence links were inspected without navigating to external video.',
      'Git HEAD plus source hashes identify local dirty/untracked source, not a deployment receipt.',
      'Recovery request assertions cover this deterministic event sequence only.'],
  };
  const body = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(output, body); writeFileSync(output + '.sha256', hash(body) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failureCode, assertions: assertions.length, graphRequests: graphRequests.length, recoveryRequests, oldCursorResendsDuringRecovery, report: output }));
  if (failureCode) process.exitCode = 1;
}
