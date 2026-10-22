/** A bounded producer receipt check. The caller must bind the exact Actions artifact to its run. */
export const MAX_HOSTED_RECEIPT_BYTES = 4 * 1024;
// Conservative display admission bounds, not measured latency or artifact retention guarantees.
const MAX_RUN_AGE_MS = 36 * 60 * 60 * 1000;
const MAX_RUN_DURATION_MS = 24 * 60 * 60 * 1000;
const ELAPSED_TOLERANCE_MS = 10 * 1000;
const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);
const RUN_NUMBER = /^[1-9][0-9]{0,15}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HEAD_SHA = /^[0-9a-f]{40}$/;
const BRANCH_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/;

export type ExpectedHostedRun = {
  runId: string;
  runAttempt: string;
  headSha: string;
  workflow: string;
  ref: string;
  workflowStartedAt: string;
  workflowCompletedAt: string;
  now: string;
};

export type HostedPipelineReceiptView = {
  source: 'github_actions';
  runId: string;
  runAttempt: string;
  headSha: string;
  workflow: string;
  ref: string;
  localExecutionId: string;
  runnerFileSha256: string;
  startedAt: string;
  finishedAt: string;
  receiptGeneratedAt: string;
  elapsedMs: number;
  limit: number;
  newVideoLimit?: number;
  dryRun: boolean;
  reviewRequested: boolean;
  reviewConfirmed: boolean;
  stage: 'preflight' | 'evaluation' | 'pending_preview' | 'pending_apply' | 'review_followup' | 'finished';
  state: 'failed' | 'dry_run' | 'review_unconfirmed' | 'execution_completed';
  exitCode: number;
  evaluateExit?: number;
  applyExit?: number;
  publicationVerified: false;
};

