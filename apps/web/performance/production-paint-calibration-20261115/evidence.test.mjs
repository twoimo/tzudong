import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TOOL_FILES, SOURCE_FILES, URL, clone, sha, schemaProblems, classifySnapshot, snapshotConsistencyProblems, parseJsonBytes, readSealed } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, 'snapshot.schema.json')));
const sourceSha = 'a'.repeat(40);
function example(s) {
  if (s.$ref) return example(schema.$defs[s.$ref.split('/').at(-1)]);
  if ('const' in s) return s.const;
  if (s.anyOf) return s.anyOf.some((v) => v.type === 'null') ? null : example(s.anyOf[0]);
  if (s.enum) return s.enum[0];
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, example(v)]));
  if (s.type === 'array') return [];
  if (s.type === 'boolean') return false;
  return 0;
}
function paint(name, startTimeMs, receivedAtMs = startTimeMs + 10, delivery = 'callback') {
  return { name, startTimeMs, receivedAtMs, delivery, entryWindow: startTimeMs <= 20000 ? 'primary' : startTimeMs <= 30000 ? 'tail' : 'outside', accepted: true };
}
function countEntries(segment) {
  for (const [type, key] of [['paint', 'paintEntries'], ['largest-contentful-paint', 'lcpEntries'], ['longtask', 'longTasks']]) {
    const stats = segment.observerStats[type];
    stats.registered = true;
    stats.callbackCount = segment[key].some((e) => e.delivery === 'callback') ? 1 : 0;
    stats.callbackEntryCount = segment[key].filter((e) => e.delivery === 'callback').length;
    stats.drainedEntryCount = segment[key].filter((e) => e.delivery === 'drain').length;
    stats.receivedEntryCount = segment[key].length;
    stats.acceptedEntryCount = segment[key].filter((e) => e.accepted).length;
    stats.afterCutoffCount = segment[key].filter((e) => !e.accepted).length;
  }
}
function fixture() {
  const s = example(schema);
  s.binding.gitSha = sourceSha;
  s.capture.observerSetupMs = 20; s.capture.primaryCheckpointAtMs = 20001; s.capture.finalizedAtMs = 30002;
  s.primary.observedAtMs = 20001; s.late.observedAtMs = 30000;
  Object.keys(s.support).forEach((key) => { s.support[key] = true; });
  for (const key of ['initial', 'primary', 'final']) s.viewport[key] = { width: 1363, height: 936, dpr: 1 };
  s.navigation = { type: 'navigate', startTimeMs: 0, responseStartMs: 100, responseEndMs: 110, domInteractiveMs: 200, domContentLoadedMs: 220, loadEventEndMs: 500, activationStartMs: 0, redirectCount: 0 };
  for (const [key, at] of [['primary', 20001], ['late', 30001]]) {
    const c = s[key].context;
    c.contextUnchanged = true; c.focusAtSetup = true; c.focusAtRead = true; c.observedAtMs = at;
    c.focusSampleCount = 1; c.focusTrueSampleCount = 1;
    s[key].paintTimeline.observedAtMs = at;
    s[key].observerWorkMs = 0;
  }
  s.primary.paintEntries = [paint('first-paint', 200), paint('first-contentful-paint', 300)];
  const lcp = example(schema.$defs.lcp);
  Object.assign(lcp, { startTimeMs: 400, receivedAtMs: 410, delivery: 'callback', entryWindow: 'primary', accepted: true, renderTimeMs: 400, loadTimeMs: 350, size: 71757, elementKind: 'image', region: 'desktop-latest-card', loading: 'auto', fetchPriority: 'auto' });
  s.primary.lcpEntries = [lcp];
  s.primary.paintTimeline.entries = s.primary.paintEntries.map(({ name, startTimeMs, entryWindow }) => ({ name, startTimeMs, entryWindow }));
  s.late.paintTimeline.entries = clone(s.primary.paintTimeline.entries);
  Object.assign(s.primary.frames, { requestedCount: 1, completedCount: 1, maxDelayMs: 10, workMs: 0, samples: [{ requestedAtMs: 500, callbackAtMs: 510, frameTimestampMs: 510, withinPrimary: true }] });
  Object.assign(s.primary.milestones.initialLoad, { dataQueryStarted: 800, dataFetchCompleted: 1800, dataMergeCompleted: 1802, dataReady: 1805, clusterIndexStarted: 1850 });
  Object.assign(s.primary.milestones.criticalPath, { latestQueryStarted: 1000, latestRestaurantRowsReady: 2000, latestKpiStarted: 2010, latestKpiReady: 2200, latestSortReady: 2210, latestFirstCardCommitted: 2300 });
  s.primary.readiness.observedAtMs = 20001; s.primary.readbackWorkMs = 0;
  countEntries(s.primary); countEntries(s.late);
  return s;
}
const classify = (s) => classifySnapshot(s, { sourceSha }, { observedUrl: URL }, { width: 1363, height: 936, dpr: 1 });

