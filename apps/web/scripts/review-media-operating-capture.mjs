#!/usr/bin/env node
/**
 * Read-only operating evidence capture for the review-media SQL successor.
 *
 * This module deliberately does not write an admission or run SQL. It collects the
 * four currently observable trust boundaries (Git, GitHub freeze, Vercel
 * production identity, and the automatic-reviewer database policy/queue), then
 * fails closed while any required writer fence lacks an independent collector.
 */
import { randomUUID } from 'node:crypto';

import {
  runPsql,
  selectDirectDatabaseTransport,
} from './apply-supabase-migration.mjs';
import {
  currentProtectedMainReadback,
  currentSuccessorGitFacts,
  loadSuccessorManifest,
} from './review-media-sql-successor.mjs';
import {
  RollbackReadbackError,
  TZUDONG_GITHUB_REPOSITORY,
  TZUDONG_PRODUCTION_ALIASES,
  TZUDONG_VERCEL_PROJECT_ID,
  TZUDONG_VERCEL_TEAM_ID,
  captureVercelRollbackReadback,
  createScopedVercelApiTransport,
} from './vercel-rollback-readback.mjs';
import { resolveAdminSessionCookie } from './admin-session.mjs';

const REVISION = /^[0-9a-f]{40}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const MAX_JSON_BYTES = 256 * 1024;
const CAPTURE_WINDOW_MS = 15 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 15_000;
const DEPLOYMENT_PROBE_TIMEOUT_MS = 15_000;
const MAX_CREDENTIAL_BYTES = 32 * 1024;

export const G037_VARIABLE_ENDPOINT =
  '/repos/twoimo/tzudong/actions/variables/G037_WRITE_FREEZE';
export const ADMIN_RECORD_MUTATIONS_HOLD_PROBE_PATH =
  '/api/admin/operating-readback/record-mutations-hold';

const PUBLIC_CODES = new Set([
  'SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID',
  'SUCCESSOR_OPERATING_CAPTURE_ADMIN_SESSION_MISSING',
  'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_INACTIVE',
  'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_MISMATCH',
  'SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_NOT_STOPPED',
  'SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_READ_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_ATTACHED',
  'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_DIRTY',
  'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_READ_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_REVISION_MISMATCH',
  'SUCCESSOR_OPERATING_CAPTURE_DB_AUTHORITY_INVALID',
  'SUCCESSOR_OPERATING_CAPTURE_GITHUB_CONTEXT_INVALID',
  'SUCCESSOR_OPERATING_CAPTURE_GITHUB_CREDENTIAL_MISSING',
  'SUCCESSOR_OPERATING_CAPTURE_GITHUB_FREEZE_INACTIVE',
  'SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_PROTECTED_MAIN_MISMATCH',
  'SUCCESSOR_OPERATING_CAPTURE_PROTECTED_MAIN_READ_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_PROTECTION_BYPASS_MISSING',
  'SUCCESSOR_OPERATING_CAPTURE_SUPABASE_CREDENTIAL_MISSING',
  'SUCCESSOR_OPERATING_CAPTURE_VERCEL_CREDENTIAL_MISSING',
  'SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED',
  'SUCCESSOR_OPERATING_CAPTURE_WINDOW_EXPIRED',
  'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_ADMIN_RECORD_MUTATIONS_HOLD',
  'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_BROWSER_RPC',
  'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_DASHBOARD',
  'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_DIRECT_SQL',
  'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_PROVIDER_INGRESS',
]);

const UNOBSERVABLE_FENCE_CODES = Object.freeze({
  adminRecordMutationsHold:
    'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_ADMIN_RECORD_MUTATIONS_HOLD',
  browserRpc: 'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_BROWSER_RPC',
  dashboard: 'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_DASHBOARD',
  directSql: 'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_DIRECT_SQL',
  providerIngress: 'SUCCESSOR_OPERATING_CAPTURE_FENCE_UNOBSERVABLE_PROVIDER_INGRESS',
});

export const AUTOMATIC_REVIEWER_READBACK_SQL = String.raw`
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
SELECT jsonb_build_object(
  'enabled',coalesce((SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton),true),
  'policyRows',(SELECT count(*) FROM pipeline_control.restaurant_review_policy WHERE singleton),
  'queued',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='queued'),
  'running',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='running')
)::text;
ROLLBACK;
`;

