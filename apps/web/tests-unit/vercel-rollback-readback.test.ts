import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import {
  RollbackReadbackError,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  captureVercelRollbackReadback,
  captureVercelRollbackReadbackSync,
  createScopedVercelApiTransport,
  createScopedVercelApiTransportSync,
} from '../scripts/vercel-rollback-readback.mjs';

const expected = {
  deploymentId: 'dpl_CLEMRdaLUrai3Ph9J2czNRA64pyw',
  deploymentUrl: 'https://tzudong-a7wf62m0v-twoimos-projects.vercel.app/',
  gitRef: 'main',
  gitSha: '8257581e09f6f58f72f6e0e2c4aa7e6c72caab43',
};

const deployment = {
  id: expected.deploymentId,
  projectId: TZUDONG_VERCEL_PROJECT_ID,
  ownerId: TZUDONG_VERCEL_TEAM_ID,
  url: new URL(expected.deploymentUrl).hostname,
  readyState: 'READY',
  target: 'production',
  alias: [
    'tzudong-git-main-twoimos-projects.vercel.app',
    'tzudong-twoimos-projects.vercel.app',
  ],
  meta: {
    githubCommitOrg: 'twoimo',
    githubCommitRepo: 'tzudong',
    githubCommitSha: expected.gitSha,
    githubCommitRef: expected.gitRef,
  },
  rawProviderToken: 'must-not-survive-selection',
};

const alias = (host: string) => ({
  alias: host,
  deployment: { id: expected.deploymentId },
  deploymentId: expected.deploymentId,
  projectId: TZUDONG_VERCEL_PROJECT_ID,
  rawAccountRow: { email: 'must-not-survive-selection@example.invalid' },
});

function fixtureTransport(overrides: Record<string, unknown> = {}) {
  const requests: string[] = [];
  return {
    requests,
    transport: {
      async request(endpoint: string) {
        requests.push(endpoint);
        if (endpoint.includes('/v13/deployments/')) return JSON.stringify({ ...deployment, ...overrides });
        const host = endpoint.includes('www.tzudong.app') ? 'www.tzudong.app' : 'tzudong.app';
        return JSON.stringify(alias(host));
      },
    },
  };
}

test('captures only the exact immutable deployment, Git identity and current production aliases', async () => {
  const fixture = fixtureTransport();
  const readback = await captureVercelRollbackReadback({
    expected,
    now: () => new Date('2026-10-10T03:00:00.000Z'),
    transport: fixture.transport,
  });

  expect(readback).toEqual({
    schemaVersion: 1,
    kind: 'vercel-rollback-readback',
    projectId: TZUDONG_VERCEL_PROJECT_ID,
    teamId: TZUDONG_VERCEL_TEAM_ID,
    deploymentId: expected.deploymentId,
    deploymentUrl: expected.deploymentUrl,
    readyState: 'READY',
    target: 'production',
    repository: 'twoimo/tzudong',
    gitSha: expected.gitSha,
    gitRef: 'main',
    productionAliases: ['tzudong.app', 'www.tzudong.app'],
    observedAt: '2026-10-10T03:00:00.000Z',
  });
  expect(JSON.stringify(readback)).not.toContain('rawProviderToken');
  expect(JSON.stringify(readback)).not.toContain('email');
  expect(fixture.requests).toEqual([
    `/v13/deployments/${expected.deploymentId}?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v4/aliases/tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v4/aliases/www.tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
  ]);
});

test.each([
  ['project', { projectId: 'prj_wrong' }],
  ['team', { ownerId: 'team_wrong' }],
  ['deployment ID', { id: 'dpl_wrong' }],
  ['immutable URL', { url: 'tzudong-other.vercel.app' }],
  ['readiness', { readyState: 'BUILDING' }],
  ['target', { target: null }],
  ['Git org', { meta: { ...deployment.meta, githubCommitOrg: 'other' } }],
  ['Git repo', { meta: { ...deployment.meta, githubCommitRepo: 'other' } }],
  ['Git SHA', { meta: { ...deployment.meta, githubCommitSha: 'f'.repeat(40) } }],
  ['Git ref', { meta: { ...deployment.meta, githubCommitRef: 'develop' } }],
])('rejects a mismatched %s without returning provider data', async (_name, override) => {
  const fixture = fixtureTransport(override);
  await expect(captureVercelRollbackReadback({ expected, transport: fixture.transport }))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_DEPLOYMENT_MISMATCH' });
});

test.each([
  ['missing', { alias: undefined }],
  ['internal only', { alias: [
    'tzudong-git-main-twoimos-projects.vercel.app',
    'tzudong-twoimos-projects.vercel.app',
  ] }],
  ['provider-derived unrelated aliases', { alias: ['tzudong-staging-twoimos-projects.vercel.app'] }],
])('uses direct alias GETs when the deployment alias list is %s', async (_name, override) => {
  const fixture = fixtureTransport(override);
  await expect(captureVercelRollbackReadback({ expected, transport: fixture.transport }))
    .resolves.toMatchObject({
      deploymentId: expected.deploymentId,
      productionAliases: ['tzudong.app', 'www.tzudong.app'],
    });
  expect(fixture.requests.slice(1)).toEqual([
    `/v4/aliases/tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v4/aliases/www.tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
  ]);
});

