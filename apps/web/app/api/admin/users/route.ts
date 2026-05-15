import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';

import { requireAdmin } from '@/lib/auth/require-admin';
import { recordAdminUserAuditEvent } from '@/lib/admin/user-audit';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { ADMIN_ROLE_CONFIRMATION, validateAdminUserConfirmation } from '@/lib/admin/user-management-guards';

export const runtime = 'nodejs';

const DEFAULT_PER_PAGE = 80;
const MAX_PER_PAGE = 200;

function normalizeSearch(value: string | null) {
  return (value ?? '').trim().toLowerCase();
}

function isDisabledUser(user: Pick<User, 'banned_until'>) {
  if (!user.banned_until) return false;
  const bannedUntil = Date.parse(user.banned_until);
  return Number.isFinite(bannedUntil) && bannedUntil > Date.now();
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toAuditErrorCode(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 160);
  return 'unknown-admin-user-create-error';
}

async function recordFailedCreateAuditEvent(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  request: NextRequest,
  payload: {
    actorUserId: string;
    targetUserId?: string | null;
    preflightAuditId: string;
    error: unknown;
    afterState: Record<string, unknown>;
  },
) {
  try {
    return await recordAdminUserAuditEvent(supabase, request, {
      actorUserId: payload.actorUserId,
      targetUserId: payload.targetUserId ?? null,
      action: 'admin_user_created',
      reason: 'failed-admin-user-create',
      beforeState: { preflightAuditId: payload.preflightAuditId },
      afterState: payload.afterState,
      status: 'failed',
      correlationId: payload.preflightAuditId,
      errorCode: toAuditErrorCode(payload.error),
    });
  } catch (auditError) {
    console.error('[admin/users] failed to record failed create audit event:', auditError);
    return null;
  }
}

