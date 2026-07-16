import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { getAdminSafeErrorName } from '@/lib/admin/guarded-mutation-contract';

export const runtime = 'nodejs';

const DEFAULT_PER_PAGE = 80;
const MAX_PER_PAGE = 200;
const ADMIN_USER_CREATION_ONBOARDING_REQUIRED = {
  code: 'ADMIN_USER_CREATION_ONBOARDING_REQUIRED',
  error: '새 계정은 개인정보 온보딩 가입 절차를 통해서만 만들 수 있습니다.',
} as const;

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
    console.error('[admin/users] failed to list users', {
      domain: 'admin_user_management',
      action: 'list_users',
      step: 'list',
      errorName: getAdminSafeErrorName(error),
    });
    return NextResponse.json({ error: '사용자 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    ADMIN_USER_CREATION_ONBOARDING_REQUIRED,
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );
}
