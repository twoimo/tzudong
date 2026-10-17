import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, test } from 'bun:test';

import {
  ADMIN_IN_FLIGHT_QUIESCENCE_SQL,
  OPERATOR_FENCES,
  QUIESCENCE_RELATIONS,
  assembleOperatingEvidence,
  authenticatedOwnerAttestation,
  captureInFlightQuiescence,
  captureLocalVercelBundle,
  createRuntimeVerifiedRollbackReadback,
  parseOperatingOrchestratorArguments,
  runOperatingOrchestrator,
  validateLocalVercelBundle,
} from '../scripts/review-media-operating-orchestrator.mjs';
import { loadSuccessorManifest } from '../scripts/review-media-sql-successor.mjs';

const manifestRecord = loadSuccessorManifest();
const manifest = manifestRecord.manifest;
const sourceRevision = 'a'.repeat(40);
const rollbackRevision = sourceRevision;
const oldRollbackRevision = 'b'.repeat(40);
const createdAt = '2026-10-14T01:00:00.000Z';
const observedAt = '2026-10-14T01:00:01.000Z';
const expiresAt = '2026-10-14T01:15:00.000Z';
const fixedNow = new Date('2026-10-14T01:00:05.000Z');
const deploymentId = 'dpl_OperatingOrchestratorFixture123';
const policySha256 = 'c'.repeat(64);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as any)[key])]));
  }
  return value;
}

const canonicalBytes = (value: unknown) => Buffer.from(`${JSON.stringify(canonical(value))}\n`);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function privateRoot() {
  const root = mkdtempSync(join(tmpdir(), 'review-media-operating-orchestrator-'));
  chmodSync(root, 0o700);
  return root;
}

