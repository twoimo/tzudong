import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { buildAdminUserAuditRequestContext, recordAdminUserAuditEvent } from '@/lib/admin/user-audit';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { isBannedUntilActive, validateAdminUserConfirmation } from '@/lib/admin/user-management-guards';

export const runtime = 'nodejs';

const DISABLE_BAN_DURATION = '876600h';

type RouteContext = {
  params: Promise<{ userId: string }>;
};

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toAuditErrorCode(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 160);
  return 'unknown-admin-user-update-error';
}

async function recordFailedAuditEvent(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  request: NextRequest,
  payload: {
    actorUserId: string;
    targetUserId: string;
    action: 'admin_user_profile_updated' | 'admin_user_role_granted' | 'admin_user_role_revoked' | 'admin_user_disabled' | 'admin_user_reactivated';
    preflightAuditId: string;
    error: unknown;
    afterState: Record<string, unknown>;
  },
) {
  try {
    const failedAuditId = await recordAdminUserAuditEvent(supabase, request, {
      actorUserId: payload.actorUserId,
      targetUserId: payload.targetUserId,
      action: payload.action,
      reason: 'failed-admin-user-mutation',
      beforeState: { preflightAuditId: payload.preflightAuditId },
      afterState: payload.afterState,
      status: 'failed',
      correlationId: payload.preflightAuditId,
      errorCode: toAuditErrorCode(payload.error),
    });
    return failedAuditId;
  } catch (auditError) {
    console.error('[admin/users] failed to record failed audit event:', auditError);
    return null;
  }
}

