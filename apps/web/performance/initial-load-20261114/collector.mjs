import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPinnedPlaywright } from '../../../../.github/scripts/ensure-ci-chromium.mjs';
import { assertPrivacySafeText } from '../../lib/privacy/sanitize.ts';

// Only anonymous navigation to this public origin is permitted. No credentials,
// existing browser profile, private route, UI submission, or provider setting.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const CANONICAL = 'https://www.tzudong.app/';
const URL_TO_AUDIT = CANONICAL + '?__qa=render-flow';
const EXPECTED = Object.freeze({ lighthouse: '13.5.0', playwright: '1.64.1', chrome: '156.0.8078.4' });
const REQUIRED_AUDITS = ['first-contentful-paint', 'largest-contentful-paint', 'interactive',
  'total-blocking-time', 'cumulative-layout-shift'];
const TRIAL_TIMEOUT_MS = 150_000;
const MAX_NETWORK_RECORDS = 10_000;
const MAX_TRACE_EVENTS = 250_000;
const EXCLUDED = ['requestHeaders', 'responseHeaders', 'cookies', 'localStorage', 'sessionStorage',
  'requestBodies', 'responseBodies', 'SupabasePayloads', 'DOMText', 'DOMSnippets',
  'scriptContent', 'functionNames', 'sourceMaps', 'queryValues', 'fragments',
  'rawConsoleMessages', 'rawExceptions', 'providerDiagnostics', 'traceScreenshots'];
const TRACE_NAMES = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'ThreadControllerImpl::DoWork',
  'FunctionCall', 'EvaluateScript', 'v8.evaluateModule', 'v8.compile', 'V8.CompileCode',
  'V8.CompileScript', 'V8.Execute', 'RunMicrotasks', 'TimerFire', 'EventDispatch',
  'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'CompositeLayers',
  'ParseHTML', 'ParseAuthorStyleSheet', 'RecalculateStyles', 'Decode Image', 'ImageDecodeTask',
  'ResourceSendRequest', 'ResourceReceiveResponse', 'ResourceReceivedData', 'ResourceFinish',
  'navigationStart', 'firstPaint', 'firstContentfulPaint', 'largestContentfulPaint::Candidate',
  'largestImagePaint::Candidate', 'largestTextPaint::Candidate', 'LayoutShift', 'MarkDOMContent',
  'MarkLoad', 'thread_name', 'process_name', 'TracingStartedInBrowser', 'TracingStartedInPage']);
const DETAIL_STRINGS = new Set(['type', 'resourceType', 'mimeType', 'protocol', 'group', 'groupLabel',
  'numericUnit', 'statistic', 'entity', 'displayName', 'requestId', 'initiatorType', 'priority',
  'renderBlocking', 'fetchPriority', 'sourceType', 'scoreDisplayMode', 'acronym']);
const URL_KEYS = new Set(['url', 'scriptUrl', 'sourceURL', 'documentURL', 'requestUrl', 'origin']);
// Exact payload keys, not substrings: e.g. observedFirstContentfulPaint is a
// harmless numeric metric and must survive this boundary.
const FORBIDDEN_KEYS = /^(?:__proto__|constructor|prototype|headers?|requestHeaders|responseHeaders|cookies?|storage|localStorage|sessionStorage|postData|body|requestBody|responseBody|payload|content|snippet|selector|path|stack|stackTrace|message|errorMessage|description|explanation|sourceCode|functionName|nodeLabel|nodeId|backendNodeId|latitude|longitude|coordinates)$/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const fixedError = code => Object.assign(new Error(code), { auditCode: code });
const failureCode = error => /^[A-Z][A-Z0-9_]{2,95}$/.test(error?.auditCode ?? '')
  ? error.auditCode : 'COLLECTION_FAILED';
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(value)
  ? value : 'LIGHTHOUSE_ERROR_REDACTED';

function safeText(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try { assertPrivacySafeText(value); return value; } catch { return null; }
}

export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    // Storage object paths can contain private identities, unlike static app
    // chunks or public API names. Preserve their origin, never their object key.
    const path = /\/storage\/v1\/object\//.test(url.pathname) ? '/[storage-object-redacted]' : url.pathname;
    return safeText(url.origin + path);
  } catch { return null; }
}

function warningCode(value) {
  const text = typeof value === 'string' ? value : '';
  if (/timeout|timed out|maximum.*wait|taking too long/i.test(text)) return 'LOAD_TIMEOUT_WARNING';
  if (/storage|indexeddb|localstorage/i.test(text)) return 'STORAGE_WARNING';
  if (/extension/i.test(text)) return 'EXTENSION_WARNING';
  if (/redirect/i.test(text)) return 'REDIRECT_WARNING';
  if (/robots/i.test(text)) return 'ROBOTS_WARNING';
  return 'LIGHTHOUSE_WARNING_REDACTED';
}

// Keep the numeric tree (including waterfall timings, byte waste, main-thread
// groups and dependency-tree nodes), bounded known type strings, and safe URLs.
// Arbitrary page text, DOM snippets, request bodies and diagnostics never reach
// a file or log. This projection is intentionally not a re-auditable raw trace.
export function sanitizeDetails(value, state = { entries: 0, omitted: 0 }, key = '', depth = 0) {
  if (++state.entries > 200_000 || depth > 18) throw fixedError('SANITIZED_DETAILS_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finite(value);
  if (typeof value === 'string') {
    if (URL_KEYS.has(key)) return safeUrl(value);
    if (DETAIL_STRINGS.has(key)) return value.includes('://') ? safeUrl(value) : safeText(value);
    state.omitted++;
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > 20_000) throw fixedError('SANITIZED_DETAILS_LIMIT');
    return value.map(item => sanitizeDetails(item, state, key, depth + 1))
      .filter(item => item !== undefined);
  }
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  for (const [name, child] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || FORBIDDEN_KEYS.test(name)) { state.omitted++; continue; }
    const item = sanitizeDetails(child, state, name, depth + 1);
    if (item !== undefined) result[name] = item;
  }
  return result;
}

