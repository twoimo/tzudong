import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMetric, createArtifactMap, PINNED_PROTOCOL_SHA256, scoreExperiment, summarize } from './score.mjs';
import { independentlyCompare, validateEvidence } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const budget = { unit: 'ms', goodTarget: 2500, minimumReduction: 100 };
const rules = { minimumRelativeReduction: 0.1, noiseMultiplier: 2 };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const five = (value) => Array(5).fill(value);

test('a large improvement remains measurable when the good target is still missed', () => {
  const value = compareMetric(five(10000), five(5000), budget, rules, 5);
  assert.equal(value.classification, 'improved');
  assert.equal(value.improvementPercent, 50);
  assert.equal(value.after.meetsTarget, false);
  assert.deepEqual(value, independentlyCompare(five(10000), five(5000), budget, rules, 5, true));
});

test('relative and absolute reductions are both required', () => {
  assert.equal(compareMetric(five(10000), five(9100), budget, rules, 5).classification, 'no-confirmed-change');
  assert.equal(compareMetric(five(500), five(450), budget, rules, 5).classification, 'no-confirmed-change');
  assert.equal(compareMetric(five(1000), five(900), budget, rules, 5).classification, 'improved');
});

test('the MAD noise boundary is strict and an outlier does not become the median', () => {
  const before = [800, 900, 1000, 1100, 100000];
  const atBoundary = [600, 700, 800, 900, 99800];
  const pastBoundary = [599, 699, 799, 899, 99799];
  assert.deepEqual(summarize(before), { count: 5, median: 1000, mad: 100, min: 800, max: 100000 });
  assert.equal(compareMetric(before, atBoundary, budget, rules, 5).classification, 'no-confirmed-change');
  assert.equal(compareMetric(before, pastBoundary, budget, rules, 5).classification, 'improved');
});

test('regressions are retained and zero baselines do not invent a percentage', () => {
  assert.equal(compareMetric(five(1000), five(1500), budget, rules, 5).classification, 'regressed');
  const fromZero = compareMetric(five(0), five(200), budget, rules, 5);
  assert.equal(fromZero.classification, 'regressed');
  assert.equal(fromZero.improvementPercent, null);
});

test('missing, excess, invalid-context and nonfinite samples cannot produce a claim', () => {
  assert.equal(compareMetric(five(1000), [500, 500, 500, 500], budget, rules, 5).classification, 'not-comparable');
  assert.equal(compareMetric([...five(1000), 1000], five(500), budget, rules, 5).classification, 'not-comparable');
  assert.equal(compareMetric(five(1000), five(500), budget, rules, 5, false).classification, 'not-comparable');
  assert.throws(() => summarize([NaN]), /nonfinite/);
});

