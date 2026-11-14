import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PINS, PROFILES, THROTTLING, MAX_RECEIPT_BYTES, allowedFixtureRequest,
  parseArguments, parseStrictJson, profileProblems, projectTrace, receiptProblems, sha256, verifyReceiptBytes } from './evidence.mjs';
import { createWorkGate, serializeReceipt } from './preflight.mjs';

// Synthetic software fixtures only. These values are not browser observations.
function sample(profile) {
  const originTs = 2_000_000;
  const row = { id: profile.id, status: 'passed', failureCodes: [], freshOwnedProfile: true, profileCleaned: true,
    launch: { chromiumSandboxRequested: true, disableSandboxFlagObserved: false, automationFlagObserved: true,
      versionVerified: true, isMobile: false, hasTouch: false },
    controls: { cpuSlowdownRequested: 4, latencyMsRequested: 562.5,
      downloadBytesPerSecondRequested: Math.floor(1474.56 * 1024 / 8), uploadBytesPerSecondRequested: Math.floor(675 * 1024 / 8),
      cpuAcknowledged: true, networkAcknowledged: true, cacheDisabledAcknowledged: true, serviceWorkerBypassAcknowledged: true },
    requests: { blockedHttp: 0, blockedWebSocket: 0, failed: 0, documentStatus: 200, documentCount: 1, heroCount: 1, cachedResponseCount: 0 },
    observation: { samplingIntervalMs: 100, stopped: true, paintObserver: true, lcpObserver: true, observerErrors: 0, capReached: false,
      navigation: { type: 'navigate', redirectCount: 0, startTime: 0, requestStart: 10, responseStart: 40, responseEnd: 50 },
      samples: [0, 90, 150, 250, 300, 500].map(atMs => ({ atMs, width: profile.width, height: profile.height,
        dpr: profile.dpr, visible: true, focused: true })),
      paints: [{ name: 'first-paint', startTimeMs: 100, receivedAtMs: 110 }, { name: 'first-contentful-paint', startTimeMs: 120, receivedAtMs: 130 }],
      paintTimeline: [{ name: 'first-paint', startTimeMs: 100 }, { name: 'first-contentful-paint', startTimeMs: 120 }],
      lcp: [{ startTimeMs: 240, receivedAtMs: 250 }],
      frames: [{ requestedAtMs: 100, callbackAtMs: 110, frameTimestampMs: 108 }, { requestedAtMs: 200, callbackAtMs: 210, frameTimestampMs: 208 }] },
    lighthouse: { version: PINS.lighthouse, runtimeError: false, fixtureUrlMatched: true, fcpAuditMs: 120, lcpAuditMs: 240,
      settings: { formFactor: 'desktop', mobile: false, throttlingMethod: 'devtools', emulatedUserAgent: false, disableStorageReset: false,
        viewport: { width: profile.width, height: profile.height, dpr: profile.dpr }, throttling: { ...THROTTLING } },
      metrics: { originTs, navigationTs: originTs, fpMs: 100, fpTs: originTs + 100_000,
        fcpMs: 120, fcpTs: originTs + 120_000, lcpMs: 240, lcpTs: originTs + 240_000,
        endMs: 500, endTs: originTs + 500_000 } },
    screenshot: { source: 'lighthouse-final-screenshot', bytes: 12000, sha256: 'a'.repeat(64), timingMs: 300, width: 390, height: 844 } };
  row.trace = projectTrace({ traceEvents: [['navigationStart', 0], ['firstPaint', 100], ['firstContentfulPaint', 120],
    ['largestContentfulPaint::Candidate', 240]].map(([name, ms]) => ({ name, ts: originTs + ms * 1000 })) }, row.lighthouse.metrics);
  return row;
}
function receipt() {
  return { schemaVersion: 'local-environment-preflight.v1', scope: 'synthetic-loopback-capability-only',
    layoutSemantics: 'desktop-css-viewport-resize-no-mobile-device-emulation',
    createdAtUtc: '2026-11-14T00:00:00.000Z', status: 'local-capabilities-observed',
    production: { access: 'not-tested', source: 'not-tested', deployment: 'not-tested' },
    admissions: { productionPerformance: 0, field: 0, g003: 0 }, improvementBudgets: { absolute: null, relative: null, noise: null },
    toolchain: { nodeMajor: 24, nodeVersion: '24.22.1', chrome: PINS.chrome, playwright: PINS.playwright,
      lighthouse: PINS.lighthouse, puppeteerVersion: '25.17.0', puppeteerLockMatched: true },
    sourceHashes: Object.fromEntries(['preflight', 'evidence', 'browserContract', 'appLock', 'lighthouseLock', 'fixture'].map(key => [key, 'b'.repeat(64)])),
    profiles: PROFILES.map(sample), failureCodes: [] };
}

