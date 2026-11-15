import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, PROTOCOL_SHA256, URL, TOOL_PATHS, SHA, check, hash, parse, timestamp, same, finite,
  read, writeJson, conforms, snapshotProblems, scalarValues, attribution, phaseProblems, verifiedMap, argumentsOf } from './evidence.mjs';

export function summarize(values) {
  check(values.every(finite), 'nonfinite metric');
  const median = (a) => { const s = [...a].sort((a, b) => a - b); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; };
  const center = median(values);
  return { count: values.length, median: center, mad: center === null ? null : median(values.map((v) => Math.abs(v - center))), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
}
export function compare(beforeValues, afterValues, budget, settings, eligible) {
  const before = summarize(beforeValues), after = summarize(afterValues);
  const delta = before.median === null || after.median === null ? null : before.median - after.median;
  const relativeReduction = delta === null || before.median === 0 ? null : delta / before.median;
  const noise = before.mad === null || after.mad === null ? null : settings.noiseMultiplier * Math.max(before.mad, after.mad);
  const ready = eligible && before.count === 5 && after.count === 5;
  let classification = 'not-comparable';
  if (ready) {
    const pass = (direction) => delta * direction >= budget.minimumAbsoluteChange && relativeReduction !== null
      && relativeReduction * direction >= settings.minimumRelativeChange && delta * direction > noise;
    classification = pass(1) ? 'improved' : pass(-1) ? 'regressed' : 'no-confirmed-change';
  }
  return { unit: 'ms', before, after, beforeMinusAfterMs: delta, relativeReduction, noiseThresholdMs: noise,
    minimumAbsoluteChangeMs: budget.minimumAbsoluteChange, minimumRelativeChange: settings.minimumRelativeChange,
    targetMs: budget.target, classification };
}

export function score({ root = ROOT, repository = resolve(root, '../../../..'), artifactMap = 'artifact-map.json', artifactMapSha256, baselineMapSha256 }) {
  const evidence = verifiedMap(root, artifactMap, artifactMapSha256);
  const { map, contents, get } = evidence;
  for (const path of TOOL_PATHS) check(hash(contents.get(path)) === hash(read(ROOT, path)), 'mapped scoring tools differ from executing tools');
  const protocol = get('protocol.json'), schema = get('snapshot.schema.json');
  const globalProblems = [];
  if (map.stage === 'final') {
    check(baselineMapSha256 === map.baselineMapSha256, 'detached baseline map hash required for final scoring');
    const baseline = verifiedMap(root, 'baseline-artifact-map.json', baselineMapSha256);
    check(baseline.map.stage === 'before' && contents.has('baseline-artifact-map.json'), 'unretained baseline seal');
    for (const item of baseline.map.files) check(map.files.some((next) => same(item, next)), 'baseline inputs changed since seal');
  }
  const cohort = contents.has('inputs/cohort.json') ? get('inputs/cohort.json') : null;
  const cohortKeys = ['schemaVersion','protocolSha256','frozenAtUtc','browserSurface','browserVersion','viewport','navigationType','cacheControl','networkControl','cpuControl','setupReceipt','setupReceiptSha256','setupSnapshotSha256'];
  if (!cohort || Object.keys(cohort).length !== cohortKeys.length || !cohortKeys.every((k) => Object.hasOwn(cohort, k))
    || cohort.schemaVersion !== 'production-attribution.cohort.v1' || cohort.protocolSha256 !== PROTOCOL_SHA256
    || cohort.browserSurface !== 'cua-cloud-cdp' || cohort.browserVersion !== null || cohort.navigationType !== 'navigate'
    || cohort.cacheControl !== 'unavailable' || cohort.networkControl !== 'unavailable' || cohort.cpuControl !== 'unavailable'
    || timestamp(cohort.frozenAtUtc) === null || cohort.viewport?.width < 1024 || !finite(cohort.viewport?.height) || cohort.viewport.height <= 0 || !finite(cohort.viewport?.dpr) || cohort.viewport.dpr <= 0
    || cohort.setupReceipt !== 'inputs/before/00.receipt.json' || !SHA.test(cohort.setupReceiptSha256 ?? '') || !SHA.test(cohort.setupSnapshotSha256 ?? '')) globalProblems.push('COHORT_BINDING');
  if (cohort) {
    const rb = contents.get('inputs/before/00.receipt.json'), sb = contents.get('inputs/before/00.snapshot.json');
    if (!rb || !sb || hash(rb) !== cohort.setupReceiptSha256 || hash(sb) !== cohort.setupSnapshotSha256
      || timestamp(parse(rb).observedAtUtc) > timestamp(cohort.frozenAtUtc)) globalProblems.push('COHORT_SETUP_EVIDENCE');
  }
  const phases = {};
  for (const phase of ['before', 'after']) {
    const path = `inputs/phases/${phase}.json`;
    if (!contents.has(path)) { phases[phase] = null; continue; }
    const metadata = get(path), issues = phaseProblems(metadata, phase, repository, protocol), trials = [];
    let previousEnd = null;
    for (let ordinal = 0; ordinal <= 5; ordinal += 1) {
      const stem = `inputs/${phase}/${String(ordinal).padStart(2, '0')}`, receiptPath = `${stem}.receipt.json`;
      const reasons = [], receipt = contents.has(receiptPath) ? get(receiptPath) : null;
      let snapshot = null;
      if (!receipt) reasons.push('ATTEMPT_NOT_RETAINED');
      else {
        const keys = ['schemaVersion','phase','ordinal','role','navigationStartedAtUtc','observedAtUtc','observedUrl','extraction','outcome','snapshot','snapshotSha256'];
        if (Object.keys(receipt).length !== keys.length || !keys.every((k) => Object.hasOwn(receipt, k))
          || receipt.schemaVersion !== 'production-attribution.receipt.v1' || receipt.phase !== phase || receipt.ordinal !== ordinal
          || receipt.role !== (ordinal === 0 ? 'declared-warmup' : 'planned-measurement') || receipt.extraction !== 'visible-diagnostic-pre-text') reasons.push('RECEIPT_SCHEMA');
        if (receipt.observedUrl !== URL) reasons.push('OBSERVED_URL');
        const start = timestamp(receipt.navigationStartedAtUtc), end = timestamp(receipt.observedAtUtc);
        if (start === null || end === null || start > end || start < timestamp(metadata.frozenAtUtc)
          || ordinal > 0 && start < timestamp(cohort?.frozenAtUtc) || previousEnd !== null && start < previousEnd) reasons.push('ATTEMPT_CHRONOLOGY');
        if (end !== null) previousEnd = end;
        if (receipt.outcome !== 'captured') reasons.push('CAPTURE_UNAVAILABLE');
        else if (receipt.snapshot !== `${stem}.snapshot.json` || !contents.has(receipt.snapshot)
          || !SHA.test(receipt.snapshotSha256 ?? '') || hash(contents.get(receipt.snapshot)) !== receipt.snapshotSha256) reasons.push('SNAPSHOT_BINDING');
        else {
          snapshot = get(receipt.snapshot);
          if (!conforms(snapshot, schema)) { reasons.push('SNAPSHOT_SCHEMA'); snapshot = null; }
          else {
            const observed = snapshotProblems(snapshot, cohort ?? { viewport: null }, metadata.sourceSha, schema);
            if (ordinal > 0) reasons.push(...observed);
            else reasons.push(...observed.filter((v) => ['SOURCE_BINDING','NAVIGATION_CONTEXT_CHANGED','CAPTURE_WINDOW','HIDDEN_DOCUMENT','TRUSTED_INPUT','VIEWPORT_RESIZE','VIEWPORT_BINDING','NAVIGATION_KIND','COLLECTOR_OVERFLOW','REQUIRED_API_UNAVAILABLE'].includes(v)));
          }
        }
      }
      const valid = reasons.length === 0 && issues.length === 0 && globalProblems.length === 0;
      trials.push({ ordinal, role: ordinal === 0 ? 'declared-warmup' : 'planned-measurement', receipt: receipt ? receiptPath : null,
        snapshot: receipt?.snapshot ?? null, valid, timingEligible: ordinal > 0 && valid, reasons: [...new Set(reasons)].sort(),
        values: scalarValues(snapshot), attribution: snapshot ? attribution(snapshot) : null });
    }
    if (!trials[0].valid) issues.push('WARMUP_CONTEXT');
    phases[phase] = { metadata, issues: [...new Set(issues)].sort(), trials, validMeasurements: trials.filter((v) => v.timingEligible).length };
  }
  if (!phases.before || !phases.after) globalProblems.push('BOTH_PHASES_REQUIRED');
  else {
    const b = phases.before.metadata, a = phases.after.metadata;
    if (b.sourceSha === a.sourceSha || b.deploymentId === a.deploymentId || b.projectId !== a.projectId || !same(b.observerFiles, a.observerFiles)) globalProblems.push('COMPARISON_SOURCE_BINDING');
    const beforeLast = contents.has('inputs/before/05.receipt.json') ? get('inputs/before/05.receipt.json') : null;
    if (!beforeLast || timestamp(beforeLast.observedAtUtc) >= timestamp(a.frozenAtUtc)) globalProblems.push('PHASE_ORDER');
    if (map.stage !== 'final') globalProblems.push('FINAL_SEAL_REQUIRED');
  }
  const eligible = globalProblems.length === 0 && ['before','after'].every((p) => phases[p]?.issues.length === 0 && phases[p].validMeasurements === 5);
  const metrics = {};
  for (const [name, budget] of Object.entries(protocol.metrics)) {
    const samples = Object.fromEntries(['before','after'].map((phase) => [phase, (phases[phase]?.trials ?? []).filter((t) => t.timingEligible && finite(t.values[name])).map((t) => ({ ordinal: t.ordinal, value: t.values[name] }))]));
    metrics[name] = { ...compare(samples.before.map((v) => v.value), samples.after.map((v) => v.value), budget, protocol.comparison, eligible), samples };
  }
  const comparableMetricCount = Object.values(metrics).filter((m) => m.classification !== 'not-comparable').length;
  return { schemaVersion: 'production-attribution.score.v1', protocolSha256: PROTOCOL_SHA256, artifactMapSha256,
    baselineMapSha256: map.baselineMapSha256, classification: protocol.scope.classification,
    status: comparableMetricCount === Object.keys(metrics).length ? 'complete-observational-comparison' : 'incomplete-observational-comparison',
    fieldAdmissionCount: 0, g003AdmissionCount: 0, legacyTtiMs: null, limitations: protocol.scope.limitations,
    cohort, globalProblems: [...new Set(globalProblems)].sort(), phases, metrics, comparableMetricCount,
    improvedMetricCount: Object.values(metrics).filter((m) => m.classification === 'improved').length,
    regressedMetricCount: Object.values(metrics).filter((m) => m.classification === 'regressed').length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = argumentsOf(process.argv.slice(2), ['--root','--repository','--artifact-map','--artifact-map-sha256','--baseline-map-sha256','--output']);
    const root = resolve(a['--root'] ?? ROOT);
    const result = score({ root, repository: a['--repository'], artifactMap: a['--artifact-map'], artifactMapSha256: a['--artifact-map-sha256'], baselineMapSha256: a['--baseline-map-sha256'] });
    const output = a['--output'] ?? 'scored.json';
    writeJson(root, output, result);
    console.log(JSON.stringify({ output, status: result.status, comparableMetricCount: result.comparableMetricCount, improvedMetricCount: result.improvedMetricCount, regressedMetricCount: result.regressedMetricCount }, null, 2));
  } catch (error) { console.error(`production score: ${error.message}`); process.exitCode = 1; }
}
