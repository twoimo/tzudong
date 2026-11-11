import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { CHECK_NAMES, EXPECTED_ARTIFACT_SHA256 } from '../cloudflare/worker.mjs';
import { deployGovernance, deploymentEnvironment, readRegular, validateDeploymentReceipt } from './deploy-cloudflare-governance.mjs';

const now = Date.parse('2026-11-11T17:00:00.000Z');
const identity = { provider: 'cloudflare-workers-builds', commit: 'a'.repeat(40), tree: 'b'.repeat(40), branch: 'ci/test',
  branchBinding: 'git-ref', trackedWorktreeClean: true, buildId: '11111111-1111-4111-8111-111111111111' };
function receipt() {
  return { schemaVersion: 'cloudflare-governance.v1', profile: 'governance', scope: 'governance-contracts-only', status: 'passed', ...identity,
    startedAt: new Date(now - 10_000).toISOString(), completedAt: new Date(now - 5_000).toISOString(), durationMs: 5000, budgetMs: 600_000,
    toolVersions: { node: '24.22.1', bun: '1.4.0', python: '3.12.12', git: '2.51.0' },
    checks: CHECK_NAMES.map(name => ({ name, status: 'passed', durationMs: 1 })),
    evidence: { kind: 'sanitized-governance-fixture', name: 'backlog.scored.json', sha256: EXPECTED_ARTIFACT_SHA256, bytes: 22002 } };
}

test('deployment requires a complete fresh receipt for this provider build and source', () => {
  assert.equal(validateDeploymentReceipt(receipt(), identity, now), true);
  for (const [field, value] of [['commit', 'c'.repeat(40)], ['tree', 'd'.repeat(40)], ['branch', 'ci/other'],
    ['buildId', '22222222-2222-4222-8222-222222222222'], ['trackedWorktreeClean', false]]) {
    assert.throws(() => validateDeploymentReceipt(receipt(), { ...identity, [field]: value }, now), /DEPLOY_SOURCE_MISMATCH/);
  }
  const partial = receipt(); partial.checks.pop();
  assert.throws(() => validateDeploymentReceipt(partial, identity, now), /DEPLOY_RECEIPT_INVALID/);
});

test('local, stale, future-dated, and over-budget receipts cannot authorize a deployment', () => {
  const local = { ...receipt(), provider: 'local', branchBinding: 'local', buildId: `local-${identity.buildId}` };
  assert.throws(() => validateDeploymentReceipt(local, identity, now), /DEPLOY_RECEIPT_INVALID/);
  assert.throws(() => validateDeploymentReceipt(receipt(), identity, now + 31 * 60_000), /DEPLOY_RECEIPT_EXPIRED/);
  assert.throws(() => validateDeploymentReceipt(receipt(), identity, now - 60_000), /DEPLOY_RECEIPT_EXPIRED/);
  const long = receipt(); long.startedAt = new Date(now - 700_000).toISOString();
  assert.throws(() => validateDeploymentReceipt(long, identity, now), /DEPLOY_RECEIPT_EXPIRED/);
});

test('only the deploy subprocess receives the exact token and configured account', () => {
  const env = deploymentEnvironment({ PATH: '/bin', HOME: '/tmp', CLOUDFLARE_API_TOKEN: 'fixture-deploy-token',
    GH_TOKEN: 'fixture-github-token', SUPABASE_SERVICE_ROLE_KEY: 'fixture-admin', NODE_OPTIONS: '--require injected.cjs',
    NPM_CONFIG_USERCONFIG: '/tmp/secret-npmrc', CLOUDFLARE_ENV: 'production' }, identity, 'account');
  assert.equal(env.CLOUDFLARE_API_TOKEN, 'fixture-deploy-token');
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, 'account');
  for (const key of ['GH_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_OPTIONS', 'NPM_CONFIG_USERCONFIG', 'CLOUDFLARE_ENV']) assert.equal(env[key], undefined);
  assert.throws(() => deploymentEnvironment({}, identity, 'account'), /DEPLOY_TOKEN_MISSING/);
  assert.throws(() => deploymentEnvironment({ CLOUDFLARE_API_TOKEN: 'fixture', CLOUDFLARE_ACCOUNT_ID: 'other' }, identity, 'account'), /DEPLOY_ACCOUNT_MISMATCH/);
});