test('help is offline; arguments cannot select a public target, credentials, or a retry', () => {
  assert.deepEqual(parseArguments([]), { mode: 'help' });
  assert.deepEqual(parseArguments(['--run-local', '--output', 'new.json']), { mode: 'run', output: 'new.json' });
  for (const args of [['--url', 'https://www.tzudong.app/'], ['--run-local', '--output', 'x', '--retry'], ['--no-sandbox']]) {
    assert.throws(() => parseArguments(args), /ARGUMENTS_INVALID/);
  }
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./preflight.mjs', import.meta.url)), '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Help\/verify do not launch a browser/);
});

test('the exact owned loopback request allowlist rejects external, changed host, query, port, and writes', () => {
  const origin = 'http://127.0.0.1:45678';
  for (const path of ['/fixture', '/hero.svg', '/favicon.ico']) assert.equal(allowedFixtureRequest(origin + path, 'GET', origin), true);
  for (const url of ['https://www.tzudong.app/', 'http://localhost:45678/fixture', 'http://127.0.0.1:80/fixture',
    origin + '/fixture?target=https://example.com', origin + '/unknown', 'http://user:password@127.0.0.1:45678/fixture']) {
    assert.equal(allowedFixtureRequest(url, 'GET', origin), false);
  }
  assert.equal(allowedFixtureRequest(origin + '/fixture', 'POST', origin), false);
});

test('three synthetic complete records pass arithmetic checks without a production admission', () => {
  const value = receipt(); assert.deepEqual(receiptProblems(value), []);
  const bytes = Buffer.from(JSON.stringify(value));
  assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, true);
  value.admissions.productionPerformance = 1;
  assert.ok(receiptProblems(value).includes('ADMISSION_FORBIDDEN'));
});

test('pre-paint anchor and every timed viewport matter; post-cleanup changes are excluded', () => {
  const row = sample(PROFILES[0]);
  row.observation.samples.push({ atMs: 501, width: 780, height: 493, dpr: 1, visible: false, focused: false });
  assert.deepEqual(profileProblems(row), []);
  row.observation.samples[1].width = 980;
  assert.ok(profileProblems(row).includes('TIMED_VIEWPORT_MISMATCH'));
  row.observation.samples[1].width = 390; row.observation.samples[3].height = 493;
  assert.ok(profileProblems(row).includes('TIMED_VIEWPORT_MISMATCH'));
});

test('paint missing, timeline disagreement, and tail-only LCP are never substituted', () => {
  const missing = sample(PROFILES[0]); missing.observation.paints = [];
  assert.ok(profileProblems(missing).includes('INDEPENDENT_PAINT_MISMATCH_OR_MISSING'));
  const timeline = sample(PROFILES[0]); timeline.observation.paintTimeline[1].startTimeMs = 250;
  assert.ok(profileProblems(timeline).includes('INDEPENDENT_PAINT_MISMATCH_OR_MISSING'));
  const tail = sample(PROFILES[0]); tail.observation.lcp[0].startTimeMs = 600;
  assert.ok(profileProblems(tail).includes('INDEPENDENT_PAINT_MISMATCH_OR_MISSING'));
});

test('trace microsecond normalization, origin, screenshot time and frame progress are required', () => {
  for (const mutate of [r => { r.lighthouse.metrics.originTs /= 1000; }, r => { r.trace.events[1].normalizedMs = 0; },
    r => { r.screenshot.timingMs = 501; }, r => { r.observation.frames = []; }]) {
    const row = sample(PROFILES[1]); mutate(row); assert.ok(profileProblems(row).length > 0);
  }
});

