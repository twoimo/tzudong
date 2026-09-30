import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const SHA256 = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const PRIMARY_METRIC = 'clickToExpandedMs';
const RESAMPLES = 10_000;
const BASE_SEED = 0x20260930;
const TIMER_RESOLUTION_MS = 0.1;
const EXPECTED_PRIMARY_PAIRS = 31;
const EXPECTED_SECONDARY_PAIRS = 9;
const EXPECTED_WARMUPS = 2;
const FINAL_PLAN_NAME = 'plan-v6.json';
const FINAL_CANDIDATE_RECEIPT = /^build-candidate-v7\/BUILD_ID$/;
const FINAL_PRIMARY_RAW = 'paired-v6/raw.json';
const FINAL_SECONDARY_RAW = 'secondary-v5/raw.json';
const FROZEN_BUDGETS = {
  absoluteMs: 50,
  relativeFraction: 0.1,
  noiseMultiplier: 2,
  admission: 'paired bootstrap median reduction 95% CI lower bound > 0, reduction > max(50ms,10% baseline median,2*maxMAD,A/A absolute median difference)',
  regressionMs: 50,
  regressionRelativeFraction: 0.1,
  memoryRegressionFraction: 0.2,
};
const FROZEN_PRIMARY_CELLS = [
  { mobile: false, count: 735, cpu: 4 },
  { mobile: true, count: 735, cpu: 4 },
];
const FROZEN_SECONDARY_CELLS = [
  { mobile: false, count: 3, cpu: 1 },
  { mobile: false, count: 2000, cpu: 4 },
  { mobile: true, count: 735, cpu: 1, throttle: true },
];
const FROZEN_VALIDITY = 'clicked count and regional marker coordinate equal synthetic single-Seoul membership. Postclick idle epoch increases; target center/zoom reached; same member+geo+bounds/maprect/epoch observed >=2 consecutive frames; all expected padded-bound IDs present at final same geo.';
const FINAL_CORRECTNESS_GATE = 'Pooled marker reuse must replace static icon content when restaurant ID, marker semantics or visit badge differ. Existing same-identity review-bubble patch keeps image DOM. Browser pan round trip compares provider marker DOM IDs. Warm-cache offscreen pan-return must restore exact DOM-ID/SDK-position pairs; lightweight viewport invalidation must not wait for expensive cluster debounce. Unchanged idle performs zero provider setters.';

const metricSpecs = [
  ['clickToExpandedMs', 'summary.clickToExpandedMs', 'ms', TIMER_RESOLUTION_MS],
  ['maxFrameGapMs', 'summary.maxFrameGapMs', 'ms', TIMER_RESOLUTION_MS],
  ['longTaskMs', 'summary.longTaskMs', 'ms', TIMER_RESOLUTION_MS],
  ['longTaskCount', 'summary.longTaskCount', 'count', 1],
  ['markerlessFrames', 'summary.markerlessFrames', 'count', 1],
  ['frameCount', 'summary.frames', 'count', 1],
  ['missedFrameFraction', 'summary.missedFrameFraction', 'fraction', Number.EPSILON],
  ['markerCount', 'summary.markerCount', 'count', 1],
  ['domCount', 'summary.domCount', 'count', 1],
  ['heapBytes', 'summary.heapBytes', 'bytes', 1],
  ['fcpMs', 'load.fcp', 'ms', TIMER_RESOLUTION_MS],
  ['lcpMs', 'load.lcp', 'ms', TIMER_RESOLUTION_MS],
  ['fixturePayloadBytes', '$fixtureBytes', 'bytes', 1],
  ['fixtureRequestCount', '$fixtureRequests', 'count', 1],
];

