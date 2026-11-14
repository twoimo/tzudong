import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPinnedPlaywright } from '../../../../.github/scripts/ensure-ci-chromium.mjs';
import { safeUrl, sanitizeLhr, sanitizeNetwork, sanitizeTrace } from './collector.mjs';

// Separate frontend fixture experiment. Never reads production health, uses a
// production identity receipt, or presents loopback timings as hosted timings.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const ORIGIN = 'http://localhost:8080';
const URL_TO_AUDIT = ORIGIN + '/?__qa=render-flow';
const FIXTURE_ORIGIN = 'https://dependency-proof.supabase.co';
const PINS = { lighthouse: '13.5.0', playwright: '1.64.1', chrome: '156.0.8078.4' };
const FIXTURE_SOURCES = ['apps/web/tests/mobile-home-map-helpers.ts',
  'apps/web/tests/nightly/local-profile-read-rpc-boundary.ts'];
const EXPLICIT_ARGS = ['--no-sandbox', '--lang=ko-KR'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { auditCode: code });
const code = error => /^[A-Z][A-Z0-9_]{2,95}$/.test(error?.auditCode ?? '') ? error.auditCode : 'FIXTURE_COLLECTION_FAILED';
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
const save = async (path, value) => {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 48 * 1024 * 1024) throw fail('FIXTURE_ARTIFACT_SIZE_LIMIT');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return Buffer.byteLength(bytes);
};
const childEnv = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));

async function assetManifest(root, phase, expectedSha) {
  const sourceSha = git(root, ['rev-parse', 'HEAD']);
  const sourceTreeSha = git(root, ['rev-parse', 'HEAD^{tree}']);
  if (sourceSha !== expectedSha || !/^[a-f0-9]{40}$/.test(sourceTreeSha)
    || git(root, ['diff', '--name-only', 'HEAD']).length) throw fail('FROZEN_SOURCE_MISMATCH');
  const app = resolve(root, 'apps/web');
  const files = [];
  const visit = async folder => {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        files.push({ path: relative(app, path), sha256: sha(bytes), sizeBytes: bytes.length });
      } else throw fail('BUILD_ASSET_SYMLINK_REJECTED');
      if (files.length > 30000) throw fail('BUILD_ASSET_LIMIT');
    }
  };
  await visit(resolve(app, '.next/static'));
  await visit(resolve(app, '.next/server'));
  for (const name of ['BUILD_ID', 'build-manifest.json', 'routes-manifest.json', 'prerender-manifest.json', 'standalone/apps/web/server.js']) {
    const bytes = await readFile(resolve(app, '.next', name));
    files.push({ path: '.next/' + name, sha256: sha(bytes), sizeBytes: bytes.length });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { schemaVersion: 'frontend-fixture-build.v1', phase, sourceSha, sourceTreeSha,
    mode: 'production', completedAt: new Date().toISOString(), sourceTreeClean: true,
    appLockSha256: sha(await readFile(resolve(app, 'package-lock.json'))),
    buildFingerprintSha256: sha(JSON.stringify(files)), files,
    staticAssetBytes: files.filter(item => item.path.startsWith('.next/static/')).reduce((sum, item) => sum + item.sizeBytes, 0) };
}

