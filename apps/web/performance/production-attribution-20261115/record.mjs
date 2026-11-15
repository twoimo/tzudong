/** Local evidence recorder only. This file does not control or fetch a browser. */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, PROTOCOL_SHA256, URL, COMMIT, OBSERVER_PATHS, check, hash, parse, timestamp,
  read, writeNew, writeJson, conforms, phaseProblems, createMap, argumentsOf } from './evidence.mjs';

export function recordAttempt({ root = ROOT, phase, ordinal, rawPath, startedAtUtc, observedAtUtc, observedUrl = URL, outcome = 'captured' }) {
  check(['before', 'after'].includes(phase) && Number.isInteger(ordinal) && ordinal >= 0 && ordinal <= 5, 'phase or ordinal invalid');
  check(timestamp(startedAtUtc) !== null && timestamp(observedAtUtc) !== null && timestamp(startedAtUtc) <= timestamp(observedAtUtc), 'capture timestamps invalid');
  check([URL, 'other'].includes(observedUrl), 'record only the fixed URL or the classification other');
  check(['captured', 'collector-unavailable', 'blocked-access', 'capture-unavailable', 'invalid-diagnostic-payload'].includes(outcome), 'outcome invalid');
  const frozen = parse(read(root, `inputs/phases/${phase}.json`));
  check(timestamp(startedAtUtc) >= timestamp(frozen.frozenAtUtc), 'attempt predates frozen source');
  const stem = `inputs/${phase}/${String(ordinal).padStart(2, '0')}`;
  check(!existsSync(resolve(root, `${stem}.receipt.json`)) && !existsSync(resolve(root, `${stem}.snapshot.json`)), 'attempt already retained; no overwrite or replacement');
  let snapshot = null, snapshotSha256 = null;
  if (outcome === 'captured') {
    check(typeof rawPath === 'string', 'captured outcome requires exact DOM JSON file');
    const bytes = readFileSync(rawPath);
    check(bytes.length <= 256 * 1024, 'snapshot exceeds bounded size');
    const value = parse(bytes);
    check(conforms(value, parse(read(root, 'snapshot.schema.json'))), 'snapshot violates numeric/fixed-enum whitelist; retain a bounded invalid-diagnostic-payload receipt instead');
    check(bytes.toString('utf8').trim() === JSON.stringify(value, null, 2), 'use exact displayed JSON text; duplicate keys or altered serialization rejected');
    snapshot = `${stem}.snapshot.json`;
    snapshotSha256 = hash(bytes);
    writeNew(root, snapshot, bytes);
  } else check(!rawPath, 'failure receipts do not retain arbitrary page text');
  const receipt = { schemaVersion: 'production-attribution.receipt.v1', phase, ordinal, role: ordinal === 0 ? 'declared-warmup' : 'planned-measurement',
    navigationStartedAtUtc: startedAtUtc, observedAtUtc, observedUrl, extraction: 'visible-diagnostic-pre-text', outcome, snapshot, snapshotSha256 };
  writeJson(root, `${stem}.receipt.json`, receipt);
  return { receipt: `${stem}.receipt.json`, receiptSha256: hash(read(root, `${stem}.receipt.json`)), snapshotSha256, timingAdmission: ordinal === 0 ? 0 : 'pending-validation' };
}

