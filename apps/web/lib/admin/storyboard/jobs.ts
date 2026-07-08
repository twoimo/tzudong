import type { Json } from '@/integrations/supabase/types';

export type StoryboardJobStatus = 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled';

export type StoryboardJobReadiness = {
  status: 'queued' | 'worker_unavailable' | 'ready' | 'failed' | 'cancelled';
  providerCache: 'bypass';
  fallbackReasonCode: string | null;
  message: string;
};

export type StoryboardJobRow = {
  id: string;
  requested_by_admin_id: string;
  status: StoryboardJobStatus;
  stage: string;
  request_payload: Json;
  result_payload: Json | null;
  error_code: string | null;
  readiness: Json;
  claimed_by: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SafeStoryboardJob = {
  jobId: string;
  status: StoryboardJobStatus;
  stage: string;
  result: Json | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  readiness: StoryboardJobReadiness;
};

export function buildQueuedStoryboardJobReadiness(): StoryboardJobReadiness {
  return {
    status: 'queued',
    providerCache: 'bypass',
    fallbackReasonCode: 'storyboard_async_worker_pending',
    message: '스토리보드 생성 요청이 비동기 작업으로 등록되었습니다. 워커가 claim/finalize할 때까지 성공처럼 표시하지 않습니다.',
  };
}

function isRecord(value: Json | null): value is Record<string, Json> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeStoryboardJobReadiness(value: Json | null): StoryboardJobReadiness {
  if (!isRecord(value)) return buildQueuedStoryboardJobReadiness();
  const status = value.status;
  const fallbackReasonCode = value.fallbackReasonCode;
  const message = value.message;
  return {
    status:
      status === 'ready' || status === 'failed' || status === 'cancelled' || status === 'worker_unavailable' || status === 'queued'
        ? status
        : 'queued',
    providerCache: 'bypass',
    fallbackReasonCode: typeof fallbackReasonCode === 'string' ? fallbackReasonCode : null,
    message: typeof message === 'string' ? message : buildQueuedStoryboardJobReadiness().message,
  };
}

function sanitizeStoryboardJobResult(value: Json | null): Json | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { request: _request, ...safeResult } = value as Record<string, Json>;
  return safeResult as Json;
}

export function sanitizeStoryboardJobRow(row: StoryboardJobRow): SafeStoryboardJob {
  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
    result: sanitizeStoryboardJobResult(row.result_payload),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    readiness: normalizeStoryboardJobReadiness(row.readiness),
  };
}

export function buildStoryboardJobInsert({
  requestedByAdminId,
  request,
}: {
  requestedByAdminId: string;
  request: Record<string, unknown> | null;
}) {
  return {
    requested_by_admin_id: requestedByAdminId,
    status: 'queued' as const,
    stage: 'queued',
    request_payload: (request ?? {}) as Json,
    result_payload: null,
    error_code: null,
    readiness: buildQueuedStoryboardJobReadiness() as unknown as Json,
  };
}
