import { createHash } from 'node:crypto';
import { assertPrivacySafe } from '../../../lib/privacy/sanitize.ts';

export const PINS = Object.freeze({ nodeMajor: 24, chrome: '156.0.8078.4', playwright: '1.64.1', lighthouse: '13.5.0' });
export const PROFILES = Object.freeze([
  { id: 'mobile', width: 390, height: 844, dpr: 2 },
  { id: 'tablet', width: 820, height: 1180, dpr: 2 },
  { id: 'tablet-landscape', width: 1024, height: 768, dpr: 2 },
].map(Object.freeze));
export const THROTTLING = Object.freeze({ rttMs: 150, throughputKbps: 1638.4,
  requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56,
  uploadThroughputKbps: 675, cpuSlowdownMultiplier: 4 });
export const MAX_RECEIPT_BYTES = 65_536;
export const ROUNDING_TOLERANCE_MS = 8;
export const SAMPLE_INTERVAL_MS = 100;
export const MAX_SAMPLE_GAP_MS = 300;
export const TRACE_NAMES = Object.freeze(['navigationStart', 'firstPaint', 'firstContentfulPaint', 'largestContentfulPaint::Candidate']);
export const RECEIPT_VERSION = 'local-environment-preflight.v2';
export const FAILURE_VERSION = 'local-environment-preflight.failure.v2';
export const SOURCE_KEYS = Object.freeze(['preflight', 'evidence', 'browserContract', 'appLock', 'lighthouseLock', 'fixture']);
export const SERIALIZATION_FAILURES = Object.freeze(['RECEIPT_SHAPE_INVALID', 'RECEIPT_SIZE_LIMIT',
  'PRIVACY_VALIDATION_FAILED', 'RECEIPT_SERIALIZATION_FAILED']);
export const FAILURE_CODES = Object.freeze([
  'LOCAL_PREFLIGHT_FAILED', 'LOCAL_PROFILE_FAILED', 'LOCAL_PROFILE_STOPPED', 'LOCAL_PROFILE_TIMEOUT',
  'PROFILE_CLEANUP_UNCONFIRMED', 'PROFILE_WORK_DRAIN_TIMEOUT', 'PROFILE_WORK_DRAIN_FAILED', 'OWNED_PROFILE_CLEANUP_FAILED',
  'NODE_PIN_MISMATCH', 'PLAYWRIGHT_PIN_UNAVAILABLE', 'CHROME_CONTRACT_MISMATCH', 'PLAYWRIGHT_VERSION_MISMATCH',
  'CHROME_EXECUTABLE_UNVERIFIED', 'CHROME_EXECUTABLE_UNAVAILABLE', 'TOOL_PATH_UNVERIFIED', 'TOOL_LOCK_MISMATCH',
  'LIGHTHOUSE_PIN_MISMATCH', 'CHROME_PRODUCT_UNAVAILABLE', 'CHROME_PRODUCT_MISMATCH',
  'BROWSER_CLOSE_TIMEOUT', 'CDP_DISCONNECT_TIMEOUT', 'BROWSER_TARGET_AMBIGUOUS', 'BROWSER_ARGUMENTS_UNAVAILABLE',
  'OWNED_DEBUG_ENDPOINT_UNAVAILABLE', 'LIGHTHOUSE_RESULT_UNAVAILABLE', 'CDP_DISCONNECT_FAILED', 'BROWSER_CLOSE_FAILED',
  'FIXTURE_CLOSE_TIMEOUT', 'FIXTURE_CLOSE_FAILED', 'RECEIPT_VALIDATION_FAILED', 'SOURCE_DIGEST_MISMATCH',
  'PROFILE_SHAPE_INVALID', 'PROFILE_NOT_PASSED', 'BROWSER_POLICY_UNVERIFIED', 'PROFILE_OWNERSHIP_UNVERIFIED',
  'CDP_CONTROL_UNACKNOWLEDGED', 'CDP_CONTROL_REQUEST_MISMATCH', 'FIXTURE_REQUEST_POLICY_FAILED', 'NAVIGATION_UNVERIFIED',
  'OBSERVER_UNVERIFIED', 'LIGHTHOUSE_IDENTITY_INVALID', 'LIGHTHOUSE_SETTINGS_MISMATCH', 'TRACE_TIME_ORIGIN_INVALID',
  'TRACE_METRIC_NORMALIZATION_INVALID', 'LIGHTHOUSE_PAINT_ORDER_INVALID', 'VIEWPORT_ANCHOR_MISSING',
  'TIMED_SAMPLE_COVERAGE_INCOMPLETE', 'TIMED_VIEWPORT_MISMATCH', 'TIMED_FOREGROUND_UNVERIFIED', 'OBSERVER_CAP_EXCEEDED',
  'INDEPENDENT_PAINT_MISMATCH_OR_MISSING', 'FRAME_CALLBACKS_UNAVAILABLE', 'TRACE_UNAVAILABLE', 'TRACE_EVENT_UNCORROBORATED',
  'TIMED_SCREENSHOT_UNAVAILABLE', 'RETAINED_FAILURE', 'SOURCE_UNVERIFIED', 'RECEIPT_PROJECTION_NOT_RETAINED',
  ...SERIALIZATION_FAILURES,
]);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
// Used only for the fixed public source bytes, owned fixture and its screenshot.
// This is a SHA-256 digest representation, never an encoding of arbitrary text.
export const sha256Bytes = value => [...createHash('sha256').update(value).digest()];
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const numeric = value => finite(value) ? value : null;
const positive = value => finite(value) && value > 0;
const near = (a, b, tolerance = ROUNDING_TOLERANCE_MS) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const sameViewport = (actual, profile) => actual?.width === profile.width && actual?.height === profile.height && actual?.dpr === profile.dpr;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'); });
const list = (value, cap, predicate) => Array.isArray(value) && value.length <= cap
  && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every(descriptor => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && predicate(descriptor.value));