function writePrivateCanonical(path: string, value: unknown) {
  writeFileSync(path, canonicalBytes(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function rollbackReadback() {
  return {
    deploymentId,
    deploymentUrl: 'https://tzudong-operating-fixture.vercel.app/',
    gitRef: 'main',
    gitSha: rollbackRevision,
    kind: 'vercel-rollback-readback',
    observedAt,
    productionAliases: ['tzudong.app', 'www.tzudong.app'],
    projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
    readyState: 'READY',
    repository: 'twoimo/tzudong',
    schemaVersion: 1,
    target: 'production',
    teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
  };
}

function protectedMain() {
  return {
    projectRef: manifest.projectRef,
    ref: manifest.protectedSource.ref,
    remote: manifest.protectedSource.remote,
    repositoryUrl: manifest.protectedSource.repositoryUrl,
    revision: sourceRevision,
    schemaVersion: 1,
  };
}

function vercelBundle() {
  return {
    adminRecordMutationsHold: {
      commit: rollbackRevision,
      deploymentId,
      holdActive: true,
      observedAt,
    },
    createdAt,
    expiresAt,
    kind: 'review-media-successor-vercel-operating-bundle',
    manifestSha256: manifestRecord.manifestSha256,
    protectedMain: protectedMain(),
    rollbackPolicy: {
      basis: 'exact-operating-source-deployment',
      deploymentSha: rollbackRevision,
      kind: 'storyboard-rollback-policy-readback',
      sourceRevision,
      state: 'gemini-only-preserved',
    },
    rollbackReadback: rollbackReadback(),
    schemaVersion: 1,
    sourceRevision,
    sourceRoot: manifest.sourceRoot,
    storyboardPolicy: {
      deployment: {
        branch: 'main',
        deploymentId,
        sourceCommit: rollbackRevision,
      },
      policy: { canonicalPolicySha256: policySha256 },
      schemaVersion: 1,
    },
  };
}

function runtimeCompatibilityReadback() {
  return {
    aliasRoutes: [
      {
        productionAlias: 'tzudong.app',
        redirectTarget: 'https://www.tzudong.app/api/runtime-compatibility/storyboard',
        route: 'redirect',
      },
      { productionAlias: 'www.tzudong.app', redirectTarget: null, route: 'direct' },
    ],
    canonicalPolicySha256: policySha256,
    commit: rollbackRevision,
    deploymentId,
    kind: 'storyboard-runtime-compatibility-alias-set-readback',
    schemaVersion: 1,
  };
}

function runtimeCompatibilityObservation(bundleSha256: string) {
  return {
    aliasRoutes: runtimeCompatibilityReadback().aliasRoutes,
    bundleSha256,
    canonicalPolicySha256: policySha256,
    commit: rollbackRevision,
    deploymentId,
    kind: 'storyboard-runtime-compatibility-alias-set-observation',
    schemaVersion: 1,
  };
}

async function observeRuntimeCompatibility({ bundleSha256 }: any) {
  return runtimeCompatibilityObservation(bundleSha256);
}

function workflowEnvironment() {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_ACTOR: 'twoimo',
    GITHUB_ACTOR_ID: '123456',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_PROTECTED: 'true',
    GITHUB_REPOSITORY: 'twoimo/tzudong',
    GITHUB_REPOSITORY_OWNER: 'twoimo',
    GITHUB_REPOSITORY_OWNER_ID: '123456',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_RUN_ID: '987654321',
    GITHUB_SHA: sourceRevision,
    GITHUB_TRIGGERING_ACTOR: 'twoimo',
    GITHUB_WORKFLOW_REF:
      'twoimo/tzudong/.github/workflows/review-media-sql-successor.yml@refs/heads/main',
    OPERATOR_ACTOR: 'twoimo',
    OPERATOR_ACTOR_ID: '123456',
  };
}

function attestation() {
  return authenticatedOwnerAttestation({
    clock: () => new Date('2026-10-14T01:00:02.000Z'),
    environment: workflowEnvironment(),
    sourceRevision,
  });
}

function assemblyOptions(overrides: Record<string, unknown> = {}) {
  let tick = 2;
  return {
    attestation: attestation(),
    bundle: vercelBundle(),
    clock: () => new Date(`2026-10-14T01:00:${String(tick++).padStart(2, '0')}.000Z`),
    databaseReadback: {
      requestAutomaticReviewer: () => JSON.stringify({
        enabled: false,
        policyRows: 1,
        queued: 0,
        running: 0,
      }),
    },
    environment: workflowEnvironment(),
    gitFactsImpl: () => ({ clean: true, detached: true, revision: sourceRevision }),
    githubTransport: {
      request: () => JSON.stringify({ name: 'G037_WRITE_FREEZE', value: 'active' }),
    },
    manifestRecord,
    protectedMainReadbackImpl: () => protectedMain(),
    quiescenceReadback: {
      requestQuiescence: () => JSON.stringify({
        coverage: QUIESCENCE_RELATIONS,
        inFlightWriters: 0,
        lockMode: 'SHARE',
      }),
    },
    sourceRevision,
    ...overrides,
  };
}

test('CLI keeps local Vercel capture separate from the workflow operating mode', () => {
  expect(parseOperatingOrchestratorArguments([
    'capture-vercel', '--source-revision', sourceRevision, '--output', '/private/bundle.json',
  ])).toEqual({
    command: 'capture-vercel',
    outputPath: '/private/bundle.json',
    sourceRevision,
  });
  expect(parseOperatingOrchestratorArguments([
    '--mode', 'rehearse', '--input', '/private/bundle.json',
    '--custody-dir', '/private/custody',
  ])).toEqual({
    command: 'operate',
    custodyDirectory: '/private/custody',
    mode: 'rehearsal',
    vercelBundlePath: '/private/bundle.json',
  });
  for (const argv of [
    ['--mode', 'rehearse', '--custody-dir', '/private/custody'],
    ['operate', '--mode', 'unknown', '--vercel-bundle', '/private/bundle.json', '--custody-dir', '/private/custody'],
    ['capture-vercel', '--source-revision', sourceRevision, '--output', '/private/a', '--output', '/private/b'],
    ['implicit'],
  ]) expect(() => parseOperatingOrchestratorArguments(argv)).toThrow(
    'SUCCESSOR_OPERATING_ORCHESTRATOR_ARGUMENT_INVALID',
  );
});

test('operator custody is accepted only from the authenticated repository owner dispatch', () => {
  const value = attestation();
  expect(value).toEqual({
    assertedAt: '2026-10-14T01:00:02.000Z',
    authority: 'authenticated-repository-owner-workflow-dispatch',
    basis: 'standing-custody-confirmation-bound-by-owner-dispatch',
    event: 'workflow_dispatch',
    fences: {
      browserRpc: 'stopped',
      dashboard: 'stopped',
      directSql: 'stopped',
      providerIngress: 'stopped',
    },
    kind: 'review-media-successor-operator-custody-attestation',
    noticeState: 'not-issued',
    operatorRole: 'repository-owner',
    repository: 'twoimo/tzudong',
    runAttempt: '1',
    runId: '987654321',
    schemaVersion: 1,
    scope: 'stopped-until-application-result',
    sourceRevision,
    workflowRef:
      'twoimo/tzudong/.github/workflows/review-media-sql-successor.yml@refs/heads/main',
  });
  expect(JSON.stringify(value)).not.toContain('123456');

  for (const mutate of [
    (env: any) => { env.GITHUB_EVENT_NAME = 'push'; },
    (env: any) => { env.GITHUB_TRIGGERING_ACTOR = 'someone-else'; },
    (env: any) => { env.GITHUB_ACTOR_ID = '999999'; },
    (env: any) => { env.OPERATOR_ACTOR = 'someone-else'; },
    (env: any) => { env.GITHUB_REF_PROTECTED = 'false'; },
    (env: any) => { env.GITHUB_SHA = oldRollbackRevision; },
  ]) {
    const environment = workflowEnvironment() as any;
    mutate(environment);
    expect(() => authenticatedOwnerAttestation({
      clock: () => fixedNow,
      environment,
      sourceRevision,
    })).toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID');
  }

  for (const key of ['OPERATOR_ACTOR', 'OPERATOR_ACTOR_ID']) {
    const environment = workflowEnvironment() as any;
    delete environment[key];
    expect(() => authenticatedOwnerAttestation({
      clock: () => fixedNow,
      environment,
      sourceRevision,
    })).toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_WORKFLOW_INVALID');
  }
});

test('local Vercel bundle is sanitized, source-bound, and limited to the original window', async () => {
  let runtimeReadbackCalls = 0;
  const bundle = await captureLocalVercelBundle({
    adminHoldProbeTransport: {
      request: () => JSON.stringify({
        commit: rollbackRevision,
        deploymentId,
        holdActive: true,
      }),
    },
    clock: (() => {
      const values = [
        '2026-10-14T01:00:00.000Z',
        '2026-10-14T01:00:01.000Z',
        '2026-10-14T01:00:02.000Z',
        '2026-10-14T01:00:03.000Z',
      ];
      return () => new Date(values.shift()!);
    })(),
    manifestRecord,
    protectedMainReadbackImpl: () => protectedMain(),
    runtimeCompatibilityReadbackImpl: async ({ urls }: any) => {
      runtimeReadbackCalls += 1;
      expect(urls).toEqual([
        'https://tzudong.app/api/runtime-compatibility/storyboard',
        'https://www.tzudong.app/api/runtime-compatibility/storyboard',
      ]);
      return runtimeCompatibilityReadback();
    },
    sourceRevision,
    vercelTransport: {
      request: (endpoint: string) => {
        if (endpoint.startsWith('/v13/deployments/')) return JSON.stringify({
          id: deploymentId,
          meta: {
            githubCommitOrg: 'twoimo',
            githubCommitRef: 'main',
            githubCommitRepo: 'tzudong',
            githubCommitSha: rollbackRevision,
          },
          ownerId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
          projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
          readyState: 'READY',
          target: 'production',
          url: 'tzudong-operating-fixture.vercel.app',
        });
        const host = endpoint.includes('www.tzudong.app') ? 'www.tzudong.app' : 'tzudong.app';
        return JSON.stringify({
          alias: host,
          deployment: { id: deploymentId },
          deploymentId,
          projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
        });
      },
    },
  });
  expect(bundle.sourceRevision).toBe(sourceRevision);
  expect(bundle.expiresAt).toBe(expiresAt);
  expect(bundle.rollbackReadback.gitSha).toBe(rollbackRevision);
  expect(bundle.rollbackReadback.observedAt).toBe(observedAt);
  expect(runtimeReadbackCalls).toBe(1);
  expect(bundle.storyboardPolicy).toEqual({
    deployment: { branch: 'main', deploymentId, sourceCommit: rollbackRevision },
    policy: { canonicalPolicySha256: policySha256 },
    schemaVersion: 1,
  });
  expect(bundle.storyboardPolicy).not.toHaveProperty('observedAt');
  expect(JSON.stringify(bundle)).not.toMatch(/cookie|token|query|credential/i);

  for (const mutate of [
    (value: any) => { value.sourceRevision = oldRollbackRevision; },
    (value: any) => { value.manifestSha256 = '0'.repeat(64); },
    (value: any) => { value.adminRecordMutationsHold.holdActive = false; },
    (value: any) => { value.rollbackReadback.productionAliases.reverse(); },
    (value: any) => { value.storyboardPolicy.deployment.branch = 'develop'; },
    (value: any) => { value.storyboardPolicy.policy.canonicalPolicySha256 = 'not-a-sha256'; },
    (value: any) => {
      value.rollbackReadback.gitSha = oldRollbackRevision;
      value.adminRecordMutationsHold.commit = oldRollbackRevision;
      value.rollbackPolicy.deploymentSha = oldRollbackRevision;
    },
  ]) {
    const value = structuredClone(vercelBundle());
    mutate(value);
    expect(() => validateLocalVercelBundle({
      bundle: value,
      manifestRecord,
      now: fixedNow,
      sourceRevision,
    })).toThrow();
  }
  expect(() => validateLocalVercelBundle({
    bundle: vercelBundle(),
    manifestRecord,
    now: new Date(expiresAt),
    sourceRevision,
  })).toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_STALE');
  const unsafeRollback = structuredClone(vercelBundle());
  unsafeRollback.rollbackReadback.gitSha = oldRollbackRevision;
  unsafeRollback.adminRecordMutationsHold.commit = oldRollbackRevision;
  unsafeRollback.rollbackPolicy.deploymentSha = oldRollbackRevision;
  unsafeRollback.storyboardPolicy.deployment.sourceCommit = oldRollbackRevision;
  expect(() => validateLocalVercelBundle({
    bundle: unsafeRollback,
    manifestRecord,
    now: fixedNow,
    sourceRevision,
  })).toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_ROLLBACK_POLICY_UNPROVED');
});

test('runtime-verified rollback callback rejects observation drift without changing vendor receipt time', async () => {
  const bundle = vercelBundle();
  const bundleSha256 = sha256(canonicalBytes(bundle));
  const callback = await createRuntimeVerifiedRollbackReadback({
    bundle,
    bundleSha256,
    observeRuntimeCompatibilityImpl: observeRuntimeCompatibility,
  });
  expect(callback()).toEqual(rollbackReadback());
  expect(callback().observedAt).toBe(observedAt);
  await expect(createRuntimeVerifiedRollbackReadback({
    bundle,
    bundleSha256,
    observeRuntimeCompatibilityImpl: async () => ({
      ...runtimeCompatibilityObservation(bundleSha256),
      canonicalPolicySha256: 'f'.repeat(64),
    }),
  })).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  await expect(createRuntimeVerifiedRollbackReadback({
    bundle,
    bundleSha256,
    observeRuntimeCompatibilityImpl: async () => {
      const observation = runtimeCompatibilityObservation(bundleSha256);
      return { ...observation, aliasRoutes: observation.aliasRoutes.slice(1) };
    },
  })).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
});

test('quiescence takes SHARE NOWAIT locks over the exact writer relations and rejects gaps', async () => {
  expect(ADMIN_IN_FLIGHT_QUIESCENCE_SQL).toContain('IN SHARE MODE NOWAIT');
  for (const relation of QUIESCENCE_RELATIONS) {
    expect(ADMIN_IN_FLIGHT_QUIESCENCE_SQL).toContain(relation);
  }
  expect(await captureInFlightQuiescence({
    clock: () => fixedNow,
    readback: {
      requestQuiescence: () => JSON.stringify({
        coverage: QUIESCENCE_RELATIONS,
        inFlightWriters: 0,
        lockMode: 'SHARE',
      }),
    },
  })).toEqual({
    coverage: QUIESCENCE_RELATIONS,
    inFlightWriters: 0,
    lockMode: 'SHARE',
    observedAt: fixedNow.toISOString(),
  });
  for (const body of [
    { coverage: QUIESCENCE_RELATIONS, inFlightWriters: 1, lockMode: 'SHARE' },
    { coverage: QUIESCENCE_RELATIONS.slice(1), inFlightWriters: 0, lockMode: 'SHARE' },
    { coverage: QUIESCENCE_RELATIONS, inFlightWriters: 0, lockMode: 'ACCESS SHARE' },
  ]) {
    await expect(captureInFlightQuiescence({
      clock: () => fixedNow,
      readback: { requestQuiescence: () => JSON.stringify(body) },
    })).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_NOT_QUIESCENT');
  }
});

test('assembler emits all seven receipts while keeping human and machine provenance distinct', async () => {
  const { input, machine } = await assembleOperatingEvidence(assemblyOptions() as any);
  expect(Object.keys(input.writerFenceReceipts).sort()).toEqual(
    Object.keys(manifest.requiredWriterFences).sort(),
  );
  expect(input.writerFenceReceipts.adminRecordMutationsHold.state).toBe('active');
  expect(input.writerFenceReceipts.adminRecordMutationsHold.observedAt)
    .toBe(machine.adminRuntimeHold.observedAt);
  for (const fence of OPERATOR_FENCES) {
    expect(input.writerFenceReceipts[fence]).toMatchObject({
      fence,
      observedAt: attestation().assertedAt,
      state: 'stopped',
    });
  }
  expect(machine).toMatchObject({
    kind: 'review-media-successor-machine-operating-observations',
    sourceRevision,
  });
  expect(machine).not.toHaveProperty('operatorRole');

  const changedManifest = structuredClone(manifestRecord);
  changedManifest.manifest.requiredWriterFences.unknownPublicProducer = 'stopped';
  await expect(assembleOperatingEvidence(assemblyOptions({
    manifestRecord: changedManifest,
  }) as any)).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_COVERAGE_UNPROVED');
});

test('workflow observe mode records evidence without entering the rehearsal controller', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  const custodyDirectory = join(root, 'custody');
  writeFileSync(bundlePath, JSON.stringify(canonical(vercelBundle())), { mode: 0o600 });
  chmodSync(bundlePath, 0o600);
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  let controllerCalls = 0;
  const result = await runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'observe',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
    observeRuntimeCompatibilityImpl: observeRuntimeCompatibility,
    prepareRehearsalImpl: () => { controllerCalls += 1; return {}; },
    runRehearsalImpl: () => { controllerCalls += 1; return {}; },
  } as any);
  expect(result).toMatchObject({
    code: 'SUCCESSOR_OPERATING_EVIDENCE_CAPTURED',
    custodyDirectory: realpathSync(custodyDirectory),
    mode: 'observe',
    status: 'observed',
  });
  expect(controllerCalls).toBe(0);
  for (const name of [
    'operator-custody-attestation.json',
    'operating-admission-input.json',
    'machine-operating-observations.json',
    'operating-evidence-map.json',
    'vercel-operating-bundle.json',
  ]) expect(existsSync(join(custodyDirectory, name))).toBe(true);
});