function workspace(t) {
  const base = mkdtempSync(join(tmpdir(), 'paint-calibration-evidence-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'evidence'); const repository = join(base, 'repository');
  mkdirSync(root, { recursive: true }); mkdirSync(repository, { recursive: true });
  for (const path of TOOL_FILES) copyFileSync(join(here, path), join(root, path));
  for (const path of SOURCE_FILES) { mkdirSync(dirname(join(repository, path)), { recursive: true }); writeFileSync(join(repository, path), '// synthetic source bytes only\n'); }
  const protocolSha = sha(readFileSync(join(root, 'protocol.json')));
  const common = ['--root', root, '--repository', repository, '--protocol-sha256', protocolSha];
  const run = (command, args = [], script = 'record.mjs') => spawnSync(process.execPath, [join(root, script), ...(command ? [command] : []), ...common, ...args], { encoding: 'utf8' });
  const provider = { observedAtUtc: '2026-11-15T00:00:00.000Z', observedVia: 'vercel-dashboard', gitSha: sourceSha, deploymentId: 'dpl_Synthetic', projectId: 'prj_Synthetic', target: 'production', state: 'READY' };
  const health = { observedAtUtc: '2026-11-15T00:00:01.000Z', observedVia: 'cua-public-health', gitSha: sourceSha, deploymentId: 'dpl_Synthetic', ok: true };
  const identity = join(base, 'identity.json');
  writeFileSync(identity, JSON.stringify({ providerIdentity: provider, healthIdentity: health }));
  const planResult = run('plan', ['--source-sha', sourceSha, '--source-tree', 'b'.repeat(40), '--identity', identity, '--frozen-at', '2026-11-15T00:00:02.000Z']);
  assert.equal(planResult.status, 0, planResult.stderr);
  const record = (ordinal, value, outcome = null) => {
    const minute = String(ordinal).padStart(2, '0');
    const args = ['--ordinal', String(ordinal), '--started-at', `2026-11-15T00:${minute}:00.000Z`, '--observed-at', `2026-11-15T00:${minute}:35.000Z`, '--observed-url', URL];
    if (value) { const raw = join(base, `raw-${ordinal}.json`); writeFileSync(raw, `${JSON.stringify(value, null, 1)}\n`); args.push('--raw', raw); }
    if (outcome) args.push('--outcome', outcome);
    return run('attempt', args);
  };
  const seal = () => { const r = run('seal'); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).artifactMap.sha256; };
  const analyze = (mapSha) => run(null, ['--artifact-map-sha256', mapSha], 'analyze.mjs');
  const validate = (mapSha) => spawnSync('python3', ['-B', join(root, 'validate.py'), ...common, '--artifact-map-sha256', mapSha], { encoding: 'utf8' });
  return { root, repository, protocolSha, record, seal, analyze, validate, run };
}

test('strict schema rejects unknown content, oversized entry lists and nonnumeric timing', () => {
  const s = fixture();
  assert.deepEqual(schemaProblems(s, schema), []);
  assert.deepEqual(snapshotConsistencyProblems(s), []);
  const privateShape = clone(s); privateShape.rawDomText = 'untrusted-extra';
  assert.ok(schemaProblems(privateShape, schema).length);
  const cap = clone(s); cap.primary.paintEntries = Array.from({ length: 17 }, () => paint('first-paint', 1));
  assert.ok(schemaProblems(cap, schema).length);
  const wrongType = clone(s); wrongType.primary.paintEntries[0].startTimeMs = 'unknown';
  assert.ok(schemaProblems(wrongType, schema).length);
  const prototypeKey = JSON.parse(JSON.stringify(s).replace('"mode":"paint-calibration"', '"mode":"paint-calibration","constructor":"untrusted-extra"'));
  assert.ok(schemaProblems(prototypeKey, schema).length);
  assert.throws(() => parseJsonBytes(Buffer.from('{"capture":{"mode":"untrusted","mo\\u0064e":"paint-calibration"}}')), /Duplicate JSON key/);
  assert.deepEqual(parseJsonBytes(Buffer.from('{"a":[{"text":"\\\"{}[],:"}],"b":1}')), { a: [{ text: '"{}[],:' }], b: 1 });
});

test('timeline-only FCP is corroboration, never an observer fallback or zero', () => {
  const s = fixture(); s.primary.paintEntries = s.primary.paintEntries.filter((e) => e.name !== 'first-contentful-paint'); countEntries(s.primary);
  const result = classify(s);
  assert.equal(result.fcp.primaryObserverMs, null);
  assert.equal(result.fcp.deliveredByNominalCutoffMs, null);
  assert.equal(result.fcp.primaryTimelineMs, 300);
  assert.deepEqual(result.fcp.classifications, ['paint-timeline-without-corresponding-observer-entry']);
  assert.equal(result.lcp.primaryCandidate.region, 'desktop-latest-card');
});

test('nominal-cutoff delay, post-checkpoint delivery and true tail event remain distinct', () => {
  const s = fixture();
  s.primary.paintEntries[1].receivedAtMs = 20000.5; s.primary.paintEntries[1].delivery = 'drain';
  s.late.paintEntries = [paint('first-contentful-paint', 300, 25000), paint('first-contentful-paint', 26000, 26010)];
  countEntries(s.primary); countEntries(s.late);
  const result = classify(s);
  assert.equal(result.fcp.primaryObserverMs, 300);
  assert.equal(result.fcp.deliveredByNominalCutoffMs, null);
  assert.equal(result.fcp.delayedPrimaryObserverMs, 300);
  assert.equal(result.fcp.tailObserverMs, 26000);
  assert.equal(result.fcp.primaryWindowDeliveriesAfterNominalCutoffCount, 2);
  assert.deepEqual(result.fcp.classifications, ['observed-by-primary-checkpoint', 'primary-window-entry-delivered-after-nominal-cutoff', 'primary-window-entry-delivered-after-checkpoint', 'tail-window-entry-observed']);
});

test('late frame callback cannot establish primary progress; false focus remains context', () => {
  const s = fixture();
  s.capture.primaryCheckpointAtMs = s.primary.observedAtMs = 20500;
  Object.assign(s.primary.frames.samples[0], { callbackAtMs: 20300, frameTimestampMs: 20300, withinPrimary: false }); s.primary.frames.maxDelayMs = 19800;
  for (const segment of ['primary', 'late']) { const c = s[segment].context; c.focusAtSetup = false; c.focusAtRead = false; c.focusTrueSampleCount = 0; c.focusFalseSampleCount = 1; }
  const result = classify(s);
  assert.deepEqual(result.contextProblems, []);
  assert.equal(result.frame.classification, 'frame-callbacks-only-after-nominal-cutoff');
  assert.equal(result.frame.withinPrimaryCompletedCount, 0);
  assert.equal(result.frame.afterNominalCutoffCompletedCount, 1);
  assert.deepEqual(result.consistencyProblems, []);
});

test('caps, unsupported navigation and unknown timing are retained with explicit limits', () => {
  const s = fixture();
  s.navigation = null; s.support.navigation = false;
  s.primary.entryCapReached = true; s.primary.observerStats.paint.droppedByCapCount = 2;
  s.primary.observerStats.paint.receivedEntryCount += 2; s.primary.observerStats.paint.callbackEntryCount += 2; s.primary.observerStats.paint.acceptedEntryCount += 2;
  s.primary.frames.samples[0].callbackAtMs = null; s.primary.frames.maxDelayMs = null;
  const result = classify(s);
  assert.ok(result.contextProblems.includes('NAVIGATION_CONTEXT'));
  assert.ok(result.limitations.includes('UNSUPPORTED:navigation'));
  assert.ok(result.limitations.includes('primary:ENTRY_CAP'));
  assert.ok(result.consistencyProblems.includes('FRAME_SAMPLE'));
  assert.ok(result.consistencyProblems.includes('FRAME_MAX_DELAY'));
});

test('write-once recording preserves exact raw bytes and retains unavailable planned attempts', (t) => {
  const w = workspace(t);
  assert.equal(w.record(1, fixture()).status, 0);
  const retained = readFileSync(join(w.root, 'inputs/01.snapshot.json'));
  assert.equal(retained.toString(), `${JSON.stringify(fixture(), null, 1)}\n`);
  assert.notEqual(w.record(1, fixture()).status, 0);
  assert.notEqual(w.record(0, fixture()).status, 0);
  assert.notEqual(w.record(4, fixture()).status, 0);
  assert.equal(w.record(2, null, 'collector-unavailable').status, 0);
  assert.equal(w.record(3, fixture()).status, 0);
  const mapSha = w.seal();
  assert.equal(w.analyze(mapSha).status, 0);
  const analysis = JSON.parse(readFileSync(join(w.root, 'analysis.json')));
  assert.equal(analysis.retainedReceiptCount, 3);
  assert.equal(analysis.retainedSnapshotCount, 2);
  assert.equal(analysis.visits[1].observation, null);
  assert.equal(analysis.admission.performanceComparisonCount, 0);
  const validation = w.validate(mapSha);
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).status, 'evidence-and-diagnostic-classifications-verified');
  assert.notEqual(w.analyze(mapSha).status, 0);
});

