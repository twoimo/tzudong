import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately independent of score.mjs: raw inputs, eligibility and statistics
// are recalculated here. No scorer module or scorer-computed sample is trusted.
const PROTOCOL_HASH = '858c59b43a6cbae7d9d13a5b1bb9e160a2e0c28347f0d84dabdf99722179b78b';
const DEFAULT_ROOT = dirname(fileURLToPath(import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const hash = (content) => createHash('sha256').update(content).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(`initial-load validation: ${message}`); };
const isValue = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolveInput(root, name) {
  check(typeof name === 'string' && /^[A-Za-z0-9._/-]+$/.test(name), 'invalid path');
  check(!name.startsWith('/') && !name.endsWith('/') && !name.includes('//') && !name.split('/').some((part) => part === '..' || part === '.'), 'path escape');
  const resolved = resolve(root, name);
  const actual = realpathSync(resolved);
  const inside = relative(realpathSync(root), actual);
  check(!inside.startsWith('..') && !isAbsolute(inside) && actual === resolved, 'symlink or external artifact');
  const info = lstatSync(resolved);
  check(info.isFile() && !info.isSymbolicLink() && info.size <= 512 * 1024 * 1024, 'invalid artifact type or size');
  return resolved;
}

function parse(content) {
  try { return JSON.parse(content.toString('utf8')); }
  catch { throw new Error('initial-load validation: invalid JSON'); }
}

function rawStatistics(values) {
  check(values.every(isValue), 'invalid numeric input');
  const ordered = values.toSorted((a, b) => a - b);
  if (ordered.length === 0) return { count: 0, median: null, mad: null, min: null, max: null };
  const middle = (array) => {
    const lower = Math.floor((array.length - 1) / 2);
    const upper = Math.ceil((array.length - 1) / 2);
    return (array[lower] + array[upper]) / 2;
  };
  const centre = middle(ordered);
  return {
    count: ordered.length, median: centre,
    mad: middle(ordered.map((entry) => Math.abs(entry - centre)).sort((a, b) => a - b)),
    min: ordered[0], max: ordered[ordered.length - 1],
  };
}

export function independentlyCompare(before, after, budget, comparison, count, valid) {
  const base = rawStatistics(before);
  const next = rawStatistics(after);
  const available = base.median !== null && next.median !== null;
  const reduction = available ? base.median - next.median : null;
  const noise = available ? Math.max(base.mad, next.mad) * comparison.noiseMultiplier : null;
  const relativeFloor = base.median === null ? null : base.median * comparison.minimumRelativeReduction;
  const comparable = valid && base.count === count && next.count === count;
  const gates = comparable ? {
    absoluteReduction: reduction >= budget.minimumReduction,
    relativeReduction: reduction >= relativeFloor,
    exceedsNoise: reduction > noise,
  } : null;
  let classification = 'not-comparable';
  if (comparable) {
    if (reduction >= budget.minimumReduction && reduction >= relativeFloor && reduction > noise) classification = 'improved';
    else if (next.median - base.median >= budget.minimumReduction && next.median - base.median >= relativeFloor && next.median - base.median > noise) classification = 'regressed';
    else classification = 'no-confirmed-change';
  }
  return {
    unit: budget.unit, goodTarget: budget.goodTarget, minimumReduction: budget.minimumReduction,
    before: { ...base, meetsTarget: base.median === null ? null : base.median <= budget.goodTarget },
    after: { ...next, meetsTarget: next.median === null ? null : next.median <= budget.goodTarget },
    reduction,
    improvementPercent: available && base.median !== 0 ? reduction / base.median * 100 : null,
    relativeReductionFloor: relativeFloor, noiseThreshold: noise,
    requiredReduction: available ? Math.max(budget.minimumReduction, relativeFloor, noise) : null,
    noiseBoundaryIsStrict: true, gates, classification,
  };
}

function getMetricValues(observation, lighthouse) {
  const result = {};
  const response = observation.navigation?.responseStart;
  const start = observation.navigation?.startTime;
  result.ttfb = isValue(response) && response > 0 && isValue(start) && response >= start ? response - start : null;
  const fields = [
    ['fcp', 'first-contentful-paint'], ['lcp', 'largest-contentful-paint'],
    ['tti', 'interactive'], ['tbt', 'total-blocking-time'], ['cls', 'cumulative-layout-shift'],
  ];
  for (const [name, auditId] of fields) {
    const record = lighthouse.audits?.[auditId];
    result[name] = record && !record.errorMessage && !record.errorCode && record.scoreDisplayMode !== 'error' && isValue(record.numericValue) ? record.numericValue : null;
  }
  const end = lighthouse.audits?.metrics?.details?.items?.[0]?.observedTraceEnd;
  result.controlsReady = isValue(observation.timings?.controlsReadyMs) && isValue(end) && observation.timings.controlsReadyMs <= end ? observation.timings.controlsReadyMs : null;
  result.mapReady = isValue(observation.timings?.mapReadyMs) && isValue(end) && observation.timings.mapReadyMs <= end ? observation.timings.mapReadyMs : null;
  return result;
}

function browserObservationValid(observed, report, profile, protocol, frozen) {
  const config = report.configSettings ?? {};
  const browser = observed.browser ?? {};
  const errors = observed.errors ?? {};
  const requirements = [
    observed.source?.gitSha === frozen.sourceSha,
    observed.source?.deploymentId === frozen.deploymentId,
    report.lighthouseVersion === protocol.tools.lighthouse,
    browser.version === protocol.tools.chrome,
    typeof browser.product === 'string' && /Chrome/.test(browser.product),
    typeof browser.executable === 'string' && isAbsolute(browser.executable),
    !report.runtimeError,
    report.requestedUrl === protocol.url,
    report.finalDisplayedUrl === protocol.url,
    report.finalUrl === protocol.url,
    observed.requestedUrl === protocol.measurementUrl,
    observed.finalUrl === protocol.url,
    observed.initialDocumentQaExcluded === true,
    config.throttlingMethod === protocol.lighthouse.throttlingMethod,
    config.formFactor === profile.formFactor,
    config.disableStorageReset === false,
    config.emulatedUserAgent === profile.userAgent,
    config.screenEmulation?.disabled === false,
    config.screenEmulation?.mobile === profile.isMobile,
    observed.navigation?.type === 'navigate',
    observed.navigation?.responseStatus === undefined || observed.navigation.responseStatus === 200,
    !Array.isArray(observed.failures) || observed.failures.length === 0,
    errors.mainDocumentStatus === 200,
    errors.pageErrors === 0 && errors.firstPartyHttpErrors === 0,
    observed.readiness?.controlsQualified === true,
    observed.readiness?.mapQualified === true && observed.readiness?.naverSdkPresent === true,
    observed.readiness?.initialSkeletonVisible === false,
    profile.width < 1280 || observed.readiness?.desktopPanelQualified === true,
    observed.samplingIntervalMs === protocol.applicationTimings.samplingIntervalMs,
  ];
  for (const point of ['healthBefore', 'healthAfter']) {
    const identity = observed.source?.[point];
    requirements.push(identity?.healthOk === true && identity.gitSha === frozen.sourceSha && identity.deploymentId === frozen.deploymentId);
  }
  const readiness = observed.readiness ?? {};
  requirements.push(readiness.tileReadyCount > 0 && readiness.naverMarkerCount > 0);
  if (profile.width >= 1280) {
    requirements.push(readiness.homeChromeReady === true && readiness.actualDesktopControls === true && readiness.desktopMenuReady === true && readiness.desktopSearchReady === true);
    requirements.push(readiness.homePanelReady === true && readiness.desktopPanelPresent === true && readiness.desktopPanelAlertCount === 0 && readiness.desktopPopularItemCount > 0 && readiness.desktopLatestItemCount > 0);
  } else requirements.push(readiness.homeMobileChromeReady === true);
  for (const dimension of ['width', 'height', 'deviceScaleFactor']) {
    requirements.push(observed.actualViewport?.[dimension] === profile[dimension]);
    requirements.push(observed.requestedViewport?.[dimension] === profile[dimension]);
    requirements.push(config.screenEmulation?.[dimension] === profile[dimension]);
  }
  for (const [key, value] of Object.entries(profile.throttling)) requirements.push(config.throttling?.[key] === value);
  return requirements.every(Boolean);
}

export function validateEvidence({ root = DEFAULT_ROOT, input = 'experiment.json', artifactMap = 'artifact-map.json', artifactMapSha256, scored = 'scored.json', repository = resolve(DEFAULT_ROOT, '../../../..') } = {}) {
  root = resolve(root);
  check(SHA.test(artifactMapSha256 ?? ''), 'expected detached map hash required');
  const mapContent = readFileSync(resolveInput(root, artifactMap));
  check(hash(mapContent) === artifactMapSha256, 'map hash mismatch');
  const map = parse(mapContent);
  check(map.schemaVersion === 'initial-load-artifact-map.v1' && Array.isArray(map.files), 'map schema');
  const bytes = new Map();
  for (const entry of map.files) {
    check(!bytes.has(entry.path) && SHA.test(entry.sha256) && Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0, 'map entry');
    const content = readFileSync(resolveInput(root, entry.path));
    check(content.length === entry.sizeBytes && hash(content) === entry.sha256, `changed artifact: ${entry.path}`);
    bytes.set(entry.path, content);
  }
  const get = (path) => { check(bytes.has(path), `unmapped input: ${path}`); return parse(bytes.get(path)); };
  const manifest = get(input);
  check(manifest.schemaVersion === 'initial-load-experiment.v1', 'experiment schema');
  check(bytes.has(manifest.protocol) && hash(bytes.get(manifest.protocol)) === PROTOCOL_HASH, 'changed predeclared protocol');
  check(bytes.has(manifest.collector), 'unmapped collector');
  const protocol = get(manifest.protocol);
  const collectorHash = hash(bytes.get(manifest.collector));
  const hasPhase = Boolean(manifest.phases?.before || manifest.phases?.after);
  if (hasPhase) check(manifest.toolLock && manifest.toolManifest, 'tooling bindings required');
  const toolLock = manifest.toolLock ? get(manifest.toolLock) : null;
  const toolManifest = manifest.toolManifest ? get(manifest.toolManifest) : null;
  if (hasPhase) check(toolLock?.packages?.['node_modules/lighthouse']?.version === protocol.tools.lighthouse && toolManifest?.dependencies?.lighthouse === protocol.tools.lighthouse, 'Lighthouse tooling mismatch');
  check(bytes.has('validate.mjs') && hash(bytes.get('validate.mjs')) === hash(readFileSync(fileURLToPath(import.meta.url))), 'executing validator differs from mapped code');
  const reportBytes = readFileSync(resolveInput(root, scored));
  const report = parse(reportBytes);
  check(report.schemaVersion === 'initial-load-score.v1', 'score schema');
  check(report.protocolSha256 === PROTOCOL_HASH && report.artifactMapSha256 === artifactMapSha256, 'score integrity bindings');
  check(report.measurementType === protocol.scope.measurementType && report.comparisonDesign === protocol.sampling.order && report.paired === false, 'measurement scope');
  check(report.fieldAdmissionCount === 0 && report.g003AdmissionCount === 0, 'unearned field or G003 admission');
  check(same(report.limitations, protocol.scope.limitations), 'missing limitations');
  const phases = {};
  let retainedAttempts = 0;
  for (const phase of ['before', 'after']) {
    const location = manifest.phases?.[phase];
    if (!location) { phases[phase] = null; check(report.phases?.[phase] === null, 'invented phase'); continue; }
    const run = get(location.run);
    const frozen = get(location.frozenSource);
    const identity = get(frozen.identityEvidence);
    check(COMMIT.test(frozen.sourceSha ?? ''), 'invalid source commit');
    let sourceTree;
    try { sourceTree = execFileSync('git', ['-C', repository, 'rev-parse', `${frozen.sourceSha}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { throw new Error('initial-load validation: missing frozen Git object'); }
    const checks = [
      run.schemaVersion === 'initial-load-run.v1', run.phase === phase,
      frozen.schemaVersion === 'initial-load-frozen-source.v1', frozen.phase === phase,
      run.sourceSha === frozen.sourceSha, run.sourceTreeSha === frozen.sourceTreeSha,
      frozen.sourceTreeSha === sourceTree, frozen.canonicalUrl === protocol.url,
      identity.ok === true, identity.gitSha === frozen.sourceSha,
      identity.deploymentId === frozen.deploymentId, identity.host === new URL(protocol.url).hostname,
      typeof frozen.deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(frozen.deploymentId),
      timestamp(frozen.verifiedAt) !== null,
      run.protocolSha256 === PROTOCOL_HASH, run.collectorSha256 === collectorHash,
      run.toolLockSha256 === hash(bytes.get(manifest.toolLock)),
      run.puppeteerVersion === toolLock?.packages?.['node_modules/puppeteer-core']?.version,
      typeof run.environment?.nodeVersion === 'string' && /^v?24\./.test(run.environment.nodeVersion),
      timestamp(run.startedAt) !== null, timestamp(run.endedAt) !== null,
      timestamp(run.startedAt) <= timestamp(run.endedAt),
      timestamp(run.startedAt) >= timestamp(protocol.declaredAt),
      phase !== 'before' || frozen.sourceSha === protocol.baselineSourceSha,
    ];
    for (const pin of ['lighthouse', 'playwright', 'chrome']) checks.push(run.pins?.[pin] === protocol.tools[pin]);
    const phaseValid = checks.every(Boolean);
    const phaseReport = report.phases?.[phase];
    check(phaseReport && (phaseReport.issues.length === 0) === phaseValid, 'phase eligibility differs from raw inputs');
    for (const key of ['sourceSha', 'sourceTreeSha', 'deploymentId']) check(phaseReport[key] === frozen[key], 'source binding differs');
    check(phaseReport.startedAt === run.startedAt && phaseReport.endedAt === run.endedAt && same(phaseReport.environment, run.environment ?? null), 'phase metadata differs');
    check(Array.isArray(run.trials) && phaseReport.trials.length === run.trials.length, 'attempts omitted');
    const trials = [];
    const ids = new Set();
    let lastEnd = null;
    for (let index = 0; index < run.trials.length; index += 1) {
      const trial = run.trials[index];
      check(!ids.has(trial.attemptId), 'duplicate attempt'); ids.add(trial.attemptId);
      const profile = protocol.profiles.find((entry) => entry.id === trial.viewportId);
      check(profile, 'unknown viewport');
      const paths = {};
      for (const kind of ['observations', 'lhr', 'trace', 'network', 'screenshot']) {
        const path = trial.paths?.[kind];
        const parent = dirname(location.run);
        paths[kind] = path === null || path === undefined ? null : parent === '.' || path.startsWith(`${parent}/`) ? path : `${parent}/${path}`;
        if (paths[kind] !== null) check(bytes.has(paths[kind]), 'unmapped attempted-trial artifact');
      }
      let valid = trial.status === 'valid' && Array.isArray(trial.failures) && trial.failures.length === 0 && Object.values(paths).every(Boolean);
      let values = Object.fromEntries(Object.keys(protocol.metrics).map((key) => [key, null]));
      if (paths.observations && paths.lhr) {
        const observed = get(paths.observations);
        const lhr = get(paths.lhr);
        valid = browserObservationValid(observed, lhr, profile, protocol, frozen) && valid;
        values = getMetricValues(observed, lhr);
        const start = timestamp(observed.startedAt ?? trial.startedAt);
        const end = timestamp(observed.endedAt ?? trial.endedAt);
        valid = start !== null && end !== null && start <= end && start >= timestamp(run.startedAt) && end <= timestamp(run.endedAt) && valid;
        if (lastEnd !== null && start < lastEnd) valid = false;
        if (end !== null) lastEnd = end;
      }
      const eligible = phaseValid && valid;
      const saved = phaseReport.trials[index];
      check(saved.attemptId === trial.attemptId && saved.viewportId === trial.viewportId, 'attempt identity changed');
      check(saved.eligible === eligible && (saved.reasons.length === 0) === valid, 'trial eligibility differs from raw inputs');
      check(same(saved.values, values) && same(saved.paths, paths), 'trial metrics or retained paths changed');
      trials.push({ attemptId: trial.attemptId, viewportId: trial.viewportId, eligible, values });
      retainedAttempts += 1;
    }
    phases[phase] = { sourceSha: frozen.sourceSha, deploymentId: frozen.deploymentId, startedAt: run.startedAt, endedAt: run.endedAt, environment: run.environment, trials };
  }
  let globalValid = true;
  if (phases.before && phases.after) {
    globalValid = timestamp(phases.before.endedAt) < timestamp(phases.after.startedAt)
      && phases.before.sourceSha !== phases.after.sourceSha && phases.before.deploymentId !== phases.after.deploymentId;
    for (const key of ['nodeVersion', 'platform', 'arch', 'cpuModels', 'logicalCpuCount', 'totalMemoryBytes', 'runner']) {
      globalValid = Boolean(phases.before.environment?.[key]) && same(phases.before.environment[key], phases.after.environment?.[key]) && globalValid;
    }
  }
  check((report.globalProblems.length === 0) === globalValid, 'global comparison eligibility changed');
  check(report.viewports.length === protocol.profiles.length, 'viewport omitted');
  const counts = { comparable: 0, improved: 0, regressed: 0 };
  for (const profile of protocol.profiles) {
    const row = report.viewports.find((value) => value.id === profile.id);
    check(row && same(row.viewport, { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor }), 'viewport identity changed');
    check(Object.keys(row.metrics).length === Object.keys(protocol.metrics).length, 'metric omitted or invented');
    for (const [name, budget] of Object.entries(protocol.metrics)) {
      const collect = (phase) => (phases[phase]?.trials ?? []).filter((trial) => trial.viewportId === profile.id && trial.eligible && isValue(trial.values[name])).map((trial) => ({ attemptId: trial.attemptId, value: trial.values[name] }));
      const before = collect('before');
      const after = collect('after');
      const expected = independentlyCompare(before.map((entry) => entry.value), after.map((entry) => entry.value), budget, protocol.comparison, protocol.sampling.validRunsPerViewportAndPhase, globalValid);
      check(same(row.metrics[name], { ...expected, samples: { before, after } }), `metric calculation mismatch: ${profile.id}/${name}`);
      if (expected.classification !== 'not-comparable') counts.comparable += 1;
      if (expected.classification === 'improved') counts.improved += 1;
      if (expected.classification === 'regressed') counts.regressed += 1;
    }
  }
  const total = protocol.profiles.length * Object.keys(protocol.metrics).length;
  const expectedStatus = counts.comparable === total ? 'complete-task-local-lab-comparison' : 'incomplete-task-local-lab-comparison';
  check(report.status === expectedStatus && report.comparableMetricCount === counts.comparable && report.improvedMetricCount === counts.improved && report.regressedMetricCount === counts.regressed, 'score summary mismatch');
  return {
    schemaVersion: 'initial-load-validation.v1',
    status: 'evidence-and-calculation-verified',
    experimentStatus: expectedStatus,
    protocolSha256: PROTOCOL_HASH, artifactMapSha256,
    scoredSha256: hash(reportBytes), retainedArtifacts: bytes.size, retainedAttempts,
    comparableMetricCount: counts.comparable, improvedMetricCount: counts.improved, regressedMetricCount: counts.regressed,
    fieldAdmissionCount: 0, g003AdmissionCount: 0,
    meaning: 'The mapped evidence and calculations agree. This is not a blanket performance pass or a field/causal improvement claim.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const names = new Set(['--root', '--input', '--artifact-map', '--artifact-map-sha256', '--scored', '--output', '--repository']);
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index];
      check(names.has(key) && !options[key] && process.argv[index + 1], 'invalid arguments');
      options[key] = process.argv[index + 1];
    }
    const root = resolve(options['--root'] ?? DEFAULT_ROOT);
    const result = validateEvidence({ root, input: options['--input'], artifactMap: options['--artifact-map'], artifactMapSha256: options['--artifact-map-sha256'], scored: options['--scored'], repository: options['--repository'] ?? resolve(root, '../../../..') });
    const destination = options['--output'] ?? 'validated.json';
    check(/^[A-Za-z0-9._/-]+$/.test(destination) && !isAbsolute(destination) && !destination.split('/').some((part) => part === '..' || part === '.'), 'invalid output path');
    writeFileSync(resolve(root, destination), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