export class OperatingCaptureError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OperatingCaptureError';
    this.code = code;
  }
}

const fail = code => { throw new OperatingCaptureError(code); };

function safeCode(error) {
  try { return typeof error?.code === 'string' ? error.code : ''; } catch { return ''; }
}

function exactObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return exactObject(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function parseBoundedJson(raw, code) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw))) fail(code);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) fail(code);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!exactObject(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof OperatingCaptureError) throw error;
    fail(code);
  }
}

function assertDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  return value;
}

function observedAt(clock) {
  if (typeof clock !== 'function') fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  return assertDate(clock()).toISOString();
}

function assertFreshWindow(createdAt, expiresAt, observations, completedAt) {
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  const completedMs = completedAt.getTime();
  if (!Number.isFinite(createdMs)
    || !Number.isFinite(expiresMs)
    || !Number.isFinite(completedMs)
    || expiresMs - createdMs !== CAPTURE_WINDOW_MS
    || completedMs < createdMs
    || completedMs >= expiresMs
    || observations.some(value => {
      const timestamp = Date.parse(value);
      return !Number.isFinite(timestamp) || timestamp < createdMs || timestamp >= expiresMs;
    })) {
    fail('SUCCESSOR_OPERATING_CAPTURE_WINDOW_EXPIRED');
  }
}

function commonReceipt(manifestRecord, sourceRevision, expiresAt, observed) {
  const { manifest, manifestSha256 } = manifestRecord;
  return {
    expiresAt,
    id: manifest.id,
    manifestSha256,
    observedAt: observed,
    projectRef: manifest.projectRef,
    purpose: manifest.purpose,
    schemaVersion: 1,
    sourceRevision,
  };
}

function requiredCredential(environment, name, code) {
  const value = environment?.[name];
  if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) fail(code);
  return value;
}

/**
 * GitHub REST repository-variable reader. The caller must grant only repository
 * Variables read access. Provider response bodies and diagnostics never escape.
 * https://docs.github.com/en/rest/actions/variables#get-a-repository-variable
 */
