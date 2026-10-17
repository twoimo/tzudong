import { createHash } from 'node:crypto';
import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const {
  createStoryboardPolicyReadbackResponse,
  evaluateStoryboardRuntimePolicy,
} = await import('../app/api/admin/operating-readback/storyboard-policy/readback-response');
const { calculateStoryboardRuntimeSourceBinding } = await import(
  '../lib/admin/storyboard/runtime-source-binding'
);

const deploymentId = 'dpl_StoryboardPolicyReadbackFixture123';
const sourceCommit = 'b'.repeat(40);
const projectId = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const sourceBindingSha256 = calculateStoryboardRuntimeSourceBinding().sha256;

function runtimeEnvironment() {
  return {
    VERCEL: '1',
    VERCEL_DEPLOYMENT_ID: deploymentId,
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_REF: 'main',
    VERCEL_GIT_COMMIT_SHA: sourceCommit,
    VERCEL_PROJECT_ID: projectId,
    VERCEL_TARGET_ENV: 'production',
  };
}

test('authenticates first and binds the evaluated Gemini-only policy to every source path and deployment', async () => {
  let authenticated = false;
  let policyEvaluated = false;
  const accesses: string[] = [];
  const environment = new Proxy(runtimeEnvironment(), {
    get(target, property, receiver) {
      expect(authenticated).toBe(true);
      accesses.push(String(property));
      return Reflect.get(target, property, receiver);
    },
  });

  const response = await createStoryboardPolicyReadbackResponse({
    environment,
    evaluatePolicy: (receivedSourceBindingSha256) => {
      expect(authenticated).toBe(true);
      expect(receivedSourceBindingSha256).toBe(sourceBindingSha256);
      policyEvaluated = true;
      return evaluateStoryboardRuntimePolicy(receivedSourceBindingSha256);
    },
    requireAdminImpl: async () => {
      expect(accesses).toEqual([]);
      expect(policyEvaluated).toBe(false);
      authenticated = true;
      return { ok: true, userId: 'must-not-be-returned' };
    },
    sourceBindingSha256,
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  const body = await response.json();
  const canonicalPolicy = {
    defaultImageModel: 'gemini-3.1-flash-image',
    executionWorkflow: 'storyboard-gemini-v1',
    featureDatabaseAdmission: 'required',
    imageModels: ['gemini-3.1-flash-image', 'gemini-3-pro-image'],
    legacyExecutionAdmission: 'blocked',
    provider: 'gemini-api',
    readableLegacyWorkflow: 'storyboard-mlx-v1',
    sourceBindingSchemaVersion: 1,
    sourceBindingSha256,
    textModels: ['gemini-3.8-flash'],
  };
  const expectedHash = createHash('sha256').update(JSON.stringify(canonicalPolicy), 'utf8').digest('hex');
  expect(body.deployment).toEqual({ branch: 'main', deploymentId, projectId, sourceCommit });
  expect(body.policy).toEqual({ ...canonicalPolicy, canonicalPolicySha256: expectedHash });
  expect(body.executionPaths).toEqual([
    ['declared-models', 'apps/web/lib/admin/storyboard/gemini-models.ts'],
    ['production-request-admission', 'apps/web/lib/admin/storyboard/production-contract.ts'],
    ['worker-heartbeat-admission', 'apps/web/lib/admin/storyboard/production-worker-auth.ts'],
    ['outbound-worker-execution', 'apps/web/lib/admin/storyboard/outbound-worker.ts'],
    ['production-store-admission', 'apps/web/lib/admin/storyboard/production-store.ts'],
    ['production-api-admission', 'apps/web/lib/admin/storyboard/production-api.ts'],
    ['gemini-client-execution', 'apps/web/lib/admin/storyboard/gemini-client.ts'],
    ['feature-database-admission', 'apps/web/lib/server/runtime-feature-readiness.ts'],
  ].map(([id, sourcePath]) => ({ canonicalPolicySha256: expectedHash, deploymentId, id, sourceCommit, sourcePath })));
  expect(body.verification).toEqual({
    databaseCutover: 'not-verified',
    outboundProviderCall: 'not-performed',
    providerAccess: 'not-verified',
    runtimePolicyEvaluated: true,
  });
  expect(JSON.stringify(body)).not.toContain('must-not-be-returned');
});

test('does not inspect deployment or policy for an unauthenticated request', async () => {
  const environment = new Proxy(runtimeEnvironment(), {
    get() { throw new Error('deployment must remain unread'); },
  });
  const response = await createStoryboardPolicyReadbackResponse({
    environment,
    evaluatePolicy: () => { throw new Error('policy must remain unevaluated'); },
    requireAdminImpl: async () => ({ ok: false, response: new Response(null, { status: 401 }) } as any),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: 'STORYBOARD_POLICY_READBACK_UNAUTHORIZED' });
});

test('maps non-401 authorization failures to one fixed forbidden response', async () => {
  const response = await createStoryboardPolicyReadbackResponse({
    environment: new Proxy(runtimeEnvironment(), { get() { throw new Error('deployment must remain unread'); } }),
    requireAdminImpl: async () => ({ ok: false, response: new Response(null, { status: 500 }) } as any),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: 'STORYBOARD_POLICY_READBACK_FORBIDDEN' });
});

test('returns a fixed error when admin authentication is unavailable', async () => {
  const response = await createStoryboardPolicyReadbackResponse({
    environment: new Proxy(runtimeEnvironment(), { get() { throw new Error('deployment must remain unread'); } }),
    requireAdminImpl: async () => { throw new Error('secret auth diagnostic'); },
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'STORYBOARD_POLICY_READBACK_AUTH_UNAVAILABLE' });
});

test('fails closed before policy evaluation when the production deployment identity is not exact', async () => {
  let policyEvaluated = false;
  const response = await createStoryboardPolicyReadbackResponse({
    environment: { ...runtimeEnvironment(), VERCEL_GIT_COMMIT_REF: 'develop' },
    evaluatePolicy: (binding) => { policyEvaluated = true; return evaluateStoryboardRuntimePolicy(binding); },
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
  });
  expect(policyEvaluated).toBe(false);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'STORYBOARD_POLICY_READBACK_RUNTIME_UNAVAILABLE' });
});