function installObservation() {
  const visible = element => {
    if (!element) return false;
    const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0
      && box.top < innerHeight && box.left < innerWidth && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const state = { timings: { controlsReadyMs: null, desktopPanelReadyMs: null, mockMapReadyMs: null },
    samplingIntervalMs: 100, samples: [], lcp: null, longTasks: [], stopped: false };
  const inspect = () => {
    const data = document.documentElement?.dataset ?? {};
    const panel = document.querySelector('[data-desktop-left-panel-map-home="true"]');
    const desktopPanelPresent = visible(panel);
    const desktopPanelAlertCount = panel?.querySelectorAll('[role="alert"]').length ?? 0;
    const desktopPopularItemCount = panel?.querySelectorAll('button[aria-label$=" 인기 맛집 상세 보기"]').length ?? 0;
    const desktopLatestItemCount = panel?.querySelectorAll('[data-desktop-left-panel-latest-restaurants="true"] [role="button"]').length ?? 0;
    const desktopLatestSectionPresent = Boolean(panel?.querySelector('[data-desktop-left-panel-latest-restaurants="true"]'));
    const desktopLatestSkeletonPresent = Boolean(panel?.querySelector('[data-desktop-left-panel-latest-skeleton="true"]'));
    const desktopMenuReady = visible(document.querySelector('button[data-desktop-map-menu-trigger="true"][aria-haspopup="menu"][aria-expanded]'));
    const desktopSearchReady = visible(document.querySelector('input[name="desktop-left-panel-restaurant-search"]'));
    const markerCount = [...document.querySelectorAll('[data-testid="marker"], button.cluster-marker-container')].filter(visible).length;
    const mockOverlayVisible = visible(document.querySelector('[data-testid="mock-naver-overlay"]'));
    const skeleton = document.querySelector('[data-home-static-skeleton]');
    return { homeChromeReady: data.homeChromeReady === 'true', homeMobileChromeReady: data.homeMobileChromeReady === 'true',
      homePanelReady: data.homePanelReady === 'true', desktopMenuReady, desktopSearchReady, desktopPanelPresent,
      desktopPanelAlertCount, desktopPopularItemCount, desktopLatestItemCount, desktopLatestSectionPresent, desktopLatestSkeletonPresent,
      controlsQualified: innerWidth >= 1280 ? data.homeChromeReady === 'true' && desktopMenuReady && desktopSearchReady
        : data.homeMobileChromeReady === 'true',
      desktopPanelQualified: data.homePanelReady === 'true' && desktopPanelPresent && desktopPanelAlertCount === 0
        && desktopPopularItemCount === 3 && desktopLatestSectionPresent && !desktopLatestSkeletonPresent,
      mockOverlayVisible, markerCount, mockMapQualified: mockOverlayVisible && markerCount > 0,
      initialSkeletonVisible: visible(skeleton), naverSdkPresent: typeof window.naver?.maps?.Map === 'function' };
  };
  window.__fixtureAudit = state; window.__fixtureAuditInspect = inspect;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) state.lcp = { startTime: entry.startTime, renderTime: entry.renderTime,
      loadTime: entry.loadTime, size: entry.size, tagName: entry.element?.tagName ?? null, url: entry.url || null };
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) if (state.longTasks.length < 5000) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  }).observe({ type: 'longtask', buffered: true });
  const sample = () => {
    if (state.stopped) return;
    const readiness = inspect(); const now = performance.now();
    if (state.samples.length < 1000) state.samples.push({ atMs: now,
      actualViewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio }, readiness });
    if (state.timings.controlsReadyMs === null && readiness.controlsQualified) state.timings.controlsReadyMs = now;
    if (state.timings.desktopPanelReadyMs === null && readiness.desktopPanelQualified) state.timings.desktopPanelReadyMs = now;
    if (state.timings.mockMapReadyMs === null && readiness.mockMapQualified) state.timings.mockMapReadyMs = now;
    if (now < 90000) setTimeout(sample, 100);
  };
  setTimeout(sample, 0);
}

function observation() {
  const nav = performance.getEntriesByType('navigation')[0];
  const navigation = { type: nav?.type ?? null };
  for (const name of ['startTime', 'duration', 'fetchStart', 'domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd',
    'secureConnectionStart', 'requestStart', 'responseStart', 'finalResponseHeadersStart', 'responseEnd', 'domInteractive',
    'domContentLoadedEventStart', 'loadEventStart', 'transferSize', 'encodedBodySize', 'decodedBodySize', 'responseStatus', 'redirectCount']) {
    navigation[name] = typeof nav?.[name] === 'number' ? nav[name] : null;
  }
  const state = window.__fixtureAudit; if (state) state.stopped = true;
  return { postCleanupViewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
    initialDocumentQaExcluded: new URLSearchParams(location.search).has('__qa'), navigation,
    postCleanupReadiness: window.__fixtureAuditInspect?.() ?? null, timings: state?.timings ?? {}, samplingIntervalMs: state?.samplingIntervalMs ?? null,
    readinessTimeline: state?.samples ?? [], readinessSamples: state?.samples.length ?? 0,
    lcpElement: state?.lcp ?? null, longTasks: state?.longTasks ?? [],
    postCleanupHorizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth), postCleanupObservedAtMs: performance.now() };
}

