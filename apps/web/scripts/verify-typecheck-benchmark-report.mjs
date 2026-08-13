#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
export const TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES = 64 * 1024 * 1024;
const TYPECHECK_BENCHMARK_MAX_METADATA_BYTES = 1024 * 1024;
const TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES = 8 * 1024 * 1024;
const TYPECHECK_BENCHMARK_MAX_RAW_ROWS = 20_000;
const OUTCOME_FAILURE_CODES = new Set(['TYPECHECK_BENCHMARK_FAILURE', 'TYPECHECK_COMPILER_EVIDENCE_INVALID', 'TYPECHECK_COMPILER_GATE_PROTOCOL', 'TYPECHECK_COMPILER_START_FAILED', 'TYPECHECK_SAMPLER_EVIDENCE_PROTOCOL', 'TYPECHECK_SAMPLER_EVIDENCE_RELEASE_FAILED', 'TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT', 'TYPECHECK_SAMPLER_INCOMPLETE', 'TYPECHECK_SAMPLER_JSON_INVALID', 'TYPECHECK_SAMPLER_PREMATURE_EXIT', 'TYPECHECK_SAMPLER_READY_PROTOCOL', 'TYPECHECK_SAMPLER_READY_TIMEOUT', 'TYPECHECK_SAMPLER_START_FAILED', 'TYPECHECK_SAMPLER_SUMMARY_INVALID', 'TYPECHECK_SAMPLER_SUMMARY_PROTOCOL']);
const BUDGETS = Object.freeze({
  noise: Object.freeze({ durationMadRelative: 0.05, peakRssMadRelative: 0.05 }),
  durationMedian: Object.freeze({ absoluteMs: 250, relative: 0.05 }),
  durationP75: Object.freeze({ absoluteMs: 250, relative: 0.10 }),
  rssP95: Object.freeze({ absoluteBytes: 128 * 1024 * 1024, relative: 0.15 }),
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digestFile = async (file) => sha256(await readFile(file));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const sha = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const exactJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const inside = (child, root) => { const relative = path.relative(root, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
async function parseCanonicalJson(file, maximumBytes) {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) throw new Error('Benchmark JSON evidence size is invalid');
  const source = await readFile(file, 'utf8');
  if (source.startsWith('\uFEFF') || source.includes('\r')) throw new Error('Benchmark JSON evidence encoding is invalid');
  const value = JSON.parse(source);
  if (source !== `${JSON.stringify(value, null, 2)}\n`) throw new Error('Benchmark JSON evidence is not canonical');
  return { source, value };
}
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function nearestRank(values, quantile) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]; }
function stats(values) { const center = median(values); return { count: values.length, median: center, mad: median(values.map((value) => Math.abs(value - center))), p75: nearestRank(values, .75), p95NearestRank: nearestRank(values, .95), min: Math.min(...values), max: Math.max(...values) }; }
function seededOrder(releaseId, samples) { const offset = createHash('sha256').update(releaseId).digest()[0] % 2; return Array.from({ length: samples * 2 }, (_, index) => (index + offset) % 2 === 0 ? 'native' : 'compat'); }
function profileStats(runs) { return Object.fromEntries(['native', 'compat'].map((kind) => { const selected = runs.filter((run) => run.kind === kind); return [kind, { durationMs: stats(selected.map((run) => run.durationMs)), peakRssBytes: stats(selected.map((run) => run.peakRssBytes)) }]; })); }
function noiseBreaches(profiles) {
  const breaches = [];
  for (const [kind, profile] of Object.entries(profiles)) {
    if (profile.durationMs.mad > profile.durationMs.median * BUDGETS.noise.durationMadRelative) breaches.push(`${kind}.durationMs`);
    if (profile.peakRssBytes.mad > profile.peakRssBytes.median * BUDGETS.noise.peakRssMadRelative) breaches.push(`${kind}.peakRssBytes`);
  }
  return breaches;
}
function independentNoiseWindows(runs) {
  const byKind = Object.fromEntries(['native', 'compat'].map((kind) => [kind, runs.filter((run) => run.kind === kind)]));
  if (byKind.native.length !== 9 || byKind.compat.length !== 9) return [];
  return Array.from({ length: 3 }, (_, index) => {
    const windowRuns = ['native', 'compat'].flatMap((kind) => byKind[kind].slice(index * 3, index * 3 + 3));
    return { index: index + 1, samplesPerCompiler: 3, breaches: noiseBreaches(profileStats(windowRuns)) };
  });
}
function validShimList(value, command, platform) {
  if (!Array.isArray(value)) return false;
  const paths = value.map((item) => item?.path);
  const base = `node_modules/.bin/${command}`;
  const validPaths = platform === 'win32-x64'
    ? exactJson(paths, [`${base}.exe`]) || exactJson(paths, [base, `${base}.cmd`, `${base}.ps1`])
    : exactJson(paths, [base]);
  return validPaths && value.every((item) => exactKeys(item, ['path', 'sha256']) && sha(item.sha256, 64));
}
function safeReceiptPath(value) {
  return value === 'node_modules/@typescript/old/package.json' || value === 'node_modules/typescript/node_modules/@typescript/old/package.json';
}
function validatePreflightReceipts(receipts, platform) {
  if (!exactKeys(receipts, ['verification', 'parity']) || !['verification', 'parity'].every((key) => exactKeys(receipts[key], ['sha256', 'value']) && sha(receipts[key].sha256, 64) && receipts[key].sha256 === sha256(JSON.stringify(receipts[key].value)))) return false;
  const verification = receipts.verification.value;
  const parity = receipts.parity.value;
  if (!exactKeys(verification, ['status', 'nativeCli', 'compatCli', 'programmaticApi', 'stableApiManifest', 'stableApiDependencyManifest', 'nativeCliEntrypointSha256', 'compatCliEntrypointSha256', 'platformPackage', 'nativeBinShims', 'compatBinShims', 'platformBinarySha256']) || verification.status !== 'passed' || verification.nativeCli !== '7.0.2' || verification.compatCli !== '6.0.2' || verification.programmaticApi !== '6.0.2' || verification.stableApiManifest !== 'node_modules/typescript/package.json' || !safeReceiptPath(verification.stableApiDependencyManifest) || !sha(verification.nativeCliEntrypointSha256, 64) || !sha(verification.compatCliEntrypointSha256, 64) || verification.platformPackage !== `@typescript/typescript-${platform.startsWith('win32-') ? 'win32' : 'linux'}-x64` || !validShimList(verification.nativeBinShims, 'tsc', platform) || !validShimList(verification.compatBinShims, 'tsc6', platform) || !sha(verification.platformBinarySha256, 64)) return false;
  return exactKeys(parity, ['status', 'diagnostics', 'logicalInputs', 'logicalInputNamesSha256', 'nonLibraryContentSha256', 'standardLibraryContentSha256']) && parity.status === 'passed' && parity.diagnostics === 0 && Number.isInteger(parity.logicalInputs) && parity.logicalInputs > 0 && parity.logicalInputs <= 100_000 && sha(parity.logicalInputNamesSha256, 64) && sha(parity.nonLibraryContentSha256, 64) && exactKeys(parity.standardLibraryContentSha256, ['native', 'compat']) && sha(parity.standardLibraryContentSha256.native, 64) && sha(parity.standardLibraryContentSha256.compat, 64);
}
function expectedDecision(runs, initialNoise) {
  const profiles = profileStats(runs);
  const aggregateBreaches = noiseBreaches(profiles);
  const windows = independentNoiseWindows(runs);
  const persistentBreaches = windows.length === 3 ? aggregateBreaches.filter((breach) => windows.every((window) => window.breaches.includes(breach))) : [];
  const boundedNoise = initialNoise
    && profiles.native.durationMs.count === 9
    && profiles.compat.durationMs.count === 9
    && aggregateBreaches.length > 0;
  const durationMedianDelta = profiles.native.durationMs.median - profiles.compat.durationMs.median;
  const durationP75Delta = profiles.native.durationMs.p75 - profiles.compat.durationMs.p75;
  const rssP95Delta = profiles.native.peakRssBytes.p95NearestRank - profiles.compat.peakRssBytes.p95NearestRank;
  const durationMedianRegression = durationMedianDelta > BUDGETS.durationMedian.absoluteMs && durationMedianDelta / profiles.compat.durationMs.median > BUDGETS.durationMedian.relative;
  const durationP75Regression = durationP75Delta > BUDGETS.durationP75.absoluteMs && durationP75Delta / profiles.compat.durationMs.p75 > BUDGETS.durationP75.relative;
  const durationRegression = durationMedianRegression || durationP75Regression;
  const rssRegression = rssP95Delta > BUDGETS.rssP95.absoluteBytes && rssP95Delta / profiles.compat.peakRssBytes.p95NearestRank > BUDGETS.rssP95.relative;
  const speedupMs = profiles.compat.durationMs.median - profiles.native.durationMs.median;
  const speedupRatio = speedupMs / profiles.compat.durationMs.median;
  const pooledMad = median(runs.map((run) => Math.abs(run.durationMs - profiles[run.kind].durationMs.median)));
  const passed = !durationRegression && !rssRegression && (aggregateBreaches.length === 0 || boundedNoise);
  return {
    profiles,
    evidenceDecision: {
      status: boundedNoise ? 'inconclusive_noise' : aggregateBreaches.length > 0 ? 'invalid_noise' : 'conclusive',
      reason: boundedNoise ? 'noise_budget_exceeded_after_bounded_samples' : aggregateBreaches.length > 0 ? 'noise_extension_contract_invalid' : null,
      totalSlices: 2,
      admittedSlices: aggregateBreaches.length > 0 ? 0 : 2,
      boundedSamplesPerCompiler: profiles.native.durationMs.count,
      performanceClaimsAllowed: aggregateBreaches.length === 0 && passed,
      cachePublished: false,
      aggregateBreaches,
      independentWindows: windows,
      persistentBreaches,
    },
    comparison: {
      durationMedianDelta,
      durationP75Delta,
      rssP95Delta,
      durationMedianRegression,
      durationP75Regression,
      rssRegression,
      positiveSpeedClaimProfileEvidence: { speedupMs, speedupRatio, pooledMad, eligible: aggregateBreaches.length === 0 && passed && speedupMs >= 200 && speedupRatio >= 0.10 && speedupMs >= 2 * pooledMad },
    },
    acceptance: { durationRegression, rssRegression, passed },
    initialNoise,
  };
}

export function validateBenchmarkReportDocument(report, expected) {
  if (!exactKeys(report, ['schemaVersion', 'releaseId', 'candidate', 'receipts', 'contracts', 'warmups', 'sequence', 'initialNoise', 'invalidRuns', 'runs', 'rawEvidence', 'profiles', 'evidenceDecision', 'comparison', 'acceptance']) || report.schemaVersion !== 4 || report.releaseId !== expected.tree || !sha(report.releaseId, 40)) throw new Error('Benchmark report release binding is invalid');
  const expectedPlatform = expected.profile?.startsWith('windows-') ? 'win32-x64' : 'linux-x64';
  if (expected.platform !== expectedPlatform || !expected.profile?.endsWith(`-${expected.installer}`)) throw new Error('Benchmark verifier lane binding is invalid');
  const candidate = report.candidate;
  if (!exactKeys(candidate, ['tree', 'repositoryTopLevelSha256', 'headCommit', 'headTree', 'provenanceSha256', 'platform', 'installer', 'profile', 'node', 'arch', 'installerUserAgentSha256']) || candidate.tree !== expected.tree || candidate.headTree !== expected.tree || candidate.profile !== expected.profile || candidate.platform !== expected.platform || candidate.installer !== expected.installer || candidate.arch !== 'x64' || !/^v24\.[0-9]+\.[0-9]+$/.test(candidate.node ?? '') || !sha(candidate.installerUserAgentSha256, 64) || !sha(candidate.headCommit, 40) || !sha(candidate.repositoryTopLevelSha256, 64) || !sha(candidate.provenanceSha256, 64)) throw new Error('Benchmark report candidate binding is invalid');
  if (!exactKeys(report.contracts, ['requestedSamplerCadenceMs', 'maximumObservedGapMs', 'hostPressureMaximumPercent', 'retryCapPerPosition', 'invalidRunCapPerCompiler', 'publication', 'publicationMaximumBytes', 'metadataMaximumBytes', 'rawFileMaximumBytes', 'rawRowMaximum', 'budgets']) || !exactJson(report.contracts.budgets, BUDGETS) || report.contracts.requestedSamplerCadenceMs !== 10 || report.contracts.maximumObservedGapMs !== 60 || report.contracts.hostPressureMaximumPercent !== 80 || report.contracts.publication !== 'atomic-directory-rename' || report.contracts.publicationMaximumBytes !== TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES || report.contracts.metadataMaximumBytes !== TYPECHECK_BENCHMARK_MAX_METADATA_BYTES || report.contracts.rawFileMaximumBytes !== TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES || report.contracts.rawRowMaximum !== TYPECHECK_BENCHMARK_MAX_RAW_ROWS || report.contracts.retryCapPerPosition !== 2 || report.contracts.invalidRunCapPerCompiler !== 3) throw new Error('Benchmark report budgets or bounded contracts are invalid');
  if (!validatePreflightReceipts(report.receipts, expected.platform)) throw new Error('Benchmark report compiler or parity receipts are invalid');
  if (!Array.isArray(report.warmups) || report.warmups.length !== 2 || report.warmups[0]?.kind !== 'native' || report.warmups[1]?.kind !== 'compat' || !report.warmups.every((warmup) => exactKeys(warmup, ['kind', 'durationMs', 'rawSha256']) && finite(warmup.durationMs) && warmup.durationMs > 0 && sha(warmup.rawSha256, 64))) throw new Error('Benchmark report warm-up evidence is invalid');
  if (!exactKeys(report.invalidRuns, ['native', 'compat']) || !['native', 'compat'].every((kind) => Number.isInteger(report.invalidRuns[kind]) && report.invalidRuns[kind] >= 0 && report.invalidRuns[kind] <= 3)) throw new Error('Benchmark report invalid-run bounds are invalid');
  if (!Array.isArray(report.runs) || ![14, 18].includes(report.runs.length) || !report.runs.every((run, index) => exactKeys(run, ['position', 'retry', 'kind', 'durationMs', 'peakRssBytes', 'samples', 'maximumGapMs', 'rawOutput', 'rawSha256']) && run.position === index + 1 && [1, 2, 3].includes(run.retry) && ['native', 'compat'].includes(run.kind) && finite(run.durationMs) && run.durationMs > 0 && Number.isSafeInteger(run.peakRssBytes) && run.peakRssBytes > 0 && Number.isInteger(run.samples) && run.samples >= 3 && finite(run.maximumGapMs) && run.maximumGapMs >= 0 && run.maximumGapMs <= 60 && run.rawOutput === `${String(run.position).padStart(2, '0')}-${run.kind}-attempt-${run.retry}.ndjson` && sha(run.rawSha256, 64))) throw new Error('Benchmark report measured runs are invalid');
  if (!Array.isArray(report.sequence) || !exactJson(report.sequence, seededOrder(report.releaseId, report.runs.length / 2)) || !report.sequence.every((kind, index) => kind === report.runs[index].kind)) throw new Error('Benchmark report sequence is invalid');
  const counts = Object.fromEntries(['native', 'compat'].map((kind) => [kind, report.runs.filter((run) => run.kind === kind).length]));
  if (counts.native !== counts.compat || ![7, 9].includes(counts.native)) throw new Error('Benchmark report sample bounds are invalid');
  const firstSevenProfiles = profileStats(report.runs.filter((run) => run.position <= 14));
  const initialNoise = noiseBreaches(firstSevenProfiles).length > 0;
  if (report.initialNoise !== initialNoise || (counts.native === 9) !== initialNoise) throw new Error('Benchmark report bounded noise extension is invalid');
  const derived = expectedDecision(report.runs, initialNoise);
  if (!exactJson(report.profiles, derived.profiles) || !exactJson(report.evidenceDecision, derived.evidenceDecision) || !exactJson(report.comparison, derived.comparison)) throw new Error('Benchmark report statistics or decision are invalid');
  if (!exactKeys(report.acceptance, ['diagnosticsEqual', 'toolchainVerified', 'durationRegression', 'rssRegression', 'passed']) || report.acceptance.diagnosticsEqual !== true || report.acceptance.toolchainVerified !== true || report.acceptance.durationRegression !== derived.acceptance.durationRegression || report.acceptance.rssRegression !== derived.acceptance.rssRegression || report.acceptance.passed !== derived.acceptance.passed) throw new Error('Benchmark report acceptance is invalid');
  if (report.evidenceDecision.status === 'inconclusive_noise' && (counts.native !== 9 || report.evidenceDecision.independentWindows.length !== 3 || report.evidenceDecision.independentWindows.some((window, index) => window.index !== index + 1 || window.samplesPerCompiler !== 3) || report.evidenceDecision.aggregateBreaches.length === 0 || report.acceptance.durationRegression !== false || report.acceptance.rssRegression !== false || report.evidenceDecision.admittedSlices !== 0 || report.evidenceDecision.performanceClaimsAllowed !== false || report.evidenceDecision.cachePublished !== false || report.comparison.positiveSpeedClaimProfileEvidence.eligible !== false)) throw new Error('Inconclusive noise must be bounded, non-regressing, and admit no performance slices or claims');
  if (report.evidenceDecision.status === 'invalid_noise') throw new Error('Benchmark noise extension contract is invalid');
  if (report.acceptance.passed !== true) throw new Error('Benchmark report contains an observed regression');
  return { status: report.evidenceDecision.status, admittedSlices: report.evidenceDecision.admittedSlices };
}

async function publicationEntries(directory, prefix = '') {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Benchmark publication contains an unsupported entry');
    if (entry.isDirectory()) {
      entries.push(`${relative}/`);
      entries.push(...await publicationEntries(path.join(directory, entry.name), relative));
    } else entries.push(relative);
  }
  return entries.sort();
}

