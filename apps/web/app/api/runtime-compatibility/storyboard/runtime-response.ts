import 'server-only';

import { NextResponse } from 'next/server';

import { evaluateStoryboardRuntimePolicy } from '@/lib/admin/storyboard/runtime-policy';

const TZUDONG_VERCEL_PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
});
const SCHEMA_VERSION = 1;
const KIND = 'storyboard-runtime-compatibility';

function unavailable() {
  return NextResponse.json(
    { schemaVersion: SCHEMA_VERSION, kind: 'storyboard-runtime-compatibility-unavailable' },
    { headers: NO_STORE_HEADERS, status: 503 },
  );
}

function runtimeIdentity(environment: NodeJS.ProcessEnv) {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim() ?? '';
  const commit = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  if (environment.VERCEL !== '1'
    || environment.VERCEL_ENV !== 'production'
    || environment.VERCEL_TARGET_ENV !== 'production'
    || environment.VERCEL_PROJECT_ID !== TZUDONG_VERCEL_PROJECT_ID
    || environment.VERCEL_GIT_COMMIT_REF !== 'main'
    || !DEPLOYMENT_ID.test(deploymentId)
    || !GIT_SHA.test(commit)) return null;
  return Object.freeze({ commit, deploymentId });
}

/** Evaluates code-shared admission only. It performs no provider, database, or network operation. */
export function publicStoryboardCanonicalPolicySha256(sourceBindingSha256: string): string {
  return evaluateStoryboardRuntimePolicy(sourceBindingSha256).canonicalPolicySha256;
}

export function createPublicStoryboardCompatibilityResponse({
  environment = process.env,
  policySha256 = publicStoryboardCanonicalPolicySha256,
  sourceBindingSha256 = process.env.STORYBOARD_RUNTIME_SOURCE_BINDING_SHA256 ?? '',
}: {
  environment?: NodeJS.ProcessEnv;
  policySha256?: (sourceBindingSha256: string) => string;
  sourceBindingSha256?: string;
} = {}) {
  const identity = runtimeIdentity(environment);
  if (!identity) return unavailable();

  let canonicalPolicySha256: string;
  try {
    canonicalPolicySha256 = policySha256(sourceBindingSha256);
  } catch {
    return unavailable();
  }
  if (!/^[0-9a-f]{64}$/.test(canonicalPolicySha256)) return unavailable();

  return NextResponse.json({
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    deploymentId: identity.deploymentId,
    commit: identity.commit,
    canonicalPolicySha256,
  }, { headers: NO_STORE_HEADERS, status: 200 });
}