test('rehearsal orchestration writes private provenance sidecars and delegates to the existing controller', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  let controllerCalls = 0;
  const result = await runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'rehearsal',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
    observeRuntimeCompatibilityImpl: observeRuntimeCompatibility,
    runRehearsalImpl: async (_input: unknown, dependencies: any) => {
      controllerCalls += 1;
      expect(dependencies.rollbackReadbackImpl().deploymentId).toBe(deploymentId);
      return {
        code: 'SUCCESSOR_REHEARSAL_PASSED',
        status: 'rolled_back',
      };
    },
  } as any);
  expect(result).toMatchObject({
    code: 'SUCCESSOR_REHEARSAL_PASSED',
    mode: 'rehearsal',
    sourceRevision,
    status: 'rolled_back',
  });
  expect(controllerCalls).toBe(1);
  for (const name of [
    'operator-custody-attestation.json',
    'machine-operating-observations.json',
    'operating-evidence-map.json',
    'vercel-operating-bundle.json',
  ]) expect(existsSync(join(custodyDirectory, name))).toBe(true);
  const evidenceMap = JSON.parse(readFileSync(
    join(custodyDirectory, 'operating-evidence-map.json'),
    'utf8',
  ));
  for (const fence of OPERATOR_FENCES) {
    expect(evidenceMap.receiptProvenance[fence].provenance)
      .toBe('authenticated-owner-custody-commitment');
  }
  for (const fence of ['adminRecordMutationsHold', 'automaticReviewer', 'g037WriteFreeze']) {
    expect(evidenceMap.receiptProvenance[fence].provenance).toBe('machine-observation');
  }
  await expect(runOperatingOrchestrator({
    custodyDirectory: realpathSync(custodyDirectory),
    environment: workflowEnvironment(),
    mode: 'rehearsal',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
  } as any)).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_OUTPUT_EXISTS');
});