export const digestShape = value => list(value, 32, byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) && value.length === 32;
const sourceShape = value => exactKeys(value, SOURCE_KEYS) && Object.values(value).every(digestShape);
const codeList = value => list(value, 64, code => FAILURE_CODES.includes(code));
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const numericRecord = (value, keys) => exactKeys(value, keys) && Object.values(value).every(item => item === null || finite(item));
const booleanRecord = (value, keys) => exactKeys(value, keys) && Object.values(value).every(item => typeof item === 'boolean');
const numericList = (values, keys, cap) => list(values, cap, value => numericRecord(value, keys));

function profileShape(row) {
  if (!exactKeys(row, ['id', 'status', 'failureCodes', 'freshOwnedProfile', 'profileCleaned', 'launch', 'controls',
    'requests', 'observation', 'lighthouse', 'trace', 'screenshot']) || !PROFILES.some(profile => profile.id === row.id)
    || !['passed', 'failed'].includes(row.status) || !codeList(row.failureCodes)
    || typeof row.freshOwnedProfile !== 'boolean' || typeof row.profileCleaned !== 'boolean') return false;
  const section = (value, check) => value === null ? row.status === 'failed' : check(value);
  return section(row.launch, value => booleanRecord(value, ['chromiumSandboxRequested', 'disableSandboxFlagObserved',
    'automationFlagObserved', 'versionVerified', 'mobileLayoutRequested', 'hasTouch']))
    && section(row.controls, value => exactKeys(value, ['cpuSlowdownRequested', 'latencyMsRequested', 'downloadBytesPerSecondRequested',
      'uploadBytesPerSecondRequested', 'cpuAcknowledged', 'networkAcknowledged', 'cacheDisabledAcknowledged', 'serviceWorkerBypassAcknowledged'])
      && Object.entries(value).every(([key, item]) => key.endsWith('Acknowledged') ? typeof item === 'boolean' : finite(item)))
    && section(row.requests, value => numericRecord(value, ['blockedHttp', 'blockedWebSocket', 'failed', 'documentStatus',
      'documentCount', 'heroCount', 'cachedResponseCount'])
      && Object.entries(value).every(([key, item]) => key === 'documentStatus' ? item === null || count(item) : count(item)))
    && section(row.observation, observation => exactKeys(observation, ['samplingIntervalMs', 'samples', 'paints', 'lcp', 'frames', 'capReached', 'observerErrors',
      'paintObserver', 'lcpObserver', 'stopped', 'navigation', 'paintTimeline'])
      && finite(observation.samplingIntervalMs) && count(observation.observerErrors)
      && ['capReached', 'paintObserver', 'lcpObserver', 'stopped'].every(key => typeof observation[key] === 'boolean')
      && exactKeys(observation.navigation, ['type', 'startTime', 'requestStart', 'responseStart', 'responseEnd', 'redirectCount'])
      && ['navigate', 'other'].includes(observation.navigation.type)
      && Object.entries(observation.navigation).every(([key, value]) => key === 'type' || value === null || finite(value))
      && list(observation.samples, 600, value => exactKeys(value, ['atMs', 'width', 'height', 'dpr', 'visible', 'focused'])
        && [value.atMs, value.width, value.height, value.dpr].every(finite) && typeof value.visible === 'boolean' && typeof value.focused === 'boolean')
      && list(observation.paints, 16, value => exactKeys(value, ['name', 'startTimeMs', 'receivedAtMs'])
        && ['first-paint', 'first-contentful-paint'].includes(value.name) && finite(value.startTimeMs) && finite(value.receivedAtMs))
      && list(observation.paintTimeline, 8, value => exactKeys(value, ['name', 'startTimeMs'])
        && ['first-paint', 'first-contentful-paint'].includes(value.name) && finite(value.startTimeMs))
      && numericList(observation.lcp, ['startTimeMs', 'receivedAtMs'], 24)
      && numericList(observation.frames, ['requestedAtMs', 'callbackAtMs', 'frameTimestampMs'], 80))
    && section(row.lighthouse, lhr => {
      if (!exactKeys(lhr, ['version', 'runtimeError', 'fixtureUrlMatched', 'settings', 'metrics', 'fcpAuditMs', 'lcpAuditMs'])) return false;
      const settings = lhr.settings;
      return [PINS.lighthouse, 'mismatch'].includes(lhr.version) && typeof lhr.runtimeError === 'boolean'
        && typeof lhr.fixtureUrlMatched === 'boolean' && [lhr.fcpAuditMs, lhr.lcpAuditMs].every(value => value === null || finite(value))
        && exactKeys(settings, ['formFactor', 'mobileLayoutReported', 'throttlingMethod', 'emulatedUserAgent', 'disableStorageReset', 'viewport', 'throttling'])
        && ['desktop', 'other'].includes(settings.formFactor) && ['devtools', 'other'].includes(settings.throttlingMethod)
        && typeof settings.emulatedUserAgent === 'boolean'
        && ['mobileLayoutReported', 'disableStorageReset'].every(key => settings[key] === null || typeof settings[key] === 'boolean')
        && numericRecord(settings.viewport, ['width', 'height', 'dpr']) && numericRecord(settings.throttling, Object.keys(THROTTLING))
        && numericRecord(lhr.metrics, ['originTs', 'navigationTs', 'fpMs', 'fpTs', 'fcpMs', 'fcpTs', 'lcpMs', 'lcpTs', 'endMs', 'endTs']);
    })
    && section(row.trace, value => exactKeys(value, ['present', 'originalCount', 'capReached', 'events'])
      && typeof value.present === 'boolean' && typeof value.capReached === 'boolean'
      && list(value.events, 128, event => exactKeys(event, ['name', 'ts', 'normalizedMs'])
        && TRACE_NAMES.includes(event.name) && finite(event.ts) && finite(event.normalizedMs))
      && count(value.originalCount) && value.originalCount >= value.events.length)
    && section(row.screenshot, value => exactKeys(value, ['source', 'bytes', 'sha256Bytes', 'timingMs', 'width', 'height'])
      && value.source === 'lighthouse-final-screenshot' && count(value.bytes) && digestShape(value.sha256Bytes)
      && [value.timingMs, value.width, value.height].every(item => item === null || finite(item)));
}

