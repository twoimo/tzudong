import { expect, test } from 'bun:test';

import {
  AUTOMATIC_REVIEWER_READBACK_SQL,
  ADMIN_RECORD_MUTATIONS_HOLD_PROBE_PATH,
  G037_VARIABLE_ENDPOINT,
  captureAdminRecordMutationsHold,
  captureAutomaticReviewer,
  captureCurrentProductionRollback,
  captureG037WriteFreeze,
  captureGitEvidence,
  captureObservableOperatingEvidence,
  captureReviewMediaOperatingInput,
  createAdminRecordMutationsHoldProbeTransport,
  createOwnerDatabaseReadback,
  createGithubVariableTransport,
  operatingCaptureFailureResult,
} from '../scripts/review-media-operating-capture.mjs';
import { loadSuccessorManifest } from '../scripts/review-media-sql-successor.mjs';
import {
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
} from '../scripts/vercel-rollback-readback.mjs';

const manifestRecord = loadSuccessorManifest();
const { manifest } = manifestRecord;
const sourceRevision = '1'.repeat(40);
const deploymentSha = '2'.repeat(40);
const expiresAt = '2026-10-13T09:15:00.000Z';
const fixedClock = () => new Date('2026-10-13T09:00:00.000Z');
const deploymentId = 'dpl_OperatingCaptureFixture123';
const deploymentHost = 'tzudong-operating-capture-twoimos-projects.vercel.app';

function alias(host: string) {
  return {
    alias: host,
    deployment: { id: deploymentId },
    deploymentId,
    projectId: TZUDONG_VERCEL_PROJECT_ID,
  };
}

const deployment = {
  id: deploymentId,
  meta: {
    githubCommitOrg: 'twoimo',
    githubCommitRef: 'main',
    githubCommitRepo: 'tzudong',
    githubCommitSha: deploymentSha,
  },
  ownerId: TZUDONG_VERCEL_TEAM_ID,
  projectId: TZUDONG_VERCEL_PROJECT_ID,
  readyState: 'READY',
  target: 'production',
  url: deploymentHost,
};

function vercelFixture(overrides: Record<string, unknown> = {}) {
  const requests: string[] = [];
  return {
    requests,
    transport: {
      async request(endpoint: string) {
        requests.push(endpoint);
        if (endpoint.includes('/v13/deployments/')) {
          return JSON.stringify({ ...deployment, ...overrides });
        }
        const host = endpoint.includes('www.tzudong.app') ? 'www.tzudong.app' : 'tzudong.app';
        return JSON.stringify(alias(host));
      },
    },
  };
}

function githubFixture(value = 'active') {
  const requests: string[] = [];
  return {
    requests,
    transport: {
      async request(endpoint: string) {
        requests.push(endpoint);
        return JSON.stringify({ name: 'G037_WRITE_FREEZE', value });
      },
    },
  };
}

function databaseFixture(value: Record<string, unknown> = {}) {
  const requests: string[] = [];
  return {
    requests,
    readback: {
      async requestAutomaticReviewer() {
        requests.push('automaticReviewer');
        return JSON.stringify({
          enabled: false,
          policyRows: 1,
          queued: 0,
          running: 0,
          ...value,
        });
      },
    },
  };
}

function adminHoldProbeFixture(value: Record<string, unknown> = {}) {
  const requests: string[] = [];
  return {
    requests,
    transport: {
      async request(deploymentUrl: string) {
        requests.push(deploymentUrl);
        return JSON.stringify({
          commit: deploymentSha,
          deploymentId,
          holdActive: true,
          ...value,
        });
      },
    },
  };
}

function environment() {
  return {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'twoimo/tzudong',
    GITHUB_SHA: sourceRevision,
    GITHUB_TOKEN: 'github-test-token',
    SUPABASE_DB_URL: 'postgresql://db.invalid/postgres',
    VERCEL_TOKEN: 'vercel-test-token',
  };
}