test('deployment inputs reject symlinks, empty files, and unbounded content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-deploy-input-'));
  try {
    const file = join(directory, 'input.json'); const link = join(directory, 'link.json');
    writeFileSync(file, '{}'); symlinkSync(file, link);
    assert.equal(readRegular(file, 2), '{}');
    assert.throws(() => readRegular(link, 10), /DEPLOY_INPUT_INVALID/);
    assert.throws(() => readRegular(file, 1), /DEPLOY_INPUT_INVALID/);
    writeFileSync(file, '');
    assert.throws(() => readRegular(file, 10), /DEPLOY_INPUT_INVALID/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function deploymentFixture(t, { failInstall = false, afterInstall = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tzudong-deploy-orchestration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, '.github/cloudflare');
  const put = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  const version = '4.160.1';
  const accountId = '7bd4c42b9400babab532b604f48a86f0';
  put(join(directory, 'package.json'), { packageManager: 'npm@11.6.2', engines: { node: '24.x' }, devDependencies: { wrangler: version } });
  put(join(directory, 'package-lock.json'), { packages: { '': { devDependencies: { wrangler: version } }, 'node_modules/wrangler': { version } } });
  put(join(root, 'apps/web/package.json'), { packageManager: 'npm@11.6.2' });
  put(join(directory, 'wrangler.jsonc'), { name: 'tzudong-ci-governance', account_id: accountId, main: 'generated/worker.mjs' });
  const state = { ...identity };
  const currentReceipt = receipt();
  const time = Date.now();
  currentReceipt.startedAt = new Date(time - 10_000).toISOString();
  currentReceipt.completedAt = new Date(time - 5_000).toISOString();
  const calls = [];
  let verifications = 0;
  const installFailure = new Error('fixture npm installation failed');
  const env = { PATH: process.env.PATH, HOME: root, WORKERS_CI: '1', WORKERS_CI_COMMIT_SHA: identity.commit,
    WORKERS_CI_BRANCH: identity.branch, WORKERS_CI_BUILD_UUID: identity.buildId,
    CLOUDFLARE_API_TOKEN: 'fixture-deploy-token', CLOUDFLARE_ACCOUNT_ID: accountId,
    GH_TOKEN: 'fixture-github-token', SUPABASE_SERVICE_ROLE_KEY: 'fixture-admin', NODE_OPTIONS: '--require injected.cjs' };
  const execute = async (request) => {
    calls.push(request);
    let stdout = '';
    if (request.command === 'git') {
      assert.deepEqual(request.args.slice(0, 2), ['-C', root]);
      const operation = request.args.slice(2).join(' ');
      if (operation === 'rev-parse --verify HEAD^{commit}') stdout = state.commit;
      else if (operation === 'rev-parse --verify HEAD^{tree}') stdout = state.tree;
      else if (operation === 'symbolic-ref --quiet --short HEAD') stdout = state.branch;
      else if (operation !== `check-ref-format --branch ${identity.branch}` && operation !== 'status --porcelain=v1 -z --untracked-files=no') {
        assert.fail(`unexpected git operation: ${operation}`);
      }
    } else if (request.command === 'npm' && request.args[0] === '--version') stdout = '11.6.2\n';
    else if (request.command === 'npm' && request.args[0] === 'ci') {
      if (failInstall) throw installFailure;
      put(join(directory, 'node_modules/wrangler/package.json'), { version });
      afterInstall({ state, currentReceipt });
    } else {
      assert.equal(request.command, process.execPath);
      assert.deepEqual(request.args, [join(directory, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', join(directory, 'wrangler.jsonc')]);
    }
    return { exitCode: 0, stdout, durationMs: 1 };
  };
  const verify = (checkedRoot, checkedIdentity) => {
    assert.equal(checkedRoot, root);
    verifications += 1;
    validateDeploymentReceipt(currentReceipt, checkedIdentity);
    return currentReceipt;
  };
  return { directory, calls, installFailure, verificationCount: () => verifications,
    options: { root, env, expectedBranch: identity.branch, execute, verify } };
}

test('deployment orchestration verifies twice, installs without secrets, and deploys the exact pinned target', async (t) => {
  const fixture = deploymentFixture(t);
  const result = await deployGovernance(fixture.options);
  assert.deepEqual(result, { profile: 'governance', scope: 'governance-contracts-only', commit: identity.commit, buildId: identity.buildId, status: 'deployed' });
  assert.equal(fixture.verificationCount(), 2);
  const install = fixture.calls.find((call) => call.command === 'npm' && call.args[0] === 'ci');
  const deployments = fixture.calls.filter((call) => call.command === process.execPath);
  assert.equal(deployments.length, 1);
  assert.deepEqual(install.args, ['ci', '--ignore-scripts', '--no-audit', '--fund=false']);
  assert.equal(install.cwd, fixture.directory);
  assert.equal(deployments[0].cwd, fixture.directory);
  assert.ok(fixture.calls.indexOf(install) < fixture.calls.indexOf(deployments[0]));
  for (const call of fixture.calls) {
    assert.equal(call.env.CLOUDFLARE_API_TOKEN, call === deployments[0] ? 'fixture-deploy-token' : undefined);
    for (const key of ['GH_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_OPTIONS']) assert.equal(call.env[key], undefined);
  }
});

test('deployment orchestration never invokes Wrangler after npm installation fails', async (t) => {
  const fixture = deploymentFixture(t, { failInstall: true });
  await assert.rejects(deployGovernance(fixture.options), (error) => error === fixture.installFailure);
  assert.equal(fixture.verificationCount(), 1);
  assert.ok(fixture.calls.some((call) => call.command === 'npm' && call.args[0] === 'ci'));
  assert.equal(fixture.calls.some((call) => call.command === process.execPath), false);
  assert.ok(fixture.calls.every((call) => call.env.CLOUDFLARE_API_TOKEN === undefined));
});

test('deployment orchestration rejects changed source or expired evidence after installation', async (t) => {
  for (const [name, afterInstall, code] of [
    ['source changed', ({ state }) => { state.commit = 'c'.repeat(40); }, 'SOURCE_MISMATCH'],
    ['receipt expired', ({ currentReceipt }) => {
      currentReceipt.startedAt = new Date(Date.now() - 32 * 60_000).toISOString();
      currentReceipt.completedAt = new Date(Date.now() - 31 * 60_000).toISOString();
    }, 'DEPLOY_RECEIPT_EXPIRED'],
  ]) {
    await t.test(name, async (subtest) => {
      const fixture = deploymentFixture(subtest, { afterInstall });
      await assert.rejects(deployGovernance(fixture.options), { code });
      assert.ok(fixture.calls.some((call) => call.command === 'npm' && call.args[0] === 'ci'));
      assert.equal(fixture.calls.some((call) => call.command === process.execPath), false);
    });
  }
});