export function sanitizeLhr(lhr) {
  const audits = {};
  const state = { entries: 0, omitted: 0 };
  for (const [id, audit] of Object.entries(lhr.audits ?? {})) {
    if (!/^[a-z0-9-]{1,100}$/.test(id)) continue;
    const numeric = {};
    for (const [key, value] of Object.entries(audit)) {
      if (/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(key) && (typeof value === 'number' || value === null || typeof value === 'boolean')) {
        numeric[key] = typeof value === 'number' ? finite(value) : value;
      }
    }
    audits[id] = {
      id, ...numeric, score: finite(audit.score), scoreDisplayMode: safeText(audit.scoreDisplayMode),
      numericUnit: safeText(audit.numericUnit),
      ...(audit.errorMessage ? { errorCode: 'AUDIT_ERROR_REDACTED' } : {}),
      warnings: (audit.warnings ?? []).map(warningCode),
      ...(audit.details ? { details: sanitizeDetails(audit.details, state) } : {}),
    };
  }
  const settings = lhr.configSettings ?? {};
  return {
    schemaVersion: 'initial-load-lighthouse-sanitized.v1',
    evidenceType: 'sanitized Lighthouse JSON',
    lighthouseVersion: lhr.lighthouseVersion,
    fetchTime: lhr.fetchTime,
    requestedUrl: safeUrl(lhr.requestedUrl),
    finalDisplayedUrl: safeUrl(lhr.finalDisplayedUrl),
    finalUrl: safeUrl(lhr.finalUrl ?? lhr.finalDisplayedUrl),
    mainDocumentUrl: safeUrl(lhr.mainDocumentUrl),
    runtimeError: lhr.runtimeError ? { code: safeCode(lhr.runtimeError.code), messageRedacted: true } : null,
    runWarnings: (lhr.runWarnings ?? []).map(warningCode),
    configSettings: {
      formFactor: settings.formFactor,
      throttlingMethod: settings.throttlingMethod,
      throttling: sanitizeDetails(settings.throttling),
      screenEmulation: sanitizeDetails(settings.screenEmulation),
      emulatedUserAgent: safeText(settings.emulatedUserAgent),
      locale: safeText(settings.locale),
      onlyCategories: settings.onlyCategories?.filter(x => x === 'performance'),
      skipAudits: settings.skipAudits?.filter(x => x === 'bf-cache'),
      disableStorageReset: settings.disableStorageReset,
      disableFullPageScreenshot: settings.disableFullPageScreenshot,
      maxWaitForFcp: finite(settings.maxWaitForFcp),
      maxWaitForLoad: finite(settings.maxWaitForLoad),
      pauseAfterFcpMs: finite(settings.pauseAfterFcpMs),
      pauseAfterLoadMs: finite(settings.pauseAfterLoadMs),
      networkQuietThresholdMs: finite(settings.networkQuietThresholdMs),
      cpuQuietThresholdMs: finite(settings.cpuQuietThresholdMs),
    },
    categories: { performance: { score: finite(lhr.categories?.performance?.score),
      auditRefs: (lhr.categories?.performance?.auditRefs ?? []).map(item => ({
        id: safeText(item.id), weight: finite(item.weight), group: safeText(item.group),
      })) } },
    timing: sanitizeDetails(lhr.timing),
    environment: {
      benchmarkIndex: finite(lhr.environment?.benchmarkIndex),
      networkUserAgent: safeText(lhr.environment?.networkUserAgent),
      hostUserAgent: safeText(lhr.environment?.hostUserAgent),
    },
    audits,
    sanitization: { excluded: EXCLUDED, omittedFields: state.omitted,
      numericAuditFieldsPreservedExceptExplicitExcludedSubtrees: true,
      reauditableRawLighthouseArtifact: false },
  };
}

export function sanitizeTrace(trace) {
  const events = [];
  for (const event of trace?.traceEvents ?? []) {
    if (!TRACE_NAMES.has(event.name)) continue;
    if (events.length >= MAX_TRACE_EVENTS) throw fixedError('TRACE_EVENT_LIMIT');
    const record = { name: event.name };
    for (const key of ['ts', 'dur', 'pid', 'tid', 'tts', 'tdur']) {
      if (finite(event[key]) !== null) record[key] = event[key];
    }
    if (['X', 'B', 'E', 'I', 'i', 'R', 'M', 'b', 'e', 'n'].includes(event.ph)) record.ph = event.ph;
    const data = event.args?.data ?? {};
    record.data = {};
    for (const key of ['requestId', 'scriptId']) {
      if (typeof data[key] === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(data[key])) record.data[key] = data[key];
    }
    for (const key of ['lineNumber', 'columnNumber', 'encodedDataLength', 'decodedBodyLength',
      'statusCode', 'priority', 'size', 'score', 'weighted_score_delta', 'had_recent_input',
      'isMainFrame', 'isOutermostMainFrame']) {
      if (typeof data[key] === 'boolean' || finite(data[key]) !== null) record.data[key] = data[key];
    }
    for (const key of ['url', 'scriptName']) {
      const url = safeUrl(data[key]);
      if (url) record.data[key] = url;
    }
    if (event.name === 'thread_name' && ['CrRendererMain', 'CrBrowserMain', 'Compositor', 'VizCompositorThread'].includes(event.args?.name)) {
      record.threadName = event.args.name;
    }
    events.push(record);
  }
  return { schemaVersion: 'initial-load-trace-sanitized.v1', timeUnit: 'microseconds',
    traceEvents: events, sanitization: { eventNameAllowlist: [...TRACE_NAMES], excluded: EXCLUDED,
      reauditableRawLighthouseArtifact: false, overlappingTaskDurationsMustNotBeSummed: true } };
}

export function sanitizeNetwork(log) {
  const records = new Map();
  const initiators = new Map();
  const selected = id => {
    if (!records.has(id)) {
      if (records.size >= MAX_NETWORK_RECORDS) throw fixedError('NETWORK_RECORD_LIMIT');
      records.set(id, { index: records.size + 1, url: null, resourceType: null,
        startTime: null, responseTime: null, endTime: null, encodedDataLength: null });
    }
    return records.get(id);
  };
  for (const event of log ?? []) {
    const { method, params: p } = event;
    if (!p?.requestId || !['Network.requestWillBeSent', 'Network.responseReceived',
      'Network.loadingFinished', 'Network.loadingFailed'].includes(method)) continue;
    const record = selected(p.requestId);
    if (method === 'Network.requestWillBeSent') {
      record.url = safeUrl(p.request?.url);
      record.resourceType = safeText(p.type);
      record.startTime = finite(p.timestamp);
      record.method = ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(p.request?.method) ? p.request.method : 'OTHER';
      record.initiatorType = safeText(p.initiator?.type);
      const frames = p.initiator?.stack?.callFrames ?? [];
      record.initiatorUrls = [...new Set([p.initiator?.url, ...frames.map(frame => frame.url)]
        .map(safeUrl).filter(Boolean))].slice(0,12);
      if (p.initiator?.requestId) initiators.set(p.requestId, p.initiator.requestId);
      if (p.redirectResponse) record.redirectCount = (record.redirectCount ?? 0) + 1;
    } else if (method === 'Network.responseReceived') {
      record.url = safeUrl(p.response?.url) ?? record.url;
      record.resourceType = safeText(p.type) ?? record.resourceType;
      record.responseTime = finite(p.timestamp);
      record.status = finite(p.response?.status);
      record.mimeType = safeText(p.response?.mimeType);
      record.protocol = safeText(p.response?.protocol);
      record.fromDiskCache = Boolean(p.response?.fromDiskCache);
      record.fromServiceWorker = Boolean(p.response?.fromServiceWorker);
      record.timing = sanitizeDetails(p.response?.timing);
    } else if (method === 'Network.loadingFinished') {
      record.endTime = finite(p.timestamp);
      record.encodedDataLength = finite(p.encodedDataLength);
    } else {
      record.endTime = finite(p.timestamp);
      record.failed = true;
      record.canceled = Boolean(p.canceled);
      record.failureCode = 'NETWORK_REQUEST_FAILED';
    }
  }
  for (const [id, parent] of initiators) selected(id).initiatorIndex = records.get(parent)?.index ?? null;
  return { schemaVersion: 'initial-load-network-sanitized.v1', timeUnit: 'CDP monotonic seconds',
    records: [...records.values()], sanitization: { excluded: EXCLUDED, URLs: 'origin plus pathname only' } };
}