test('unsafe sandbox, unacknowledged controls, mismatched throughput, UA and cached data fail closed', () => {
  for (const mutate of [r => { r.launch.disableSandboxFlagObserved = true; }, r => { r.controls.cpuAcknowledged = false; },
    r => { r.controls.downloadBytesPerSecondRequested = Math.floor(1474.56 * 1000 / 8); },
    r => { r.lighthouse.settings.emulatedUserAgent = true; }, r => { r.requests.cachedResponseCount = 1; },
    r => { r.requests.blockedHttp = 1; }, r => { r.observation.samples[2].focused = false; }]) {
    const row = sample(PROFILES[0]); mutate(row); assert.ok(profileProblems(row).length > 0);
  }
});

test('a failed/incomplete attempt and duplicate profile cannot become a passed full preflight', () => {
  const value = receipt(); value.profiles[0].status = 'failed'; value.profiles[0].failureCodes = ['LOCAL_PROFILE_TIMEOUT'];
  assert.ok(receiptProblems(value).includes('mobile:PROFILE_NOT_PASSED'));
  const incomplete = receipt(); incomplete.profiles.pop(); assert.ok(receiptProblems(incomplete).includes('PROFILE_SET_INCOMPLETE'));
  const duplicate = receipt(); duplicate.profiles[2] = duplicate.profiles[0]; assert.ok(receiptProblems(duplicate).includes('PROFILE_ORDER_INVALID'));
});

test('detached hash and bounded raw bytes reject tampering before accepting scalars', () => {
  const bytes = Buffer.from(JSON.stringify(receipt())); const hash = sha256(bytes);
  const changed = Buffer.from(bytes.toString().replace('"width":390', '"width":391'));
  assert.equal(verifyReceiptBytes(changed, hash).verified, false);
  assert.equal(verifyReceiptBytes(Buffer.alloc(MAX_RECEIPT_BYTES + 1), hash).verified, false);
  assert.equal(verifyReceiptBytes(Buffer.from('{'), sha256(Buffer.from('{'))).verified, false);
});

test('trace projection retains only bounded numeric named events, rejects cap loss and missing APIs', () => {
  const row = sample(PROFILES[2]);
  row.trace = projectTrace({ traceEvents: Array.from({ length: 129 }, () => ({ name: 'firstPaint', ts: 2_100_000,
    args: { privateText: 'must not be projected' } })) }, row.lighthouse.metrics);
  assert.equal(row.trace.events.length, 128); assert.equal(row.trace.capReached, true);
  assert.equal(JSON.stringify(row.trace).includes('privateText'), false);
  assert.ok(profileProblems(row).includes('TRACE_UNAVAILABLE'));
  const missing = sample(PROFILES[0]); missing.observation.navigation = null; missing.trace.events = {};
  assert.doesNotThrow(() => profileProblems(missing)); assert.ok(profileProblems(missing).length > 0);
});

test('scope, tool mismatch, unrecorded payload and improvement budgets remain separate from capabilities', () => {
  for (const mutate of [v => { v.production.access = 'verified'; }, v => { v.toolchain.chrome = 'other'; },
    v => { v.improvementBudgets.absolute = 0; }, v => { v.rawProviderDiagnostic = 'forbidden'; }]) {
    const value = receipt(); mutate(value); assert.ok(receiptProblems(value).length > 0);
  }
});

test('expiration disposes a late acquired resource and prevents subsequent asynchronous work', async () => {
  const gate = createWorkGate(); let resolveResource; let disposed = 0; let used = 0;
  const acquired = gate.acquire(() => new Promise(resolve => { resolveResource = resolve; }), async () => { disposed++; });
  gate.expire(); resolveResource({ owned: true });
  await assert.rejects(acquired, /LOCAL_PROFILE_STOPPED/); assert.equal(disposed, 1);
  assert.equal(gate.cleanupUnconfirmed(), false);
  await assert.rejects(gate.step(async () => { used++; }), /LOCAL_PROFILE_STOPPED/); assert.equal(used, 0);
});

