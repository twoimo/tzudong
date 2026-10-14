import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium, serve, pageSetup, origin, catalog } from './runtime-v3.mjs';
import { fixtureQuery } from './fixture-query-v3.mjs';
const here = new URL('./', import.meta.url);
const out = new URL('fallback-ui-v4/', here);
await mkdir(out);
const receipt = JSON.parse(await readFile(new URL('build-receipts-v1.json', here))).find(x => x.kind === 'candidate');
const approved = catalog(), deleted = approved.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, approved_name: r.name + ' 중복', name: r.name + ' 중복', origin_name: r.name, status: 'deleted' }));
const rows = [...approved, ...deleted];
const candidateColumns = 'id,name:approved_name,approved_name,origin_name,naver_name,google_name,road_address,jibun_address';
const cases = [
  { label: 'capped-response-desktop', viewport: { width: 1440, height: 900 }, fault: 'capped' },
];
const result = { startedAtUTC: new Date().toISOString(), sourceCommit: receipt.sourceCommit, buildId: receipt.buildId,
  productionBuild: true, realRemoteSDK: true, diagnosticOnly: true, physicalDevice: false, fieldAdmission: 0,
  performanceAdmission: 0, viewportInterpretation: 'CSS breakpoint coverage; context retains touch/mobile emulation at all widths',
  measuredPrimarySeriesReused: false, cases: [], screenshotsContainOnlySyntheticRestaurantAndReviewContent: true };
let server, browser, active, phase = 'preflight', currentScenario, faultCount = 0;
try {
  assert.equal(process.versions.node, '24.21.0');
  assert.equal((await readFile(receipt.root + '/' + receipt.distDir + '/BUILD_ID', 'utf8')).trim(), receipt.buildId);
  const cert = new X509Certificate(await readFile('/Users/twoimo/.codex/runtime-cache/naver-local-tls-20261013-v1/cert.pem'));
  assert.ok(Date.now() < Date.parse(cert.validTo));
  const spki = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  server = await serve(receipt);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
  result.browserVersion = await browser.version();
  for (const scenario of cases) {
    currentScenario = scenario.label; phase = 'context';
    active = await pageSetup(browser);
    await active.page.setViewportSize(scenario.viewport);
    let injected = 0; faultCount = 0;
    await active.page.route(url => url.pathname.endsWith('/rest/v1/restaurants') && url.searchParams.has('or') &&
      url.searchParams.get('select')?.replace(/\s+/g, '') === candidateColumns, async route => {
      injected++; faultCount = injected;
      active.requests.restaurant++;
      if (scenario.fault === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic_union_unavailable"}', headers: { 'access-control-allow-origin': origin } });
      const data = fixtureQuery(rows, new URL(route.request().url()).searchParams);
      assert.ok(data.total > 1, 'FALLBACK_FIXTURE_NEEDS_MULTIPLE_CANDIDATES');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(scenario.fault === 'capped' ? data.data.slice(0, 1) : data.data),
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range',
          ...(scenario.fault === 'capped' ? { 'content-range': '0-0/' + data.total } : {}) } });
    });
    phase = 'navigation';
    await active.page.goto(origin + '/?__qa=swipe-cache-20261009', { waitUntil: 'domcontentloaded', timeout: 30000 });
    phase = 'initial-map';
    await active.page.locator('.cluster-marker-container').filter({ hasText: '735' }).waitFor({ state: 'visible', timeout: 45000 });
    const target = approved[1];
    phase = 'search-open';
    const openers = await active.page.getByLabel('맛집 검색 열기', { exact: true }).all();
    let opened = false;
    for (const button of openers) if (await button.isVisible()) { await button.click(); opened = true; break; }
    if (!opened) opened = await active.page.getByLabel('맛집 검색어 입력', { exact: true }).isVisible();
    assert.ok(opened, 'SEARCH_CONTROL_UNAVAILABLE_AT_BREAKPOINT');
    phase = 'search-input';
    await active.page.getByLabel('맛집 검색어 입력', { exact: true }).fill(target.name);
    phase = 'search-select';
    await active.page.getByRole('button', { name: new RegExp(target.name) }).first().click();
    const panel = active.page.getByTestId('restaurant-detail-panel');
    const review = panel.getByText('회귀 검증 리뷰 1', { exact: true });
    phase = 'deleted-review-visible';
    await review.waitFor({ state: 'visible', timeout: 15000 });
    await review.scrollIntoViewIfNeeded();
    assert.ok(await panel.getByText(target.name, { exact: true }).count() > 0, 'SELECTED_TITLE_NOT_MATCHED');
    phase = 'invariants';
    assert.equal(injected, scenario.fault === '503' ? 4 : 1, 'UNION_FAULT_COUNT_MISMATCH');
    assert.equal(active.requests.unsupportedFixtureQueries ?? 0, 0);
    assert.equal(active.errors.page, 0);
    const marker = await active.page.evaluate(id => ({ present: !!document.querySelector('[data-testid="marker"][data-restaurant-id="' + id + '"]'), mapCreates: window.__swipeCacheUiProbe.mapCreates }), target.id);
    assert.ok(marker.present && marker.mapCreates === 1);
    phase = 'sdk-receipt';
    await active.awaitSdkReceipt();
    assert.equal(active.sdkScript.sha256, '802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1');
    const file = scenario.label + '.png';
    await active.page.screenshot({ path: new URL(file, out).pathname });
    result.cases.push({ label: scenario.label, viewport: scenario.viewport, unionFaults: injected,
      deletedAliasReviewVisible: true, selectedRestaurantPreserved: true, ...marker,
      requests: { ...active.requests }, errors: { ...active.errors }, screenshot: file, passed: true });
    await active.close(); active = null;
  }
  result.passed = true;
} catch (error) {
  const allowed = ['FALLBACK_FIXTURE_NEEDS_MULTIPLE_CANDIDATES', 'SEARCH_CONTROL_UNAVAILABLE_AT_BREAKPOINT', 'SELECTED_TITLE_NOT_MATCHED', 'UNION_FAULT_COUNT_MISMATCH'];
  const assertionCode = allowed.find(code => String(error?.message).startsWith(code)) ?? null;
  result.failedCase = { label: currentScenario ?? null, phase, faultCount, assertionCode,
    timeout: error?.constructor?.name === 'TimeoutError', assertion: error?.code === 'ERR_ASSERTION' };
  if (active) {
    result.failedCase.requests = { ...active.requests }; result.failedCase.errors = { ...active.errors };
    result.failedCase.diagnostics = await active.page.evaluate(() => ({
      loadedSDK: !!window.naver?.maps?.Map, mapCreates: window.__swipeCacheUiProbe?.mapCreates ?? 0,
      panelCount: document.querySelectorAll('[data-testid="restaurant-detail-panel"]').length,
      markerCount: document.querySelectorAll('[data-testid="marker"]').length,
      syntheticReviewPresent: document.body.textContent.includes('회귀 검증 리뷰 1') }));
    await active.page.screenshot({ path: new URL('failure.png', out).pathname });
  }
  result.passed = false; result.failureCode = 'FALLBACK_UI_ASSERTION_FAILED'; process.exitCode = 1;
} finally {
  if (active) await active.close();
  if (browser) await browser.close();
  if (server) await server.close();
  result.completedAtUTC = new Date().toISOString();
  await writeFile(new URL('result.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, completedCases: result.cases.length }));
}