// Same bounded duplicate-key scan used by the retained calibration recorder.
// JSON.parse validates syntax first; this scan also checks escaped key aliases.
export function parseStrictJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text); const stack = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      const start = i++;
      while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i] === '"') break; else i++; }
      const container = stack.at(-1);
      if (container?.object && container.expectsKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (container.keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('JSON_KEY_REJECTED');
        container.keys.add(key); container.expectsKey = false;
      }
    } else if (character === '{' || character === '[') stack.push({ object: character === '{', expectsKey: character === '{', keys: new Set() });
    else if (character === '}' || character === ']') stack.pop();
    else if (character === ',' && stack.at(-1)?.object) stack.at(-1).expectsKey = true;
  }
  return value;
}

// Only these exact page-request URLs are permitted. No caller-selected target.
export function allowedFixtureRequest(value, method, origin) {
  if (!['GET', 'HEAD'].includes(method)) return false;
  try {
    const base = new URL(origin); const url = new URL(value);
    return base.protocol === 'http:' && base.hostname === '127.0.0.1' && Boolean(base.port)
      && url.origin === base.origin && !url.username && !url.password && !url.search && !url.hash
      && ['/fixture', '/hero.svg', '/favicon.ico'].includes(url.pathname);
  } catch { return false; }
}