// All files created below are clearly synthetic unit fixtures, in a temporary
// directory removed after each test. They are never retained as measurements.
async function fixture(t, complete = false) {
  const root = await mkdtemp(join(tmpdir(), 'tzudong-perf-synthetic-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['protocol.json', 'score.mjs', 'validate.mjs']) await copyFile(join(HERE, name), join(root, name));
  const collector = '// SYNTHETIC TEST FIXTURE. No browser or production measurement.\n';
  await writeFile(join(root, 'collector.mjs'), collector);
  const manifest = { schemaVersion: 'initial-load-experiment.v1', protocol: 'protocol.json', collector: 'collector.mjs', toolLock: 'tools/package-lock.json', toolManifest: 'tools/package.json', phases: { before: null, after: null } };
  let repository = REPO;
  const put = async (name, value) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  };
  await put('tools/package.json', { dependencies: { lighthouse: '13.5.0' } });
  await put('tools/package-lock.json', { lockfileVersion: 3, packages: { 'node_modules/lighthouse': { version: '13.5.0' }, 'node_modules/puppeteer-core': { version: '25.9.0' } } });
  const toolLockSha256 = hash(await readFile(join(root, 'tools/package-lock.json')));
  if (complete) {
    const protocol = JSON.parse(await readFile(join(root, 'protocol.json'), 'utf8'));
    // The real checkout may be shallow. Create only a disposable test Git object
    // store; do not fetch, create commits in, or modify the user's repository.
    repository = join(root, 'synthetic-git');
    execFileSync('git', ['init', '--bare', '--quiet', repository]);
    const objects = execFileSync('git', ['-C', REPO, 'rev-parse', '--path-format=absolute', '--git-path', 'objects'], { encoding: 'utf8' }).trim();
    await writeFile(join(repository, 'objects/info/alternates'), `${objects}\n`);
    const revision = (expression) => execFileSync('git', ['-C', repository, 'rev-parse', expression], { encoding: 'utf8' }).trim();
    const tree = revision(`${protocol.baselineSourceSha}^{tree}`);
    const afterCommit = execFileSync('git', ['-C', repository, 'hash-object', '-t', 'commit', '-w', '--stdin'], {
      encoding: 'utf8', input: `tree ${tree}\nparent ${protocol.baselineSourceSha}\nauthor Synthetic Test <test@example.invalid> 1794657600 +0000\ncommitter Synthetic Test <test@example.invalid> 1794657600 +0000\n\nSYNTHETIC TEST ONLY; not a deployment.\n`,
    }).trim();
    const sourceShas = { before: protocol.baselineSourceSha, after: afterCommit };
    const start = Date.parse(protocol.declaredAt) + 60000;
    const iso = (offset) => new Date(start + offset).toISOString();
    const environment = { nodeVersion: 'v24.22.1', platform: 'linux', arch: 'x64', cpuModels: ['SYNTHETIC TEST CPU'], logicalCpuCount: 4, totalMemoryBytes: 16000000000, runner: { os: 'Linux', arch: 'X64', environment: 'synthetic', runId: 'test', runAttempt: '1' } };
    for (const [phase, factor] of [['before', 1], ['after', 0.7]]) {
      const offset = phase === 'before' ? 0 : 2000000;
      const sourceSha = sourceShas[phase];
      const sourceTreeSha = revision(`${sourceSha}^{tree}`);
      const deploymentId = `dpl_SYNTHETICTEST${phase}`;
      manifest.phases[phase] = { run: `${phase}/run.json`, frozenSource: `${phase}/frozen-source.json` };
      const identity = { ok: true, healthOk: true, gitSha: sourceSha, deploymentId, host: 'www.tzudong.app', transport: 'browser-public-navigation', isolatedFromMeasuredBrowser: true, credentialsUsed: false, browser: { product: 'Google Chrome for Testing', version: '156.0.8078.4', executable: '/synthetic/identity-browser/chrome' } };
      await put(`${phase}/identity.json`, identity);
      await put(`${phase}/deployment-before.json`, identity);
      await put(`${phase}/deployment-after.json`, identity);
      await put(`${phase}/frozen-source.json`, { schemaVersion: 'initial-load-frozen-source.v1', phase, sourceSha, sourceTreeSha, deploymentId, canonicalUrl: protocol.url, verifiedAt: iso(offset), identityEvidence: `${phase}/identity.json` });
      const run = { schemaVersion: 'initial-load-run.v1', phase, status: 'valid', sourceSha, sourceTreeSha, protocolSha256: PINNED_PROTOCOL_SHA256, collectorSha256: hash(collector), toolLockSha256, puppeteerVersion: '25.9.0', pins: { lighthouse: '13.5.0', playwright: '1.64.1', chrome: '156.0.8078.4' }, environment, startedAt: iso(offset), endedAt: iso(offset + 1600000), deploymentEvidence: { before: 'deployment-before.json', after: 'deployment-after.json' }, trials: [] };
      let trialIndex = 0;
      for (const profile of protocol.profiles) {
        for (let index = 1; index <= 5; index += 1) {
          const attemptId = `${profile.id}-${String(index).padStart(2, '0')}`;
          const trial = { attemptId, viewportId: profile.id, status: 'valid', failures: [], startedAt: iso(offset + trialIndex * 100000), endedAt: iso(offset + trialIndex * 100000 + 90000), paths: {} };
          trialIndex += 1;
          const metric = (value) => ({ numericValue: value * factor, numericUnit: 'millisecond', scoreDisplayMode: 'numeric' });
          const lhr = {
            lighthouseVersion: '13.5.0', requestedUrl: protocol.url, finalDisplayedUrl: protocol.url, finalUrl: protocol.url,
            configSettings: { formFactor: profile.formFactor, throttlingMethod: 'devtools', disableStorageReset: false, throttling: profile.throttling, screenEmulation: { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor, mobile: profile.isMobile, disabled: false }, emulatedUserAgent: profile.userAgent },
            audits: { 'first-contentful-paint': metric(2200), 'largest-contentful-paint': metric(4000), interactive: metric(5000), 'total-blocking-time': metric(500), 'cumulative-layout-shift': { ...metric(0.2), numericUnit: 'unitless' }, metrics: { details: { items: [{ observedTraceEnd: 20000 }] } } },
          };
          const viewport = { width: profile.width, height: profile.height, deviceScaleFactor: profile.deviceScaleFactor };
          const observed = {
            source: { gitSha: sourceSha, deploymentId, healthBefore: identity, healthAfter: identity },
            browser: { version: '156.0.8078.4', product: 'Google Chrome for Testing', executable: '/synthetic/chrome' },
            requestedViewport: viewport, actualViewport: viewport,
            requestedUrl: protocol.measurementUrl, finalUrl: protocol.url, initialDocumentQaExcluded: true,
            navigation: { responseStart: 1000 * factor, startTime: 0, type: 'navigate', responseStatus: 200 },
            errors: { mainDocumentStatus: 200, pageErrors: 0, firstPartyHttpErrors: 0, consoleErrors: 0, failedRequests: 0 },
            readiness: { controlsQualified: true, mapQualified: true, naverSdkPresent: true, initialSkeletonVisible: false, desktopPanelQualified: true, tileReadyCount: 10, naverMarkerCount: 10, homeChromeReady: true, actualDesktopControls: true, desktopMenuReady: true, desktopSearchReady: true, homePanelReady: true, desktopPanelPresent: true, desktopPanelAlertCount: 0, desktopPopularItemCount: 5, desktopLatestItemCount: 5, homeMobileChromeReady: true },
            timings: { controlsReadyMs: 6000 * factor, mapReadyMs: 7000 * factor }, samplingIntervalMs: 100,
          };
          for (const [kind, name, payload] of [['observations', 'observations.json', observed], ['lhr', 'lighthouse.sanitized.json', lhr], ['trace', 'trace.sanitized.json', { synthetic: true, traceEvents: [] }], ['network', 'network.sanitized.json', { synthetic: true, requests: [] }]]) {
            trial.paths[kind] = `${attemptId}/${name}`;
            await put(`${phase}/${trial.paths[kind]}`, payload);
          }
          trial.paths.screenshot = `${attemptId}/screenshot.png`;
          await writeFile(join(root, phase, trial.paths.screenshot), 'SYNTHETIC TEST IMAGE PLACEHOLDER');
          await put(`${phase}/${attemptId}/trial.json`, trial);
          run.trials.push(trial);
        }
      }
      await put(`${phase}/run.json`, run);
    }
  }
  await put('experiment.json', manifest);
  const map = await createArtifactMap({ root });
  return { root, artifactMapSha256: map.artifactMapSha256, repository, put };
}

test('zero observed phases validates as incomplete with zero admissions, never a performance pass', async (t) => {
  const input = await fixture(t);
  const result = await scoreExperiment(input);
  await input.put('scored.json', result);
  const verified = validateEvidence(input);
  assert.equal(result.status, 'incomplete-task-local-lab-comparison');
  assert.equal(result.comparableMetricCount, 0);
  assert.equal(verified.fieldAdmissionCount, 0);
  assert.equal(verified.g003AdmissionCount, 0);
});

test('independent validator rederives a full synthetic comparison and rejects an invented improvement', async (t) => {
  const input = await fixture(t, true);
  const result = await scoreExperiment(input);
  await input.put('scored.json', result);
  const verified = validateEvidence(input);
  assert.equal(verified.comparableMetricCount, 24);
  assert.equal(verified.improvedMetricCount, 24);
  assert.equal(result.viewports[0].metrics.lcp.after.meetsTarget, false);
  result.viewports[0].metrics.lcp.after.median = 1;
  await input.put('scored.json', result);
  assert.throws(() => validateEvidence(input), /metric calculation mismatch/);
});

test('baseline-only evidence retains five observations without inventing an after comparison', async (t) => {
  const input = await fixture(t, true);
  const manifest = JSON.parse(await readFile(join(input.root, 'experiment.json'), 'utf8'));
  manifest.phases.after = null;
  await input.put('experiment.json', manifest);
  const map = await createArtifactMap({ root: input.root, output: 'baseline-map.json' });
  const options = { ...input, artifactMap: 'baseline-map.json', artifactMapSha256: map.artifactMapSha256 };
  const result = await scoreExperiment(options);
  await input.put('scored.json', result);
  const verified = validateEvidence(options);
  assert.equal(result.viewports[0].metrics.ttfb.before.count, 5);
  assert.equal(result.viewports[0].metrics.ttfb.after.count, 0);
  assert.equal(result.phases.after, null);
  assert.equal(verified.comparableMetricCount, 0);
  assert.equal(verified.improvedMetricCount, 0);
});

test('artifact mutation, detached hash mismatch and source admission forgery fail closed', async (t) => {
  const input = await fixture(t);
  await assert.rejects(scoreExperiment({ ...input, artifactMapSha256: '0'.repeat(64) }), /artifact-map hash mismatch/);
  const result = await scoreExperiment(input);
  result.fieldAdmissionCount = 1;
  await input.put('scored.json', result);
  assert.throws(() => validateEvidence(input), /unearned field or G003 admission/);
  await writeFile(join(input.root, 'collector.mjs'), '// MUTATED SYNTHETIC FIXTURE\n');
  await assert.rejects(scoreExperiment(input), /artifact hash mismatch/);
});

test('an unverified identity transport excludes a phase even when metric numbers look faster', async (t) => {
  const input = await fixture(t, true);
  const identity = JSON.parse(await readFile(join(input.root, 'before/identity.json'), 'utf8'));
  identity.transport = 'node-fetch';
  await input.put('before/identity.json', identity);
  const map = await createArtifactMap({ root: input.root, output: 'transport-map.json' });
  const options = { ...input, artifactMap: 'transport-map.json', artifactMapSha256: map.artifactMapSha256 };
  const result = await scoreExperiment(options);
  await input.put('scored.json', result);
  const verified = validateEvidence(options);
  assert.ok(result.phases.before.issues.includes('IDENTITY_READBACK_TRANSPORT_INVALID'));
  assert.equal(verified.comparableMetricCount, 0);
  assert.equal(verified.improvedMetricCount, 0);
});
