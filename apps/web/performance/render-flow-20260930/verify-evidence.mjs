import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, median, recomputeAa } from './score.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const APP = resolve(HERE, '../..');
const HASH = /^[a-f0-9]{64}$/;
const GIT = /^[a-f0-9]{40}$/;
const fail = message => { throw new Error(`render-flow evidence: ${message}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function parseArgs(argv) {
  const mode = argv.shift();
  if (!['create-map', 'verify'].includes(mode)) fail('first argument must be create-map or verify');
  const args = { mode };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!value || args[flag.slice(2)] || !['--scored', '--output', '--artifact-map', '--artifact-map-sha256'].includes(flag)) fail('invalid CLI');
    args[flag.slice(2)] = value;
  }
  if (!args.scored) fail('missing --scored');
  if (mode === 'create-map' && (!args.output || args['artifact-map'] || args['artifact-map-sha256'])) fail('create-map requires only --scored and --output');
  if (mode === 'verify' && (!args['artifact-map'] || !HASH.test(args['artifact-map-sha256'] ?? '') || args.output)) fail('verify requires --scored, --artifact-map and external SHA-256');
  return args;
}
function absolute(path, base = process.cwd()) { return isAbsolute(path) ? path : resolve(base, path); }
function underRoot(path) {
  const result = relative(HERE, path);
  if (!result || result.startsWith(`..${sep}`) || result === '..' || isAbsolute(result)) fail(`path outside evidence root: ${path}`);
  return result.split(sep).join('/');
}
function fromScore(path) { return isAbsolute(path) ? path : resolve(HERE, path); }
async function readJson(path, label) {
  const bytes = await readFile(path); let value;
  try { value = JSON.parse(bytes); } catch { fail(`${label} is not JSON`); }
  return { bytes, value, sha256: sha256(bytes) };
}
async function readSafeJson(path, label) {
  const bytes = await safeBytes(resolve(HERE, path)); let value;
  try { value = JSON.parse(bytes); } catch { fail(`${label} is not JSON`); }
  return { bytes, value, sha256: sha256(bytes) };
}
async function safeBytes(path) {
  const canonicalRoot = await realpath(HERE), canonicalPath = await realpath(path);
  if (canonicalPath !== path || !canonicalPath.startsWith(`${canonicalRoot}${sep}`)) fail(`aliased artifact ${underRoot(path)}`);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail(`non-regular artifact ${underRoot(path)}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) fail(`artifact changed ${underRoot(path)}`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) fail(`artifact changed ${underRoot(path)}`);
    return bytes;
  } finally { await handle.close(); }
}
async function stableExternalBytes(path) {
  if (await realpath(path) !== path) fail(`aliased source ${path}`);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail(`non-regular source ${path}`);
  const bytes = await readFile(path), after = await lstat(path, { bigint: true });
  if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) fail(`source changed ${path}`);
  return bytes;
}
async function walk(directory, excluded) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink in evidence tree ${underRoot(path)}`);
    if (entry.isDirectory()) files.push(...await walk(path, excluded));
    else if (entry.isFile() && path !== excluded) files.push(path);
    else if (!entry.isFile()) fail(`non-regular entry ${underRoot(path)}`);
  }
  return files.sort((left, right) => underRoot(left).localeCompare(underRoot(right)));
}

async function verifyReceipt(receipt, expectedKind, planSha256) {
  if (receipt.kind !== expectedKind || !GIT.test(receipt.sourceCommit ?? '') || !GIT.test(receipt.sourceTree ?? '') || !HASH.test(receipt.patchSha256 ?? '') || receipt.node !== 'v24.21.0') fail(`invalid ${expectedKind} receipt identity`);
  if (expectedKind === 'candidate' && (!receipt.retainedBuildId?.startsWith('build-candidate-v7/') || receipt.planSha256 !== planSha256 || receipt.inputs?.length !== 10)) fail('candidate is not v7 with ten retained inputs bound to plan-v6');
  const buildDirectory = dirname(receipt.retainedBuildId), receiptPath = resolve(HERE, buildDirectory, 'receipt.json');
  const stored = await readJson(receiptPath, `${expectedKind} receipt`);
  if (!same(stored.value, receipt)) fail(`${expectedKind} raw receipt differs from retained receipt`);
  const patchPath = resolve(HERE, buildDirectory, 'source.patch');
  if (sha256(await safeBytes(patchPath)) !== receipt.patchSha256) fail(`${expectedKind} patch hash mismatch`);
  if ((await safeBytes(resolve(HERE, receipt.retainedBuildId))).toString('utf8').trim() !== receipt.buildId) fail(`${expectedKind} BUILD_ID mismatch`);
  if (sha256(await safeBytes(resolve(HERE, buildDirectory, 'build.log'))) !== receipt.logSha256) fail(`${expectedKind} build log mismatch`);
  const originals = new Set();
  for (const input of receipt.inputs) {
    if (originals.has(input.original) || !HASH.test(input.sha256 ?? '')) fail(`${expectedKind} invalid retained input`);
    originals.add(input.original);
    if (sha256(await safeBytes(resolve(HERE, input.retained))) !== input.sha256) fail(`${expectedKind} retained input mismatch ${input.original}`);
  }
  if (expectedKind === 'candidate') {
    for (const path of ['components/map/NaverMapView.tsx', 'lib/naver-map-render-plan.ts', 'lib/marker-pool.ts']) {
      const input = receipt.inputs.find(row => row.original === path);
      if (!input || sha256(await stableExternalBytes(resolve(APP, path))) !== input.sha256) fail(`current candidate source is not bound: ${path}`);
    }
  }
  return { receiptPath: underRoot(receiptPath), patchPath: underRoot(patchPath) };
}

function independentCellChecks(score) {
  assert.equal(score.schemaVersion, 'render-flow-score.v1');
  assert.equal(score.claimBoundary.g003OrFieldAdmission, false);
  assert.equal(score.claimBoundary.physicalPixelsVerified, false);
  assert.equal(score.governance.admittedFieldSlices, 0);
  assert.equal(score.bootstrapPolicy.resamples, 10_000);
  assert.equal(score.bootstrapPolicy.pairedIndex, true);
  assert.equal(score.bootstrapPolicy.adjacentAbBaBlocks, true);
  const primary = score.cells.filter(cell => cell.kind === 'primary');
  assert.equal(primary.length, 2, 'both final primary cells are required');
  for (const cell of primary) {
    assert.equal(cell.expectedIndependentContexts, 31);
    assert.ok(cell.observedPairs >= 31);
    assert.equal(cell.selectedPairIds.length, cell.validQuietPairs >= 31 ? 31 : cell.validQuietPairs);
    if (cell.validQuietPairs < 31) {
      assert.equal(cell.classification, null);
      assert.equal(cell.admission.admittedLocalImprovement, false);
      assert.ok(cell.admission.reasons.includes('insufficient_valid_quiet_pairs'));
    }
    if (cell.classification === 'improvement') {
      const metric = cell.metrics.clickToExpandedMs;
      assert.ok(metric.deltaBeforeMinusAfter > cell.budgets.effectiveThresholdMs);
      assert.ok(metric.pairedBootstrap.ci95.lower > 0);
      assert.ok(metric.adjacentBlockBootstrap.ci95.lower > 0);
      assert.equal(cell.sensitivity.directionConsistent, true);
    }
    assert.ok(['improvement', 'no_improvement', 'noise', 'regression', null].includes(cell.classification));
    assert.equal(cell.networkBoundary.actualNetworkTransferBytes, null);
    for (const metric of Object.values(cell.allObservedDescriptive.metrics)) {
      assert.ok(metric.baseline.n >= 31 && metric.candidate.n >= 31);
      assert.equal(metric.deltaBeforeMinusAfter, metric.baseline.median - metric.candidate.median);
      assert.equal(metric.baseline.n >= 20, metric.baseline.p95 !== null);
    }
  }
}

async function verifyRawSidecars(score) {
  for (const input of score.rawInputs) {
    const rawPath = fromScore(input.path), raw = (await readJson(rawPath, input.path)).value, directory = dirname(rawPath);
    if (raw.pairs.length !== input.measuredPairs || raw.warmups.length !== input.warmupPairs) fail(`raw count drift ${input.path}`);
    const expectedSidecars = raw.pairs.length + raw.warmups.length;
    const names = (await readdir(directory)).filter(name => /^pair-\d+-(?:\d{2}|warm[12])\.json$/.test(name));
    if (names.length !== expectedSidecars) fail(`pair sidecar count mismatch ${input.path}`);
    for (const pair of [...raw.warmups, ...raw.pairs]) {
      const suffix = pair.index < 0 ? `warm${-pair.index}` : String(pair.index).padStart(2, '0');
      const retained = await readJson(resolve(directory, `pair-${pair.cell}-${suffix}.json`), 'pair sidecar');
      if (!same(retained.value, pair)) fail(`pair sidecar mismatch ${input.path}:${pair.cell}:${pair.index}`);
    }
    for (const cell of new Set(raw.pairs.map(pair => pair.cell))) for (const variant of ['baseline', 'candidate']) await safeBytes(resolve(directory, `${variant}-cell-${cell}.png`));
  }
}

function blockedTransportOnly(errors) {
  return errors?.page === 0
    && errors?.unexpectedConsole === 0
    && Number.isSafeInteger(errors?.console)
    && errors.console >= 0
    && errors.blockedTransport === errors.console;
}

function fixtureCoordinate(id) {
  const match = /([0-9]{12})$/.exec(id ?? ''), index = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(index) || index < 0 || index >= 735) fail(`supplemental readback invalid fixture id ${id}`);
  return { lat: 37.5 + 0.003 * (index % 40), lng: 126.96 + 0.003 * Math.floor(index / 40) };
}

function verifyReadbackSnapshot(snapshot, expectedIds, label) {
  if (
    !same(snapshot?.expected, expectedIds)
    || !same(snapshot?.actual, expectedIds)
    || new Set(snapshot.actual).size !== snapshot.actual.length
    || !Array.isArray(snapshot.tuples)
    || snapshot.tuples.length !== expectedIds.length
    || !same(snapshot.tuples.map(tuple => tuple.domId), expectedIds)
    || !Array.isArray(snapshot.duplicates) || snapshot.duplicates.length !== 0
    || !Array.isArray(snapshot.missing) || snapshot.missing.length !== 0
    || !Array.isArray(snapshot.unexpected) || snapshot.unexpected.length !== 0
    || snapshot.mapCreates !== 1
    || snapshot.zoom !== 14
    || snapshot.valid !== true
  ) fail(`supplemental readback invalid ${label}`);
  for (const tuple of snapshot.tuples) {
    const expected = fixtureCoordinate(tuple.domId);
    if (tuple.matchesFixture !== true || Math.abs(tuple.lat - expected.lat) > 1e-7 || Math.abs(tuple.lng - expected.lng) > 1e-7) fail(`supplemental readback coordinate mismatch ${label}:${tuple.domId}`);
  }
}

function verifyAwaySnapshot(snapshot, label) {
  if (
    !snapshot
    || ['expected', 'actual', 'tuples', 'duplicates', 'missing', 'unexpected'].some(field => !Array.isArray(snapshot[field]) || snapshot[field].length !== 0)
    || snapshot.mapCreates !== 1
    || snapshot.zoom !== 14
    || snapshot.valid !== true
  ) fail(`supplemental readback invalid empty away snapshot ${label}`);
}

async function verifySupplemental(score, primaryRaw) {
  const candidateReceipt = primaryRaw.builds.candidate;
  const bindingArtifact = await readSafeJson('readback-binding-v7.json', 'readback binding');
  const readbackArtifact = await readSafeJson('marker-dom-readback-final-v4/raw.json', 'marker DOM readback');
  const planBytes = await safeBytes(resolve(HERE, 'plan-v6.json'));
  const planCopyBytes = await safeBytes(resolve(HERE, 'marker-dom-readback-final-v4/plan-v6.json.binding.txt'));
  const receiptBytes = await safeBytes(resolve(HERE, 'build-candidate-v7/receipt.json'));
  const binding = bindingArtifact.value, readback = readbackArtifact.value;
  if (
    binding.schema !== 'readback-binding.v1'
    || binding.rawPath !== 'marker-dom-readback-final-v4/raw.json'
    || binding.rawSha256 !== readbackArtifact.sha256
    || binding.actualPlanPath !== 'plan-v6.json'
    || binding.actualPlanSha256 !== score.plan.sha256
    || binding.actualPlanSha256 !== sha256(planBytes)
    || sha256(planCopyBytes) !== binding.actualPlanSha256
    || binding.actualBuildReceiptPath !== 'build-candidate-v7/receipt.json'
    || binding.actualBuildReceiptSha256 !== sha256(receiptBytes)
    || binding.historicalPlanCopy !== 'marker-dom-readback-final-v4/plan-v5.json.txt'
    || binding.historicalPlanIsActualBinding !== false
    || !same(readback.receipt, candidateReceipt)
  ) fail('supplemental readback binding mismatch');

  if (!Array.isArray(readback.cases) || readback.cases.length !== 2 || !same(readback.cases.map(testCase => testCase.mobile), [false, true])) fail('supplemental readback requires one desktop and one mobile context');
  let readbackBlockedTransport = 0;
  for (const testCase of readback.cases) {
    const expectedSets = primaryRaw.pairs.filter(pair => pair.options?.mobile === testCase.mobile).map(pair => pair.candidate?.summary?.expectedIds);
    if (expectedSets.length !== 31 || expectedSets.some(ids => !Array.isArray(ids) || !same(ids, expectedSets[0]))) fail(`supplemental readback primary expected IDs drift mobile=${testCase.mobile}`);
    const expectedIds = expectedSets[0];
    verifyReadbackSnapshot(testCase.before, expectedIds, `before mobile=${testCase.mobile}`);
    if (!Array.isArray(testCase.rounds) || testCase.rounds.length !== 3 || !same(testCase.rounds.map(round => round.cycle), [0, 1, 2])) fail(`supplemental readback requires three rounds mobile=${testCase.mobile}`);
    for (const round of testCase.rounds) {
      verifyAwaySnapshot(round.away, `round=${round.cycle} mobile=${testCase.mobile}`);
      verifyReadbackSnapshot(round.returned, expectedIds, `return round=${round.cycle} mobile=${testCase.mobile}`);
      if (round.exactIds !== true) fail(`supplemental readback non-exact returned IDs round=${round.cycle} mobile=${testCase.mobile}`);
    }
    if (testCase.phase !== 'complete' || !blockedTransportOnly(testCase.errors)) fail(`supplemental readback errors mobile=${testCase.mobile}`);
    readbackBlockedTransport += testCase.errors.blockedTransport;
  }

  const nativeArtifact = await readSafeJson('native-touch-final-v2/raw.json', 'native touch'), native = nativeArtifact.value;
  if (
    native.schema !== 'native-touch-final-v2'
    || native.status !== 'passed'
    || native.checks !== 63
    || !Array.isArray(native.failures) || native.failures.length !== 0
    || native.scope?.build !== 'candidate-v7'
    || native.scope?.inputKinds?.swipes !== 'trusted CDP Input.dispatchTouchEvent touchStart/move/touchEnd'
    || native.receipt?.buildId !== candidateReceipt.buildId
    || native.receipt?.candidateBuild !== 'v7'
    || native.receipt?.planSha256 !== score.plan.sha256
    || native.receipt?.patchSha256 !== candidateReceipt.patchSha256
  ) fail('supplemental native touch receipt or result mismatch');
  for (const [name, expectedHash] of Object.entries(native.frozenSources ?? {})) if (sha256(await safeBytes(resolve(HERE, 'native-touch-final-v2', name))) !== expectedHash) fail(`supplemental native touch frozen source mismatch ${name}`);
  const ready = native.observations?.ready, expanded = native.observations?.cluster?.expanded, swipes = native.observations?.swipes, finalUi = native.observations?.final?.ui;
  if (
    ready?.mapCreates !== 1 || ready?.mapContainerCount !== 1 || ready?.horizontalOverflow !== 0
    || expanded?.mapCreates !== 1 || expanded?.mapContainerCount !== 1 || expanded?.mapIdentityStable !== true || expanded?.horizontalOverflow !== 0
    || !Array.isArray(swipes) || swipes.length !== 5
    || finalUi?.mapCreates !== 1 || finalUi?.mapContainerCount !== 1 || finalUi?.mapIdentityStable !== true || finalUi?.detailCount !== 1 || finalUi?.horizontalOverflow !== 0
    || !blockedTransportOnly(native.observations?.errors)
  ) fail('supplemental native touch UI invariant mismatch');
  for (let index = 0; index < swipes.length; index++) {
    const swipe = swipes[index], events = swipe.touchEvents;
    if (
      swipe.index !== index + 1 || swipe.changed !== true
      || !Array.isArray(events) || events.length < 3 || events[0]?.type !== 'touchstart' || events.at(-1)?.type !== 'touchend' || events.some(event => event.isTrusted !== true)
      || swipe.map?.identityStable !== true || swipe.map?.count !== 1 || swipe.map?.containerCount !== 1
      || swipe.detailCount !== 1 || swipe.horizontalOverflow !== 0
    ) fail(`supplemental native touch invalid trusted swipe ${index + 1}`);
  }

  const poolArtifact = await readSafeJson('pool-dom-final-v2/raw.json', 'pool DOM'), pool = poolArtifact.value;
  const markerPoolInput = candidateReceipt.inputs?.find(input => input.original === 'lib/marker-pool.ts');
  const candidatePoolHash = sha256(await safeBytes(resolve(HERE, 'pool-dom-final-v2/candidate-pool.ts.txt')));
  const baselinePoolHash = sha256(await safeBytes(resolve(HERE, 'pool-dom-final-v2/baseline-pool.ts.txt')));
  const poolVariants = new Map((pool.variants ?? []).map(variant => [variant.kind, variant.result]));
  const candidatePool = poolVariants.get('candidate'), baselinePool = poolVariants.get('baseline');
  if (
    !markerPoolInput || pool.sources?.candidate !== markerPoolInput.sha256 || pool.sources.candidate !== candidatePoolHash || pool.sources?.baseline !== baselinePoolHash
    || pool.variants?.length !== 2
    || !Array.isArray(candidatePool?.steps) || candidatePool.steps.length !== 8 || candidatePool.accuracyFailures !== 0 || candidatePool.sameImageOnBubbleOnly !== true
    || candidatePool.steps.some(step => step.expectedId !== step.actualId || step.expectedCount !== step.actualCount || step.coordinateMatches !== true)
    || !Array.isArray(baselinePool?.steps) || baselinePool.steps.length !== 8 || baselinePool.accuracyFailures !== 7 || baselinePool.sameImageOnBubbleOnly !== true
  ) fail('supplemental pool DOM source or accuracy mismatch');

  const flickerArtifact = await readSafeJson('flicker-pan-after-v1/raw.json', 'flicker pan after'), flicker = flickerArtifact.value;
  const beforeFlickerArtifact = await readSafeJson('flicker-pan-before-v3/raw.json', 'flicker pan candidate-v6 intermediate'), beforeFlicker = beforeFlickerArtifact.value;
  const afterSamplerBytes = await safeBytes(resolve(HERE, 'flicker-pan-after-v1/flicker-pan.mjs.txt'));
  const beforeSamplerBytes = await safeBytes(resolve(HERE, 'flicker-pan-before-v3/flicker-pan.mjs.txt'));
  const afterRuntimeText = (await safeBytes(resolve(HERE, 'flicker-pan-after-v1/runtime.mjs.txt'))).toString('utf8');
  const afterSamplerText = afterSamplerBytes.toString('utf8');
  if (
    !same(flicker.receipt, candidateReceipt)
    || beforeFlicker.receipt?.kind !== 'candidate'
    || beforeFlicker.receipt?.retainedBuildId !== 'build-candidate-v6/BUILD_ID'
    || sha256(afterSamplerBytes) !== sha256(beforeSamplerBytes)
    || !afterSamplerText.includes('const t=await setup(run.browser,{mobile,count:735,cpu:4})')
    || !afterSamplerText.includes('finally{await t.context.close();}')
    || !afterRuntimeText.includes('browser.newContext(')
    || !flicker.scope?.includes('not physical-display flicker')
    || !flicker.scope?.includes('rAF blocked intervals are unobserved')
  ) fail('supplemental flicker source, receipt or claim boundary mismatch');
  let observedLongZeroSpans = 0, desktopRafBlindContexts = 0, mobileRafBlindContexts = 0, flickerBlockedTransport = 0;
  for (const [mobile, finalCount] of [[false, 143], [true, 55]]) {
    const cases = flicker.cases?.filter(testCase => testCase.mobile === mobile) ?? [];
    if (cases.length !== 5 || !same(cases.map(testCase => testCase.attempt).sort((left, right) => left - right), [0, 1, 2, 3, 4])) fail(`supplemental flicker requires five contexts mobile=${mobile}`);
    for (const testCase of cases) {
      const retained = (await readSafeJson(`flicker-pan-after-v1/case-${mobile ? 'mobile' : 'desktop'}-${testCase.attempt}.json`, 'flicker case sidecar')).value;
      if (!same(retained, testCase)) fail(`supplemental flicker sidecar mismatch mobile=${mobile} attempt=${testCase.attempt}`);
      const result = testCase.result, longSpans = result?.spans?.filter(span => finite(span.duration) && span.duration > 250) ?? [];
      observedLongZeroSpans += longSpans.length;
      if (
        result?.finalCount !== finalCount || result?.finalMapCount !== 1 || result?.flickerObserved !== false
        || !Array.isArray(result?.spans) || result.spans.some(span => !finite(span.duration) || span.duration > 250)
        || !finite(result?.maxGapMs) || !blockedTransportOnly(testCase.errors)
      ) fail(`supplemental flicker result mismatch mobile=${mobile} attempt=${testCase.attempt}`);
      if (result.maxGapMs > 250) { if (mobile) mobileRafBlindContexts++; else desktopRafBlindContexts++; }
      flickerBlockedTransport += testCase.errors.blockedTransport;
    }
  }
  if (observedLongZeroSpans !== 0 || desktopRafBlindContexts !== 2 || mobileRafBlindContexts !== 0) fail('supplemental flicker observed-span or rAF-blind count mismatch');

  return {
    scope: 'supplemental_QA_readback_only',
    performanceAdmissionEffect: 'none',
    markerDomReadback: {
      build: 'candidate-v7', independentContexts: 2, roundsPerContext: 3, exactPrimaryExpectedIds: true, fixtureCoordinatesRecomputed: true,
      bindingSha256: bindingArtifact.sha256, rawSha256: readbackArtifact.sha256, planSha256: binding.actualPlanSha256, buildReceiptSha256: binding.actualBuildReceiptSha256,
      blockedTransportObservations: readbackBlockedTransport,
    },
    nativeTouch: { build: 'candidate-v7', checks: 63, trustedCdpSwipes: 5, domPanelPresent: true, mapIdentityCount: 1, horizontalOverflow: 0, blockedTransportObservations: native.observations.errors.blockedTransport },
    poolDom: { candidateSteps: 8, candidateAccuracyFailures: 0, sameImageOnBubbleOnly: true, baselineSteps: 8, baselineAccuracyFailures: 7, baselineRole: 'retained_descriptive_fixture_not_performance_baseline' },
    flickerPan: {
      build: 'candidate-v7', freshContextsPerCell: 5, desktopFinalMarkers: 143, mobileFinalMarkers: 55, observedZeroMarkerSpansOver250Ms: 0,
      samplerSha256: sha256(afterSamplerBytes), domObservationOnly: true, physicalPixelFlickerVerified: false,
      rafBlindWarning: 'desktop 2/5 contexts had max rAF gaps above 250ms; blocked intervals are unobserved and this is not a no-pixel-flicker guarantee or gate waiver',
      candidateV6ComparisonRole: 'intermediate_QA_regression_not_original_baseline_flicker_prevalence',
      blockedTransportObservations: flickerBlockedTransport,
    },
  };
}

async function verifyScore(scoredPath) {
  const scored = await readJson(scoredPath, 'scored');
  const score = scored.value;
  independentCellChecks(score);
  const args = {
    plan: fromScore(score.plan.path),
    aa: fromScore(score.plan.aaPath),
    'additional-aa': (score.plan.additionalAa ?? []).map(input => fromScore(input.path)),
    'resources-plan': fromScore(score.plan.resourcesPlanPath),
    raw: score.rawInputs.map(input => fromScore(input.path)),
  };
  const recomputed = await aggregate(args);
  if (!same(recomputed, score)) fail('deterministic score recomputation mismatch');
  const plan = await readJson(args.plan, 'plan-v6');
  if (plan.sha256 !== score.plan.sha256 || plan.value.correctnessGate !== score.plan.correctnessGate) fail('plan-v6 hash or correctness gate mismatch');
  const aa = await readJson(args.aa, 'baseline-aa-v3');
  if (aa.sha256 !== score.plan.aaSha256) fail('A/A hash mismatch');
  const aaRecomputed = recomputeAa(aa.value);
  if (aaRecomputed.desktop.firstThreeVsLastThreeMedianDifferenceMs !== 1320.6999998092651 || aaRecomputed.mobile.firstThreeVsLastThreeMedianDifferenceMs !== 1140.1000001430511) fail('A/A time drift changed');
  const firstRaw = (await readJson(args.raw[0], 'raw')).value;
  await verifyReceipt(firstRaw.builds.baseline, 'baseline', score.plan.sha256);
  await verifyReceipt(firstRaw.builds.candidate, 'candidate', score.plan.sha256);
  if (firstRaw.builds.baseline.sourceCommit !== score.bindings.baseline.sourceCommit || firstRaw.builds.candidate.patchSha256 !== score.bindings.candidate.patchSha256) fail('score source binding mismatch');
  const regression = (await readJson(resolve(HERE, 'regression-candidate-v7-v1/raw.json'), 'candidate-v7 regression')).value;
  if (
    regression.contract?.build !== 'candidate-v7'
    || regression.summary?.passed !== true
    || !Number.isSafeInteger(regression.summary?.checks)
    || regression.summary.checks < 1
    || regression.summary?.failures !== 0
    || !Array.isArray(regression.cases)
    || regression.cases.length < 1
    || regression.cases.some(testCase => testCase.failures?.length !== 0)
    || regression.receipt?.buildId !== firstRaw.builds.candidate.buildId
    || regression.receipt?.sourceTree !== firstRaw.builds.candidate.sourceTree
    || regression.receipt?.patchSha256 !== firstRaw.builds.candidate.patchSha256
  ) fail('candidate-v7 regression is missing, failing or not bound to the final build');
  await verifyRawSidecars(score);
  const supplementalValidation = await verifySupplemental(score, firstRaw);
  return { score, scored, supplementalValidation };
}

const requiredFinalPaths = [
  'WORKPLAN.md', 'plan-v2.json', 'plan-v3.json', 'plan-v4.json', 'plan-v5.json', 'plan-v6.json', 'resources-plan.json', 'resources.mjs', 'sample.mjs', 'paired.mjs',
  'score.mjs', 'score.mjs-v6.txt', 'verify-evidence.mjs', 'verify-evidence.mjs-v6.txt', 'verify-evidence.mjs-v7.txt', 'canonical.mjs', 'canonical.mjs-v6.txt', 'evidence-notes.md', 'regression.mjs', 'astra-review.md', 'astra-review-v8.md', 'REPORT.md',
  'baseline-aa-v2/raw.json', 'baseline-aa-v3/raw.json', 'baseline-aa-final-v1/raw.json', 'paired-v1/rejected.json',
  'build-baseline-v1/receipt.json', 'build-baseline-v1/source.patch', 'build-candidate-v3/receipt.json', 'build-candidate-v3/source.patch',
  'build-candidate-v4/receipt.json', 'build-candidate-v4/source.patch', 'build-candidate-v5/receipt.json', 'build-candidate-v5/source.patch', 'build-candidate-v6/receipt.json', 'build-candidate-v6/source.patch', 'build-candidate-v7/receipt.json', 'build-candidate-v7/source.patch',
  'paired-v5/raw.json', 'secondary-v4/raw.json', 'regression-candidate-v6-v1/raw.json',
  'paired-v6/raw.json', 'secondary-v5/raw.json', 'regression-candidate-v7-v1/raw.json',
  'readback-binding-v7.json', 'marker-dom-readback-final-v4/raw.json', 'marker-dom-readback-final-v4/plan-v5.json.txt', 'marker-dom-readback-final-v4/plan-v6.json.binding.txt', 'marker-dom-readback-final-v4/marker-dom-readback.mjs.txt', 'marker-dom-readback-final-v4/runtime.mjs.txt', 'marker-dom-readback-final-v4/desktop.png', 'marker-dom-readback-final-v4/mobile.png',
  'native-touch-final-v2/raw.json', 'native-touch-final-v2/plan-v6.json.txt', 'native-touch-final-v2/native-touch.mjs.txt', 'native-touch-final-v2/runtime.mjs.txt', 'native-touch-final-v2/final.png',
  'pool-dom-final-v2/raw.json', 'pool-dom-final-v2/baseline-pool.ts.txt', 'pool-dom-final-v2/candidate-pool.ts.txt', 'pool-dom-final-v2/pool-browser-dom.mjs.txt', 'pool-dom-final-v2/baseline-final.png', 'pool-dom-final-v2/candidate-final.png',
  'flicker-pan-before-v3/raw.json', 'flicker-pan-before-v3/flicker-pan.mjs.txt', 'flicker-pan-after-v1/raw.json', 'flicker-pan-after-v1/flicker-pan.mjs.txt', 'flicker-pan-after-v1/runtime.mjs.txt', 'flicker-pan-after-v1/desktop-after.png', 'flicker-pan-after-v1/mobile-after.png', 'flicker-pan-after-v1/desktop-trace.json', 'flicker-pan-after-v1/mobile-trace.json',
];

async function createMap(args) {
  const scoredPath = absolute(args.scored), output = absolute(args.output);
  underRoot(scoredPath); underRoot(output);
  const { supplementalValidation } = await verifyScore(scoredPath);
  try { await lstat(output); fail('map output already exists'); } catch (error) { if (error.message?.startsWith('render-flow evidence:') || error.code !== 'ENOENT') throw error; }
  for (const path of requiredFinalPaths) await safeBytes(resolve(HERE, path));
  const files = await walk(HERE, output), artifacts = {};
  for (const path of files) {
    const bytes = await safeBytes(path);
    artifacts[underRoot(path)] = { sha256: sha256(bytes), size: bytes.length };
  }
  const map = { schemaVersion: 'render-flow-evidence-map.v1', scope: 'complete frozen local laboratory evidence; external SHA-256 pin required', artifacts };
  await writeFile(output, `${JSON.stringify(map)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ artifactMap: underRoot(output), artifactCount: Object.keys(artifacts).length, externalSha256: sha256(await readFile(output)), supplementalValidation })}\n`);
}

async function verifyMap(args) {
  const scoredPath = absolute(args.scored), mapPath = absolute(args['artifact-map']);
  underRoot(scoredPath); underRoot(mapPath);
  const mapBytes = await safeBytes(mapPath);
  if (sha256(mapBytes) !== args['artifact-map-sha256']) fail('artifact map external pin mismatch');
  const map = JSON.parse(mapBytes);
  if (map.schemaVersion !== 'render-flow-evidence-map.v1' || !map.artifacts || typeof map.artifacts !== 'object') fail('invalid artifact map');
  const files = await walk(HERE, mapPath), actual = files.map(underRoot);
  if (!same(actual, Object.keys(map.artifacts))) fail('artifact map is not exact full-tree coverage');
  for (const path of actual) {
    const entry = map.artifacts[path], bytes = await safeBytes(resolve(HERE, path));
    if (!entry || entry.size !== bytes.length || entry.sha256 !== sha256(bytes)) fail(`artifact mismatch ${path}`);
  }
  for (const path of requiredFinalPaths) if (!map.artifacts[path]) fail(`required final evidence missing ${path}`);
  const { score, supplementalValidation } = await verifyScore(scoredPath);
  process.stdout.write(`${JSON.stringify({ verified: true, artifactMapSha256: args['artifact-map-sha256'], artifacts: actual.length, validQuietPairs: score.cells.filter(cell => cell.kind === 'primary').map(cell => cell.validQuietPairs), admittedLocalImprovements: score.cells.filter(cell => cell.admission.admittedLocalImprovement).length, admittedFieldSlices: 0, supplementalValidation })}\n`);
}

async function main() { const args = parseArgs(process.argv.slice(2)); if (args.mode === 'create-map') await createMap(args); else await verifyMap(args); }
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
export { verifySupplemental };