export function parseArguments(argv) {
  if (!argv.length || (argv.length === 1 && argv[0] === '--help')) return { mode: 'help' };
  if (argv.length === 3 && argv[0] === '--run-local' && argv[1] === '--output' && argv[2]) return { mode: 'run', output: argv[2] };
  if (argv.length === 4 && argv[0] === '--verify' && argv[1] && argv[2] === '--sha256' && /^[a-f0-9]{64}$/.test(argv[3])) {
    return { mode: 'verify', file: argv[1], expectedHash: argv[3] };
  }
  throw new Error('ARGUMENTS_INVALID');
}

export function projectTrace(trace, metrics) {
  const events = trace?.traceEvents;
  if (!Array.isArray(events)) return { present: false, originalCount: 0, capReached: false, events: [] };
  const result = { present: true, originalCount: events.length, capReached: false, events: [] };
  for (const event of events) {
    if (!TRACE_NAMES.includes(event.name) || !finite(event.ts) || !finite(metrics.originTs)
      || event.ts < metrics.originTs - 1000 || event.ts > metrics.endTs + 1000) continue;
    if (result.events.length >= 128) { result.capReached = true; break; }
    result.events.push({ name: event.name, ts: event.ts, normalizedMs: (event.ts - metrics.originTs) / 1000 });
  }
  return result;
}