test('a rejected late disposer leaves cleanup unconfirmed even when no resource was returned', async () => {
  const gate = createWorkGate(); let resolveResource; let returned = false;
  const acquired = (async () => {
    await gate.acquire(() => new Promise(resolve => { resolveResource = resolve; }), async () => { throw new Error('fixed test failure'); });
    returned = true;
  })();
  gate.expire(); resolveResource({ owned: true });
  await assert.rejects(acquired, /PROFILE_CLEANUP_UNCONFIRMED/);
  assert.equal(returned, false); assert.equal(gate.cleanupUnconfirmed(), true);
});

test('a step that completes after expiration cannot publish its result', async () => {
  const gate = createWorkGate(); let resolveStep; let published = false;
  const work = (async () => { await gate.step(() => new Promise(resolve => { resolveStep = resolve; })); published = true; })();
  gate.expire(); resolveStep();
  await assert.rejects(work, /LOCAL_PROFILE_STOPPED/); assert.equal(published, false);
});

test('initial wrong viewport, negative time, missing tail coverage and interior sampling gaps are rejected', () => {
  const initial = sample(PROFILES[0]); initial.observation.samples[0].width = 980;
  assert.ok(profileProblems(initial).includes('TIMED_VIEWPORT_MISMATCH'));
  const negative = sample(PROFILES[0]); negative.observation.samples[0].atMs = -1;
  assert.ok(profileProblems(negative).includes('VIEWPORT_ANCHOR_MISSING'));
  const early = sample(PROFILES[0]); early.observation.samples = [early.observation.samples[0], early.observation.samples[2]];
  assert.ok(profileProblems(early).includes('TIMED_SAMPLE_COVERAGE_INCOMPLETE'));
  const gap = sample(PROFILES[0]); gap.observation.samples = [gap.observation.samples[0], gap.observation.samples.at(-1)];
  assert.ok(profileProblems(gap).includes('TIMED_SAMPLE_COVERAGE_INCOMPLETE'));
});

test('duplicate keys, escaped duplicates and prototype keys are rejected before receipt verification', () => {
  for (const text of ['{"a":1,"a":2}', '{"nested":{"scope":1,"sc\\u006fpe":2}}', '{"__proto__":{"x":1}}']) {
    assert.throws(() => parseStrictJson(Buffer.from(text)), /JSON_KEY_REJECTED/);
    const bytes = Buffer.from(text); assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
  }
  assert.deepEqual(parseStrictJson(Buffer.from('{"a":"quoted,\\\"{text}","b":[{"a":2}]}')),
    { a: 'quoted,"{text}', b: [{ a: 2 }] });
});

test('nested free text is rejected and privacy/size failures retain bounded failed attempt identities', () => {
  const nested = receipt(); nested.profiles[0].observation.privateMessage = 'unrecognized';
  assert.ok(receiptProblems(nested).includes('mobile:PROFILE_SHAPE_INVALID'));
  for (const mutate of [row => { row.observation.stopped = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.trace.originalCount = { rawProviderDiagnostic: 'unrecognized' }; }]) {
    const value = receipt(); mutate(value.profiles[0]);
    assert.ok(receiptProblems(value).includes('mobile:PROFILE_SHAPE_INVALID'));
  }
  for (const [text, code] of [['x'.repeat(MAX_RECEIPT_BYTES), 'RECEIPT_SIZE_LIMIT'],
    ['example.user@example.test', 'PRIVACY_VALIDATION_FAILED']]) {
    const value = receipt(); value.profiles[0].observation.unexpectedText = text;
    const bytes = serializeReceipt(value); const saved = JSON.parse(bytes.toString());
    assert.ok(bytes.length <= MAX_RECEIPT_BYTES); assert.equal(saved.status, 'blocked-or-incomplete');
    assert.ok(saved.failureCodes.includes(code));
    assert.deepEqual(saved.profiles.map(row => row.id), PROFILES.map(row => row.id));
    assert.ok(saved.profiles.every(row => row.status === 'failed' && row.observation === null
      && row.failureCodes.includes('RECEIPT_PROJECTION_NOT_RETAINED')));
    assert.equal(bytes.toString().includes(text), false);
    assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
  }
});
