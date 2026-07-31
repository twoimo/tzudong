import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildTrendJobParametersHash,
  buildTrendJobRequestHash,
  mapTrendJobRequestRow,
  normalizeTrendJobRequestBody,
  statusUrlForTrendJobRequest,
} from '@/lib/admin-trend-jobs';
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_TREND_JOB_REQUEST_BYTES = 16 * 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'trend_job_request_forbidden' }, { status: 403 });
  }


  const requestBody = await readBoundedJsonRequest(request, MAX_TREND_JOB_REQUEST_BYTES);
  if (!requestBody.ok) {
    return noStoreJson(
      { ok: false, error: 'invalid_trend_job_request' },
      { status: requestBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 413 : 400 },
    );
  }

  let normalized: ReturnType<typeof normalizeTrendJobRequestBody>;
  try {
    normalized = normalizeTrendJobRequestBody(requestBody.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_trend_job_request';
    return noStoreJson({ ok: false, error: message === 'trend_job_request_window_invalid' ? message : 'invalid_trend_job_request' }, { status: message === 'trend_job_request_window_invalid' ? 409 : 400 });
  }

  const parametersHash = buildTrendJobParametersHash(normalized.parameters);
  const requestHash = buildTrendJobRequestHash(normalized);

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data: existingData, error: existingError } = await supabase
      .from('admin_trend_job_requests')
      .select('id, request_kind, status, parameters, parameters_hash, request_hash, correlation_id, idempotency_key, claimed_by, claimed_at, completed_at, run_id, error_code, result_summary, created_at, updated_at')
      .eq('requested_by_admin_id', admin.userId)
      .eq('idempotency_key', normalized.idempotencyKey)
      .maybeSingle();

    if (existingError) return noStoreJson({ ok: false, error: 'trend_job_request_enqueue_failed' }, { status: 502 });
    const existing = readRowObject(existingData);
    if (existing) {
      if (existing.request_hash !== requestHash || existing.correlation_id !== normalized.correlationId) {
        return noStoreJson({ ok: false, error: 'trend_job_request_idempotency_conflict' }, { status: 409 });
      }
      const requestRow = mapTrendJobRequestRow(existing);
      return noStoreJson({
        ok: true,
        status: requestRow.status,
        requestId: requestRow.id,
        correlationId: requestRow.correlationId,
        idempotencyKey: requestRow.idempotencyKey,
        parametersHash: requestRow.parametersHash,
        requestHash: requestRow.requestHash,
        replayed: true,
        statusUrl: statusUrlForTrendJobRequest(String(requestRow.id)),
      });
    }

    const { data, error } = await supabase
      .from('admin_trend_job_requests')
      .insert({
        requested_by_admin_id: admin.userId,
        request_kind: normalized.requestKind,
        status: 'queued',
        parameters: normalized.parameters,
        parameters_hash: parametersHash,
        request_hash: requestHash,
        correlation_id: normalized.correlationId,
        idempotency_key: normalized.idempotencyKey,
      })
      .select('id, request_kind, status, parameters, parameters_hash, request_hash, correlation_id, idempotency_key, claimed_by, claimed_at, completed_at, run_id, error_code, result_summary, created_at, updated_at')
      .single();

    if (error) {
      const { data: racedData, error: racedError } = await supabase
        .from('admin_trend_job_requests')
        .select('id, request_kind, status, parameters, parameters_hash, request_hash, correlation_id, idempotency_key, claimed_by, claimed_at, completed_at, run_id, error_code, result_summary, created_at, updated_at')
        .eq('requested_by_admin_id', admin.userId)
        .eq('idempotency_key', normalized.idempotencyKey)
        .maybeSingle();

      const raced = racedError ? null : readRowObject(racedData);
      if (raced) {
        if (raced.request_hash !== requestHash || raced.correlation_id !== normalized.correlationId) {
          return noStoreJson({ ok: false, error: 'trend_job_request_idempotency_conflict' }, { status: 409 });
        }
        const replayedRow = mapTrendJobRequestRow(raced);
        return noStoreJson({
          ok: true,
          status: replayedRow.status,
          requestId: replayedRow.id,
          correlationId: replayedRow.correlationId,
          idempotencyKey: replayedRow.idempotencyKey,
          parametersHash: replayedRow.parametersHash,
          requestHash: replayedRow.requestHash,
          replayed: true,
          statusUrl: statusUrlForTrendJobRequest(String(replayedRow.id)),
        });
      }

      return noStoreJson({ ok: false, error: 'trend_job_request_enqueue_failed' }, { status: 502 });
    }
    const requestRow = mapTrendJobRequestRow(readRowObject(data) ?? {});
    return noStoreJson({
      ok: true,
      status: 'queued',
      requestId: requestRow.id,
      correlationId: requestRow.correlationId,
      idempotencyKey: requestRow.idempotencyKey,
      parametersHash: requestRow.parametersHash,
      requestHash: requestRow.requestHash,
      replayed: false,
      statusUrl: statusUrlForTrendJobRequest(String(requestRow.id)),
    }, { status: 202 });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_job_request_enqueue_failed' }, { status: 502 });
  }
}
