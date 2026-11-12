import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECK_NAMES, EXPECTED_ARTIFACT_SHA256, MAX_ARTIFACT_BYTES, PROFILE, RECEIPT_SCHEMA, TOTAL_BUDGET_MS, validBranch, validateReceipt } from '../cloudflare/worker.mjs';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = /^(?!0{40}$)[a-f0-9]{40}$/;
const UUID = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CLEANUP_MS = 200;
const CAPTURE_BYTES = 128 * 1024;
export const GENERATED_ENTRY_SOURCE = "import { createWorker } from '../worker.mjs';\nimport receipt from './receipt.json' with { type: 'json' };\nimport artifact from './artifact.mjs';\nexport default createWorker(receipt, artifact);\n";
export class GovernanceError extends Error {
  constructor(code) { super(`cloudflare governance: ${code}`); this.code = code; }
}
const fail = (code) => { throw new GovernanceError(code); };

// Do not inherit deploy credentials, provider/admin secrets, NODE_OPTIONS,
// PYTHONPATH, git command overrides, or arbitrary CI command configuration.
export function childEnvironment(source, identity, artifactDirectory) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'USER', 'LOGNAME', 'XDG_CACHE_HOME', 'BUN_INSTALL', 'BUN_INSTALL_CACHE_DIR']) {
    if (typeof source[key] === 'string') result[key] = source[key];
  }
  Object.assign(result, { CI: 'true', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', PYTHONDONTWRITEBYTECODE: '1' });
  if (identity?.provider === 'cloudflare-workers-builds') Object.assign(result, {
    WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: identity.commit, WORKERS_CI_BRANCH: identity.branch, WORKERS_CI_BUILD_UUID: identity.buildId,
  });
  if (artifactDirectory) result.GOVERNANCE_CI_OUTPUT_DIR = artifactDirectory;
  return result;
}

// Every child gets a process group. Even a successful leader may leave a child
// behind, so TERM/KILL cleanup runs on every exit as well as timeout/abort.
export async function runCommand({ command, args = [], cwd, env, timeoutMs, deadline = Infinity, signal, capture = false, acceptedExitCodes = [0] }) {
  if (process.platform === 'win32') fail('POSIX_PROCESS_GROUPS_REQUIRED');
  if (signal?.aborted) fail('INTERRUPTED');
  const available = Math.min(timeoutMs, deadline - performance.now() - CLEANUP_MS);
  if (!(available > 0)) fail('TOTAL_TIMEOUT');
  const started = performance.now();
  return new Promise((resolveCommand, rejectCommand) => {
    let child;
    let reason;
    let finished = false;
    let cleanupTimer;
    let commandTimer;
    let output = '';
    let outputBytes = 0;
    let exitCode;
    const groupSignal = (kind) => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, kind); } catch (error) { if (error.code !== 'ESRCH') reason ??= 'PROCESS_CLEANUP_FAILED'; }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(commandTimer);
      clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort', abort);
      if (reason) rejectCommand(new GovernanceError(reason));
      else if (!acceptedExitCodes.includes(exitCode)) rejectCommand(new GovernanceError('COMMAND_FAILED'));
      else resolveCommand({ exitCode, stdout: output, durationMs: Math.ceil(performance.now() - started) });
    };
    const cleanup = (failure) => {
      if (failure) reason ??= failure;
      if (finished || cleanupTimer) return;
      clearTimeout(commandTimer);
      groupSignal('SIGTERM');
      cleanupTimer = setTimeout(() => { groupSignal('SIGKILL'); finish(); }, CLEANUP_MS);
    };
    const abort = () => cleanup('INTERRUPTED');
    try {
      child = spawn(command, args, { cwd, env, detached: true, shell: false, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    } catch { rejectCommand(new GovernanceError('COMMAND_START_FAILED')); return; }
    child.once('error', () => cleanup('COMMAND_START_FAILED'));
    child.once('exit', (code) => { exitCode = code; cleanup(); });
    child.stdout?.on('data', (bytes) => {
      outputBytes += bytes.length;
      if (outputBytes > CAPTURE_BYTES) cleanup('COMMAND_OUTPUT_LIMIT');
      else output += bytes.toString('utf8');
    });
    commandTimer = setTimeout(() => cleanup(available < timeoutMs ? 'TOTAL_TIMEOUT' : 'COMMAND_TIMEOUT'), available);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function assertOutputParents(root) {
  for (const path of [join(root, '.github'), join(root, '.github/cloudflare')]) {
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) fail('OUTPUT_DIRECTORY_INVALID');
    mkdirSync(path, { recursive: true });
  }
}

export function clearGenerated(root) {
  assertOutputParents(root);
  // This directory is dedicated to disposable outputs, never repository inputs.
  rmSync(join(root, '.github/cloudflare/generated'), { recursive: true, force: true });
}

export async function identifyCheckout({ root, env, expectedBranch, localCommit, execute = runCommand, signal, deadline }) {
  const local = localCommit !== undefined;
  if (local ? !SHA.test(localCommit) : env.WORKERS_CI !== '1' || !SHA.test(env.WORKERS_CI_COMMIT_SHA ?? '') || !UUID.test(env.WORKERS_CI_BUILD_UUID ?? '')) fail('PROVIDER_IDENTITY_INVALID');
  if (!local && (!validBranch(expectedBranch) || env.WORKERS_CI_BRANCH !== expectedBranch)) fail('PROVIDER_BRANCH_MISMATCH');
  const commandEnv = childEnvironment(env);
  const git = (args, acceptedExitCodes = [0]) => execute({ name: 'source-identity', command: 'git', args: ['-C', root, ...args], cwd: root, env: commandEnv, timeoutMs: 10_000, deadline, signal, capture: true, acceptedExitCodes });
  const commit = (await git(['rev-parse', '--verify', 'HEAD^{commit}'])).stdout.trim();
  const tree = (await git(['rev-parse', '--verify', 'HEAD^{tree}'])).stdout.trim();
  if (!SHA.test(commit) || !SHA.test(tree) || commit !== (local ? localCommit : env.WORKERS_CI_COMMIT_SHA)) fail('SOURCE_MISMATCH');
  const symbolic = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1]);
  const attachedBranch = symbolic.exitCode === 0 ? symbolic.stdout.trim() : null;
  const branch = expectedBranch ?? attachedBranch;
  if (!validBranch(branch)) fail('BRANCH_INVALID');
  await git(['check-ref-format', '--branch', branch]);
  if (attachedBranch !== null && attachedBranch !== branch) fail('SOURCE_BRANCH_MISMATCH');
  let branchBinding = local ? 'local' : attachedBranch ? 'git-ref' : 'provider-event';
  if (!local && !attachedBranch) {
    for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const found = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], [0, 1]);
      if (found.exitCode === 0) {
        if (found.stdout.trim() !== commit) fail('SOURCE_BRANCH_MISMATCH');
        branchBinding = 'git-ref';
      }
    }
  }
  const trackedWorktreeClean = (await git(['status', '--porcelain=v1', '-z', '--untracked-files=no'])).stdout.length === 0;
  if (!local && !trackedWorktreeClean) fail('TRACKED_WORKTREE_DIRTY');
  return { provider: local ? 'local' : 'cloudflare-workers-builds', commit, tree, branch, branchBinding, trackedWorktreeClean, buildId: local ? `local-${randomUUID()}` : env.WORKERS_CI_BUILD_UUID };
}