function scriptRoles(scripts) {
  if (!Array.isArray(scripts)) return { status: 'unavailable', records: [] };
  const records = [];
  for (const script of scripts) {
    const url = safeUrl(script?.url);
    if (!url?.startsWith(CANONICAL + '_next/static/') || typeof script.content !== 'string') continue;
    const flags = {
      // homeMobileChromeReady also occurs in the initial shell's cleanup.
      // This unique sentinel belongs to the actual MobileControlOverlay.
      mobileControls: script.content.includes('__tzudong_mobile_overlay_ready'),
      desktopLists: script.content.includes('homePanelReady'),
      controlWrapper: script.content.includes('homeChromeReady'),
    };
    if (Object.values(flags).some(Boolean)) records.push({ url, ...flags });
  }
  return { status: 'observed', exactSourceLiteralFlagsOnly: true, records };
}

// Runs in the page before app scripts; no DOM, style, storage, permission or
// network mutation. Readiness is an auxiliary app observation, never TTI.
function installObservation() {
  const visible = element => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0
      && box.top < innerHeight && box.left < innerWidth && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const state = {
    samplingIntervalMs: 100, timings: { controlsReadyMs: null, mapReadyMs: null,
      desktopPanelReadyMs: null, initialSkeletonHiddenMs: null },
    lcp: null, longTasks: [], samples: 0, stopped: false,
  };
  const inspect = () => {
    const data = document.documentElement?.dataset ?? {};
    const markerNodes = [...document.querySelectorAll('button.cluster-marker-container, button.tzudong-individual-marker[data-testid="marker"]')];
    const naverMarkerCount = markerNodes.filter(visible).length;
    const map = document.querySelector('[data-testid="map-container"]') ?? document;
    const tiles = [...map.querySelectorAll('img')].filter(image => {
      try {
        const url = new URL(image.currentSrc || image.src, location.href);
        const box = image.getBoundingClientRect();
        return /(^|\.)(pstatic\.net|naver\.com|naver\.net|ntruss\.com)$/.test(url.hostname)
          && box.width >= 100 && box.height >= 100 && visible(image)
          && image.complete && image.naturalWidth > 0;
      } catch { return false; }
    });
    const desktop = innerWidth >= 1280;
    // The lazy dropdown fallback has the same data attribute. Only the actual
    // Radix menu trigger has menu semantics, and the real search input must exist.
    const desktopMenuReady = visible(document.querySelector('button[data-desktop-map-menu-trigger="true"][aria-haspopup="menu"][aria-expanded]'));
    const desktopSearchReady = visible(document.querySelector('input[name="desktop-left-panel-restaurant-search"]'));
    const actualDesktopControls = desktopMenuReady && desktopSearchReady;
    const desktopPanel = document.querySelector('[data-desktop-left-panel-map-home="true"]');
    const desktopPanelPresent = visible(desktopPanel);
    const desktopPanelAlertCount = desktopPanel?.querySelectorAll('[role="alert"]').length ?? 0;
    const desktopPanelVisibleAlertCount = desktopPanel ? [...desktopPanel.querySelectorAll('[role="alert"]')].filter(visible).length : 0;
    const desktopPopularItemCount = desktopPanel?.querySelectorAll('button[aria-label$=" 인기 맛집 상세 보기"]').length ?? 0;
    const desktopLatestItemCount = desktopPanel?.querySelectorAll('[data-desktop-left-panel-latest-restaurants="true"] [role="button"][aria-label$=" 도장 카드 열기"], [data-desktop-left-panel-latest-restaurants="true"] [role="button"][aria-label$=" 맛집 상세 열기"]').length ?? 0;
    const skeleton = document.querySelector('[data-home-static-skeleton]');
    return {
      homeChromeReady: data.homeChromeReady === 'true',
      homeMobileChromeReady: data.homeMobileChromeReady === 'true',
      homePanelReady: data.homePanelReady === 'true',
      actualDesktopControls, desktopMenuReady, desktopSearchReady, desktopPanelPresent,
      desktopPanelAlertCount, desktopPanelVisibleAlertCount, desktopPopularItemCount, desktopLatestItemCount,
      initialSkeletonPresent: Boolean(skeleton), initialSkeletonVisible: visible(skeleton),
      controlsQualified: desktop ? data.homeChromeReady === 'true' && actualDesktopControls
        : data.homeMobileChromeReady === 'true',
      desktopPanelQualified: data.homePanelReady === 'true' && desktopPanelPresent
        && desktopPanelAlertCount === 0 && desktopPopularItemCount > 0 && desktopLatestItemCount > 0,
      mapQualified: tiles.length > 0 && naverMarkerCount > 0,
      tileReadyCount: tiles.length, naverMarkerCount,
      googleMarkerCount: document.querySelectorAll('.custom-marker').length,
      naverSdkPresent: typeof window.naver?.maps?.Map === 'function',
    };
  };
  window.__initialLoadAudit = state;
  window.__initialLoadAuditInspect = inspect;
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.lcp = { startTime: entry.startTime, renderTime: entry.renderTime,
          loadTime: entry.loadTime, size: entry.size, tagName: entry.element?.tagName ?? null,
          url: entry.url || null };
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (state.longTasks.length < 5000) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { state.observerUnsupported = true; }
  const sample = () => {
    if (state.stopped) return;
    const readiness = inspect();
    const now = performance.now();
    state.samples++;
    if (state.timings.controlsReadyMs === null && readiness.controlsQualified) state.timings.controlsReadyMs = now;
    if (state.timings.mapReadyMs === null && readiness.mapQualified) state.timings.mapReadyMs = now;
    if (state.timings.desktopPanelReadyMs === null && readiness.desktopPanelQualified) state.timings.desktopPanelReadyMs = now;
    if (state.timings.initialSkeletonHiddenMs === null && readiness.initialSkeletonPresent && !readiness.initialSkeletonVisible) {
      state.timings.initialSkeletonHiddenMs = now;
    }
    if (now < 90_000) setTimeout(sample, state.samplingIntervalMs);
  };
  setTimeout(sample, 0);
}

function getObservation() {
  const nav = performance.getEntriesByType('navigation')[0];
  const navigation = {};
  for (const name of ['startTime', 'duration', 'fetchStart', 'domainLookupStart', 'domainLookupEnd',
    'connectStart', 'connectEnd', 'secureConnectionStart', 'requestStart', 'firstInterimResponseStart',
    'responseStart', 'finalResponseHeadersStart', 'responseEnd', 'domInteractive',
    'domContentLoadedEventStart', 'domContentLoadedEventEnd', 'loadEventStart', 'loadEventEnd',
    'transferSize', 'encodedBodySize', 'decodedBodySize', 'responseStatus', 'redirectCount']) {
    navigation[name] = typeof nav?.[name] === 'number' ? nav[name] : null;
  }
  navigation.type = ['navigate', 'reload', 'back_forward', 'prerender'].includes(nav?.type) ? nav.type : null;
  const state = window.__initialLoadAudit;
  if (state) state.stopped = true;
  return {
    observedAtMs: performance.now(), navigation,
    actualViewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
    browserLanguage: navigator.language, userAgent: navigator.userAgent,
    initialDocumentQaExcluded: new URLSearchParams(location.search).has('__qa'),
    readiness: window.__initialLoadAuditInspect?.() ?? null,
    timings: state?.timings ?? {}, samplingIntervalMs: state?.samplingIntervalMs ?? null,
    readinessSamples: state?.samples ?? 0, lcpElement: state?.lcp ?? null,
    longTasks: state?.longTasks ?? [],
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    mainCount: document.querySelectorAll('main#main-content').length,
  };
}