type ProfileRow = {
  id?: string;
  user_id: string;
  username?: string | null;
  nickname?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RoleRow = {
  user_id: string;
  role: string;
};

type AccountStatusRow = {
  user_id: string;
  account_status: 'active' | 'disabled';
};

async function fetchProfileMap(supabase: ReturnType<typeof createSupabaseServiceRoleClient>, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, ProfileRow>();

  const { data, error } = await supabase
    .from('profiles')
    .select('id,user_id,username,nickname,avatar_url,role,created_at,updated_at')
    .in('user_id', userIds);

  if (error) throw error;

  return new Map(((data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile]));
}

async function fetchAdminRoleSet(supabase: ReturnType<typeof createSupabaseServiceRoleClient>, userIds?: string[]) {
  let query = supabase
    .from('user_roles')
    .select('user_id, role')
    .eq('role', 'admin');

  if (userIds && userIds.length > 0) {
    query = query.in('user_id', userIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return new Set(((data ?? []) as RoleRow[]).map((role) => role.user_id));
}

async function fetchAccountStatusMap(supabase: ReturnType<typeof createSupabaseServiceRoleClient>, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, AccountStatusRow['account_status']>();

  const { data, error } = await supabase
    .from('user_account_status')
    .select('user_id, account_status')
    .in('user_id', userIds);

  if (error) throw error;

  return new Map(((data ?? []) as AccountStatusRow[]).map((status) => [status.user_id, status.account_status]));
}

function buildManagedUser(user: User, profile: ProfileRow | undefined, adminUserIds: Set<string>, accountStatus?: AccountStatusRow['account_status']) {
  const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nickname = toStringValue(profile?.nickname) || toStringValue(userMetadata.nickname) || '닉네임 없음';
  const username = toStringValue(profile?.username) || toStringValue(userMetadata.username) || user.email?.split('@')[0] || 'unknown';
  const isAdmin = adminUserIds.has(user.id);
  const isDisabled = accountStatus === 'disabled' || isDisabledUser(user);

  return {
    id: user.id,
    email: user.email ?? '',
    username,
    nickname,
    avatarUrl: profile?.avatar_url ?? null,
    profileRole: profile?.role ?? (isAdmin ? 'admin' : 'user'),
    isAdmin,
    isDisabled,
    bannedUntil: user.banned_until ?? null,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    statusLabel: isDisabled ? '비활성' : '활성',
    roleLabel: isAdmin ? '관리자' : '일반 사용자',
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createSupabaseServiceRoleClient();
    const searchParams = request.nextUrl.searchParams;
    const search = normalizeSearch(searchParams.get('search'));
    const page = Math.max(Number(searchParams.get('page') ?? '1') || 1, 1);
    const requestedPerPage = Number(searchParams.get('perPage') ?? String(DEFAULT_PER_PAGE)) || DEFAULT_PER_PAGE;
    const perPage = Math.min(Math.max(requestedPerPage, 1), MAX_PER_PAGE);

    const userPages = [];
    let listedTotal = 0;

    if (search) {
      for (let searchPage = 1; searchPage <= 5; searchPage += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page: searchPage, perPage: MAX_PER_PAGE });
        if (error) throw error;
        userPages.push(...(data.users ?? []));
        listedTotal = data.total ?? listedTotal;
        if (!data.users || data.users.length < MAX_PER_PAGE) break;
      }
    } else {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      userPages.push(...(data.users ?? []));
      listedTotal = data.total ?? userPages.length;
    }

    const authUsers = userPages;
    const userIds = authUsers.map((user) => user.id);
    const [profileMap, adminUserIds, accountStatusMap] = await Promise.all([
      fetchProfileMap(supabase, userIds),
      fetchAdminRoleSet(supabase, userIds),
      fetchAccountStatusMap(supabase, userIds),
    ]);

    const users = authUsers
      .map((user) => buildManagedUser(user, profileMap.get(user.id), adminUserIds, accountStatusMap.get(user.id)))
      .filter((user) => {
        if (!search) return true;
        return [user.email, user.nickname, user.username, user.id]
          .join(' ')
          .toLowerCase()
          .includes(search);
      });

    return NextResponse.json(
      {
        users,
        page,
        perPage,
        total: search ? users.length : listedTotal,
        summary: {
          loadedUsers: users.length,
          adminUsers: users.filter((user) => user.isAdmin).length,
          disabledUsers: users.filter((user) => user.isDisabled).length,
          unconfirmedUsers: users.filter((user) => !user.emailConfirmedAt).length,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[admin/users] failed to list users:', error);
    return NextResponse.json({ error: '사용자 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const email = toStringValue(body?.email).toLowerCase();
    const password = toStringValue(body?.password);
    const nickname = toStringValue(body?.nickname) || email.split('@')[0] || '새 사용자';
    const username = toStringValue(body?.username) || email.split('@')[0] || 'new-user';
    const shouldGrantAdmin = Boolean(body?.isAdmin);
    const confirmation = toStringValue(body?.confirmation);

    if (!email.includes('@')) {
      return NextResponse.json({ error: '올바른 이메일을 입력해 주세요.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: '임시 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
    }

    const confirmationError = shouldGrantAdmin
      ? validateAdminUserConfirmation({ nextRole: 'admin', confirmation })
      : null;
    if (confirmationError) {
      return NextResponse.json({ error: confirmationError }, { status: 400 });
    }

    const supabase = createSupabaseServiceRoleClient();
    const preflightAuditId = await recordAdminUserAuditEvent(supabase, request, {
      actorUserId: auth.userId,
      action: 'admin_user_created',
      reason: shouldGrantAdmin ? 'preflight-create-with-admin-role' : 'preflight-create-standard-user',
      beforeState: {},
      afterState: { email, username, nickname, isAdmin: shouldGrantAdmin, confirmation: shouldGrantAdmin ? ADMIN_ROLE_CONFIRMATION : null },
      status: 'intent',
    });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { nickname, username },
    });

    if (error || !data.user) {
      await recordFailedCreateAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        preflightAuditId,
        error: error ?? new Error('auth-user-create-returned-empty-user'),
        afterState: { email, username, nickname, isAdmin: shouldGrantAdmin },
      });
      return NextResponse.json({ error: error?.message ?? '사용자를 만들지 못했습니다.' }, { status: 400 });
    }

    const profileRole = shouldGrantAdmin ? 'admin' : 'user';
    const { error: accountStatusError } = await supabase
      .from('user_account_status')
      .insert({ user_id: data.user.id, account_status: 'active' });

    if (accountStatusError) {
      await recordFailedCreateAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId: data.user.id,
        preflightAuditId,
        error: accountStatusError,
        afterState: { email, username, nickname, isAdmin: shouldGrantAdmin, failedStep: 'account-status-insert' },
      });
      await supabase.auth.admin.deleteUser(data.user.id).catch((cleanupError) => {
        console.error('[admin/users] failed to clean up auth user after account status insert error:', cleanupError);
      });
      return NextResponse.json({ error: '계정 상태 초기화에 실패해 사용자 생성을 취소했습니다.' }, { status: 500 });
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: data.user.id,
        username,
        nickname,
        role: profileRole,
      });

    if (profileError) {
      await recordFailedCreateAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId: data.user.id,
        preflightAuditId,
        error: profileError,
        afterState: { email, username, nickname, isAdmin: shouldGrantAdmin, failedStep: 'profile-insert' },
      });
      await supabase.auth.admin.deleteUser(data.user.id).catch((cleanupError) => {
        console.error('[admin/users] failed to clean up auth user after profile insert error:', cleanupError);
      });
      return NextResponse.json({ error: '프로필 생성에 실패해 사용자 생성을 취소했습니다.' }, { status: 500 });
    }

    if (shouldGrantAdmin) {
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({ user_id: data.user.id, role: 'admin' });

      if (roleError) {
        await recordFailedCreateAuditEvent(supabase, request, {
          actorUserId: auth.userId,
          targetUserId: data.user.id,
          preflightAuditId,
          error: roleError,
          afterState: { email, username, nickname, isAdmin: shouldGrantAdmin, failedStep: 'admin-role-insert' },
        });
        await supabase.auth.admin.deleteUser(data.user.id).catch((cleanupError) => {
          console.error('[admin/users] failed to clean up auth user after role insert error:', cleanupError);
        });
        return NextResponse.json({ error: '관리자 권한 연결에 실패해 사용자 생성을 취소했습니다.' }, { status: 500 });
      }
    }

    let auditId = preflightAuditId;
    try {
      auditId = await recordAdminUserAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId: data.user.id,
        action: 'admin_user_created',
        reason: shouldGrantAdmin ? 'created-with-admin-role' : 'created-standard-user',
        beforeState: { preflightAuditId },
        afterState: { email, username, nickname, isAdmin: shouldGrantAdmin },
        status: 'applied',
        correlationId: preflightAuditId,
      });
    } catch (auditError) {
      await recordFailedCreateAuditEvent(supabase, request, {
        actorUserId: auth.userId,
        targetUserId: data.user.id,
        preflightAuditId,
        error: auditError,
        afterState: { email, username, nickname, isAdmin: shouldGrantAdmin, failedStep: 'applied-audit' },
      });
      await supabase.auth.admin.deleteUser(data.user.id).catch((cleanupError) => {
        console.error('[admin/users] failed to clean up auth user after applied audit error:', cleanupError);
      });
      return NextResponse.json({ error: '감사 기록 확정에 실패해 사용자 생성을 취소했습니다.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      auditId,
      preflightAuditId,
      user: buildManagedUser(data.user, { user_id: data.user.id, username, nickname, role: profileRole }, shouldGrantAdmin ? new Set([data.user.id]) : new Set(), 'active'),
      message: shouldGrantAdmin ? '관리자 계정을 만들었습니다.' : '일반 사용자 계정을 만들었습니다.',
    });
  } catch (error) {
    console.error('[admin/users] failed to create user:', error);
    return NextResponse.json({ error: '사용자 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