function validSamplerSummary(summary, rawOutput) {
  return exactKeys(summary, ['schemaVersion', 'rootPid', 'rootStartIdentity', 'requestedIntervalMs', 'maximumAllowedGapMs', 'samples', 'peakRssBytes', 'maximumGapMs', 'terminalObserved', 'valid', 'invalidReasons', 'output']) && summary.schemaVersion === 2 && Number.isInteger(summary.rootPid) && summary.rootPid > 0 && typeof summary.rootStartIdentity === 'string' && /^\d+$/.test(summary.rootStartIdentity) && summary.requestedIntervalMs === 10 && summary.maximumAllowedGapMs === 60 && Number.isInteger(summary.samples) && summary.samples >= 3 && summary.samples <= TYPECHECK_BENCHMARK_MAX_RAW_ROWS && Number.isSafeInteger(summary.peakRssBytes) && summary.peakRssBytes > 0 && finite(summary.maximumGapMs) && summary.maximumGapMs >= 0 && summary.maximumGapMs <= 60 && summary.terminalObserved === true && summary.valid === true && Array.isArray(summary.invalidReasons) && summary.invalidReasons.length === 0 && summary.output === rawOutput;
}
function validOutcomeShape(outcome) {
  if (!record(outcome) || !['warmup', 'measured'].includes(outcome.phase) || !['native', 'compat'].includes(outcome.kind) || typeof outcome.rawOutput !== 'string' || !(outcome.rawSha256 === null || sha(outcome.rawSha256, 64))) return false;
  if (outcome.phase === 'warmup') return exactKeys(outcome, ['phase', 'kind', 'durationMs', 'rawOutput', 'rawSha256', 'summary']) && finite(outcome.durationMs) && outcome.durationMs > 0 && outcome.rawOutput === `warmup-${outcome.kind}.ndjson` && sha(outcome.rawSha256, 64) && validSamplerSummary(outcome.summary, outcome.rawOutput);
  const hasSummary = Object.hasOwn(outcome, 'summary');
  const expectedKeys = ['phase', 'position', 'retry', 'kind', 'accepted', 'rawOutput', 'rawSha256', 'failure', ...(hasSummary ? ['durationMs', 'summary'] : [])];
  if (!exactKeys(outcome, expectedKeys) || !Number.isInteger(outcome.position) || outcome.position < 1 || outcome.position > 18 || ![1, 2, 3].includes(outcome.retry) || ![true, false].includes(outcome.accepted) || outcome.rawOutput !== `${String(outcome.position).padStart(2, '0')}-${outcome.kind}-attempt-${outcome.retry}.ndjson`) return false;
  if (outcome.accepted === true) return outcome.failure === null && sha(outcome.rawSha256, 64) && hasSummary && finite(outcome.durationMs) && outcome.durationMs > 0 && validSamplerSummary(outcome.summary, outcome.rawOutput);
  if (typeof outcome.failure !== 'string' || !OUTCOME_FAILURE_CODES.has(outcome.failure)) return false;
  return hasSummary ? outcome.failure === 'TYPECHECK_COMPILER_EVIDENCE_INVALID' && finite(outcome.durationMs) && outcome.durationMs > 0 && sha(outcome.rawSha256, 64) && validSamplerSummary(outcome.summary, outcome.rawOutput) : true;
}
function validateOutcomeOrdering(outcomes, runs) {
  if (!Array.isArray(outcomes) || outcomes.length < 16 || outcomes.length > 56 || !outcomes.every(validOutcomeShape)) return false;
  if (outcomes[0].phase !== 'warmup' || outcomes[0].kind !== 'native' || outcomes[1].phase !== 'warmup' || outcomes[1].kind !== 'compat' || outcomes.slice(2).some((outcome) => outcome.phase !== 'measured')) return false;
  const measured = outcomes.slice(2);
  let cursor = 0;
  for (const run of runs) {
    const attempts = [];
    while (cursor < measured.length && measured[cursor].position === run.position) attempts.push(measured[cursor++]);
    if (!attempts.length || attempts.length !== run.retry || attempts.some((attempt, index) => attempt.retry !== index + 1 || attempt.kind !== run.kind || attempt.accepted !== (index === attempts.length - 1)) || attempts.at(-1).rawOutput !== run.rawOutput || attempts.at(-1).rawSha256 !== run.rawSha256) return false;
  }
  return cursor === measured.length;
}
const RAW_ERROR = /^(?:host-memory-pressure|malformed-process-identity|malformed-root-identity|malformed-sample-errors|memory-collector-error|missing-root-identity|process-identity-reused|root-identity-not-established|root-identity-reused|sampling-gap-exceeded|invalid-included-rss|(?:exited|inaccessible)-(?:root|child)-(?:record|children):\d+)$/;
function validateRawRow(row) {
  if (!exactKeys(row, ['monotonicMs', 'wallUtc', 'processes', 'errors', 'totalPhysicalBytes', 'availablePhysicalBytes', 'rootIdentity', 'samplerIdentity', 'included', 'includedRssBytes', 'hostPressurePercent', 'observedGapMs']) || !finite(row.monotonicMs) || row.monotonicMs < 0 || typeof row.wallUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/.test(row.wallUtc) || !Number.isFinite(Date.parse(row.wallUtc)) || !Number.isSafeInteger(row.totalPhysicalBytes) || row.totalPhysicalBytes <= 0 || !Number.isSafeInteger(row.availablePhysicalBytes) || row.availablePhysicalBytes < 0 || row.availablePhysicalBytes > row.totalPhysicalBytes || !(row.rootIdentity === null || typeof row.rootIdentity === 'string' && /^\d+$/.test(row.rootIdentity)) || typeof row.samplerIdentity !== 'string' || !/^\d+$/.test(row.samplerIdentity) || !Number.isSafeInteger(row.includedRssBytes) || row.includedRssBytes < 0 || !finite(row.hostPressurePercent) || row.hostPressurePercent < 0 || row.hostPressurePercent > 100 || !finite(row.observedGapMs) || row.observedGapMs < 0 || row.observedGapMs > 1_000_000 || !Array.isArray(row.errors) || !row.errors.every((error) => typeof error === 'string' && RAW_ERROR.test(error)) || !Array.isArray(row.processes) || !Array.isArray(row.included)) return false;
  if (!row.processes.every((process) => exactKeys(process, ['pid', 'parentPid', 'startIdentity', 'rssBytes']) && Number.isInteger(process.pid) && process.pid > 0 && Number.isInteger(process.parentPid) && process.parentPid >= 0 && typeof process.startIdentity === 'string' && /^\d+$/.test(process.startIdentity) && Number.isSafeInteger(process.rssBytes) && process.rssBytes >= 0) || new Set(row.processes.map((process) => process.pid)).size !== row.processes.length) return false;
  const rootStart = BigInt(row.rootIdentity ?? '0');
  const included = row.processes.filter((process) => BigInt(process.startIdentity) >= rootStart);
  const includedNames = included.map((process) => `${process.pid}:${process.startIdentity}`);
  const includedRssBytes = included.reduce((sum, process) => sum + process.rssBytes, 0);
  const hostPressurePercent = ((row.totalPhysicalBytes - row.availablePhysicalBytes) * 100) / row.totalPhysicalBytes;
  return exactJson(row.included, includedNames) && includedRssBytes === row.includedRssBytes && hostPressurePercent === row.hostPressurePercent;
}
async function validateRawFile(file, summary) {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 0 || metadata.size > TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES) throw new Error('Benchmark raw evidence size is invalid');
  const source = await readFile(file, 'utf8');
  if (!source) {
    if (summary) throw new Error('Benchmark successful raw evidence is empty');
    return;
  }
  if (source.startsWith('\uFEFF') || source.includes('\r') || !source.endsWith('\n')) throw new Error('Benchmark raw evidence encoding is invalid');
  const lines = source.slice(0, -1).split('\n');
  if (!lines.length || lines.length > TYPECHECK_BENCHMARK_MAX_RAW_ROWS) throw new Error('Benchmark raw evidence row bound is invalid');
  const rows = lines.map((line) => {
    const row = JSON.parse(line);
    if (line !== JSON.stringify(row) || !validateRawRow(row)) throw new Error('Benchmark raw evidence row is invalid');
    return row;
  });
  if (!summary) return;
  let prior = null; let peak = 0; let maximumGap = 0;
  for (const row of rows) {
    const expectedGap = prior === null ? 0 : row.monotonicMs - prior;
    if (row.errors.length || row.rootIdentity !== summary.rootStartIdentity || !row.processes.some((process) => process.pid === summary.rootPid && process.startIdentity === summary.rootStartIdentity) || row.observedGapMs !== expectedGap || row.observedGapMs > 60 || row.hostPressurePercent > 80) throw new Error('Benchmark successful raw evidence is not clean');
    prior = row.monotonicMs; peak = Math.max(peak, row.includedRssBytes); maximumGap = Math.max(maximumGap, row.observedGapMs);
  }
  if (rows.length !== summary.samples || peak !== summary.peakRssBytes || maximumGap !== summary.maximumGapMs) throw new Error('Benchmark raw aggregates do not match the sampler summary');
}

