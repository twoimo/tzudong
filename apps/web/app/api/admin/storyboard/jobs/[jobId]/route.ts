import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  buildStoryboardRouteHeaders,
  createStoryboardRouteTelemetry,
  STORYBOARD_ROUTE_NO_STORE_HEADERS,
} from '@/lib/admin/storyboard/route-telemetry';
import { sanitizeStoryboardJobRow, type StoryboardJobRow } from '@/lib/admin/storyboard/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORYBOARD_JOB_SELECT = 'id, requested_by_admin_id, status, stage, request_payload, result_payload, error_code, readiness, claimed_by, claimed_at, completed_at, cancelled_at, created_at, updated_at';

type StoryboardJobRouteContext = {
  params: Promise<{ jobId: string }>;
};

function noStoreJson(telemetry: ReturnType<typeof createStoryboardRouteTelemetry>, body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, body),
  });
}

export async function GET(_request: NextRequest, context: StoryboardJobRouteContext) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-job-status');
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'no-store');
    return auth.response;
  }

  const { jobId } = await context.params;
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('admin_storyboard_jobs')
    .select(STORYBOARD_JOB_SELECT)
    .eq('id', jobId)
    .eq('requested_by_admin_id', auth.userId)
    .maybeSingle();
  if (error) return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_status_failed', jobId }, { status: 502 });
  if (!data) return noStoreJson(telemetry, { ok: false, error: 'storyboard_job_not_found', jobId }, { status: 404 });

  const job = sanitizeStoryboardJobRow(data as StoryboardJobRow);
  return noStoreJson(telemetry, { ok: true, job, readiness: job.readiness });
}
