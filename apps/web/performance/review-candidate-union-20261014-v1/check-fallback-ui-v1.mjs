import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium, serve, pageSetup, origin, catalog } from './runtime-v3.mjs';
import { fixtureQuery } from './fixture-query-v3.mjs';
const here = new URL('./', import.meta.url);
const out = new URL('fallback-ui-v1/', here);
await mkdir(out);
const receipt = JSON.parse(await readFile(new URL('build-receipts-v1.json', here))).find(x => x.kind === 'candidate');
const approved = catalog(), deleted = approved.map((r, i) => ({ ...r, id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, approved_name: r.name + ' 중복', name: r.name + ' 중복', origin_name: r.name, status: 'deleted' }));
const rows = [...approved, ...deleted];
const candidateColumns = 'id,name:approved_name,approved_name,origin_name,naver_name,google_name,road_address,jibun_address';
const cases = [
  { label: 'union-503-mobile', viewport: { width: 390, height: 844 }, fault: '503' },
  { label: 'unknown-count-tablet', viewport: { width: 834, height: 1112 }, fault: 'missing-count' },
  { label: 'capped-response-desktop', viewport: { width: 1440, height: 900 }, fault: 'capped' },
];
const result = { startedAtUTC: new Date().toISOString(), sourceCommit: receipt.sourceCommit, buildId: receipt.buildId,
  productionBuild: true, realRemoteSDK: true, diagnosticOnly: true, physicalDevice: false, fieldAdmission: 0,
  performanceAdmission: 0, viewportInterpretation: 'CSS breakpoint coverage; context retains touch/mobile emulation at all widths',
  measuredPrimarySeriesReused: false, cases: [], screenshotsContainOnlySyntheticRestaurantAndReviewContent: true };
let server, browser, active;
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
    active = await pageSetup(browser);
    await active.page.setViewportSize(scenario.viewport);
    let injected = 0;
    await active.page.route(url => url.pathname.endsWith('/rest/v1/restaurants') && url.searchParams.has('or') &&
      url.searchParams.get('select')?.replace(/\s+/g, '') === candidateColumns, async route => {
      injected++;
      active.requests.restaurant++;
      if (scenario.fault === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic_union_unavailable"}', headers: { 'access-control-allow-origin': origin } });
      const data = fixtureQuery(rows, new URL(route.request().url()).searchParams);
      assert.ok(data.total > 1, 'FALLBACK_FIXTURE_NEEDS_MULTIPLE_CANDIDATES');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(scenario.fault === 'capped' ? data.data.slice(0, 1) : data.data),
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range',
          ...(scenario.fault === 'capped' ? { 'content-range': '0-0/' + data.total } : {}) } });
    });
    await active.page.goto(origin + '/?__qa=swipe-cache-20261009', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await active.page.locator('.cluster-marker-container').filter({ hasText: '735' }).waitFor({ state: 'visible', timeout: 45000 });
    const target = approved[1];
    const openers = await active.page.getByLabel('맛집 검색 열기', { exact: true }).all();
    let opened = false;
    for (const button of openers) if (await button.isVisible()) { await button.click(); opened = true; break; }
    assert.ok(opened, 'SEARCH_CONTROL_UNAVAILABLE_AT_BREAKPOINT');
    await active.page.getByLabel('맛집 검색어 입력', { exact: true }).fill(target.name);
    await active.page.getByRole('button', { name: new RegExp(target.name) }).first().click();
    const panel = active.page.getByTestId('restaurant-detail-panel');
    const review = panel.getByText('회귀 검증 리뷰 1', { exact: true });
    await review.waitFor({ state: 'visible', timeout: 15000 });
    await review.scrollIntoViewIfNeeded();
    assert.ok(await panel.getByText(target.name, { exact: true }).count() > 0);
    assert.equal(injected, 1);
    assert.equal(active.requests.unsupportedFixtureQueries ?? 0, 0);
    assert.equal(active.errors.page, 0);
    const marker = await active.page.evaluate(id => ({ present: !!document.querySelector('[data-testid="marker"][data-restaurant-id="' + id + '"]'), mapCreates: window.__swipeCacheUiProbe.mapCreates }), target.id);
    assert.ok(marker.present && marker.mapCreates === 1);
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
} catch {
  result.passed = false; result.failureCode = 'FALLBACK_UI_ASSERTION_FAILED'; process.exitCode = 1;
} finally {
  if (active) await active.close();
  if (browser) await browser.close();
  if (server) await server.close();
  result.completedAtUTC = new Date().toISOString();
  await writeFile(new URL('result.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, completedCases: result.cases.length }));
}