export function createGithubVariableTransport({
  fetchImpl = globalThis.fetch,
  timeoutMs = GITHUB_TIMEOUT_MS,
  token = process.env.GITHUB_TOKEN,
} = {}) {
  if (typeof fetchImpl !== 'function'
    || typeof token !== 'string'
    || token.length === 0
    || /[\r\n\0]/.test(token)
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 30_000) {
    fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_CREDENTIAL_MISSING');
  }
  return Object.freeze({
    async request(endpoint) {
      if (endpoint !== G037_VARIABLE_ENDPOINT) {
        fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`https://api.github.com${endpoint}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response || response.status !== 200) {
          fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED');
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) {
          fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED');
        }
        return bytes;
      } catch (error) {
        if (error instanceof OperatingCaptureError) throw error;
        fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export async function captureG037WriteFreeze({
  clock = () => new Date(),
  transport,
} = {}) {
  if (!transport || typeof transport.request !== 'function') {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  let body;
  try {
    body = parseBoundedJson(
      await transport.request(G037_VARIABLE_ENDPOINT),
      'SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED',
    );
  } catch (error) {
    if (error instanceof OperatingCaptureError) throw error;
    fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_VARIABLE_READ_FAILED');
  }
  if (body.name !== 'G037_WRITE_FREEZE' || body.value !== 'active') {
    fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_FREEZE_INACTIVE');
  }
  return Object.freeze({ observedAt: observedAt(clock), state: 'active' });
}

export function createOwnerDatabaseReadback({
  environment = process.env,
  psql = 'psql',
  runPsqlImpl = runPsql,
} = {}) {
  let databaseUrl;
  try {
    ({ databaseUrl } = selectDirectDatabaseTransport(environment));
  } catch {
    fail('SUCCESSOR_OPERATING_CAPTURE_DB_AUTHORITY_INVALID');
  }
  return Object.freeze({
    requestAutomaticReviewer() {
      try {
        return runPsqlImpl(databaseUrl, AUTOMATIC_REVIEWER_READBACK_SQL, false, {
          environment,
          psql,
        });
      } catch {
        fail('SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_READ_FAILED');
      }
    },
  });
}

export async function captureAutomaticReviewer({
  clock = () => new Date(),
  readback,
} = {}) {
  if (!readback || typeof readback.requestAutomaticReviewer !== 'function') {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  let body;
  try {
    body = parseBoundedJson(
      await readback.requestAutomaticReviewer(),
      'SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_READ_FAILED',
    );
  } catch (error) {
    if (error instanceof OperatingCaptureError) throw error;
    fail('SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_READ_FAILED');
  }
  if (body.enabled !== false
    || body.policyRows !== 1
    || body.queued !== 0
    || body.running !== 0) {
    fail('SUCCESSOR_OPERATING_CAPTURE_AUTOMATIC_REVIEWER_NOT_STOPPED');
  }
  return Object.freeze({ observedAt: observedAt(clock), state: 'stopped' });
}

function boundedCredential(value, code) {
  if (typeof value !== 'string') fail(code);
  const credential = value.trim();
  if (credential.length === 0
    || Buffer.byteLength(credential, 'utf8') > MAX_CREDENTIAL_BYTES
    || /[\r\n\0]/.test(credential)) {
    fail(code);
  }
  return credential;
}

function immutableDeploymentProbeUrl(deploymentUrl) {
  let url;
  try { url = new URL(deploymentUrl); } catch {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !/^tzudong-[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  return new URL(ADMIN_RECORD_MUTATIONS_HOLD_PROBE_PATH, url).href;
}

export function createAdminRecordMutationsHoldProbeTransport({
  adminCookie,
  adminCookieResolver = resolveAdminSessionCookie,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  protectionBypassSecret = environment?.VERCEL_AUTOMATION_BYPASS_SECRET,
  timeoutMs = DEPLOYMENT_PROBE_TIMEOUT_MS,
} = {}) {
  const resolvedAdminCookie = boundedCredential(
    adminCookie ?? environment?.INSIGHTS_CHAT_ADMIN_COOKIE ?? adminCookieResolver?.(),
    'SUCCESSOR_OPERATING_CAPTURE_ADMIN_SESSION_MISSING',
  );
  const resolvedBypass = boundedCredential(
    protectionBypassSecret,
    'SUCCESSOR_OPERATING_CAPTURE_PROTECTION_BYPASS_MISSING',
  );
  if (typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > 30_000) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  return Object.freeze({
    async request(deploymentUrl) {
      const url = immutableDeploymentProbeUrl(deploymentUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: {
            Accept: 'application/json',
            Cookie: resolvedAdminCookie,
            'x-vercel-protection-bypass': resolvedBypass,
          },
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response || response.status !== 200) {
          fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED');
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) {
          fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED');
        }
        return bytes;
      } catch (error) {
        if (error instanceof OperatingCaptureError) throw error;
        fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export async function captureAdminRecordMutationsHold({
  clock = () => new Date(),
  deploymentReadback,
  transport,
} = {}) {
  if (!transport || typeof transport.request !== 'function'
    || !exactObject(deploymentReadback)
    || !DEPLOYMENT_ID.test(deploymentReadback.deploymentId ?? '')
    || !REVISION.test(deploymentReadback.gitSha ?? '')
    || typeof deploymentReadback.deploymentUrl !== 'string') {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  let body;
  try {
    body = parseBoundedJson(
      await transport.request(deploymentReadback.deploymentUrl),
      'SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED',
    );
  } catch (error) {
    if (error instanceof OperatingCaptureError) throw error;
    fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_FAILED');
  }
  if (!exactKeys(body, ['commit', 'deploymentId', 'holdActive'])
    || body.deploymentId !== deploymentReadback.deploymentId
    || body.commit !== deploymentReadback.gitSha) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_PROBE_MISMATCH');
  }
  if (body.holdActive !== true) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ADMIN_RECORD_MUTATIONS_HOLD_INACTIVE');
  }
  return Object.freeze({
    commit: body.commit,
    deploymentId: body.deploymentId,
    holdActive: true,
    observedAt: observedAt(clock),
  });
}

/**
 * Resolve the production deployment from the public alias, then delegate the
 * exact deployment and both-alias re-read to the existing rollback validator.
 */
export async function captureCurrentProductionRollback({
  clock = () => new Date(),
  transport,
} = {}) {
  if (!transport || typeof transport.request !== 'function') {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  const aliasEndpoint =
    `/v4/aliases/${TZUDONG_PRODUCTION_ALIASES[0]}?teamId=${TZUDONG_VERCEL_TEAM_ID}`;
  try {
    const alias = parseBoundedJson(
      await transport.request(aliasEndpoint),
      'SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED',
    );
    const nestedId = exactObject(alias.deployment) ? alias.deployment.id : undefined;
    if (alias.alias !== TZUDONG_PRODUCTION_ALIASES[0]
      || alias.projectId !== TZUDONG_VERCEL_PROJECT_ID
      || !DEPLOYMENT_ID.test(alias.deploymentId ?? '')
      || nestedId !== alias.deploymentId) {
      fail('SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED');
    }

    const deployment = parseBoundedJson(
      await transport.request(
        `/v13/deployments/${alias.deploymentId}?teamId=${TZUDONG_VERCEL_TEAM_ID}`,
      ),
      'SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED',
    );
    if (!exactObject(deployment.meta)
      || deployment.id !== alias.deploymentId
      || deployment.projectId !== TZUDONG_VERCEL_PROJECT_ID
      || deployment.ownerId !== TZUDONG_VERCEL_TEAM_ID
      || typeof deployment.url !== 'string'
      || deployment.readyState !== 'READY'
      || deployment.target !== 'production'
      || deployment.meta.githubCommitOrg !== 'twoimo'
      || deployment.meta.githubCommitRepo !== 'tzudong'
      || !REVISION.test(deployment.meta.githubCommitSha ?? '')
      || deployment.meta.githubCommitRef !== 'main') {
      fail('SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED');
    }

    return await captureVercelRollbackReadback({
      expected: {
        deploymentId: deployment.id,
        deploymentUrl: `https://${deployment.url}/`,
        gitRef: deployment.meta.githubCommitRef,
        gitSha: deployment.meta.githubCommitSha,
      },
      now: clock,
      transport,
    });
  } catch (error) {
    if (error instanceof OperatingCaptureError) throw error;
    if (error instanceof RollbackReadbackError) {
      fail('SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED');
    }
    fail('SUCCESSOR_OPERATING_CAPTURE_VERCEL_READBACK_FAILED');
  }
}

