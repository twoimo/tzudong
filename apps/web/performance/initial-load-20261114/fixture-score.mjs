import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMetric } from './score.mjs';
import { HERE, PROTOCOL_SHA256, digest, same, stamp, finite, hex, commit, loadFixtureEvidence,
  createFixtureMap, argumentsFor, writeResult } from './fixture-evidence.mjs';

const AUDITS = { fcp: 'first-contentful-paint', lcp: 'largest-contentful-paint', tti: 'interactive',
  tbt: 'total-blocking-time', cls: 'cumulative-layout-shift' };
const gitBytes = (repository, revision) => execFileSync('git', ['-C', repository, 'show', revision], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
function sourceMatches(repository, build, fixture) {
  try {
    return commit(build.sourceSha) && commit(build.sourceTreeSha)
      && execFileSync('git', ['-C', repository, 'rev-parse', build.sourceSha + '^{tree}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === build.sourceTreeSha
      && digest(gitBytes(repository, build.sourceSha + ':apps/web/package-lock.json')) === build.appLockSha256
      && fixture.sourceFiles.every(file => digest(gitBytes(repository, build.sourceSha + ':' + file.path)) === file.sha256);
  } catch { return false; }
}
function launchMatches(value, protocol) {
  const expected = protocol.browserLaunch;
  return value?.headless === expected.headless && value?.sandboxMode === expected.sandboxMode && value?.scope === expected.scope
    && value?.noSandboxObserved === true && same(value?.explicitArgs, expected.measurementExplicitArgs);
}
function contextFor(data, repository) {
  const { experiment: e, protocol: p, fixture: f, builds, phases, hashes, content } = data;
  const failures = [];
  const test = (value, code) => { if (!value) failures.push(code); };
  test(e.schemaVersion === 'frontend-fixture-experiment.v1' && e.scope === 'frontend-fixture' && p.scope.measurementType === 'frontend-fixture', 'scope');
  test(f.schemaVersion === 'frontend-fixture-manifest.v1' && f.helperExport === p.fixture.helperExport
    && f.fixtureRestaurantCount === 3 && f.provider === 'mock-naver' && f.sourceSha === builds.after.sourceSha && hashes.get(f.bundlePath) === f.bundleSha256
    && same(f.sourceFiles?.map(file => file.path), p.fixture.sourcePaths)
    && f.sourceFiles.every(file => hashes.get(file.artifactPath) === file.sha256), 'fixture-binding');
  const lock = JSON.parse(content.get(e.toolLock));
  test(lock.packages?.['node_modules/lighthouse']?.version === p.tools.lighthouse, 'tool-lock');
  test(builds.before.sourceSha === p.baselineSourceSha && builds.before.sourceSha !== builds.after.sourceSha, 'source-order');
  test(builds.before.appLockSha256 === builds.after.appLockSha256, 'dependency-lock');
  for (const phase of ['before', 'after']) {
    const build = builds[phase], entry = phases[phase], run = entry?.run;
    test(build.schemaVersion === 'frontend-fixture-build.v1' && build.phase === phase && build.mode === 'production'
      && build.sourceTreeClean === true && stamp(build.completedAt) !== null && sourceMatches(repository, build, f), phase + '-build-source');
    test(Array.isArray(build.files) && build.files.length > 0 && new Set(build.files.map(file => file.path)).size === build.files.length
      && build.files.every(file => typeof file.path === 'string' && file.path.startsWith('.next/') && hex(file.sha256) && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0)
      && digest(JSON.stringify(build.files)) === build.buildFingerprintSha256, phase + '-build-fingerprint');
    if (!run) { failures.push(phase + '-missing'); continue; }
    const env = run.environment;
    test(run.schemaVersion === 'frontend-fixture-run.v1' && run.scope === 'frontend-fixture' && run.phase === phase && run.status === 'valid'
      && run.failures?.length === 0 && run.url === p.measurementUrl && run.cachePolicy === p.sampling.cache
      && stamp(run.startedAt) !== null && stamp(run.endedAt) >= stamp(run.startedAt), phase + '-run');
    test(run.sourceSha === build.sourceSha && run.sourceTreeSha === build.sourceTreeSha && run.build.mode === 'production'
      && run.build.completedAt === build.completedAt && run.build.assetManifestPath === e.builds[phase]
      && run.build.assetManifestSha256 === hashes.get(e.builds[phase]) && run.build.buildFingerprintSha256 === build.buildFingerprintSha256
      && run.fixtureManifestPath === e.fixtureManifest && run.fixtureSha256 === hashes.get(e.fixtureManifest), phase + '-run-binding');
    test(run.protocolSha256 === PROTOCOL_SHA256 && run.collectorSha256 === hashes.get(e.collector)
      && run.sanitizerSha256 === hashes.get(e.sanitizer) && run.toolLockSha256 === hashes.get(e.toolLock)
      && same(run.pins, { lighthouse: p.tools.lighthouse, playwright: p.tools.playwright, chrome: p.tools.chrome })
      && /^v24\./.test(env?.nodeVersion) && env?.runner?.environment === 'github-hosted' && launchMatches(run.browserLaunch, p), phase + '-tools');
    const order = p.profiles.flatMap(profile => Array.from({ length: 5 }, (_, index) => profile.id + '-' + String(index + 1).padStart(2, '0')));
    test(same(run.trials.map(trial => trial.attemptId), order), phase + '-sample-order');
    let previous = stamp(run.startedAt);
    for (const trial of run.trials) {
      const start = stamp(trial.startedAt), end = stamp(trial.endedAt);
      test(start !== null && end !== null && start >= previous && end >= start && end <= stamp(run.endedAt), phase + '-trial-order'); previous = end;
    }
  }
  if (phases.before) for (const phase of ['before', 'after']) test(stamp(builds[phase].completedAt) <= stamp(phases.before.run.startedAt), 'both-builds-before-measurement');
  if (phases.before && phases.after) {
    test(stamp(phases.before.run.endedAt) <= stamp(phases.after.run.startedAt), 'phase-order');
    test(same(phases.before.run.environment, phases.after.run.environment), 'same-runner');
  }
  return { eligible: failures.length === 0, failures: [...new Set(failures)] };
}
function trialValues(observation, lhr) {
  const values = {}, n = observation?.navigation;
  values.ttfb = finite(n?.responseStart) && n.responseStart > 0 && finite(n.startTime) && n.responseStart >= n.startTime ? n.responseStart - n.startTime : null;
  for (const [metric, id] of Object.entries(AUDITS)) {
    const audit = lhr?.audits?.[id];
    values[metric] = audit && !audit.errorCode && !audit.errorMessage && audit.scoreDisplayMode !== 'error' && finite(audit.numericValue) ? audit.numericValue : null;
  }
  const control = observation?.timings?.controlsReadyMs, end = lhr?.audits?.metrics?.details?.items?.[0]?.observedTraceEnd;
  values.controlsReady = finite(control) && finite(end) && control <= end ? control : null;
  return values;
}
function timedObservationMatches(o, lhr, profile) {
  const timeline = o.readinessTimeline, end = lhr.audits?.metrics?.details?.items?.[0]?.observedTraceEnd;
  if (!Array.isArray(timeline) || timeline.length === 0 || timeline.length > 1000 || !finite(end)) return false;
  if (!timeline.every((sample, index) => finite(sample.atMs) && (index === 0 || sample.atMs > timeline[index - 1].atMs))) return false;
  const timed = timeline.filter(sample => sample.atMs <= end), last = timed.at(-1);
  const viewport = { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor };
  const firstControl = timed.find(sample => profile.id === 'desktop'
    ? sample.readiness?.homeChromeReady && sample.readiness.desktopMenuReady && sample.readiness.desktopSearchReady
    : sample.readiness?.homeMobileChromeReady);
  return Boolean(last) && o.traceObservationEndMs === end
    && timed.every(sample => same(sample.actualViewport, viewport))
    && o.selectedObservationAtMs === last.atMs && same(o.actualViewport, last.actualViewport) && same(o.readiness, last.readiness)
    && (firstControl ? o.timings?.controlsReadyMs === firstControl.atMs : o.timings?.controlsReadyMs === null || o.timings?.controlsReadyMs > end);
}
function screenshotMatches(o, lhr) {
  const image = o.screenshotProvenance, raw = lhr.audits?.['final-screenshot']?.details;
  return image?.source === 'lighthouse-final-screenshot' && finite(image.timingMs) && image.timingMs <= o.traceObservationEndMs
    && image.timingMs === raw?.timing && image.timestampUs === raw?.timestamp && finite(image.timestampUs)
    && Number.isSafeInteger(image.widthPixels) && image.widthPixels > 0 && Number.isSafeInteger(image.heightPixels) && image.heightPixels > 0
    && ['image/jpeg', 'image/png'].includes(image.mimeType);
}
function trialEligible(item, run, profile, p) {
  const { trial: t, observation: o, lhr: l } = item;
  if (!o || !l || !profile) return false;
  const r = o.readiness, cfg = l.configSettings, viewport = { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor };
  const controls = profile.id === 'desktop' ? r?.homeChromeReady && r.desktopMenuReady && r.desktopSearchReady : r?.homeMobileChromeReady;
  const desktop = profile.id !== 'desktop' || r?.homePanelReady && r.desktopPanelPresent && r.desktopPanelAlertCount === 0
    && r.desktopPopularItemCount === 3 && r.desktopLatestSectionPresent === true && r.desktopLatestSkeletonPresent === false;
  return t.status === 'valid' && t.failures?.length === 0 && t.phase === run.phase && t.viewportId === profile.id
    && ['observations', 'lhr', 'trace', 'network', 'screenshot'].every(key => typeof t.paths?.[key] === 'string')
    && o.schemaVersion === 'frontend-fixture-observations.v1' && o.scope === 'frontend-fixture' && o.phase === t.phase && o.attemptId === t.attemptId && o.viewportId === t.viewportId
    && o.source?.sourceSha === run.sourceSha && o.source?.sourceTreeSha === run.sourceTreeSha && o.source?.buildFingerprintSha256 === run.build.buildFingerprintSha256
    && o.fixtureSha256 === run.fixtureSha256 && o.ttfbScope === 'loopback-frontend-fixture-not-production'
    && o.browser?.product === p.tools.browserProduct && o.browser.version === p.tools.chrome && isAbsolute(o.browser.executable ?? '')
    && launchMatches(o.browserLaunch, p) && launchMatches(t.browserLaunch, p)
    && timedObservationMatches(o, l, profile)
    && screenshotMatches(o, l)
    && same(o.actualViewport, viewport) && same(o.requestedViewport, viewport) && o.requestedUrl === p.measurementUrl && o.finalUrl === p.url
    && o.initialDocumentQaExcluded === true && o.navigation?.type === 'navigate' && o.navigation.responseStatus === 200
    && l.lighthouseVersion === p.tools.lighthouse && !l.runtimeError && l.requestedUrl === p.url && l.finalDisplayedUrl === p.url && l.finalUrl === p.url
    && cfg?.throttlingMethod === 'devtools' && cfg.formFactor === profile.formFactor && cfg.disableStorageReset === false && cfg.emulatedUserAgent === profile.userAgent
    && same(cfg.throttling, profile.throttling) && cfg.screenEmulation?.disabled === false && cfg.screenEmulation.mobile === profile.isMobile
    && ['width', 'height', 'deviceScaleFactor'].every(key => cfg.screenEmulation[key] === profile[key])
    && o.errors?.pageErrors === 0 && o.errors.firstPartyHttpErrors === 0 && o.errors.mainDocumentStatus === 200
    && o.networkPolicy?.externalRuntimeRequestsAllowed === 0 && o.networkPolicy.externalRuntimeRequestsBlocked === true
    && o.samplingIntervalMs === 100 && controls && desktop && r.mockOverlayVisible === true && r.markerCount > 0 && r.initialSkeletonVisible === false;
}

export async function scoreFixture(options = {}) {
  const data = await loadFixtureEvidence(options), p = data.protocol;
  const context = contextFor(data, resolve(options.repository ?? resolve(HERE, '../../../..')));
  const phases = {};
  for (const phase of ['before', 'after']) phases[phase] = data.phases[phase] ? {
    sourceSha: data.phases[phase].run.sourceSha, sourceTreeSha: data.phases[phase].run.sourceTreeSha,
    trials: data.phases[phase].trials.map(item => ({ attemptId: item.trial.attemptId, viewportId: item.trial.viewportId,
      eligible: Boolean(trialEligible(item, data.phases[phase].run, p.profiles.find(profile => profile.id === item.trial.viewportId), p)),
      values: trialValues(item.observation, item.lhr) })),
  } : null;
  const profiles = p.profiles.map(profile => ({ id: profile.id, metrics: Object.fromEntries(Object.entries(p.metrics).map(([metric, budget]) => {
    const values = phase => (phases[phase]?.trials ?? []).filter(trial => trial.eligible && trial.viewportId === profile.id && finite(trial.values[metric])).map(trial => trial.values[metric]);
    return [metric, compareMetric(values('before'), values('after'), budget, p.comparison, 5, context.eligible)];
  })) }));
  return { schemaVersion: 'frontend-fixture-score.v1', scope: 'frontend-fixture', artifactMapSha256: data.artifactMapSha256,
    productionMetricAdmissionCount: 0, fieldAdmissionCount: 0, g003AdmissionCount: 0,
    ttfbScope: 'loopback-frontend-fixture-not-production', comparisonDesign: 'same-runner-sequential-unpaired', context, phases, profiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), map = argv[0] === 'map'; if (map) argv.shift();
  const options = argumentsFor(argv);
  try {
    if (map) process.stdout.write(JSON.stringify(await createFixtureMap(options)) + '\n');
    else { const result = await scoreFixture(options); await writeResult(resolve(options.root ?? HERE), options.output ?? 'fixture-scored.json', result); process.stdout.write(JSON.stringify({ status: result.context.eligible ? 'scored' : 'not-comparable', output: options.output ?? 'fixture-scored.json' }) + '\n'); }
  } catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
}