test('independent Python matches missing paint, delayed boundaries, caps, and null API context', (t) => {
  const w = workspace(t);
  const a = fixture(); a.primary.paintEntries = []; a.primary.lcpEntries = []; countEntries(a.primary);
  const b = fixture(); b.primary.paintEntries[1].receivedAtMs = 20000.5; b.late.paintEntries = [paint('first-contentful-paint', 300, 22000), paint('first-contentful-paint', 26000)]; countEntries(b.late);
  b.capture.primaryCheckpointAtMs = b.primary.observedAtMs = 20500;
  Object.assign(b.primary.frames.samples[0], { callbackAtMs: 20300, frameTimestampMs: 20300, withinPrimary: false }); b.primary.frames.maxDelayMs = 19800;
  const c = fixture(); c.navigation = null; c.support.navigation = false; c.primary.entryCapReached = true;
  c.primary.frames.samples[0].callbackAtMs = null; c.primary.frames.maxDelayMs = null; c.capture.finalizedAtMs = null;
  for (const [i, s] of [a, b, c].entries()) { const r = w.record(i + 1, s); assert.equal(r.status, 0, r.stderr); }
  const mapSha = w.seal(); const result = w.analyze(mapSha); assert.equal(result.status, 0, result.stderr);
  const validated = w.validate(mapSha); assert.equal(validated.status, 0, validated.stderr);
});

