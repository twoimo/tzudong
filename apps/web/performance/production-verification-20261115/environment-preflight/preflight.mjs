import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPinnedPlaywright } from '../../../../../.github/scripts/ensure-ci-chromium.mjs';
import { FAILURE_CODES, MAX_RECEIPT_BYTES, PINS, PROFILES, RECEIPT_VERSION, SERIALIZATION_FAILURES, THROTTLING,
  allowedFixtureRequest, assertReceiptPrivacy, minimalFailureReceipt, numeric, parseArguments, parseStrictJson,
  profileProblems, projectTrace, receiptProblems, sha256, sha256Bytes, sourceDigestProblems, verifyReceiptBytes } from './evidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const OLD_TOOLS = resolve(HERE, '../../initial-load-20261114/tools');
const HTML = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Local capability fixture</title><style>body{margin:16px;font:18px sans-serif;background:#fff;color:#111}'
  + 'img{display:block;width:300px;height:220px}button{margin-top:16px;padding:12px}</style></head>'
  + '<body><h1>Local paint fixture</h1><img src="/hero.svg" width="300" height="220" alt="Geometric fixture">'
  + '<button type="button">Fixture control</button></body></html>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220"><rect width="300" height="220" fill="#215f89"/>'
  + '<circle cx="150" cy="110" r="70" fill="#efb44c"/></svg>';
const FAIL = code => Object.assign(new Error(code), { safeCode: code });
const errorCode = error => FAILURE_CODES.includes(error?.safeCode) ? error.safeCode : 'LOCAL_PREFLIGHT_FAILED';
const bounded = async (promise, ms, code, onTimeout = () => {}) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(FAIL(code)); }, ms); })]); }
  finally { clearTimeout(timer); }
};

// A deadline is not cancellation by itself. Each asynchronous boundary checks
// this gate, and a resource acquired late is disposed before it can be used.
export function createWorkGate() {
  let expired = false; let cleanupFailed = false;
  const check = () => { if (expired) throw FAIL('LOCAL_PROFILE_STOPPED'); };
  return {
    expire: () => { expired = true; },
    cleanupUnconfirmed: () => cleanupFailed,
    async step(action) { check(); const result = await action(); check(); return result; },
    async acquire(action, dispose) {
      check(); const result = await action();
      if (expired) {
        try { await dispose(result); } catch { cleanupFailed = true; throw FAIL('PROFILE_CLEANUP_UNCONFIRMED'); }
        throw FAIL('LOCAL_PROFILE_STOPPED');
      }
      return result;
    },
  };
}

export function serializeReceipt(receipt) {
  try {
    assertReceiptPrivacy(receipt);
    const bytes = Buffer.from(JSON.stringify(receipt) + '\n');
    if (bytes.length > MAX_RECEIPT_BYTES) throw FAIL('RECEIPT_SIZE_LIMIT');
    return bytes;
  } catch (error) {
    const code = SERIALIZATION_FAILURES.includes(error?.safeCode) ? error.safeCode
      : error?.code === 'PRIVACY_UNSAFE_VALUE' ? 'PRIVACY_VALIDATION_FAILED' : 'RECEIPT_SERIALIZATION_FAILED';
    // A separate fixed envelope cannot repeat rejection of original metadata.
    // It explicitly loses source verification and all rejected projections.
    const fallback = minimalFailureReceipt(receipt, code);
    assertReceiptPrivacy(fallback);
    const bytes = Buffer.from(JSON.stringify(fallback) + '\n');
    if (bytes.length > MAX_RECEIPT_BYTES) throw FAIL('RECEIPT_SIZE_LIMIT');
    return bytes;
  }
}

// The caller exclusively reserves the file before runtime work. Tests can use
// this identical write path with pure synthetic receipts and temporary files.
export async function writeReceipt(handle, receipt) {
  const bytes = serializeReceipt(receipt); const saved = parseStrictJson(bytes);
  await handle.writeFile(bytes); await handle.sync();
  return { status: saved.status, scope: saved.scope, sha256: sha256(bytes),
    profilesRetained: saved.profiles.length, failureCodes: saved.failureCodes };
}

