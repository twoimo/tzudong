// Independent extraction, eligibility and math. No fixture scorer is imported.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { independentlyCompare } from './validate.mjs';
import { HERE, PROTOCOL_SHA256, digest, finite, same, stamp, hex, commit, requireThat,
  loadFixtureEvidence, argumentsFor, writeResult } from './fixture-evidence.mjs';

function checkLaunch(actual, p) {
  return actual?.headless === true && actual?.sandboxMode === p.browserLaunch.sandboxMode
    && actual?.scope === p.browserLaunch.scope && actual?.noSandboxObserved === true
    && same(actual?.explicitArgs, p.browserLaunch.measurementExplicitArgs);
}
function originalSource(repository, build, fixture) {
  if (!commit(build.sourceSha) || !commit(build.sourceTreeSha)) return false;
  try {
    const git = args => execFileSync('git', ['-C', repository, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    if (git(['rev-parse', build.sourceSha + '^{tree}']).toString().trim() !== build.sourceTreeSha) return false;
    if (digest(git(['show', build.sourceSha + ':apps/web/package-lock.json'])) !== build.appLockSha256) return false;
    return fixture.sourceFiles.every(item => digest(git(['show', build.sourceSha + ':' + item.path])) === item.sha256);
  } catch { return false; }
}
function independentlyCheckContext(data, repository) {
  const p = data.protocol, e = data.experiment, f = data.fixture, b = data.builds, failures = [];
  const mark = (test, reason) => { if (!test) failures.push(reason); };
  mark(e.scope === 'frontend-fixture' && e.schemaVersion === 'frontend-fixture-experiment.v1' && p.scope.measurementType === 'frontend-fixture', 'scope');
  mark(f.schemaVersion === 'frontend-fixture-manifest.v1' && f.provider === 'mock-naver' && f.helperExport === p.fixture.helperExport
    && f.fixtureRestaurantCount === 3 && f.sourceSha === b.after.sourceSha && data.hashes.get(f.bundlePath) === f.bundleSha256
    && same(f.sourceFiles?.map(item => item.path), p.fixture.sourcePaths)
    && f.sourceFiles.every(item => data.hashes.get(item.artifactPath) === item.sha256), 'fixture-binding');
  mark(JSON.parse(data.content.get(e.toolLock)).packages?.['node_modules/lighthouse']?.version === p.tools.lighthouse, 'tool-lock');
  mark(b.before.sourceSha === p.baselineSourceSha && b.after.sourceSha !== b.before.sourceSha, 'source-order');
  mark(b.before.appLockSha256 === b.after.appLockSha256, 'dependency-lock');
  for (const name of ['before', 'after']) {
    const build = b[name], run = data.phases[name]?.run;
    mark(build.schemaVersion === 'frontend-fixture-build.v1' && build.phase === name && build.sourceTreeClean === true
      && build.mode === 'production' && stamp(build.completedAt) !== null && originalSource(repository, build, f), name + '-build-source');
    const seen = new Set();
    const entries = Array.isArray(build.files) && build.files.length > 0 && build.files.every(item => {
      if (seen.has(item.path)) return false; seen.add(item.path);
      return typeof item.path === 'string' && item.path.startsWith('.next/') && hex(item.sha256) && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0;
    });
    mark(entries && digest(JSON.stringify(build.files)) === build.buildFingerprintSha256, name + '-build-fingerprint');
    if (!run) { failures.push(name + '-missing'); continue; }
    mark(run.schemaVersion === 'frontend-fixture-run.v1' && run.scope === 'frontend-fixture' && run.phase === name
      && run.status === 'valid' && run.failures?.length === 0 && run.url === p.measurementUrl && run.cachePolicy === p.sampling.cache
      && stamp(run.startedAt) !== null && stamp(run.endedAt) >= stamp(run.startedAt), name + '-run');
    mark(run.sourceSha === build.sourceSha && run.sourceTreeSha === build.sourceTreeSha && run.build.mode === 'production'
      && run.build.assetManifestPath === e.builds[name] && run.build.completedAt === build.completedAt
      && run.build.assetManifestSha256 === data.hashes.get(e.builds[name]) && run.build.buildFingerprintSha256 === build.buildFingerprintSha256
      && run.fixtureManifestPath === e.fixtureManifest && run.fixtureSha256 === data.hashes.get(e.fixtureManifest), name + '-run-binding');
    mark(run.protocolSha256 === PROTOCOL_SHA256 && run.collectorSha256 === data.hashes.get(e.collector)
      && run.sanitizerSha256 === data.hashes.get(e.sanitizer) && run.toolLockSha256 === data.hashes.get(e.toolLock)
      && same(run.pins, { lighthouse: p.tools.lighthouse, playwright: p.tools.playwright, chrome: p.tools.chrome })
      && /^v24\./.test(run.environment?.nodeVersion) && run.environment?.runner?.environment === 'github-hosted'
      && checkLaunch(run.browserLaunch, p), name + '-tools');
    const expectedIds = [];
    for (const profile of p.profiles) for (let index = 1; index <= 5; index++) expectedIds.push(profile.id + '-' + String(index).padStart(2, '0'));
    mark(same(run.trials.map(item => item.attemptId), expectedIds), name + '-sample-order');
    let previousEnd = stamp(run.startedAt);
    for (const item of run.trials) {
      const begin = stamp(item.startedAt), end = stamp(item.endedAt);
      mark(begin !== null && end !== null && begin >= previousEnd && end >= begin && end <= stamp(run.endedAt), name + '-trial-order'); previousEnd = end;
    }
  }
  const before = data.phases.before?.run, after = data.phases.after?.run;
  if (before) for (const build of Object.values(b)) mark(stamp(build.completedAt) <= stamp(before.startedAt), 'both-builds-before-measurement');
  if (before && after) { mark(stamp(before.endedAt) <= stamp(after.startedAt), 'phase-order'); mark(same(before.environment, after.environment), 'same-runner'); }
  return { eligible: failures.length === 0, failures: [...new Set(failures)] };
}
function independentlyExtract(o, report) {
  const n = o?.navigation, values = {};
  values.ttfb = finite(n?.responseStart) && finite(n.startTime) && n.responseStart > 0 && n.responseStart >= n.startTime ? n.responseStart - n.startTime : null;
  for (const [key, audit] of [['fcp', 'first-contentful-paint'], ['lcp', 'largest-contentful-paint'], ['tti', 'interactive'], ['tbt', 'total-blocking-time'], ['cls', 'cumulative-layout-shift']]) {
    const field = report?.audits?.[audit];
    values[key] = field && field.scoreDisplayMode !== 'error' && !field.errorCode && !field.errorMessage && finite(field.numericValue) ? field.numericValue : null;
  }
  const end = report?.audits?.metrics?.details?.items?.[0]?.observedTraceEnd, ready = o?.timings?.controlsReadyMs;
  values.controlsReady = finite(end) && finite(ready) && ready <= end ? ready : null;
  return values;
}
function independentTrial(item, run, p) {
  const trial = item.trial, o = item.observation, report = item.lhr;
  const profile = p.profiles.find(value => value.id === trial.viewportId);
  if (!o || !report || !profile) return false;
  const r = o.readiness, c = report.configSettings;
  const checks = [
    trial.status === 'valid', trial.failures?.length === 0, trial.phase === run.phase,
    ['observations', 'lhr', 'trace', 'network', 'screenshot'].every(key => typeof trial.paths?.[key] === 'string'),
    o.schemaVersion === 'frontend-fixture-observations.v1', o.scope === 'frontend-fixture', o.phase === trial.phase, o.attemptId === trial.attemptId, o.viewportId === trial.viewportId,
    o.source?.sourceSha === run.sourceSha, o.source?.sourceTreeSha === run.sourceTreeSha, o.source?.buildFingerprintSha256 === run.build.buildFingerprintSha256,
    o.fixtureSha256 === run.fixtureSha256, o.ttfbScope === 'loopback-frontend-fixture-not-production',
    o.browser?.product === p.tools.browserProduct, o.browser?.version === p.tools.chrome, isAbsolute(o.browser?.executable ?? ''),
    checkLaunch(o.browserLaunch, p), checkLaunch(trial.browserLaunch, p),
    same(o.actualViewport, { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor }),
    same(o.requestedViewport, { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor }),
    o.requestedUrl === p.measurementUrl, o.finalUrl === p.url, o.initialDocumentQaExcluded === true, o.navigation?.type === 'navigate', o.navigation?.responseStatus === 200,
    report.lighthouseVersion === p.tools.lighthouse, !report.runtimeError, report.requestedUrl === p.url, report.finalDisplayedUrl === p.url, report.finalUrl === p.url,
    c?.throttlingMethod === 'devtools', c?.formFactor === profile.formFactor, c?.disableStorageReset === false, c?.emulatedUserAgent === profile.userAgent,
    same(c?.throttling, profile.throttling), c?.screenEmulation?.disabled === false, c?.screenEmulation?.mobile === profile.isMobile,
    ['width', 'height', 'deviceScaleFactor'].every(key => c?.screenEmulation?.[key] === profile[key]),
    o.errors?.pageErrors === 0, o.errors?.firstPartyHttpErrors === 0, o.errors?.mainDocumentStatus === 200,
    o.networkPolicy?.externalRuntimeRequestsAllowed === 0, o.networkPolicy?.externalRuntimeRequestsBlocked === true,
    o.samplingIntervalMs === 100, r?.mockOverlayVisible === true, r?.markerCount > 0, r?.initialSkeletonVisible === false,
  ];
  if (profile.id === 'desktop') checks.push(r?.homeChromeReady, r?.desktopMenuReady, r?.desktopSearchReady, r?.homePanelReady, r?.desktopPanelPresent,
    r?.desktopPanelAlertCount === 0, r?.desktopPopularItemCount === 3, r?.desktopLatestSectionPresent === true, r?.desktopLatestSkeletonPresent === false);
  else checks.push(r?.homeMobileChromeReady);
  return checks.every(Boolean);
}

export async function validateFixture(options = {}) {
  const data = await loadFixtureEvidence(options), p = data.protocol;
  const scored = JSON.parse(await readFile(resolve(options.root ?? HERE, options.scored ?? 'fixture-scored.json'), 'utf8'));
  const context = independentlyCheckContext(data, resolve(options.repository ?? resolve(HERE, '../../../..'))), phases = {};
  for (const phase of ['before', 'after']) {
    const entry = data.phases[phase];
    phases[phase] = entry ? { sourceSha: entry.run.sourceSha, sourceTreeSha: entry.run.sourceTreeSha, trials: entry.trials.map(item => ({
      attemptId: item.trial.attemptId, viewportId: item.trial.viewportId, eligible: independentTrial(item, entry.run, p), values: independentlyExtract(item.observation, item.lhr),
    })) } : null;
  }
  const profiles = [];
  for (const profile of p.profiles) {
    const metrics = {};
    for (const [key, budget] of Object.entries(p.metrics)) {
      const samples = {};
      for (const phase of ['before', 'after']) samples[phase] = (phases[phase]?.trials ?? []).filter(trial => trial.eligible && trial.viewportId === profile.id)
        .map(trial => trial.values[key]).filter(finite);
      metrics[key] = independentlyCompare(samples.before, samples.after, budget, p.comparison, 5, context.eligible);
    }
    profiles.push({ id: profile.id, metrics });
  }
  const expected = { schemaVersion: 'frontend-fixture-score.v1', scope: 'frontend-fixture', artifactMapSha256: data.artifactMapSha256,
    productionMetricAdmissionCount: 0, fieldAdmissionCount: 0, g003AdmissionCount: 0,
    ttfbScope: 'loopback-frontend-fixture-not-production', comparisonDesign: 'same-runner-sequential-unpaired', context, phases, profiles };
  requireThat(same(scored, expected), 'independently derived evidence or calculation differs from scored result');
  return { schemaVersion: 'frontend-fixture-validation.v1', status: 'evidence-and-calculation-verified', scope: 'frontend-fixture',
    artifactMapSha256: data.artifactMapSha256, comparisonEligible: context.eligible,
    comparableMetrics: profiles.flatMap(profile => Object.values(profile.metrics)).filter(metric => metric.classification !== 'not-comparable').length,
    productionMetricAdmissionCount: 0, fieldAdmissionCount: 0, g003AdmissionCount: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = argumentsFor(process.argv.slice(2));
  try { const result = await validateFixture(options); await writeResult(resolve(options.root ?? HERE), options.output ?? 'fixture-validated.json', result); process.stdout.write(JSON.stringify(result) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
