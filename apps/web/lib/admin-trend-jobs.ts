import { createHash } from 'node:crypto';

import type { Json } from '@/integrations/supabase/types';

export const TREND_JOB_REQUEST_KINDS = ['trend_proposal_run', 'dry_run'] as const;
export const TREND_JOB_STATUSES = ['queued', 'claimed', 'succeeded', 'failed', 'cancelled'] as const;

export type AdminTrendJobRequestKind = typeof TREND_JOB_REQUEST_KINDS[number];
export type AdminTrendJobStatus = typeof TREND_JOB_STATUSES[number];

export type NormalizedAdminTrendJobRequest = {
  requestKind: AdminTrendJobRequestKind;
  parameters: Record<string, Json>;
  correlationId: string;
  idempotencyKey: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('invalid-json');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    ) as Json;
  }
  throw new Error('invalid-json');
}

export function canonicalTrendJobJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildTrendJobParametersHash(parameters: Record<string, Json>): string {
  return sha256Hex(canonicalTrendJobJson(parameters));
}

export function buildTrendJobRequestHash(input: Pick<NormalizedAdminTrendJobRequest, 'requestKind' | 'parameters' | 'correlationId'>): string {
  return sha256Hex(canonicalTrendJobJson({
    requestKind: input.requestKind,
    parameters: input.parameters,
    correlationId: input.correlationId,
  }));
}

export function normalizeTrendJobRequestBody(value: unknown): NormalizedAdminTrendJobRequest {
  if (!isPlainRecord(value)) throw new Error('invalid_trend_job_request');
  const requestKind = value.requestKind;
  if (requestKind !== 'trend_proposal_run' && requestKind !== 'dry_run') throw new Error('invalid_trend_job_request');
  const correlationId = typeof value.correlationId === 'string' ? value.correlationId.trim() : '';
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey.trim() : '';
  if (!UUID_PATTERN.test(correlationId) || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error('invalid_trend_job_request');
  }
  const parameters = normalizeJson(isPlainRecord(value.parameters) ? value.parameters : {}) as Record<string, Json>;
  const windowValue = parameters.window;
  if (isPlainRecord(windowValue)) {
    const from = typeof windowValue.from === 'string' ? Date.parse(windowValue.from) : NaN;
    const to = typeof windowValue.to === 'string' ? Date.parse(windowValue.to) : NaN;
    if (Number.isFinite(from) && Number.isFinite(to) && from > to) throw new Error('trend_job_request_window_invalid');
  }
  return { requestKind, parameters, correlationId, idempotencyKey };
}

export function statusUrlForTrendJobRequest(requestId: string): string {
  return `/api/admin/trend-job-requests/${requestId}`;
}

export function mapTrendJobRequestRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    requestKind: row.request_kind,
    status: row.status,
    parameters: row.parameters,
    parametersHash: row.parameters_hash,
    requestHash: row.request_hash,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    runId: row.run_id,
    errorCode: row.error_code,
    resultSummary: row.result_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