test('rehearsal rejects runtime identity drift before the rehearsal controller', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  let controllerCalls = 0;
  await expect(runOperatingOrchestrator({
    custodyDirectory: join(root, 'custody'),
    environment: workflowEnvironment(),
    mode: 'rehearsal',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
    observeRuntimeCompatibilityImpl: async ({ bundleSha256 }: any) => ({
      ...runtimeCompatibilityObservation(bundleSha256),
      deploymentId: 'dpl_ChangedRuntimeFixture123',
    }),
    runRehearsalImpl: async () => {
      controllerCalls += 1;
      return { code: 'SUCCESSOR_REHEARSAL_PASSED', status: 'rolled_back' };
    },
  } as any)).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  expect(controllerCalls).toBe(0);
});

test('held apply stops before bundle, DB, admission, or controller access', async () => {
  const root = privateRoot();
  let touched = 0;
  await expect(runOperatingOrchestrator({
    custodyDirectory: join(root, 'custody'),
    environment: workflowEnvironment(),
    mode: 'apply',
    vercelBundlePath: join(root, 'missing.json'),
  }, {
    assembleImpl: async () => { touched += 1; throw new Error('unexpected'); },
    attestationImpl: () => { touched += 1; return attestation(); },
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
    prepareApplyImpl: () => { touched += 1; return {}; },
    prepareRehearsalImpl: () => { touched += 1; return {}; },
    runApplyImpl: () => { touched += 1; return {}; },
    runRehearsalImpl: () => { touched += 1; return {}; },
  } as any)).rejects.toThrow('SUCCESSOR_LAUNCH_HELD');
  expect(touched).toBe(0);
});

