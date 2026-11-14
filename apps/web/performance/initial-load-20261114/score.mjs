import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PINNED_PROTOCOL_SHA256 = '1d105370c00603d3539e7e82355c3e46647dd6ff5af49901595ad01951efb851';
const HERE = dirname(fileURLToPath(import.meta.url));
const HEX = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const AUDITS = {
  fcp: 'first-contentful-paint', lcp: 'largest-contentful-paint',
  tti: 'interactive', tbt: 'total-blocking-time', cls: 'cumulative-layout-shift',
};
const die = (message) => { throw new Error(`initial-load score: ${message}`); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function safePath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(value)
      || value.startsWith('/') || value.endsWith('/') || value.includes('//')
      || value.split('/').some((part) => part === '.' || part === '..')) die('unsafe artifact path');
  return value;
}

async function readWithin(root, path) {
  safePath(path);
  const absolute = resolve(root, path);
  const actualRoot = await realpath(root);
  const actual = await realpath(absolute);
  const inside = relative(actualRoot, actual);
  if (inside.startsWith('..') || isAbsolute(inside) || actual !== absolute) die('artifact symlink or escape');
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024 * 1024) die('invalid artifact file');
  return readFile(absolute);
}

function json(bytes, name) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { die(`invalid JSON: ${name}`); }
}