async function saveJson(path, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 48 * 1024 * 1024) throw fixedError('ARTIFACT_SIZE_LIMIT');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
}

const HEALTH_STAGE_FAILURES = Object.freeze({
  launch: 'HEALTH_BROWSER_LAUNCH_FAILED', version: 'HEALTH_BROWSER_VERSION_FAILED',
  newpage: 'HEALTH_BROWSER_NEWPAGE_FAILED', navigation: 'HEALTH_BROWSER_NAVIGATION_FAILED',
  projection: 'HEALTH_BROWSER_PROJECTION_FAILED', close: 'HEALTH_BROWSER_CLOSE_FAILED',
});

function browserLaunchPolicy(measured = false) {
  // Match this repository's Playwright probe only inside a disposable hosted
  // CI process. Never change the host, app, firewall, auth, UA or proxy policy.
  const hosted = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
  return { headless: true, sandboxMode: hosted ? 'disabled-for-disposable-ci' : 'enabled-default',
    scope: hosted ? 'disposable-github-runner-browser-process' : 'disposable-local-browser-process',
    explicitArgs: [...(hosted ? ['--no-sandbox'] : []), ...(measured ? ['--lang=ko-KR'] : [])],
    noSandboxObserved: null };
}

function observeBrowserLaunch(policy, browser, errorCode) {
  const argv = browser.process()?.spawnargs;
  if (!Array.isArray(argv) || policy.explicitArgs.some(arg => !argv.includes(arg))
    || argv.includes('--no-sandbox') !== policy.explicitArgs.includes('--no-sandbox')) throw fixedError(errorCode);
  // Preserve only our explicit allowlisted arguments, never raw process argv.
  return { ...policy, noSandboxObserved: argv.includes('--no-sandbox') };
}

export function classifyHealthBrowserError(error, stage) {
  // Inspect bounded diagnostics only in memory; never retain the error, stack,
  // message, executable stderr, or any document/provider diagnostic.
  const message = typeof error?.message === 'string' ? error.message.slice(0, 16_384).toLowerCase() : '';
  if (/no usable sandbox|suid sandbox|setuid sandbox|running as root without --no-sandbox|failed to move to new namespace/.test(message)
    || /sandbox/.test(message) && /not supported|unavailable|operation not permitted|permission denied/.test(message)) {
    return 'HEALTH_BROWSER_SANDBOX_UNAVAILABLE';
  }
  if (/enoent|could not find chrome|executable[^\n]{0,100}(?:not found|does not exist)/.test(message)) {
    return 'HEALTH_BROWSER_EXECUTABLE_NOT_FOUND';
  }
  if (/eacces|eperm|permission denied|access denied/.test(message) && stage === 'launch') {
    return 'HEALTH_BROWSER_EXECUTABLE_PERMISSION_DENIED';
  }
  if (/net::err_(?:blocked_by_client|blocked_by_response|access_denied|network_access_denied)|navigation[^\n]{0,40}denied/.test(message)) {
    return 'HEALTH_BROWSER_NAVIGATION_DENIED';
  }
  if (error?.name === 'TimeoutError' || /timeout|timed out/.test(message)) return 'HEALTH_BROWSER_TIMEOUT';
  return HEALTH_STAGE_FAILURES[stage] ?? 'HEALTH_READBACK_UNAVAILABLE';
}

export async function publicBrowserHealth(tools) {
  // A distinct anonymous process/profile reads the ordinary public JSON page.
  // It is fully closed before returning; the measured browser's connection,
  // storage and cache are never warmed by deployment verification. No custom
  // UA, headers, proxy, auth, challenge interaction or host/app security change.
  const profileRoot = await mkdtemp(resolve(tmpdir(), 'tzudong-health-readback-'));
  const launchPolicy = browserLaunchPolicy();
  const evidence = { transport: 'browser-public-navigation',
    isolatedFromMeasuredBrowser: true, credentialsUsed: false,
    browser: { product: 'Google Chrome for Testing', version: EXPECTED.chrome, executable: tools.executable },
    browserLaunch: launchPolicy,
    observedAt: new Date().toISOString(), stage: 'launch', httpStatus: null, pageClassification: 'unavailable' };
  let browser;
  try {
    browser = await tools.puppeteer.launch({ executablePath: tools.executable,
      headless: true, userDataDir: profileRoot, dumpio: false, timeout: 30_000,
      args: launchPolicy.explicitArgs,
      env: Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']
        .filter(key => process.env[key]).map(key => [key, process.env[key]])) });
    evidence.browserLaunch = observeBrowserLaunch(launchPolicy, browser, 'HEALTH_BROWSER_LAUNCH_POLICY_MISMATCH');
    evidence.stage = 'version';
    if (!(await browser.version()).endsWith('/' + EXPECTED.chrome)) throw fixedError('HEALTH_BROWSER_VERSION_MISMATCH');
    evidence.stage = 'newpage';
    const page = await browser.newPage();
    evidence.stage = 'navigation';
    const response = await page.goto(CANONICAL + 'api/health', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    evidence.httpStatus = finite(response?.status());
    evidence.stage = 'projection';
    const document = await page.evaluate(() => {
      const text = (window.document.querySelector('pre')?.textContent ?? window.document.body?.innerText ?? '').trim();
      const sample = (window.document.title + '\n' + text.slice(0, 8192)).slice(0, 8448);
      const challenge = /security checkpoint|verify.{0,30}human|checking your browser|just a moment/i.test(sample);
      const classification = challenge ? 'challenge_document' : text.length > 65_536 ? 'oversize_document'
        : !text ? 'empty_document' : text.startsWith('{') ? 'json_document'
          : window.document.contentType === 'text/html' ? 'html_document' : 'text_document';
      // Return bounded JSON only. HTML, title, challenge text and arbitrary
      // provider diagnostics are never transferred into retained evidence.
      return { classification, json: classification === 'json_document' ? text : null };
    });
    evidence.pageClassification = document.classification;
    evidence.observedAt = new Date().toISOString();
    if (!response) throw fixedError('HEALTH_READBACK_NO_RESPONSE');
    if (response.status() >= 400) throw fixedError('HEALTH_READBACK_HTTP_' + response.status());
    if (page.url() !== CANONICAL + 'api/health') throw fixedError('HEALTH_READBACK_REDIRECTED');
    if (document.classification === 'oversize_document') throw fixedError('HEALTH_READBACK_SIZE_LIMIT');
    if (document.classification !== 'json_document') throw fixedError('HEALTH_READBACK_NON_JSON');
    let value;
    try { value = JSON.parse(document.json); } catch { throw fixedError('HEALTH_READBACK_INVALID'); }
    if (value.ok !== true || value.host !== 'www.tzudong.app'
      || !/^[a-f0-9]{40}$/.test(value.gitSha ?? '') || !/^dpl_[A-Za-z0-9]{10,80}$/.test(value.deploymentId ?? '')) {
      throw fixedError('HEALTH_READBACK_INVALID');
    }
    return { ...evidence, sourceSha: value.gitSha, gitSha: value.gitSha, deploymentId: value.deploymentId,
      canonicalUrl: CANONICAL, healthOk: true, ok: true, host: value.host };
  } catch (error) {
    const failure = fixedError(error?.auditCode ? failureCode(error) : classifyHealthBrowserError(error, evidence.stage));
    failure.healthReadback = { ...evidence };
    throw failure;
  } finally {
    if (browser) {
      let timer;
      try {
        await Promise.race([browser.close(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(fixedError('HEALTH_BROWSER_CLOSE_TIMEOUT')), 5000);
        })]);
      } catch (error) {
        browser.process()?.kill('SIGKILL');
        throw Object.assign(fixedError(error?.auditCode ? failureCode(error) : classifyHealthBrowserError(error, 'close')),
          { healthReadback: { ...evidence, stage: 'close' } });
      } finally {
        clearTimeout(timer);
        await rm(profileRoot, { recursive: true, force: true });
      }
    } else {
      await rm(profileRoot, { recursive: true, force: true });
    }
  }
}