export function captureGitEvidence({
  clock = () => new Date(),
  expiresAt,
  gitFactsImpl = currentSuccessorGitFacts,
  manifestRecord,
  protectedMainReadbackImpl = currentProtectedMainReadback,
  sourceRevision,
} = {}) {
  if (!manifestRecord?.manifest
    || !REVISION.test(sourceRevision ?? '')
    || typeof expiresAt !== 'string') {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  let facts;
  try { facts = gitFactsImpl(); } catch {
    fail('SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_READ_FAILED');
  }
  if (facts?.clean !== true) fail('SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_DIRTY');
  if (facts?.detached !== true) fail('SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_ATTACHED');
  if (facts?.revision !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_CAPTURE_CHECKOUT_REVISION_MISMATCH');
  }

  let protectedMain;
  try { protectedMain = protectedMainReadbackImpl(manifestRecord.manifest); } catch {
    fail('SUCCESSOR_OPERATING_CAPTURE_PROTECTED_MAIN_READ_FAILED');
  }
  const expectedProtected = manifestRecord.manifest.protectedSource;
  if (protectedMain?.schemaVersion !== 1
    || protectedMain?.projectRef !== manifestRecord.manifest.projectRef
    || protectedMain?.remote !== expectedProtected.remote
    || protectedMain?.ref !== expectedProtected.ref
    || protectedMain?.repositoryUrl !== expectedProtected.repositoryUrl
    || protectedMain?.revision !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_CAPTURE_PROTECTED_MAIN_MISMATCH');
  }

  const observed = observedAt(clock);
  const common = commonReceipt(manifestRecord, sourceRevision, expiresAt, observed);
  return Object.freeze({
    checkoutReadback: Object.freeze({
      clean: true,
      detached: true,
      expiresAt,
      kind: 'successor-checkout-readback',
      observedAt: observed,
      revision: sourceRevision,
      schemaVersion: 1,
    }),
    protectedMainReceipt: Object.freeze({
      ...common,
      kind: 'protected-main-readback-receipt',
      ref: expectedProtected.ref,
      remote: expectedProtected.remote,
      repositoryUrl: expectedProtected.repositoryUrl,
      revision: sourceRevision,
    }),
    sourceReceipt: Object.freeze({
      ...common,
      kind: 'successor-source-receipt',
      sourceRoot: manifestRecord.manifest.sourceRoot,
    }),
  });
}

function assertRuntimeAuthority(environment, sourceRevision, manifest) {
  const databaseUrl = requiredCredential(
    environment,
    'SUPABASE_DB_URL',
    'SUCCESSOR_OPERATING_CAPTURE_SUPABASE_CREDENTIAL_MISSING',
  );
  requiredCredential(
    environment,
    'VERCEL_TOKEN',
    'SUCCESSOR_OPERATING_CAPTURE_VERCEL_CREDENTIAL_MISSING',
  );
  requiredCredential(
    environment,
    'GITHUB_TOKEN',
    'SUCCESSOR_OPERATING_CAPTURE_GITHUB_CREDENTIAL_MISSING',
  );
  if (typeof environment.SUPABASE_G037_READONLY_DB_URL === 'string'
    && environment.SUPABASE_G037_READONLY_DB_URL.length > 0
    && databaseUrl === environment.SUPABASE_G037_READONLY_DB_URL) {
    fail('SUCCESSOR_OPERATING_CAPTURE_DB_AUTHORITY_INVALID');
  }
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || environment.GITHUB_REPOSITORY !== TZUDONG_GITHUB_REPOSITORY
    || environment.GITHUB_REF !== manifest.protectedSource.ref
    || environment.GITHUB_SHA !== sourceRevision) {
    fail('SUCCESSOR_OPERATING_CAPTURE_GITHUB_CONTEXT_INVALID');
  }
}