test('ready apply performs rehearsal before admission/apply and keeps journals in one custody directory', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  const readyRecord = structuredClone(manifestRecord);
  readyRecord.manifest.launchPolicy.state = 'ready';
  const calls: string[] = [];
  const rollbackCallbacks: Array<() => any> = [];
  let runtimeObservationCalls = 0;
  const result = await runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'apply',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => readyRecord,
    observeRuntimeCompatibilityImpl: async (options: any) => {
      runtimeObservationCalls += 1;
      return observeRuntimeCompatibility(options);
    },
    prepareApplyImpl: ({ custodyDirectory: custody }: any) => {
      calls.push('prepare-apply');
      return {
        admissionPath: join(custody, 'apply-admission.json'),
        journalPath: join(custody, 'apply-journal.jsonl'),
      };
    },
    prepareRehearsalImpl: ({ custodyDirectory: custody }: any) => {
      calls.push('prepare-rehearsal');
      mkdirSync(custody, { mode: 0o700 });
      chmodSync(custody, 0o700);
      const paths = {
        admissionPath: join(custody, 'rehearsal-admission.json'),
        custodyDirectory: custody,
        journalPath: join(custody, 'rehearsal-journal.jsonl'),
        receiptPath: join(custody, 'rehearsal-receipt.json'),
      };
      for (const path of [paths.admissionPath, paths.journalPath, paths.receiptPath]) {
        writeFileSync(path, '{}\n', { mode: 0o600 });
        chmodSync(path, 0o600);
      }
      return paths;
    },
    runApplyImpl: async (_input: unknown, dependencies: any) => {
      calls.push('run-apply');
      rollbackCallbacks.push(dependencies.rollbackReadbackImpl);
      expect(dependencies.rollbackReadbackImpl().deploymentId).toBe(deploymentId);
      return { code: 'SUCCESSOR_COMMITTED', status: 'committed' };
    },
    runRehearsalImpl: async (_input: unknown, dependencies: any) => {
      calls.push('run-rehearsal');
      rollbackCallbacks.push(dependencies.rollbackReadbackImpl);
      expect(dependencies.rollbackReadbackImpl().deploymentId).toBe(deploymentId);
      return { code: 'SUCCESSOR_REHEARSAL_PASSED', status: 'rolled_back' };
    },
  } as any);
  expect(calls).toEqual([
    'prepare-rehearsal',
    'run-rehearsal',
    'prepare-apply',
    'run-apply',
  ]);
  expect(runtimeObservationCalls).toBe(2);
  expect(rollbackCallbacks).toHaveLength(2);
  expect(rollbackCallbacks[0]).not.toBe(rollbackCallbacks[1]);
  expect(result).toMatchObject({
    code: 'SUCCESSOR_COMMITTED',
    custodyDirectory: realpathSync(custodyDirectory),
    mode: 'apply',
    status: 'committed',
  });
  expect(existsSync(join(custodyDirectory, 'rehearsal-journal.jsonl'))).toBe(true);
});