// Serialized by Playwright. Numeric/enumerated state only; no page text/URLs.
function installObservation() {
  const state = { samplingIntervalMs: 100, samples: [], paints: [], lcp: [], frames: [], capReached: false,
    observerErrors: 0, paintObserver: false, lcpObserver: false, stopped: false };
  const observers = []; let timer; let frameId = null;
  const add = (array, value, cap) => { if (array.length < cap) array.push(value); else state.capReached = true; };
  const receive = (kind, entries) => {
    for (const entry of entries) {
      if (!Number.isFinite(entry.startTime)) { state.observerErrors++; continue; }
      if (kind === 'paint') {
        if (['first-paint', 'first-contentful-paint'].includes(entry.name)) add(state.paints,
          { name: entry.name, startTimeMs: entry.startTime, receivedAtMs: performance.now() }, 16);
      } else add(state.lcp, { startTimeMs: entry.startTime, receivedAtMs: performance.now() }, 24);
    }
  };
  for (const kind of ['paint', 'largest-contentful-paint']) {
    try {
      const observer = new PerformanceObserver(list => { try { receive(kind, list.getEntries()); } catch { state.observerErrors++; } });
      observer.observe({ type: kind, buffered: true }); observers.push({ observer, kind });
      state[kind === 'paint' ? 'paintObserver' : 'lcpObserver'] = true;
    } catch { state.observerErrors++; }
  }
  const sample = () => {
    if (state.stopped) return;
    const now = performance.now();
    add(state.samples, { atMs: now, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      visible: document.visibilityState === 'visible', focused: document.hasFocus() }, 600);
    if (frameId === null && state.frames.length < 80) {
      const requestedAtMs = performance.now();
      frameId = requestAnimationFrame(frameTimestampMs => {
        frameId = null; add(state.frames, { requestedAtMs, callbackAtMs: performance.now(), frameTimestampMs }, 80);
      });
    }
    if (now < 55000) timer = setTimeout(sample, 100);
  };
  // Anchor before application scripts/first paint, not a deferred first poll.
  sample();
  window.__localEnvironmentPreflight = () => {
    state.stopped = true; clearTimeout(timer); if (frameId !== null) cancelAnimationFrame(frameId);
    for (const { observer, kind } of observers) {
      try { receive(kind, observer.takeRecords()); } catch { state.observerErrors++; }
      observer.disconnect();
    }
    const entry = performance.getEntriesByType('navigation')[0];
    const navigation = { type: entry?.type === 'navigate' ? 'navigate' : 'other' };
    for (const name of ['startTime', 'requestStart', 'responseStart', 'responseEnd', 'redirectCount']) {
      navigation[name] = Number.isFinite(entry?.[name]) ? entry[name] : null;
    }
    const paintTimeline = performance.getEntriesByType('paint').filter(value =>
      ['first-paint', 'first-contentful-paint'].includes(value.name)).slice(0, 8)
      .map(value => ({ name: value.name, startTimeMs: value.startTime }));
    return { ...state, navigation, paintTimeline };
  };
}

async function loadTools() {
  if (Number(process.versions.node.split('.')[0]) !== PINS.nodeMajor) throw FAIL('NODE_PIN_MISMATCH');
  let pinned;
  try { pinned = loadPinnedPlaywright(REPO); } catch { throw FAIL('PLAYWRIGHT_PIN_UNAVAILABLE'); }
  if (pinned.browserVersion !== PINS.chrome) throw FAIL('CHROME_CONTRACT_MISMATCH');
  const playwrightVersion = JSON.parse(await readFile(pinned.requireWeb.resolve('playwright/package.json'), 'utf8')).version;
  if (playwrightVersion !== PINS.playwright) throw FAIL('PLAYWRIGHT_VERSION_MISMATCH');
  const playwright = pinned.requireWeb('playwright'); const executable = playwright.chromium.executablePath();
  try {
    if (!(await lstat(executable)).isFile() || await realpath(executable) !== executable) throw FAIL('CHROME_EXECUTABLE_UNVERIFIED');
  } catch { throw FAIL('CHROME_EXECUTABLE_UNAVAILABLE'); }
  const requireTools = createRequire(resolve(OLD_TOOLS, 'package.json'));
  const toolLock = JSON.parse(await readFile(resolve(OLD_TOOLS, 'package-lock.json'), 'utf8'));
  const installed = {};
  for (const name of ['lighthouse', 'puppeteer-core']) {
    const path = requireTools.resolve(`${name}/package.json`);
    if (await realpath(path) !== await realpath(resolve(OLD_TOOLS, 'node_modules', name, 'package.json'))) throw FAIL('TOOL_PATH_UNVERIFIED');
    installed[name] = JSON.parse(await readFile(path, 'utf8')).version;
    if (installed[name] !== toolLock.packages?.[`node_modules/${name}`]?.version) throw FAIL('TOOL_LOCK_MISMATCH');
  }
  if (installed.lighthouse !== PINS.lighthouse) throw FAIL('LIGHTHOUSE_PIN_MISMATCH');
  // Only explicit local mode reaches the executable; help/verify/tests do not.
  let product;
  try { product = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw FAIL('CHROME_PRODUCT_UNAVAILABLE'); }
  if (product !== `Google Chrome for Testing ${PINS.chrome}`) throw FAIL('CHROME_PRODUCT_MISMATCH');
  return { playwright, executable, lighthouse: (await import(pathToFileURL(requireTools.resolve('lighthouse')).href)).default,
    puppeteer: (await import(pathToFileURL(requireTools.resolve('puppeteer-core')).href)).default,
    sharp: pinned.requireWeb('sharp'),
    toolchain: { nodeMajor: PINS.nodeMajor, nodeVersion: process.versions.node, chrome: PINS.chrome, playwright: playwrightVersion,
      lighthouse: installed.lighthouse, puppeteerVersion: installed['puppeteer-core'], puppeteerLockMatched: true } };
}