function rollbackReceipt(readback, manifestRecord, sourceRevision, expiresAt) {
  return Object.freeze({
    ...commonReceipt(
      manifestRecord,
      sourceRevision,
      expiresAt,
      readback.observedAt,
    ),
    deploymentId: readback.deploymentId,
    deploymentSha: readback.gitSha,
    deploymentUrl: readback.deploymentUrl,
    gitRef: readback.gitRef,
    kind: 'rollback-readback-receipt',
    productionAliases: [...readback.productionAliases],
    projectId: readback.projectId,
    readyState: readback.readyState,
    repository: readback.repository,
    state: 'ready',
    target: readback.target,
    teamId: readback.teamId,
  });
}

function writerFenceReceipt(
  fence,
  state,
  observed,
  manifestRecord,
  sourceRevision,
  expiresAt,
) {
  return Object.freeze({
    ...commonReceipt(manifestRecord, sourceRevision, expiresAt, observed),
    fence,
    kind: 'writer-fence-readback-receipt',
    state,
  });
}

function partialWriterFenceReceipt(
  observation,
  manifestRecord,
  sourceRevision,
  expiresAt,
) {
  return Object.freeze({
    ...commonReceipt(
      manifestRecord,
      sourceRevision,
      expiresAt,
      observation.observedAt,
    ),
    commit: observation.commit,
    deploymentId: observation.deploymentId,
    fence: 'adminRecordMutationsHold',
    holdActive: observation.holdActive,
    kind: 'writer-fence-partial-readback-receipt',
    remainingCondition: 'inFlightQuiescence',
  });
}

/**
 * Capture every currently machine-observable input. No secret value or provider
 * response is returned. This is read-only and does not create custody files.
 */