test('apply rejects a changed second runtime policy before the apply controller', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  const readyRecord = structuredClone(manifestRecord);
  readyRecord.manifest.launchPolicy.state = 'ready';
  let runtimeObservationCalls = 0;
  let applyCalls = 0;
  await expect(runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'apply',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => readyRecord,
    observeRuntimeCompatibilityImpl: async ({ bundleSha256 }: any) => {
      runtimeObservationCalls += 1;
      const observation = runtimeCompatibilityObservation(bundleSha256);
      return runtimeObservationCalls === 1
        ? observation
        : { ...observation, canonicalPolicySha256: 'f'.repeat(64) };
    },
    prepareApplyImpl: ({ custodyDirectory: custody }: any) => ({
      admissionPath: join(custody, 'apply-admission.json'),
      journalPath: join(custody, 'apply-journal.jsonl'),
    }),
    prepareRehearsalImpl: ({ custodyDirectory: custody }: any) => {
      mkdirSync(custody, { mode: 0o700 });
      chmodSync(custody, 0o700);
      const paths = {
        admissionPath: join(custody, 'rehearsal-admission.json'),
        custodyDirectory: custody,
        journalPath: join(custody, 'rehearsal-journal.jsonl'),
        receiptPath: join(custody, 'rehearsal-receipt.json'),
      };
      for (const path of [paths.admissionPath, paths.journalPath, paths.receiptPath]) {
        writeFileSync(path, '{}\n', { mode: 0o600 });
        chmodSync(path, 0o600);
      }
      return paths;
    },
    runApplyImpl: async () => {
      applyCalls += 1;
      return { code: 'SUCCESSOR_COMMITTED', status: 'committed' };
    },
    runRehearsalImpl: async () => ({
      code: 'SUCCESSOR_REHEARSAL_PASSED',
      status: 'rolled_back',
    }),
  } as any)).rejects.toThrow('SUCCESSOR_OPERATING_ORCHESTRATOR_BUNDLE_INVALID');
  expect(runtimeObservationCalls).toBe(2);
  expect(applyCalls).toBe(0);
});