export type HostedPipelineReceiptResult =
  | { status: 'metadata_matched'; view: HostedPipelineReceiptView }
  | { status: 'unavailable' | 'invalid' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runNumber(value: unknown): value is string {
  return typeof value === 'string' && RUN_NUMBER.test(value) && Number.isSafeInteger(Number(value));
}

function branchRef(value: unknown): value is string {
  return typeof value === 'string' && BRANCH_REF.test(value) && !value.includes('..')
    && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.');
}

function utcTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= MIN_TIMESTAMP_MS && time < MAX_TIMESTAMP_MS
    && new Date(time).toISOString().slice(0, 19) === match[1] ? time : null;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function exit(value: unknown): value is number {
  return integer(value, -255, 255);
}

function expectedRun(value: ExpectedHostedRun): { started: number; completed: number; now: number } | null {
  if (!record(value) || !runNumber(value.runId) || !runNumber(value.runAttempt)
      || typeof value.headSha !== 'string' || !HEAD_SHA.test(value.headSha)
      || value.workflow !== 'Crawler' || !branchRef(value.ref)) return null;
  const started = utcTime(value.workflowStartedAt);
  const completed = utcTime(value.workflowCompletedAt);
  const now = utcTime(value.now);
  if (started === null || completed === null || now === null || completed < started
      || completed - started > MAX_RUN_DURATION_MS || completed > now) return null;
  return { started, completed, now };
}

/** `metadata_matched` checks only receipt contents, never artifact ownership or publication. */
export function parseHostedPipelineReceipt(
  bytes: Uint8Array | null | undefined,
  expected: ExpectedHostedRun,
): HostedPipelineReceiptResult {
  const window = expectedRun(expected);
  if (!window || bytes === null || bytes === undefined) return { status: 'unavailable' };
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_HOSTED_RECEIPT_BYTES) {
    return { status: 'invalid' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { status: 'invalid' };
  }
  if (!record(parsed) || parsed.schemaVersion !== 1) return { status: 'invalid' };
  if (parsed.source !== 'github_actions') return { status: 'invalid' };
  // Older schema-v1 receipts have no Actions metadata. Do not guess from a workflow conclusion.
  if (parsed.githubMetadataStatus === undefined || parsed.githubMetadataStatus === 'unavailable') {
    return parsed.github === undefined ? { status: 'unavailable' } : { status: 'invalid' };
  }
  if (parsed.githubMetadataStatus !== 'metadata_available' || !record(parsed.github)) return { status: 'invalid' };
  const github = parsed.github;
  if (!runNumber(github.runId) || !runNumber(github.runAttempt)
      || typeof github.headSha !== 'string' || !HEAD_SHA.test(github.headSha)
      || github.workflow !== 'Crawler' || !branchRef(github.ref)
      || github.runId !== expected.runId || github.runAttempt !== expected.runAttempt
      || github.headSha !== expected.headSha || github.workflow !== expected.workflow
      || github.ref !== expected.ref) return { status: 'invalid' };

  const started = utcTime(parsed.startedAt);
  const finished = utcTime(parsed.finishedAt);
  const generated = utcTime(parsed.generatedAt);
  if (started === null || finished === null || generated === null || finished < started
      || finished - started > MAX_RUN_DURATION_MS || started < window.started
      || finished > window.completed || generated < finished || generated > window.completed
      || window.now - window.completed > MAX_RUN_AGE_MS
      || !integer(parsed.elapsedMs, 0, MAX_RUN_DURATION_MS)
      || Math.abs(finished - started - parsed.elapsedMs) > ELAPSED_TOLERANCE_MS) {
    return { status: window.now - window.completed > MAX_RUN_AGE_MS ? 'unavailable' : 'invalid' };
  }
  if (typeof parsed.executionId !== 'string' || !UUID.test(parsed.executionId)
      || typeof parsed.runnerSha256 !== 'string' || !SHA256.test(parsed.runnerSha256)
      || !integer(parsed.limit, 1, 3) || typeof parsed.dryRun !== 'boolean'
      || typeof parsed.reviewRequested !== 'boolean' || typeof parsed.reviewConfirmed !== 'boolean'
      || parsed.publicationVerified !== false || !exit(parsed.exitCode)) return { status: 'invalid' };
  const stages = ['preflight', 'evaluation', 'pending_preview', 'pending_apply', 'review_followup', 'finished'] as const;
  const states = ['failed', 'dry_run', 'review_unconfirmed', 'execution_completed'] as const;
  if (!stages.includes(parsed.stage as typeof stages[number])
      || !states.includes(parsed.state as typeof states[number])) return { status: 'invalid' };
  const stage = parsed.stage as HostedPipelineReceiptView['stage'];
  const state = parsed.state as HostedPipelineReceiptView['state'];
  const newVideoLimit = parsed.newVideoLimit;
  const evaluateExit = parsed.evaluateExit;
  const applyExit = parsed.applyExit;
  if ((parsed.dryRun && !['preflight', 'evaluation', 'pending_preview'].includes(stage))
      || (newVideoLimit !== undefined && !integer(newVideoLimit, 0, 3))
      || (evaluateExit !== undefined && !exit(evaluateExit))
      // The required apply subprocess throws before assigning a nonzero applyExit.
      || (applyExit !== undefined && applyExit !== 0)
      || parsed.reviewConfirmed && (!parsed.reviewRequested || parsed.dryRun)
      || (stage === 'preflight'
        ? newVideoLimit !== undefined || evaluateExit !== undefined || applyExit !== undefined || parsed.reviewConfirmed
        : newVideoLimit === undefined || newVideoLimit > parsed.limit || evaluateExit === undefined && stage !== 'evaluation')
      || (stage !== 'preflight' && stage !== 'evaluation' && evaluateExit !== 0)
      || (stage === 'preflight' || stage === 'evaluation' || stage === 'pending_preview') && applyExit !== undefined
      || (stage === 'review_followup' && (!parsed.reviewRequested || !parsed.reviewConfirmed || applyExit !== 0))
      || (stage === 'finished' && (evaluateExit !== 0 || applyExit !== 0))
      || (state === 'failed' && (parsed.exitCode === 0 || stage === 'finished'
        || stage === 'evaluation' && evaluateExit !== undefined && evaluateExit !== parsed.exitCode))
      || (state === 'dry_run' && (stage !== 'pending_preview' || parsed.exitCode !== 0
        || !parsed.dryRun || evaluateExit !== 0 || applyExit !== undefined || parsed.reviewConfirmed))
      || (state === 'review_unconfirmed' && (stage !== 'pending_apply' || parsed.exitCode !== 1
        || parsed.dryRun || !parsed.reviewRequested || parsed.reviewConfirmed || evaluateExit !== 0 || applyExit !== 0))
      || (state === 'execution_completed' && (stage !== 'finished' || parsed.exitCode !== 0
        || parsed.dryRun || evaluateExit !== 0 || applyExit !== 0
        || parsed.reviewRequested && !parsed.reviewConfirmed))) return { status: 'invalid' };
  if (stage === 'preflight' && state !== 'failed') return { status: 'invalid' };
  if (stage === 'finished' && state !== 'execution_completed') return { status: 'invalid' };
  if (stage !== 'preflight') {
    // Reservation is exactly zero or one slot; an unconfirmed response always holds one.
    const reservedSlots = (parsed.limit as number) - (newVideoLimit as number);
    if (reservedSlots !== 0 && reservedSlots !== 1) return { status: 'invalid' };
    if ((!parsed.reviewRequested || parsed.dryRun) && reservedSlots !== 0) return { status: 'invalid' };
    if (parsed.reviewRequested && !parsed.dryRun && !parsed.reviewConfirmed && reservedSlots !== 1) {
      return { status: 'invalid' };
    }
  }

  const view: HostedPipelineReceiptView = {
    source: 'github_actions', runId: expected.runId, runAttempt: expected.runAttempt,
    headSha: expected.headSha, workflow: expected.workflow, ref: expected.ref,
    localExecutionId: parsed.executionId, runnerFileSha256: parsed.runnerSha256,
    startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(),
    receiptGeneratedAt: new Date(generated).toISOString(), elapsedMs: parsed.elapsedMs,
    limit: parsed.limit, dryRun: parsed.dryRun, reviewRequested: parsed.reviewRequested,
    reviewConfirmed: parsed.reviewConfirmed, stage, state, exitCode: parsed.exitCode,
    publicationVerified: false,
  };
  if (newVideoLimit !== undefined) view.newVideoLimit = newVideoLimit;
  if (evaluateExit !== undefined) view.evaluateExit = evaluateExit;
  if (applyExit !== undefined) view.applyExit = applyExit;
  return { status: 'metadata_matched', view };
}