export function summarize(values) {
  if (values.some((value) => !finite(value))) die('nonfinite sample');
  if (!values.length) return { count: 0, median: null, mad: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (items) => items.length % 2 ? items[Math.floor(items.length / 2)]
    : (items[items.length / 2 - 1] + items[items.length / 2]) / 2;
  const median = middle(sorted);
  const mad = middle(values.map((value) => Math.abs(value - median)).sort((a, b) => a - b));
  return { count: values.length, median, mad, min: sorted[0], max: sorted.at(-1) };
}

export function compareMetric(beforeValues, afterValues, budget, settings, expectedCount, eligible = true) {
  const before = summarize(beforeValues);
  const after = summarize(afterValues);
  const complete = eligible && before.count === expectedCount && after.count === expectedCount;
  const reduction = before.median === null || after.median === null ? null : before.median - after.median;
  const improvementPercent = reduction === null || before.median === 0 ? null : reduction / before.median * 100;
  const noise = before.mad === null || after.mad === null ? null : settings.noiseMultiplier * Math.max(before.mad, after.mad);
  const relativeFloor = before.median === null ? null : settings.minimumRelativeReduction * before.median;
  const gates = complete ? {
    absoluteReduction: reduction >= budget.minimumReduction,
    relativeReduction: reduction >= relativeFloor,
    exceedsNoise: reduction > noise,
  } : null;
  const regression = complete && -reduction >= budget.minimumReduction && -reduction >= relativeFloor && -reduction > noise;
  let classification = 'not-comparable';
  if (complete) classification = Object.values(gates).every(Boolean) ? 'improved'
    : regression ? 'regressed' : 'no-confirmed-change';
  return {
    unit: budget.unit,
    goodTarget: budget.goodTarget,
    minimumReduction: budget.minimumReduction,
    before: { ...before, meetsTarget: before.median === null ? null : before.median <= budget.goodTarget },
    after: { ...after, meetsTarget: after.median === null ? null : after.median <= budget.goodTarget },
    reduction, improvementPercent, relativeReductionFloor: relativeFloor, noiseThreshold: noise,
    requiredReduction: noise === null ? null : Math.max(budget.minimumReduction, relativeFloor, noise),
    noiseBoundaryIsStrict: true,
    gates, classification,
  };
}

async function graphPaths(root, input) {
  const found = new Set([safePath(input), 'score.mjs', 'validate.mjs']);
  const manifest = json(await readWithin(root, input), input);
  for (const key of ['protocol', 'collector']) found.add(safePath(manifest[key]));
  for (const key of ['toolLock', 'toolManifest']) if (manifest[key]) found.add(safePath(manifest[key]));
  for (const phase of ['before', 'after']) {
    const entry = manifest.phases?.[phase];
    if (!entry) continue;
    found.add(safePath(entry.run));
    found.add(safePath(entry.frozenSource));
    const run = json(await readWithin(root, entry.run), entry.run);
    const frozen = json(await readWithin(root, entry.frozenSource), entry.frozenSource);
    found.add(safePath(frozen.identityEvidence));
    for (const path of Object.values(run.deploymentEvidence ?? {})) found.add(trialPath(entry.run, path));
    for (const trial of run.trials ?? []) {
      found.add(trialPath(entry.run, `${trial.attemptId}/trial.json`));
      for (const path of Object.values(trial.paths ?? {})) if (path !== null) found.add(safePath(path.startsWith(dirname(entry.run) + '/') ? path : relative(root, resolve(root, dirname(entry.run), path))));
    }
  }
  return [...found].sort();
}

export async function createArtifactMap({ root = HERE, input = 'experiment.json', output = 'artifact-map.json' } = {}) {
  root = resolve(root);
  const files = [];
  for (const path of await graphPaths(root, input)) {
    const bytes = await readWithin(root, path);
    files.push({ path, sha256: digest(bytes), sizeBytes: bytes.length });
  }
  const map = { schemaVersion: 'initial-load-artifact-map.v1', files };
  const bytes = Buffer.from(`${JSON.stringify(map, null, 2)}\n`);
  await writeFile(resolve(root, safePath(output)), bytes, { flag: 'wx' });
  return { artifactMap: output, artifactMapSha256: digest(bytes), files: files.length };
}

async function verifiedReader(root, path, expectedHash) {
  if (!HEX.test(expectedHash ?? '')) die('detached artifact-map SHA-256 is required');
  const bytes = await readWithin(root, path);
  if (digest(bytes) !== expectedHash) die('artifact-map hash mismatch');
  const map = json(bytes, path);
  if (map.schemaVersion !== 'initial-load-artifact-map.v1' || !Array.isArray(map.files)) die('artifact-map schema');
  const entries = new Map();
  for (const file of map.files) {
    safePath(file.path);
    if (entries.has(file.path) || !HEX.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) die('artifact-map entry');
    entries.set(file.path, file);
  }
  const cached = new Map();
  const get = async (name) => {
    safePath(name);
    if (!entries.has(name)) die(`unmapped input: ${name}`);
    if (!cached.has(name)) {
      const content = await readWithin(root, name);
      const entry = entries.get(name);
      if (content.length !== entry.sizeBytes || digest(content) !== entry.sha256) die(`artifact hash mismatch: ${name}`);
      cached.set(name, content);
    }
    return cached.get(name);
  };
  // Verify every retained mapped artifact, including invalid attempts and images.
  for (const name of entries.keys()) await get(name);
  return { get, entries, getJson: async (name) => json(await get(name), name) };
}

function trialPath(runPath, path) {
  if (path === null || path === undefined) return null;
  safePath(path);
  const base = dirname(runPath);
  return base === '.' || path.startsWith(`${base}/`) ? path : `${base}/${path}`;
}

function gitTree(repository, sourceSha) {
  if (!GIT.test(sourceSha ?? '')) die('source SHA is not immutable');
  try { return execFileSync('git', ['-C', repository, 'rev-parse', `${sourceSha}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { die('frozen source commit is unavailable in the repository'); }
}

function measuredMetrics(observation, lhr) {
  const nav = observation.navigation ?? {};
  const ttfb = finite(nav.responseStart) && finite(nav.startTime) && nav.responseStart > 0 && nav.responseStart >= nav.startTime
    ? nav.responseStart - nav.startTime : null;
  const values = { ttfb };
  for (const [metric, id] of Object.entries(AUDITS)) {
    const audit = lhr.audits?.[id];
    values[metric] = audit && !audit.errorMessage && !audit.errorCode && audit.scoreDisplayMode !== 'error' && finite(audit.numericValue) ? audit.numericValue : null;
  }
  const traceEnd = lhr.audits?.metrics?.details?.items?.[0]?.observedTraceEnd;
  for (const metric of ['controlsReady', 'mapReady']) {
    const value = observation.timings?.[`${metric}Ms`];
    values[metric] = finite(value) && finite(traceEnd) && value <= traceEnd ? value : null;
  }
  return values;
}

function browserLaunchMatches(observed, protocol, measured) {
  const declared = protocol.browserLaunch;
  return observed?.headless === declared.headless && observed.sandboxMode === declared.sandboxMode
    && observed.scope === declared.scope && observed.noSandboxObserved === declared.requiredNoSandboxObserved
    && equal(observed.explicitArgs, measured ? declared.measurementExplicitArgs : declared.healthExplicitArgs);
}

function readbackTransportMatches(identity, protocol) {
  return identity?.transport === protocol.deploymentReadback.transport
    && identity.isolatedFromMeasuredBrowser === true && identity.credentialsUsed === false
    && identity.browser?.product === protocol.deploymentReadback.browserProduct
    && identity.browser?.version === protocol.deploymentReadback.browserVersion
    && typeof identity.browser?.executable === 'string' && isAbsolute(identity.browser.executable)
    && browserLaunchMatches(identity.browserLaunch, protocol, false);
}

function observationProblems(observation, lhr, profile, protocol, frozen) {
  const problems = [];
  const mark = (ok, reason) => { if (!ok) problems.push(reason); };
  mark(observation.source?.gitSha === frozen.sourceSha && observation.source?.deploymentId === frozen.deploymentId, 'OBSERVED_SOURCE_MISMATCH');
  for (const boundary of ['healthBefore', 'healthAfter']) {
    const identity = observation.source?.[boundary];
    mark(identity?.healthOk === true && identity.gitSha === frozen.sourceSha && identity.deploymentId === frozen.deploymentId && readbackTransportMatches(identity, protocol), `OBSERVED_${boundary.toUpperCase()}_MISMATCH`);
  }
  mark(lhr.lighthouseVersion === protocol.tools.lighthouse, 'LIGHTHOUSE_VERSION_MISMATCH');
  mark(observation.browser?.version === protocol.tools.chrome, 'CHROME_VERSION_MISMATCH');
  mark(typeof observation.browser?.executable === 'string' && isAbsolute(observation.browser.executable), 'BROWSER_EXECUTABLE_MISSING');
  mark(typeof observation.browser?.product === 'string' && /Chrome/.test(observation.browser.product), 'BROWSER_PRODUCT_MISSING');
  mark(browserLaunchMatches(observation.browserLaunch, protocol, true), 'OBSERVED_BROWSER_LAUNCH_POLICY_MISMATCH');
  mark(!lhr.runtimeError, 'LIGHTHOUSE_RUNTIME_ERROR');
  mark(lhr.requestedUrl === protocol.url && lhr.finalDisplayedUrl === protocol.url && lhr.finalUrl === protocol.url, 'URL_OR_REDIRECT_MISMATCH');
  mark(observation.requestedUrl === protocol.measurementUrl && observation.finalUrl === protocol.url && observation.initialDocumentQaExcluded === true, 'MEASUREMENT_URL_OR_QA_EXCLUSION_MISMATCH');
  for (const key of ['width', 'height', 'deviceScaleFactor']) {
    mark(observation.actualViewport?.[key] === profile[key], `ACTUAL_VIEWPORT_${key.toUpperCase()}_MISMATCH`);
    mark(observation.requestedViewport?.[key] === profile[key], `REQUESTED_VIEWPORT_${key.toUpperCase()}_MISMATCH`);
  }
  const config = lhr.configSettings ?? {};
  mark(config.throttlingMethod === protocol.lighthouse.throttlingMethod, 'THROTTLING_METHOD_MISMATCH');
  mark(config.formFactor === profile.formFactor, 'FORM_FACTOR_MISMATCH');
  mark(config.disableStorageReset === false, 'COLD_STORAGE_RESET_MISSING');
  for (const [key, value] of Object.entries(profile.throttling)) mark(config.throttling?.[key] === value, `THROTTLING_${key.toUpperCase()}_MISMATCH`);
  for (const key of ['width', 'height', 'deviceScaleFactor']) mark(config.screenEmulation?.[key] === profile[key], `LIGHTHOUSE_VIEWPORT_${key.toUpperCase()}_MISMATCH`);
  mark(config.screenEmulation?.disabled === false && config.screenEmulation?.mobile === profile.isMobile, 'LIGHTHOUSE_SCREEN_MODE_MISMATCH');
  mark(config.emulatedUserAgent === profile.userAgent, 'EMULATED_USER_AGENT_MISMATCH');
  mark(observation.navigation?.type === 'navigate', 'NOT_A_COLD_NAVIGATION');
  if (observation.navigation?.responseStatus !== undefined) mark(observation.navigation.responseStatus === 200, 'DOCUMENT_STATUS_NOT_200');
  const errors = observation.errors ?? {};
  mark(errors.mainDocumentStatus === 200, 'MAIN_DOCUMENT_NOT_200');
  mark(errors.pageErrors === 0 && errors.firstPartyHttpErrors === 0, 'FUNCTIONAL_BROWSER_ERRORS_RECORDED');
  mark(observation.readiness?.controlsQualified === true, 'CONTROLS_NOT_READY');
  mark(observation.readiness?.mapQualified === true && observation.readiness?.naverSdkPresent === true, 'NAVER_MAP_NOT_READY');
  mark(observation.readiness?.initialSkeletonVisible === false, 'SKELETON_STILL_VISIBLE');
  const ready = observation.readiness ?? {};
  mark(ready.tileReadyCount > 0 && ready.naverMarkerCount > 0, 'MAP_TILE_OR_MARKER_MISSING');
  if (profile.width >= 1280) {
    mark(ready.homeChromeReady === true && ready.actualDesktopControls === true && ready.desktopMenuReady === true && ready.desktopSearchReady === true, 'DESKTOP_CONTROLS_NOT_READY');
    mark(ready.desktopPanelQualified === true && ready.homePanelReady === true && ready.desktopPanelPresent === true && ready.desktopPanelAlertCount === 0 && ready.desktopPopularItemCount > 0 && ready.desktopLatestItemCount > 0, 'DESKTOP_PANEL_NOT_READY');
  } else mark(ready.homeMobileChromeReady === true, 'MOBILE_CONTROLS_NOT_READY');
  mark(observation.samplingIntervalMs === protocol.applicationTimings.samplingIntervalMs, 'READINESS_SAMPLING_INTERVAL_MISMATCH');
  if (Array.isArray(observation.failures)) mark(observation.failures.length === 0, 'OBSERVATION_FAILURES');
  return problems;
}

export async function scoreExperiment({ root = HERE, input = 'experiment.json', artifactMap = 'artifact-map.json', artifactMapSha256, repository = resolve(HERE, '../../../..') } = {}) {
  root = resolve(root);
  const reader = await verifiedReader(root, artifactMap, artifactMapSha256);
  const manifest = await reader.getJson(input);
  if (manifest.schemaVersion !== 'initial-load-experiment.v1') die('experiment schema');
  const protocolBytes = await reader.get(manifest.protocol);
  if (digest(protocolBytes) !== PINNED_PROTOCOL_SHA256) die('predeclared protocol changed');
  const protocol = json(protocolBytes, manifest.protocol);
  const collectorHash = digest(await reader.get(manifest.collector));
  const hasPhase = Boolean(manifest.phases?.before || manifest.phases?.after);
  if (hasPhase && (!manifest.toolLock || !manifest.toolManifest)) die('tool lock and manifest bindings required');
  const toolLockBytes = manifest.toolLock ? await reader.get(manifest.toolLock) : null;
  const toolLock = toolLockBytes ? json(toolLockBytes, manifest.toolLock) : null;
  const toolManifest = manifest.toolManifest ? await reader.getJson(manifest.toolManifest) : null;
  if (hasPhase && (toolLock?.packages?.['node_modules/lighthouse']?.version !== protocol.tools.lighthouse || toolManifest?.dependencies?.lighthouse !== protocol.tools.lighthouse)) die('Lighthouse tooling pin mismatch');
  if (digest(await reader.get('score.mjs')) !== digest(await readFile(fileURLToPath(import.meta.url)))) die('executing scorer differs from mapped code');
  const phases = {};
  const globalProblems = [];
  for (const phase of ['before', 'after']) {
    const reference = manifest.phases?.[phase];
    if (!reference) { phases[phase] = null; continue; }
    const run = await reader.getJson(reference.run);
    const frozen = await reader.getJson(reference.frozenSource);
    const identity = await reader.getJson(frozen.identityEvidence);
    const issues = [];
    const require = (ok, reason) => { if (!ok) issues.push(reason); };
    require(run.schemaVersion === 'initial-load-run.v1' && run.phase === phase, 'RUN_SCHEMA_OR_PHASE_MISMATCH');
    require(frozen.schemaVersion === 'initial-load-frozen-source.v1' && frozen.phase === phase, 'FROZEN_SOURCE_SCHEMA_OR_PHASE_MISMATCH');
    require(run.sourceSha === frozen.sourceSha && run.sourceTreeSha === frozen.sourceTreeSha, 'RUN_SOURCE_MISMATCH');
    require(frozen.sourceTreeSha === gitTree(repository, frozen.sourceSha), 'FROZEN_TREE_MISMATCH');
    require(frozen.canonicalUrl === protocol.url, 'FROZEN_URL_MISMATCH');
    require(identity.ok === true && identity.gitSha === frozen.sourceSha && identity.deploymentId === frozen.deploymentId && identity.host === new URL(protocol.url).hostname, 'DEPLOYMENT_IDENTITY_MISMATCH');
    require(readbackTransportMatches(identity, protocol), 'IDENTITY_READBACK_TRANSPORT_INVALID');
    for (const boundary of ['before', 'after']) {
      const path = trialPath(reference.run, run.deploymentEvidence?.[boundary]);
      if (!path) { require(false, `PHASE_${boundary.toUpperCase()}_READBACK_MISSING`); continue; }
      const receipt = await reader.getJson(path);
      require(receipt.ok === true && receipt.healthOk === true && receipt.gitSha === frozen.sourceSha && receipt.deploymentId === frozen.deploymentId && readbackTransportMatches(receipt, protocol), `PHASE_${boundary.toUpperCase()}_READBACK_INVALID`);
    }
    require(typeof frozen.deploymentId === 'string' && /^dpl_[A-Za-z0-9]+$/.test(frozen.deploymentId), 'DEPLOYMENT_ID_MISSING');
    require(time(frozen.verifiedAt) !== null, 'FROZEN_VERIFICATION_TIME_MISSING');
    require(run.protocolSha256 === PINNED_PROTOCOL_SHA256 && run.collectorSha256 === collectorHash, 'MEASUREMENT_CODE_HASH_MISMATCH');
    require(run.toolLockSha256 === digest(toolLockBytes), 'TOOL_LOCK_HASH_MISMATCH');
    require(run.puppeteerVersion === toolLock?.packages?.['node_modules/puppeteer-core']?.version, 'PUPPETEER_LOCK_MISMATCH');
    for (const key of ['lighthouse', 'playwright', 'chrome']) require(run.pins?.[key] === protocol.tools[key], `RUN_${key.toUpperCase()}_PIN_MISMATCH`);
    require(typeof run.environment?.nodeVersion === 'string' && /^v?24\./.test(run.environment.nodeVersion), 'NODE_VERSION_MISSING_OR_MISMATCH');
    require(run.environment?.runner?.environment === protocol.browserLaunch.requiredRunnerEnvironment, 'BROWSER_LAUNCH_RUNNER_SCOPE_MISMATCH');
    require(browserLaunchMatches(run.browserLaunch, protocol, true), 'RUN_BROWSER_LAUNCH_POLICY_MISMATCH');
    require(time(run.startedAt) !== null && time(run.endedAt) !== null && time(run.startedAt) <= time(run.endedAt), 'RUN_TIME_INVALID');
    require(time(run.startedAt) >= time(protocol.declaredAt), 'RUN_PRECEDES_PROTOCOL');
    if (phase === 'before') require(frozen.sourceSha === protocol.baselineSourceSha, 'BASELINE_SOURCE_MISMATCH');
    const trials = [];
    const ids = new Set();
    let previousEnd = null;
    for (const trial of run.trials ?? []) {
      if (ids.has(trial.attemptId)) die('duplicate trial ID');
      ids.add(trial.attemptId);
      const profile = protocol.profiles.find((item) => item.id === trial.viewportId);
      if (!profile) die('unrecognized trial viewport');
      const reasons = [];
      if (trial.status !== 'valid') reasons.push('COLLECTOR_REPORTED_INVALID');
      if (!Array.isArray(trial.failures) || trial.failures.length) reasons.push('COLLECTOR_FAILURES');
      if (!browserLaunchMatches(trial.browserLaunch, protocol, true)) reasons.push('TRIAL_BROWSER_LAUNCH_POLICY_MISMATCH');
      const paths = {};
      for (const key of ['observations', 'lhr', 'trace', 'network', 'screenshot']) {
        paths[key] = trialPath(reference.run, trial.paths?.[key]);
        if (!paths[key]) reasons.push(`MISSING_${key.toUpperCase()}_ARTIFACT`);
        else await reader.get(paths[key]);
      }
      let values = Object.fromEntries(Object.keys(protocol.metrics).map((name) => [name, null]));
      if (paths.observations && paths.lhr) {
        const observation = await reader.getJson(paths.observations);
        const lhr = await reader.getJson(paths.lhr);
        reasons.push(...observationProblems(observation, lhr, profile, protocol, frozen));
        values = measuredMetrics(observation, lhr);
        const start = time(observation.startedAt ?? trial.startedAt);
        const end = time(observation.endedAt ?? trial.endedAt);
        if (start === null || end === null || start > end || start < time(run.startedAt) || end > time(run.endedAt)) reasons.push('TRIAL_TIME_INVALID');
        if (previousEnd !== null && start < previousEnd) reasons.push('CONCURRENT_TRIALS');
        if (end !== null) previousEnd = end;
      }
      trials.push({ attemptId: trial.attemptId, viewportId: trial.viewportId, eligible: issues.length === 0 && reasons.length === 0, reasons, browserLaunch: trial.browserLaunch ?? null, values, paths });
    }
    phases[phase] = { sourceSha: frozen.sourceSha, sourceTreeSha: frozen.sourceTreeSha, deploymentId: frozen.deploymentId, startedAt: run.startedAt, endedAt: run.endedAt, environment: run.environment ?? null, browserLaunch: run.browserLaunch ?? null, issues, trials };
  }
  if (phases.before && phases.after) {
    if (time(phases.before.endedAt) >= time(phases.after.startedAt)) globalProblems.push('PHASES_OVERLAP_OR_ORDER_INVALID');
    if (phases.before.sourceSha === phases.after.sourceSha) globalProblems.push('SOURCE_UNCHANGED');
    if (phases.before.deploymentId === phases.after.deploymentId) globalProblems.push('DEPLOYMENT_UNCHANGED');
    const keys = ['nodeVersion', 'platform', 'arch', 'cpuModels', 'logicalCpuCount', 'totalMemoryBytes', 'runner'];
    if (keys.some((key) => !phases.before.environment?.[key] || !equal(phases.before.environment[key], phases.after.environment?.[key]))) globalProblems.push('RUNNER_ENVIRONMENT_MISMATCH_OR_MISSING');
  }
  const viewports = [];
  for (const profile of protocol.profiles) {
    const metrics = {};
    for (const [name, budget] of Object.entries(protocol.metrics)) {
      const sample = (phase) => (phases[phase]?.trials ?? []).filter((trial) => trial.viewportId === profile.id && trial.eligible && finite(trial.values[name])).map((trial) => ({ attemptId: trial.attemptId, value: trial.values[name] }));
      const before = sample('before');
      const after = sample('after');
      metrics[name] = { ...compareMetric(before.map((x) => x.value), after.map((x) => x.value), budget, protocol.comparison, protocol.sampling.validRunsPerViewportAndPhase, globalProblems.length === 0), samples: { before, after } };
    }
    viewports.push({ id: profile.id, viewport: { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor }, metrics });
  }
  const classifications = viewports.flatMap((profile) => Object.values(profile.metrics).map((metric) => metric.classification));
  return {
    schemaVersion: 'initial-load-score.v1',
    protocolSha256: PINNED_PROTOCOL_SHA256, artifactMapSha256,
    measurementType: protocol.scope.measurementType,
    comparisonDesign: protocol.sampling.order, paired: false,
    status: classifications.every((value) => value !== 'not-comparable') ? 'complete-task-local-lab-comparison' : 'incomplete-task-local-lab-comparison',
    fieldAdmissionCount: 0, g003AdmissionCount: 0,
    improvedMetricCount: classifications.filter((value) => value === 'improved').length,
    regressedMetricCount: classifications.filter((value) => value === 'regressed').length,
    comparableMetricCount: classifications.filter((value) => value !== 'not-comparable').length,
    globalProblems, phases, viewports,
    limitations: protocol.scope.limitations,
  };
}

function argumentsFrom(argv) {
  const result = {};
  const allowed = new Set(['--root', '--input', '--output', '--artifact-map', '--artifact-map-sha256', '--repository']);
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || !argv[i + 1] || result[argv[i]]) die('invalid command line');
    result[argv[i]] = argv[i + 1];
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] === 'map' ? 'map' : 'score';
    const options = argumentsFrom(process.argv.slice(mode === 'map' ? 3 : 2));
    const root = resolve(options['--root'] ?? HERE);
    if (mode === 'map') console.log(JSON.stringify(await createArtifactMap({ root, input: options['--input'], output: options['--output'] }), null, 2));
    else {
      const output = options['--output'] ?? 'scored.json';
      const scored = await scoreExperiment({ root, input: options['--input'], artifactMap: options['--artifact-map'], artifactMapSha256: options['--artifact-map-sha256'], repository: options['--repository'] ?? resolve(root, '../../../..') });
      await writeFile(resolve(root, safePath(output)), `${JSON.stringify(scored, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ output, status: scored.status, comparableMetricCount: scored.comparableMetricCount, improvedMetricCount: scored.improvedMetricCount, regressedMetricCount: scored.regressedMetricCount, fieldAdmissionCount: 0, g003AdmissionCount: 0 }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
