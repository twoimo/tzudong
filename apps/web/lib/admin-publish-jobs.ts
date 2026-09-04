// Queue-only admin publish trigger helpers (platform-modernization Task 15,
// Requirement 10.10; design "Route_Handler_Boundary는 Publish_Worker를 호출하지 않는다").
//
// The admin route handler only enqueues a request row into
// `local_analytics.publish_jobs` and reads its status. The Backend_Runtime
// Publish_Worker owns preview/confirm/apply/readback/audit. No long-running
// work, provider access, or database error strings belong in the route.

// Status vocabulary mirrors the CHECK constraint on
// `local_analytics.publish_jobs.status` (migration 20260901000100).
export const PUBLISH_JOB_STATUSES = [
  'requested',
  'preview',
  'confirmed',
  'applying',
  'readback',
  'succeeded',
  'failed',
] as const;

// The worker's seven-value closed result-code set (Requirement 10.13). Exposed
// here only so the mapper can carry an already-recorded code back to the admin
// console; the route never generates these.
export const PUBLISH_JOB_RESULT_CODES = [
  'publication_target_not_admitted',
  'preview_hash_mismatch',
  'preview_expired',
  'batch_upsert_limit',
  'publish_readback_mismatch',
  'publish_apply_aborted',
  'publish_schedule_not_approved',
] as const;

export type PublishJobStatus = typeof PUBLISH_JOB_STATUSES[number];
export type PublishJobResultCode = typeof PUBLISH_JOB_RESULT_CODES[number];

export const PUBLISH_JOB_STATUS_LIST_LIMIT = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_QUEUE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isPublishJobId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class PublishJobRequestError extends Error {}
export class PublishJobRowError extends Error {}

export function isLocalPublishQueueAvailable(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.TZUDONG_PUBLISH_QUEUE_ENABLED?.trim() !== '1') return false;
  const configuredUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configuredUrl) return false;
  try {
    const parsed = new URL(configuredUrl);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOCAL_QUEUE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// The enqueue body carries no target selection: the worker reads the
// operator-approved Publication_Set ledger itself. The route accepts an empty
// object only, refusing any unexpected keys so nothing leaks into the queue row.
export type NormalizedPublishJobRequest = Record<string, never>;

export function normalizePublishJobRequestBody(value: unknown): NormalizedPublishJobRequest {
  if (!isPlainRecord(value)) throw new PublishJobRequestError('invalid_publish_job_request');
  if (Object.keys(value).length !== 0) throw new PublishJobRequestError('invalid_publish_job_request');
  return {};
}

export function statusUrlForPublishJob(publishJobId: string): string {
  return `/api/admin/publish-jobs?publishJobId=${encodeURIComponent(publishJobId)}`;
}

// Bounded status projection. Only queue-status fields are surfaced; no provider
// diagnostics, database error strings, or Forbidden_Log_Field content.
export function mapPublishJobRow(row: Record<string, unknown>) {
  const publishJobId = row.publish_job_id;
  const status = row.status;
  const resultCode = row.result_code;
  const requestedAt = row.requested_at;
  const updatedAt = row.updated_at;
  if (
    !isPublishJobId(publishJobId)
    || !PUBLISH_JOB_STATUSES.includes(status as PublishJobStatus)
    || (resultCode !== null && !PUBLISH_JOB_RESULT_CODES.includes(resultCode as PublishJobResultCode))
    || typeof requestedAt !== 'string'
    || !RFC3339_PATTERN.test(requestedAt)
    || typeof updatedAt !== 'string'
    || !RFC3339_PATTERN.test(updatedAt)
  ) {
    throw new PublishJobRowError('invalid_publish_job_row');
  }
  return {
    publishJobId,
    status,
    resultCode,
    requestedAt,
    updatedAt,
  };
}