// This validates one local capability observation, not performance budgets.
export function profileProblems(row) {
  const problems = [];
  const add = (condition, code) => { if (!condition) problems.push(code); };
  const profile = PROFILES.find(value => value.id === row?.id);
  if (!profile || !row || typeof row !== 'object') return ['PROFILE_SHAPE_INVALID'];
  if (row.status !== 'passed') return ['PROFILE_NOT_PASSED'];
  if (!profileShape(row)) return ['PROFILE_SHAPE_INVALID'];
  const launch = row.launch ?? {}; const controls = row.controls ?? {};
  add(launch.chromiumSandboxRequested === true && launch.disableSandboxFlagObserved === false
    && launch.automationFlagObserved === true && launch.versionVerified === true
    && launch.mobileLayoutRequested === false && launch.hasTouch === false, 'BROWSER_POLICY_UNVERIFIED');
  add(row.freshOwnedProfile === true && row.profileCleaned === true, 'PROFILE_OWNERSHIP_UNVERIFIED');
  add(controls.cpuAcknowledged === true && controls.networkAcknowledged === true
    && controls.cacheDisabledAcknowledged === true && controls.serviceWorkerBypassAcknowledged === true,
  'CDP_CONTROL_UNACKNOWLEDGED');
  add(controls.cpuSlowdownRequested === THROTTLING.cpuSlowdownMultiplier
    && controls.latencyMsRequested === THROTTLING.requestLatencyMs
    && controls.downloadBytesPerSecondRequested === Math.floor(THROTTLING.downloadThroughputKbps * 1024 / 8)
    && controls.uploadBytesPerSecondRequested === Math.floor(THROTTLING.uploadThroughputKbps * 1024 / 8),
  'CDP_CONTROL_REQUEST_MISMATCH');
  const network = row.requests ?? {};
  add(network.blockedHttp === 0 && network.blockedWebSocket === 0 && network.failed === 0
    && network.documentStatus === 200 && network.documentCount === 1
    && network.heroCount === 1 && network.cachedResponseCount === 0, 'FIXTURE_REQUEST_POLICY_FAILED');
  const observed = row.observation ?? {}; const nav = observed.navigation ?? {};
  add(nav.type === 'navigate' && nav.redirectCount === 0 && nav.startTime === 0
    && positive(nav.responseStart) && finite(nav.requestStart) && nav.requestStart <= nav.responseStart
    && nav.responseStart <= nav.responseEnd, 'NAVIGATION_UNVERIFIED');
  add(observed.stopped === true && observed.paintObserver === true && observed.lcpObserver === true
    && observed.observerErrors === 0 && observed.capReached === false, 'OBSERVER_UNVERIFIED');
  const lhr = row.lighthouse ?? {}; const metrics = lhr.metrics ?? {};
  add(lhr.version === PINS.lighthouse && lhr.runtimeError === false && lhr.fixtureUrlMatched === true,
    'LIGHTHOUSE_IDENTITY_INVALID');
  add(lhr.settings?.throttlingMethod === 'devtools' && lhr.settings?.emulatedUserAgent === false
    && lhr.settings?.formFactor === 'desktop' && lhr.settings?.mobileLayoutReported === false
    && lhr.settings?.disableStorageReset === false && sameViewport(lhr.settings?.viewport, profile)
    && Object.entries(THROTTLING).every(([key, value]) => lhr.settings?.throttling?.[key] === value),
  'LIGHTHOUSE_SETTINGS_MISMATCH');
  add(positive(metrics.originTs) && near(metrics.originTs, metrics.navigationTs, 1000)
    && positive(metrics.endMs) && near((metrics.endTs - metrics.originTs) / 1000, metrics.endMs, 1),
  'TRACE_TIME_ORIGIN_INVALID');
  for (const [key, timestamp] of [['fpMs', 'fpTs'], ['fcpMs', 'fcpTs'], ['lcpMs', 'lcpTs']]) {
    add(positive(metrics[key]) && metrics[key] <= metrics.endMs
      && near((metrics[timestamp] - metrics.originTs) / 1000, metrics[key], 1), 'TRACE_METRIC_NORMALIZATION_INVALID');
  }
  add(metrics.fpMs <= metrics.fcpMs && metrics.fcpMs <= metrics.lcpMs
    && near(lhr.fcpAuditMs, metrics.fcpMs, 1) && near(lhr.lcpAuditMs, metrics.lcpMs, 1), 'LIGHTHOUSE_PAINT_ORDER_INVALID');
  const samples = Array.isArray(observed.samples) ? observed.samples : [];
  const timed = samples.filter(sample => finite(sample?.atMs) && sample.atMs <= metrics.endMs);
  const anchor = timed.filter(sample => sample.atMs <= metrics.fpMs).at(-1);
  const painted = timed.filter(sample => sample.atMs >= metrics.fpMs);
  add(Boolean(anchor) && painted.length > 0 && samples.length <= 600 && finite(samples[0]?.atMs)
    && samples[0].atMs >= 0 && samples[0].atMs <= metrics.fpMs
    && samples.every((sample, index) => finite(sample?.atMs) && sample.atMs >= 0
      && (index === 0 || sample.atMs >= samples[index - 1]?.atMs)), 'VIEWPORT_ANCHOR_MISSING');
  add(observed.samplingIntervalMs === SAMPLE_INTERVAL_MS && timed.length >= 2
    && timed.at(-1).atMs >= metrics.endMs - MAX_SAMPLE_GAP_MS
    && timed.every((sample, index) => index === 0 || sample.atMs - timed[index - 1].atMs <= MAX_SAMPLE_GAP_MS),
  'TIMED_SAMPLE_COVERAGE_INCOMPLETE');
  add(Boolean(anchor) && timed.every(sample => sameViewport(sample, profile)), 'TIMED_VIEWPORT_MISMATCH');
  add(Boolean(anchor) && timed.every(sample => sample.visible === true && sample.focused === true),
    'TIMED_FOREGROUND_UNVERIFIED');
  const paints = Array.isArray(observed.paints) ? observed.paints : [];
  const timeline = Array.isArray(observed.paintTimeline) ? observed.paintTimeline : [];
  const lcp = Array.isArray(observed.lcp) ? observed.lcp : [];
  add(paints.length <= 16 && timeline.length <= 8 && lcp.length <= 24, 'OBSERVER_CAP_EXCEEDED');
  const fp = paints.find(entry => entry?.name === 'first-paint' && finite(entry.startTimeMs) && entry.startTimeMs <= metrics.endMs);
  const fcp = paints.find(entry => entry?.name === 'first-contentful-paint' && finite(entry.startTimeMs) && entry.startTimeMs <= metrics.endMs);
  const timelineFcp = timeline.find(entry => entry?.name === 'first-contentful-paint' && finite(entry.startTimeMs) && entry.startTimeMs <= metrics.endMs);
  const lastLcp = lcp.filter(entry => finite(entry?.startTimeMs) && entry.startTimeMs <= metrics.endMs).at(-1);
  add(near(fp?.startTimeMs, metrics.fpMs) && near(fcp?.startTimeMs, metrics.fcpMs)
    && near(timelineFcp?.startTimeMs, fcp?.startTimeMs) && near(lastLcp?.startTimeMs, metrics.lcpMs),
  'INDEPENDENT_PAINT_MISMATCH_OR_MISSING');
  const frames = Array.isArray(observed.frames) ? observed.frames : [];
  add(frames.length <= 80 && frames.filter(frame => finite(frame?.callbackAtMs) && frame.callbackAtMs <= metrics.endMs
    && frame.callbackAtMs >= frame.requestedAtMs).length >= 2, 'FRAME_CALLBACKS_UNAVAILABLE');
  const trace = row.trace ?? {};
  add(trace.present === true && trace.capReached === false && Array.isArray(trace.events), 'TRACE_UNAVAILABLE');
  const traceEvents = Array.isArray(trace.events) ? trace.events : [];
  for (const [name, timestamp] of [['navigationStart', 'navigationTs'], ['firstPaint', 'fpTs'],
    ['firstContentfulPaint', 'fcpTs'], ['largestContentfulPaint::Candidate', 'lcpTs']]) {
    add(traceEvents.some(event => event?.name === name && near(event.ts, metrics[timestamp], 1000)
      && near(event.normalizedMs, (event.ts - metrics.originTs) / 1000, 0.001)), 'TRACE_EVENT_UNCORROBORATED');
  }
  const screenshot = row.screenshot ?? {};
  add(screenshot.source === 'lighthouse-final-screenshot' && positive(screenshot.bytes)
    && screenshot.bytes <= 262144 && digestShape(screenshot.sha256Bytes)
    && finite(screenshot.timingMs) && screenshot.timingMs >= metrics.fpMs
    && screenshot.timingMs <= metrics.endMs && positive(screenshot.width) && positive(screenshot.height),
  'TIMED_SCREENSHOT_UNAVAILABLE');
  add(Array.isArray(row.failureCodes) && row.failureCodes.length === 0, 'RETAINED_FAILURE');
  return [...new Set(problems)];
}