test('rejects an alias that does not point at the exact deployment', async () => {
  const fixture = fixtureTransport();
  const transport = {
    async request(endpoint: string) {
      const raw = await fixture.transport.request(endpoint);
      if (endpoint.includes('/v4/aliases/tzudong.app')) {
        return JSON.stringify({ ...JSON.parse(raw), deploymentId: 'dpl_other' });
      }
      return raw;
    },
  };
  await expect(captureVercelRollbackReadback({ expected, transport }))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_ALIAS_MISMATCH' });
});

test('rejects an alias whose nested deployment identity is missing or mismatched', async () => {
  const fixture = fixtureTransport();
  const transport = {
    async request(endpoint: string) {
      const raw = await fixture.transport.request(endpoint);
      if (endpoint.includes('/v4/aliases/www.tzudong.app')) {
        return JSON.stringify({ ...JSON.parse(raw), deployment: { id: 'dpl_other' } });
      }
      return raw;
    },
  };
  await expect(captureVercelRollbackReadback({ expected, transport }))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_ALIAS_MISMATCH' });
});

test.each([
  [{ ...expected, deploymentUrl: 'http://tzudong-a7wf62m0v-twoimos-projects.vercel.app/' }],
  [{ ...expected, deploymentUrl: 'https://tzudong-a7wf62m0v-twoimos-projects.vercel.app/path' }],
  [{ ...expected, deploymentId: 'deployment-not-id' }],
  [{ ...expected, gitSha: 'f'.repeat(64) }],
  [{ ...expected, gitRef: 'develop' }],
])('rejects invalid caller identity before transport', async invalid => {
  let called = false;
  await expect(captureVercelRollbackReadback({
    expected: invalid,
    transport: { async request() { called = true; return '{}'; } },
  })).rejects.toMatchObject({ code: 'ROLLBACK_READBACK_CONFIG_INVALID' });
  expect(called).toBe(false);
});

function fakeChild(stdout: string, stderr = '', exitCode = 0) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  });
  return child;
}