test('apply recaptures machine fences after rehearsal and stops before admission on change', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'vercel-bundle.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  const readyRecord = structuredClone(manifestRecord);
  readyRecord.manifest.launchPolicy.state = 'ready';
  let assemblyCalls = 0;
  let prepareApplyCalls = 0;
  await expect(runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'apply',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => {
      assemblyCalls += 1;
      if (assemblyCalls === 2) throw new Error('AUTOMATIC_REVIEWER_RESUMED');
      return assembled;
    },
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => readyRecord,
    observeRuntimeCompatibilityImpl: observeRuntimeCompatibility,
    prepareApplyImpl: () => {
      prepareApplyCalls += 1;
      throw new Error('unexpected apply admission');
    },
    prepareRehearsalImpl: ({ custodyDirectory: custody }: any) => {
      mkdirSync(custody, { mode: 0o700 });
      chmodSync(custody, 0o700);
      const paths = {
        admissionPath: join(custody, 'rehearsal-admission.json'),
        custodyDirectory: custody,
        journalPath: join(custody, 'rehearsal-journal.jsonl'),
        receiptPath: join(custody, 'rehearsal-receipt.json'),
      };
      for (const path of [paths.admissionPath, paths.journalPath, paths.receiptPath]) {
        writeFileSync(path, '{}\n', { mode: 0o600 });
        chmodSync(path, 0o600);
      }
      return paths;
    },
    runApplyImpl: () => { throw new Error('unexpected apply'); },
    runRehearsalImpl: async () => ({
      code: 'SUCCESSOR_REHEARSAL_PASSED',
      status: 'rolled_back',
    }),
  } as any)).rejects.toThrow('AUTOMATIC_REVIEWER_RESUMED');
  expect(assemblyCalls).toBe(2);
  expect(prepareApplyCalls).toBe(0);
});