function failureShape(receipt) {
  return exactKeys(receipt, ['schemaVersion', 'scope', 'status', 'sourceVerified', 'projectionsRetained',
    'productionTested', 'profiles', 'failureCodes'])
    && receipt.schemaVersion === FAILURE_VERSION && receipt.scope === 'synthetic-loopback-capability-only'
    && receipt.status === 'blocked-or-incomplete' && receipt.sourceVerified === false
    && receipt.projectionsRetained === false && receipt.productionTested === false
    && list(receipt.profiles, PROFILES.length, row => exactKeys(row, ['id', 'failed', 'projectionsRetained'])
      && PROFILES.some(profile => profile.id === row.id) && row.failed === true && row.projectionsRetained === false)
    && new Set(receipt.profiles.map(row => row.id)).size === receipt.profiles.length
    && codeList(receipt.failureCodes) && receipt.failureCodes.length === 3
    && SERIALIZATION_FAILURES.includes(receipt.failureCodes[0])
    && receipt.failureCodes[1] === 'SOURCE_UNVERIFIED' && receipt.failureCodes[2] === 'RECEIPT_PROJECTION_NOT_RETAINED';
}

// Shape/privacy admission is distinct from capability admission. Typed partial
// failures may be retained, but cannot pass receiptProblems/verifyReceiptBytes.
export function receiptShapeProblems(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return ['RECEIPT_INVALID'];
  if (receipt.schemaVersion === FAILURE_VERSION) return failureShape(receipt) ? [] : ['FAILURE_ENVELOPE_INVALID'];
  const problems = [];
  if (!exactKeys(receipt, ['schemaVersion', 'scope', 'layoutSemantics', 'createdAtUtc', 'status', 'production', 'admissions',
    'improvementBudgets', 'toolchain', 'sourceDigests', 'profiles', 'failureCodes'])) return ['RECEIPT_KEYS_INVALID'];
  if (receipt.schemaVersion !== RECEIPT_VERSION || receipt.scope !== 'synthetic-loopback-capability-only') problems.push('SCOPE_INVALID');
  if (receipt.layoutSemantics !== 'desktop-css-viewport-resize-no-mobile-device-emulation') problems.push('LAYOUT_SEMANTICS_INVALID');
  if (typeof receipt.createdAtUtc !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.createdAtUtc)
    || !Number.isFinite(Date.parse(receipt.createdAtUtc))
    || new Date(receipt.createdAtUtc).toISOString() !== receipt.createdAtUtc) problems.push('CAPTURE_TIME_INVALID');
  if (!exactKeys(receipt.production, ['access', 'source', 'deployment'])
    || Object.values(receipt.production).some(value => value !== 'not-tested')) problems.push('PRODUCTION_CLAIM_FORBIDDEN');
  if (!exactKeys(receipt.admissions, ['productionPerformance', 'field', 'g003'])
    || Object.values(receipt.admissions).some(value => value !== 0)) problems.push('ADMISSION_FORBIDDEN');
  if (!exactKeys(receipt.improvementBudgets, ['absolute', 'relative', 'noise'])
    || Object.values(receipt.improvementBudgets).some(value => value !== null)) problems.push('IMPROVEMENT_CLAIM_FORBIDDEN');
  if (!['local-capabilities-observed', 'blocked-or-incomplete'].includes(receipt.status)) problems.push('RECEIPT_STATUS_INVALID');
  const tools = receipt.toolchain;
  if (tools !== null && (!exactKeys(tools, ['nodeMajor', 'nodeVersion', 'chrome', 'playwright', 'lighthouse', 'puppeteerVersion', 'puppeteerLockMatched'])
    || !count(tools.nodeMajor) || typeof tools.puppeteerLockMatched !== 'boolean'
    || !['nodeVersion', 'playwright', 'lighthouse', 'puppeteerVersion'].every(key => typeof tools[key] === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tools[key]))
    || typeof tools.chrome !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,5}\.\d{1,3}$/.test(tools.chrome))) problems.push('TOOLCHAIN_KEYS_INVALID');
  if (receipt.sourceDigests !== null && !sourceShape(receipt.sourceDigests)) problems.push('SOURCE_DIGESTS_INVALID');
  if (!list(receipt.profiles, PROFILES.length, row => row && typeof row === 'object')) problems.push('PROFILE_SET_INVALID');
  else for (const row of receipt.profiles) {
    if (!profileShape(row)) problems.push(`${PROFILES.find(profile => profile.id === row.id)?.id ?? 'unknown'}:PROFILE_SHAPE_INVALID`);
  }
  if (!codeList(receipt.failureCodes)) problems.push('FAILURE_CODES_INVALID');
  return [...new Set(problems)];
}

