import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import {
  ADMIN_USER_AUDIT_REASON_CODES,
  buildAdminUserAuditRequestContext,
  recordAdminUserAuditEvent,
  type AdminUserAuditPayload,
} from '@/lib/admin/user-audit';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isBannedUntilActive, validateAdminUserConfirmation } from '@/lib/admin/user-management-guards';
import {
  ADMIN_AUDIT_PRIMARY_SOURCE,
  buildMutationAuditReceipt,
} from '@/lib/admin/audit-contract';

import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
export const runtime = 'nodejs';

const DISABLE_BAN_DURATION = '876600h';
const MAX_ADMIN_USER_MUTATION_REQUEST_BYTES = 64 * 1024;

type RouteContext = {
  params: Promise<{ userId: string }>;
};
type AdminUserMutationBody = {
  accountStatus?: unknown;
  confirmation?: unknown;
  profile?: {
    avatarUrl?: unknown;
    nickname?: unknown;
    username?: unknown;
  } | null;
  role?: unknown;
};

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

type AdminUserMutationAction = Exclude<AdminUserAuditPayload['action'], 'admin_user_created'>;
type AdminUserAuditStatus = NonNullable<AdminUserAuditPayload['status']>;
type CanonicalAdminUserAuditPayload = Omit<
  AdminUserAuditPayload,
  'action' | 'status' | 'reasonCode' | 'errorCode'
> & {
  action: AdminUserMutationAction;
  status: AdminUserAuditStatus;
};

const ADMIN_USER_AUDIT_REASON_CODES_BY_ACTION = {
  admin_user_profile_updated: {
    intent: 'ADMIN_USER_PROFILE_UPDATE_INTENT',
    applied: 'ADMIN_USER_PROFILE_UPDATE_APPLIED',
    failed: 'ADMIN_USER_PROFILE_UPDATE_FAILED',
  },
  admin_user_role_granted: {
    intent: 'ADMIN_USER_ROLE_GRANT_INTENT',
    applied: 'ADMIN_USER_ROLE_GRANT_APPLIED',
    failed: 'ADMIN_USER_ROLE_GRANT_FAILED',
  },
  admin_user_role_revoked: {
    intent: 'ADMIN_USER_ROLE_REVOKE_INTENT',
    applied: 'ADMIN_USER_ROLE_REVOKE_APPLIED',
    failed: 'ADMIN_USER_ROLE_REVOKE_FAILED',
  },
  admin_user_disabled: {
    intent: 'ADMIN_USER_DISABLE_INTENT',
    applied: 'ADMIN_USER_DISABLE_APPLIED',
    failed: 'ADMIN_USER_DISABLE_FAILED',
  },
  admin_user_reactivated: {
    intent: 'ADMIN_USER_REACTIVATE_INTENT',
    applied: 'ADMIN_USER_REACTIVATE_APPLIED',
    failed: 'ADMIN_USER_REACTIVATE_FAILED',
  },
} satisfies Record<
  AdminUserMutationAction,
  Record<AdminUserAuditStatus, AdminUserAuditPayload['reasonCode']>
>;

function buildCanonicalAdminUserAuditPayload(
  payload: CanonicalAdminUserAuditPayload,
): AdminUserAuditPayload {
  const reasonCode = ADMIN_USER_AUDIT_REASON_CODES_BY_ACTION[payload.action][payload.status];

  if (!ADMIN_USER_AUDIT_REASON_CODES.includes(reasonCode)) {
    throw new Error('관리자 사용자 감사 사유 코드가 유효하지 않습니다.');
  }

  if (payload.status === 'failed') {
    return { ...payload, reasonCode, errorCode: reasonCode };
  }

  return { ...payload, reasonCode };
}

async function recordFailedAuditEvent(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  request: NextRequest,
  payload: {
    actorUserId: string;
    targetUserId: string;
    action: AdminUserMutationAction;
    preflightAuditId: string;
  },
) {
  return recordAdminUserAuditEvent(
    supabase,
    request,
    buildCanonicalAdminUserAuditPayload({
      actorUserId: payload.actorUserId,
      targetUserId: payload.targetUserId,
      action: payload.action,
      status: 'failed',
      correlationId: payload.preflightAuditId,
      counts: { failed: 1 },
    }),
  );
}

async function getAllAdminUserIds(supabase: ReturnType<typeof createSupabaseServiceRoleClient>) {
  const { data, error } = await supabase.rpc('read_admin_user_ids_for_management');

  if (error) throw error;
  if ((data?.length ?? 0) > 200) {
    throw new Error('관리자 계정 범위가 허용된 운영 한도를 초과했습니다.');
  }
  const adminUserIds = new Set<string>();
  for (const row of data ?? []) {
    if (!row.user_id || adminUserIds.has(row.user_id)) {
      throw new Error('관리자 계정 목록 응답이 유효하지 않습니다.');
    }
    adminUserIds.add(row.user_id);
  }
  if (adminUserIds.size === 0) {
    throw new Error('활성 관리자 잠금 방지를 위한 계정 목록이 비어 있습니다.');
  }
  return adminUserIds;
}

