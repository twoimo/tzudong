import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { CHECK_NAMES, EXPECTED_ARTIFACT_SHA256 } from '../cloudflare/worker.mjs';
import { deployGovernance, deploymentEnvironment, readRegular, validateDeploymentReceipt, verifyPublishedGovernance } from './deploy-cloudflare-governance.mjs';

// Fixed sanitized output of the existing governance scorer fixture. This test
// never fetches production data or changes the approved artifact digest.
const ARTIFACT = gunzipSync(Buffer.from('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', 'base64'), { maxOutputLength: 22002 });
assert.equal(ARTIFACT.byteLength, 22002);
assert.equal(createHash('sha256').update(ARTIFACT).digest('hex'), EXPECTED_ARTIFACT_SHA256);

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

function publicResponse(body, { status = 200, type = 'application/json', headers = {} } = {}) {
  return new Response(typeof body === 'object' && !ArrayBuffer.isView(body) && !(body instanceof ReadableStream) ? `${JSON.stringify(body)}\n` : body,
    { status, headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', ...headers } });
}

function publishedFixture(expected = receipt(), alter = (_path, response) => response) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    assert.equal(url, `https://tzudong-ci-governance.twoimo.workers.dev${path}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    const type = path.endsWith('.sha256') ? 'text/plain' : 'application/json';
    assert.deepEqual(options.headers, { accept: type, 'accept-encoding': 'identity', 'cache-control': 'no-cache' });
    assert.ok(options.signal instanceof AbortSignal);
    calls.push({ path, options });
    let response;
    if (path === '/receipt') response = publicResponse(expected);
    else if (path === '/health') response = publicResponse({ profile: expected.profile, scope: expected.scope, status: 'passed',
      commit: expected.commit, tree: expected.tree, buildId: expected.buildId });
    else if (path === '/artifacts/backlog.scored.json') response = publicResponse(ARTIFACT);
    else if (path === '/artifacts/backlog.scored.json.sha256') response = publicResponse(`${expected.evidence.sha256}\n`, { type });
    else assert.fail(`unexpected readback path: ${path}`);
    return alter(path, response, calls.length, options);
  };
  return { calls, options: { receipt: expected, fetchImpl, pause: async () => {} } };
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
  const published = publishedFixture(currentReceipt);
  return { directory, calls, publishedCalls: published.calls, currentReceipt, installFailure, verificationCount: () => verifications,
    options: { root, env, expectedBranch: identity.branch, execute, verify, fetchImpl: published.options.fetchImpl, pause: async () => {} } };
}

test('deployment orchestration verifies twice, installs without secrets, and deploys the exact pinned target', async (t) => {
  const fixture = deploymentFixture(t);
  const result = await deployGovernance(fixture.options);
  assert.deepEqual(result, { profile: 'governance', scope: 'governance-contracts-only', commit: identity.commit, buildId: identity.buildId, status: 'deployed' });
  assert.equal(fixture.verificationCount(), 2);
  assert.deepEqual(fixture.publishedCalls.map((call) => call.path), ['/receipt', '/health', '/artifacts/backlog.scored.json', '/artifacts/backlog.scored.json.sha256']);
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
  assert.equal(fixture.publishedCalls.length, 0);
  assert.ok(fixture.calls.every((call) => call.env.CLOUDFLARE_API_TOKEN === undefined));
});

test('public readback verifies the exact receipt, health, artifact bytes and checksum without credentials', async () => {
  const fixture = publishedFixture();
  assert.deepEqual(await verifyPublishedGovernance(fixture.options), { attempts: 1, endpoints: 4 });
  assert.equal(fixture.calls.length, 4);
});

test('propagation retries a predecessor once then requires the complete current proof', async () => {
  const expected = receipt();
  const pauses = [];
  const fixture = publishedFixture(expected, (path, response, count) => path === '/receipt' && count === 1
    ? publicResponse({ ...expected, commit: 'c'.repeat(40) }) : response);
  const result = await verifyPublishedGovernance({ ...fixture.options, pause: async (milliseconds) => pauses.push(milliseconds) });
  assert.deepEqual(result, { attempts: 2, endpoints: 4 });
  assert.deepEqual(pauses, [5000]);
  assert.deepEqual(fixture.calls.map((call) => call.path), ['/receipt', '/receipt', '/health', '/artifacts/backlog.scored.json', '/artifacts/backlog.scored.json.sha256']);
});

test('a permanently old deployment exhausts exactly three attempts and never reports deployed', async (t) => {
  const fixture = deploymentFixture(t);
  const expected = fixture.currentReceipt;
  const published = publishedFixture(expected, (path, response) => path === '/receipt'
    ? publicResponse({ ...expected, buildId: '22222222-2222-4222-8222-222222222222' }) : response);
  await assert.rejects(deployGovernance({ ...fixture.options, fetchImpl: published.options.fetchImpl }), { code: 'DEPLOY_READBACK_SOURCE_MISMATCH' });
  assert.equal(published.calls.length, 3);
  assert.ok(published.calls.every((call) => call.path === '/receipt'));
  assert.equal(fixture.calls.filter((call) => call.command === process.execPath).length, 1, 'a failed readback must not repeat the deployment');
});

test('public readback rejects incomplete checks and changed metadata for the same build', async (t) => {
  for (const [name, modify, code] of [
    ['missing check', (value) => { value.checks.pop(); }, 'DEPLOY_READBACK_RECEIPT_INVALID'],
    ['wrong runtime', (value) => { value.toolVersions.node = '24.22.0'; }, 'DEPLOY_READBACK_RECEIPT_MISMATCH'],
    ['different check time', (value) => { value.checks[0].durationMs = 2; }, 'DEPLOY_READBACK_RECEIPT_MISMATCH'],
  ]) {
    await t.test(name, async () => {
      const changed = receipt(); modify(changed);
      const fixture = publishedFixture(receipt(), (path, response) => path === '/receipt' ? publicResponse(changed) : response);
      await assert.rejects(verifyPublishedGovernance(fixture.options), { code });
      assert.equal(fixture.calls.length, 1);
    });
  }
});

test('readback rejects partial health, corrupt or truncated evidence and an incorrect checksum', async (t) => {
  const corrupted = Buffer.from(ARTIFACT); corrupted[0] ^= 1;
  for (const [name, path, response, code, requests] of [
    ['partial health', '/health', () => publicResponse({ status: 'passed' }), 'DEPLOY_READBACK_SOURCE_MISMATCH', 6],
    ['corrupt artifact', '/artifacts/backlog.scored.json', () => publicResponse(corrupted), 'DEPLOY_READBACK_ARTIFACT_MISMATCH', 3],
    ['truncated artifact', '/artifacts/backlog.scored.json', () => publicResponse(ARTIFACT.subarray(0, -1)), 'DEPLOY_READBACK_ARTIFACT_MISMATCH', 3],
    ['wrong checksum', '/artifacts/backlog.scored.json.sha256', () => publicResponse(`${'0'.repeat(64)}\n`, { type: 'text/plain' }), 'DEPLOY_READBACK_CHECKSUM_MISMATCH', 4],
  ]) {
    await t.test(name, async () => {
      const fixture = publishedFixture(receipt(), (requestedPath, value) => requestedPath === path ? response() : value);
      await assert.rejects(verifyPublishedGovernance(fixture.options), { code });
      assert.equal(fixture.calls.length, requests);
    });
  }
});

test('HTTP responses require no-store, the expected media type and an unredirected success', async (t) => {
  for (const [name, response, code] of [
    ['cached response', () => publicResponse(receipt(), { headers: { 'cache-control': 'max-age=60' } }), 'DEPLOY_READBACK_HEADERS_INVALID'],
    ['wrong media type', () => publicResponse(receipt(), { type: 'text/html' }), 'DEPLOY_READBACK_HEADERS_INVALID'],
    ['redirect', () => publicResponse(null, { status: 302, headers: { location: 'https://example.invalid/' } }), 'DEPLOY_READBACK_HTTP_INVALID'],
    ['invalid JSON', () => publicResponse('{'), 'DEPLOY_READBACK_JSON_INVALID'],
    ['incomplete content length', () => publicResponse('{}', { headers: { 'content-length': '9' } }), 'DEPLOY_READBACK_BODY_INVALID'],
  ]) {
    await t.test(name, async () => {
      const fixture = publishedFixture(receipt(), () => response());
      await assert.rejects(verifyPublishedGovernance(fixture.options), { code });
      assert.equal(fixture.calls.length, 1);
    });
  }
});

test('declared and streamed oversized responses fail before unbounded content can accumulate', async (t) => {
  for (const declared of [false, true]) {
    await t.test(declared ? 'declared size' : 'streamed size', async () => {
      let cancelled = false;
      const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel() { cancelled = true; } });
      const fixture = publishedFixture(receipt(), () => publicResponse(body, { headers: declared ? { 'content-length': '16385' } : {} }));
      await assert.rejects(verifyPublishedGovernance(fixture.options), { code: 'DEPLOY_READBACK_TOO_LARGE' });
      assert.equal(cancelled, true);
      assert.equal(fixture.calls.length, 1);
    });
  }
});

test('a stalled response body times out and is cancelled even if transport ignores abort', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const fixture = publishedFixture(receipt(), () => publicResponse(body));
  const started = performance.now();
  await assert.rejects(verifyPublishedGovernance({ ...fixture.options, deadline: started + 30 }), { code: 'DEPLOY_READBACK_TIMEOUT' });
  assert.ok(performance.now() - started < 3000);
  assert.equal(cancelled, true);
  assert.equal(fixture.calls[0].options.signal.aborted, true);
});

test('a response arriving after the fetch timeout is cancelled without beginning its readback', async () => {
  let deliver;
  let cancelled = false;
  const response = publicResponse(new ReadableStream({ cancel() { cancelled = true; } }));
  const request = new Promise((resolve) => { deliver = resolve; });
  await assert.rejects(verifyPublishedGovernance({ receipt: receipt(), deadline: performance.now() + 20,
    fetchImpl: async () => request }), { code: 'DEPLOY_READBACK_TIMEOUT' });
  deliver(response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('cancellation before a request, during its body, or during propagation prevents success', async (t) => {
  await t.test('before request', async () => {
    const controller = new AbortController(); controller.abort();
    const fixture = publishedFixture();
    await assert.rejects(verifyPublishedGovernance({ ...fixture.options, signal: controller.signal }), { code: 'DEPLOY_READBACK_INTERRUPTED' });
    assert.equal(fixture.calls.length, 0);
  });
  await t.test('during body', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const fixture = publishedFixture(receipt(), () => {
      setTimeout(() => controller.abort(), 10);
      return publicResponse(new ReadableStream({ cancel() { cancelled = true; } }));
    });
    await assert.rejects(verifyPublishedGovernance({ ...fixture.options, signal: controller.signal }), { code: 'DEPLOY_READBACK_INTERRUPTED' });
    assert.equal(cancelled, true);
    assert.equal(fixture.calls.length, 1);
  });
  await t.test('during propagation', async () => {
    const controller = new AbortController();
    const fixture = publishedFixture(receipt(), () => {
      setTimeout(() => controller.abort(), 10);
      return publicResponse({ ...receipt(), commit: 'c'.repeat(40) });
    });
    const { pause: _pause, ...options } = fixture.options;
    await assert.rejects(verifyPublishedGovernance({ ...options, signal: controller.signal }), { code: 'DEPLOY_READBACK_INTERRUPTED' });
    assert.equal(fixture.calls.length, 1);
  });
});

test('network errors are bounded to three attempts and expose only a fixed error code', async () => {
  let calls = 0;
  await assert.rejects(verifyPublishedGovernance({ receipt: receipt(), pause: async () => {}, fetchImpl: async () => {
    calls += 1; throw new Error('provider diagnostic containing fixture-private-token');
  } }), (error) => error.code === 'DEPLOY_READBACK_NETWORK_FAILED' && !error.message.includes('fixture-private-token'));
  assert.equal(calls, 3);
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