export async function captureObservableOperatingEvidence({
  adminHoldProbeTransport,
  clock = () => new Date(),
  databaseReadback,
  environment = process.env,
  gitFactsImpl = currentSuccessorGitFacts,
  githubTransport,
  manifestRecord = loadSuccessorManifest(),
  protectedMainReadbackImpl = currentProtectedMainReadback,
  sourceRevision = environment?.GITHUB_SHA,
  vercelTransport,
} = {}) {
  if (!REVISION.test(sourceRevision ?? '')) {
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  assertRuntimeAuthority(environment, sourceRevision, manifestRecord.manifest);
  const created = assertDate(clock());
  const createdAt = created.toISOString();
  const expiresAt = new Date(created.getTime() + CAPTURE_WINDOW_MS).toISOString();

  const git = captureGitEvidence({
    clock,
    expiresAt,
    gitFactsImpl,
    manifestRecord,
    protectedMainReadbackImpl,
    sourceRevision,
  });
  const automaticReviewer = await captureAutomaticReviewer({
    clock,
    readback: databaseReadback ?? createOwnerDatabaseReadback({ environment }),
  });
  const rollback = await captureCurrentProductionRollback({
    clock,
    transport: vercelTransport ?? createScopedVercelApiTransport(),
  });
  const adminRecordMutationsHold = await captureAdminRecordMutationsHold({
    clock,
    deploymentReadback: rollback,
    transport: adminHoldProbeTransport
      ?? createAdminRecordMutationsHoldProbeTransport({ environment }),
  });
  const freeze = await captureG037WriteFreeze({
    clock,
    transport: githubTransport ?? createGithubVariableTransport({
      token: environment.GITHUB_TOKEN,
    }),
  });
  assertFreshWindow(
    createdAt,
    expiresAt,
    [
      git.checkoutReadback.observedAt,
      automaticReviewer.observedAt,
      rollback.observedAt,
      adminRecordMutationsHold.observedAt,
      freeze.observedAt,
    ],
    assertDate(clock()),
  );
  return Object.freeze({
    attemptId: randomUUID(),
    checkoutReadback: git.checkoutReadback,
    createdAt,
    expiresAt,
    kind: 'review-media-successor-observable-evidence',
    manifestSha256: manifestRecord.manifestSha256,
    partialWriterFenceReceipts: Object.freeze({
      adminRecordMutationsHold: partialWriterFenceReceipt(
        adminRecordMutationsHold,
        manifestRecord,
        sourceRevision,
        expiresAt,
      ),
    }),
    protectedMainReceipt: git.protectedMainReceipt,
    rollbackReadbackReceipt: rollbackReceipt(
      rollback,
      manifestRecord,
      sourceRevision,
      expiresAt,
    ),
    schemaVersion: 1,
    sourceReceipt: git.sourceReceipt,
    sourceRevision,
    sourceRoot: manifestRecord.manifest.sourceRoot,
    writerFenceReceipts: Object.freeze({
      automaticReviewer: writerFenceReceipt(
        'automaticReviewer',
        automaticReviewer.state,
        automaticReviewer.observedAt,
        manifestRecord,
        sourceRevision,
        expiresAt,
      ),
      g037WriteFreeze: writerFenceReceipt(
        'g037WriteFreeze',
        freeze.state,
        freeze.observedAt,
        manifestRecord,
        sourceRevision,
        expiresAt,
      ),
    }),
  });
}

/**
 * A complete admission input cannot be produced until every external writer has
 * an independent observation path. The deterministic first missing fence is
 * reported after all existing collectors have completed.
 */
export async function captureReviewMediaOperatingInput(options = {}) {
  await captureObservableOperatingEvidence(options);
  const manifestRecord = options.manifestRecord ?? loadSuccessorManifest();
  for (const fence of Object.keys(manifestRecord.manifest.requiredWriterFences).sort()) {
    if (fence === 'automaticReviewer' || fence === 'g037WriteFreeze') continue;
    const code = UNOBSERVABLE_FENCE_CODES[fence];
    if (code) fail(code);
    fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
  }
  fail('SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID');
}

export function operatingCaptureFailureResult(error) {
  const code = PUBLIC_CODES.has(safeCode(error))
    ? error.code
    : 'SUCCESSOR_OPERATING_CAPTURE_ARGUMENT_INVALID';
  return Object.freeze({ code, status: 'failed' });
}
