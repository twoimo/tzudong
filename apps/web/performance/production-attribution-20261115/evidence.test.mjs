import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, TOOL_PATHS, conforms, snapshotProblems, scalarValues, attribution, createMap, verifiedMap, hash, writeJson } from './evidence.mjs';
import { score, compare } from './score.mjs';

const schema = JSON.parse(readFileSync(join(ROOT, 'snapshot.schema.json')));
const source = 'a'.repeat(40);
const viewport = { width: 1440, height: 900, dpr: 1 };
const cohort = { viewport };
function empty(spec) {
  if (Object.hasOwn(spec, 'const')) return spec.const;
  if (spec.anyOf) return empty(spec.anyOf[0]);
  if (spec.enum) return spec.enum[0];
  if ([].concat(spec.type).includes('null')) return null;
  if (spec.type === 'object') return Object.fromEntries(Object.entries(spec.properties).map(([k, v]) => [k, empty(v)]));
  if (spec.type === 'array') return [];
  if (spec.type === 'boolean') return false;
  return spec.minimum ?? 0;
}
function fixture() {
  const s = empty(schema);
  Object.assign(s.capture, { observerSetupMs: 10, frozenAtMs: 20001, visibilityAtStart: 'visible', contextUnchanged: true, observerWorkMs: 0.1, readinessWorkMs: 1, readinessSamples: 39 });
  s.binding.gitSha = source;
  s.viewport = { initial: { ...viewport }, final: { ...viewport } };
  for (const k of Object.keys(s.support)) s.support[k] = true;
  s.navigation = { ...empty(schema.properties.navigation.anyOf[1]), type: 'navigate', startTime: 0, activationStart: 0, redirectCount: 0,
    workerStart: 0, domainLookupStart: 10, domainLookupEnd: 20, connectStart: 20, connectEnd: 70, secureConnectionStart: 0,
    requestStart: 80, responseStart: 100, responseEnd: 180, domInteractive: 190, domContentLoadedEventEnd: 200, loadEventEnd: 1000,
    transferSize: 100, encodedBodySize: 100, decodedBodySize: 100 };
  s.paints = { fpMs: 190, fcpMs: 200, windowLcp: { ...empty(schema.properties.paints.properties.windowLcp.anyOf[1]),
    startTimeMs: 300, observedAtMs: 310, renderTimeMs: 300, loadTimeMs: 0, size: 100, elementKind: 'text', ttfbMs: 100,
    resourceLoadDelayMs: 0, resourceLoadDurationMs: 0, elementRenderDelayMs: 200 } };
  s.longTasks = { ...empty(schema.properties.longTasks.anyOf[1]), totalDurationMs: 0, longTaskBlockingSumMs: 0, maxDurationMs: 0 };
  s.resources.byCategory = [{ ...empty(schema.properties.resources.properties.byCategory.anyOf[1].items), category: 'naver-sdk', count: 1,
    completedCount: 1, unknownTimingCount: 1, firstStartMs: 100, lastResponseEndMs: 200, totalDurationMs: 100 }];
  Object.assign(s.milestones, { homeClientCommitted: 200, dataQueryStarted: 210, dataFetchCompleted: 350, dataMergeCompleted: 390, dataReady: 400,
    naverSdkRequested: 300, naverSdkReady: 420, mapConstructionStarted: 430, mapConstructed: 450, clusterIndexStarted: 460, clusterIndexReady: 470,
    controlsReady: 500, mapVisible: 1000, desktopPanelReady: 500, initialSkeletonHidden: 500 });
  s.milestoneCounts = { fetchedRows: 1, restaurantCount: 1, clusterInputCount: 1 };
  Object.assign(s.completeness, { observedAtMs: 19500, controlsReady: true, dataReady: true, mapConstructed: true, mapVisible: true,
    desktopPanelReady: true, visibleTileCount: 1, visibleMarkerCount: 1, desktopPopularItemCount: 1, desktopLatestItemCount: 1 });
  return s;
}
function pythonCheck(samples) {
  const script = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('validator',sys.argv[1]); v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
data=json.load(sys.stdin); schema=json.load(open(sys.argv[2]))
print(json.dumps([v.snapshot_valid(s,{'viewport':data['viewport']},data['source'],schema) for s in data['samples']]))`;
  return JSON.parse(execFileSync('python3', ['-B', '-c', script, join(ROOT, 'validate.py'), join(ROOT, 'snapshot.schema.json')],
    { input: JSON.stringify({ samples, viewport, source }), encoding: 'utf8' }));
}

test('numeric snapshot admits unknown TAO/cache without manufacturing a cache state', () => {
  const s = fixture();
  assert.equal(conforms(s, schema), true);
  assert.deepEqual(snapshotProblems(s, cohort, source, schema), []);
  assert.deepEqual(pythonCheck([s]), [true]);
});

test('independent validators reject changed context, input, hidden, resize, source, missing content and after-cutoff readiness', () => {
  const edits = [s => { s.capture.contextUnchanged = false; }, s => { s.capture.trustedInputCount = 1; },
    s => { s.capture.firstHiddenAtMs = 100; }, s => { s.capture.resizeCount = 1; }, s => { s.binding.gitSha = 'b'.repeat(40); },
    s => { s.completeness.visibleTileCount = 0; }, s => { s.milestones.mapVisible = 20001; }];
  const cases = edits.map(edit => { const s = fixture(); edit(s); return s; });
  for (const s of cases) assert.ok(snapshotProblems(s, cohort, source, schema).length > 0);
  assert.deepEqual(pythonCheck(cases), cases.map(() => false));
});

test('unavailable LCP resource detail stays null; invented zero subparts fail', () => {
  const s = fixture();
  Object.assign(s.paints.windowLcp, { resourceApplicable: true, resourceCategory: 'naver-image', resourceStartMs: 150,
    resourceLoadDelayMs: null, resourceLoadDurationMs: null, elementRenderDelayMs: null });
  assert.deepEqual(snapshotProblems(s, cohort, source, schema), []);
  const bad = structuredClone(s);
  bad.paints.windowLcp.resourceLoadDurationMs = 0;
  assert.ok(snapshotProblems(bad, cohort, source, schema).includes('LCP_UNKNOWN_AS_ZERO'));
  assert.deepEqual(pythonCheck([s, bad]), [true, false]);
});

test('completed long-task arithmetic is independently checked and cutoff crossing withholds only its scalar', () => {
  const s = fixture();
  Object.assign(s.longTasks, { count: 1, totalDurationMs: 100, longTaskBlockingSumMs: 50, maxDurationMs: 100,
    completedEntries: [{ startTimeMs: 500, durationMs: 100 }] });
  assert.deepEqual(snapshotProblems(s, cohort, source, schema), []);
  const bad = structuredClone(s); bad.longTasks.longTaskBlockingSumMs = 51;
  assert.ok(snapshotProblems(bad, cohort, source, schema).includes('LONGTASK_ARITHMETIC'));
  const crossing = structuredClone(s); crossing.longTasks.crossingCutoffCount = 1;
  assert.deepEqual(snapshotProblems(crossing, cohort, source, schema), []);
  assert.equal(scalarValues(crossing).completedWindowLongTaskExcessMs, null);
  assert.deepEqual(pythonCheck([s, bad, crossing]), [true, false, true]);
});

test('privacy whitelist rejects raw text and identifiers', () => {
  const s = fixture(); s.headers = { sample: 'synthetic-only' };
  assert.equal(conforms(s, schema), false);
  assert.deepEqual(pythonCheck([s]), [false]);
});

test('unavailable navigation or inconsistent long-task availability is retained as invalid without crashing', () => {
  const s = fixture();
  s.navigation = null;
  s.support.navigation = false;
  Object.assign(s.paints.windowLcp, { resourceApplicable: true, timingDetailAvailable: true,
    resourceRequestStartMs: 110, resourceResponseEndMs: 230, ttfbMs: null,
    resourceLoadDelayMs: null, resourceLoadDurationMs: null, elementRenderDelayMs: null });
  assert.ok(snapshotProblems(s, cohort, source, schema).length > 0);
  assert.equal(scalarValues(s).ttfbMs, null);
  assert.doesNotThrow(() => attribution(s));
  const tasks = fixture(); tasks.longTasks = null;
  assert.ok(snapshotProblems(tasks, cohort, source, schema).includes('LONGTASK_SUPPORT'));
  assert.equal(attribution(tasks).longTaskMetricUnavailableReason, 'unavailable');
  assert.deepEqual(pythonCheck([s, tasks]), [false, false]);
});

test('absolute, relative, strict MAD and quantization gates are symmetric', () => {
  const settings = { minimumRelativeChange: 0.1, noiseMultiplier: 2 };
  const budget = { minimumAbsoluteChange: 100, target: 800 };
  assert.equal(compare([1000,1000,1000,1000,1000], [700,700,700,700,700], budget, settings, true).classification, 'improved');
  assert.equal(compare([1000,1000,1000,1000,1000], [1200,1200,1200,1200,1200], budget, settings, true).classification, 'regressed');
  assert.equal(compare([800,900,1000,1100,1200], [600,700,800,900,1000], budget, settings, true).classification, 'no-confirmed-change');
  assert.equal(compare([1000,1000,1000,1000,1000], [700,700,700,700,700], { ...budget, minimumAbsoluteChange: 500 }, settings, true).classification, 'no-confirmed-change');
  assert.equal(compare([0,0,0,0,0], [0,0,0,0,0], budget, settings, true).relativeReduction, null);
  assert.equal(compare([1000,1000,1000,1000], [700,700,700,700,700], budget, settings, true).classification, 'not-comparable');
});

test('empty evidence is a verified zero-admission incomplete result; detached hash detects tampering', () => {
  const root = mkdtempSync(join(tmpdir(), 'production-attribution-selftest-'));
  try {
    for (const path of TOOL_PATHS) copyFileSync(join(ROOT, path), join(root, path));
    const seal = createMap({ root, stage: 'before' });
    const result = score({ root, artifactMap: seal.artifactMap, artifactMapSha256: seal.artifactMapSha256 });
    assert.equal(result.comparableMetricCount, 0);
    assert.equal(result.fieldAdmissionCount, 0);
    writeJson(root, 'scored.json', result);
    const verified = JSON.parse(execFileSync('python3', ['-B', join(ROOT, 'validate.py'), '--root', root,
      '--artifact-map', seal.artifactMap, '--artifact-map-sha256', seal.artifactMapSha256], { encoding: 'utf8' }));
    assert.equal(verified.status, 'evidence-and-scalars-verified');
    assert.equal(verified.comparableMetricCount, 0);
    writeFileSync(join(root, 'snapshot.schema.json'), '{}\n');
    assert.throws(() => verifiedMap(root, seal.artifactMap, seal.artifactMapSha256), /artifact changed/);
    assert.throws(() => verifiedMap(root, seal.artifactMap, '0'.repeat(64)), /map hash mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