test('fails closed with a fixed response when runtime policy evaluation drifts', async () => {
  const secretMarker = 'private-policy-diagnostic';
  const response = await createStoryboardPolicyReadbackResponse({
    environment: runtimeEnvironment(),
    evaluatePolicy: () => { throw new Error(secretMarker); },
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
  });
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body).toEqual({ code: 'STORYBOARD_POLICY_READBACK_POLICY_UNAVAILABLE' });
  expect(JSON.stringify(body)).not.toContain(secretMarker);
});

test('evaluates the exact shared policy without performing provider or database work', () => {
  const first = evaluateStoryboardRuntimePolicy(sourceBindingSha256);
  const second = evaluateStoryboardRuntimePolicy(sourceBindingSha256);
  expect(first).toEqual(second);
  expect(first.canonicalPolicySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(first.canonicalPolicy.provider).toBe('gemini-api');
  expect(first.canonicalPolicy.textModels).toEqual(['gemini-3.8-flash']);
  expect(first.canonicalPolicy.imageModels).toEqual(['gemini-3.1-flash-image', 'gemini-3-pro-image']);
  expect(first.canonicalPolicy.legacyExecutionAdmission).toBe('blocked');
  expect(first.canonicalPolicy.sourceBindingSha256).toBe(sourceBindingSha256);
});

test('fails closed when the build-time execution-source binding is unavailable', async () => {
  const response = await createStoryboardPolicyReadbackResponse({
    environment: runtimeEnvironment(),
    requireAdminImpl: async () => ({ ok: true, userId: 'admin-fixture' }),
    sourceBindingSha256: '',
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'STORYBOARD_POLICY_READBACK_POLICY_UNAVAILABLE' });
});
