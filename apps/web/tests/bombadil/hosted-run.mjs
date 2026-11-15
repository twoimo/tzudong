import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isAllowedRequest, safeFailureCode } from './policy.mjs';
import { sha256 } from './fixture-server.mjs';

const BINARY_SHA256 = '6f2664ca7d4067017b4efb26db5c29d6dcfecdc78131f96989d336f12420cc1b';
const viewports = [{ name: 'desktop', width: 1024, height: 768 }, { name: 'mobile', width: 390, height: 844 }];
const denyFlags = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'];
const propertyNames = new Set(['noUncaughtExceptions', 'noUnhandledPromiseRejections', 'onlyOwnedFixture',
  'pageFitsViewport', 'themeSelectionMatchesState', 'referenceRolesStayAligned', 'visibleControlsHaveNames']);

async function denyProxy() {
  let blocked = 0;
  const server = createServer((_request, response) => { blocked += 1; response.writeHead(403); response.end(); });
  server.on('connect', (_request, socket) => { blocked += 1; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, blocked: () => blocked,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

async function runBombadil(binary, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(binary, args, { cwd, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
    // Raw CLI diagnostics remain in memory and are never printed or uploaded.
    let bytes = 0;
    let failureCode = null;
    const diagnosticCategories = new Set();
    const consume = chunk => {
      bytes += chunk.length;
      const text = chunk.toString('utf8');
      for (const [name, pattern] of [
        ['specification', /SyntaxError|parse error|failed to.*bundl|failed to load.*specification/i],
        ['instrumentation', /Fetch instrumentation worker failed|Content Security Policy/i],
        ['target', /target.*closed|no page target available|No target with given id/i],
        ['debugger_connection', /WebSocket.*error|connection refused|connection reset/i],
        ['stalled', /browser stalled/i], ['timeout', /timed? ?out/i],
        ['policy_denial', /permission denied|operation not permitted|No usable sandbox/i],
      ]) if (pattern.test(text)) diagnosticCategories.add(name);
      if (bytes > 2 * 1024 * 1024) { failureCode = 'QA_TOOL_OUTPUT_LIMIT'; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    const timeout = setTimeout(() => { failureCode = 'QA_TOOL_TIMEOUT'; child.kill('SIGTERM'); }, 60_000);
    const hardStop = setTimeout(() => child.kill('SIGKILL'), 65_000);
    child.once('error', () => { clearTimeout(timeout); clearTimeout(hardStop); resolve({ exitCode: null, failureCode: 'QA_TOOL_START_FAILED', outputBytes: bytes, diagnosticCategories: [...diagnosticCategories] }); });
    child.once('close', exitCode => { clearTimeout(timeout); clearTimeout(hardStop); resolve({ exitCode, failureCode, outputBytes: bytes, diagnosticCategories: [...diagnosticCategories] }); });
  });
}

async function summarizeTrace(directory, origin) {
  const filename = path.join(directory, 'trace.jsonl');
  if ((await stat(filename)).size > 64 * 1024 * 1024) throw new Error('QA_TRACE_LIMIT');
  const bytes = await readFile(filename);
  const lines = bytes.toString('utf8').trim().split('\n');
  if (!lines.length || lines.length > 20_000) throw new Error('QA_TRACE_SHAPE');
  let actions = 0;
  let snapshots = 0;
  let violations = 0;
  let firstViolationState = null;
  const violationProperties = new Set();
  let unknownViolationProperties = 0;
  for (const [stateIndex, line] of lines.entries()) {
    const entry = JSON.parse(line);
    const url = new URL(entry.state?.url);
    if (url.origin !== origin || url.pathname !== '/fixture' || url.search || !Array.isArray(entry.snapshots) || !Array.isArray(entry.violations)) throw new Error('QA_TRACE_SHAPE');
    if (entry.action !== null) actions += 1;
    snapshots += entry.snapshots.length;
    violations += entry.violations.length;
    for (const violation of entry.violations) {
      if (firstViolationState === null) firstViolationState = stateIndex;
      if (propertyNames.has(violation.name)) violationProperties.add(violation.name);
      else unknownViolationProperties += 1;
    }
  }
  if (actions === 0 || snapshots === 0) throw new Error('QA_TRACE_VACUOUS');
  return { sha256: sha256(bytes), bytes: bytes.length, states: lines.length, actions, snapshots, violations,
    firstViolationState, violationProperties: [...violationProperties], unknownViolationProperties };
}

async function deterministicCases({ page, expect, origin, output, viewport, stage }) {
  const cases = [];
  const geometry = [];
  const capture = async view => {
    const shape = await page.evaluate(() => ({
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      horizontalScrollOwners: [...document.querySelectorAll('[data-allow-horizontal-scroll="true"]')]
        .map(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth })),
    }));
    assert.ok(shape.documentWidth <= shape.viewportWidth + 1);
    geometry.push({ view, ...shape });
    await page.screenshot({ path: path.join(output, `${viewport.name}-${view}.png`) });
  };
  const navigate = async view => { await page.goto(`${origin}/fixture#${view}`); await expect(page.locator('[data-bombadil-fixture]')).toHaveAttribute('data-view', view); };
  stage('home_open');
  await navigate('home');
  stage('theme_toggle_notice_escape_focus');
  const themes = page.getByRole('group', { name: '쯔양 영상 테마 필터' }).getByRole('button');
  await themes.first().click();
  await expect(themes.first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /필터 기준 보기/ }).click();
  await expect(page.getByText('선택한 필터를 다시 누르면 해제됩니다')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /필터 기준 보기/ })).toBeFocused();
  await themes.first().click();
  await expect(themes.first()).toHaveAttribute('aria-pressed', 'false');
  cases.push('home_theme_toggle_notice_escape_focus');
  stage('region_search_empty_recovery');
  await page.getByRole('combobox', { name: /지역 선택/ }).click();
  const regionSearch = page.getByRole('combobox', { name: '지역 검색' });
  await regionSearch.fill('일치하지않는합성지역');
  await page.getByRole('button', { name: '전체 지역 보기' }).click();
  await expect(regionSearch).toHaveValue('');
  await expect(regionSearch).toBeFocused();
  stage('region_select_seoul');
  await regionSearch.fill('서울');
  await page.getByRole('option', { name: '서울', exact: true }).click();
  await expect(page.locator('[data-home-fixture]')).toHaveAttribute('data-region', 'seoul');
  cases.push('home_region_empty_recovery_selection');
  stage('location_disclosure_cancel_confirm');
  await page.getByRole('button', { name: '현재 위치 안내 열기' }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('[data-home-fixture]')).toHaveAttribute('data-location-confirmations', '0');
  await page.getByRole('button', { name: '현재 위치 안내 열기' }).click();
  await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
  await expect(page.locator('[data-home-fixture]')).toHaveAttribute('data-location-confirmations', '1');
  cases.push('home_disclosure_cancel_confirm_memory_only');
  await capture('home');

  stage('performance_open_and_filters');
  await navigate('performance');
  await page.getByLabel('방식', { exact: true }).selectOption('rpc');
  await page.getByLabel('구간', { exact: true }).selectOption('database');
  await expect(page.getByRole('region', { name: '개별 요청 측정 표' }).locator('tbody tr')).toHaveCount(1);
  stage('performance_static_export');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '측정 데이터' }).click();
  const download = await downloadWait;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('QA_DOWNLOAD_MISSING');
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) { total += chunk.length; if (total > 128 * 1024) throw new Error('QA_DOWNLOAD_LIMIT'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  const value = JSON.parse(bytes.toString('utf8'));
  assert.equal(value.cohortCount, 100);
  assert.equal(value.phases.length, 2);
  cases.push('performance_filters_and_local_static_export');
  await capture('performance');

  stage('thumbnail_open_add_and_remove_reference');
  await navigate('thumbnail');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByLabel('참고 이미지 2 용도').selectOption('host');
  await page.getByRole('button', { name: '참고 이미지 1 삭제' }).click();
  await expect(page.getByLabel('참고 이미지 1 용도')).toHaveValue('host');
  await expect(page.locator('[data-thumbnail-fixture]')).toHaveAttribute('data-reference-count', '1');
  stage('thumbnail_memory_preview');
  await page.getByLabel('영상 주제', { exact: true }).fill('합성 시장 방문');
  await page.getByRole('button', { name: '문구 배치 미리보기' }).click();
  await expect(page.locator('[data-thumbnail-fixture]')).toHaveAttribute('data-preview-count', '1');
  cases.push('thumbnail_reference_removal_role_and_preview_memory_only');
  await capture('thumbnail');

  stage('storyboard_open_and_pagination');
  await navigate('storyboard');
  await page.getByRole('button', { name: '다음 네 컷' }).click();
  await expect(page.getByRole('button', { name: '장면 5 선택' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: '장면 6 선택' }).click();
  await expect(page.locator('[data-storyboard-fixture]')).toHaveAttribute('data-selected-scene', '6');
  await page.getByRole('button', { name: '이전 네 컷' }).click();
  await expect(page.getByRole('button', { name: '장면 1 선택' })).toHaveAttribute('aria-current', 'step');
  stage('storyboard_mock_unavailable_no_send');
  await expect(page.getByRole('button', { name: '연결 상태 다시 확인' })).toBeVisible();
  await page.getByLabel('AI에게 보낼 메시지').fill('합성 화면에서만 유지되는 요청');
  await expect(page.getByRole('button', { name: '보내기', exact: true })).toBeDisabled();
  cases.push('storyboard_pagination_and_mock_unavailable_no_send');
  await capture('storyboard');
  stage('skeletons_open_and_bounded');
  await navigate('skeleton');
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  cases.push('skeletons_bounded_busy_state');
  await capture('skeleton');
  return { cases, geometry, export: { bytes: total, sha256: sha256(bytes) } };
}

export async function runHostedQa({ root, web, harness, output, fixture, bombadil, buildReceipt }) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('QA_HOSTED_ENVIRONMENT_REQUIRED');
  const receipt = { schema: 'tzudong-bombadil-hosted-qa-v1', scope: buildReceipt.scope, sourceSha: buildReceipt.sourceSha,
    startedAtUtc: new Date().toISOString(), status: 'running', browserLaunchAttempts: 0,
    productionRequests: 0, providerRequests: 0, arbitraryExternalForwarding: false,
    sandboxRequested: true, sandboxDisableFlagsPresent: null, browserVersion: null,
    phaseResults: [], blockedRequests: 0, blockedWebSockets: 0, unexpectedPages: 0, pageErrors: 0 };
  let context;
  let proxy;
  let profile;
  let page;
  try {
    const binary = await readFile(bombadil);
    if (binary.length !== 17_972_264 || sha256(binary) !== BINARY_SHA256) throw new Error('QA_BOMBADIL_PIN');
    receipt.bombadil = { version: '0.7.10', sha256: BINARY_SHA256 };
    if (execFileSync(bombadil, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim() !== 'bombadil 0.7.10') throw new Error('QA_BOMBADIL_VERSION');
    const require = createRequire(path.join(web, 'package.json'));
    const { chromium, expect } = require('@playwright/test');
    const authority = JSON.parse(await readFile(path.join(root, '.github/chrome-for-testing.v1.json'), 'utf8'));
    const playwright = require('playwright-core/package.json');
    const browsers = JSON.parse(await readFile(path.join(web, 'node_modules/playwright-core/browsers.json'), 'utf8'));
    if (playwright.version !== authority.playwrightVersion || browsers.browsers.find(row => row.name === 'chromium')?.browserVersion !== authority.version) throw new Error('QA_BROWSER_AUTHORITY');
    const executablePath = chromium.executablePath();
    receipt.browserExecutableSha256 = sha256(await readFile(executablePath));
    profile = await mkdtemp(path.join(os.tmpdir(), 'tzudong-bombadil-owned-'));
    proxy = await denyProxy();
    receipt.browserLaunchAttempts = 1;
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath, headless: true, chromiumSandbox: true, serviceWorkers: 'block', acceptDownloads: true,
        viewport: { width: 1024, height: 768 }, timeout: 30_000,
        proxy: { server: proxy.url, bypass: '127.0.0.1' },
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC' },
        args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      });
    } catch (error) {
      receipt.launchFailureCategory = /No usable sandbox|Failed to move to new namespace|Operation not permitted|Running as root without --no-sandbox/i.test(error instanceof Error ? error.message : '')
        ? 'explicit_sandbox_denial' : 'launch_failed_unclassified';
      throw new Error('QA_BROWSER_LAUNCH_FAILED_STOP_NO_RETRY');
    }
    if (context.pages().length !== 1) throw new Error('QA_PAGE_TARGET_COUNT');
    page = context.pages()[0];
    await context.route('**/*', async route => {
      const request = route.request();
      if (isAllowedRequest({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, fixture.origin)) await route.continue();
      else { receipt.blockedRequests += 1; await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', socket => { receipt.blockedWebSockets += 1; socket.close(); });
    context.on('page', newPage => {
      if (newPage !== page) {
        receipt.unexpectedPages += 1;
        void newPage.close().catch(() => { receipt.unexpectedPageCloseFailure = true; });
      }
    });
    page.on('pageerror', () => { receipt.pageErrors += 1; });
    page.setDefaultTimeout(5000);
    const cdp = await context.newCDPSession(page);
    const { arguments: commandLine } = await cdp.send('Browser.getBrowserCommandLine');
    receipt.sandboxDisableFlagsPresent = commandLine.some(argument => denyFlags.some(flag => argument === flag || argument.startsWith(`${flag}=`)));
    if (receipt.sandboxDisableFlagsPresent) throw new Error('QA_SANDBOX_DISABLED');
    const version = await cdp.send('Browser.getVersion');
    receipt.browserVersion = version.product;
    if (version.product.split('/').at(-1) !== authority.version) throw new Error('QA_BROWSER_VERSION');
    const debuggerPort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    if (!/^\d+$/.test(debuggerPort) || +debuggerPort < 1 || +debuggerPort > 65535) throw new Error('QA_OWNED_DEBUGGER_PORT');
    for (const viewport of viewports) {
      const phase = { viewport, status: 'running', deterministic: null, bombadil: null };
      receipt.phaseResults.push(phase);
      receipt.currentPhase = viewport.name;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      phase.deterministic = await deterministicCases({ page, expect, origin: fixture.origin, output, viewport,
        stage: value => { receipt.currentStep = value; } });
      receipt.currentStep = 'bombadil_prepare_existing_page';
      await page.goto(`${fixture.origin}/fixture#home`);
      await expect(page.locator('[data-bombadil-fixture]')).toHaveAttribute('data-view', 'home');
      const traceDirectory = path.join(profile, `trace-${viewport.name}`);
      await mkdir(traceDirectory);
      if (context.pages().length !== 1 || context.pages()[0] !== page) throw new Error('QA_PAGE_TARGET_COUNT');
      receipt.currentStep = 'bombadil_exploration';
      const result = await runBombadil(bombadil, ['browser', 'test-external',
        '--remote-debugger', `http://127.0.0.1:${debuggerPort}`, '--chrome-grant-permissions', '',
        '--instrument-javascript', '',
        '--width', String(viewport.width), '--height', String(viewport.height),
        '--time-limit', '30s', '--exit-on-violation', '--output-path', traceDirectory,
        `${fixture.origin}/fixture`, path.join(harness, 'specification.js')], web);
      phase.bombadil = { ...result, trace: null };
      receipt.currentStep = 'bombadil_trace_validation';
      try { phase.bombadil.trace = await summarizeTrace(traceDirectory, fixture.origin); }
      catch (error) { throw new Error(safeFailureCode(error, 'QA_TRACE_UNAVAILABLE_OR_INVALID')); }
      if (result.exitCode !== 0 || result.failureCode || phase.bombadil.trace.violations !== 0) throw new Error('QA_BOMBADIL_FAILED');
      if (receipt.blockedRequests || receipt.blockedWebSockets || receipt.unexpectedPages || receipt.pageErrors || fixture.counts.denied) throw new Error('QA_COMPONENT_POLICY_OR_PAGE_ERROR');
      phase.status = 'passed';
    }
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    receipt.failureCode = safeFailureCode(error);
    if (receipt.phaseResults.at(-1)?.status === 'running') receipt.phaseResults.at(-1).status = 'failed';
    if (page && page.url().startsWith(`${fixture.origin}/fixture`)) {
      await page.screenshot({ path: path.join(output, `${receipt.currentPhase ?? 'desktop'}-failure.png`), timeout: 3000 })
        .catch(() => { receipt.failureScreenshotUnavailable = true; });
    }
  } finally {
    if (context) await context.close().catch(() => { receipt.cleanupFailure = true; });
    if (proxy) { receipt.blockedProxyRequests = proxy.blocked(); await proxy.close(); }
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => { receipt.cleanupFailure = true; });
    receipt.server = { ...fixture.counts };
    receipt.finishedAtUtc = new Date().toISOString();
    if (receipt.cleanupFailure) receipt.status = 'failed';
    await writeFile(path.join(output, 'qa-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  }
  if (receipt.status !== 'passed') throw new Error(receipt.failureCode ?? 'QA_CLEANUP_FAILED');
  process.stdout.write(`${JSON.stringify({ status: receipt.status, phases: receipt.phaseResults.length, receipt: path.join(output, 'qa-receipt.json') })}\n`);
}