async function deploymentReadback(tools, sourceSha, deploymentId) {
  const value = await publicBrowserHealth(tools);
  if (value.gitSha !== sourceSha || value.deploymentId !== deploymentId) {
    throw Object.assign(fixedError('DEPLOYMENT_IDENTITY_MISMATCH'), {
      healthReadback: { transport: value.transport, httpStatus: value.httpStatus,
        pageClassification: value.pageClassification, observedAt: value.observedAt },
    });
  }
  return value;
}

async function loadTools(protocol) {
  if (process.versions.node.split('.')[0] !== '24') throw fixedError('NODE_PIN_MISMATCH');
  const toolsRoot = resolve(HERE, 'tools');
  const requireTools = createRequire(resolve(toolsRoot, 'package.json'));
  const lock = JSON.parse(await readFile(resolve(toolsRoot, 'package-lock.json'), 'utf8'));
  const manifestPath = requireTools.resolve('lighthouse/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== EXPECTED.lighthouse || lock.packages?.['node_modules/lighthouse']?.version !== EXPECTED.lighthouse) {
    throw fixedError('LIGHTHOUSE_PIN_MISMATCH');
  }
  const pinned = loadPinnedPlaywright(REPO);
  if (pinned.browserVersion !== EXPECTED.chrome || protocol.tools.chrome !== EXPECTED.chrome
    || protocol.tools.playwright !== EXPECTED.playwright || protocol.tools.lighthouse !== EXPECTED.lighthouse) {
    throw fixedError('BROWSER_CONTRACT_MISMATCH');
  }
  const chromium = pinned.requireWeb('playwright').chromium;
  const executable = chromium.executablePath();
  try {
    if (!(await lstat(executable)).isFile() || await realpath(executable) !== executable) throw fixedError('CHROME_EXECUTABLE_UNVERIFIED');
  } catch { throw fixedError('CHROME_EXECUTABLE_UNVERIFIED'); }
  const product = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (product !== 'Google Chrome for Testing ' + EXPECTED.chrome) throw fixedError('CHROME_IDENTITY_UNVERIFIED');
  const puppeteerManifest = JSON.parse(await readFile(requireTools.resolve('puppeteer-core/package.json'), 'utf8'));
  if (puppeteerManifest.version !== lock.packages?.['node_modules/puppeteer-core']?.version) throw fixedError('PUPPETEER_LOCK_MISMATCH');
  return {
    lighthouse: (await import(pathToFileURL(requireTools.resolve('lighthouse')).href)).default,
    puppeteer: (await import(pathToFileURL(requireTools.resolve('puppeteer-core')).href)).default,
    executable, product, puppeteerVersion: puppeteerManifest.version,
    toolLockSha256: sha(await readFile(resolve(toolsRoot, 'package-lock.json'))),
  };
}