export function checkPlan(root) {
  const web = join(root, 'apps/web');
  return [
    { name: CHECK_NAMES[0], command: 'bun', args: ['--no-env-file', '--no-install', '--no-orphans', 'test', 'tests-unit/performance-backlog-governance.test.ts'], cwd: web, timeoutMs: 240_000 },
    { name: CHECK_NAMES[1], command: 'bun', args: ['--no-env-file', '--no-install', '--no-orphans', 'test', 'tests-unit/release-workflow-governance-source.test.ts'], cwd: web, timeoutMs: 60_000 },
    { name: CHECK_NAMES[2], command: 'python3', args: ['-m', 'unittest', 'backend.utils.tests.test_tracked_document_integrity'], cwd: root, timeoutMs: 60_000 },
    { name: CHECK_NAMES[3], command: process.execPath, args: ['--test', '.github/scripts/classify-ci-benchmark.test.mjs'], cwd: root, timeoutMs: 60_000 },
    { name: CHECK_NAMES[4], command: process.execPath, args: ['--test', '.github/scripts/run-cloudflare-governance.test.mjs', '.github/scripts/deploy-cloudflare-governance.test.mjs'], cwd: root, timeoutMs: 60_000 },
  ];
}

export async function executeCheckPlan({ root, env, deadline, signal, execute = runCommand, log = () => {} }) {
  const checks = [];
  for (const step of checkPlan(root)) {
    if (signal?.aborted || performance.now() >= deadline - CLEANUP_MS) fail('TOTAL_TIMEOUT');
    log(`${step.name}: running`);
    const result = await execute({ ...step, env, deadline, signal });
    if (result.exitCode !== 0 || !Number.isSafeInteger(result.durationMs) || result.durationMs < 0 || result.durationMs > step.timeoutMs + CLEANUP_MS) fail('CHECK_RESULT_INVALID');
    checks.push({ name: step.name, status: 'passed', durationMs: result.durationMs });
    log(`${step.name}: passed`);
  }
  return checks;
}

