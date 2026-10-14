import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('./', import.meta.url);
const median = values => { const a = [...values].sort((x, y) => x - y), n = a.length; assert.ok(n > 0); return n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const quantile = (values, q) => { const a = [...values].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const planRaw = await readFile(new URL('PLAN-v4.json', here)), plan = JSON.parse(planRaw);
const schedule = JSON.parse(await readFile(new URL('series-plan-v1.json', here)));
assert.equal(schedule.planSha256, hash(planRaw));
assert.equal(schedule.schedule.length, 22);
const complete = JSON.parse(await readFile(new URL('series-complete-v1.json', here)));
assert.equal(complete.independentProcesses, 22);
const runs = [];
for (const entry of schedule.schedule) {
  const raw = await readFile(new URL(`ui-${entry.label}/raw.json`, here)), result = JSON.parse(raw);
  assert.equal(result.passed, true); assert.equal(result.cycles.length, 256);
  assert.equal(result.diagnosticOnly, false);
  assert.equal(result.sourceCommit, entry.kind === 'baseline' ? plan.beforeSource : plan.candidateSource);
  assert.equal(result.browserVersion, plan.conditions.chrome);
  assert.equal(result.sdkScript.sha256, '802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1');
  assert.equal(result.environment.cpuRate, 4); assert.equal(result.environment.forcedGC, false);
  assert.equal(result.errors.page, 0); assert.equal(result.physicalDevice, false);
  assert.equal(result.sdk.stub, false); assert.equal(result.requests.unsupportedFixtureQueries ?? 0, 0);
  for (const cycle of result.cycles) assert.ok(cycle.relatedDeletedReviewObserved && cycle.state.panelMatches && cycle.state.selectedMarkerPresent && cycle.state.duplicateMarkers === 0 && cycle.state.mapCreates === 1);
  const latencies = result.cycles.map(row => row.state.inputToObservedMs);
  assert.ok(latencies.every(x => Number.isFinite(x) && x > 0));
  const values = { endHeapBytes: result.endHeap.usedSize, idleHeapBytes: result.idleHeap.usedSize,
    reviewVisibleMedianMs: median(result.cycles.map(row=>row.reviewObservedMs)), restaurantRequests:result.requests.restaurant, selectionLatencyMedianMs: median(latencies), selectionLatencyWithinRunP95Ms: quantile(latencies, 0.95) };
  assert.ok(Object.values(values).every(x => Number.isFinite(x) && x > 0));
  runs.push({ ...entry, rawSha256: hash(raw), ...values, restaurantRequests: result.requests.restaurant,
    sdkConsoleIncidents: result.errors.console, rawDiagnosticOnly: result.diagnosticOnly });
}
let seed = 20261015;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const metrics = [];
for (const [metric, guard] of [['endHeapBytes', 20], ['idleHeapBytes', 20], ['selectionLatencyMedianMs', 15], ['reviewVisibleMedianMs', null], ['restaurantRequests', null]]) {
  const aa = runs.filter(x => x.phase === 'AA').map(x => x[metric]);
  const pairs = Array.from({ length: 9 }, (_, index) => ({
    before: runs.find(x => x.pair === index + 1 && x.kind === 'baseline')[metric],
    after: runs.find(x => x.pair === index + 1 && x.kind === 'candidate')[metric],
  }));
  const before = median(pairs.map(x => x.before)), after = median(pairs.map(x => x.after));
  const absolute = before - after, relativePercent = absolute / before * 100;
  const pairedRegressions = pairs.map(x => (x.after / x.before - 1) * 100);
  const bootAbsolute = [], bootRelative = [], bootPairedRegression = [];
  for (let repeat = 0; repeat < 20000; repeat += 1) {
    const sample = Array.from({ length: 9 }, () => pairs[Math.floor(random() * 9)]);
    const b = median(sample.map(x => x.before)), a = median(sample.map(x => x.after));
    bootAbsolute.push(b - a); bootRelative.push((b - a) / b * 100);
    bootPairedRegression.push(median(sample.map(x => (x.after / x.before - 1) * 100)));
  }
  const interval = values => [quantile(values, 0.025), quantile(values, 0.975)];
  const absoluteCI = interval(bootAbsolute), relativeCI = interval(bootRelative), regressionCI = interval(bootPairedRegression);
  const guardPass = guard===null ? null : regressionCI[1] <= guard;
  const practical = metric.endsWith('Bytes') ? absolute >= 1000000 : null;
  metrics.push({ metric, nPairs: 9, beforeMedian: before, afterMedian: after, absoluteDecrease: absolute,
    relativeImprovementPercent: relativePercent, absoluteDecrease95CI: absoluteCI, relativeImprovement95CI: relativeCI,
    medianPairedRegressionPercent: median(pairedRegressions), pairedRegression95CI: regressionCI,
    fixedRegressionGuardPercent: guard, guardPass, pairsExceedingGuard: guard === null ? null : pairedRegressions.filter(x => x > guard).length,
    positiveImprovementProven: absoluteCI[0] > 0, practicalMemoryThresholdMet: practical,
    judgement: guard!==null&&!guardPass ? 'regression guard unproven or violated' : absoluteCI[0] <= 0 ? 'improvement unproven' : practical === false ? 'below practical memory threshold' : 'measured local metric difference',
    AA: { nIndependentProcesses: 4, median: median(aa), minimum: Math.min(...aa), maximum: Math.max(...aa),
      MAD: median(aa.map(x => Math.abs(x - median(aa)))), rangeRelativeToMedianPercent: (Math.max(...aa) - Math.min(...aa)) / median(aa) * 100 }, pairs });
}
const result = { planSha256: hash(planRaw), independentProcesses: 22, ABPairs: 9, AAProcesses: 4, dependentActions: 5632,
  functionalAssertionsPassed: true, metrics, runs, bootstrap: { seed: 20261015, repeats: 20000, method: 'paired percentile bootstrap of per-process medians; approximate small-sample intervals' },
  rawDiagnosticOnlyFlag: false, primaryGuardEvaluation: 'predeclared matched natural conditions from PLAN-v4; no profiler or forced GC',
  independentPopulationP95: null, fieldAdmission: 0, physicalDevice: false, productionDeployment: false,
  performanceAdmitted: false, remainingAdmission: 'all primary guard bounds, actual database/count-cost and viewport/invalidation cases, independent validation and canonical scoring',
  allPrimaryGuardsSupported: metrics.filter(x=>x.fixedRegressionGuardPercent!==null).every(x => x.guardPass) };
await writeFile(new URL('statistics-v1.json', here), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ allPrimaryGuardsSupported: result.allPrimaryGuardsSupported, metrics: metrics.map(({ pairs, AA, ...row }) => row) }, null, 2));
