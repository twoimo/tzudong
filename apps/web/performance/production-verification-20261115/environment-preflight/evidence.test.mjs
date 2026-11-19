import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivacySafe, assertPrivacySafeText } from '../../../lib/privacy/sanitize.ts';
import { FAILURE_TEXT_LIMIT, FAILURE_VERSION, INITIALIZATION_STAGES, PINS, PROFILES, RECEIPT_VERSION,
  SOURCE_KEYS, THROTTLING, MAX_RECEIPT_BYTES,
  allowedFixtureRequest, assertReceiptPrivacy, digestShape, parseArguments, parseStrictJson, profileProblems,
  projectTrace, receiptProblems, receiptShapeProblems, sha256, sourceDigestProblems, verifyReceiptBytes } from './evidence.mjs';
import { createInitializationTrace, createWorkGate, initializationFailureKind, readSourceDigests,
  serializeReceipt, writeReceipt } from './preflight.mjs';

// Synthetic software fixtures only. These values are not browser observations.
function sample(profile) {
  const originTs = 2_000_000;
  const row = { id: profile.id, status: 'passed', failureCodes: [], freshOwnedProfile: true, profileCleaned: true,
    initialization: { failureStage: null, lastCompletedStage: 'post-initialization', contextReturned: true, failureKind: null },
    launch: { chromiumSandboxRequested: true, disableSandboxFlagObserved: false, automationFlagObserved: true,
      versionVerified: true, mobileLayoutRequested: false, hasTouch: false },
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
      settings: { formFactor: 'desktop', mobileLayoutReported: false, throttlingMethod: 'devtools', emulatedUserAgent: false, disableStorageReset: false,
        viewport: { width: profile.width, height: profile.height, dpr: profile.dpr }, throttling: { ...THROTTLING } },
      metrics: { originTs, navigationTs: originTs, fpMs: 100, fpTs: originTs + 100_000,
        fcpMs: 120, fcpTs: originTs + 120_000, lcpMs: 240, lcpTs: originTs + 240_000,
        endMs: 500, endTs: originTs + 500_000 } },
    screenshot: { source: 'lighthouse-final-screenshot', bytes: 12000, sha256Bytes: Array(32).fill(170), timingMs: 300, width: 390, height: 844 } };
  row.trace = projectTrace({ traceEvents: [['navigationStart', 0], ['firstPaint', 100], ['firstContentfulPaint', 120],
    ['largestContentfulPaint::Candidate', 240]].map(([name, ms]) => ({ name, ts: originTs + ms * 1000 })) }, row.lighthouse.metrics);
  return row;
}
function receipt() {
  return { schemaVersion: RECEIPT_VERSION, scope: 'synthetic-loopback-capability-only',
    layoutSemantics: 'desktop-css-viewport-resize-no-mobile-device-emulation',
    createdAtUtc: '2026-11-14T00:00:00.000Z', status: 'local-capabilities-observed',
    production: { access: 'not-tested', source: 'not-tested', deployment: 'not-tested' },
    admissions: { productionPerformance: 0, field: 0, g003: 0 }, improvementBudgets: { absolute: null, relative: null, noise: null },
    toolchain: { nodeMajor: 24, nodeVersion: '24.22.1', chrome: PINS.chrome, playwright: PINS.playwright,
      lighthouse: PINS.lighthouse, puppeteerVersion: '25.17.0', puppeteerLockMatched: true },
    sourceDigests: Object.fromEntries(SOURCE_KEYS.map(key => [key, Array(32).fill(187)])),
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

test('nested payloads on successful or failed rows cannot bypass strict shape screening', () => {
  const nested = receipt(); nested.profiles[0].observation.privateMessage = 'unrecognized';
  assert.ok(receiptProblems(nested).includes('mobile:PROFILE_SHAPE_INVALID'));
  for (const mutate of [row => { row.observation.stopped = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.trace.originalCount = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.observation.capReached = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.freshOwnedProfile = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.lighthouse.fcpAuditMs = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.lighthouse.settings.disableStorageReset = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.screenshot.width = { rawProviderDiagnostic: 'unrecognized' }; },
    row => { row.trace.present = { rawProviderDiagnostic: 'unrecognized' }; }]) {
    for (const status of ['passed', 'failed']) {
      const value = receipt(); value.profiles[0].status = status; mutate(value.profiles[0]);
      assert.ok(receiptShapeProblems(value).includes('mobile:PROFILE_SHAPE_INVALID'));
      assert.throws(() => assertReceiptPrivacy(value), /RECEIPT_SHAPE_INVALID/);
    }
  }
});

test('real fixed public source digests survive the unchanged object privacy boundary', async () => {
  const sources = await readSourceDigests();
  const contractBytes = await readFile(new URL('../../../../../.github/chrome-for-testing.v1.json', import.meta.url));
  const contractHex = sha256(contractBytes);
  assert.equal(contractHex, 'e53ca39fbb8eb91634ec4e4bd9b56a694afaf47889c020111f9d8526b189d40e');
  assert.doesNotThrow(() => assertPrivacySafeText(contractHex));
  assert.doesNotThrow(() => assertPrivacySafe({ sourceHashes: { browserContract: contractHex } }));
  assert.throws(() => assertPrivacySafe({ message: 'example.user@example.test' }), error => error.code === 'PRIVACY_UNSAFE_VALUE');
  assert.equal(Buffer.from(sources.browserContract).toString('hex'), contractHex);
  assert.equal(Buffer.from(sources.fixture).toString('hex'), '4a6a605bf2d535b77554f793af3787aaa1b79bb71e27b5d6461838a7f3115771');
  assert.ok(Object.values(sources).every(digestShape));
  const value = receipt(); value.sourceDigests = sources;
  // The retained CI attempt's metadata timestamp is a software input here, not
  // a recovered timestamp or runtime failure code from its empty receipt.
  value.createdAtUtc = '2026-11-14T20:45:05.152Z';
  assert.doesNotThrow(() => assertReceiptPrivacy(value));
  const saved = parseStrictJson(serializeReceipt(value));
  assert.equal(saved.schemaVersion, RECEIPT_VERSION); assert.deepEqual(saved.sourceDigests, sources);
  assert.deepEqual(receiptProblems(saved), []);
  value.status = 'blocked-or-incomplete'; value.toolchain = null; value.profiles = [];
  value.failureCodes = ['LOCAL_PREFLIGHT_FAILED']; // Synthetic known code; no claim about the lost CI cause.
  const failed = parseStrictJson(serializeReceipt(value));
  assert.equal(failed.schemaVersion, RECEIPT_VERSION); assert.deepEqual(failed.failureCodes, ['LOCAL_PREFLIGHT_FAILED']);
  assert.deepEqual(failed.sourceDigests, sources); assert.deepEqual(receiptShapeProblems(failed), []);
  assert.ok(receiptProblems(failed).includes('PREFLIGHT_NOT_PASSED'));
});

test('layout booleans have precise typed names; old phone-like keys stay rejected by the unchanged guard', () => {
  for (const key of ['isMobile', 'mobile']) {
    assert.throws(() => assertPrivacySafe({ [key]: false }), error => error.code === 'PRIVACY_UNSAFE_VALUE');
  }
  assert.doesNotThrow(() => assertPrivacySafe({ mobileLayoutRequested: false, mobileLayoutReported: false }));
  for (const mutate of [row => { row.launch.mobileLayoutRequested = true; },
    row => { row.lighthouse.settings.mobileLayoutReported = true; }]) {
    const row = sample(PROFILES[0]); mutate(row); assert.ok(profileProblems(row).length > 0);
  }
  const old = receipt(); old.profiles[0].launch.isMobile = false;
  delete old.profiles[0].launch.mobileLayoutRequested;
  assert.ok(receiptShapeProblems(old).includes('mobile:PROFILE_SHAPE_INVALID'));
  const partial = receipt(); partial.status = 'blocked-or-incomplete'; partial.failureCodes = ['LOCAL_PROFILE_FAILED'];
  const row = sample(PROFILES[0]); row.status = 'failed'; row.failureCodes = ['LOCAL_PROFILE_TIMEOUT'];
  row.initialization = { failureStage: 'context-launch', lastCompletedStage: null, contextReturned: false, failureKind: 'timeout' };
  for (const key of ['launch', 'controls', 'observation', 'lighthouse', 'trace', 'screenshot']) row[key] = null;
  row.profileCleaned = false; partial.profiles = [row];
  const bytes = serializeReceipt(partial); const saved = parseStrictJson(bytes);
  assert.equal(saved.schemaVersion, RECEIPT_VERSION); assert.deepEqual(saved.profiles[0], row);
  assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
});

test('digest representations reject wrong length, holes, extra keys, strings and non-uint8 values', () => {
  const hole = Array(32); hole[0] = 1;
  const extra = Array(32).fill(1); extra.freeText = 'unrecognized';
  const getter = Array(32).fill(1); Object.defineProperty(getter, '0', { enumerable: true, get() { throw new Error('must not execute'); } });
  for (const digest of [Array(31).fill(1), Array(33).fill(1), hole, extra, getter, 'b'.repeat(64),
    [...Array(31).fill(1), -1], [...Array(31).fill(1), 256], [...Array(31).fill(1), 1.5],
    [...Array(31).fill(1), null], [...Array(31).fill(1), 'example.user@example.test']]) {
    assert.equal(digestShape(digest), false);
    const value = receipt(); value.sourceDigests.browserContract = digest;
    assert.ok(receiptShapeProblems(value).includes('SOURCE_DIGESTS_INVALID'));
    const row = sample(PROFILES[0]); row.screenshot.sha256Bytes = digest;
    assert.ok(profileProblems(row).includes('PROFILE_SHAPE_INVALID'));
  }
  for (const version of ['local-environment-preflight.v1', 'local-environment-preflight.v2']) {
    const old = receipt(); old.schemaVersion = version;
    assert.ok(receiptProblems(old).includes('SCOPE_INVALID'));
  }
});

test('bounded record screening covers array tails and retains a fixed failed envelope on rejection', () => {
  const long = receipt();
  for (const row of long.profiles) row.observation.samples = Array.from({ length: 600 }, (_, index) => ({
    ...row.observation.samples[0], atMs: index * 100 }));
  assert.deepEqual(receiptShapeProblems(long), []);
  assert.doesNotThrow(() => assertReceiptPrivacy(long)); // More than 1000 total entries; no guard limit is raised.
  const size = parseStrictJson(serializeReceipt(long));
  assert.equal(size.failureCodes[0], 'RECEIPT_SIZE_LIMIT');
  long.profiles[2].observation.samples[599].focused = 'example.user@example.test';
  const tail = parseStrictJson(serializeReceipt(long));
  assert.equal(tail.failureCodes[0], 'RECEIPT_SHAPE_INVALID');
  const unknown = receipt(); unknown.profiles[0].observation.unexpectedText = 'example.user@example.test';
  const privacy = receipt(); privacy.toolchain.chrome = '02.123.4567.0';
  assert.deepEqual(receiptShapeProblems(privacy), []); // Typed four-part version, still screened by the unchanged guard.
  for (const [input, code] of [[long, 'RECEIPT_SHAPE_INVALID'], [unknown, 'RECEIPT_SHAPE_INVALID'],
    [privacy, 'PRIVACY_VALIDATION_FAILED']]) {
    const bytes = serializeReceipt(input); const saved = parseStrictJson(bytes);
    assert.ok(bytes.length > 0 && bytes.length < 2048); assert.equal(saved.schemaVersion, FAILURE_VERSION);
    assert.equal(saved.status, 'blocked-or-incomplete'); assert.equal(saved.sourceVerified, false);
    assert.equal(saved.projectionsRetained, false); assert.equal(saved.productionTested, false);
    assert.deepEqual(saved.failureCodes, [code, 'SOURCE_UNVERIFIED', 'RECEIPT_PROJECTION_NOT_RETAINED']);
    assert.deepEqual(saved.profiles, PROFILES.map(profile => ({ id: profile.id, failed: true, projectionsRetained: false })));
    assert.equal(bytes.toString().includes('example.user@example.test'), false);
    assert.equal(Object.hasOwn(saved, 'sourceDigests'), false); assert.equal(Object.hasOwn(saved, 'toolchain'), false);
    assert.deepEqual(receiptShapeProblems(saved), []); assert.doesNotThrow(() => assertReceiptPrivacy(saved));
    assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
    assert.equal(input.status, 'local-capabilities-observed'); // Serializer never rewrites the original observation.
  }
});

test('a minimal failed envelope never admits copied metadata, arbitrary codes or a successful state', () => {
  const invalid = receipt(); invalid.toolchain.chrome = '02.123.4567.0';
  const fallback = parseStrictJson(serializeReceipt(invalid));
  for (const mutate of [value => { value.sourceVerified = true; }, value => { value.projectionsRetained = true; },
    value => { value.status = 'local-capabilities-observed'; }, value => { value.createdAtUtc = '2026-11-14T00:00:00.000Z'; },
    value => { value.profiles[0].id = 'unrecognized'; }, value => { value.failureCodes[0] = 'ARBITRARY_ERROR'; },
    value => { value.profiles[0].failed = 'example.user@example.test'; }]) {
    const value = structuredClone(fallback); mutate(value);
    assert.deepEqual(receiptShapeProblems(value), ['FAILURE_ENVELOPE_INVALID']);
    const bytes = Buffer.from(JSON.stringify(value)); assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
  }
});

test('exclusive file writing retains nonempty real-source partial failure and fixed privacy fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tzudong-preflight-v3-pure-'));
  try {
    const partial = receipt(); partial.sourceDigests = await readSourceDigests();
    partial.createdAtUtc = '2026-11-14T20:45:05.152Z'; partial.status = 'blocked-or-incomplete';
    partial.toolchain = null; partial.profiles = []; partial.failureCodes = ['LOCAL_PREFLIGHT_FAILED'];
    const rejected = receipt(); rejected.toolchain.chrome = '02.123.4567.0';
    for (const [index, value] of [partial, rejected].entries()) {
      const path = join(directory, `synthetic-${index}.json`); const handle = await open(path, 'wx', 0o600);
      let summary;
      try { summary = await writeReceipt(handle, value); } finally { await handle.close(); }
      const bytes = await readFile(path); const saved = parseStrictJson(bytes);
      assert.ok(bytes.length > 0 && bytes.length <= MAX_RECEIPT_BYTES);
      assert.equal(summary.sha256, sha256(bytes)); assert.equal(summary.status, 'blocked-or-incomplete');
      assert.deepEqual(summary.failureCodes, saved.failureCodes);
      assert.equal(verifyReceiptBytes(bytes, summary.sha256).verified, false);
      await assert.rejects(open(path, 'wx', 0o600), { code: 'EEXIST' });
      assert.deepEqual(await readFile(path), bytes);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('offline CLI source verification compares all 32 bytes even after a new detached receipt hash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tzudong-preflight-v3-source-'));
  try {
    const value = receipt(); const actual = await readSourceDigests(); value.sourceDigests = actual;
    assert.deepEqual(sourceDigestProblems(value.sourceDigests, actual), []);
    for (const changed of [false, true]) {
      const candidate = structuredClone(value);
      if (changed) candidate.sourceDigests.browserContract[31] ^= 1;
      const bytes = serializeReceipt(candidate); const path = join(directory, changed ? 'synthetic-changed.json' : 'synthetic-source-matched.json');
      const handle = await open(path, 'wx', 0o600); try { await handle.writeFile(bytes); } finally { await handle.close(); }
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./preflight.mjs', import.meta.url)),
        '--verify', path, '--sha256', sha256(bytes)], { encoding: 'utf8', timeout: 10000 });
      assert.equal(child.status, changed ? 1 : 0, child.stderr);
      const result = JSON.parse(child.stdout); assert.equal(result.verified, !changed);
      assert.deepEqual(result.failures, changed ? ['SOURCE_DIGEST_MISMATCH'] : []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('initialization records each failed await or synchronous stage and freezes before cleanup', async () => {
  for (let failedIndex = 0; failedIndex < INITIALIZATION_STAGES.length; failedIndex++) {
    const trace = createInitializationTrace();
    for (let index = 0; index <= failedIndex; index++) {
      const stage = INITIALIZATION_STAGES[index];
      const action = () => { if (index === failedIndex) throw new Error('unclassified synthetic error'); return {}; };
      try {
        if (['target-selection', 'launch-policy-check'].includes(stage)) trace.sync(stage, action);
        else if (stage === 'post-initialization') { trace.begin(stage); action(); trace.complete(stage); }
        else await trace.step(stage, action);
      } catch (error) { trace.fail(error); break; }
    }
    assert.deepEqual(trace.state, { failureStage: INITIALIZATION_STAGES[failedIndex],
      lastCompletedStage: failedIndex === 0 ? null : INITIALIZATION_STAGES[failedIndex - 1],
      contextReturned: failedIndex > 0, failureKind: 'unknown' });
    const frozen = structuredClone(trace.state); assert.equal(Object.isFrozen(trace.state), true);
    trace.begin('post-initialization'); trace.complete('post-initialization');
    trace.fail(Object.assign(new Error('cleanup error'), { code: 'EPERM' })); trace.seal();
    assert.deepEqual(trace.state, frozen);
  }
});

test('a launch resolving after the failure checkpoint cannot rewrite context or completed-stage evidence', async () => {
  const trace = createInitializationTrace(); let resolveLaunch;
  const pending = trace.step('context-launch', () => new Promise(resolve => { resolveLaunch = resolve; }));
  trace.fail(Object.assign(new Error('LOCAL_PROFILE_TIMEOUT'), { safeCode: 'LOCAL_PROFILE_TIMEOUT' }));
  const frozen = structuredClone(trace.state); resolveLaunch({ syntheticContext: true }); await pending;
  assert.deepEqual(trace.state, frozen);
  assert.deepEqual(frozen, { failureStage: 'context-launch', lastCompletedStage: null, contextReturned: false, failureKind: 'timeout' });
  const success = createInitializationTrace();
  for (const stage of INITIALIZATION_STAGES) await success.step(stage, async () => ({}));
  success.seal(); success.fail(Object.assign(new Error('cleanup error'), { code: 'EPERM' }));
  assert.deepEqual(success.state, { failureStage: null, lastCompletedStage: 'post-initialization', contextReturned: true, failureKind: null });
});

test('failure classification requires a bounded explicit indicator and never equates closure with sandbox denial', () => {
  const cases = [
    [{ name: 'TimeoutError', message: 'synthetic timeout' }, 'http-route', 'timeout'],
    [{ name: 'TargetClosedError', message: 'synthetic closure' }, 'context-launch', 'target-closed'],
    [{ message: 'browserType.launchPersistentContext: Target page, context or browser has been closed' }, 'context-launch', 'target-closed'],
    [{ message: 'No usable sandbox!' }, 'context-launch', 'explicit-sandbox-denial'],
    [{ message: 'Running as root without --no-sandbox is not supported' }, 'context-launch', 'explicit-sandbox-denial'],
    [{ message: 'Chromium sandboxing failed!' }, 'context-launch', 'explicit-sandbox-denial'],
    [{ message: 'No usable sandbox!' }, 'http-route', 'unknown'],
    [{ code: 'EACCES', message: 'synthetic access failure' }, 'context-launch', 'explicit-permission-denial'],
    [{ code: 'EPERM', message: 'synthetic permission failure' }, 'post-initialization', 'explicit-permission-denial'],
    [{ message: 'Failed to move to new namespace: synthetic: Operation not permitted' }, 'context-launch', 'explicit-permission-denial'],
    [{ message: 'Failed to move to new namespace:\nOperation not permitted' }, 'context-launch', 'unknown'],
    [{ message: "Protocol error (Browser.getVersion): 'Browser.getVersion' wasn't found" }, 'version-read', 'protocol-method-unavailable'],
    [{ message: "Protocol error (Browser.getBrowserCommandLine): 'Browser.getBrowserCommandLine' wasn't found" }, 'command-line-read', 'protocol-method-unavailable'],
    [{ message: "Protocol error (Browser.getVersion): 'Browser.getVersion' wasn't found" }, 'context-launch', 'unknown'],
    [{ message: 'Could not launch browser; inspect sandbox configuration' }, 'context-launch', 'unknown'],
    [{ message: 'Permission denied' }, 'context-launch', 'unknown'],
    [{ message: 'x'.repeat(FAILURE_TEXT_LIMIT) + 'No usable sandbox!' }, 'context-launch', 'unknown'],
    [{ message: 'LOCAL_PREFLIGHT_FAILED' }, 'context-launch', 'unknown'],
  ];
  for (const [error, stage, expected] of cases) assert.equal(initializationFailureKind(error, stage), expected);
  const inaccessible = Object.defineProperty({}, 'message', { get() { throw new Error('synthetic getter'); } });
  assert.equal(initializationFailureKind(inaccessible, 'context-launch'), 'unknown');
});

test('initialization fields reject unknown data, impossible ordering and misplaced denial classifications', () => {
  for (const mutate of [state => { state.failureKind = { rawProviderDiagnostic: 'unrecognized' }; },
    state => { state.failureStage = 'unrecognized'; }, state => { state.contextReturned = 'true'; },
    state => { state.lastCompletedStage = { rawProviderDiagnostic: 'unrecognized' }; },
    state => { state.rawMessage = 'example.user@example.test'; },
    state => { state.failureKind = 'unknown'; },
    state => { state.failureStage = 'context-launch'; state.failureKind = 'unknown'; },
    state => { state.failureStage = 'http-route'; state.lastCompletedStage = 'context-launch'; state.failureKind = 'explicit-sandbox-denial'; },
    state => { state.failureStage = 'http-route'; state.lastCompletedStage = 'context-launch'; state.failureKind = 'protocol-method-unavailable'; }]) {
    const value = receipt(); mutate(value.profiles[0].initialization);
    assert.ok(receiptShapeProblems(value).includes('mobile:PROFILE_SHAPE_INVALID'));
    assert.throws(() => assertReceiptPrivacy(value), /RECEIPT_SHAPE_INVALID/);
  }
  const incomplete = sample(PROFILES[0]); incomplete.initialization.lastCompletedStage = 'launch-policy-check';
  assert.ok(profileProblems(incomplete).includes('INITIALIZATION_UNVERIFIED'));
});

test('retained initialization failure contains fixed state only and never copies exception text or reads its stack', async () => {
  const trace = createInitializationTrace();
  const privateText = 'example.user@example.test /private/example/path password=synthetic';
  const error = Object.defineProperty(new Error(privateText), 'stack', { get() { throw new Error('stack must not be read'); } });
  try { await trace.step('context-launch', () => { throw error; }); } catch (caught) { trace.fail(caught); }
  const value = receipt(); value.status = 'blocked-or-incomplete'; value.failureCodes = ['LOCAL_PROFILE_FAILED'];
  const row = value.profiles[0]; row.status = 'failed'; row.failureCodes = ['LOCAL_PREFLIGHT_FAILED']; row.initialization = trace.state;
  for (const key of ['launch', 'controls', 'observation', 'lighthouse', 'trace', 'screenshot']) row[key] = null;
  value.profiles = [row];
  const bytes = serializeReceipt(value); const saved = parseStrictJson(bytes);
  assert.equal(saved.schemaVersion, RECEIPT_VERSION); assert.deepEqual(saved.profiles[0].initialization, trace.state);
  assert.equal(saved.profiles[0].initialization.failureKind, 'unknown');
  assert.equal(bytes.toString().includes(privateText), false); assert.equal(bytes.toString().includes('example.user'), false);
  assert.deepEqual(receiptShapeProblems(saved), []); assert.equal(verifyReceiptBytes(bytes, sha256(bytes)).verified, false);
});
