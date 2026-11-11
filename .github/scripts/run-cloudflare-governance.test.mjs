import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { CHECK_NAMES, EXPECTED_ARTIFACT_SHA256, TOTAL_BUDGET_MS, createWorker, validateReceipt } from '../cloudflare/worker.mjs';
import { GovernanceError, checkPlan, childEnvironment, executeCheckPlan, identifyCheckout, parseArguments, runCommand, runGovernance } from './run-cloudflare-governance.mjs';

const buildId = '12345678-1234-4234-8234-123456789abc';
const cleanEnv = childEnvironment(process.env);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cloudflare-governance-test-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: cleanEnv });
    assert.equal(result.status, 0, 'fixture git command failed');
    return result.stdout.trim();
  };
  git('init', '-b', 'ci/pilot');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  const env = { ...process.env, WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: commit, WORKERS_CI_BRANCH: 'ci/pilot', WORKERS_CI_BUILD_UUID: buildId };
  return { root, git, commit, env, options: { root, env, expectedBranch: 'ci/pilot' }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const receiptFixture = () => ({
  schemaVersion: 'cloudflare-governance.v1', profile: 'governance', scope: 'governance-contracts-only', status: 'passed', provider: 'cloudflare-workers-builds',
  commit: 'a'.repeat(40), tree: 'b'.repeat(40), branch: 'ci/pilot', branchBinding: 'git-ref', trackedWorktreeClean: true, buildId,
  startedAt: '2026-11-12T01:00:00.000Z', completedAt: '2026-11-12T01:00:10.000Z', durationMs: 10_000, budgetMs: TOTAL_BUDGET_MS,
  toolVersions: { node: '24.22.1', bun: '1.4.0', python: '3.12.14', git: '2.43.0' },
  checks: CHECK_NAMES.map((name) => ({ name, status: 'passed', durationMs: 1 })),
  evidence: { kind: 'sanitized-governance-fixture', name: 'backlog.scored.json', sha256: EXPECTED_ARTIFACT_SHA256, bytes: 20 },
});

test('remote identity binds the exact commit, tree, literal branch and build UUID', async () => {
  const f = fixture();
  try {
    const identity = await identifyCheckout(f.options);
    assert.equal(identity.provider, 'cloudflare-workers-builds');
    assert.equal(identity.commit, f.commit);
    assert.equal(identity.tree, f.git('rev-parse', 'HEAD^{tree}'));
    assert.equal(identity.branchBinding, 'git-ref');
    assert.equal(identity.trackedWorktreeClean, true);
    for (const change of [
      { WORKERS_CI: 'true' }, { WORKERS_CI_COMMIT_SHA: 'a'.repeat(40) }, { WORKERS_CI_COMMIT_SHA: f.commit.toUpperCase() },
      { WORKERS_CI_BUILD_UUID: 'not-a-uuid' }, { WORKERS_CI_BRANCH: 'other-branch' },
    ]) await assert.rejects(identifyCheckout({ ...f.options, env: { ...f.env, ...change } }), GovernanceError);
    await assert.rejects(identifyCheckout({ ...f.options, expectedBranch: 'other-branch', env: { ...f.env, WORKERS_CI_BRANCH: 'other-branch' } }), { code: 'SOURCE_BRANCH_MISMATCH' });
  } finally { f.cleanup(); }
});

test('detached checkout accepts the provider event only after exact SHA validation', async () => {
  const f = fixture();
  try {
    f.git('checkout', '--detach', f.commit);
    assert.equal((await identifyCheckout(f.options)).branchBinding, 'git-ref');
    f.git('branch', '-D', 'ci/pilot');
    assert.equal((await identifyCheckout(f.options)).branchBinding, 'provider-event');
    await assert.rejects(identifyCheckout({ ...f.options, env: { ...f.env, WORKERS_CI_COMMIT_SHA: 'c'.repeat(40) } }), { code: 'SOURCE_MISMATCH' });
  } finally { f.cleanup(); }
});

test('tracked changes fail remote identity but an explicit local run remains diagnostic', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'README.md'), 'changed\n');
    await assert.rejects(identifyCheckout(f.options), { code: 'TRACKED_WORKTREE_DIRTY' });
    const local = await identifyCheckout({ ...f.options, localCommit: f.commit });
    assert.equal(local.provider, 'local');
    assert.equal(local.branchBinding, 'local');
    assert.equal(local.trackedWorktreeClean, false);
    assert.match(local.buildId, /^local-/);
    await assert.rejects(identifyCheckout({ ...f.options, localCommit: 'd'.repeat(40) }), { code: 'SOURCE_MISMATCH' });
  } finally { f.cleanup(); }
});

