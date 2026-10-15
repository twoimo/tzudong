// Diagnostic only. Run after the natural series has finished and released3000/3003.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, X509Certificate } from 'node:crypto';

const here = new URL('./', import.meta.url);
const experiment = new URL('../marker-category-rebind-20261015-v1/pilot-checkpoint-v1/', here);
const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9-]+$/);
const out = new URL(label + '/', here); await mkdir(out);
const bindings = JSON.parse(await readFile(new URL('protocol-inputs-v2.json', experiment)));
for (const name of ['runtime-v3.mjs', 'build-receipts-v2.json', 'fixture-query-v3.mjs']) {
  assert.equal(createHash('sha256').update(await readFile(new URL(name, experiment))).digest('hex'), bindings.files[name]);
}
const runtime = await import(new URL('runtime-v3.mjs', experiment).href);
const receipt = JSON.parse(await readFile(new URL('build-receipts-v2.json', experiment))).find(row => row.kind === 'candidate');
assert.equal(receipt.sourceCommit, bindings.sourceAfter);
assert.equal((await readFile(receipt.root + '/' + receipt.distDir + '/BUILD_ID', 'utf8')).trim(), receipt.buildId);
const result = { startedAtUtc: new Date().toISOString(), sourceCommit: receipt.sourceCommit,
  diagnosticOnly: true, rawRequestBodiesPersisted: false, rawHeadersPersisted: false,
  credentialPersisted: false, cspChanged: false, performanceAdmission: 0, fieldAdmission: 0 };
let server, browser, session;
try {
  server = await runtime.serve(receipt);
  const certificate = new X509Certificate(await readFile('/Users/twoimo/.codex/runtime-cache/naver-local-tls-marker-dom-20261014-v1/cert.pem'));
  assert.ok(Date.now() < Date.parse(certificate.validTo));
  const spki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  browser = await runtime.chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-certificate-errors-spki-list=' + spki] });
  session = await runtime.pageSetup(browser);
  await session.page.addInitScript(() => {
    const destinations = new WeakMap();
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    const rows = window.__boundedVendorTelemetry = [];
    XMLHttpRequest.prototype.open = function (...args) {
      destinations.set(this, typeof args[1] === 'string' && args[1] === 'https://kr-col-ext.nelo.navercorp.com/_store');
      return open.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (destinations.get(this) && rows.length < 16) {
        const record = { at: performance.now(), shapeAvailable: false };
        if (typeof body === 'string' && body.length <= 16384) try {
          const value = JSON.parse(body), allowed = new Set(['log', 'logLevel', 'projectName', 'projectVersion', 'ncpKeyId', 'mapTypeId']);
          Object.assign(record, { shapeAvailable: true,
            event: value.log === 'setMapTypeId' ? 'setMapTypeId' : value.log === 'Failure to load ctt meta information' ? 'cttMetadataFailure' : typeof value.log === 'string' && value.log.startsWith('Failure to load tile meta information:') ? 'tileMetadataFailure' : 'other',
            level: ['log', 'error', 'warn', 'info'].includes(value.logLevel) ? value.logLevel : 'other',
            publicClientIdPresent: typeof value.ncpKeyId === 'string' && value.ncpKeyId.length > 0,
            mapType: ['normal', 'terrain', 'satellite', 'hybrid', 'dark', 'dark_terrain'].includes(value.mapTypeId) ? value.mapTypeId : 'other',
            unknownKeyCount: Object.keys(value).filter(key => !allowed.has(key)).length,
          });
        } catch { /* Preserve only the bounded unavailable-shape result. */ }
        rows.push(record);
      }
      // Preserve the original SDK request and the original policy denial.
      return send.call(this, body);
    };
  });
  await session.page.goto(runtime.origin + '/?__qa=swipe-cache-20261009', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await session.page.locator('.cluster-marker-container').filter({ hasText: '735' }).waitFor({ state: 'visible', timeout: 45000 });
  await session.awaitSdkReceipt();
  assert.equal(session.sdkScript.sha256, '802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1');
  await session.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  result.records = await session.page.evaluate(() => window.__boundedVendorTelemetry);
  result.cspRecords = await session.page.evaluate(() => window.__boundedErrorEvents.filter(row => row.event === 'csp'));
  result.sdk = { ...session.sdkScript };
  result.browser = await browser.version();
  result.passed = result.records.length > 0 && result.records.every(row => row.shapeAvailable);
} catch (error) {
  result.passed = false;
  result.failure = 'bounded_telemetry_diagnostic_unavailable';
  result.failureType = ['AssertionError', 'TimeoutError', 'Error'].includes(error?.name) ? error.name : 'other';
} finally {
  if (session) { result.errors = { ...session.errors }; await session.close(); }
  if (browser) await browser.close();
  if (server) await server.close();
}
result.endedAtUtc = new Date().toISOString();
await writeFile(new URL('raw.json', out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