function gitDependencies() {
  return {
    gitFactsImpl: () => ({ clean: true, detached: true, revision: sourceRevision }),
    protectedMainReadbackImpl: () => ({
      projectRef: manifest.projectRef,
      ref: manifest.protectedSource.ref,
      remote: manifest.protectedSource.remote,
      repositoryUrl: manifest.protectedSource.repositoryUrl,
      revision: sourceRevision,
      schemaVersion: 1,
    }),
  };
}

test('discovers production from the alias and delegates an exact redundant readback', async () => {
  const fixture = vercelFixture();
  const result = await captureCurrentProductionRollback({
    clock: fixedClock,
    transport: fixture.transport,
  });

  expect(result).toMatchObject({
    deploymentId,
    deploymentUrl: `https://${deploymentHost}/`,
    gitRef: 'main',
    gitSha: deploymentSha,
    observedAt: '2026-10-13T09:00:00.000Z',
    productionAliases: ['tzudong.app', 'www.tzudong.app'],
  });
  expect(fixture.requests).toEqual([
    `/v4/aliases/tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v13/deployments/${deploymentId}?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v13/deployments/${deploymentId}?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v4/aliases/tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
    `/v4/aliases/www.tzudong.app?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
  ]);
});

test('maps provider identity drift to one fixed Vercel code', async () => {
  const fixture = vercelFixture({ ownerId: 'team_wrong' });
  await expect(captureCurrentProductionRollback({ transport: fixture.transport }))
    .rejects.toMatchObject({ code: 'SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED' });
});

test('captures only the active repository freeze variable', async () => {
  const fixture = githubFixture();
  await expect(captureG037WriteFreeze({ clock: fixedClock, transport: fixture.transport }))
    .resolves.toEqual({ observedAt: '2026-10-13T09:00:00.000Z', state: 'active' });
  expect(fixture.requests).toEqual([G037_VARIABLE_ENDPOINT]);
});

test('captures the durable disabled policy only when no review work is active', async () => {
  const fixture = databaseFixture();
  await expect(captureAutomaticReviewer({ clock: fixedClock, readback: fixture.readback }))
    .resolves.toEqual({ observedAt: '2026-10-13T09:00:00.000Z', state: 'stopped' });
  expect(fixture.requests).toEqual(['automaticReviewer']);
});

test('binds the active runtime hold to the exact immutable deployment readback', async () => {
  const fixture = adminHoldProbeFixture();
  await expect(captureAdminRecordMutationsHold({
    clock: fixedClock,
    deploymentReadback: {
      deploymentId,
      deploymentUrl: `https://${deploymentHost}/`,
      gitSha: deploymentSha,
    },
    transport: fixture.transport,
  })).resolves.toEqual({
    commit: deploymentSha,
    deploymentId,
    holdActive: true,
    observedAt: '2026-10-13T09:00:00.000Z',
  });
  expect(fixture.requests).toEqual([`https://${deploymentHost}/`]);
});

test.each([
  ['deployment', { deploymentId: 'dpl_Different' },
    'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_MISMATCH'],
  ['commit', { commit: '3'.repeat(40) },
    'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_MISMATCH'],
  ['hold', { holdActive: false },
    'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_INACTIVE'],
  ['extra response field', { unexpected: true },
    'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_MISMATCH'],
])('rejects runtime hold %s drift', async (_label, override, code) => {
  const fixture = adminHoldProbeFixture(override);
  await expect(captureAdminRecordMutationsHold({
    deploymentReadback: {
      deploymentId,
      deploymentUrl: `https://${deploymentHost}/`,
      gitSha: deploymentSha,
    },
    transport: fixture.transport,
  })).rejects.toMatchObject({ code });
});