async function loadTools() {
  if (process.versions.node.split('.')[0] !== '24' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw fail('FIXTURE_RUNNER_UNSUPPORTED');
  const requireTools = createRequire(resolve(HERE, 'tools/package.json'));
  const lock = JSON.parse(await readFile(resolve(HERE, 'tools/package-lock.json'), 'utf8'));
  const pinned = loadPinnedPlaywright(REPO);
  const playwright = pinned.requireWeb('playwright');
  const playwrightVersion = JSON.parse(await readFile(pinned.requireWeb.resolve('playwright/package.json'), 'utf8')).version;
  if (pinned.browserVersion !== PINS.chrome || playwrightVersion !== PINS.playwright) throw fail('FIXTURE_BROWSER_PIN_MISMATCH');
  const executable = playwright.chromium.executablePath();
  if (execFileSync(executable, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
    !== 'Google Chrome for Testing ' + PINS.chrome) throw fail('FIXTURE_BROWSER_IDENTITY_MISMATCH');
  const version = JSON.parse(await readFile(requireTools.resolve('lighthouse/package.json'), 'utf8')).version;
  if (version !== PINS.lighthouse || lock.packages['node_modules/lighthouse'].version !== version) throw fail('FIXTURE_LIGHTHOUSE_PIN_MISMATCH');
  return { executable, playwright, sharp: pinned.requireWeb('sharp'),
    lighthouse: (await import(pathToFileURL(requireTools.resolve('lighthouse')).href)).default,
    puppeteer: (await import(pathToFileURL(requireTools.resolve('puppeteer-core')).href)).default };
}

async function stopOwned(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(resolveExit => child.once('exit', resolveExit));
  child.kill('SIGTERM'); let timer;
  await Promise.race([done, new Promise(resolveWait => { timer = setTimeout(resolveWait, 5000); })]);
  clearTimeout(timer);
  if (child.exitCode === null) child.kill('SIGKILL');
  await done;
}

async function startServer(root) {
  // Do not measure, replace, or terminate a pre-existing service on this port.
  await new Promise((resolveFree, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(fail('FIXTURE_PORT_ALREADY_OWNED')));
    probe.listen(8080, 'localhost', () => probe.close(resolveFree));
  });
  const child = spawn(process.execPath, ['.next/standalone/apps/web/server.js'], { cwd: resolve(root, 'apps/web'),
    env: { ...childEnv(), NODE_ENV: 'production', PORT: '8080', HOSTNAME: 'localhost',
      NEXT_PUBLIC_SUPABASE_URL: FIXTURE_ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dependency-modernization-browser-proof-anon-key' },
    stdio: 'ignore' });
  child.on('error', () => {});
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw fail('FIXTURE_SERVER_EXITED');
      try {
        const response = await fetch(ORIGIN + '/', { signal: AbortSignal.timeout(1000), redirect: 'error' });
        await response.arrayBuffer();
        if (response.status === 200 && child.exitCode === null && child.signalCode === null) return child;
      } catch { /* Bounded startup polling, outside every timed trial. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    throw fail('FIXTURE_SERVER_NOT_READY');
  } catch (error) { await stopOwned(child); throw error; }
}

async function trial({ tools, installFixture, protocol, phase, profile, index, run, output }) {
  const attemptId = profile.id + '-' + String(index).padStart(2, '0');
  const folder = resolve(output, phase, attemptId); await mkdir(folder);
  const item = { attemptId, phase, viewportId: profile.id, status: 'invalid', stage: 'launch', failures: [], paths: {},
    artifactSizes: {}, capturedArtifactShape: null, startedAt: new Date().toISOString(), endedAt: null };
  const profileRoot = await mkdtemp(resolve(tmpdir(), 'tzudong-fixture-audit-'));
  let browser, page, connection, timer;
  const errors = { pageErrors: 0, consoleErrors: 0, failedRequests: 0, firstPartyHttpErrors: 0, mainDocumentStatus: null };
  const networkPolicy = { externalRuntimeRequestsBlocked: true, externalRuntimeRequestsAllowed: 0,
    localRequests: 0, fixtureRequests: 0, blockedRequests: 0, blockedUrls: [] };
  const work = async () => {
    browser = await tools.puppeteer.launch({ executablePath: tools.executable, headless: true, userDataDir: profileRoot,
      args: EXPLICIT_ARGS, dumpio: false, timeout: 30000, env: childEnv() });
    if (!(await browser.version()).endsWith('/' + PINS.chrome)) throw fail('FIXTURE_BROWSER_VERSION_MISMATCH');
    const actualArgs = browser.process()?.spawnargs ?? [];
    if (!EXPLICIT_ARGS.every(arg => actualArgs.includes(arg))) throw fail('FIXTURE_BROWSER_LAUNCH_MISMATCH');
    item.browserLaunch = { headless: true, sandboxMode: 'disabled-for-disposable-ci',
      scope: 'disposable-github-runner-browser-process', explicitArgs: EXPLICIT_ARGS, noSandboxObserved: true };
    const pages = await browser.pages();
    if (pages.length !== 1) throw fail('FIXTURE_SOLE_PAGE_REQUIRED');
    page = pages[0];
    await page.setViewport({ width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile, hasTouch: profile.hasTouch });
    await page.emulateTimezone('UTC');
    item.stage = 'fixture-install';
    connection = await tools.playwright.chromium.connectOverCDP(browser.wsEndpoint());
    const fixturePages = connection.contexts().flatMap(context => context.pages());
    if (fixturePages.length !== 1) throw fail('FIXTURE_CDP_PAGE_MISMATCH');
    const fixturePage = fixturePages[0];
    await fixturePage.route('**/*', route => route.abort('blockedbyclient'));
    await installFixture(fixturePage);
    await fixturePage.route('**/*', async route => {
      const url = new URL(route.request().url()); const method = route.request().method();
      if (url.origin === ORIGIN && ['GET', 'HEAD'].includes(method)) { networkPolicy.localRequests++; await route.continue(); return; }
      if (url.origin === FIXTURE_ORIGIN && /^\/(rest|auth)\/v1\//.test(url.pathname)) {
        networkPolicy.fixtureRequests++; await route.fallback(); return;
      }
      networkPolicy.blockedRequests++;
      const safe = safeUrl(url.href); if (safe && networkPolicy.blockedUrls.length < 30) networkPolicy.blockedUrls.push(safe);
      await route.abort('blockedbyclient');
    });
    await fixturePage.routeWebSocket('**/*', socket => socket.close());
    await page.evaluateOnNewDocument(installObservation);
    page.on('pageerror', () => errors.pageErrors++);
    page.on('console', message => { if (message.type() === 'error') errors.consoleErrors++; });
    page.on('requestfailed', () => errors.failedRequests++);
    page.on('response', response => {
      if (new URL(response.url()).origin === ORIGIN && response.status() >= 400) errors.firstPartyHttpErrors++;
      if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) errors.mainDocumentStatus = response.status();
    });
    const settings = { ...protocol.lighthouse, onlyCategories: ['performance'], skipAudits: ['bf-cache'], disableFullPageScreenshot: true,
      formFactor: profile.formFactor, throttlingMethod: 'devtools', throttling: profile.throttling,
      screenEmulation: { mobile: profile.isMobile, width: profile.width, height: profile.height,
        deviceScaleFactor: profile.deviceScaleFactor, disabled: false }, emulatedUserAgent: profile.userAgent, locale: 'en-US' };
    delete settings.legacyTti;
    item.stage = 'lighthouse';
    const result = await tools.lighthouse(URL_TO_AUDIT, { logLevel: 'silent' }, { extends: 'lighthouse:default', settings }, page);
    if (!result?.lhr) throw fail('FIXTURE_LIGHTHOUSE_RESULT_MISSING');
    item.capturedArtifactShape = { lighthouseAuditCount: Object.keys(result.lhr.audits ?? {}).length,
      traceEventCount: result.artifacts?.Trace?.traceEvents?.length ?? null, networkEventCount: result.artifacts?.DevtoolsLog?.length ?? null,
      scriptRecordCount: Array.isArray(result.artifacts?.Scripts) ? result.artifacts.Scripts.length : null,
      finalScreenshotDataChars: typeof result.lhr.audits?.['final-screenshot']?.details?.data === 'string'
        ? result.lhr.audits['final-screenshot'].details.data.length : null };
    item.stage = 'timed-observation';
    const lhr = sanitizeLhr(result.lhr); const network = sanitizeNetwork(result.artifacts?.DevtoolsLog);
    const observed = await page.evaluate(observation);
    if (observed.lcpElement) observed.lcpElement.url = safeUrl(observed.lcpElement.url);
    const traceObservationEndMs = finite(lhr.audits?.metrics?.details?.items?.[0]?.observedTraceEnd);
    if (traceObservationEndMs === null) throw fail('FIXTURE_TRACE_BOUNDARY_UNAVAILABLE');
    const timed = observed.readinessTimeline.filter(sample => sample.atMs <= traceObservationEndMs);
    if (!timed.length) throw fail('FIXTURE_TIMED_OBSERVATIONS_MISSING');
    observed.actualViewport = timed.at(-1).actualViewport;
    observed.readiness = timed.at(-1).readiness;
    observed.selectedObservationAtMs = timed.at(-1).atMs;
    for (const name of Object.keys(observed.timings)) if (observed.timings[name] > traceObservationEndMs) observed.timings[name] = null;
    if (observed.lcpElement?.startTime > traceObservationEndMs) observed.lcpElement = null;
    observed.longTasks = observed.longTasks.filter(task => task.startTime + task.duration <= traceObservationEndMs);
    const scripts = Array.isArray(result.artifacts?.Scripts) ? result.artifacts.Scripts : [];
    const scriptRoleEvidence = { status: Array.isArray(result.artifacts?.Scripts) ? 'available' : 'unavailable',
      exactSourceLiteralFlagsOnly: true, records: scripts.filter(script =>
        safeUrl(script.url)?.startsWith(ORIGIN + '/_next/static/') && typeof script.content === 'string').map(script => ({
          url: safeUrl(script.url), mobileControls: script.content.includes('__tzudong_mobile_overlay_ready'),
          desktopLists: script.content.includes('homePanelReady'), wrapper: script.content.includes('homeChromeReady') })) };
    const observations = { schemaVersion: 'frontend-fixture-observations.v1', scope: 'frontend-fixture', phase, attemptId, viewportId: profile.id,
      source: { sourceSha: run.sourceSha, sourceTreeSha: run.sourceTreeSha, buildFingerprintSha256: run.build.buildFingerprintSha256 },
      browser: { product: 'Google Chrome for Testing', version: PINS.chrome, executable: tools.executable }, browserLaunch: item.browserLaunch,
      requestedViewport: { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor },
      requestedUrl: URL_TO_AUDIT, finalUrl: safeUrl(page.url()), ...observed, errors, networkPolicy, scriptRoleEvidence, traceObservationEndMs,
      timingBoundary: 'Last 100ms observer sample at or before Lighthouse observedTraceEnd; every in-trace viewport must match. Post-cleanup observations are context only.',
      mockMapTimingScope: 'Exploratory fixture context only; not real map latency or an improvement metric.',
      fixtureSha256: run.fixtureSha256, ttfbScope: 'loopback-frontend-fixture-not-production',
      staticTransferredBytes: network.records.filter(record => record.url?.startsWith(ORIGIN + '/_next/static/'))
        .reduce((sum, record) => sum + (record.encodedDataLength ?? 0), 0) };
    item.stage = 'artifacts';
    for (const [kind, name, value] of [['lhr', 'lighthouse.sanitized.json', lhr], ['trace', 'trace.sanitized.json', sanitizeTrace(result.artifacts?.Trace)],
      ['network', 'network.sanitized.json', network], ['observations', 'observations.json', observations]]) {
      item.artifactSizes[kind] = await save(resolve(folder, name), value); item.paths[kind] = attemptId + '/' + name;
    }
    try {
      const screenshot = result.lhr.audits?.['final-screenshot']?.details;
      const imageMatch = typeof screenshot?.data === 'string' && screenshot.data.length <= 14 * 1024 * 1024
        ? /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(screenshot.data) : null;
      if (!imageMatch || !(screenshot.timing >= 0 && screenshot.timing <= traceObservationEndMs)) throw fail('FIXTURE_TRACE_SCREENSHOT_MISSING');
      const imageBytes = Buffer.from(imageMatch[2], 'base64');
      const imageInfo = await tools.sharp(imageBytes, { limitInputPixels: 16000000 }).metadata();
      if (!['jpeg', 'png'].includes(imageInfo.format) || !imageInfo.width || !imageInfo.height) throw fail('FIXTURE_TRACE_SCREENSHOT_INVALID');
      const imageName = 'lighthouse-final.' + (imageMatch[1] === 'jpeg' ? 'jpg' : 'png');
      observations.screenshotProvenance = { source: 'lighthouse-final-screenshot', timingMs: screenshot.timing,
        timestampUs: screenshot.timestamp, widthPixels: imageInfo.width, heightPixels: imageInfo.height, mimeType: 'image/' + imageMatch[1] };
      await writeFile(resolve(folder, imageName), imageBytes, { flag: 'wx', mode: 0o600 });
      item.paths.screenshot = attemptId + '/' + imageName; item.artifactSizes.screenshot = imageBytes.length;
    } catch (error) {
      // Missing visual evidence never discards the numeric/raw diagnostics and
      // never falls back to a screenshot from the post-cleanup viewport.
      item.failures.push(code(error)); item.failedStage = 'artifacts';
    }
    if (observations.screenshotProvenance) {
      // This trial's already-retained observation changes only by adding the
      // image provenance after extraction. Numeric/raw evidence exists first.
      const bytes = JSON.stringify(observations, null, 2) + '\n';
      await writeFile(resolve(folder, 'observations.json'), bytes, { mode: 0o600 });
      item.artifactSizes.observations = Buffer.byteLength(bytes);
    }
    item.stage = 'validation';
    if (lhr.runtimeError || lhr.lighthouseVersion !== PINS.lighthouse) item.failures.push('FIXTURE_LIGHTHOUSE_INVALID');
    if (timed.some(sample => sample.actualViewport.width !== profile.width || sample.actualViewport.height !== profile.height
      || sample.actualViewport.deviceScaleFactor !== profile.deviceScaleFactor)) item.failures.push('FIXTURE_VIEWPORT_MISMATCH');
    if (safeUrl(page.url()) !== ORIGIN + '/' || !observed.initialDocumentQaExcluded) item.failures.push('FIXTURE_NAVIGATION_MISMATCH');
    if (errors.mainDocumentStatus !== 200 || errors.firstPartyHttpErrors || errors.pageErrors) item.failures.push('FIXTURE_PAGE_FUNCTIONAL_ERROR');
    if (!observed.readiness?.controlsQualified || !observed.readiness?.mockMapQualified || observed.readiness?.initialSkeletonVisible
      || profile.width >= 1280 && !observed.readiness?.desktopPanelQualified) item.failures.push('FIXTURE_CONTENT_NOT_READY');
    if (!(observed.navigation.responseStart > 0) || traceObservationEndMs === null) item.failures.push('FIXTURE_TIMING_UNAVAILABLE');
    for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'interactive', 'total-blocking-time', 'cumulative-layout-shift']) {
      const audit = lhr.audits[id];
      if (!audit || audit.errorCode || audit.scoreDisplayMode === 'error' || finite(audit.numericValue) === null) item.failures.push('FIXTURE_REQUIRED_METRIC_UNAVAILABLE');
    }
    item.status = item.failures.length ? 'invalid' : 'valid';
    if (item.status === 'valid') item.stage = 'complete';
  };
  try { await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(fail('FIXTURE_TRIAL_TIMEOUT')), 150000); })]); }
  catch (error) { item.failures.push(code(error)); }
  finally {
    clearTimeout(timer);
    if (browser) {
      let closeTimer;
      try { await Promise.race([browser.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(fail('FIXTURE_BROWSER_CLOSE_TIMEOUT')), 5000); })]); }
      catch { browser.process()?.kill('SIGKILL'); item.failures.push('FIXTURE_BROWSER_CLOSE_FAILED'); item.status = 'invalid'; }
      finally { clearTimeout(closeTimer); }
    }
    await rm(profileRoot, { recursive: true, force: true }); item.endedAt = new Date().toISOString();
    if (item.status !== 'valid') {
      item.paths.failureContext = attemptId + '/failure-context.json';
      await save(resolve(folder, 'failure-context.json'), { schemaVersion: 'frontend-fixture-failure-context.v1', stage: item.failedStage ?? item.stage,
        failures: item.failures, artifactSizes: item.artifactSizes, capturedArtifactShape: item.capturedArtifactShape,
        requestedViewport: { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor } });
    }
    await save(resolve(folder, 'trial.json'), item);
  }
  process.stdout.write(JSON.stringify({ phase, attemptId, status: item.status, failures: item.failures }) + '\n');
  return item;
}

