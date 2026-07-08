import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { mapTrendJobRequestRow } from '@/lib/admin-trend-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TrendJobRequestRouteContext = {
  params: Promise<{ requestId: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function GET(_request: NextRequest, context: TrendJobRequestRouteContext) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  const { requestId } = await context.params;
  if (!UUID_PATTERN.test(requestId)) {
    return noStoreJson({ ok: false, error: 'trend_job_request_not_found' }, { status: 404 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from('admin_trend_job_requests')
      .select('id, request_kind, status, parameters, parameters_hash, request_hash, correlation_id, idempotency_key, claimed_by, claimed_at, completed_at, run_id, error_code, result_summary, created_at, updated_at')
      .eq('id', requestId)
      .eq('requested_by_admin_id', admin.userId)
      .maybeSingle();

    if (error) return noStoreJson({ ok: false, error: 'trend_job_request_status_failed' }, { status: 502 });
    const row = readRowObject(data);
    if (!row) return noStoreJson({ ok: false, error: 'trend_job_request_not_found' }, { status: 404 });

    return noStoreJson({ ok: true, request: mapTrendJobRequestRow(row), run: null });
  } catch {
    return noStoreJson({ ok: false, error: 'trend_job_request_status_failed' }, { status: 502 });
  }
}
