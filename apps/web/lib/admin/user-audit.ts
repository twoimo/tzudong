import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

type AdminUserAuditAction =
  | 'admin_user_created'
  | 'admin_user_profile_updated'
  | 'admin_user_role_granted'
  | 'admin_user_role_revoked'
  | 'admin_user_disabled'
  | 'admin_user_reactivated';

type AdminUserAuditStatus = 'intent' | 'applied' | 'failed';

type AdminUserAuditPayload = {
  actorUserId: string;
  targetUserId?: string | null;
  action: AdminUserAuditAction;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  status?: AdminUserAuditStatus;
  correlationId?: string | null;
  errorCode?: string | null;
};

function hashValue(value: string | null) {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function buildAdminUserAuditRequestContext(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || randomUUID();
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent');

  return {
    requestId,
    ipHash: hashValue(forwardedFor),
    userAgentHash: hashValue(userAgent),
  };
}

export async function recordAdminUserAuditEvent(
  supabase: SupabaseClient,
  request: NextRequest,
  payload: AdminUserAuditPayload,
) {
  const auditContext = buildAdminUserAuditRequestContext(request);

  const status = payload.status ?? 'intent';

  const { data, error } = await supabase
    .from('admin_audit_events')
    .insert({
      actor_user_id: payload.actorUserId,
      target_user_id: payload.targetUserId ?? null,
      action: payload.action,
      reason: payload.reason ?? null,
      before_state: payload.beforeState ?? {},
      after_state: payload.afterState ?? {},
      status,
      correlation_id: payload.correlationId ?? null,
      applied_at: status === 'applied' ? new Date().toISOString() : null,
      error_code: payload.errorCode ?? null,
      request_id: auditContext.requestId,
      ip_hash: auditContext.ipHash,
      user_agent_hash: auditContext.userAgentHash,
    })
    .select('id')
    .single();

  if (error) throw error;
  return String((data as { id: string }).id);
}
