import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { isRecord } from '@/lib/admin/normalize-evaluation-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
function client(): Rpc {
  const supabase = createSupabaseServiceRoleClient();
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}
function errorResponse(error: { message?: string; code?: string } | null) {
  if (error?.message?.includes('REVIEW_AUTOMATION_STALE')) return respond({ error: 'AUTOMATION_PREVIEW_STALE' }, 409);
  return respond({ error: 'AUTOMATION_UNAVAILABLE' }, 503);
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await client()('restaurant_review_automation_status');
    return error ? errorResponse(error) : respond(data);
  } catch { return errorResponse(null); }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!isTrustedSameOriginMutation(request)) return respond({ error: 'INVALID_ORIGIN' }, 403);
  const parsed = await readBoundedJsonRequest(request, 2048);
  if (!parsed.ok || !isRecord(parsed.value)) return respond({ error: 'INVALID_REQUEST' }, 400);
  const body = parsed.value;
  const action = body.action;
  if (!['preview', 'preview-run', 'preview-stop', 'start', 'stop', 'run'].includes(String(action))) return respond({ error: 'INVALID_REQUEST' }, 400);
  const batch = body.batchSize ?? 50;
  const daily = body.dailyLimit ?? 50;
  if (!Number.isInteger(batch) || Number(batch) < 1 || Number(batch) > 200 || !Number.isInteger(daily) || Number(daily) < 1 || Number(daily) > 200) {
    return respond({ error: 'INVALID_LIMIT' }, 400);
  }
  try {
    const rpc = client();
    if (action === 'preview-run' || action === 'preview-stop') {
      const preview = await rpc('restaurant_review_automation_manual', { actor: auth.userId, action, expected_version: '', preview_hash: '', request_id: null });
      return preview.error ? errorResponse(preview.error) : respond(preview.data);
    }
    if (action === 'preview') {
      const preview = await rpc('restaurant_review_automation_preview', { actor: auth.userId, batch_size: batch, daily_limit: daily });
      return preview.error ? errorResponse(preview.error) : respond(preview.data);
    }
    if (typeof body.version !== 'string' || !/^\d{1,19}$/.test(body.version)
      || body.confirmation !== ({ start: '자동 승인 시작', run: '지금 실행', stop: '자동 운영 중지' } as Record<string, string>)[String(action)]
      || typeof body.previewHash !== 'string' || !/^[0-9a-f]{32}$/.test(body.previewHash)) {
      return respond({ error: 'INVALID_CONFIRMATION' }, 400);
    }
    if (action === 'run' || action === 'stop') {
      if (action === 'run' && (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))) return respond({ error: 'INVALID_REQUEST' }, 400);
      const applied = await rpc('restaurant_review_automation_manual', { actor: auth.userId, action, expected_version: body.version, preview_hash: body.previewHash, request_id: action === 'run' ? body.requestId : null });
      return applied.error ? errorResponse(applied.error) : respond(applied.data);
    }
    const applied = await rpc('restaurant_review_automation_configure', {
      actor: auth.userId, action, expected_version: body.version, preview_hash: body.previewHash ?? '', batch_size: batch, daily_limit: daily,
    });
    return applied.error ? errorResponse(applied.error) : respond(applied.data);
  } catch { return errorResponse(null); }
}
