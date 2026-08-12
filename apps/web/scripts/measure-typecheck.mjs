#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError } from './privacy-safe-cli-log.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const SAMPLER = path.join(APP_ROOT, 'scripts', 'process-tree-rss-sampler.mjs');
const VERIFY = path.join(APP_ROOT, 'scripts', 'verify-typescript-toolchain.mjs');
const PARITY = path.join(APP_ROOT, 'scripts', 'run-typecheck.mjs');
const COMPILERS = Object.freeze({
  native: { entrypoint: path.join(APP_ROOT, 'node_modules', '@typescript', 'native', 'bin', 'tsc'), args: ['--project', path.join(APP_ROOT, 'tsconfig.json'), '--noEmit', '--pretty', 'false', '--incremental', 'false', '--checkers', '4'] },
  compat: { entrypoint: path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc6'), args: ['--project', path.join(APP_ROOT, 'tsconfig.json'), '--noEmit', '--pretty', 'false', '--incremental', 'false', '--stableTypeOrdering'] },
});
const WINDOWS_COMPILER_EVIDENCE_TIMEOUT_MS = 120_000;
export const TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES = 64 * 1024 * 1024;
const TYPECHECK_BENCHMARK_MAX_METADATA_BYTES = 1024 * 1024;
const TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES = 8 * 1024 * 1024;
export const TYPECHECK_BENCHMARK_BUDGETS = Object.freeze({
  noise: Object.freeze({ durationMadRelative: 0.05, peakRssMadRelative: 0.05 }),
  durationMedian: Object.freeze({ absoluteMs: 250, relative: 0.05 }),
  durationP75: Object.freeze({ absoluteMs: 250, relative: 0.10 }),
  rssP95: Object.freeze({ absoluteBytes: 128 * 1024 * 1024, relative: 0.15 }),
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digestFile = async (file) => sha256(await readFile(file));
const exists = async (file) => stat(file).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const inside = (child, root) => { const relative = path.relative(root, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WINDOWS_COMPILER_GATE = String.raw`
const { spawn } = require('node:child_process');
let compilerComplete = false;
let released = false;
const release = () => { if (compilerComplete && released) process.exit(0); };
process.on('message', (message) => {
  if (message?.control === 'start' && !compilerComplete) {
    const started = process.hrtime.bigint();
    const compiler = spawn(process.execPath, [message.entrypoint, ...message.args], { cwd: message.cwd, env: message.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    compiler.stdout.pipe(process.stdout);
    compiler.stderr.pipe(process.stderr);
    compiler.on('error', () => process.send?.({ control: 'compiler-start-failed' }));
    compiler.on('close', (code, signal) => {
      compilerComplete = true;
      process.send?.({ control: 'compiler-complete', durationMs: Number(process.hrtime.bigint() - started) / 1e6, code: code ?? 1, signal });
      release();
    });
  } else if (message?.control === 'release') {
    released = true;
    release();
  }
});
`;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!value) throw new Error('A benchmark argument is missing its value');
    if (key === '--profile') result.profile = value;
    else if (key === '--platform') result.platform = value;
    else if (key === '--installer') result.installer = value;
    else if (key === '--release-id') result.releaseId = value;
    else if (key === '--output') result.output = path.resolve(value);
    else throw new Error('Unknown benchmark argument');
  }
  if (!/^(?:ubuntu|windows)-(?:npm|bun)$/.test(result.profile ?? '')) throw new Error('--profile is required and must be ubuntu-npm, ubuntu-bun, windows-npm, or windows-bun');
  result.installer ??= result.profile.endsWith('-bun') ? 'bun' : 'npm'; result.platform ??= `${process.platform}-${process.arch}`; result.releaseId ??= process.env.RELEASE_ID;
  if (!['npm', 'bun'].includes(result.installer) || !/^[a-f0-9]{40}$/.test(result.releaseId ?? '')) throw new Error('Installer or --release-id is invalid');
  if (!/^v24\./.test(process.version) || process.arch !== 'x64') throw new Error('Benchmark requires Node 24 x64');
  const expectedPlatform = result.profile.startsWith('windows-') ? 'win32-x64' : 'linux-x64';
  if (result.platform !== expectedPlatform || `${process.platform}-${process.arch}` !== expectedPlatform || !result.profile.endsWith(`-${result.installer}`)) throw new Error('Profile, installer, and host disagree');
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (result.installer === 'bun' ? !/^bun\/1\.2\.16(?:\s|$)/.test(userAgent) : !/^npm\/11\.6\.2(?:\s|$)/.test(userAgent)) throw new Error(`Installer user-agent evidence does not match ${result.installer}`);
  result.output ??= path.join(process.env.RUNNER_TEMP || tmpdir(), 'ts7-release', result.releaseId, result.profile, 'report.json');
  if (path.basename(result.output) !== 'report.json' || inside(result.output, REPO_ROOT)) throw new Error('Output must be an external report.json');
  return { ...result, userAgent };
}

function runProcess(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: APP_ROOT, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk)); child.stderr.on('data', (chunk) => stderr.push(chunk)); child.on('error', reject);
    child.on('close', (code, signal) => resolve({ child, code: code ?? 1, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
  });
}
async function gitRead(args) { const result = await runProcess('git', args); if (result.code !== 0 || result.signal || result.stderr.trim()) throw new Error('Git provenance read failed'); return result.stdout.trim(); }
async function cleanProvenance(releaseId) {
  const [topLevel, commit, tree, status] = await Promise.all([gitRead(['rev-parse', '--show-toplevel']), gitRead(['rev-parse', 'HEAD']), gitRead(['rev-parse', 'HEAD^{tree}']), gitRead(['status', '--porcelain=v1', '--untracked-files=all'])]);
  if (await realpath(topLevel) !== await realpath(REPO_ROOT) || !/^[a-f0-9]{40}$/.test(commit) || tree !== releaseId || status) throw new Error('Repository provenance is not the requested clean release tree');
  return { repositoryTopLevelSha256: sha256(await realpath(topLevel)), headCommit: commit, headTree: tree, provenanceSha256: sha256(`${await realpath(topLevel)}\n${commit}\n${tree}\n${status}`) };
}
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function nearestRank(values, quantile) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]; }
function mad(values) { const center = median(values); return median(values.map((value) => Math.abs(value - center))); }
function stats(values) { if (!values.length || values.some((value) => !finite(value))) throw new Error('Derived statistics require finite samples'); return { count: values.length, median: median(values), mad: mad(values), p75: nearestRank(values, .75), p95NearestRank: nearestRank(values, .95), min: Math.min(...values), max: Math.max(...values) }; }
function seededOrder(releaseId, samples) { const offset = createHash('sha256').update(releaseId).digest()[0] % 2; return Array.from({ length: samples * 2 }, (_, index) => (index + offset) % 2 === 0 ? 'native' : 'compat'); }
function normalizeOutput(value) { return value.replaceAll('\\', '/').replaceAll(APP_ROOT.replaceAll('\\', '/'), '<app>').replace(/\r\n/g, '\n').trim(); }
function compilerEnvironment(base, directory) { return { ...base, TMP: path.join(directory, 'tmp'), TEMP: path.join(directory, 'tmp'), TMPDIR: path.join(directory, 'tmp'), XDG_CACHE_HOME: path.join(directory, 'xdg'), npm_config_cache: path.join(directory, 'npm'), BUN_INSTALL_CACHE_DIR: path.join(directory, 'bun') }; }
function noiseBreaches(profiles) {
  const breaches = [];
  for (const [kind, profile] of Object.entries(profiles)) {
    if (profile.durationMs.mad > profile.durationMs.median * TYPECHECK_BENCHMARK_BUDGETS.noise.durationMadRelative) breaches.push(`${kind}.durationMs`);
    if (profile.peakRssBytes.mad > profile.peakRssBytes.median * TYPECHECK_BENCHMARK_BUDGETS.noise.peakRssMadRelative) breaches.push(`${kind}.peakRssBytes`);
  }
  return breaches;
}
function isNoisy(profiles) { return noiseBreaches(profiles).length > 0; }
function validateSummary(summary, kind, attempt) { if (!summary || summary.schemaVersion !== 2 || summary.valid !== true || summary.terminalObserved !== true || !Array.isArray(summary.invalidReasons) || summary.invalidReasons.length || summary.requestedIntervalMs !== 10 || summary.maximumAllowedGapMs !== 60 || !Number.isInteger(summary.samples) || summary.samples < 3 || !finite(summary.peakRssBytes) || !finite(summary.maximumGapMs) || summary.maximumGapMs > 60 || !Number.isInteger(summary.rootPid) || !/^\d+$/.test(String(summary.rootStartIdentity))) throw new Error(`Invalid sampler summary for ${kind} attempt ${attempt}`); }
const SAMPLER_FAILURE_REASONS = new Set(['exited-child-record', 'host-memory-pressure', 'inaccessible-child-record', 'inaccessible-root-record', 'malformed-process-identity', 'missing-root-identity', 'process-identity-reused', 'root-identity-reused', 'sampling-gap-exceeded']);
const SAMPLE_OUTCOME_FAILURE_CODES = new Set(['TYPECHECK_COMPILER_EVIDENCE_INVALID', 'TYPECHECK_COMPILER_GATE_PROTOCOL', 'TYPECHECK_COMPILER_START_FAILED', 'TYPECHECK_SAMPLER_EVIDENCE_PROTOCOL', 'TYPECHECK_SAMPLER_EVIDENCE_RELEASE_FAILED', 'TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT', 'TYPECHECK_SAMPLER_INCOMPLETE', 'TYPECHECK_SAMPLER_JSON_INVALID', 'TYPECHECK_SAMPLER_PREMATURE_EXIT', 'TYPECHECK_SAMPLER_READY_PROTOCOL', 'TYPECHECK_SAMPLER_READY_TIMEOUT', 'TYPECHECK_SAMPLER_START_FAILED', 'TYPECHECK_SAMPLER_SUMMARY_INVALID', 'TYPECHECK_SAMPLER_SUMMARY_PROTOCOL']);
const sampleOutcomeFailureCode = (error) => SAMPLE_OUTCOME_FAILURE_CODES.has(error?.code) ? error.code : 'TYPECHECK_BENCHMARK_FAILURE';
function normalizedFailureReasons(reasons) {
  if (!Array.isArray(reasons)) return [];
  return [...new Set(reasons.map((reason) => typeof reason !== 'string' ? null : reason.startsWith('inaccessible-root-record:') ? 'inaccessible-root-record' : reason).filter((reason) => SAMPLER_FAILURE_REASONS.has(reason)))].sort();
}
async function samplerFailureReceipt(evidence) {
  let maximumHostPressurePercent = null;
  if (evidence?.rawOutput && await exists(evidence.rawOutput)) {
    try {
      const rows = (await readFile(evidence.rawOutput, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const pressures = rows.map((row) => row.hostPressurePercent).filter(finite);
      if (pressures.length) maximumHostPressurePercent = Math.max(...pressures);
    } catch {}
  }
  const summary = evidence?.summary;
  return {
    code: Number.isInteger(evidence?.code) ? evidence.code : null,
    signal: typeof evidence?.signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(evidence.signal) ? evidence.signal : null,
    errorCode: typeof evidence?.errorCode === 'string' && /^RSS_SAMPLER_[A-Z_]+$/.test(evidence.errorCode) ? evidence.errorCode : null,
    summaryPresent: Boolean(summary),
    invalidReasons: normalizedFailureReasons(summary?.invalidReasons),
    samples: Number.isInteger(summary?.samples) ? summary.samples : null,
    maximumGapMs: finite(summary?.maximumGapMs) ? summary.maximumGapMs : null,
    maximumHostPressurePercent,
    evidenceTimeout: evidence?.timeoutDiagnostic ?? null,
  };
}
async function failureReceipt(error) {
  const lastFailure = error?.lastFailure ?? error?.cause?.lastFailure;
  return {
    schemaVersion: 2,
    status: 'failed',
    failureCode: typeof error?.code === 'string' && /^TYPECHECK_[A-Z_]+$/.test(error.code) ? error.code : 'TYPECHECK_BENCHMARK_FAILURE',
    sampler: await samplerFailureReceipt(error?.samplerEvidence),
    lastFailure: lastFailure ? {
      position: lastFailure.position,
      retry: lastFailure.retry,
      kind: lastFailure.kind,
      failureCode: lastFailure.failureCode,
      sampler: await samplerFailureReceipt(lastFailure.samplerEvidence),
    } : null,
  };
}

async function validateRawOutput(rawOutput, summary) {
  const rows = (await readFile(rawOutput, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (rows.length !== summary.samples) throw new Error('Sampler raw sample count does not match summary');
  let previous = -1; let peak = 0; let maximumGap = 0;
  for (const row of rows) {
    if (!finite(row.monotonicMs) || row.monotonicMs < previous || !finite(row.observedGapMs) || row.observedGapMs < 0 || row.observedGapMs > 60 || !finite(row.includedRssBytes) || row.includedRssBytes < 0 || !finite(row.hostPressurePercent) || row.hostPressurePercent > 80 || !Array.isArray(row.processes) || !row.processes.some((item) => item.pid === summary.rootPid && String(item.startIdentity) === String(summary.rootStartIdentity)) || row.rootIdentity !== String(summary.rootStartIdentity) || !Array.isArray(row.errors) || row.errors.length) throw new Error('Sampler raw evidence violates numeric, identity, gap, pressure, or collector invariants');
    const includedSum = row.processes.filter((item) => /^\d+$/.test(String(item.startIdentity)) && BigInt(item.startIdentity) >= BigInt(summary.rootStartIdentity)).reduce((sum, item) => sum + item.rssBytes, 0);
    if (!Number.isSafeInteger(includedSum) || includedSum !== row.includedRssBytes) throw new Error('Sampler raw included RSS does not match process rows');
    previous = row.monotonicMs; peak = Math.max(peak, row.includedRssBytes); maximumGap = Math.max(maximumGap, row.observedGapMs);
  }
  if (peak !== summary.peakRssBytes || maximumGap !== summary.maximumGapMs || summary.terminalObserved !== true) throw new Error('Sampler raw aggregates or terminal identity disagree with summary');
}
async function terminateAndWait(child) { if (!child || child.exitCode !== null || child.signalCode !== null) return; child.kill(); await Promise.race([new Promise((resolve) => child.once('close', resolve)), delay(10_000).then(() => { throw new Error('Process teardown timed out'); })]); }
function runCompiler(kind, profile, rawOutput, attempt) {
  const compiler = COMPILERS[kind];
  return new Promise((resolve, reject) => {
    const usesWindowsGate = process.platform === 'win32';
    let ready = false; let compilerStarted = false; let compilerTriggered = false; let samplesAtCompilerStart = 0; let gateReleaseRequested = false; let settled = false; let child; let compilerResult; let samplerResult; let summary; let pending = ''; let sampler; let recordedSamples = 0; let evidenceTimer; let samplerStderr = ''; let samplerStdoutBytes = 0; let samplerStderrBytes = 0; let compilerStdoutBytes = 0; let compilerStderrBytes = 0; let lastControlFrame = null; let evidenceStartedAt = null;
    const cleanup = async () => { clearTimeout(evidenceTimer); await Promise.all([terminateAndWait(child), terminateAndWait(sampler)]); };
    const samplerEvidence = () => ({
      code: samplerResult?.code ?? null,
      signal: samplerResult?.signal ?? null,
      errorCode: samplerResult?.errorCode ?? null,
      summary,
      rawOutput,
      timeoutDiagnostic: evidenceStartedAt === null ? null : {
        sampler: { pid: Number.isInteger(sampler?.pid) ? sampler.pid : null, running: sampler?.exitCode === null && sampler?.signalCode === null, stdoutBytes: samplerStdoutBytes, stderrBytes: samplerStderrBytes },
        root: { pid: Number.isInteger(child?.pid) ? child.pid : null, running: child?.exitCode === null && child?.signalCode === null, stdoutBytes: compilerStdoutBytes, stderrBytes: compilerStderrBytes },
        recordedSamples,
        lastControlFrame,
        elapsedMs: Math.floor(Number(process.hrtime.bigint() - evidenceStartedAt) / 1e6),
        remainingBudgetMs: Math.max(0, WINDOWS_COMPILER_EVIDENCE_TIMEOUT_MS - Math.floor(Number(process.hrtime.bigint() - evidenceStartedAt) / 1e6)),
      },
    });
    const fail = async (message, code, evidence = null) => {
      if (settled) return;
      settled = true;
      try {
        await cleanup();
      } catch {
        message += '; process teardown failed';
      }
      const error = new Error(message);
      error.code = code;
      error.samplerEvidence = evidence;
      reject(error);
    };
    const complete = async () => {
      if (settled || !compilerResult || !samplerResult) return;
      if (!ready || !summary) {
        return fail(`Sampler protocol was incomplete for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_INCOMPLETE', samplerEvidence());
      }
      try {
        validateSummary(summary, kind, attempt);
      } catch {
        return fail(`Sampler summary was invalid for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_SUMMARY_INVALID', samplerEvidence());
      }
      if (samplerResult.code !== 0 || samplerResult.signal) {
        return fail(`Sampler exited without clean evidence for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_INCOMPLETE', samplerEvidence());
      }
      settled = true;
      clearTimeout(evidenceTimer);
      resolve({ kind, ...compilerResult, samplerCode: samplerResult.code, samplerSignal: samplerResult.signal, samplerSummary: { ...summary, output: path.basename(summary.output) }, rawOutput });
    };
    const releaseWindowsGate = () => {
      if (!usesWindowsGate || gateReleaseRequested || !compilerResult || recordedSamples < samplesAtCompilerStart + 3 || !child.connected) return;
      gateReleaseRequested = true;
      child.send({ control: 'release' }, (error) => {
        if (error) fail(`Compiler gate release failed for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_EVIDENCE_RELEASE_FAILED');
      });
    };
    const triggerCompiler = () => {
      if (!usesWindowsGate || compilerTriggered || recordedSamples < 3) return;
      compilerTriggered = true; samplesAtCompilerStart = recordedSamples;
      child.send({ control: 'start', entrypoint: compiler.entrypoint, args: compiler.args, cwd: APP_ROOT, env: profile.env }, (error) => {
        if (error) fail(`Compiler failed to start for ${kind} attempt ${attempt}`, 'TYPECHECK_COMPILER_START_FAILED');
      });
    };
    const startCompiler = () => {
      compilerStarted = true;
      const stdout = []; const stderr = [];
      if (usesWindowsGate) {
        child = spawn(process.execPath, ['-e', WINDOWS_COMPILER_GATE], { cwd: APP_ROOT, env: profile.env, shell: false, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
        child.on('message', (message) => {
          if (message?.control === 'compiler-start-failed') return fail(`Compiler failed to start for ${kind} attempt ${attempt}`, 'TYPECHECK_COMPILER_START_FAILED');
          if (message?.control !== 'compiler-complete' || compilerResult || !finite(message.durationMs)) return fail(`Compiler gate protocol failed for ${kind} attempt ${attempt}`, 'TYPECHECK_COMPILER_GATE_PROTOCOL');
          compilerResult = { durationMs: message.durationMs, code: message.code ?? 1, signal: message.signal ?? null, stdout: normalizeOutput(Buffer.concat(stdout).toString('utf8')), stderr: normalizeOutput(Buffer.concat(stderr).toString('utf8')) };
          releaseWindowsGate();
          complete();
        });
      } else {
        const started = process.hrtime.bigint();
        child = spawn(process.execPath, [compiler.entrypoint, ...compiler.args], { cwd: APP_ROOT, env: profile.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.on('close', (code, signal) => { compilerResult = { durationMs: Number(process.hrtime.bigint() - started) / 1e6, code: code ?? 1, signal, stdout: normalizeOutput(Buffer.concat(stdout).toString('utf8')), stderr: normalizeOutput(Buffer.concat(stderr).toString('utf8')) }; complete(); });
      }
      child.stdout.on('data', (chunk) => { stdout.push(chunk); compilerStdoutBytes += chunk.length; });
      child.stderr.on('data', (chunk) => { stderr.push(chunk); compilerStderrBytes += chunk.length; });
      child.on('error', () => fail(`Compiler failed to start for ${kind} attempt ${attempt}`, 'TYPECHECK_COMPILER_START_FAILED'));
      sampler.stdin.end(`${JSON.stringify({ rootPid: child.pid, runKind: kind, attempt })}\n`);
      if (usesWindowsGate) { evidenceStartedAt = process.hrtime.bigint(); evidenceTimer = setTimeout(() => fail(`Sampler did not retain root-identity evidence through compiler completion for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT', samplerEvidence()), WINDOWS_COMPILER_EVIDENCE_TIMEOUT_MS); }
    };
    const readyTimer = setTimeout(() => fail(`Sampler readiness timed out for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_READY_TIMEOUT'), 30_000);
    sampler = spawn(process.execPath, [SAMPLER, '--output', rawOutput, '--interval-ms', '10'], { cwd: APP_ROOT, env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    sampler.stdout.setEncoding('utf8'); sampler.stdout.on('data', (chunk) => { samplerStdoutBytes += Buffer.byteLength(chunk); pending += chunk; for (;;) { const newline = pending.indexOf('\n'); if (newline < 0) break; const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1); if (!line) continue; try { const message = JSON.parse(line); lastControlFrame = typeof message.control === 'string' ? message.control : 'summary'; if (message.control === 'ready' && message.schemaVersion === 1) { if (ready || compilerStarted) return fail(`Sampler readiness protocol failed for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_READY_PROTOCOL'); ready = true; clearTimeout(readyTimer); startCompiler(); } else if (message.control === 'sample' && message.schemaVersion === 1) { if (!usesWindowsGate || !ready || !compilerStarted || !Number.isInteger(message.samples) || message.samples !== recordedSamples + 1) return fail(`Sampler evidence protocol failed for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_EVIDENCE_PROTOCOL'); recordedSamples = message.samples; triggerCompiler(); releaseWindowsGate(); } else if (!ready || !compilerStarted || summary) return fail(`Sampler summary protocol failed for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_SUMMARY_PROTOCOL'); else summary = message; } catch { fail(`Sampler emitted malformed JSON for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_JSON_INVALID'); } } });
    sampler.stderr.setEncoding('utf8'); sampler.stderr.on('data', (chunk) => { samplerStderrBytes += Buffer.byteLength(chunk); samplerStderr = `${samplerStderr}${chunk}`.slice(-4096); });
    sampler.on('error', () => fail(`Sampler failed to start for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_START_FAILED')); sampler.on('close', (code, signal) => { const errorCode = /(?:^|\s)code=(RSS_SAMPLER_[A-Z_]+)(?:\s|$)/.exec(samplerStderr)?.[1] ?? null; samplerResult = { code: code ?? 1, signal, errorCode }; if (!compilerStarted) fail(`Sampler exited before readiness for ${kind} attempt ${attempt}`, 'TYPECHECK_SAMPLER_PREMATURE_EXIT'); else complete(); });
  });
}
function sampleFailure(position, retry, kind, error) {
  const lastFailure = {
    position,
    retry,
    kind,
    failureCode: typeof error?.code === 'string' && /^TYPECHECK_[A-Z_]+$/.test(error.code) ? error.code : 'TYPECHECK_BENCHMARK_FAILURE',
    samplerEvidence: error?.samplerEvidence ?? null,
  };
  return new Error('Benchmark samples failed', {
    cause: { lastFailure },
  });
}
function mustAbortSampleRetries(error) {
  return error?.code === 'TYPECHECK_SAMPLER_EVIDENCE_TIMEOUT';
}
function profileStats(runs) { return Object.fromEntries(['native', 'compat'].map((kind) => { const selected = runs.filter((run) => run.kind === kind); return [kind, { durationMs: stats(selected.map((run) => run.durationMs)), peakRssBytes: stats(selected.map((run) => run.samplerSummary.peakRssBytes)) }]; })); }
function independentNoiseWindows(runs) {
  const byKind = Object.fromEntries(['native', 'compat'].map((kind) => [kind, runs.filter((run) => run.kind === kind)]));
  if (byKind.native.length !== 9 || byKind.compat.length !== 9) return [];
  return Array.from({ length: 3 }, (_, index) => {
    const windowRuns = ['native', 'compat'].flatMap((kind) => byKind[kind].slice(index * 3, index * 3 + 3));
    return { index: index + 1, samplesPerCompiler: 3, breaches: noiseBreaches(profileStats(windowRuns)) };
  });
}
export function buildBenchmarkDecision(runs, initialNoise) {
  const measured = profileStats(runs);
  const aggregateBreaches = noiseBreaches(measured);
  const independentWindows = independentNoiseWindows(runs);
  const persistentBreaches = independentWindows.length === 3
    ? aggregateBreaches.filter((breach) => independentWindows.every((window) => window.breaches.includes(breach)))
    : [];
  const persistentNoise = aggregateBreaches.length > 0 && persistentBreaches.length > 0;
  const durationMedianDelta = measured.native.durationMs.median - measured.compat.durationMs.median;
  const durationP75Delta = measured.native.durationMs.p75 - measured.compat.durationMs.p75;
  const rssDelta = measured.native.peakRssBytes.p95NearestRank - measured.compat.peakRssBytes.p95NearestRank;
  const durationMedianRegression = durationMedianDelta > TYPECHECK_BENCHMARK_BUDGETS.durationMedian.absoluteMs && durationMedianDelta / measured.compat.durationMs.median > TYPECHECK_BENCHMARK_BUDGETS.durationMedian.relative;
  const durationP75Regression = durationP75Delta > TYPECHECK_BENCHMARK_BUDGETS.durationP75.absoluteMs && durationP75Delta / measured.compat.durationMs.p75 > TYPECHECK_BENCHMARK_BUDGETS.durationP75.relative;
  const durationRegression = durationMedianRegression || durationP75Regression;
  const rssRegression = rssDelta > TYPECHECK_BENCHMARK_BUDGETS.rssP95.absoluteBytes && rssDelta / measured.compat.peakRssBytes.p95NearestRank > TYPECHECK_BENCHMARK_BUDGETS.rssP95.relative;
  const speedupMs = measured.compat.durationMs.median - measured.native.durationMs.median;
  const speedupRatio = speedupMs / measured.compat.durationMs.median;
  const pooledMad = median(runs.map((run) => Math.abs(run.durationMs - measured[run.kind].durationMs.median)));
  const noiseEvidenceValid = aggregateBreaches.length === 0 || persistentNoise;
  const acceptancePassed = !durationRegression && !rssRegression && noiseEvidenceValid;
  return {
    measured,
    evidenceDecision: {
      status: persistentNoise ? 'inconclusive_noise' : aggregateBreaches.length > 0 ? 'invalid_noise' : 'conclusive',
      reason: persistentNoise ? 'noise_budget_exceeded_after_bounded_samples' : aggregateBreaches.length > 0 ? 'noise_not_reproduced_across_disjoint_windows' : null,
      totalSlices: 2,
      admittedSlices: aggregateBreaches.length > 0 ? 0 : 2,
      boundedSamplesPerCompiler: measured.native.durationMs.count,
      performanceClaimsAllowed: aggregateBreaches.length === 0 && acceptancePassed,
      cachePublished: false,
      aggregateBreaches,
      independentWindows,
      persistentBreaches,
    },
    comparison: {
      durationMedianDelta,
      durationP75Delta,
      rssP95Delta: rssDelta,
      durationMedianRegression,
      durationP75Regression,
      rssRegression,
      positiveSpeedClaimProfileEvidence: {
        speedupMs,
        speedupRatio,
        pooledMad,
        eligible: aggregateBreaches.length === 0 && acceptancePassed && speedupMs >= 200 && speedupRatio >= 0.10 && speedupMs >= 2 * pooledMad,
      },
    },
    acceptance: { durationRegression, rssRegression, passed: acceptancePassed },
    initialNoise,
  };
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
async function assertPublicationBoundary(stage, rawNames) {
  const expected = ['attempt-outcomes.json', 'preflight-receipts.json', 'raw/', 'report.json', ...rawNames.map((name) => `raw/${name}`)].sort();
  const actual = await publicationEntries(stage);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Benchmark publication boundary does not match the exact allowlist');
  const sizes = await Promise.all(actual.filter((entry) => !entry.endsWith('/')).map(async (file) => {
    const size = (await stat(path.join(stage, file))).size;
    const raw = file.startsWith('raw/');
    const maximum = raw ? TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES : TYPECHECK_BENCHMARK_MAX_METADATA_BYTES;
    if ((!raw && size <= 0) || size > maximum) throw new Error('Benchmark publication file size is outside its bound');
    return size;
  }));
  if (sizes.reduce((sum, size) => sum + size, 0) > TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES) throw new Error('Benchmark publication exceeds the aggregate size bound');
}
async function preflight(stage) { const verify = await runProcess(process.execPath, [VERIFY]); const parity = await runProcess(process.execPath, [PARITY, 'parity']); const verification = JSON.parse(normalizeOutput(verify.stdout)); const parityReceipt = JSON.parse(normalizeOutput(parity.stdout)); if (verify.code || verify.signal || verify.stderr.trim() || parity.code || parity.signal || parity.stderr.trim() || verification.status !== 'passed' || parityReceipt.status !== 'passed' || parityReceipt.diagnostics !== 0) throw new Error('Toolchain verification or parity failed'); const receipts = { verification: { sha256: sha256(normalizeOutput(verify.stdout)), value: verification }, parity: { sha256: sha256(normalizeOutput(parity.stdout)), value: parityReceipt } }; await writeFile(path.join(stage, 'preflight-receipts.json'), `${JSON.stringify(receipts, null, 2)}\n`, { flag: 'wx' }); return receipts; }
async function main() {
  const options = parseArgs(process.argv.slice(2)); const publicationDirectory = path.dirname(options.output); const publicationParent = path.dirname(publicationDirectory); const stage = path.join(publicationParent, `.${path.basename(publicationDirectory)}.stage-${randomUUID()}`);
  if (await exists(publicationDirectory) || await exists(options.output)) throw new Error('Publication directory must not already exist'); await mkdir(publicationParent, { recursive: true }); if (inside(await realpath(publicationParent), await realpath(REPO_ROOT))) throw new Error('Benchmark output resolved inside the repository'); await mkdir(stage);
  let failureStage = 'INITIALIZATION';
  try {
    failureStage = 'PROVENANCE';
    const provenance = await cleanProvenance(options.releaseId);
    failureStage = 'PREFLIGHT';
    const receipts = await preflight(stage);
    const rawDirectory = path.join(stage, 'raw');
    const cacheRoot = path.join(stage, 'cache');
    await mkdir(rawDirectory);
    const profiles = Object.fromEntries(await Promise.all(Object.keys(COMPILERS).map(async (kind) => { const cacheDirectory = path.join(cacheRoot, kind); const env = compilerEnvironment({ ...process.env, LC_ALL: 'C', LANG: 'C' }, cacheDirectory); await mkdir(env.TMP, { recursive: true }); return [kind, { env, cacheDirectory }]; })));
    const outcomes = []; const warmups = []; const runs = []; const invalidRuns = { native: 0, compat: 0 };
    for (const kind of ['native', 'compat']) {
      const stageKind = kind.toUpperCase();
      failureStage = `WARMUP_${stageKind}_RUN`;
      const rawOutput = path.join(rawDirectory, `warmup-${kind}.ndjson`);
      const result = await runCompiler(kind, profiles[kind], rawOutput, 0);
      failureStage = `WARMUP_${stageKind}_RAW`;
      await validateRawOutput(rawOutput, result.samplerSummary);
      failureStage = `WARMUP_${stageKind}_COMPILER`;
      if (result.code || result.signal || result.stdout || result.stderr) throw new Error(`${kind} warm-up failed`);
      const rawSha256 = await digestFile(rawOutput);
      outcomes.push({ phase: 'warmup', kind, durationMs: result.durationMs, rawOutput: path.basename(rawOutput), rawSha256, summary: result.samplerSummary });
      warmups.push({ kind, durationMs: result.durationMs, rawSha256 });
    }
    failureStage = 'SAMPLES';
    async function executeSamples(sampleCount) {
      const sequence = seededOrder(options.releaseId, sampleCount);
      for (let position = runs.length; position < sequence.length; position += 1) {
        const kind = sequence[position];
        let accepted;
        let lastError = null;
        for (let retry = 0; retry <= 2; retry += 1) {
          const rawOutput = path.join(rawDirectory, `${String(position + 1).padStart(2, '0')}-${kind}-attempt-${retry + 1}.ndjson`);
          try {
            const result = await runCompiler(kind, profiles[kind], rawOutput, retry + 1);
            await validateRawOutput(rawOutput, result.samplerSummary);
            const valid = result.code === 0 && !result.signal && !result.stdout && !result.stderr && result.samplerCode === 0 && !result.samplerSignal;
            const rawSha256 = await digestFile(rawOutput);
            outcomes.push({ phase: 'measured', position: position + 1, retry: retry + 1, kind, accepted: valid, durationMs: result.durationMs, rawOutput: path.basename(rawOutput), rawSha256, summary: result.samplerSummary, failure: valid ? null : 'TYPECHECK_COMPILER_EVIDENCE_INVALID' });
            if (valid) {
              accepted = { position: position + 1, retry: retry + 1, ...result, rawSha256 };
              break;
            }
            lastError = Object.assign(new Error('Compiler evidence was not clean'), { code: 'TYPECHECK_COMPILER_EVIDENCE_INVALID' });
          } catch (error) {
            lastError = error;
            outcomes.push({ phase: 'measured', position: position + 1, retry: retry + 1, kind, accepted: false, rawOutput: path.basename(rawOutput), rawSha256: await exists(rawOutput) ? await digestFile(rawOutput) : null, failure: sampleOutcomeFailureCode(error) });
          }
          invalidRuns[kind] += 1;
          if (mustAbortSampleRetries(lastError) || invalidRuns[kind] > 3) throw sampleFailure(position + 1, retry + 1, kind, lastError);
        }
        if (!accepted) throw sampleFailure(position + 1, 3, kind, lastError);
        runs.push(accepted);
      }
      return sequence;
    }
    let sequence = await executeSamples(7); let measured = profileStats(runs); const initialNoise = isNoisy(measured); if (initialNoise) { sequence = await executeSamples(9); measured = profileStats(runs); }
    await writeFile(path.join(stage, 'attempt-outcomes.json'), `${JSON.stringify(outcomes, null, 2)}\n`, { flag: 'wx' }); const outcomeSha256 = await digestFile(path.join(stage, 'attempt-outcomes.json'));
    const decision = buildBenchmarkDecision(runs, initialNoise);
    measured = decision.measured;
    const preflightSha256 = await digestFile(path.join(stage, 'preflight-receipts.json'));
    const report = {
      schemaVersion: 4,
      releaseId: options.releaseId,
      candidate: {
        tree: options.releaseId,
        ...provenance,
        platform: options.platform,
        installer: options.installer,
        profile: options.profile,
        node: process.version,
        arch: process.arch,
        installerUserAgentSha256: sha256(options.userAgent),
      },
      receipts,
      contracts: {
        requestedSamplerCadenceMs: 10,
        maximumObservedGapMs: 60,
        hostPressureMaximumPercent: 80,
        retryCapPerPosition: 2,
        invalidRunCapPerCompiler: 3,
        publication: 'atomic-directory-rename',
        publicationMaximumBytes: TYPECHECK_BENCHMARK_MAX_PUBLICATION_BYTES,
        metadataMaximumBytes: TYPECHECK_BENCHMARK_MAX_METADATA_BYTES,
        rawFileMaximumBytes: TYPECHECK_BENCHMARK_MAX_RAW_FILE_BYTES,
        rawRowMaximum: 20_000,
        budgets: TYPECHECK_BENCHMARK_BUDGETS,
      },
      warmups,
      sequence,
      initialNoise: decision.initialNoise,
      invalidRuns,
      runs: runs.map((run) => ({
        position: run.position,
        retry: run.retry,
        kind: run.kind,
        durationMs: run.durationMs,
        peakRssBytes: run.samplerSummary.peakRssBytes,
        samples: run.samplerSummary.samples,
        maximumGapMs: run.samplerSummary.maximumGapMs,
        rawOutput: path.basename(run.rawOutput),
        rawSha256: run.rawSha256,
      })),
      rawEvidence: {
        preflight: 'preflight-receipts.json',
        preflightSha256,
        outcomes: 'attempt-outcomes.json',
        outcomesSha256: outcomeSha256,
        attempts: outcomes.map(({ rawOutput, rawSha256 }) => ({ rawOutput, rawSha256 })),
      },
      profiles: measured,
      evidenceDecision: decision.evidenceDecision,
      comparison: decision.comparison,
      acceptance: {
        diagnosticsEqual: receipts.parity.value.diagnostics === 0,
        toolchainVerified: receipts.verification.value.status === 'passed',
        ...decision.acceptance,
      },
    };
    await writeFile(path.join(stage, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    await rm(cacheRoot, { recursive: true, force: true });
    await assertPublicationBoundary(stage, outcomes.filter((outcome) => outcome.rawSha256 !== null).map((outcome) => outcome.rawOutput));
    if (await exists(publicationDirectory)) throw new Error('Publication destination appeared during staging'); await rename(stage, publicationDirectory); process.stdout.write(`${JSON.stringify({ status: report.acceptance.passed ? report.evidenceDecision.status : 'failed', output: path.basename(options.output), profiles: measured })}\n`); if (!report.acceptance.passed) process.exitCode = 1;
  } catch (error) {
    if (error instanceof Error && !error.code) error.code = `TYPECHECK_BENCHMARK_${failureStage}`;
    await mkdir(publicationDirectory, { recursive: true });
    await writeFile(path.join(publicationDirectory, 'failure-receipt.json'), `${JSON.stringify(await failureReceipt(error), null, 2)}\n`, { flag: 'wx' });
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('measure-typecheck: ');
    logCliError(error);
    process.exitCode = 1;
  });
}