async function toolVersions(context) {
  const versions = { node: process.versions.node };
  if (!/^24\./.test(versions.node)) fail('NODE_VERSION_MISMATCH');
  for (const [name, command, pattern] of [
    ['bun', 'bun', /^(1\.4\.0)$/],
    ['python', 'python3', /^Python (3\.(?:1[1-9]|[2-9][0-9])\.[0-9]+)$/],
    ['git', 'git', /^git version ([0-9][0-9A-Za-z.+-]{0,63})$/],
  ]) {
    const result = await context.execute({ ...context, name: `tool-${name}`, command, args: ['--version'], timeoutMs: 10_000, capture: true });
    const match = pattern.exec(result.stdout.trim());
    if (!match) fail('TOOL_VERSION_MISMATCH');
    versions[name] = match[1];
  }
  return versions;
}

function readEvidence(directory) {
  const path = join(directory, 'backlog.scored.json');
  const sidecar = `${path}.sha256`;
  for (const [file, limit] of [[path, MAX_ARTIFACT_BYTES], [sidecar, 128]]) {
    if (!existsSync(file)) fail('SCORED_EVIDENCE_MISSING');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) fail('SCORED_EVIDENCE_INVALID');
  }
  const bytes = readFileSync(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== EXPECTED_ARTIFACT_SHA256 || readFileSync(sidecar, 'utf8') !== `${digest}\n`) fail('SCORED_EVIDENCE_MISMATCH');
  return { artifact: bytes.toString('utf8'), evidence: { kind: 'sanitized-governance-fixture', name: 'backlog.scored.json', sha256: digest, bytes: bytes.length } };
}