export async function readSourceDigests() {
  const digests = {};
  for (const [key, path] of Object.entries({ preflight: resolve(HERE, 'preflight.mjs'), evidence: resolve(HERE, 'evidence.mjs'),
    browserContract: resolve(REPO, '.github/chrome-for-testing.v1.json'), appLock: resolve(REPO, 'apps/web/package-lock.json'),
    lighthouseLock: resolve(OLD_TOOLS, 'package-lock.json') })) digests[key] = sha256Bytes(await readFile(path));
  digests.fixture = sha256Bytes(Buffer.from(HTML + '\n' + SVG));
  return digests;
}

async function ownedFixture() {
  const server = createServer((request, response) => {
    const port = server.address()?.port; const origin = `http://127.0.0.1:${port}`;
    if (request.headers.host !== `127.0.0.1:${port}` || !allowedFixtureRequest(origin + request.url, request.method, origin)) {
      response.writeHead(403); response.end(); return;
    }
    const svg = request.url === '/hero.svg'; const favicon = request.url === '/favicon.ico';
    response.writeHead(favicon ? 204 : 200, { 'content-type': svg ? 'image/svg+xml' : 'text/html; charset=utf-8',
      'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; connect-src 'none'" });
    response.end(request.method === 'HEAD' || favicon ? undefined : svg ? SVG : HTML);
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function localProfile(tools, fixture, profile) {
  const row = { id: profile.id, status: 'failed', failureCodes: [], freshOwnedProfile: false, profileCleaned: false,
    launch: null, controls: null, requests: { blockedHttp: 0, blockedWebSocket: 0, failed: 0,
      documentStatus: null, documentCount: 0, heroCount: 0, cachedResponseCount: 0 },
    observation: null, lighthouse: null, trace: null, screenshot: null };
  const profileDir = await mkdtemp(resolve(tmpdir(), 'tzudong-local-preflight-'));
  row.freshOwnedProfile = true;
  let context; let puppet; let closed = false; let work;
  const gate = createWorkGate(); const step = gate.step;
  const closeContext = value => bounded(value.close(), 5000, 'BROWSER_CLOSE_TIMEOUT');
  const disconnect = value => bounded(Promise.resolve().then(() => value.disconnect()), 3000, 'CDP_DISCONNECT_TIMEOUT');
  try {
    work = (async () => {
      context = await gate.acquire(() => tools.playwright.chromium.launchPersistentContext(profileDir, {
        executablePath: tools.executable, headless: true, chromiumSandbox: true,
        args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
        viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
        isMobile: false, hasTouch: false, serviceWorkers: 'block', timeout: 15000,
        env: Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']
          .filter(key => process.env[key]).map(key => [key, process.env[key]])),
      }), closeContext);
      await step(() => context.route('**/*', async route => {
        const request = route.request();
        if (allowedFixtureRequest(request.url(), request.method(), fixture.origin)) await route.continue();
        else { row.requests.blockedHttp++; await route.abort('blockedbyclient'); }
      }));
      await step(() => context.routeWebSocket('**/*', socket => { row.requests.blockedWebSocket++; socket.close(); }));
      await step(() => context.addInitScript(installObservation));
      const pages = context.pages(); if (pages.length !== 1) throw FAIL('BROWSER_TARGET_AMBIGUOUS');
      const page = pages[0]; await step(() => page.bringToFront());
      const cdp = await step(() => context.newCDPSession(page));
      const args = (await step(() => cdp.send('Browser.getBrowserCommandLine'))).arguments;
      if (!Array.isArray(args)) throw FAIL('BROWSER_ARGUMENTS_UNAVAILABLE');
      const version = await step(() => cdp.send('Browser.getVersion'));
      const disabling = args.some(value => ['--no-sandbox', '--disable-setuid-sandbox'].includes(value));
      row.launch = { chromiumSandboxRequested: true, disableSandboxFlagObserved: disabling,
        automationFlagObserved: args.includes('--enable-automation'),
        versionVerified: [`Chrome/${PINS.chrome}`, `HeadlessChrome/${PINS.chrome}`].includes(version.product),
        mobileLayoutRequested: false, hasTouch: false };
      if (disabling || !row.launch.automationFlagObserved || !row.launch.versionVerified) throw FAIL('BROWSER_POLICY_UNVERIFIED');
      const control = row.controls = { cpuSlowdownRequested: THROTTLING.cpuSlowdownMultiplier,
        latencyMsRequested: THROTTLING.requestLatencyMs,
        downloadBytesPerSecondRequested: Math.floor(THROTTLING.downloadThroughputKbps * 1024 / 8),
        uploadBytesPerSecondRequested: Math.floor(THROTTLING.uploadThroughputKbps * 1024 / 8),
        cpuAcknowledged: false, networkAcknowledged: false, cacheDisabledAcknowledged: false, serviceWorkerBypassAcknowledged: false };
      await step(() => cdp.send('Network.enable'));
      await step(() => cdp.send('Emulation.setCPUThrottlingRate', { rate: control.cpuSlowdownRequested })); control.cpuAcknowledged = true;
      await step(() => cdp.send('Network.emulateNetworkConditions', { offline: false, latency: control.latencyMsRequested,
        downloadThroughput: control.downloadBytesPerSecondRequested, uploadThroughput: control.uploadBytesPerSecondRequested }));
      control.networkAcknowledged = true;
      await step(() => cdp.send('Network.setCacheDisabled', { cacheDisabled: true })); control.cacheDisabledAcknowledged = true;
      await step(() => cdp.send('Network.setBypassServiceWorker', { bypass: true })); control.serviceWorkerBypassAcknowledged = true;
      cdp.on('Network.responseReceived', event => {
        if (event.response?.fromDiskCache || event.response?.fromServiceWorker || event.response?.fromPrefetchCache) row.requests.cachedResponseCount++;
      });
      page.on('requestfailed', () => row.requests.failed++);
      page.on('response', response => {
        if (response.url() === fixture.origin + '/fixture') { row.requests.documentCount++; row.requests.documentStatus = response.status(); }
        if (response.url() === fixture.origin + '/hero.svg') row.requests.heroCount++;
      });
      const endpointFile = await step(() => readFile(resolve(profileDir, 'DevToolsActivePort'), 'utf8'));
      const endpoint = endpointFile.trim().split('\n');
      if (endpointFile.length > 1024 || endpoint.length !== 2 || !/^\d{1,5}$/.test(endpoint[0])
        || Number(endpoint[0]) < 1 || Number(endpoint[0]) > 65535 || !/^\/devtools\/browser\/[a-f0-9-]{36}$/.test(endpoint[1])) {
        throw FAIL('OWNED_DEBUG_ENDPOINT_UNAVAILABLE');
      }
      puppet = await gate.acquire(() => tools.puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`,
        defaultViewport: null, protocolTimeout: 15000 }), disconnect);
      const targets = await step(() => puppet.pages()); if (targets.length !== 1 || targets[0].url() !== page.url()) throw FAIL('BROWSER_TARGET_AMBIGUOUS');
      const auditPage = targets[0];
      const settings = { onlyCategories: ['performance'], skipAudits: ['bf-cache'], disableFullPageScreenshot: true,
        disableStorageReset: false, maxWaitForLoad: 20000, maxWaitForFcp: 15000,
        formFactor: 'desktop', throttlingMethod: 'devtools', throttling: { ...THROTTLING },
        screenEmulation: { mobile: false, width: profile.width, height: profile.height, deviceScaleFactor: profile.dpr, disabled: false },
        emulatedUserAgent: false, locale: 'en-US' };
      const result = await step(() => tools.lighthouse(fixture.origin + '/fixture', { logLevel: 'silent' }, { extends: 'lighthouse:default', settings }, auditPage));
      if (!result?.lhr) throw FAIL('LIGHTHOUSE_RESULT_UNAVAILABLE');
      row.observation = await step(() => page.evaluate(() => window.__localEnvironmentPreflight?.() ?? null));
      const lhr = result.lhr; const summary = lhr.audits?.metrics?.details?.items?.[0] ?? {};
      const actual = lhr.configSettings ?? {}; const emulation = actual.screenEmulation ?? {};
      const metrics = {};
      for (const [to, from] of Object.entries({ originTs: 'observedTimeOriginTs', navigationTs: 'observedNavigationStartTs',
        fpMs: 'observedFirstPaint', fpTs: 'observedFirstPaintTs', fcpMs: 'observedFirstContentfulPaint', fcpTs: 'observedFirstContentfulPaintTs',
        lcpMs: 'observedLargestContentfulPaint', lcpTs: 'observedLargestContentfulPaintTs', endMs: 'observedTraceEnd', endTs: 'observedTraceEndTs' })) {
        metrics[to] = numeric(summary[from]);
      }
      row.lighthouse = { version: lhr.lighthouseVersion === PINS.lighthouse ? PINS.lighthouse : 'mismatch',
        runtimeError: Boolean(lhr.runtimeError), fixtureUrlMatched: lhr.requestedUrl === fixture.origin + '/fixture'
          && (lhr.finalDisplayedUrl ?? lhr.finalUrl) === fixture.origin + '/fixture',
        settings: { formFactor: actual.formFactor === 'desktop' ? 'desktop' : 'other',
          mobileLayoutReported: typeof emulation.mobile === 'boolean' ? emulation.mobile : null,
          throttlingMethod: actual.throttlingMethod === 'devtools' ? 'devtools' : 'other',
          emulatedUserAgent: actual.emulatedUserAgent === false ? false : true,
          disableStorageReset: typeof actual.disableStorageReset === 'boolean' ? actual.disableStorageReset : null,
          viewport: { width: numeric(emulation.width), height: numeric(emulation.height), dpr: numeric(emulation.deviceScaleFactor) },
          throttling: Object.fromEntries(Object.keys(THROTTLING).map(key => [key, numeric(actual.throttling?.[key])])) },
        metrics, fcpAuditMs: numeric(lhr.audits?.['first-contentful-paint']?.numericValue),
        lcpAuditMs: numeric(lhr.audits?.['largest-contentful-paint']?.numericValue) };
      row.trace = projectTrace(result.artifacts?.Trace, metrics);
      const screenshot = lhr.audits?.['final-screenshot']?.details;
      const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(screenshot?.data ?? '');
      if (!match || match[1].length > 349528) throw FAIL('TIMED_SCREENSHOT_UNAVAILABLE');
      const image = Buffer.from(match[1], 'base64'); const metadata = await step(() => tools.sharp(image).metadata());
      row.screenshot = { source: 'lighthouse-final-screenshot', bytes: image.length, sha256Bytes: sha256Bytes(image),
        timingMs: numeric(screenshot.timing), width: numeric(metadata.width), height: numeric(metadata.height) };
    })();
    await bounded(work, 55000, 'LOCAL_PROFILE_TIMEOUT', gate.expire);
  } catch (error) { gate.expire(); row.failureCodes.push(errorCode(error)); }
  finally {
    gate.expire();
    if (puppet) { try { await disconnect(puppet); } catch { row.failureCodes.push('CDP_DISCONNECT_FAILED'); } }
    if (context) {
      try { await closeContext(context); closed = true; }
      catch { row.failureCodes.push('BROWSER_CLOSE_FAILED'); }
    } else closed = true;
    if (work) { try { await bounded(work.catch(() => {}), 5000, 'PROFILE_WORK_DRAIN_TIMEOUT'); }
      catch { row.failureCodes.push('PROFILE_WORK_DRAIN_FAILED'); closed = false; } }
    if (gate.cleanupUnconfirmed()) { row.failureCodes.push('PROFILE_CLEANUP_UNCONFIRMED'); closed = false; }
    // Never remove another profile or an owned profile while its browser may live.
    if (closed) { try { await rm(profileDir, { recursive: true, force: true }); row.profileCleaned = true; }
      catch { row.failureCodes.push('OWNED_PROFILE_CLEANUP_FAILED'); } }
  }
  if (!row.failureCodes.length) {
    row.status = 'passed'; row.failureCodes.push(...profileProblems(row));
    if (row.failureCodes.length) row.status = 'failed';
  }
  return row;
}

async function runLocal(output) {
  // Reserve before starting a browser. Existing evidence can never be overwritten.
  const handle = await open(resolve(output), 'wx', 0o600);
  const receipt = { schemaVersion: RECEIPT_VERSION, scope: 'synthetic-loopback-capability-only',
    layoutSemantics: 'desktop-css-viewport-resize-no-mobile-device-emulation',
    createdAtUtc: new Date().toISOString(), status: 'blocked-or-incomplete',
    production: { access: 'not-tested', source: 'not-tested', deployment: 'not-tested' },
    admissions: { productionPerformance: 0, field: 0, g003: 0 }, improvementBudgets: { absolute: null, relative: null, noise: null },
    toolchain: null, sourceDigests: null, profiles: [], failureCodes: [] };
  let fixture; let savedStatus = 'blocked-or-incomplete';
  try {
    receipt.sourceDigests = await readSourceDigests();
    const tools = await loadTools(); receipt.toolchain = tools.toolchain;
    fixture = await ownedFixture();
    for (const profile of PROFILES) {
      const row = await localProfile(tools, fixture, profile); receipt.profiles.push(row);
      // A blocked capability is retained and ends this preflight; no retry.
      if (row.status !== 'passed') { receipt.failureCodes.push('LOCAL_PROFILE_FAILED'); break; }
    }
    if (!receipt.failureCodes.length) {
      receipt.status = 'local-capabilities-observed';
      if (receiptProblems(receipt).length) { receipt.status = 'blocked-or-incomplete'; receipt.failureCodes.push('RECEIPT_VALIDATION_FAILED'); }
    }
  } catch (error) { receipt.failureCodes.push(errorCode(error)); }
  finally {
    if (fixture) {
      fixture.server.closeAllConnections();
      await bounded(new Promise(resolveClose => fixture.server.close(resolveClose)), 3000, 'FIXTURE_CLOSE_TIMEOUT')
        .catch(() => { receipt.failureCodes.push('FIXTURE_CLOSE_FAILED'); receipt.status = 'blocked-or-incomplete'; });
    }
    try {
      const summary = await writeReceipt(handle, receipt); savedStatus = summary.status;
      process.stdout.write(JSON.stringify(summary) + '\n');
    } finally { await handle.close(); }
  }
  return savedStatus === 'local-capabilities-observed' ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.mode === 'help') {
    process.stdout.write('Local-only capability preflight; no production URL or installer.\n'
      + '  node preflight.mjs --run-local --output NEW_RECEIPT.json\n'
      + '  node preflight.mjs --verify RECEIPT.json --sha256 DETACHED_SHA256\n'
      + 'Run-local requires a permitted provisioned browser environment. Help/verify do not launch a browser.\n');
    return 0;
  }
  if (args.mode === 'verify') {
    const metadata = await lstat(args.file);
    if (!metadata.isFile() || metadata.size > MAX_RECEIPT_BYTES) throw FAIL('RECEIPT_SIZE_LIMIT');
    const bytes = await readFile(args.file);
    const result = verifyReceiptBytes(bytes, args.expectedHash);
    if (result.verified) {
      const recorded = parseStrictJson(bytes).sourceDigests; const actual = await readSourceDigests();
      const failures = sourceDigestProblems(recorded, actual);
      if (failures.length) { result.verified = false; result.failures.push(...failures); }
    }
    process.stdout.write(JSON.stringify(result) + '\n'); return result.verified ? 0 : 1;
  }
  return runLocal(args.output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stdout.write(JSON.stringify({ status: 'blocked-or-incomplete', failureCodes: [errorCode(error)] }) + '\n');
    process.exitCode = 1;
  });
}
