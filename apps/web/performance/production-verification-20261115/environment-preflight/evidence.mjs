import { createHash } from 'node:crypto';

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
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const numeric = value => finite(value) ? value : null;
const positive = value => finite(value) && value > 0;
const near = (a, b, tolerance = ROUNDING_TOLERANCE_MS) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const sameViewport = (actual, profile) => actual?.width === profile.width && actual?.height === profile.height && actual?.dpr === profile.dpr;
const fixed = value => /^[A-Z][A-Z0-9_]{2,79}$/.test(value ?? '');
const exactKeys = (value, keys) => value && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const numericRecord = (value, keys) => exactKeys(value, keys) && Object.values(value).every(item => item === null || finite(item));
const booleanRecord = (value, keys) => exactKeys(value, keys) && Object.values(value).every(item => typeof item === 'boolean');
const numericList = (values, keys, cap) => Array.isArray(values) && values.length <= cap && values.every(value => numericRecord(value, keys));

function profileShape(row) {
  const observation = row?.observation; const lhr = row?.lighthouse; const settings = lhr?.settings;
  return exactKeys(row, ['id', 'status', 'failureCodes', 'freshOwnedProfile', 'profileCleaned', 'launch', 'controls',
    'requests', 'observation', 'lighthouse', 'trace', 'screenshot'])
    && booleanRecord(row.launch, ['chromiumSandboxRequested', 'disableSandboxFlagObserved', 'automationFlagObserved',
      'versionVerified', 'isMobile', 'hasTouch'])
    && exactKeys(row.controls, ['cpuSlowdownRequested', 'latencyMsRequested', 'downloadBytesPerSecondRequested',
      'uploadBytesPerSecondRequested', 'cpuAcknowledged', 'networkAcknowledged', 'cacheDisabledAcknowledged', 'serviceWorkerBypassAcknowledged'])
    && Object.entries(row.controls).every(([key, value]) => key.endsWith('Acknowledged') ? typeof value === 'boolean' : finite(value))
    && numericRecord(row.requests, ['blockedHttp', 'blockedWebSocket', 'failed', 'documentStatus', 'documentCount', 'heroCount', 'cachedResponseCount'])
    && exactKeys(observation, ['samplingIntervalMs', 'samples', 'paints', 'lcp', 'frames', 'capReached', 'observerErrors',
      'paintObserver', 'lcpObserver', 'stopped', 'navigation', 'paintTimeline'])
    && observation.stopped === true
    && exactKeys(observation.navigation, ['type', 'startTime', 'requestStart', 'responseStart', 'responseEnd', 'redirectCount'])
    && ['navigate', 'other'].includes(observation.navigation.type)
    && Object.entries(observation.navigation).every(([key, value]) => key === 'type' || value === null || finite(value))
    && Array.isArray(observation.samples) && observation.samples.length <= 600
    && observation.samples.every(value => exactKeys(value, ['atMs', 'width', 'height', 'dpr', 'visible', 'focused'])
      && [value.atMs, value.width, value.height, value.dpr].every(finite) && typeof value.visible === 'boolean' && typeof value.focused === 'boolean')
    && Array.isArray(observation.paints) && observation.paints.length <= 16
    && observation.paints.every(value => exactKeys(value, ['name', 'startTimeMs', 'receivedAtMs'])
      && ['first-paint', 'first-contentful-paint'].includes(value.name) && finite(value.startTimeMs) && finite(value.receivedAtMs))
    && Array.isArray(observation.paintTimeline) && observation.paintTimeline.length <= 8
    && observation.paintTimeline.every(value => exactKeys(value, ['name', 'startTimeMs'])
      && ['first-paint', 'first-contentful-paint'].includes(value.name) && finite(value.startTimeMs))
    && numericList(observation.lcp, ['startTimeMs', 'receivedAtMs'], 24)
    && numericList(observation.frames, ['requestedAtMs', 'callbackAtMs', 'frameTimestampMs'], 80)
    && exactKeys(lhr, ['version', 'runtimeError', 'fixtureUrlMatched', 'settings', 'metrics', 'fcpAuditMs', 'lcpAuditMs'])
    && exactKeys(settings, ['formFactor', 'mobile', 'throttlingMethod', 'emulatedUserAgent', 'disableStorageReset', 'viewport', 'throttling'])
    && numericRecord(settings.viewport, ['width', 'height', 'dpr']) && numericRecord(settings.throttling, Object.keys(THROTTLING))
    && numericRecord(lhr.metrics, ['originTs', 'navigationTs', 'fpMs', 'fpTs', 'fcpMs', 'fcpTs', 'lcpMs', 'lcpTs', 'endMs', 'endTs'])
    && exactKeys(row.trace, ['present', 'originalCount', 'capReached', 'events'])
    && Array.isArray(row.trace.events) && row.trace.events.length <= 128
    && Number.isSafeInteger(row.trace.originalCount) && row.trace.originalCount >= row.trace.events.length
    && row.trace.originalCount <= 1_000_000
    && row.trace.events.every(value => exactKeys(value, ['name', 'ts', 'normalizedMs'])
      && TRACE_NAMES.includes(value.name) && finite(value.ts) && finite(value.normalizedMs))
    && exactKeys(row.screenshot, ['source', 'bytes', 'sha256', 'timingMs', 'width', 'height']);
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
    && launch.isMobile === false && launch.hasTouch === false, 'BROWSER_POLICY_UNVERIFIED');
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
  add(observed.paintObserver === true && observed.lcpObserver === true
    && observed.observerErrors === 0 && observed.capReached === false, 'OBSERVER_UNVERIFIED');
  const lhr = row.lighthouse ?? {}; const metrics = lhr.metrics ?? {};
  add(lhr.version === PINS.lighthouse && lhr.runtimeError === false && lhr.fixtureUrlMatched === true,
    'LIGHTHOUSE_IDENTITY_INVALID');
  add(lhr.settings?.throttlingMethod === 'devtools' && lhr.settings?.emulatedUserAgent === false
    && lhr.settings?.formFactor === 'desktop' && lhr.settings?.mobile === false
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
    && screenshot.bytes <= 262144 && /^[a-f0-9]{64}$/.test(screenshot.sha256 ?? '')
    && finite(screenshot.timingMs) && screenshot.timingMs >= metrics.fpMs
    && screenshot.timingMs <= metrics.endMs && positive(screenshot.width) && positive(screenshot.height),
  'TIMED_SCREENSHOT_UNAVAILABLE');
  add(Array.isArray(row.failureCodes) && row.failureCodes.length === 0, 'RETAINED_FAILURE');
  return [...new Set(problems)];
}