export function publishGenerated(root, receipt, artifact) {
  if (!validateReceipt(receipt) || createHash('sha256').update(artifact).digest('hex') !== receipt.evidence.sha256 || Buffer.byteLength(artifact) !== receipt.evidence.bytes) fail('RECEIPT_INVALID');
  assertOutputParents(root);
  const staging = mkdtempSync(join(root, '.github/cloudflare/.generated-'));
  try {
    const put = (name, text) => writeFileSync(join(staging, name), text, { flag: 'wx', mode: 0o600 });
    put('receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
    put('backlog.scored.json', artifact);
    put('backlog.scored.json.sha256', `${receipt.evidence.sha256}\n`);
    put('artifact.mjs', `export default ${JSON.stringify(artifact)};\n`);
    put('worker.mjs', GENERATED_ENTRY_SOURCE);
    renameSync(staging, join(root, '.github/cloudflare/generated'));
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

// Dependency injection is used only by the focused Node tests. CLI arguments and
// environment variables cannot replace the fixed check plan or its commands.
export async function runGovernance({ root = REPOSITORY, env = process.env, expectedBranch, localCommit, execute = runCommand, signal, log = () => {} } = {}) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  // Reserve the final second for bounded artifact publication/removal after the
  // process-group watchdog; commands never receive the entire ten-minute budget.
  const deadline = started + TOTAL_BUDGET_MS - 1_000;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const watchdog = setTimeout(abort, TOTAL_BUDGET_MS - 1_000 - CLEANUP_MS);
  let artifactDirectory;
  try {
    clearGenerated(root);
    if (signal?.aborted) fail('INTERRUPTED');
    const identityArgs = { root, env, expectedBranch, localCommit, execute, deadline, signal: controller.signal };
    const identity = await identifyCheckout(identityArgs);
    artifactDirectory = mkdtempSync(join(tmpdir(), 'tzudong-governance-'));
    const childEnv = childEnvironment(env, identity, artifactDirectory);
    const context = { execute, cwd: root, env: childEnv, deadline, signal: controller.signal };
    const versions = await toolVersions(context);
    const checks = await executeCheckPlan({ root, env: childEnv, deadline, signal: controller.signal, execute, log });
    const finalIdentity = await identifyCheckout(identityArgs);
    if (finalIdentity.commit !== identity.commit || finalIdentity.tree !== identity.tree || finalIdentity.branch !== identity.branch) fail('SOURCE_CHANGED_DURING_CHECKS');
    const { artifact, evidence } = readEvidence(artifactDirectory);
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA, profile: PROFILE, scope: 'governance-contracts-only', status: 'passed', ...identity,
      trackedWorktreeClean: identity.trackedWorktreeClean && finalIdentity.trackedWorktreeClean,
      startedAt, completedAt: new Date().toISOString(), durationMs: Math.ceil(performance.now() - started), budgetMs: TOTAL_BUDGET_MS,
      toolVersions: versions, checks, evidence,
    };
    if (controller.signal.aborted || receipt.durationMs >= TOTAL_BUDGET_MS - CLEANUP_MS) fail('TOTAL_TIMEOUT');
    publishGenerated(root, receipt, artifact);
    return receipt;
  } catch (error) {
    clearGenerated(root);
    throw error instanceof GovernanceError ? error : new GovernanceError('RUN_FAILED');
  } finally {
    clearTimeout(watchdog);
    signal?.removeEventListener('abort', abort);
    if (artifactDirectory) rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

export function parseArguments(args) {
  let local = false;
  let localCommit;
  let expectedBranch;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--local' && !local) local = true;
    else if (args[index] === '--commit' && localCommit === undefined && args[index + 1]) localCommit = args[++index];
    else if (args[index] === '--branch' && expectedBranch === undefined && args[index + 1]) expectedBranch = args[++index];
    else fail('ARGUMENTS_INVALID');
  }
  if (local !== (localCommit !== undefined) || (local && !SHA.test(localCommit)) || (!local && !validBranch(expectedBranch)) || (expectedBranch !== undefined && !validBranch(expectedBranch))) fail('ARGUMENTS_INVALID');
  return { localCommit, expectedBranch };
}

async function main() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  try {
    // Clear stale publishable results even when CLI parsing fails.
    clearGenerated(REPOSITORY);
    const receipt = await runGovernance({ ...parseArguments(process.argv.slice(2)), signal: controller.signal, log: (line) => process.stdout.write(`governance: ${line}\n`) });
    process.stdout.write(`${JSON.stringify({ profile: receipt.profile, scope: receipt.scope, provider: receipt.provider, commit: receipt.commit, durationMs: receipt.durationMs, status: receipt.provider === 'local' ? 'diagnostic-only' : 'passed' })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof GovernanceError ? error.message : 'cloudflare governance: RUN_FAILED'}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
