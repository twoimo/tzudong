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
type AdminUserManagementMetadataRow = {
  user_id: string;
  username: string | null;
  nickname: string | null;
  avatar_url: string | null;
  profile_role: string | null;
  profile_created_at: string | null;
  profile_updated_at: string | null;
  is_admin: boolean;
  account_status: 'active' | 'disabled' | null;
};

async function fetchUserManagementMetadata(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  userIds: string[],
) {
  const metadata = new Map<string, AdminUserManagementMetadataRow>();
  for (let offset = 0; offset < userIds.length; offset += MAX_PER_PAGE) {
    const boundedUserIds = userIds.slice(offset, offset + MAX_PER_PAGE);
    const requestedIds = new Set(boundedUserIds);
    const returnedIds = new Set<string>();
    const { data, error } = await supabase.rpc(
      'read_admin_user_management_metadata',
      { p_user_ids: boundedUserIds },
    );
    if (error) throw error;

    for (const row of (data ?? []) as AdminUserManagementMetadataRow[]) {
      if (
        !requestedIds.has(row.user_id)
        || returnedIds.has(row.user_id)
        || typeof row.is_admin !== 'boolean'
        || !['active', 'disabled', null].includes(row.account_status)
      ) {
        throw new Error('관리자 사용자 메타데이터 응답이 유효하지 않습니다.');
      }
      returnedIds.add(row.user_id);
      metadata.set(row.user_id, row);
    }
    if (returnedIds.size !== requestedIds.size) {
      throw new Error('관리자 사용자 메타데이터 응답이 완전하지 않습니다.');
    }
  }
  return metadata;
}

function buildManagedUser(user: User, metadata: AdminUserManagementMetadataRow | undefined) {
  const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nickname = toStringValue(metadata?.nickname) || toStringValue(userMetadata.nickname) || '닉네임 없음';
  const username = toStringValue(metadata?.username) || toStringValue(userMetadata.username) || user.email?.split('@')[0] || 'unknown';
  const isAdmin = metadata?.is_admin === true;
  const isDisabled = metadata ? metadata.account_status !== 'active' || isDisabledUser(user) : true;

  return {
    id: user.id,
    email: user.email ?? '',
    username,
    nickname,
    avatarUrl: metadata?.avatar_url ?? null,
    profileRole: metadata?.profile_role ?? (isAdmin ? 'admin' : 'user'),
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
    const metadataMap = await fetchUserManagementMetadata(supabase, userIds);

    const users = authUsers
      .map((user) => buildManagedUser(user, metadataMap.get(user.id)))
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
