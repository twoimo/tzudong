import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HERE, PROTOCOL_SHA256, codeFiles, digest, createFixtureMap, argumentsFor } from './fixture-evidence.mjs';
import { scoreFixture } from './fixture-score.mjs';
import { validateFixture } from './fixture-validate.mjs';

// Synthetic software fixtures only; no browser, hosted request or measurement.
const repository = resolve(HERE, '../../../..');
const git = args => execFileSync('git', ['-C', repository, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const put = async (root, path, value) => { await mkdir(resolve(root, path, '..'), { recursive: true }); await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n'); };
async function fixture(t, mode = '') {
  const root = await mkdtemp(resolve(tmpdir(), 'frontend-fixture-software-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'harness/tools'), { recursive: true });
  const p = JSON.parse(await readFile(resolve(HERE, 'fixture-protocol.json'), 'utf8'));
  for (const name of ['fixture-protocol.json', 'fixture-collector.mjs', 'collector.mjs', 'tools/package-lock.json', 'tools/package.json', ...Object.values(codeFiles)]) await cp(resolve(HERE, name), resolve(root, 'harness', name));
  const hashes = async path => digest(await readFile(resolve(root, path)));
  await writeFile(resolve(root, 'fixture-helper.mjs'), '// synthetic test helper; never executed\n');
  const f = { schemaVersion: 'frontend-fixture-manifest.v1', sourceSha: git(['rev-parse', 'HEAD']).toString().trim(), helperExport: p.fixture.helperExport, fixtureRestaurantCount: 3, provider: 'mock-naver',
    bundlePath: 'fixture-helper.mjs', bundleSha256: await hashes('fixture-helper.mjs'), sourceFiles: [] };
  for (let i = 0; i < p.fixture.sourcePaths.length; i++) {
    const path = p.fixture.sourcePaths[i], bytes = git(['show', p.baselineSourceSha + ':' + path]), artifactPath = 'fixture-source-' + i + '.ts';
    await writeFile(resolve(root, artifactPath), bytes); f.sourceFiles.push({ path, artifactPath, sha256: digest(bytes) });
  }
  await put(root, 'fixture-manifest.json', f);
  const e = { schemaVersion: 'frontend-fixture-experiment.v1', scope: 'frontend-fixture', protocol: 'harness/fixture-protocol.json',
    collector: 'harness/fixture-collector.mjs', sanitizer: 'harness/collector.mjs', toolLock: 'harness/tools/package-lock.json', toolManifest: 'harness/tools/package.json',
    fixtureManifest: 'fixture-manifest.json', evidenceSources: Object.fromEntries(Object.entries(codeFiles).map(([key, name]) => [key, 'harness/' + name])),
    builds: { before: 'before/build-manifest.json', after: 'after/build-manifest.json' }, phases: {} };
  const launch = { headless: true, sandboxMode: p.browserLaunch.sandboxMode, scope: p.browserLaunch.scope, explicitArgs: p.browserLaunch.measurementExplicitArgs, noSandboxObserved: true };
  const candidates = { before: p.baselineSourceSha, after: git(['rev-parse', 'HEAD']).toString().trim() };
  assert.notEqual(candidates.after, candidates.before, 'software test needs a distinct existing harness commit');
  for (const phase of ['before', 'after']) {
    const sha = candidates[phase], tree = git(['rev-parse', sha + '^{tree}']).toString().trim();
    const files = [{ path: '.next/static/synthetic.js', sha256: digest(phase), sizeBytes: 1 }];
    const build = { schemaVersion: 'frontend-fixture-build.v1', phase, sourceSha: sha, sourceTreeSha: tree, sourceTreeClean: true, mode: 'production',
      completedAt: mode === 'late-build' && phase === 'after' ? '2026-11-14T14:05:00.000Z' : '2026-11-14T13:50:00.000Z',
      appLockSha256: digest(git(['show', sha + ':apps/web/package-lock.json'])), files, buildFingerprintSha256: digest(JSON.stringify(files)) };
    await put(root, e.builds[phase], build);
    if (mode === 'before-only' && phase === 'after') { e.phases.after = null; continue; }
    const base = Date.parse(phase === 'before' ? '2026-11-14T14:00:00.000Z' : '2026-11-14T14:10:00.000Z');
    const run = { schemaVersion: 'frontend-fixture-run.v1', scope: 'frontend-fixture', phase, status: 'valid', failures: [],
      sourceSha: sha, sourceTreeSha: tree, url: p.measurementUrl, cachePolicy: p.sampling.cache, startedAt: new Date(base).toISOString(), endedAt: new Date(base + 60000).toISOString(),
      build: { mode: 'production', completedAt: build.completedAt, assetManifestPath: e.builds[phase], assetManifestSha256: await hashes(e.builds[phase]), buildFingerprintSha256: build.buildFingerprintSha256 },
      fixtureManifestPath: e.fixtureManifest, fixtureSha256: await hashes(e.fixtureManifest), protocolSha256: PROTOCOL_SHA256,
      collectorSha256: await hashes(e.collector), sanitizerSha256: await hashes(e.sanitizer), toolLockSha256: await hashes(e.toolLock),
      environment: { nodeVersion: 'v24.22.1', runner: { environment: 'github-hosted', runId: 'synthetic-test-only' } },
      pins: { lighthouse: p.tools.lighthouse, playwright: p.tools.playwright, chrome: p.tools.chrome }, browserLaunch: launch, trials: [] };
    for (const profile of p.profiles) for (let i = 1; i <= 5; i++) {
      const attemptId = profile.id + '-' + String(i).padStart(2, '0'), at = base + run.trials.length * 2000;
      const trial = { attemptId, viewportId: profile.id, phase, status: 'valid', failures: [], browserLaunch: launch, paths: {}, startedAt: new Date(at).toISOString(), endedAt: new Date(at + 1000).toISOString() };
      const after = phase === 'after', viewport = { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor };
      const observation = { schemaVersion: 'frontend-fixture-observations.v1', scope: 'frontend-fixture', phase, attemptId, viewportId: profile.id,
        source: { sourceSha: sha, sourceTreeSha: tree, buildFingerprintSha256: build.buildFingerprintSha256 }, fixtureSha256: run.fixtureSha256,
        ttfbScope: 'loopback-frontend-fixture-not-production', browser: { product: p.tools.browserProduct, version: p.tools.chrome, executable: '/synthetic/chrome' }, browserLaunch: launch,
        requestedViewport: viewport, actualViewport: viewport, requestedUrl: p.measurementUrl, finalUrl: p.url, initialDocumentQaExcluded: true,
        navigation: { type: 'navigate', responseStatus: 200, startTime: 0, responseStart: after ? 600 : 1000 },
        errors: { pageErrors: 0, firstPartyHttpErrors: 0, mainDocumentStatus: 200 }, networkPolicy: { externalRuntimeRequestsAllowed: 0, externalRuntimeRequestsBlocked: true },
        samplingIntervalMs: 100, timings: { controlsReadyMs: mode === 'late-control' && after && attemptId === 'mobile-01' ? 9000 : after ? 1500 : 2500 },
        readiness: { homeChromeReady: true, homeMobileChromeReady: true, desktopMenuReady: true, desktopSearchReady: true, homePanelReady: true, desktopPanelPresent: true,
          desktopPanelAlertCount: 0, desktopPopularItemCount: 3, desktopLatestItemCount: 0, desktopLatestSectionPresent: true, desktopLatestSkeletonPresent: false,
          mockOverlayVisible: true, markerCount: 3, initialSkeletonVisible: false } };
      const loading = { ...observation.readiness, homeChromeReady: false, homeMobileChromeReady: false,
        desktopMenuReady: false, desktopSearchReady: false, markerCount: 0, initialSkeletonVisible: true };
      observation.traceObservationEndMs = 8000;
      observation.selectedObservationAtMs = 7900;
      observation.readinessTimeline = [
        { atMs: 100, actualViewport: viewport, readiness: loading },
        { atMs: after ? 1500 : 2500, actualViewport: viewport, readiness: observation.readiness },
        { atMs: 7900, actualViewport: viewport, readiness: observation.readiness },
        { atMs: 8100, actualViewport: { width: 780, height: 493, deviceScaleFactor: 1 }, readiness: loading },
      ];
      observation.postCleanupViewport = { width: 780, height: 493, deviceScaleFactor: 1 };
      observation.postCleanupReadiness = loading;
      if (after && attemptId === 'mobile-01' && mode === 'wrong-timed-viewport') observation.readinessTimeline[0].actualViewport = { ...viewport, width: 391 };
      if (after && attemptId === 'mobile-01' && mode === 'late-only-markers') {
        observation.readiness = { ...observation.readiness, markerCount: 0 };
        observation.readinessTimeline = observation.readinessTimeline.map(state => state.atMs <= 8000 ? { ...state, readiness: { ...state.readiness, markerCount: 0 } } : state);
        observation.postCleanupReadiness = { ...observation.readiness, markerCount: 3 };
      }
      const lhr = { lighthouseVersion: p.tools.lighthouse, requestedUrl: p.url, finalUrl: p.url, finalDisplayedUrl: p.url, runtimeError: null,
        configSettings: { throttlingMethod: 'devtools', formFactor: profile.formFactor, disableStorageReset: false, emulatedUserAgent: profile.userAgent,
          throttling: profile.throttling, screenEmulation: { ...viewport, mobile: profile.isMobile, disabled: false } },
        audits: Object.fromEntries([['first-contentful-paint', after ? 1000 : 1800], ['largest-contentful-paint', after ? 2000 : 3000], ['interactive', after ? 2500 : 3500],
          ['total-blocking-time', after ? 100 : 300], ['cumulative-layout-shift', after ? 0.03 : 0.1]].map(([key, value]) => [key, { numericValue: value, scoreDisplayMode: 'numeric' }])) };
      lhr.audits.metrics = { details: { items: [{ observedTraceEnd: 8000 }] } };
      lhr.audits['final-screenshot'] = { details: { timing: 7900, timestamp: 7900000 } };
      observation.screenshotProvenance = { source: 'lighthouse-final-screenshot', timingMs: 7900, timestampUs: 7900000,
        widthPixels: profile.width, heightPixels: profile.height, mimeType: 'image/jpeg' };
      for (const [kind, value] of Object.entries({ observations: observation, lhr, trace: {}, network: {} })) { trial.paths[kind] = attemptId + '/' + kind + '.json'; await put(root, phase + '/' + trial.paths[kind], value); }
      trial.paths.screenshot = attemptId + '/screenshot.png'; await writeFile(resolve(root, phase, trial.paths.screenshot), 'SYNTHETIC SOFTWARE TEST NOT AN IMAGE');
      await put(root, phase + '/' + attemptId + '/trial.json', trial); run.trials.push(trial);
    }
    e.phases[phase] = { run: phase + '/run.json' }; await put(root, e.phases[phase].run, run);
  }
  await put(root, 'experiment.json', e);
  const map = await createFixtureMap({ root });
  return { root, repository, artifactMapSha256: map.artifactMapSha256 };
}
test('timed evidence survives cleanup reset and permits empty latest fixture list', async t => {
  const options = await fixture(t), result = await scoreFixture(options);
  assert.equal(result.context.eligible, true, JSON.stringify(result.context.failures));
  assert.equal(result.profiles.flatMap(profile => Object.values(profile.metrics)).filter(metric => metric.classification === 'improved').length, 21);
  await put(options.root, 'fixture-scored.json', result); assert.equal((await validateFixture(options)).comparableMetrics, 21);
  result.productionMetricAdmissionCount = 1; await put(options.root, 'fixture-scored.json', result);
  await assert.rejects(validateFixture(options), /independently derived/);
});
test('late controls provenance, late build and absent after remain not comparable', async t => {
  for (const mode of ['late-control', 'late-build', 'before-only']) {
    const options = await fixture(t, mode), result = await scoreFixture(options);
    await put(options.root, 'fixture-scored.json', result);
    const verified = await validateFixture(options);
    assert.equal(verified.comparableMetrics, mode === 'late-control' ? 14 : 0);
    assert.equal(result.profiles[0].metrics.controlsReady.classification, 'not-comparable');
    assert.equal(verified.fieldAdmissionCount, 0);
  }
});
test('any wrong timed viewport or markers appearing only after the trace rejects the trial', async t => {
  for (const mode of ['wrong-timed-viewport', 'late-only-markers']) {
    const options = await fixture(t, mode), result = await scoreFixture(options);
    assert.equal(result.phases.after.trials[0].eligible, false);
    await put(options.root, 'fixture-scored.json', result);
    assert.equal((await validateFixture(options)).comparableMetrics, 14);
  }
});
test('CLI accepts the detached SHA-256 option without relaxing argument syntax', () => {
  assert.deepEqual(argumentsFor(['--artifact-map-sha256', 'abc', '--root', '/tmp/example']), { artifactMapSha256: 'abc', root: '/tmp/example' });
  assert.throws(() => argumentsFor(['--bad=value', 'x']), /CLI arguments/);
});
test('raw artifact tampering fails even when the summary has not changed', async t => {
  const options = await fixture(t), result = await scoreFixture(options); await put(options.root, 'fixture-scored.json', result);
  await writeFile(resolve(options.root, 'before/mobile-01/observations.json'), '{}\n');
  await assert.rejects(validateFixture(options), /artifact hash mismatch/);
});