async function trial({ tools, protocol, profile, index, args, sourceTreeSha, output }) {
  const attemptId = profile.id + '-' + String(index).padStart(2, '0');
  const folder = resolve(output, attemptId);
  await mkdir(folder);
  const item = { attemptId, viewportId: profile.id, phase: args.phase,
    status: 'invalid', startedAt: new Date().toISOString(), endedAt: null, failures: [], paths: {} };
  const launchPolicy = browserLaunchPolicy(true);
  item.browserLaunch = launchPolicy;
  let browser, page, timeout;
  const profileRoot = await mkdtemp(resolve(tmpdir(), 'tzudong-initial-load-'));
  const errors = { pageErrors: 0, consoleErrors: 0, failedRequests: 0,
    firstPartyHttpErrors: 0, mainDocumentStatus: null };
  const work = async () => {
    const before = await deploymentReadback(tools, args.sourceSha, args.deploymentId);
    browser = await tools.puppeteer.launch({ executablePath: tools.executable,
      headless: true, userDataDir: profileRoot, dumpio: false, timeout: 30_000,
      args: launchPolicy.explicitArgs,
      env: Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']
        .filter(key => process.env[key]).map(key => [key, process.env[key]])) });
    item.browserLaunch = observeBrowserLaunch(launchPolicy, browser, 'BROWSER_LAUNCH_POLICY_MISMATCH');
    if (!(await browser.version()).endsWith('/' + EXPECTED.chrome)) throw fixedError('BROWSER_RUNTIME_VERSION_MISMATCH');
    page = await browser.newPage();
    await page.setViewport({ width: profile.width, height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch });
    await page.emulateTimezone('UTC');
    await page.evaluateOnNewDocument(installObservation);
    page.on('pageerror', () => errors.pageErrors++);
    page.on('console', message => { if (message.type() === 'error') errors.consoleErrors++; });
    page.on('requestfailed', () => errors.failedRequests++);
    page.on('response', response => {
      let url;
      try { url = new URL(response.url()); } catch { return; }
      if (url.origin === new URL(CANONICAL).origin && response.status() >= 400) errors.firstPartyHttpErrors++;
      if (response.request().isNavigationRequest() && response.request().frame() === page.mainFrame()) {
        errors.mainDocumentStatus = response.status();
      }
    });
    const config = { extends: 'lighthouse:default', settings: {
      ...protocol.lighthouse, legacyTti: undefined, onlyCategories: ['performance'],
      // This performance diagnostic would navigate away/back, altering the
      // measured document and NavigationTiming. It is irrelevant to cold load.
      skipAudits: ['bf-cache'], disableFullPageScreenshot: true,
      formFactor: profile.formFactor, throttlingMethod: 'devtools',
      throttling: profile.throttling,
      screenEmulation: { mobile: profile.isMobile, width: profile.width, height: profile.height,
        deviceScaleFactor: profile.deviceScaleFactor, disabled: false },
      emulatedUserAgent: profile.userAgent, locale: 'en-US',
    } };
    delete config.settings.legacyTti;
    const result = await tools.lighthouse(URL_TO_AUDIT, { logLevel: 'silent' }, config, page);
    if (!result?.lhr) throw fixedError('LIGHTHOUSE_RESULT_UNAVAILABLE');
    const lhr = sanitizeLhr(result.lhr);
    const observation = await page.evaluate(getObservation);
    observation.lcpElement = observation.lcpElement ? {
      ...observation.lcpElement, url: safeUrl(observation.lcpElement.url),
      tagName: /^[A-Z0-9-]{1,32}$/.test(observation.lcpElement.tagName ?? '') ? observation.lcpElement.tagName : null,
    } : null;
    let after = null;
    try { after = await deploymentReadback(tools, args.sourceSha, args.deploymentId); }
    catch (error) {
      item.failures.push(failureCode(error));
      if (error.healthReadback) item.healthReadbackFailure = error.healthReadback;
    }
    const traceEndMs = finite(lhr.audits?.metrics?.details?.items?.[0]?.observedTraceEnd);
    const source = { gitSha: args.sourceSha, sourceSha: args.sourceSha, sourceTreeSha,
      deploymentId: args.deploymentId, canonicalUrl: CANONICAL, healthBefore: before, healthAfter: after };
    const observations = {
      schemaVersion: 'initial-load-observations.v1', phase: args.phase, attemptId,
      viewportId: profile.id, source, browser: { product: 'Google Chrome for Testing',
        version: EXPECTED.chrome, executable: tools.executable },
      browserLaunch: item.browserLaunch,
      requestedViewport: { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor },
      requestedUrl: URL_TO_AUDIT, finalUrl: safeUrl(page.url()), ...observation,
      traceObservationEndMs: traceEndMs,
      timingBoundary: 'Readiness timestamps after observedTraceEnd are unavailable for this throttled sample.',
      readinessDefinition: {
        controls: profile.width < 1280 ? 'homeMobileChromeReady'
          : 'homeChromeReady and visible Radix menu trigger and real desktop search input',
        map: 'visible Naver marker and visible completed Naver provider tile image',
        tile: 'pstatic.net/naver.com/naver.net/ntruss.com image at least 100 CSS px in each dimension',
        desktopPanel: 'homePanelReady, panel present, no scoped alerts, at least one popular and one latest item',
      },
      errors, scriptRoleEvidence: scriptRoles(result.artifacts?.Scripts),
    };
    const raw = {
      lhr: ['lighthouse.sanitized.json', lhr],
      trace: ['trace.sanitized.json', sanitizeTrace(result.artifacts?.Trace ?? result.artifacts?.TraceError)],
      network: ['network.sanitized.json', sanitizeNetwork(result.artifacts?.DevtoolsLog ?? result.artifacts?.DevtoolsLogError)],
      observations: ['observations.json', observations],
    };
    for (const [kind, [name, value]] of Object.entries(raw)) {
      await saveJson(resolve(folder, name), value);
      item.paths[kind] = attemptId + '/' + name;
    }
    await page.screenshot({ path: resolve(folder, 'screenshot.png'), type: 'png', fullPage: false });
    item.paths.screenshot = attemptId + '/screenshot.png';
    if (lhr.runtimeError) item.failures.push('LIGHTHOUSE_RUNTIME_ERROR');
    if (lhr.lighthouseVersion !== EXPECTED.lighthouse) item.failures.push('LIGHTHOUSE_VERSION_MISMATCH');
    if (observation.actualViewport.width !== profile.width || observation.actualViewport.height !== profile.height
      || observation.actualViewport.deviceScaleFactor !== profile.deviceScaleFactor) item.failures.push('ACTUAL_VIEWPORT_MISMATCH');
    if (safeUrl(page.url()) !== CANONICAL || !observation.initialDocumentQaExcluded) item.failures.push('UNEXPECTED_NAVIGATION');
    if (errors.mainDocumentStatus !== 200) item.failures.push('MAIN_DOCUMENT_HTTP_ERROR');
    if (errors.pageErrors > 0 || errors.firstPartyHttpErrors > 0) item.failures.push('PAGE_FUNCTIONAL_ERROR');
    if (!observation.readiness?.controlsQualified) item.failures.push('CONTROLS_NOT_READY');
    if (!observation.readiness?.mapQualified || !observation.readiness?.naverSdkPresent) item.failures.push('NAVER_MAP_NOT_READY');
    if (observation.readiness?.initialSkeletonVisible) item.failures.push('INITIAL_SKELETON_STILL_VISIBLE');
    if (profile.width >= 1280 && !observation.readiness?.desktopPanelQualified) item.failures.push('DESKTOP_PANEL_NOT_READY');
    if (profile.width >= 1280 && observation.readiness?.desktopPanelAlertCount > 0) item.failures.push('DESKTOP_PANEL_DATA_ERROR');
    if (!(observation.navigation.responseStart > 0)) item.failures.push('NAVIGATION_TIMING_UNAVAILABLE');
    if (traceEndMs === null) item.failures.push('TRACE_BOUNDARY_UNAVAILABLE');
    for (const name of REQUIRED_AUDITS) {
      const audit = lhr.audits[name];
      if (!audit || audit.scoreDisplayMode === 'error' || audit.errorCode || finite(audit.numericValue) === null) {
        item.failures.push('REQUIRED_METRIC_UNAVAILABLE_' + name.replaceAll('-', '_').toUpperCase());
      }
    }
    item.status = item.failures.length ? 'invalid' : 'valid';
  };
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(fixedError('TRIAL_TIMEOUT')), TRIAL_TIMEOUT_MS);
    })]);
  } catch (error) {
    item.failures.push(failureCode(error));
    if (error.healthReadback) item.healthReadbackFailure = error.healthReadback;
    if (page && !item.paths.screenshot) {
      try {
        await page.screenshot({ path: resolve(folder, 'failure.png'), type: 'png', fullPage: false, timeout: 5000 });
        item.paths.screenshot = attemptId + '/failure.png';
      } catch { /* Absence is explicit; do not fabricate a screenshot. */ }
    }
  } finally {
    clearTimeout(timeout);
    if (browser) {
      const child = browser.process();
      let closeTimer;
      try { await Promise.race([browser.close(), new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(fixedError('BROWSER_CLOSE_TIMEOUT')), 5000);
      })]); }
      catch { if (child?.pid) child.kill('SIGKILL'); }
      finally { clearTimeout(closeTimer); }
    }
    // Only this function's newly-created, unshared temporary browser profile.
    await rm(profileRoot, { recursive: true, force: true });
    item.endedAt = new Date().toISOString();
    item.failures = [...new Set(item.failures)];
    await saveJson(resolve(folder, 'trial.json'), item);
  }
  process.stdout.write(JSON.stringify({ attemptId, status: item.status, failures: item.failures }) + '\n');
  return item;
}

function parseArgs(values) {
  const args = {};
  const names = new Set(['--phase', '--source-sha', '--deployment-id', '--output']);
  if (values.length !== 8) throw fixedError('ARGUMENTS_INVALID');
  for (let i = 0; i < values.length; i += 2) {
    if (!names.has(values[i]) || args[values[i]] || !values[i + 1]) throw fixedError('ARGUMENTS_INVALID');
    args[values[i]] = values[i + 1];
  }
  if (!['before', 'after'].includes(args['--phase']) || !/^[a-f0-9]{40}$/.test(args['--source-sha'])
    || !/^dpl_[A-Za-z0-9]{10,80}$/.test(args['--deployment-id'])) throw fixedError('ARGUMENTS_INVALID');
  const output = resolve(args['--output']);
  const path = relative(HERE, output);
  if (!path || path.startsWith('..') || isAbsolute(path) || !path.split(sep).every(part => /^[a-zA-Z0-9_-]+$/.test(part))) {
    throw fixedError('OUTPUT_PATH_INVALID');
  }
  return { phase: args['--phase'], sourceSha: args['--source-sha'], deploymentId: args['--deployment-id'], output };
}

const TARGET_REF = 'perf/initial-load-20261114';
const TARGET_PATH = 'apps/web/performance/initial-load-20261114/after-target.json';
const TARGET_KEYS = ['schemaVersion', 'runId', 'runAttempt', 'baselineSourceSha', 'baselineDeploymentId',
  'afterSourceSha', 'afterDeploymentId', 'canonicalUrl', 'protocolSha256', 'collectorSha256'].sort();

