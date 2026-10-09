import { NextRequest, NextResponse } from 'next/server';
import { retiredStoryboardApi } from '@/lib/admin/storyboard/retired-api';

import { requireAdmin } from '@/lib/auth/require-admin';
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


function noStoreJson(telemetry: ReturnType<typeof createStoryboardRouteTelemetry>, body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: buildStoryboardRouteHeaders(telemetry, STORYBOARD_ROUTE_NO_STORE_HEADERS, body),
  });
}

export async function GET(request: NextRequest) {
  const telemetry = createStoryboardRouteTelemetry('admin-storyboard-jobs-list');
  const auth = await requireAdmin({ allowDevAdminBypassCookie: true });
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'no-store');
    return auth.response;
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 20;
  if (!Number.isInteger(limit) || limit < 1) {
    return noStoreJson(telemetry, { ok: false, error: 'invalid_storyboard_job_query' }, { status: 400 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('admin_storyboard_jobs')
    .select(STORYBOARD_JOB_SELECT)
    .eq('requested_by_admin_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(50, limit));
  if (error) return noStoreJson(telemetry, { ok: false, error: 'storyboard_jobs_list_failed' }, { status: 502 });

  const jobs = ((data ?? []) as StoryboardJobRow[]).map(sanitizeStoryboardJobRow);
  return noStoreJson(telemetry, { ok: true, jobs });
}

export const POST = retiredStoryboardApi;
