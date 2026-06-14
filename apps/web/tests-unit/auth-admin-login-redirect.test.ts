import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

import {
  buildHomeAuthLoginPath,
  getSafeAuthNextPath,
  isAdminAuthRedirect,
  readHomeAuthLoginRequestFromLocation,
} from '@/lib/auth/auth-redirect';

type SupabaseMockState = {
  userId: string | null;
  authError?: unknown;
  role?: { role: string } | null;
  roleError?: unknown;
  accountStatus?: { account_status: string } | null;
  accountStatusError?: unknown;
};

let supabaseMockState: SupabaseMockState = { userId: null };

mock.module('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: supabaseMockState.userId
            ? { id: supabaseMockState.userId }
            : null,
        },
        error: supabaseMockState.authError ?? null,
      }),
    },
    from: (tableName: string) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => {
        if (tableName === 'user_roles') {
          return {
            data: supabaseMockState.role ?? null,
            error: supabaseMockState.roleError ?? null,
          };
        }

        if (tableName === 'user_account_status') {
          return {
            data: supabaseMockState.accountStatus ?? null,
            error: supabaseMockState.accountStatusError ?? null,
          };
        }

        return { data: null, error: null };
      },
    }),
  }),
}));

function adminRequest(path = '/admin?module=storyboard') {
  return new NextRequest(`http://localhost:3000${path}`);
}

async function loadMiddleware() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`@/lib/supabase/middleware?${nonce}`) as Promise<
    typeof import('@/lib/supabase/middleware')
  >;
}

describe('admin auth redirect helpers', () => {
  test('관리자 next 경로와 쿼리를 안전하게 보존한다', () => {
    expect(getSafeAuthNextPath('/admin?module=storyboard')).toBe(
      '/admin?module=storyboard',
    );
    expect(isAdminAuthRedirect('admin', '/admin?module=storyboard')).toBe(true);
    expect(getSafeAuthNextPath('https://evil.test/admin')).toBe('/');
    expect(getSafeAuthNextPath('//evil.test/admin')).toBe('/');
    expect(getSafeAuthNextPath('/admin\\evil')).toBe('/');
  });

  test('홈 로그인 모달 요청 URL을 읽고 검증된 next만 넘긴다', () => {
    const loginPath = buildHomeAuthLoginPath({
      reason: 'admin',
      next: '/admin?module=storyboard',
    });

    expect(loginPath).toBe('/?auth=login&reason=admin&next=%2Fadmin%3Fmodule%3Dstoryboard');

    const request = readHomeAuthLoginRequestFromLocation({ search: loginPath.slice(1) });
    expect(request).toEqual({
      requested: true,
      reason: 'admin',
      nextPath: '/admin?module=storyboard',
    });
  });
});

describe('admin middleware login redirect', () => {
  test('미로그인 관리자는 auth required 화면 대신 홈 로그인 모달 URL로 보낸다', async () => {
    supabaseMockState = {
      userId: null,
      authError: new Error('missing session'),
    };

    const { updateSession } = await loadMiddleware();
    const response = await updateSession(adminRequest());
    const location = response.headers.get('location');

    expect(response.status).toBe(307);
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe('/');
    expect(redirectUrl.searchParams.get('auth')).toBe('login');
    expect(redirectUrl.searchParams.get('reason')).toBe('admin');
    expect(redirectUrl.searchParams.get('next')).toBe('/admin?module=storyboard');
  });

  test('로그인했지만 관리자가 아니면 홈으로 보낸다', async () => {
    supabaseMockState = {
      userId: 'regular-user-id',
      role: null,
    };

    const { updateSession } = await loadMiddleware();
    const response = await updateSession(adminRequest());
    const location = response.headers.get('location');

    expect(response.status).toBe(307);
    expect(location).toBe('http://localhost:3000/');
  });

  test('관리자는 요청한 관리자 페이지를 그대로 통과한다', async () => {
    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatus: { account_status: 'active' },
    };

    const { updateSession } = await loadMiddleware();
    const response = await updateSession(adminRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