test('provenance map hashes canonical source documents without raw provider or query content', async () => {
  const root = privateRoot();
  const bundlePath = join(root, 'bundle.json');
  const custodyDirectory = join(root, 'custody');
  writePrivateCanonical(bundlePath, vercelBundle());
  const assembled = await assembleOperatingEvidence(assemblyOptions() as any);
  await runOperatingOrchestrator({
    custodyDirectory,
    environment: workflowEnvironment(),
    mode: 'rehearsal',
    vercelBundlePath: bundlePath,
  }, {
    assembleImpl: async () => assembled,
    attestationImpl: () => attestation(),
    clock: () => fixedNow,
    loadManifestImpl: () => manifestRecord,
    observeRuntimeCompatibilityImpl: observeRuntimeCompatibility,
    runRehearsalImpl: async () => ({
      code: 'SUCCESSOR_REHEARSAL_PASSED',
      status: 'rolled_back',
    }),
  } as any);
  const attestationBytes = readFileSync(join(custodyDirectory, 'operator-custody-attestation.json'));
  const machineBytes = readFileSync(join(custodyDirectory, 'machine-operating-observations.json'));
  const map = JSON.parse(readFileSync(join(custodyDirectory, 'operating-evidence-map.json'), 'utf8'));
  expect(map.attestationSha256).toBe(sha256(attestationBytes));
  expect(map.machineSha256).toBe(sha256(machineBytes));
  const custodyText = [attestationBytes, machineBytes].map(value => value.toString('utf8')).join('\n');
  expect(custodyText).not.toMatch(/select |cookie|token|credential|query/i);
});