export async function main(argv = process.argv.slice(2)) {
  const args = Object.fromEntries(Array.from({ length: argv.length / 2 }, (_, i) => [argv[i * 2], argv[i * 2 + 1]]));
  if (argv.length !== 8 || !['--before-root', '--after-root', '--candidate-sha', '--output'].every(key => args[key])
    || !/^[a-f0-9]{40}$/.test(args['--candidate-sha'])) throw fail('FIXTURE_ARGUMENTS_INVALID');
  const output = resolve(args['--output']); await mkdir(output, { recursive: true });
  const protocolBytes = await readFile(resolve(HERE, 'fixture-protocol.json')); const protocol = JSON.parse(protocolBytes);
  const fixtureBundle = resolve(output, 'fixture-helper.mjs');
  const fixture = { schemaVersion: 'frontend-fixture-manifest.v1', sourceSha: git(REPO, ['rev-parse', 'HEAD']),
    helperExport: 'installMobileHomeMapTestMocks', fixtureRestaurantCount: 3, provider: 'mock-naver',
    bundlePath: 'fixture-helper.mjs', bundleSha256: sha(await readFile(fixtureBundle)),
    sourceFiles: await Promise.all(FIXTURE_SOURCES.map(async path => ({ path, artifactPath: 'fixture-sources/' + path,
      sha256: sha(await readFile(resolve(REPO, path))) }))),
    networkPolicy: 'Only localhost:8080 GET/HEAD continue; exact dependency-proof.supabase.co rest/auth fixture handlers; all other requests and WebSockets aborted.',
    timingScope: 'Frontend fixture only; no real Supabase, map tiles, hosted origin, CDN or backend latency.' };
  const builds = {};
  for (const phase of ['before', 'after']) {
    await mkdir(resolve(output, phase)); const root = resolve(args['--' + phase + '-root']);
    for (const item of fixture.sourceFiles) if (sha(await readFile(resolve(root, item.path))) !== item.sha256) throw fail('FIXTURE_SOURCE_CHANGED_BETWEEN_BUILDS');
    builds[phase] = await assetManifest(root, phase, phase === 'before' ? protocol.baselineSourceSha : args['--candidate-sha']);
    await save(resolve(output, phase, 'build-manifest.json'), builds[phase]);
  }
  if (builds.before.appLockSha256 !== builds.after.appLockSha256) throw fail('FIXTURE_APP_LOCK_CHANGED');
  await save(resolve(output, 'fixture-manifest.json'), fixture);
  for (const item of fixture.sourceFiles) {
    await mkdir(dirname(resolve(output, item.artifactPath)), { recursive: true });
    await cp(resolve(REPO, item.path), resolve(output, item.artifactPath), { errorOnExist: true, force: false });
  }
  await mkdir(resolve(output, 'harness/tools'), { recursive: true });
  for (const name of ['fixture-protocol.json', 'fixture-collector.mjs', 'collector.mjs', 'tools/package.json', 'tools/package-lock.json',
    'score.mjs', 'validate.mjs', 'fixture-score.mjs', 'fixture-validate.mjs', 'fixture-evidence.mjs']) {
    await cp(resolve(HERE, name), resolve(output, 'harness', name), { errorOnExist: true, force: false });
  }
  const experiment = { schemaVersion: 'frontend-fixture-experiment.v1', scope: 'frontend-fixture',
    protocol: 'harness/fixture-protocol.json', collector: 'harness/fixture-collector.mjs', sanitizer: 'harness/collector.mjs',
    toolLock: 'harness/tools/package-lock.json', toolManifest: 'harness/tools/package.json', fixtureManifest: 'fixture-manifest.json',
    evidenceSources: { sourceScorer: 'harness/score.mjs', sourceValidator: 'harness/validate.mjs',
      fixtureScorer: 'harness/fixture-score.mjs', fixtureValidator: 'harness/fixture-validate.mjs', fixtureEvidence: 'harness/fixture-evidence.mjs' },
    builds: { before: 'before/build-manifest.json', after: 'after/build-manifest.json' },
    phases: { before: null, after: null } };
  await save(resolve(output, 'experiment.json'), experiment);
  const tools = await loadTools();
  const installFixture = (await import(pathToFileURL(fixtureBundle).href)).installMobileHomeMapTestMocks;
  const environment = { nodeVersion: process.version, platform: platform(), arch: arch(), cpuModels: [...new Set(cpus().map(cpu => cpu.model))],
    logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), runner: { os: process.env.RUNNER_OS, arch: process.env.RUNNER_ARCH,
      environment: process.env.RUNNER_ENVIRONMENT, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT } };
  for (const phase of ['before', 'after']) {
    let server;
    const run = { schemaVersion: 'frontend-fixture-run.v1', scope: 'frontend-fixture', phase, status: 'invalid',
      startedAt: new Date().toISOString(), endedAt: null, sourceSha: builds[phase].sourceSha, sourceTreeSha: builds[phase].sourceTreeSha,
      cachePolicy: 'cold-browser-fresh-process-and-profile-per-trial',
      url: URL_TO_AUDIT, build: { mode: 'production', completedAt: builds[phase].completedAt,
        assetManifestPath: phase + '/build-manifest.json', assetManifestSha256: sha(await readFile(resolve(output, phase, 'build-manifest.json'))),
        buildFingerprintSha256: builds[phase].buildFingerprintSha256 }, fixtureManifestPath: 'fixture-manifest.json',
      fixtureSha256: sha(await readFile(resolve(output, 'fixture-manifest.json'))), protocolSha256: sha(protocolBytes),
      collectorSha256: sha(await readFile(fileURLToPath(import.meta.url))), sanitizerSha256: sha(await readFile(resolve(HERE, 'collector.mjs'))),
      toolLockSha256: sha(await readFile(resolve(HERE, 'tools/package-lock.json'))), environment, pins: PINS, trials: [], failures: [] };
    try {
      server = await startServer(resolve(args['--' + phase + '-root']));
      for (const profile of protocol.profiles) for (let index = 1; index <= 5; index++) {
        const item = await trial({ tools, installFixture, protocol, phase, profile, index, run, output }); run.trials.push(item);
        if (item.browserLaunch) run.browserLaunch = item.browserLaunch;
        if (item.status !== 'valid') throw fail('FIXTURE_TRIAL_INVALID');
      }
      run.status = 'valid';
    } catch (error) { run.failures.push(code(error)); }
    finally {
      await stopOwned(server); run.endedAt = new Date().toISOString(); await save(resolve(output, phase, 'run.json'), run);
      experiment.phases[phase] = { run: phase + '/run.json' };
      await writeFile(resolve(output, 'experiment.json'), JSON.stringify(experiment, null, 2) + '\n', { mode: 0o600 });
    }
    if (run.status !== 'valid') { process.exitCode = 1; return experiment; }
  }
  return experiment;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(JSON.stringify({ status: 'invalid', code: code(error) }) + '\n'); process.exitCode = 1; });
}