export async function verifyPublishedBenchmarkDirectory(options) {
  const reportPath = path.resolve(options.report);
  const directory = path.dirname(reportPath);
  if (path.basename(reportPath) !== 'report.json' || inside(reportPath, REPO_ROOT)) throw new Error('Benchmark report path is invalid');
  const report = (await parseCanonicalJson(reportPath, TYPECHECK_BENCHMARK_MAX_METADATA_BYTES)).value;
  const decision = validateBenchmarkReportDocument(report, options);
  const rawEvidence = report.rawEvidence;
  if (!exactKeys(rawEvidence, ['preflight', 'preflightSha256', 'outcomes', 'outcomesSha256', 'attempts']) || rawEvidence.preflight !== 'preflight-receipts.json' || rawEvidence.outcomes !== 'attempt-outcomes.json' || !sha(rawEvidence.preflightSha256, 64) || !sha(rawEvidence.outcomesSha256, 64) || !Array.isArray(rawEvidence.attempts) || rawEvidence.attempts.length < 16 || rawEvidence.attempts.length > 56) throw new Error('Benchmark raw evidence manifest is invalid');
  const attemptNames = [];
  const rawNames = [];
  for (const attempt of rawEvidence.attempts) {
    if (!exactKeys(attempt, ['rawOutput', 'rawSha256']) || !/^(?:warmup-(?:native|compat)|\d{2}-(?:native|compat)-attempt-[1-3])\.ndjson$/.test(attempt.rawOutput) || !(attempt.rawSha256 === null || sha(attempt.rawSha256, 64))) throw new Error('Benchmark raw attempt reference is invalid');
    if (attemptNames.includes(attempt.rawOutput)) throw new Error('Benchmark raw attempt reference is duplicated');
    attemptNames.push(attempt.rawOutput);
    if (attempt.rawSha256 !== null) {
      rawNames.push(attempt.rawOutput);
    }
  }
  if (!rawNames.includes('warmup-native.ndjson') || !rawNames.includes('warmup-compat.ndjson')) throw new Error('Benchmark warm-up evidence is incomplete');
  const expectedFiles = ['attempt-outcomes.json', 'preflight-receipts.json', 'raw/', 'report.json', ...rawNames.map((name) => `raw/${name}`)].sort();
  const actualFiles = await publicationEntries(directory);
  if (!exactJson(actualFiles, expectedFiles)) throw new Error('Benchmark publication boundary does not match the exact allowlist');
  const sizes = await Promise.all(actualFiles.filter((entry) => !entry.endsWith('/')).map(async (file) => {
    const size = (await stat(path.join(directory, file))).size;
    const raw = file.startsWith('raw/');
    const maximum = raw ? TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES : TYPECHECK_BENCHMARK_MAX_METADATA_BYTES;
    if ((!raw && size <= 0) || size > maximum) throw new Error('Benchmark publication file size is outside its bound');
    return size;
  }));
  if (sizes.reduce((sum, size) => sum + size, 0) > TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES) throw new Error('Benchmark publication exceeds the aggregate size bound');
  const preflightPath = path.join(directory, rawEvidence.preflight);
  const outcomesPath = path.join(directory, rawEvidence.outcomes);
  if (await digestFile(preflightPath) !== rawEvidence.preflightSha256 || await digestFile(outcomesPath) !== rawEvidence.outcomesSha256) throw new Error('Benchmark receipt hashes are invalid');
  const preflight = (await parseCanonicalJson(preflightPath, TYPECHECK_BENCHMARK_MAX_METADATA_BYTES)).value;
  const outcomes = (await parseCanonicalJson(outcomesPath, TYPECHECK_BENCHMARK_MAX_METADATA_BYTES)).value;
  if (!exactJson(preflight, report.receipts)) throw new Error('Benchmark preflight receipt readback is invalid');
  if (!validateOutcomeOrdering(outcomes, report.runs) || !exactJson(rawEvidence.attempts, outcomes.map(({ rawOutput, rawSha256 }) => ({ rawOutput, rawSha256 })))) throw new Error('Benchmark attempt manifest readback is invalid');
  const measuredOutcomes = outcomes.filter((outcome) => outcome.phase === 'measured');
  const acceptedOutcomes = measuredOutcomes.filter((outcome) => outcome.accepted === true);
  if (acceptedOutcomes.length !== report.runs.length || report.runs.some((run) => !acceptedOutcomes.some((outcome) => outcome.position === run.position && outcome.retry === run.retry && outcome.kind === run.kind && outcome.failure === null && outcome.durationMs === run.durationMs && outcome.rawOutput === run.rawOutput && outcome.rawSha256 === run.rawSha256 && outcome.summary.peakRssBytes === run.peakRssBytes && outcome.summary.samples === run.samples && outcome.summary.maximumGapMs === run.maximumGapMs))) throw new Error('Benchmark accepted compiler outcomes do not match measured runs');
  const warmupOutcomes = outcomes.slice(0, 2);
  if (report.warmups.some((warmup, index) => warmupOutcomes[index].kind !== warmup.kind || warmupOutcomes[index].durationMs !== warmup.durationMs || warmupOutcomes[index].rawSha256 !== warmup.rawSha256)) throw new Error('Benchmark warm-up outcomes do not match report evidence');
  const invalidCounts = Object.fromEntries(['native', 'compat'].map((kind) => [kind, measuredOutcomes.filter((outcome) => outcome.kind === kind && outcome.accepted === false).length]));
  if (!exactJson(invalidCounts, report.invalidRuns) || measuredOutcomes.some((outcome) => ![true, false].includes(outcome.accepted))) throw new Error('Benchmark compiler outcome bounds are invalid');
  for (const attempt of rawEvidence.attempts) {
    if (attempt.rawSha256 !== null) {
      const rawPath = path.join(directory, 'raw', attempt.rawOutput);
      if (await digestFile(rawPath) !== attempt.rawSha256) throw new Error('Benchmark raw attempt hash is invalid');
      const outcome = outcomes.find((candidate) => candidate.rawOutput === attempt.rawOutput);
      await validateRawFile(rawPath, outcome?.summary ?? null);
    }
  }
  const attemptByName = new Map(rawEvidence.attempts.map((attempt) => [attempt.rawOutput, attempt.rawSha256]));
  if (report.runs.some((run) => attemptByName.get(run.rawOutput) !== run.rawSha256)) throw new Error('Benchmark measured run hashes do not match the attempt manifest');
  if (report.warmups.some((warmup) => attemptByName.get(`warmup-${warmup.kind}.ndjson`) !== warmup.rawSha256)) throw new Error('Benchmark warm-up hashes do not match the attempt manifest');
  return decision;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!value) throw new Error('A benchmark verification argument is missing');
    if (key === '--report') options.report = value;
    else if (key === '--tree') options.tree = value;
    else if (key === '--profile') options.profile = value;
    else if (key === '--platform') options.platform = value;
    else if (key === '--installer') options.installer = value;
    else throw new Error('Unknown benchmark verification argument');
  }
  const expectedPlatform = options.profile?.startsWith('windows-') ? 'win32-x64' : 'linux-x64';
  if (!options.report || !sha(options.tree, 40) || !/^(?:ubuntu|windows)-(?:npm|bun)$/.test(options.profile ?? '') || options.platform !== expectedPlatform || !['npm', 'bun'].includes(options.installer) || !options.profile.endsWith(`-${options.installer}`)) throw new Error('Benchmark verification arguments are invalid');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPublishedBenchmarkDirectory(parseArgs(process.argv.slice(2))).then((decision) => {
    process.stdout.write(`${JSON.stringify({ status: 'verified', evidenceStatus: decision.status, admittedSlices: decision.admittedSlices })}\n`);
  }).catch((error) => {
    process.stderr.write('verify-typecheck-benchmark-report: ');
    logCliError(error);
    process.exitCode = 1;
  });
}