export function freezePhase({ root = ROOT, repository = resolve(root, '../../../..'), phase, sourceSha, deploymentId, projectId, frozenAtUtc, identityPath }) {
  check(['before', 'after'].includes(phase) && COMMIT.test(sourceSha ?? ''), 'phase or immutable source SHA invalid');
  check(timestamp(frozenAtUtc) !== null, 'frozen timestamp required');
  const identity = parse(readFileSync(identityPath));
  check(Object.keys(identity).length === 2 && identity.providerIdentity && identity.healthIdentity, 'identity input requires exactly providerIdentity and healthIdentity');
  const sourceTreeSha = execFileSync('git', ['-C', repository, 'rev-parse', `${sourceSha}^{tree}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const observerFiles = OBSERVER_PATHS.map((path) => ({ path, sha256: hash(execFileSync('git', ['-C', repository, 'show', `${sourceSha}:${path}`], { stdio: ['ignore', 'pipe', 'pipe'] })) }));
  const frozen = { schemaVersion: 'production-attribution.phase.v1', phase, frozenAtUtc, sourceSha, sourceTreeSha, deploymentId, projectId,
    canonicalHost: 'www.tzudong.app', observerFiles, ...identity };
  const issues = phaseProblems(frozen, phase, repository, parse(read(root, 'protocol.json')));
  check(issues.length === 0, `phase identity not valid: ${issues.join(',')}`);
  const path = `inputs/phases/${phase}.json`;
  writeJson(root, path, frozen);
  return { phase: path, phaseSha256: hash(read(root, path)), sourceSha, sourceTreeSha, observerFiles };
}

export function freezeCohort({ root = ROOT, frozenAtUtc, browserSurface }) {
  check(timestamp(frozenAtUtc) !== null && browserSurface === 'cua-cloud-cdp', 'actual browser surface and timestamp required');
  const receiptBytes = read(root, 'inputs/before/00.receipt.json');
  const receipt = parse(receiptBytes);
  check(receipt.outcome === 'captured' && receipt.observedUrl === URL && timestamp(frozenAtUtc) >= timestamp(receipt.observedAtUtc), 'before warm-up must precede cohort freeze');
  const bytes = read(root, receipt.snapshot);
  check(hash(bytes) === receipt.snapshotSha256, 'warm-up snapshot changed');
  const s = parse(bytes);
  check(conforms(s, parse(read(root, 'snapshot.schema.json'))), 'warm-up schema');
  const frozen = parse(read(root, 'inputs/phases/before.json'));
  check(s.binding.gitSha === frozen.sourceSha && s.binding.hostname === 'www.tzudong.app' && s.capture.contextUnchanged
    && s.capture.visibilityAtStart === 'visible' && s.capture.firstHiddenAtMs === null && s.capture.trustedInputCount === 0 && s.capture.resizeCount === 0
    && s.navigation?.type === 'navigate' && s.navigation.redirectCount === 0 && s.navigation.activationStart === 0, 'warm-up context unsuitable for cohort binding');
  check(JSON.stringify(s.viewport.initial) === JSON.stringify(s.viewport.final) && s.viewport.initial.width >= 1024
    && s.viewport.initial.height > 0 && s.viewport.initial.dpr > 0, 'actual desktop viewport unavailable');
  const cohort = { schemaVersion: 'production-attribution.cohort.v1', protocolSha256: PROTOCOL_SHA256, frozenAtUtc,
    browserSurface, browserVersion: null, viewport: s.viewport.initial, navigationType: 'navigate',
    cacheControl: 'unavailable', networkControl: 'unavailable', cpuControl: 'unavailable',
    setupReceipt: 'inputs/before/00.receipt.json', setupReceiptSha256: hash(receiptBytes), setupSnapshotSha256: hash(bytes) };
  writeJson(root, 'inputs/cohort.json', cohort);
  return { cohort: 'inputs/cohort.json', cohortSha256: hash(read(root, 'inputs/cohort.json')), viewport: cohort.viewport };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const args = argumentsOf(process.argv.slice(3), ['--root', '--phase', '--ordinal', '--raw', '--started-at', '--observed-at', '--observed-url', '--outcome',
      '--source-sha', '--deployment-id', '--project-id', '--frozen-at', '--identity', '--repository', '--browser-surface', '--stage', '--baseline-map-sha256']);
    const root = resolve(args['--root'] ?? ROOT);
    check(hash(read(root, 'protocol.json')) === PROTOCOL_SHA256, 'predeclared protocol hash changed');
    let result;
    if (command === 'attempt') result = recordAttempt({ root, phase: args['--phase'], ordinal: Number(args['--ordinal']), rawPath: args['--raw'],
      startedAtUtc: args['--started-at'], observedAtUtc: args['--observed-at'], observedUrl: args['--observed-url'], outcome: args['--outcome'] });
    else if (command === 'phase') result = freezePhase({ root, repository: args['--repository'], phase: args['--phase'], sourceSha: args['--source-sha'],
      deploymentId: args['--deployment-id'], projectId: args['--project-id'], frozenAtUtc: args['--frozen-at'], identityPath: args['--identity'] });
    else if (command === 'cohort') result = freezeCohort({ root, frozenAtUtc: args['--frozen-at'], browserSurface: args['--browser-surface'] });
    else if (command === 'map') result = createMap({ root, stage: args['--stage'], baselineMapSha256: args['--baseline-map-sha256'] });
    else throw new Error('use phase, attempt, cohort or map');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(`production evidence: ${error.message}`); process.exitCode = 1; }
}