function ownedPath(value) {
  const result = resolve(value);
  const path = relative(HERE, result);
  if (!path || path.startsWith('..') || isAbsolute(path)) throw fixedError('EVIDENCE_PATH_INVALID');
  return result;
}

async function readPublicJson(url, { allowMissing = false } = {}) {
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'User-Agent': 'tzudong-public-performance-audit' } });
  } catch { throw fixedError('PUBLIC_READBACK_UNAVAILABLE'); }
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw fixedError('PUBLIC_READBACK_HTTP_' + response.status);
  if (Number(response.headers.get('content-length') ?? 0) > 131_072) throw fixedError('PUBLIC_READBACK_SIZE_LIMIT');
  const text = await response.text();
  if (text.length > 131_072) throw fixedError('PUBLIC_READBACK_SIZE_LIMIT');
  try { return JSON.parse(text); } catch { throw fixedError('PUBLIC_READBACK_INVALID'); }
}

// A retained GH job can wait for a concrete root-owned release target. This does
// not deploy, mutate settings, update the checkout or discover credentials.
// The target is data: all values are identity-checked; none becomes shell code.
export async function waitForAfter(argv) {
  const options = {};
  const accepted = new Set(['--target-ref', '--run-id', '--baseline-run', '--output']);
  if (argv.length !== 8) throw fixedError('WAIT_ARGUMENTS_INVALID');
  for (let i = 0; i < argv.length; i += 2) {
    if (!accepted.has(argv[i]) || options[argv[i]]) throw fixedError('WAIT_ARGUMENTS_INVALID');
    options[argv[i]] = argv[i + 1];
  }
  if (options['--target-ref'] !== TARGET_REF || !/^[0-9]{1,24}$/.test(options['--run-id'])
    || options['--run-id'] !== process.env.GITHUB_RUN_ID) throw fixedError('WAIT_IDENTITY_INVALID');
  const output = ownedPath(options['--output']);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const before = JSON.parse(await readFile(ownedPath(options['--baseline-run']), 'utf8'));
  const receipt = { schemaVersion: 'initial-load-after-target-receipt.v1',
    startedAt: new Date().toISOString(), endedAt: null, status: 'invalid',
    runId: options['--run-id'], runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    targetRef: TARGET_REF, targetPath: TARGET_PATH,
    pollingIntervalMs: 30_000, maximumWaitMs: 75 * 60_000, polls: 0, failures: [] };
  try {
    if (before.status !== 'valid' || before.phase !== 'before' || before.trials?.length !== 15
      || before.environment?.runner?.runId !== receipt.runId
      || before.environment?.runner?.runAttempt !== process.env.GITHUB_RUN_ATTEMPT) {
      throw fixedError('BASELINE_NOT_VALID_IN_THIS_JOB');
    }
    const unchangedHarness = async () => {
      if (sha(await readFile(resolve(HERE, 'protocol.json'))) !== before.protocolSha256
        || sha(await readFile(fileURLToPath(import.meta.url))) !== before.collectorSha256
        || sha(await readFile(resolve(HERE, 'tools/package-lock.json'))) !== before.toolLockSha256) {
        throw fixedError('MEASUREMENT_HARNESS_CHANGED');
      }
    };
    await unchangedHarness();
    const protocol = JSON.parse(await readFile(resolve(HERE, 'protocol.json'), 'utf8'));
    const tools = await loadTools(protocol);
    const deadline = Date.now() + receipt.maximumWaitMs;
    const targetUrl = 'https://raw.githubusercontent.com/twoimo/tzudong/refs/heads/' + TARGET_REF + '/' + TARGET_PATH;
    let target;
    while (Date.now() < deadline) {
      receipt.polls++;
      if (!target) {
        const value = await readPublicJson(targetUrl, { allowMissing: true });
        // An old run's target is never authorization for this run.
        if (value && value.runId === receipt.runId && value.runAttempt === receipt.runAttempt) {
          if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(TARGET_KEYS)
            || value.schemaVersion !== 'initial-load-after-target.v1'
            || value.baselineSourceSha !== before.sourceSha
            || value.baselineDeploymentId !== before.deploymentId
            || value.canonicalUrl !== CANONICAL
            || value.protocolSha256 !== before.protocolSha256
            || value.collectorSha256 !== before.collectorSha256
            || !/^[a-f0-9]{40}$/.test(value.afterSourceSha)
            || value.afterSourceSha === before.sourceSha
            || !/^dpl_[A-Za-z0-9]{10,80}$/.test(value.afterDeploymentId)
            || value.afterDeploymentId === before.deploymentId) {
            throw fixedError('AFTER_TARGET_IDENTITY_INVALID');
          }
          target = value;
          receipt.target = target;
          await saveJson(resolve(output, 'target.json'), target);
        }
      }
      if (target) {
        const health = await publicBrowserHealth(tools);
        if (health?.ok === true && health.gitSha === target.afterSourceSha
          && health.deploymentId === target.afterDeploymentId) {
          // Two public reads, no token. An unknown/unprotected/mismatched main
          // is a blocker, never a reason to silently measure another release.
          const branch = await readPublicJson('https://api.github.com/repos/twoimo/tzudong/branches/main');
          if (branch?.protected !== true || branch.commit?.sha !== target.afterSourceSha) {
            throw fixedError('AFTER_TARGET_NOT_PROTECTED_MAIN');
          }
          const commit = await readPublicJson('https://api.github.com/repos/twoimo/tzudong/git/commits/' + target.afterSourceSha);
          if (commit?.sha !== target.afterSourceSha || !/^[a-f0-9]{40}$/.test(commit.tree?.sha ?? '')) {
            throw fixedError('AFTER_SOURCE_TREE_UNVERIFIED');
          }
          // Fetch this one approved public SHA's objects, without checkout,
          // reset, changing files, credentials, or following a mutable ref.
          try {
            execFileSync('git', ['fetch', '--no-tags', '--filter=blob:none',
              'https://github.com/twoimo/tzudong.git', target.afterSourceSha], {
              cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            });
          } catch { throw fixedError('AFTER_SOURCE_FETCH_FAILED'); }
          const tree = execFileSync('git', ['rev-parse', target.afterSourceSha + '^{tree}'], {
            cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
          }).trim();
          if (tree !== commit.tree.sha) throw fixedError('AFTER_SOURCE_TREE_MISMATCH');
          await unchangedHarness();
          const projectedHealth = await deploymentReadback(tools, target.afterSourceSha, target.afterDeploymentId);
          receipt.sourceSha = target.afterSourceSha;
          receipt.sourceTreeSha = tree;
          receipt.deploymentId = target.afterDeploymentId;
          receipt.mainReadback = { sha: branch.commit.sha, protected: true };
          receipt.health = projectedHealth;
          receipt.protocolSha256 = before.protocolSha256;
          receipt.collectorSha256 = before.collectorSha256;
          receipt.status = 'valid';
          break;
        }
        if (health?.ok === true && (health.gitSha !== before.sourceSha || health.deploymentId !== before.deploymentId)) {
          throw fixedError('UNEXPECTED_PRODUCTION_RELEASE');
        }
      }
      process.stdout.write(JSON.stringify({ status: 'waiting', poll: receipt.polls, targetDeclared: Boolean(target) }) + '\n');
      await new Promise(resolveWait => setTimeout(resolveWait, Math.min(30_000, Math.max(0, deadline - Date.now()))));
    }
    if (receipt.status !== 'valid') throw fixedError('AFTER_TARGET_WAIT_EXPIRED');
  } catch (error) {
    receipt.failures.push(failureCode(error));
    if (error.healthReadback) receipt.healthReadbackFailure = error.healthReadback;
  } finally {
    receipt.endedAt = new Date().toISOString();
    await saveJson(resolve(output, 'target-receipt.json'), receipt);
    process.stdout.write(JSON.stringify({ status: receipt.status, polls: receipt.polls, failures: receipt.failures }) + '\n');
  }
  if (receipt.status !== 'valid') process.exitCode = 1;
  return receipt;
}