async function getAllAdminUserIds(supabase: ReturnType<typeof createSupabaseServiceRoleClient>) {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .eq('role', 'admin');

  if (error) throw error;
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((role) => role.user_id));
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
    action: 'admin_user_profile_updated' | 'admin_user_role_granted' | 'admin_user_role_revoked' | 'admin_user_disabled' | 'admin_user_reactivated';
    reason: string;
    beforeState: Record<string, unknown>;
    afterState: Record<string, unknown>;
    correlationId: string;
    profile?: { username: string; nickname: string; avatarUrl: string | null } | null;
    nextRole?: 'admin' | 'user' | null;
    nextAccountStatus?: 'active' | 'disabled' | null;
  },
) {
  const auditContext = buildAdminUserAuditRequestContext(request);

  const { data, error } = await supabase
    .rpc('apply_admin_user_db_mutation', {
      p_actor_user_id: payload.actorUserId,
      p_target_user_id: payload.targetUserId,
      p_action: payload.action,
      p_reason: payload.reason,
      p_before_state: payload.beforeState,
      p_after_state: payload.afterState,
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
    if (!auth.ok) return auth.response;

    const { userId } = await context.params;
    const targetUserId = decodeURIComponent(userId || '').trim();
    if (!targetUserId) {
      return NextResponse.json({ error: '사용자 ID가 필요합니다.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '변경할 사용자 정보가 필요합니다.' }, { status: 400 });
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
      return NextResponse.json({ error: confirmationError }, { status: 400 });
    }

    if (isSelfTarget && nextRole === 'user') {
      return NextResponse.json({ error: '자기 자신의 관리자 권한은 회수할 수 없습니다.' }, { status: 400 });
    }

    if (isSelfTarget && nextAccountStatus === 'disabled') {
      return NextResponse.json({ error: '자기 자신의 계정은 비활성화할 수 없습니다.' }, { status: 400 });
    }

    if (targetIsActiveAdmin && activeAdminUserIds.size <= 1 && (nextRole === 'user' || nextAccountStatus === 'disabled')) {
      return NextResponse.json({ error: '마지막 활성 관리자 계정은 권한 회수 또는 비활성화할 수 없습니다.' }, { status: 400 });
    }

    if (!body.profile && !nextRole && !nextAccountStatus) {
      return NextResponse.json({ error: '적용할 변경 사항이 없습니다.' }, { status: 400 });
    }

    const beforeState = {
      isAdmin: targetIsAdmin,
      isActiveAdmin: targetIsActiveAdmin,
      activeAdminCount: activeAdminUserIds.size,
      requestedProfileChange: Boolean(body.profile),
      requestedRole: nextRole ?? null,
      requestedAccountStatus: nextAccountStatus ?? null,
    };
    const auditIds: string[] = [];

    const profile = body.profile && typeof body.profile === 'object' ? body.profile : null;
    if (profile) {
      const nickname = toStringValue(profile.nickname);
      const username = toStringValue(profile.username);
      const avatarUrl = profile.avatarUrl === null ? null : toStringValue(profile.avatarUrl);

      if (!nickname || !username) {
        return NextResponse.json({ error: '닉네임과 사용자명을 모두 입력해 주세요.' }, { status: 400 });
      }

      const auditId = await recordAdminUserAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId,
        action: 'admin_user_profile_updated',
        reason: toStringValue(body.reason) || 'preflight-profile-update',
        beforeState,
        afterState: { nickname, username, avatarUrl: avatarUrl || null },
        status: 'intent',
      });
      auditIds.push(auditId);

      try {
        const appliedAuditId = await applyAdminUserDbMutation(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action: 'admin_user_profile_updated',
          reason: 'applied-profile-update',
          beforeState: { preflightAuditId: auditId },
          afterState: { nickname, username, avatarUrl: avatarUrl || null },
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
          error: mutationError,
          afterState: { nickname, username, avatarUrl: avatarUrl || null },
        });
        if (failedAuditId) auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    if (nextRole) {
      const action = nextRole === 'admin' ? 'admin_user_role_granted' : 'admin_user_role_revoked';
      const auditId = await recordAdminUserAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId,
        action,
        reason: toStringValue(body.reason) || 'preflight-role-change',
        beforeState,
        afterState: { role: nextRole, confirmation },
        status: 'intent',
      });
      auditIds.push(auditId);

      try {
        const appliedAuditId = await applyAdminUserDbMutation(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action,
          reason: 'applied-role-change',
          beforeState: { preflightAuditId: auditId },
          afterState: { role: nextRole },
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
          error: mutationError,
          afterState: { role: nextRole },
        });
        if (failedAuditId) auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    if (nextAccountStatus) {
      const action = nextAccountStatus === 'disabled' ? 'admin_user_disabled' : 'admin_user_reactivated';
      const auditId = await recordAdminUserAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId,
        action,
        reason: toStringValue(body.reason) || 'preflight-account-status-change',
        beforeState,
        afterState: { accountStatus: nextAccountStatus, confirmation },
        status: 'intent',
      });
      auditIds.push(auditId);

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
            reason: 'applied-account-status-change',
            beforeState: { preflightAuditId: auditId },
            afterState: { accountStatus: nextAccountStatus },
            correlationId: auditId,
            nextAccountStatus,
          });
          auditIds.push(appliedAuditId);
          } catch (dbMutationError) {
          await supabase.auth.admin.updateUserById(targetUserId, {
            ban_duration: nextAccountStatus === 'disabled' ? 'none' : DISABLE_BAN_DURATION,
          }).catch((rollbackError) => {
            console.error('[admin/users] failed to roll back auth account status after DB audit error:', rollbackError);
          });
          throw dbMutationError;
        }
      } catch (mutationError) {
        const failedAuditId = await recordFailedAuditEvent(supabase, request, {
          actorUserId: auth.userId,
          targetUserId,
          action,
          preflightAuditId: auditId,
          error: mutationError,
          afterState: { accountStatus: nextAccountStatus },
        });
        if (failedAuditId) auditIds.push(failedAuditId);
        throw mutationError;
      }
    }

    return NextResponse.json({
      success: true,
      auditIds,
      message: '사용자 계정 변경을 적용했습니다.',
      safeguards: {
        selfLockoutBlocked: isSelfTarget,
        lastAdminProtected: targetIsActiveAdmin && activeAdminUserIds.size <= 1,
      },
    });
  } catch (error) {
    console.error('[admin/users] failed to update user:', error);
    return NextResponse.json({ error: '사용자 계정 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
