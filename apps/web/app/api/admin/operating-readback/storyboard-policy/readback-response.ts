import 'server-only';

import { NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { evaluateStoryboardRuntimePolicy } from '@/lib/admin/storyboard/runtime-policy';

const TZUDONG_VERCEL_PROJECT_ID = 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl';
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
});

const POLICY_SOURCE_PATHS = Object.freeze([
  ['declared-models', 'apps/web/lib/admin/storyboard/gemini-models.ts'],
  ['production-request-admission', 'apps/web/lib/admin/storyboard/production-contract.ts'],
  ['worker-heartbeat-admission', 'apps/web/lib/admin/storyboard/production-worker-auth.ts'],
  ['outbound-worker-execution', 'apps/web/lib/admin/storyboard/outbound-worker.ts'],
  ['production-store-admission', 'apps/web/lib/admin/storyboard/production-store.ts'],
  ['production-api-admission', 'apps/web/lib/admin/storyboard/production-api.ts'],
  ['gemini-client-execution', 'apps/web/lib/admin/storyboard/gemini-client.ts'],
  ['feature-database-admission', 'apps/web/lib/server/runtime-feature-readiness.ts'],
] as const);

type AdminResult = Awaited<ReturnType<typeof requireAdmin>>;
type RequireAdmin = () => Promise<AdminResult>;

function fixedResponse(code: string, status: number) {
  return NextResponse.json({ code }, { headers: PRIVATE_HEADERS, status });
}

function fixedAuthFailure(response: NextResponse) {
  const status = response.status === 401 ? 401 : 403;
  return fixedResponse(
    status === 401 ? 'STORYBOARD_POLICY_READBACK_UNAUTHORIZED' : 'STORYBOARD_POLICY_READBACK_FORBIDDEN',
    status,
  );
}

function readRuntimeIdentity(environment: NodeJS.ProcessEnv) {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim() ?? '';
  const sourceCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  if (environment.VERCEL !== '1'
    || environment.VERCEL_ENV !== 'production'
    || environment.VERCEL_TARGET_ENV !== 'production'
    || environment.VERCEL_PROJECT_ID !== TZUDONG_VERCEL_PROJECT_ID
    || environment.VERCEL_GIT_COMMIT_REF !== 'main'
    || !DEPLOYMENT_ID.test(deploymentId)
    || !GIT_SHA.test(sourceCommit)) {
    return null;
  }
  return Object.freeze({
    branch: 'main' as const,
    deploymentId,
    projectId: TZUDONG_VERCEL_PROJECT_ID,
    sourceCommit,
  });
}

export { evaluateStoryboardRuntimePolicy };

type PolicyEvaluation = ReturnType<typeof evaluateStoryboardRuntimePolicy>;

function responseAfterAuthentication(
  auth: AdminResult,
  environment: NodeJS.ProcessEnv,
  evaluatePolicy: (sourceBindingSha256: string) => PolicyEvaluation,
  sourceBindingSha256: string,
) {
  if (!auth.ok) return fixedAuthFailure(auth.response);

  const deployment = readRuntimeIdentity(environment);
  if (!deployment) return fixedResponse('STORYBOARD_POLICY_READBACK_RUNTIME_UNAVAILABLE', 503);

  let evaluated: PolicyEvaluation;
  try {
    evaluated = evaluatePolicy(sourceBindingSha256);
  } catch {
    return fixedResponse('STORYBOARD_POLICY_READBACK_POLICY_UNAVAILABLE', 503);
  }
  const executionPaths = POLICY_SOURCE_PATHS.map(([id, sourcePath]) => ({
    canonicalPolicySha256: evaluated.canonicalPolicySha256,
    deploymentId: deployment.deploymentId,
    id,
    sourceCommit: deployment.sourceCommit,
    sourcePath,
  }));

  return NextResponse.json({
    schemaVersion: 1,
    deployment,
    policy: {
      ...evaluated.canonicalPolicy,
      canonicalPolicySha256: evaluated.canonicalPolicySha256,
    },
    executionPaths,
    verification: {
      databaseCutover: 'not-verified',
      outboundProviderCall: 'not-performed',
      providerAccess: 'not-verified',
      runtimePolicyEvaluated: true,
    },
  }, { headers: PRIVATE_HEADERS, status: 200 });
}

export async function createStoryboardPolicyReadbackResponse({
  environment = process.env,
  evaluatePolicy = evaluateStoryboardRuntimePolicy,
  requireAdminImpl = requireAdmin,
  sourceBindingSha256 = process.env.STORYBOARD_RUNTIME_SOURCE_BINDING_SHA256 ?? '',
}: {
  environment?: NodeJS.ProcessEnv;
  evaluatePolicy?: (sourceBindingSha256: string) => PolicyEvaluation;
  requireAdminImpl?: RequireAdmin;
  sourceBindingSha256?: string;
} = {}) {
  let auth: AdminResult;
  try {
    auth = await requireAdminImpl();
  } catch {
    return fixedResponse('STORYBOARD_POLICY_READBACK_AUTH_UNAVAILABLE', 503);
  }
  return responseAfterAuthentication(auth, environment, evaluatePolicy, sourceBindingSha256);
}