test('detached seal, receipt hash, source binding, and independent analysis reject tampering', (t) => {
  const w = workspace(t);
  for (const i of [1, 2, 3]) assert.equal(w.record(i, fixture()).status, 0);
  const mapSha = w.seal();
  assert.throws(() => readSealed(w.root, w.repository, '0'.repeat(64), w.protocolSha), /Detached artifact map mismatch/);
  const rawPath = join(w.root, 'inputs/01.snapshot.json'); const raw = readFileSync(rawPath);
  writeFileSync(rawPath, `${raw.toString()} `);
  assert.throws(() => readSealed(w.root, w.repository, mapSha, w.protocolSha), /Artifact inventory or bytes changed/);
  writeFileSync(rawPath, raw);
  const sourcePath = join(w.repository, SOURCE_FILES[0]); const source = readFileSync(sourcePath);
  writeFileSync(sourcePath, '// changed synthetic source\n');
  assert.throws(() => readSealed(w.root, w.repository, mapSha, w.protocolSha), /Frozen source\/tool bytes changed/);
  writeFileSync(sourcePath, source);
  assert.equal(w.analyze(mapSha).status, 0);
  const analysisPath = join(w.root, 'analysis.json'); const analysis = JSON.parse(readFileSync(analysisPath));
  analysis.visits[0].observation.fcp.primaryObserverMs = 0;
  writeFileSync(analysisPath, JSON.stringify(analysis));
  const validation = w.validate(mapSha);
  assert.notEqual(validation.status, 0);
  assert.match(validation.stderr, /Independent classification\/scalar mismatch/);
  assert.equal(existsSync(join(w.root, 'validated.json')), false);
});