test('scoped CLI transport uses only the fixed team and GET endpoint', async () => {
  let invocation: any;
  const spawnImpl = (...args: any[]) => {
    invocation = args;
    return fakeChild('{"ok":true}', 'sensitive provider diagnostic');
  };
  const transport = createScopedVercelApiTransport({ cliPath: '/opt/homebrew/bin/vercel', spawnImpl });
  const endpoint = `/v13/deployments/dpl_fixture?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
  await expect(transport.request(endpoint))
    .resolves.toEqual(Buffer.from('{"ok":true}'));
  expect(invocation[0]).toBe('/opt/homebrew/bin/vercel');
  expect(invocation[1]).toEqual([
    'api',
    endpoint,
    '--scope',
    TZUDONG_VERCEL_TEAM_ID,
    '--raw',
  ]);
  expect(invocation[2]).toMatchObject({ shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
});

test('scoped CLI transport emits a fixed failure code without stderr contents', async () => {
  const secret = 'provider-secret-that-must-not-escape';
  const transport = createScopedVercelApiTransport({
    spawnImpl: () => fakeChild('', secret, 1),
  });
  try {
    await transport.request(`/v13/deployments/dpl_fixture?teamId=${TZUDONG_VERCEL_TEAM_ID}`);
    throw new Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(RollbackReadbackError);
    expect((error as RollbackReadbackError).code).toBe('ROLLBACK_READBACK_CLI_FAILED');
    expect(String(error)).not.toContain(secret);
  }
});

test('scoped CLI transport enforces a bounded response size', async () => {
  const signals: string[] = [];
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal: string) => { signals.push(signal); return true; };
  queueMicrotask(() => child.stdout.emit('data', Buffer.from('x'.repeat(1025))));
  const transport = createScopedVercelApiTransport({
    maxBytes: 1024,
    spawnImpl: () => child,
  });
  await expect(transport.request(`/v13/deployments/dpl_fixture?teamId=${TZUDONG_VERCEL_TEAM_ID}`))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_OUTPUT_INVALID' });
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
});

test('scoped CLI transport rejects non-readback endpoints before spawning', async () => {
  let called = false;
  const transport = createScopedVercelApiTransport({
    spawnImpl: () => { called = true; return fakeChild('{}'); },
  });
  await expect(transport.request('/v10/projects/tzudong'))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_CONFIG_INVALID' });
  expect(called).toBe(false);
});

test('scoped CLI transport terminates a hung CLI within the configured bound', async () => {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals: string[] = [];
  child.kill = (signal: string) => { signals.push(signal); return true; };
  const transport = createScopedVercelApiTransport({
    spawnImpl: () => child,
    timeoutMs: 1_000,
  });
  await expect(transport.request(`/v13/deployments/dpl_fixture?teamId=${TZUDONG_VERCEL_TEAM_ID}`))
    .rejects.toMatchObject({ code: 'ROLLBACK_READBACK_TIMEOUT' });
  expect(signals[0]).toBe('SIGTERM');
});

test('synchronous scoped transport uses bounded exact CLI arguments and fixed failures', () => {
  let invocation: any;
  const transport = createScopedVercelApiTransportSync({
    cliPath: '/opt/homebrew/bin/vercel',
    spawnSyncImpl: (...args: any[]) => {
      invocation = args;
      return { error: null, status: 0, stderr: Buffer.from('discarded'), stdout: Buffer.from('{"ok":true}') };
    },
  });
  const endpoint = `/v13/deployments/dpl_fixture?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
  expect(transport.request(endpoint)).toEqual(Buffer.from('{"ok":true}'));
  expect(invocation[0]).toBe('/opt/homebrew/bin/vercel');
  expect(invocation[1]).toEqual(['api', endpoint, '--scope', TZUDONG_VERCEL_TEAM_ID, '--raw']);
  expect(invocation[2]).toMatchObject({
    killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });

  for (const [code, expectedCode] of [
    ['ETIMEDOUT', 'ROLLBACK_READBACK_TIMEOUT'],
    ['ENOBUFS', 'ROLLBACK_READBACK_OUTPUT_INVALID'],
    ['ENOENT', 'ROLLBACK_READBACK_CLI_FAILED'],
  ]) {
    const failing = createScopedVercelApiTransportSync({
      spawnSyncImpl: () => ({ error: { code }, status: null, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }),
    });
    expect(() => failing.request(endpoint)).toThrow(expectedCode);
  }
});

test('synchronous capture shares exact deployment and alias validation', () => {
  const responses = [
    JSON.stringify(deployment),
    JSON.stringify(alias('tzudong.app')),
    JSON.stringify(alias('www.tzudong.app')),
  ];
  const requests: string[] = [];
  const events: string[] = [];
  const readback = captureVercelRollbackReadbackSync({
    expected,
    now: () => {
      events.push('completion-time');
      return new Date('2026-10-10T03:00:00.000Z');
    },
    transport: { request(endpoint: string) {
      requests.push(endpoint);
      events.push(`response-${requests.length}`);
      return responses.shift();
    } },
  });
  expect(readback).toMatchObject({
    deploymentId: expected.deploymentId,
    deploymentUrl: expected.deploymentUrl,
    projectId: TZUDONG_VERCEL_PROJECT_ID,
    teamId: TZUDONG_VERCEL_TEAM_ID,
    observedAt: '2026-10-10T03:00:00.000Z',
  });
  expect(requests).toHaveLength(3);
  expect(events).toEqual(['response-1', 'response-2', 'response-3', 'completion-time']);

  const invalidResponses = [
    JSON.stringify({ ...deployment, projectId: 'prj_stale_web' }),
    JSON.stringify(alias('tzudong.app')),
    JSON.stringify(alias('www.tzudong.app')),
  ];
  expect(() => captureVercelRollbackReadbackSync({
    expected,
    transport: { request() { return invalidResponses.shift(); } },
  })).toThrow('ROLLBACK_READBACK_DEPLOYMENT_MISMATCH');
});
