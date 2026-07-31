import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  type RestaurantDestructiveActionRequest,
  validateRestaurantDestructiveActionRequest,
} from '@/lib/admin/restaurant-destructive-action-contract';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

export const runtime = 'nodejs';
const MAX_DESTRUCTIVE_ACTION_REQUEST_BYTES = 4 * 1024;

type RouteContext = {
  params: Promise<{ restaurantId: string }>;
};

type RestaurantReadbackRow = {
  id: string;
  name: string | null;
  approved_name: string | null;
  status: string | null;
  updated_at: string | null;
};

type RestaurantDestructiveAuditRow = {
  id: string;
  actor_user_id: string;
  action: string;
  reason: string | null;
  target_restaurant_ids: string[] | null;
  correlation_id: string | null;
  status: string;
  applied_at: string | null;
};

function hashValue(value: string | null) {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function buildRequestMetadata(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  return {
    requestId: request.headers.get('x-request-id') || randomUUID(),
    ipHash: hashValue(forwardedFor),
    userAgentHash: hashValue(request.headers.get('user-agent')),
  };
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function safeErrorResponse(message = '맛집 삭제 작업에 실패했습니다.') {
  return noStoreJson({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'no-store');
    return auth.response;
  }

  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ error: 'Forbidden' }, { status: 403 });
  }

  const { restaurantId } = await context.params;
  const targetRouteRestaurantId = decodeURIComponent(restaurantId || '').trim();
  if (!targetRouteRestaurantId) {
    return NextResponse.json({ error: '맛집 ID가 필요합니다.' }, { status: 400 });
  }

  const requestBody = await readBoundedJsonRequest(request, MAX_DESTRUCTIVE_ACTION_REQUEST_BYTES);
  if (!requestBody.ok) {
    return noStoreJson({ error: '삭제 요청 정보가 필요합니다.' }, { status: 400 });
  }

  const body = requestBody.value as RestaurantDestructiveActionRequest | null;
  if (!body || typeof body !== 'object') {
    return noStoreJson({ error: '삭제 요청 정보가 필요합니다.' }, { status: 400 });
  }

  const supabase = createSupabaseServiceRoleClient();

  try {
    const { data: targetRestaurant, error: targetError } = await supabase
      .from('restaurants')
      .select('id, name, approved_name, status, updated_at')
      .eq('id', targetRouteRestaurantId)
      .single();

    if (targetError || !targetRestaurant) {
      return NextResponse.json({ error: '삭제 대상 맛집을 찾을 수 없습니다.' }, { status: 404 });
    }

    const targetRestaurantRow = targetRestaurant as RestaurantReadbackRow;
    const validation = validateRestaurantDestructiveActionRequest(body, {
      routeRestaurantId: targetRouteRestaurantId,
      actualRestaurantName: targetRestaurantRow.approved_name || targetRestaurantRow.name,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const correlationId = randomUUID();
    const requestMetadata = buildRequestMetadata(request);
    const payload = validation.value;

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'apply_restaurant_admin_destructive_action' as never,
      {
        p_actor_user_id: auth.userId,
        p_action: payload.action,
        p_reason: payload.reason,
        p_target_restaurant_ids: payload.targetRestaurantIds,
        p_correlation_id: correlationId,
        p_request_metadata: requestMetadata,
      } as never,
    );

    if (rpcError || !rpcResult) {
      return safeErrorResponse();
    }

    const { data: readbackRows, error: readbackError } = await supabase
      .from('restaurants')
      .select('id, name, approved_name, status, updated_at')
      .in('id', payload.targetRestaurantIds);

    if (readbackError) {
      return safeErrorResponse('삭제 후 상태 확인에 실패했습니다.');
    }

    const rows = (readbackRows ?? []) as RestaurantReadbackRow[];
    const deletedTargetIds = rows.filter((row) => row.status === 'deleted').map((row) => row.id);
    const allTargetsDeleted = payload.targetRestaurantIds.every((id) => deletedTargetIds.includes(id));

    if (!allTargetsDeleted) {
      return safeErrorResponse('삭제 후 상태 확인이 완료되지 않았습니다.');
    }

    const rpcReceipt = rpcResult as { audit_id?: string; auditId?: string };
    const auditId = String(rpcReceipt.audit_id ?? rpcReceipt.auditId ?? '');
    if (!auditId) {
      return safeErrorResponse('감사 기록 확인에 실패했습니다.');
    }

    const { data: auditEvent, error: auditError } = await supabase
      .from('restaurant_admin_destructive_audit_events')
      .select('id, actor_user_id, action, reason, target_restaurant_ids, correlation_id, status, applied_at')
      .eq('id', auditId)
      .eq('correlation_id', correlationId)
      .single();

    if (auditError || !auditEvent) {
      return safeErrorResponse('감사 기록 확인에 실패했습니다.');
    }

    const audit = auditEvent as RestaurantDestructiveAuditRow;

    return NextResponse.json({
      ok: true,
      action: payload.action,
      audit: {
        id: audit.id,
        status: audit.status,
        appliedAt: audit.applied_at,
      },
      correlationId,
      readback: {
        allTargetsDeleted,
        deletedTargetIds,
        targetCount: payload.targetRestaurantIds.length,
      },
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[admin/restaurants/destructive-action] failed', {
      step: 'unhandled-error',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return safeErrorResponse();
  }
}