async function collectDeclaredAfter(argv) {
  if (argv.length !== 4 || argv[0] !== '--target-receipt' || argv[2] !== '--output') throw fixedError('AFTER_ARGUMENTS_INVALID');
  const receipt = JSON.parse(await readFile(ownedPath(argv[1]), 'utf8'));
  if (receipt.schemaVersion !== 'initial-load-after-target-receipt.v1'
    || receipt.status !== 'valid' || receipt.runId !== process.env.GITHUB_RUN_ID
    || receipt.runAttempt !== process.env.GITHUB_RUN_ATTEMPT
    || receipt.mainReadback?.sha !== receipt.sourceSha || receipt.mainReadback?.protected !== true
    || receipt.protocolSha256 !== sha(await readFile(resolve(HERE, 'protocol.json')))
    || receipt.collectorSha256 !== sha(await readFile(fileURLToPath(import.meta.url)))) {
    throw fixedError('AFTER_RECEIPT_INVALID');
  }
  return main(['--phase', 'after', '--source-sha', receipt.sourceSha,
    '--deployment-id', receipt.deploymentId, '--output', argv[3]]);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  // Never replace an earlier failed or successful run.
  await mkdir(dirname(args.output), { recursive: true });
  await mkdir(args.output);
  const run = { schemaVersion: 'initial-load-run.v1', phase: args.phase,
    startedAt: new Date().toISOString(), endedAt: null, status: 'invalid',
    sourceSha: args.sourceSha, sourceTreeSha: null, deploymentId: args.deploymentId,
    canonicalUrl: CANONICAL, url: URL_TO_AUDIT, pins: EXPECTED, trials: [], failures: [],
    browserLaunch: browserLaunchPolicy(true),
    environment: {
      nodeVersion: process.version, platform: platform(), arch: arch(),
      cpuModels: [...new Set(cpus().map(cpu => safeText(cpu.model)))],
      logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
      runner: { os: safeText(process.env.RUNNER_OS), arch: safeText(process.env.RUNNER_ARCH),
        environment: safeText(process.env.RUNNER_ENVIRONMENT),
        runId: safeText(process.env.GITHUB_RUN_ID), runAttempt: safeText(process.env.GITHUB_RUN_ATTEMPT) },
    },
  };
  try {
    const protocolBytes = await readFile(resolve(HERE, 'protocol.json'));
    const protocol = JSON.parse(protocolBytes);
    run.protocolSha256 = sha(protocolBytes);
    run.collectorSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
    if (protocol.url !== CANONICAL || protocol.sampling.validRunsPerViewportAndPhase !== 5
      || protocol.sampling.concurrentRuns !== 1 || protocol.profiles.length !== 3) throw fixedError('PROTOCOL_MISMATCH');
    if (args.phase === 'before' && args.sourceSha !== protocol.baselineSourceSha) throw fixedError('BASELINE_SOURCE_MISMATCH');
    run.sourceTreeSha = execFileSync('git', ['rev-parse', args.sourceSha + '^{tree}'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(run.sourceTreeSha)) throw fixedError('SOURCE_TREE_UNAVAILABLE');
    run.harnessSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    }).trim();
    const tools = await loadTools(protocol);
    run.toolLockSha256 = tools.toolLockSha256;
    run.appLockSha256 = sha(await readFile(resolve(REPO, 'apps/web/package-lock.json')));
    run.browserContractSha256 = sha(await readFile(resolve(REPO, '.github/chrome-for-testing.v1.json')));
    run.puppeteerVersion = tools.puppeteerVersion;
    run.browserExecutable = tools.executable;
    await saveJson(resolve(args.output, 'deployment-before.json'), await deploymentReadback(tools, args.sourceSha, args.deploymentId));
    run.deploymentEvidence = { before: 'deployment-before.json' };
    for (const profile of protocol.profiles) {
      for (let index = 1; index <= 5; index++) {
        const result = await trial({ tools, protocol, profile, index, args, sourceTreeSha: run.sourceTreeSha, output: args.output });
        run.trials.push(result);
        if (result.browserLaunch?.noSandboxObserved !== null) run.browserLaunch = result.browserLaunch;
        // A deployment change invalidates the phase; never compare mixed code.
        if (result.failures.includes('DEPLOYMENT_IDENTITY_MISMATCH')) throw fixedError('DEPLOYMENT_CHANGED_DURING_PHASE');
        if (result.failures.some(code => code.startsWith('HEALTH_READBACK_') || code.startsWith('HEALTH_BROWSER_'))) {
          throw fixedError('PUBLIC_HEALTH_BROWSER_BLOCKED');
        }
        if (result.failures.some(code => ['BROWSER_RUNTIME_VERSION_MISMATCH', 'BROWSER_LAUNCH_POLICY_MISMATCH', 'ACTUAL_VIEWPORT_MISMATCH',
          'LIGHTHOUSE_VERSION_MISMATCH', 'LIGHTHOUSE_RESULT_UNAVAILABLE', 'LIGHTHOUSE_RUNTIME_ERROR',
          'UNEXPECTED_NAVIGATION', 'COLLECTION_FAILED', 'TRIAL_TIMEOUT',
          'SANITIZED_DETAILS_LIMIT', 'TRACE_EVENT_LIMIT', 'NETWORK_RECORD_LIMIT'].includes(code))) {
          throw fixedError('HARD_MEASUREMENT_FAILURE');
        }
      }
    }
    await saveJson(resolve(args.output, 'deployment-after.json'), await deploymentReadback(tools, args.sourceSha, args.deploymentId));
    run.deploymentEvidence.after = 'deployment-after.json';
    run.status = run.trials.length === 15 && run.trials.every(item => item.status === 'valid') ? 'valid' : 'invalid';
    if (run.status !== 'valid') run.failures.push('ONE_OR_MORE_TRIALS_INVALID');
  } catch (error) {
    run.failures.push(failureCode(error));
    if (error.healthReadback) run.healthReadbackFailure = error.healthReadback;
  } finally {
    run.endedAt = new Date().toISOString();
    await saveJson(resolve(args.output, 'run.json'), run);
    process.stdout.write(JSON.stringify({ phase: run.phase, status: run.status,
      attemptedTrials: run.trials.length, failures: run.failures }) + '\n');
  }
  if (run.status !== 'valid') process.exitCode = 1;
  return run;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const action = command === 'wait-for-after' ? waitForAfter(process.argv.slice(3))
    : command === 'collect-declared-after' ? collectDeclaredAfter(process.argv.slice(3))
      : main();
  action.catch(error => {
    process.stderr.write(JSON.stringify({ status: 'invalid', code: failureCode(error) }) + '\n');
    process.exitCode = 1;
  });
}