export function receiptProblems(receipt) {
  const shape = receiptShapeProblems(receipt);
  if (shape.length) return shape;
  if (receipt.schemaVersion === FAILURE_VERSION) return ['PREFLIGHT_NOT_PASSED', 'SOURCE_UNVERIFIED', 'RECEIPT_PROJECTION_NOT_RETAINED'];
  const problems = [];
  if (receipt.status !== 'local-capabilities-observed') problems.push('PREFLIGHT_NOT_PASSED');
  const tools = receipt.toolchain ?? {};
  if (tools.nodeMajor !== PINS.nodeMajor || tools.chrome !== PINS.chrome || tools.playwright !== PINS.playwright
    || !/^24\.\d+\.\d+$/.test(tools.nodeVersion ?? '') || !/^\d+\.\d+\.\d+$/.test(tools.puppeteerVersion ?? '')
    || tools.lighthouse !== PINS.lighthouse || tools.puppeteerLockMatched !== true) problems.push('TOOLCHAIN_UNVERIFIED');
  if (!sourceShape(receipt.sourceDigests)) problems.push('SOURCE_UNVERIFIED');
  if (receipt.profiles.length !== PROFILES.length) problems.push('PROFILE_SET_INCOMPLETE');
  else for (let i = 0; i < PROFILES.length; i++) {
    if (receipt.profiles[i]?.id !== PROFILES[i].id) problems.push('PROFILE_ORDER_INVALID');
    for (const code of profileProblems(receipt.profiles[i])) problems.push(`${PROFILES[i].id}:${code}`);
  }
  if (receipt.failureCodes.length) problems.push('RETAINED_FAILURE');
  return [...new Set(problems)];
}

export function sourceDigestProblems(recorded, actual) {
  if (!sourceShape(recorded) || !sourceShape(actual)) return ['SOURCE_DIGESTS_INVALID'];
  return SOURCE_KEYS.some(key => actual[key].some((byte, index) => byte !== recorded[key][index])) ? ['SOURCE_DIGEST_MISMATCH'] : [];
}