const fail = message => { throw new Error(`render-flow score: ${message}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function parseArgs(argv) {
  const result = { raw: [], 'additional-aa': [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!value || !['--plan', '--aa', '--additional-aa', '--resources-plan', '--raw', '--output'].includes(flag)) fail('invalid CLI');
    if (flag === '--raw' || flag === '--additional-aa') result[flag.slice(2)].push(value);
    else if (result[flag.slice(2)]) fail(`duplicate ${flag}`);
    else result[flag.slice(2)] = value;
  }
  if (!result.plan || !result.aa || !result['resources-plan'] || !result.output || result.raw.length === 0) fail('missing CLI input');
  if (result.plan.split('/').at(-1) !== FINAL_PLAN_NAME) fail('final scoring requires plan-v6.json');
  return result;
}

function resolved(path) { return isAbsolute(path) ? path : resolve(process.cwd(), path); }
function displayPath(path) {
  const absolute = resolved(path), fromHere = relative(HERE, absolute);
  return fromHere.startsWith('..') || isAbsolute(fromHere) ? absolute : fromHere || '.';
}
async function jsonArtifact(path, label) {
  const bytes = await readFile(resolved(path));
  let value;
  try { value = JSON.parse(bytes); } catch { fail(`${label} is not JSON`); }
  return { path: displayPath(path), sha256: hash(bytes), bytes, value };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function percentile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * probability;
  const low = Math.floor(position), high = Math.ceil(position), weight = position - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}
function distribution(values) {
  if (!values.length) return null;
  if (values.some(value => !finite(value))) fail('non-finite metric');
  const center = median(values);
  return {
    n: values.length,
    median: center,
    mad: median(values.map(value => Math.abs(value - center))),
    min: Math.min(...values),
    max: Math.max(...values),
    p95: values.length >= 20 ? { value: percentile(values, 0.95), use: 'descriptive_only' } : null,
  };
}
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function seedFor(text, salt) {
  const digest = createHash('sha256').update(`${BASE_SEED}:${salt}:${text}`).digest();
  return digest.readUInt32LE(0);
}
function ci(values) {
  return { lower: percentile(values, 0.025), upper: percentile(values, 0.975) };
}
function pairedBootstrap(pairs, key) {
  const seed = seedFor(key, 'paired-index'), random = mulberry32(seed), results = [];
  for (let repeat = 0; repeat < RESAMPLES; repeat++) {
    const before = [], after = [];
    for (let draw = 0; draw < pairs.length; draw++) {
      const pair = pairs[Math.floor(random() * pairs.length)];
      before.push(pair.before); after.push(pair.after);
    }
    results.push(median(before) - median(after));
  }
  return { method: 'paired_index_percentile', statistic: 'median_before_minus_median_after', seed, resamples: RESAMPLES, ci95: ci(results) };
}
function adjacentBlockBootstrap(pairs, key) {
  const ordered = [...pairs].sort((a, b) => a.index - b.index);
  const singleton = ordered.length % 2 ? ordered.at(-1) : null;
  const pairedRows = singleton ? ordered.slice(0, -1) : ordered;
  const blocks = [];
  for (let index = 0; index < pairedRows.length; index += 2) blocks.push(pairedRows.slice(index, index + 2));
  const seed = seedFor(key, 'adjacent-ab-ba-block'), random = mulberry32(seed), results = [];
  for (let repeat = 0; repeat < RESAMPLES; repeat++) {
    const before = [], after = [];
    for (let draw = 0; draw < blocks.length; draw++) {
      for (const pair of blocks[Math.floor(random() * blocks.length)]) { before.push(pair.before); after.push(pair.after); }
    }
    if (singleton) { before.push(singleton.before); after.push(singleton.after); }
    results.push(median(before) - median(after));
  }
  return {
    method: 'adjacent_ab_ba_blocks_percentile',
    statistic: 'median_before_minus_median_after',
    seed,
    resamples: RESAMPLES,
    blocks: blocks.length,
    trailingSingletonPolicy: singleton ? 'retain_once_in_every_resample' : 'none',
    ci95: ci(results),
  };
}

function valueAt(sample, path) {
  if (path === '$fixtureBytes') return sample.requests.reduce((sum, request) => sum + request.bytes, 0);
  if (path === '$fixtureRequests') return sample.requests.length;
  return path.split('.').reduce((value, key) => value?.[key], sample);
}
function pairValues(pairs, path) {
  return pairs.map(pair => ({ index: pair.index, order: pair.order, before: valueAt(pair.baseline, path), after: valueAt(pair.candidate, path) }));
}
function metricScore(pairs, spec, cellKey) {
  const [name, path, unit, resolution] = spec, values = pairValues(pairs, path);
  const before = values.map(value => value.before), after = values.map(value => value.after);
  const baseline = distribution(before), candidate = distribution(after), delta = baseline.median - candidate.median;
  return {
    unit,
    baseline,
    candidate,
    deltaBeforeMinusAfter: delta,
    relativeDeltaFraction: baseline.median > resolution ? delta / baseline.median : null,
    relativeNullReason: baseline.median > resolution ? null : 'baseline_zero_or_at_or_below_resolution',
    timerResolution: unit === 'ms' ? TIMER_RESOLUTION_MS : null,
    ...(name === PRIMARY_METRIC ? {
      pairedBootstrap: pairedBootstrap(values, `${cellKey}:${name}`),
      adjacentBlockBootstrap: adjacentBlockBootstrap(values, `${cellKey}:${name}`),
    } : {}),
  };
}

function optionsKey(options) {
  const keys = Object.keys(options).sort();
  return keys.map(key => `${key}=${JSON.stringify(options[key])}`).join(';');
}
function expectedOrder(cell, index) { return (index + cell) % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']; }

function validateSnapshot(snapshot, resources) {
  if (!snapshot || typeof snapshot !== 'object') fail('missing resource snapshot');
  for (const field of ['otherCpuPercent', 'maxOtherProcessCpuPercent']) if (!finite(snapshot[field]) || snapshot[field] < 0) fail(`invalid resource ${field}`);
  if (!Number.isSafeInteger(snapshot.logicalCores) || snapshot.logicalCores < 1 || !Number.isSafeInteger(snapshot.otherProcessesOver80Percent) || snapshot.otherProcessesOver80Percent < 0) fail('invalid resource counts');
  if (!Array.isArray(snapshot.loadAverage) || snapshot.loadAverage.length !== 3 || snapshot.loadAverage.some(value => !finite(value) || value < 0)) fail('invalid resource load');
  if (snapshot.gpuLoad !== 'unavailable' || Number.isNaN(Date.parse(snapshot.observedAt))) fail('invalid resource metadata');
  const heavy = snapshot.maxOtherProcessCpuPercent >= resources.heavyOverlapOtherSingleProcessCpuPercent;
  const saturated = snapshot.otherCpuPercent > snapshot.logicalCores * resources.saturationOtherCpuFractionOfLogicalCoreCapacity * 100
    || snapshot.loadAverage[0] > snapshot.logicalCores * resources.saturationLoad1FractionOfLogicalCores;
  if (snapshot.heavyOverlap !== heavy || snapshot.saturated !== saturated) fail('resource classification mismatch');
}
function captureIssues(sample) {
  const issues = [];
  if (!sample || typeof sample !== 'object') return ['missing_sample'];
  if (!sample.errors || sample.errors.page !== 0) issues.push('page_errors');
  if (!sample.errors || sample.errors.console !== 0) issues.push('console_errors');
  if (!Array.isArray(sample.requests) || sample.requests.some(request => request.completed !== true || !Number.isSafeInteger(request.rows) || request.rows < 0 || !Number.isSafeInteger(request.bytes) || request.bytes < 0)) issues.push('fixture_request_errors');
  const summary = sample.summary, load = sample.load;
  if (!summary || !load) return [...issues, 'missing_metrics'];
  for (const [, path] of metricSpecs) {
    const value = valueAt(sample, path);
    if (!finite(value) || value < 0) issues.push(`invalid_${path.replaceAll('.', '_')}`);
  }
  const duration = summary.end - summary.start;
  if (!finite(summary.start) || !finite(summary.end) || summary.start < 0 || duration <= 0 || duration > 60_000) issues.push('invalid_capture_period');
  if (!(summary.clickToExpandedMs > 0 && summary.clickToExpandedMs <= duration + TIMER_RESOLUTION_MS)) issues.push('click_outside_capture_period');
  if (!(summary.maxFrameGapMs >= 0 && summary.maxFrameGapMs <= duration + TIMER_RESOLUTION_MS)) issues.push('frame_gap_outside_capture_period');
  if (!(summary.longTaskMs >= 0 && summary.longTaskMs <= duration + TIMER_RESOLUTION_MS)) issues.push('long_task_outside_capture_period');
  if (!(summary.missedFrameFraction >= 0 && summary.missedFrameFraction <= 1)) issues.push('invalid_missed_frame_fraction');
  if (summary.mapCount !== 1 || load.maps !== 1) issues.push('map_count_not_one');
  if (summary.viewportOverflow !== 0) issues.push('viewport_overflow');
  if (!Number.isSafeInteger(summary.markerCount) || summary.markerCount < 1) issues.push('no_final_marker');
  if (summary.valid !== true || !Array.isArray(summary.expectedIds) || !Array.isArray(summary.actualIds) || !Array.isArray(summary.missingIds) || summary.expectedIds.length < 1 || summary.missingIds.length !== 0 || summary.expectedIds.some(id => !summary.actualIds.includes(id))) issues.push('final_padded_bounds_members_invalid');
  if (!Number.isSafeInteger(summary.stableFrames) || summary.stableFrames < 2) issues.push('first_marker_not_stable');
  const first = summary.firstMarker, final = summary.finalVisibleMember;
  const intersects = marker => marker?.hitTest === true && marker.geo?.idleEpoch > 0
    && finite(marker.rect?.left ?? marker.rect?.x) && finite(marker.rect?.right) && finite(marker.rect?.top ?? marker.rect?.y) && finite(marker.rect?.bottom)
    && finite(marker.mapRect?.left ?? marker.mapRect?.x) && finite(marker.mapRect?.right) && finite(marker.mapRect?.top ?? marker.mapRect?.y) && finite(marker.mapRect?.bottom)
    && Math.max(0, marker.mapRect.left ?? marker.mapRect.x, marker.rect.left ?? marker.rect.x) < Math.min(marker.mapRect.right, marker.rect.right)
    && Math.max(0, marker.mapRect.top ?? marker.mapRect.y, marker.rect.top ?? marker.rect.y) < Math.min(marker.mapRect.bottom, marker.rect.bottom);
  if (!intersects(first) || !intersects(final)) issues.push('marker_not_hit_visible_in_actual_map_rect_after_idle');
  if (!Array.isArray(sample.clickedCluster?.memberIds) || !sample.clickedCluster.memberIds.includes(first?.id) || !sample.clickedCluster.memberIds.includes(final?.id)) issues.push('marker_not_from_clicked_cluster');
  const clickedMemberCount = sample.clickedCluster?.memberIds?.length;
  const expectedClickedLabel = Number.isSafeInteger(clickedMemberCount) && clickedMemberCount > 0
    ? (clickedMemberCount >= 1000 ? '999+' : String(clickedMemberCount))
    : null;
  if (sample.clickedCluster?.region !== 'single-Seoul-synthetic-fixture' || expectedClickedLabel === null || String(sample.clickedCluster?.text ?? '').trim() !== expectedClickedLabel || Math.abs(sample.clickedCluster?.position?.lat - 37.5512) > 1e-7 || Math.abs(sample.clickedCluster?.position?.lng - 126.9882) > 1e-7) issues.push('clicked_cluster_fixture_identity_mismatch');
  if (!(first?.geo?.idleEpoch > summary.clickIdleEpoch) || !same(first?.geo, summary.finalGeo) || !same(first?.geo, final?.geo) || !same(first?.mapRect, final?.mapRect)) issues.push('postclick_idle_stable_target_mismatch');
  if (summary.finalGeo?.zoom !== 14 || Math.abs(summary.finalGeo?.lat - 37.5512) > 1e-7 || Math.abs(summary.finalGeo?.lng - 126.9882) > 1e-7) issues.push('final_target_geo_mismatch');
  if (!finite(summary.transientFirstReactionMs) || summary.transientFirstReactionMs <= 0 || summary.transientFirstReactionMs > summary.clickToExpandedMs) issues.push('invalid_transient_first_reaction');
  if (!finite(load.now) || summary.start < load.now) issues.push('capture_started_before_load_snapshot');
  for (const field of ['fcp', 'lcp']) if (!finite(load[field]) || load[field] < 0 || load[field] > load.now) issues.push(`invalid_${field}_period`);
  return [...new Set(issues)];
}
function validatePair(pair, expectedCell, resources, sourceId) {
  if (!Number.isSafeInteger(pair.index) || !same(pair.options, expectedCell.options) || !same(pair.order, expectedOrder(expectedCell.sourceCell, pair.index))) fail(`invalid pair identity/order ${sourceId}`);
  for (const variant of pair.order) {
    if (!pair[variant]) fail(`missing ${variant} ${sourceId}`);
    validateSnapshot(pair[variant].resourceBefore, resources);
    validateSnapshot(pair[variant].resourceAfter, resources);
  }
  const snapshots = pair.order.flatMap(variant => [pair[variant].resourceBefore, pair[variant].resourceAfter]);
  const loadClass = snapshots.some(snapshot => snapshot.saturated) ? 'saturated' : snapshots.some(snapshot => snapshot.heavyOverlap) ? 'heavy_overlap' : 'quiet';
  const unequalLoad = Math.max(...snapshots.map(snapshot => snapshot.otherCpuPercent)) - Math.min(...snapshots.map(snapshot => snapshot.otherCpuPercent)) > resources.unequalPairOtherCpuPercentRange;
  if (pair.loadClass !== loadClass || pair.unequalLoad !== unequalLoad) fail(`pair resource tag mismatch ${sourceId}`);
  const issues = [...captureIssues(pair.baseline).map(issue => `baseline:${issue}`), ...captureIssues(pair.candidate).map(issue => `candidate:${issue}`)];
  return { ...pair, pairId: sourceId, captureIssues: issues, captureValid: issues.length === 0, loadClass, unequalLoad };
}

function recomputeAa(aa) {
  if (!Array.isArray(aa.samples) || aa.samples.length !== 12) fail('revised A/A must contain 12 samples');
  const output = {};
  for (const [name, mobile] of [['desktop', false], ['mobile', true]]) {
    const rows = aa.samples.filter(sample => sample.mobile === mobile);
    if (rows.length !== 6 || rows.some((sample, index) => sample.index !== index * 2 + (mobile ? 1 : 0))) fail(`invalid A/A ${name} sequence`);
    const values = rows.map(sample => sample.summary?.clickToExpandedMs);
    if (values.some(value => !finite(value) || value <= 0)) fail(`invalid A/A ${name} metric`);
    const center = median(values), dispersion = median(values.map(value => Math.abs(value - center)));
    const alternating = Math.abs(median(values.filter((_, index) => index % 2 === 0)) - median(values.filter((_, index) => index % 2 === 1)));
    const timeDrift = Math.abs(median(values.slice(0, 3)) - median(values.slice(3)));
    output[name] = { n: 6, medianMs: center, madMs: dispersion, noiseMs: 2 * dispersion, AAvsAAmedianDifferenceMs: alternating, firstThreeVsLastThreeMedianDifferenceMs: timeDrift };
  }
  return output;
}

function recomputeAdditionalAa(aa, resources) {
  if (!Array.isArray(aa.warmups) || aa.warmups.length !== 4) fail('additional A/A must retain four warmups');
  if (!same(aa.warmups.map(row => row.index).sort((a, b) => a - b), [-4, -3, -2, -1])) fail('additional A/A warmup indices');
  const issueCounts = {};
  for (const row of [...aa.warmups, ...aa.samples]) {
    validateSnapshot(row.resourceBefore, resources); validateSnapshot(row.resourceAfter, resources);
    const issues = captureIssues(row);
    for (const issue of issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
  }
  const measured = recomputeAa(aa);
  return { measured, warmups: aa.warmups.length, measuredSamples: aa.samples.length, limitations: issueCounts, allSharedHostHeavy: [...aa.warmups, ...aa.samples].every(row => row.resourceBefore.heavyOverlap || row.resourceAfter.heavyOverlap) };
}

function classify(primary, threshold, sensitivity) {
  const delta = primary.deltaBeforeMinusAfter, paired = primary.pairedBootstrap.ci95, blocked = primary.adjacentBlockBootstrap.ci95;
  if (paired.lower > 0 && blocked.lower > 0 && delta > threshold && sensitivity.directionConsistent) return 'improvement';
  if (paired.upper < 0 && blocked.upper < 0 && -delta > threshold && sensitivity.reverseDirectionConsistent) return 'regression';
  if ((paired.lower <= 0 && paired.upper >= 0) || (blocked.lower <= 0 && blocked.upper >= 0)) return 'noise';
  return 'no_improvement';
}
function sensitivity(selected, aa) {
  const deltas = selected.map(pair => ({ index: pair.index, order: pair.order.join('_then_'), value: pair.baseline.summary.clickToExpandedMs - pair.candidate.summary.clickToExpandedMs }));
  const ab = deltas.filter(row => row.order === 'baseline_then_candidate').map(row => row.value);
  const ba = deltas.filter(row => row.order === 'candidate_then_baseline').map(row => row.value);
  const ordered = [...deltas].sort((a, b) => a.index - b.index), half = Math.floor(ordered.length / 2);
  const early = ordered.slice(0, half).map(row => row.value), late = ordered.slice(-half).map(row => row.value);
  const result = {
    order: { baselineThenCandidate: distribution(ab), candidateThenBaseline: distribution(ba) },
    time: { firstHalf: distribution(early), lastHalf: distribution(late), middleIndexPolicy: ordered.length % 2 ? 'excluded_from_half_comparison' : 'none', medianDifference: median(early) - median(late) },
    aaFirstThreeVsLastThreeMedianDifferenceMs: aa.firstThreeVsLastThreeMedianDifferenceMs,
  };
  result.directionConsistent = result.order.baselineThenCandidate.median > 0 && result.order.candidateThenBaseline.median > 0 && result.time.firstHalf.median > 0 && result.time.lastHalf.median > 0;
  result.reverseDirectionConsistent = result.order.baselineThenCandidate.median < 0 && result.order.candidateThenBaseline.median < 0 && result.time.firstHalf.median < 0 && result.time.lastHalf.median < 0;
  return result;
}

async function aggregate(args) {
  const [planArtifact, aaArtifact, resourcesArtifact, ...rawArtifacts] = await Promise.all([
    jsonArtifact(args.plan, 'plan'), jsonArtifact(args.aa, 'A/A'), jsonArtifact(args['resources-plan'], 'resource plan'), ...args.raw.map((path, index) => jsonArtifact(path, `raw ${index}`)),
  ]);
  const plan = planArtifact.value, resources = resourcesArtifact.value, aa = recomputeAa(aaArtifact.value);
  const additionalAaArtifacts = await Promise.all((args['additional-aa'] ?? []).map((path, index) => jsonArtifact(path, `additional A/A ${index}`)));
  const additionalAa = additionalAaArtifacts.map(artifact => ({ path: artifact.path, sha256: artifact.sha256, ...recomputeAdditionalAa(artifact.value, resources) }));
  const effectiveAa = Object.fromEntries(['desktop', 'mobile'].map(name => [name, {
    ...aa[name],
    noiseMs: Math.max(aa[name].noiseMs, ...additionalAa.map(item => item.measured[name].noiseMs)),
    AAvsAAmedianDifferenceMs: Math.max(Math.abs(aa[name].AAvsAAmedianDifferenceMs), ...additionalAa.map(item => Math.abs(item.measured[name].AAvsAAmedianDifferenceMs))),
    firstThreeVsLastThreeMedianDifferenceMs: Math.max(aa[name].firstThreeVsLastThreeMedianDifferenceMs, ...additionalAa.map(item => item.measured[name].firstThreeVsLastThreeMedianDifferenceMs)),
  }]));
  if (
    plan.frozenBeforeCandidateBuild !== true
    || plan.candidateBuild !== 'v7'
    || plan.previousPlan !== 'plan-v5.json'
    || !same(plan.budgets, FROZEN_BUDGETS)
    || !same(plan.cells, FROZEN_PRIMARY_CELLS)
    || !same(plan.secondaryCells, FROZEN_SECONDARY_CELLS)
    || plan.pairsPerPrimaryCell !== EXPECTED_PRIMARY_PAIRS
    || plan.warmupPairs !== EXPECTED_WARMUPS
    || plan.validity !== FROZEN_VALIDITY
    || plan.correctnessGate !== FINAL_CORRECTNESS_GATE
  ) fail('plan-v6 changed frozen plan-v5 budgets, cells, sample design or correctness gates');
  for (const name of ['desktop', 'mobile']) {
    for (const field of ['n', 'medianMs', 'madMs', 'noiseMs', 'AAvsAAmedianDifferenceMs']) if (plan.baselineAA?.[name]?.[field] !== aa[name][field]) fail(`plan A/A mismatch ${name}.${field}`);
  }
  if (resources.heavyOverlapOtherSingleProcessCpuPercent !== 80 || resources.saturationOtherCpuFractionOfLogicalCoreCapacity !== 0.85 || resources.saturationLoad1FractionOfLogicalCores !== 1 || resources.unequalPairOtherCpuPercentRange !== 200) fail('resource plan changed frozen limits');
  const cellDefinitions = [
    ...plan.cells.map((options, sourceCell) => ({ kind: 'primary', sourceCell, options, expectedPairs: EXPECTED_PRIMARY_PAIRS })),
    ...plan.secondaryCells.map((options, sourceCell) => ({ kind: 'secondary', sourceCell, options, expectedPairs: EXPECTED_SECONDARY_PAIRS })),
  ];
  const definitions = new Map(cellDefinitions.map(cell => [optionsKey(cell.options), cell]));
  const collected = new Map(cellDefinitions.map(cell => [`${cell.kind}:${optionsKey(cell.options)}`, []]));
  let baselineBuild = null, candidateBuild = null;
  const rawInputs = [];
  if (rawArtifacts.length < 2 || rawArtifacts[0].path !== FINAL_PRIMARY_RAW || rawArtifacts[1].path !== FINAL_SECONDARY_RAW) fail('final scoring requires paired-v6 then secondary-v5 as the first raw inputs');
  for (let rawIndex = 0; rawIndex < rawArtifacts.length; rawIndex++) {
    const artifact = rawArtifacts[rawIndex], raw = artifact.value;
    if (raw.failure || raw.scope !== plan.scope || !same(raw.plan, plan) || !Array.isArray(raw.pairs) || !Array.isArray(raw.warmups)) fail(`raw ${rawIndex} is incomplete or not bound to plan-v6`);
    if (!raw.environment?.cache?.startsWith('Fresh browser context') || raw.environment?.logicalCores < 1) fail(`raw ${rawIndex} lacks independent-context record`);
    if (!baselineBuild) { baselineBuild = raw.builds?.baseline; candidateBuild = raw.builds?.candidate; }
    else if (!same(baselineBuild, raw.builds?.baseline) || !same(candidateBuild, raw.builds?.candidate)) fail('raw build bindings differ');
    if (!FINAL_CANDIDATE_RECEIPT.test(candidateBuild?.retainedBuildId ?? '')) fail('candidate v3-v6 is intermediate; final scoring requires candidate v7');
    const requiredCandidateInputs = ['components/map/NaverMapView.tsx', 'lib/naver-map-render-plan.ts', 'lib/marker-pool.ts'];
    if (candidateBuild.inputs?.length !== 10 || requiredCandidateInputs.some(path => !candidateBuild.inputs.some(input => input.original === path))) fail('candidate v7 must retain ten inputs including all three changed source files');
    const pairDefinitions = raw.pairs.map(pair => definitions.get(optionsKey(pair.options)));
    if (pairDefinitions.some(value => !value)) fail(`raw ${rawIndex} has unknown cell`);
    const kinds = new Set(pairDefinitions.map(value => value.kind));
    if (kinds.size !== 1) fail(`raw ${rawIndex} mixes primary and secondary cells`);
    const mode = [...kinds][0], modeCells = cellDefinitions.filter(cell => cell.kind === mode);
    if ((rawIndex === 0 && mode !== 'primary') || (rawIndex === 1 && mode !== 'secondary')) fail(`raw ${rawIndex} does not match its final primary/secondary role`);
    for (const cell of modeCells) {
      const measured = raw.pairs.filter(pair => same(pair.options, cell.options));
      const warmups = raw.warmups.filter(pair => same(pair.options, cell.options));
      if (measured.length !== cell.expectedPairs || warmups.length !== EXPECTED_WARMUPS) fail(`raw ${rawIndex} wrong ${mode} sample count`);
      const expectedIndices = measured.map(pair => pair.index).sort((a, b) => a - b);
      if (!same(expectedIndices, Array.from({ length: cell.expectedPairs }, (_, index) => index))) fail(`raw ${rawIndex} invalid measured indices`);
      const expectedWarmups = warmups.map(pair => pair.index).sort((a, b) => a - b);
      if (!same(expectedWarmups, [-2, -1])) fail(`raw ${rawIndex} invalid warmup indices`);
      for (const pair of [...warmups, ...measured]) validatePair(pair, cell, resources, `${artifact.path}:${cell.sourceCell}:${pair.index}`);
      const key = `${cell.kind}:${optionsKey(cell.options)}`;
      for (const pair of measured) collected.get(key).push(validatePair(pair, cell, resources, `${artifact.path}:${cell.sourceCell}:${pair.index}`));
    }
    rawInputs.push({ path: artifact.path, sha256: artifact.sha256, mode, measuredPairs: raw.pairs.length, warmupPairs: raw.warmups.length });
  }
  if (!baselineBuild || !candidateBuild || !GIT.test(baselineBuild.sourceCommit) || !GIT.test(baselineBuild.sourceTree) || baselineBuild.sourceCommit !== plan.baselineCommit || candidateBuild.sourceCommit !== plan.baselineCommit || candidateBuild.sourceTree !== baselineBuild.sourceTree || !SHA256.test(candidateBuild.patchSha256)) fail('invalid build source binding');
  if (candidateBuild.planSha256 !== planArtifact.sha256) fail('candidate build is not bound to plan-v6');

  const cells = [];
  let consoleErrorObservations = 0, pageErrorObservations = 0, incompleteRequestObservations = 0;
  for (const definition of cellDefinitions) {
    const key = `${definition.kind}:${optionsKey(definition.options)}`, pairs = collected.get(key);
    if (!pairs.length) continue;
    for (const pair of pairs) for (const variant of ['baseline', 'candidate']) {
      consoleErrorObservations += pair[variant].errors?.console ?? 0;
      pageErrorObservations += pair[variant].errors?.page ?? 0;
      incompleteRequestObservations += pair[variant].requests?.filter(request => request.completed !== true).length ?? 0;
    }
    const validQuiet = pairs.filter(pair => pair.captureValid && pair.loadClass === 'quiet' && !pair.unequalLoad);
    const selected = validQuiet.slice(0, definition.expectedPairs);
    const busy = pairs.filter(pair => pair.captureValid && (pair.loadClass !== 'quiet' || pair.unequalLoad));
    const invalid = pairs.filter(pair => !pair.captureValid);
    const aaCell = effectiveAa[definition.options.mobile ? 'mobile' : 'desktop'];
    const metrics = Object.fromEntries(metricSpecs.map(spec => [spec[0], selected.length ? metricScore(selected, spec, key) : null]));
    const primary = metrics[PRIMARY_METRIC];
    const measuredNoise = primary ? 2 * Math.max(primary.baseline.mad, primary.candidate.mad) : null;
    const threshold = primary ? Math.max(plan.budgets.absoluteMs, primary.baseline.median * plan.budgets.relativeFraction, measuredNoise, aaCell.noiseMs, Math.abs(aaCell.AAvsAAmedianDifferenceMs), aaCell.firstThreeVsLastThreeMedianDifferenceMs) : null;
    const sensitivityResult = selected.length === definition.expectedPairs ? sensitivity(selected, aaCell) : null;
    const classification = definition.kind === 'primary' && selected.length === definition.expectedPairs ? classify(primary, threshold, sensitivityResult) : null;
    const exclusionCounts = {
      heavyOverlap: pairs.filter(pair => pair.loadClass === 'heavy_overlap').length,
      saturated: pairs.filter(pair => pair.loadClass === 'saturated').length,
      unequalLoad: pairs.filter(pair => pair.unequalLoad).length,
      invalidCapture: invalid.length,
      extraQuietRetest: Math.max(0, validQuiet.length - definition.expectedPairs),
    };
    const reasons = [];
    if (definition.kind !== 'primary') reasons.push('secondary_cell_descriptive_only');
    if (selected.length !== definition.expectedPairs) reasons.push('insufficient_valid_quiet_pairs');
    if (invalid.length) reasons.push('capture_gate_failures_retained');
    if (classification && classification !== 'improvement') reasons.push(`classification_${classification}`);
    cells.push({
      id: key,
      kind: definition.kind,
      options: definition.options,
      expectedIndependentContexts: definition.expectedPairs,
      observedPairs: pairs.length,
      validQuietPairs: validQuiet.length,
      selectedPairIds: selected.map(pair => pair.pairId),
      exclusionCounts,
      invalidCaptures: invalid.map(pair => ({ pairId: pair.pairId, issues: pair.captureIssues })),
      budgets: definition.kind === 'primary' && primary ? { absoluteMs: 50, relativeFraction: 0.1, pairedSampleTwoMadMs: measuredNoise, aaNoiseMs: aaCell.noiseMs, aaAlternatingMedianDifferenceMs: Math.abs(aaCell.AAvsAAmedianDifferenceMs), aaTimeDriftMedianDifferenceMs: aaCell.firstThreeVsLastThreeMedianDifferenceMs, effectiveThresholdMs: threshold } : null,
      metrics,
      sensitivity: sensitivityResult,
      classification,
      admission: { admittedLocalImprovement: definition.kind === 'primary' && selected.length === definition.expectedPairs && classification === 'improvement', reasons },
      busySharedHostDescriptive: busy.length ? { n: busy.length, metrics: Object.fromEntries(metricSpecs.map(spec => [spec[0], metricScore(busy, spec, `${key}:busy`)])), pairIds: busy.map(pair => pair.pairId), claim: 'descriptive_busy_shared_host_only' } : null,
      allObservedDescriptive: { n: pairs.length, metrics: Object.fromEntries(metricSpecs.map(spec => [spec[0], metricScore(pairs, spec, `${key}:all`)])), claim: 'descriptive_all_observed_including_capture_limits' },
      networkBoundary: { fixturePayloadBytesAreHarnessResponseBodies: true, actualNetworkTransferBytes: null, reason: 'actual_network_transfer_not_measured' },
    });
  }
  return {
    schemaVersion: 'render-flow-score.v1',
    scope: plan.scope,
    claimBoundary: {
      localLaboratoryOnly: true,
      g003OrFieldAdmission: false,
      liveSdkTiming: false,
      fullUiCompletion: false,
      physicalPixelsVerified: false,
      readinessMeaning: 'first animation frame after target idle observing a clicked-cluster member intersecting the actual map rectangle with DOM hit-test visibility; paint and physical pixels remain unverified',
      cleanHostClaim: false,
    },
    plan: { path: planArtifact.path, sha256: planArtifact.sha256, correctnessGate: plan.correctnessGate, aaPath: aaArtifact.path, aaSha256: aaArtifact.sha256, additionalAa: additionalAa.map(({ path, sha256, warmups, measuredSamples, limitations, allSharedHostHeavy }) => ({ path, sha256, warmups, measuredSamples, limitations, allSharedHostHeavy })), resourcesPlanPath: resourcesArtifact.path, resourcesPlanSha256: resourcesArtifact.sha256 },
    bootstrapPolicy: { resamples: RESAMPLES, baseSeed: BASE_SEED, pairedIndex: true, adjacentAbBaBlocks: true, trailingSingletonPolicy: 'retain_once_in_every_resample' },
    rawInputs,
    bindings: {
      baseline: { sourceCommit: baselineBuild.sourceCommit, sourceTree: baselineBuild.sourceTree, patchSha256: baselineBuild.patchSha256, retainedBuildId: baselineBuild.retainedBuildId },
      candidate: { sourceCommit: candidateBuild.sourceCommit, sourceTree: candidateBuild.sourceTree, patchSha256: candidateBuild.patchSha256, retainedBuildId: candidateBuild.retainedBuildId, basis: 'frozen_baseline_git_plus_retained_uncommitted_patch' },
    },
    observedGates: { consoleErrorObservations, pageErrorObservations, incompleteRequestObservations, canonicalHealthGateRequired: consoleErrorObservations + pageErrorObservations + incompleteRequestObservations > 0 },
    aaNoise: { retainedFloor: aa, additionalCalibration: additionalAa.map(({ path, sha256, measured, warmups, measuredSamples, limitations, allSharedHostHeavy }) => ({ path, sha256, measured, warmups, measuredSamples, limitations, allSharedHostHeavy })), effectiveConservativeFloor: effectiveAa },
    cells,
    governance: { admittedFieldSlices: 0, localScoreMayNotBeSubmittedAsFieldMeasurement: true, externalArtifactMapPinRequired: true },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await aggregate(args), output = resolved(args.output);
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ output: displayPath(output), sha256: hash(await readFile(output)), primaryCells: result.cells.filter(cell => cell.kind === 'primary').length, admittedLocalImprovements: result.cells.filter(cell => cell.admission.admittedLocalImprovement).length, fieldAdmissions: 0 })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
export { aggregate, adjacentBlockBootstrap, captureIssues, distribution, median, metricSpecs, pairedBootstrap, percentile, recomputeAa };
