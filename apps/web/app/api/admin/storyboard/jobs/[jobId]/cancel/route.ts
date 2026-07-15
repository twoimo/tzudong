import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildStoryboardRouteHeaders,
  createStoryboardRouteTelemetry,
  STORYBOARD_ROUTE_NO_STORE_HEADERS,
} from '@/lib/admin/storyboard/route-telemetry';
import {
  sanitizeStoryboardJobRow,
  type StoryboardJobRow,
} from '@/lib/admin/storyboard/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORYBOARD_JOB_SELECT = 'id, requested_by_admin_id, status, stage, request_payload, result_payload, error_code, readiness, claimed_by, claimed_at, completed_at, cancelled_at, created_at, updated_at';
const STORYBOARD_CANCELABLE_JOB_STATUSES = ['queued', 'claimed'];

type StoryboardJobCancelRouteContext = {
  params: Promise<{ jobId: string }>;
};

function noStoreJson(telemetry: ReturnType<typeof createStoryboardRouteTelemetry>, body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, body),
  });
}

export async function POST(request: NextRequest, context: StoryboardJobCancelRouteContext) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-job-cancel');
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'no-store');
    return auth.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_cancel_forbidden' }, { status: 403 });
  }

  const { jobId } = await context.params;
  const timestamp = new Date().toISOString();
  const readiness = {
    status: 'cancelled',
    providerCache: 'bypass',
    fallbackReasonCode: 'storyboard_job_cancelled',
    message: '스토리보드 비동기 작업이 취소되었습니다.',
  };
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('admin_storyboard_jobs')
    .update({
      status: 'cancelled',
      stage: 'cancelled',
      cancelled_at: timestamp,
      updated_at: timestamp,
      readiness,
    })
    .eq('id', jobId)
    .eq('requested_by_admin_id', auth.userId)
    .in('status', STORYBOARD_CANCELABLE_JOB_STATUSES)
    .select(STORYBOARD_JOB_SELECT)
    .maybeSingle();
  if (error) return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_cancel_failed', jobId }, { status: 502 });

  if (data) {
    const job = sanitizeStoryboardJobRow(data as StoryboardJobRow);
    return noStoreJson(telemetry, { ok: true, job, readiness: job.readiness });
  }

  const { data: latest, error: readError } = await supabase
    .from('admin_storyboard_jobs')
    .select(STORYBOARD_JOB_SELECT)
    .eq('id', jobId)
    .eq('requested_by_admin_id', auth.userId)
    .maybeSingle();
  if (readError) return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_cancel_failed', jobId }, { status: 502 });
  if (!latest) return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_not_found', jobId }, { status: 404 });

  const job = sanitizeStoryboardJobRow(latest as StoryboardJobRow);
  return noStoreJson(telemetry, { ok: true, job, readiness: job.readiness, replay: true });
}