test('immutable deployment probe sends existing credentials only to the fixed GET route', async () => {
  const calls: any[] = [];
  const transport = createAdminRecordMutationsHoldProbeTransport({
    adminCookie: 'sb-fixture-auth-token=admin-session-secret',
    fetchImpl: async (...args: any[]) => {
      calls.push(args);
      return {
        arrayBuffer: async () => Buffer.from(JSON.stringify({
          commit: deploymentSha,
          deploymentId,
          holdActive: true,
        })),
        status: 200,
      } as any;
    },
    protectionBypassSecret: 'vercel-bypass-secret',
  });
  await expect(transport.request(`https://${deploymentHost}/`)).resolves.toBeInstanceOf(Buffer);
  expect(calls[0][0]).toBe(`https://${deploymentHost}${ADMIN_RECORD_MUTATIONS_HOLD_PROBE_PATH}`);
  expect(calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  expect(calls[0][1].headers).toEqual({
    Accept: 'application/json',
    Cookie: 'sb-fixture-auth-token=admin-session-secret',
    'x-vercel-protection-bypass': 'vercel-bypass-secret',
  });
});

test.each([
  [{ adminCookie: undefined, adminCookieResolver: () => null,
    protectionBypassSecret: 'bypass' }, 'SUCCESSOR_OPERATING_CAPTURE_ADMIN_SESSION_MISSING'],
  [{ adminCookie: 'sb-auth=fixture', protectionBypassSecret: undefined },
    'SUCCESSOR_OPERATING_CAPTURE_PROTECTION_BYPASS_MISSING'],
])('fails closed when a deployment probe credential is unavailable', (input, code) => {
  expect(() => createAdminRecordMutationsHoldProbeTransport(input)).toThrow(
    expect.objectContaining({ code }),
  );
});

test.each([
  ['enabled policy', { enabled: true }],
  ['queued work', { queued: 1 }],
  ['running work', { running: 1 }],
  ['missing singleton policy', { policyRows: 0 }],
])('rejects automatic reviewer %s', async (_label, override) => {
  const fixture = databaseFixture(override);
  await expect(captureAutomaticReviewer({ readback: fixture.readback }))
    .rejects.toMatchObject({
      code: 'SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_NOT_STOPPED',
    });
});

test('maps database diagnostics to one fixed automatic-reviewer read code', async () => {
  const secret = 'database-diagnostic-that-must-not-escape';
  let error: any;
  try {
    await captureAutomaticReviewer({
      readback: { async requestAutomaticReviewer() { throw new Error(secret); } },
    });
  } catch (caught) {
    error = caught;
  }
  expect(operatingCaptureFailureResult(error)).toEqual({
    code: 'SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_READ_FAILED',
    status: 'failed',
  });
  expect(JSON.stringify(operatingCaptureFailureResult(error))).not.toContain(secret);
});

test('owner readback reuses the bounded psql transport in an explicit read-only transaction', () => {
  const calls: any[] = [];
  const env = environment();
  const readback = createOwnerDatabaseReadback({
    environment: env,
    runPsqlImpl: (...args: any[]) => {
      calls.push(args);
      return '{"enabled":false,"policyRows":1,"queued":0,"running":0}\n';
    },
  });
  expect(readback.requestAutomaticReviewer()).toContain('"enabled":false');
  expect(calls[0][0]).toBe(env.SUPABASE_DB_URL);
  expect(calls[0][1]).toBe(AUTOMATIC_REVIEWER_READBACK_SQL);
  expect(calls[0][2]).toBe(false);
  expect(AUTOMATIC_REVIEWER_READBACK_SQL).toContain('READ ONLY');
  expect(AUTOMATIC_REVIEWER_READBACK_SQL).toContain("state='queued'");
  expect(AUTOMATIC_REVIEWER_READBACK_SQL).toContain("state='running'");
});

test('rejects a cleared repository freeze with a fixed code', async () => {
  const fixture = githubFixture('cleared');
  await expect(captureG037WriteFreeze({ transport: fixture.transport }))
    .rejects.toMatchObject({ code: 'SUCCESSOR_OPERATING_CAPTURE_GITHUB_FREEZE_INACTIVE' });
});

test('GitHub transport performs only the fixed read and drops response diagnostics', async () => {
  const calls: any[] = [];
  const transport = createGithubVariableTransport({
    fetchImpl: async (...args: any[]) => {
      calls.push(args);
      return {
        arrayBuffer: async () => Buffer.from('{"name":"G037_WRITE_FREEZE","value":"active"}'),
        status: 200,
      } as any;
    },
    token: 'secret-token-that-must-not-escape',
  });
  await expect(transport.request(G037_VARIABLE_ENDPOINT)).resolves.toBeInstanceOf(Buffer);
  expect(calls[0][0]).toBe(`https://api.github.com${G037_VARIABLE_ENDPOINT}`);
  expect(calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
});

test.each([
  ['dirty', { clean: false, detached: true, revision: sourceRevision },
    'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_DIRTY'],
  ['attached', { clean: true, detached: false, revision: sourceRevision },
    'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_ATTACHED'],
  ['wrong revision', { clean: true, detached: true, revision: '3'.repeat(40) },
    'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_REVISION_MISMATCH'],
])('rejects a %s checkout', (_name, facts, code) => {
  expect(() => captureGitEvidence({
    clock: fixedClock,
    expiresAt,
    gitFactsImpl: () => facts,
    manifestRecord,
    protectedMainReadbackImpl: gitDependencies().protectedMainReadbackImpl,
    sourceRevision,
  })).toThrow(expect.objectContaining({ code }));
});

test('binds clean detached checkout and remote main to exact admission receipt shapes', () => {
  const result = captureGitEvidence({
    clock: fixedClock,
    expiresAt,
    manifestRecord,
    sourceRevision,
    ...gitDependencies(),
  });
  expect(result.checkoutReadback).toEqual({
    clean: true,
    detached: true,
    expiresAt,
    kind: 'successor-checkout-readback',
    observedAt: '2026-10-13T09:00:00.000Z',
    revision: sourceRevision,
    schemaVersion: 1,
  });
  expect(result.protectedMainReceipt).toMatchObject({
    kind: 'protected-main-readback-receipt',
    revision: sourceRevision,
    sourceRevision,
  });
  expect(result.sourceReceipt).toMatchObject({
    kind: 'successor-source-receipt',
    sourceRoot: manifest.sourceRoot,
  });
});

test('rejects protected main when its immutable revision differs', () => {
  expect(() => captureGitEvidence({
    clock: fixedClock,
    expiresAt,
    gitFactsImpl: gitDependencies().gitFactsImpl,
    manifestRecord,
    protectedMainReadbackImpl: () => ({
      ...gitDependencies().protectedMainReadbackImpl(),
      revision: '4'.repeat(40),
    }),
    sourceRevision,
  })).toThrow(expect.objectContaining({
    code: 'SUCCESSOR_OPERATING_CAPTURE_PROTECTED_MAIN_MISMATCH',
  }));
});

test('captures four complete boundaries and the runtime hold partial in one original window', async () => {
  const vercel = vercelFixture();
  const github = githubFixture();
  const database = databaseFixture();
  const adminHold = adminHoldProbeFixture();
  const evidence = await captureObservableOperatingEvidence({
    adminHoldProbeTransport: adminHold.transport,
    clock: fixedClock,
    databaseReadback: database.readback,
    environment: environment(),
    githubTransport: github.transport,
    manifestRecord,
    sourceRevision,
    vercelTransport: vercel.transport,
    ...gitDependencies(),
  });
  expect(Date.parse(evidence.expiresAt) - Date.parse(evidence.createdAt)).toBe(15 * 60 * 1000);
  expect(evidence.partialWriterFenceReceipts).toEqual({
    adminRecordMutationsHold: expect.objectContaining({
      commit: deploymentSha,
      deploymentId,
      fence: 'adminRecordMutationsHold',
      holdActive: true,
      kind: 'writer-fence-partial-readback-receipt',
      remainingCondition: 'inFlightQuiescence',
    }),
  });
  expect(evidence.writerFenceReceipts).toEqual({
    automaticReviewer: expect.objectContaining({
      fence: 'automaticReviewer',
      kind: 'writer-fence-readback-receipt',
      state: 'stopped',
    }),
    g037WriteFreeze: expect.objectContaining({
      fence: 'g037WriteFreeze',
      kind: 'writer-fence-readback-receipt',
      state: 'active',
    }),
  });
  expect(evidence.rollbackReadbackReceipt).toMatchObject({
    deploymentId,
    deploymentSha,
    state: 'ready',
  });
  expect(adminHold.requests).toEqual([`https://${deploymentHost}/`]);
});

test('discards all observations when the original window expires during capture', async () => {
  const vercel = vercelFixture();
  const github = githubFixture();
  const database = databaseFixture();
  const adminHold = adminHoldProbeFixture();
  let calls = 0;
  const clock = () => {
    calls += 1;
    return calls < 7
      ? new Date('2026-10-13T09:00:00.000Z')
      : new Date('2026-10-13T09:15:00.000Z');
  };
  await expect(captureObservableOperatingEvidence({
    adminHoldProbeTransport: adminHold.transport,
    clock,
    databaseReadback: database.readback,
    environment: environment(),
    githubTransport: github.transport,
    manifestRecord,
    sourceRevision,
    vercelTransport: vercel.transport,
    ...gitDependencies(),
  })).rejects.toMatchObject({ code: 'SUCCESSOR_OPERATING_CAPTURE_WINDOW_EXPIRED' });
});

test.each([
  ['SUPABASE_DB_URL', 'SUCCESSOR_OPERATING_CAPTURE_SUPABASE_CREDENTIAL_MISSING'],
  ['VERCEL_TOKEN', 'SUCCESSOR_OPERATING_CAPTURE_VERCEL_CREDENTIAL_MISSING'],
  ['GITHUB_TOKEN', 'SUCCESSOR_OPERATING_CAPTURE_GITHUB_CREDENTIAL_MISSING'],
])('fails before collection when %s is absent', async (name, code) => {
  const env: Record<string, string> = environment();
  delete env[name];
  await expect(captureObservableOperatingEvidence({
    environment: env,
    manifestRecord,
    sourceRevision,
  })).rejects.toMatchObject({ code });
});

test('rejects execution outside the exact manual protected-main context', async () => {
  const env = environment();
  env.GITHUB_EVENT_NAME = 'push';
  await expect(captureObservableOperatingEvidence({
    environment: env,
    manifestRecord,
    sourceRevision,
  })).rejects.toMatchObject({ code: 'SUCCESSOR_OPERATING_CAPTURE_GITHUB_CONTEXT_INVALID' });
});

test('never accepts the dedicated G037 read-only DSN as owner authority', async () => {
  const env = environment();
  env.SUPABASE_G037_READONLY_DB_URL = env.SUPABASE_DB_URL;
  await expect(captureObservableOperatingEvidence({
    environment: env,
    manifestRecord,
    sourceRevision,
  })).rejects.toMatchObject({ code: 'SUCCESSOR_OPERATING_CAPTURE_DB_AUTHORITY_INVALID' });
});

test('collects observable evidence and then fails on the first unobservable fence', async () => {
  const vercel = vercelFixture();
  const github = githubFixture();
  const database = databaseFixture();
  const adminHold = adminHoldProbeFixture();
  const secrets = ['github-test-token', 'vercel-test-token', 'owner:fixture'];
  let error: any;
  try {
    await captureReviewMediaOperatingInput({
      adminHoldProbeTransport: adminHold.transport,
      clock: fixedClock,
      databaseReadback: database.readback,
      environment: environment(),
      githubTransport: github.transport,
      manifestRecord,
      sourceRevision,
      vercelTransport: vercel.transport,
      ...gitDependencies(),
    });
  } catch (caught) {
    error = caught;
  }
  expect(error?.code).toBe(
    'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_ADMIN_RECORD_MUTATIONS_HOLD',
  );
  expect(vercel.requests.length).toBe(5);
  expect(github.requests).toEqual([G037_VARIABLE_ENDPOINT]);
  expect(database.requests).toEqual(['automaticReviewer']);
  expect(adminHold.requests).toEqual([`https://${deploymentHost}/`]);
  const result = operatingCaptureFailureResult(error);
  expect(result).toEqual({
    code: 'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_ADMIN_RECORD_MUTATIONS_HOLD',
    status: 'failed',
  });
  for (const secret of secrets) expect(JSON.stringify(result)).not.toContain(secret);
});

test('sanitizes unknown errors to a fixed public result', () => {
  const secret = 'provider-diagnostic-do-not-emit';
  expect(operatingCaptureFailureResult(new Error(secret))).toEqual({
    code: 'SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID',
    status: 'failed',
  });
});