test('child environment excludes secret and runtime injection variables', () => {
  const environment = childEnvironment({
    PATH: '/tool/bin', HOME: '/cache/home', TMPDIR: '/tmp', BUN_INSTALL_CACHE_DIR: '/cache/bun',
    CLOUDFLARE_API_TOKEN: 'secret', CF_API_TOKEN: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'secret', ADMIN_API_KEY: 'secret',
    GITHUB_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', NODE_OPTIONS: '--import=malicious', PYTHONPATH: '/evil',
    LD_PRELOAD: '/evil', GIT_SSH_COMMAND: 'arbitrary', GOVERNANCE_CI_OUTPUT_DIR: '/evil',
  }, { provider: 'cloudflare-workers-builds', commit: 'a'.repeat(40), branch: 'ci/pilot', buildId }, '/owned-artifacts');
  assert.deepEqual(Object.keys(environment).sort(), ['BUN_INSTALL_CACHE_DIR', 'CI', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GOVERNANCE_CI_OUTPUT_DIR', 'HOME', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'TMPDIR', 'WORKERS_CI', 'WORKERS_CI_BRANCH', 'WORKERS_CI_BUILD_UUID', 'WORKERS_CI_COMMIT_SHA'].sort());
  assert.equal(environment.GOVERNANCE_CI_OUTPUT_DIR, '/owned-artifacts');
  assert.equal(environment.WORKERS_CI, '1');
  assert.equal(childEnvironment(environment, { provider: 'local' }).WORKERS_CI, undefined);
});

test('fixed plan completes every real suite and cannot install or select arbitrary commands', async () => {
  const root = '/fixture';
  const plan = checkPlan(root);
  assert.deepEqual(plan.map((step) => step.name), CHECK_NAMES);
  assert.equal(plan.some((step) => /npm|npx/.test(step.command)), false);
  assert.ok(plan.filter((step) => step.command === 'bun').every((step) => step.args.includes('--no-install') && step.args.includes('--no-env-file') && step.args.includes('--no-orphans')));
  assert.deepEqual(plan.at(-1).args, ['--test', '.github/scripts/run-cloudflare-governance.test.mjs', '.github/scripts/deploy-cloudflare-governance.test.mjs']);
  const observed = [];
  const checks = await executeCheckPlan({ root, env: cleanEnv, deadline: performance.now() + 10_000, execute: async (step) => { observed.push(step.name); return { exitCode: 0, durationMs: 1 }; } });
  assert.deepEqual(observed, CHECK_NAMES);
  assert.deepEqual(checks, CHECK_NAMES.map((name) => ({ name, status: 'passed', durationMs: 1 })));
  let calls = 0;
  await assert.rejects(executeCheckPlan({ root, env: cleanEnv, deadline: performance.now() + 10_000, execute: async () => { calls += 1; if (calls === 2) throw new GovernanceError('COMMAND_FAILED'); return { exitCode: 0, durationMs: 1 }; } }), { code: 'COMMAND_FAILED' });
  assert.equal(calls, 2);
  await assert.rejects(executeCheckPlan({ root, env: cleanEnv, deadline: performance.now() + 10_000, execute: async () => ({ exitCode: 1, durationMs: 1 }) }), { code: 'CHECK_RESULT_INVALID' });
});

test('stale output is deleted before identity checks and remains absent after a failing suite', async () => {
  const f = fixture();
  const generated = join(f.root, '.github/cloudflare/generated');
  const stale = () => { mkdirSync(generated, { recursive: true }); writeFileSync(join(generated, 'receipt.json'), 'stale pass'); writeFileSync(join(generated, 'worker.mjs'), 'stale pass'); };
  try {
    stale();
    await assert.rejects(runGovernance({ ...f.options, env: { ...f.env, WORKERS_CI_COMMIT_SHA: 'a'.repeat(40) } }), { code: 'SOURCE_MISMATCH' });
    assert.equal(existsSync(generated), false);
    stale();
    const execute = (request) => {
      if (request.name === 'tool-bun') return Promise.resolve({ exitCode: 0, stdout: '1.4.0\n', durationMs: 0 });
      if (request.name === 'tool-python') return Promise.resolve({ exitCode: 0, stdout: 'Python 3.12.14\n', durationMs: 0 });
      if (CHECK_NAMES.includes(request.name)) throw new GovernanceError('COMMAND_FAILED');
      return runCommand(request);
    };
    await assert.rejects(runGovernance({ ...f.options, execute }), { code: 'COMMAND_FAILED' });
    assert.equal(existsSync(generated), false);
  } finally { f.cleanup(); }
});

test('command timeout kills the entire process group including a TERM-resistant descendant', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloudflare-timeout-'));
  const pidPath = join(root, 'child.pid');
  const marker = join(root, 'orphan-survived');
  let descendant;
  try {
    const source = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); process.on('SIGTERM',()=>{}); const c=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('node:fs'); process.on('SIGTERM',()=>{}); setTimeout(()=>fs.writeFileSync(process.argv[1],'survived'),1600); setInterval(()=>{},1000);")},${JSON.stringify(marker)}],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidPath)},String(c.pid)); setInterval(()=>{},1000);`;
    const started = performance.now();
    await assert.rejects(runCommand({ command: process.execPath, args: ['-e', source], cwd: root, env: cleanEnv, timeoutMs: 500 }), { code: 'COMMAND_TIMEOUT' });
    assert.ok(performance.now() - started < 3_000);
    descendant = Number(readFileSync(pidPath, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(existsSync(marker), false);
    // An orphan can briefly remain as a reaped-by-init zombie; it cannot run.
    if (existsSync(`/proc/${descendant}/stat`)) assert.match(readFileSync(`/proc/${descendant}/stat`, 'utf8'), /^\d+ \(.+\) Z /);
  } finally {
    if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounded command success captures output and total deadline stops new execution', async () => {
  const result = await runCommand({ command: process.execPath, args: ['-e', "process.stdout.write('complete')"], env: cleanEnv, timeoutMs: 2_000, capture: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'complete');
  await assert.rejects(runCommand({ command: process.execPath, args: ['-e', 'process.exit(0)'], env: cleanEnv, timeoutMs: 2_000, deadline: performance.now() }), { code: 'TOTAL_TIMEOUT' });
});

test('receipt validation accepts the complete bounded profile and rejects partial or extended claims', () => {
  assert.equal(validateReceipt(receiptFixture(), { allowLocal: false }), true);
  for (const mutate of [
    (receipt) => { receipt.checks.pop(); }, (receipt) => { receipt.checks[0].status = 'skipped'; },
    (receipt) => { receipt.checks[1].name = receipt.checks[0].name; }, (receipt) => { receipt.profile = 'all-ci'; },
    (receipt) => { receipt.secret = 'should never be served'; }, (receipt) => { receipt.durationMs = TOTAL_BUDGET_MS + 1; },
    (receipt) => { receipt.trackedWorktreeClean = false; }, (receipt) => { receipt.evidence.kind = 'production-performance'; },
  ]) { const receipt = receiptFixture(); mutate(receipt); assert.equal(validateReceipt(receipt), false); }
  const local = { ...receiptFixture(), provider: 'local', branchBinding: 'local', buildId: `local-${buildId}` };
  assert.equal(validateReceipt(local), true);
  assert.equal(validateReceipt(local, { allowLocal: false }), false);
});

test('Worker has no mutation endpoints and fails closed for absent, local, partial or altered evidence', async () => {
  const request = (path, method = 'GET') => new Request(`https://ci.example.invalid${path}`, { method });
  assert.equal((await createWorker().fetch(request('/health'))).status, 503);
  const local = { ...receiptFixture(), provider: 'local', branchBinding: 'local', buildId: `local-${buildId}` };
  assert.equal((await createWorker(local).fetch(request('/receipt'))).status, 503);
  const partial = receiptFixture(); partial.checks.pop();
  assert.equal((await createWorker(partial).fetch(request('/receipt'))).status, 503);
  assert.equal((await createWorker(receiptFixture(), 'altered evidence').fetch(request('/health'))).status, 503);
  assert.equal((await createWorker(receiptFixture()).fetch(request('/artifacts/backlog.scored.json'))).status, 503);
  assert.equal((await createWorker().fetch(request('/receipt', 'POST'))).status, 405);
  assert.equal((await createWorker().fetch(request('/unknown'))).status, 404);
});

test('CLI requires explicit local commit or remote branch and has no command override', () => {
  assert.deepEqual(parseArguments(['--branch', 'ci/pilot']), { localCommit: undefined, expectedBranch: 'ci/pilot' });
  assert.deepEqual(parseArguments(['--local', '--commit', 'a'.repeat(40)]), { localCommit: 'a'.repeat(40), expectedBranch: undefined });
  for (const args of [[], ['--local'], ['--commit', 'a'.repeat(40)], ['--branch', 'feature/*'], ['--branch', 'ci/pilot', '--command', 'true'], ['--local', '--commit', 'short']]) assert.throws(() => parseArguments(args), GovernanceError);
});
