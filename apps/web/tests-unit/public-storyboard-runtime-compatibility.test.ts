import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const {
  createPublicStoryboardCompatibilityResponse,
  publicStoryboardCanonicalPolicySha256,
} = await import('../app/api/runtime-compatibility/storyboard/runtime-response');
const { evaluateStoryboardRuntimePolicy } = await import(
  '../app/api/admin/operating-readback/storyboard-policy/readback-response'
);
const { calculateStoryboardRuntimeSourceBinding } = await import(
  '../lib/admin/storyboard/runtime-source-binding'
);

const deploymentId = 'dpl_PublicStoryboardRuntimeFixture123';
const commit = 'c'.repeat(40);
const sourceBindingSha256 = calculateStoryboardRuntimeSourceBinding().sha256;

function productionEnvironment() {
  return {
    VERCEL: '1',
    VERCEL_DEPLOYMENT_ID: deploymentId,
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_REF: 'main',
    VERCEL_GIT_COMMIT_SHA: commit,
    VERCEL_PROJECT_ID: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
    VERCEL_TARGET_ENV: 'production',
  };
}

test('returns only deployment identity and the code-shared canonical policy hash', async () => {
  const expectedPolicySha256 = evaluateStoryboardRuntimePolicy(sourceBindingSha256).canonicalPolicySha256;
  const response = createPublicStoryboardCompatibilityResponse({
    environment: productionEnvironment(), sourceBindingSha256,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility',
    deploymentId,
    commit,
    canonicalPolicySha256: expectedPolicySha256,
  });
  expect(publicStoryboardCanonicalPolicySha256(sourceBindingSha256)).toBe(expectedPolicySha256);
});

test('does not expose model, provider, database, account, quota, hold, or readiness claims', async () => {
  const response = createPublicStoryboardCompatibilityResponse({
    environment: productionEnvironment(), sourceBindingSha256,
  });
  const serialized = JSON.stringify(await response.json());
  for (const forbidden of [
    'gemini', 'model', 'provider', 'database', 'account', 'quota', 'hold', 'ready', 'key', 'token', 'user',
  ]) expect(serialized.toLowerCase()).not.toContain(forbidden);
});

test('fails closed with one fixed response outside the exact production main deployment', async () => {
  const mutations = [
    { VERCEL: '0' },
    { VERCEL_ENV: 'preview' },
    { VERCEL_TARGET_ENV: 'preview' },
    { VERCEL_PROJECT_ID: 'prj_wrong' },
    { VERCEL_GIT_COMMIT_REF: 'develop' },
    { VERCEL_DEPLOYMENT_ID: 'deployment-secret-diagnostic' },
    { VERCEL_GIT_COMMIT_SHA: 'commit-secret-diagnostic' },
  ];
  for (const mutation of mutations) {
    let policyRead = false;
    const response = createPublicStoryboardCompatibilityResponse({
      environment: { ...productionEnvironment(), ...mutation },
      policySha256: () => { policyRead = true; return 'a'.repeat(64); },
    });
    expect(policyRead).toBe(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      kind: 'storyboard-runtime-compatibility-unavailable',
    });
  }
});

test('fails closed without leaking policy evaluation diagnostics', async () => {
  const response = createPublicStoryboardCompatibilityResponse({
    environment: productionEnvironment(),
    policySha256: () => { throw new Error('private provider diagnostic'); },
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-unavailable',
  });
});

test('fails closed when the build-time execution-source binding is missing or malformed', async () => {
  for (const sourceBindingSha256 of ['', 'a'.repeat(63), 'not-a-source-binding']) {
    const response = createPublicStoryboardCompatibilityResponse({
      environment: productionEnvironment(), sourceBindingSha256,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      kind: 'storyboard-runtime-compatibility-unavailable',
    });
  }
});

test('rejects a malformed policy digest even when deployment identity is valid', async () => {
  const response = createPublicStoryboardCompatibilityResponse({
    environment: productionEnvironment(),
    policySha256: () => 'not-a-policy-digest',
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    schemaVersion: 1,
    kind: 'storyboard-runtime-compatibility-unavailable',
  });
});