export function receiptProblems(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return ['RECEIPT_INVALID'];
  const problems = [];
  if (!exactKeys(receipt, ['schemaVersion', 'scope', 'layoutSemantics', 'createdAtUtc', 'status', 'production', 'admissions',
    'improvementBudgets', 'toolchain', 'sourceHashes', 'profiles', 'failureCodes'])) problems.push('RECEIPT_KEYS_INVALID');
  if (receipt.schemaVersion !== 'local-environment-preflight.v1' || receipt.scope !== 'synthetic-loopback-capability-only') problems.push('SCOPE_INVALID');
  if (receipt.layoutSemantics !== 'desktop-css-viewport-resize-no-mobile-device-emulation') problems.push('LAYOUT_SEMANTICS_INVALID');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.createdAtUtc ?? '')
    || !Number.isFinite(Date.parse(receipt.createdAtUtc))) problems.push('CAPTURE_TIME_INVALID');
  if (!exactKeys(receipt.production, ['access', 'source', 'deployment'])
    || Object.values(receipt.production).some(value => value !== 'not-tested')) problems.push('PRODUCTION_CLAIM_FORBIDDEN');
  if (!exactKeys(receipt.admissions, ['productionPerformance', 'field', 'g003'])
    || Object.values(receipt.admissions).some(value => value !== 0)) problems.push('ADMISSION_FORBIDDEN');
  if (!exactKeys(receipt.improvementBudgets, ['absolute', 'relative', 'noise'])
    || Object.values(receipt.improvementBudgets).some(value => value !== null)) problems.push('IMPROVEMENT_CLAIM_FORBIDDEN');
  if (receipt.status !== 'local-capabilities-observed') problems.push('PREFLIGHT_NOT_PASSED');
  const tools = receipt.toolchain ?? {};
  if (!exactKeys(tools, ['nodeMajor', 'nodeVersion', 'chrome', 'playwright', 'lighthouse', 'puppeteerVersion', 'puppeteerLockMatched'])) problems.push('TOOLCHAIN_KEYS_INVALID');
  if (tools.nodeMajor !== PINS.nodeMajor || tools.chrome !== PINS.chrome || tools.playwright !== PINS.playwright
    || !/^24\.\d+\.\d+$/.test(tools.nodeVersion ?? '') || !/^\d+\.\d+\.\d+$/.test(tools.puppeteerVersion ?? '')
    || tools.lighthouse !== PINS.lighthouse || tools.puppeteerLockMatched !== true) problems.push('TOOLCHAIN_UNVERIFIED');
  if (!exactKeys(receipt.sourceHashes, ['preflight', 'evidence', 'browserContract', 'appLock', 'lighthouseLock', 'fixture'])
    || Object.values(receipt.sourceHashes).some(value => !/^[a-f0-9]{64}$/.test(value))) problems.push('SOURCE_HASHES_INVALID');
  if (!Array.isArray(receipt.profiles) || receipt.profiles.length !== PROFILES.length) problems.push('PROFILE_SET_INCOMPLETE');
  else for (let i = 0; i < PROFILES.length; i++) {
    if (receipt.profiles[i]?.id !== PROFILES[i].id) problems.push('PROFILE_ORDER_INVALID');
    for (const code of profileProblems(receipt.profiles[i])) problems.push(`${PROFILES[i].id}:${code}`);
  }
  if (!Array.isArray(receipt.failureCodes) || receipt.failureCodes.some(code => !fixed(code))
    || receipt.failureCodes.length) problems.push('RETAINED_FAILURE');
  return [...new Set(problems)];
}

export function verifyReceiptBytes(bytes, expectedHash) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RECEIPT_BYTES) return { verified: false, failures: ['RECEIPT_SIZE_LIMIT'] };
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '') || sha256(bytes) !== expectedHash) return { verified: false, failures: ['RECEIPT_HASH_MISMATCH'] };
  let receipt;
  try { receipt = parseStrictJson(bytes); } catch { return { verified: false, failures: ['RECEIPT_INVALID_JSON'] }; }
  const failures = receiptProblems(receipt);
  return { verified: failures.length === 0, scope: 'synthetic-loopback-capability-only', failures };
}