export function minimalFailureReceipt(receipt, code) {
  // Never copy failed metadata, tool output, failure messages or a digest here.
  // Only known profile IDs from a bounded data-property list survive rejection.
  const ids = new Set();
  try {
    const rows = Object.getOwnPropertyDescriptor(receipt ?? {}, 'profiles')?.value;
    if (Array.isArray(rows)) for (let index = 0; index < Math.min(rows.length, PROFILES.length); index++) {
      const row = Object.getOwnPropertyDescriptor(rows, String(index))?.value;
      const id = row && typeof row === 'object' ? Object.getOwnPropertyDescriptor(row, 'id')?.value : null;
      if (PROFILES.some(profile => profile.id === id)) ids.add(id);
    }
  } catch { ids.clear(); } // Invalid metadata cannot prevent the fixed failure record.
  return { schemaVersion: FAILURE_VERSION, scope: 'synthetic-loopback-capability-only', status: 'blocked-or-incomplete',
    sourceVerified: false, projectionsRetained: false, productionTested: false,
    profiles: PROFILES.filter(profile => ids.has(profile.id)).map(profile => ({ id: profile.id, failed: true, projectionsRetained: false })),
    failureCodes: [SERIALIZATION_FAILURES.includes(code) ? code : 'RECEIPT_SERIALIZATION_FAILED',
      'SOURCE_UNVERIFIED', 'RECEIPT_PROJECTION_NOT_RETAINED'] };
}

// Diagnostics are typed objects, not plain text. Validate every shape first,
// then screen every field in fixed small sections with the unchanged default
// object-guard limits. Record-by-record screening handles the bounded sampling
// arrays without raising maxEntries or omitting their tail. The 64 KiB serialized
// file limit remains separate and applies after this complete privacy pass.
export function assertReceiptPrivacy(receipt) {
  if (receiptShapeProblems(receipt).length) throw Object.assign(new Error('RECEIPT_SHAPE_INVALID'), { safeCode: 'RECEIPT_SHAPE_INVALID' });
  if (receipt.schemaVersion === FAILURE_VERSION) { assertPrivacySafe(receipt); return; }
  const { toolchain, sourceDigests, profiles, ...header } = receipt;
  assertPrivacySafe(header); assertPrivacySafe({ toolchain });
  if (sourceDigests === null) assertPrivacySafe({ sourceDigests });
  else for (const key of SOURCE_KEYS) assertPrivacySafe({ sourceDigests: { [key]: sourceDigests[key] } });
  assertPrivacySafe({ profiles: [] });
  for (const row of profiles) {
    const { launch, controls, requests, observation, lighthouse, trace, screenshot, ...identity } = row;
    assertPrivacySafe(identity); assertPrivacySafe({ launch }); assertPrivacySafe({ controls });
    assertPrivacySafe({ requests }); assertPrivacySafe({ lighthouse }); assertPrivacySafe({ screenshot });
    if (observation === null) assertPrivacySafe({ observation });
    else {
      const { samples, paints, lcp, frames, paintTimeline, ...state } = observation;
      assertPrivacySafe({ observation: state });
      for (const [key, entries] of Object.entries({ samples, paints, lcp, frames, paintTimeline })) {
        assertPrivacySafe({ [key]: [] });
        for (const entry of entries) assertPrivacySafe({ [key]: [entry] });
      }
    }
    if (trace === null) assertPrivacySafe({ trace });
    else {
      const { events, ...state } = trace; assertPrivacySafe({ trace: state }); assertPrivacySafe({ events: [] });
      for (const event of events) assertPrivacySafe({ events: [event] });
    }
  }
}

export function verifyReceiptBytes(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RECEIPT_BYTES) return { verified: false, failures: ['RECEIPT_SIZE_LIMIT'] };
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '') || sha256(bytes) !== expectedHash) return { verified: false, failures: ['RECEIPT_HASH_MISMATCH'] };
  let receipt;
  try { receipt = parseStrictJson(bytes); } catch { return { verified: false, failures: ['RECEIPT_INVALID_JSON'] }; }
  const shape = receiptShapeProblems(receipt);
  if (shape.length) return { verified: false, failures: shape };
  try { assertReceiptPrivacy(receipt); } catch { return { verified: false, failures: ['PRIVACY_VALIDATION_FAILED'] }; }
  const failures = receiptProblems(receipt);
  return { verified: failures.length === 0, scope: 'synthetic-loopback-capability-only', failures };
}