async function getActiveAdminUserIds(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  adminUserIds: Set<string>,
) {
  const activeAdminUserIds = new Set<string>();

  await Promise.all(Array.from(adminUserIds).map(async (adminUserId) => {
    const { data, error } = await supabase.auth.admin.getUserById(adminUserId);
    if (error || !data.user) {
      throw new Error('관리자 계정 상태를 확인하지 못했습니다. 잠금 방지를 위해 변경을 중단합니다.');
    }
    if (!isBannedUntilActive(data.user.banned_until)) {
      activeAdminUserIds.add(adminUserId);
    }
  }));

  return activeAdminUserIds;
}

async function applyAdminUserDbMutation(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  request: NextRequest,
  payload: {
    actorUserId: string;
    targetUserId: string;
    action: AdminUserMutationAction;
    correlationId: string;
    profile?: { username: string; nickname: string; avatarUrl: string | null } | null;
    nextRole?: 'admin' | 'user' | null;
    nextAccountStatus?: 'active' | 'disabled' | null;
  },
) {
  const auditPayload = buildCanonicalAdminUserAuditPayload({
    actorUserId: payload.actorUserId,
    targetUserId: payload.targetUserId,
    action: payload.action,
    status: 'applied',
    correlationId: payload.correlationId,
  });
  const auditContext = buildAdminUserAuditRequestContext(request);

  const { data, error } = await supabase
    .rpc('apply_admin_user_db_mutation', {
      p_actor_user_id: payload.actorUserId,
      p_target_user_id: payload.targetUserId,
      p_action: payload.action,
      p_reason: auditPayload.reasonCode,
      p_before_state: {},
      p_after_state: {},
      p_correlation_id: payload.correlationId,
      p_profile: payload.profile
        ? {
          username: payload.profile.username,
          nickname: payload.profile.nickname,
          avatar_url: payload.profile.avatarUrl,
        }
        : null,
      p_next_role: payload.nextRole ?? null,
      p_next_account_status: payload.nextAccountStatus ?? null,
      p_request_id: auditContext.requestId,
      p_ip_hash: auditContext.ipHash,
      p_user_agent_hash: auditContext.userAgentHash,
    });

  if (error) throw error;
  return String(data);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      auth.response.headers.set('Cache-Control', 'no-store');
      return auth.response;
    }

    if (!isTrustedSameOriginMutation(request)) {
      return noStoreJson({ error: '요청을 처리할 수 없습니다.' }, { status: 403 });
    }

    const { userId } = await context.params;
    const targetUserId = decodeURIComponent(userId || '').trim();
    if (!targetUserId) {
      return noStoreJson({ error: '사용자 ID가 필요합니다.' }, { status: 400 });
    }

    const requestBody = await readBoundedJsonRequest(
      request,
      MAX_ADMIN_USER_MUTATION_REQUEST_BYTES,
    );
    if (!requestBody.ok) {
      return noStoreJson({ error: '변경할 사용자 정보가 필요합니다.' }, { status: 400 });
    }

    const body = requestBody.value as AdminUserMutationBody | null;
    if (!body || typeof body !== 'object') {
      return noStoreJson({ error: '변경할 사용자 정보가 필요합니다.' }, { status: 400 });
    }

    const nextRole = body.role === 'admin' || body.role === 'user' ? body.role : undefined;
    const nextAccountStatus = body.accountStatus === 'active' || body.accountStatus === 'disabled' ? body.accountStatus : undefined;
    const supabase = createSupabaseServiceRoleClient();
    const adminUserIds = await getAllAdminUserIds(supabase);
    const activeAdminUserIds = await getActiveAdminUserIds(supabase, adminUserIds);
    const targetIsAdmin = adminUserIds.has(targetUserId);
    const targetIsActiveAdmin = activeAdminUserIds.has(targetUserId);
    const isSelfTarget = targetUserId === auth.userId;

    const confirmation = toStringValue(body.confirmation);
    const confirmationError = validateAdminUserConfirmation({
      nextRole,
      nextAccountStatus,
      hasProfileChange: Boolean(body.profile),
      confirmation,
    });

    if (confirmationError) {
      return noStoreJson({ error: confirmationError }, { status: 400 });
    }

    if (isSelfTarget && nextRole === 'user') {
      return noStoreJson({ error: '자기 자신의 관리자 권한은 회수할 수 없습니다.' }, { status: 400 });
    }

    if (isSelfTarget && nextAccountStatus === 'disabled') {
      return noStoreJson({ error: '자기 자신의 계정은 비활성화할 수 없습니다.' }, { status: 400 });
    }

    if (targetIsActiveAdmin && activeAdminUserIds.size <= 1 && (nextRole === 'user' || nextAccountStatus === 'disabled')) {
      return noStoreJson({ error: '마지막 활성 관리자 계정은 권한 회수 또는 비활성화할 수 없습니다.' }, { status: 400 });
    }

    if (!body.profile && !nextRole && !nextAccountStatus) {
      return noStoreJson({ error: '적용할 변경 사항이 없습니다.' }, { status: 400 });
    }

    const auditIds: string[] = [];
    let latestPreflightAuditId: string | null = null;

    const profile = body.profile && typeof body.profile === 'object' ? body.profile : null;
    if (profile) {
      const nickname = toStringValue(profile.nickname);
      const username = toStringValue(profile.username);
      const avatarUrl = profile.avatarUrl === null ? null : toStringValue(profile.avatarUrl);

      if (!nickname || !username) {
        return noStoreJson({ error: '닉네임과 사용자명을 모두 입력해 주세요.' }, { status: 400 });
      }

      const auditId = await recordAdminUserAuditEvent(
        supabase,
        request,
        buildCanonicalAdminUserAuditPayload({
          actorUserId: auth.userId,
          targetUserId,
          action: 'admin_user_profile_updated',
          status: 'intent',
          counts: { requested: 1 },
          flags: { profileChanged: true },
        }),
      );
      auditIds.push(auditId);
      latestPreflightAuditId = auditId;

      try {
        const appliedAuditId = await applyAdminUserDbMutation(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action: 'admin_user_profile_updated',
          correlationId: auditId,
          profile: { nickname, username, avatarUrl: avatarUrl || null },
        });
        auditIds.push(appliedAuditId);
      } catch (mutationError) {
        const failedAuditId = await recordFailedAuditEvent(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action: 'admin_user_profile_updated',
          preflightAuditId: auditId,
        });
        auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    if (nextRole) {
      const action = nextRole === 'admin' ? 'admin_user_role_granted' : 'admin_user_role_revoked';
      const auditId = await recordAdminUserAuditEvent(
        supabase,
        request,
        buildCanonicalAdminUserAuditPayload({
          actorUserId: auth.userId,
          targetUserId,
          action,
          status: 'intent',
          counts: { requested: 1 },
          flags: { roleAdmin: nextRole === 'admin' },
        }),
      );
      auditIds.push(auditId);
      latestPreflightAuditId = auditId;

      try {
        const appliedAuditId = await applyAdminUserDbMutation(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action,
          correlationId: auditId,
          nextRole,
        });
        auditIds.push(appliedAuditId);
      } catch (mutationError) {
        const failedAuditId = await recordFailedAuditEvent(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action,
          preflightAuditId: auditId,
        });
        auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    if (nextAccountStatus) {
      const action = nextAccountStatus === 'disabled' ? 'admin_user_disabled' : 'admin_user_reactivated';
      const auditId = await recordAdminUserAuditEvent(
        supabase,
        request,
        buildCanonicalAdminUserAuditPayload({
          actorUserId: auth.userId,
          targetUserId,
          action,
          status: 'intent',
          counts: { requested: 1 },
          flags: { accountDisabled: nextAccountStatus === 'disabled' },
        }),
      );
      auditIds.push(auditId);
      latestPreflightAuditId = auditId;

      try {
        const { error } = await supabase.auth.admin.updateUserById(targetUserId, {
          ban_duration: nextAccountStatus === 'disabled' ? DISABLE_BAN_DURATION : 'none',
        });
        if (error) throw error;

        try {
          const appliedAuditId = await applyAdminUserDbMutation(supabase, request, {
            actorUserId: auth.userId,
            targetUserId,
            action,
            correlationId: auditId,
            nextAccountStatus,
          });
          auditIds.push(appliedAuditId);
        } catch (dbMutationError) {
          await supabase.auth.admin.updateUserById(targetUserId, {
            ban_duration: nextAccountStatus === 'disabled' ? 'none' : DISABLE_BAN_DURATION,
          }).catch((rollbackError) => {
            console.error('[admin/users] failed to roll back auth account status after DB audit error', {
              domain: 'admin_user_management',
              action,
              step: 'auth-rollback-after-db-audit',
              correlationId: auditId,
              errorName: getAdminSafeErrorName(rollbackError),
            });
          });
          throw dbMutationError;
        }
      } catch (mutationError) {
        const failedAuditId = await recordFailedAuditEvent(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action,
          preflightAuditId: auditId,
        });
        auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    const preflightAuditId = latestPreflightAuditId ?? auditIds[0] ?? null;
    const readbackAuditId = auditIds[auditIds.length - 1] ?? preflightAuditId;

    return noStoreJson({
      success: true,
      auditIds,
      audit: buildMutationAuditReceipt({
        domain: 'admin_user_management',
        source: ADMIN_AUDIT_PRIMARY_SOURCE,
        readbackId: readbackAuditId,
        correlationId: preflightAuditId,
        auditIds,
      }),
      message: '사용자 계정 변경을 적용했습니다.',
      safeguards: {
        selfLockoutBlocked: isSelfTarget,
        lastAdminProtected: targetIsActiveAdmin && activeAdminUserIds.size <= 1,
      },
    });
  } catch (error) {
    console.error('[admin/users] failed to update user', {
      domain: 'admin_user_management',
      action: 'update_user',
      step: 'unexpected',
      errorName: getAdminSafeErrorName(error),
    });
    return noStoreJson({ error: '사용자 계정 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
