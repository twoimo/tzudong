import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildHomeAuthLoginPath,
  getSafeAuthNextPath,
  isAdminAuthRedirect,
  readHomeAuthLoginRequestFromLocation,
} from '@/lib/auth/auth-redirect';
import {
  classifyPublicEligibilitySessionRoute,
  shouldSkipPublicEligibilitySession,
} from '@/lib/auth/public-eligibility-session';
import {
  consumePasswordRecoveryProof,
  recordPasswordRecoveryProof,
} from '@/lib/auth/password-recovery-proof';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy/policy';

type SupabaseMockState = {
  userId: string | null;
  authError?: unknown;
  role?: { role: string } | null;
  roleError?: unknown;
  accountStatus?: { account_status: string } | null;
  accountStatusError?: unknown;
  activeSession?: boolean;
  activeSessionError?: unknown;
  privacyEligibility?: unknown;
  privacyEligibilityError?: unknown;
};

let supabaseMockState: SupabaseMockState = { userId: null };
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterAll(() => {
  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  }
  if (originalSupabaseAnonKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
  }
});

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

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
      signOut: async () => ({ error: null }),
    },
    rpc: (functionName: string) => {
      if (functionName === 'get_current_privacy_eligibility') {
        return Promise.resolve({
          data: supabaseMockState.privacyEligibility ?? {
            schemaVersion: 1,
            eligible: true,
            reasonCode: 'PRIVACY_ELIGIBLE',
            policyVersionId: '11111111-1111-4111-8111-111111111111',
            contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
            policyVersion: PRIVACY_POLICY_VERSION,
          },
          error: supabaseMockState.privacyEligibilityError ?? null,
        });
      }

      return {
        returns: async () => ({
          data: supabaseMockState.activeSession ?? true,
          error: supabaseMockState.activeSessionError ?? null,
        }),
      };
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

function adminRequest(path = '/admin?module=storyboard', method = 'GET') {
  return new NextRequest(`http://localhost:3000${path}`, { method });
}
function requestWithSupabaseSessionHint(path = '/', method = 'GET') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { cookie: 'sb-local-auth-token=session-hint' },
  });
}

async function loadMiddleware() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`@/lib/supabase/middleware?${nonce}`) as Promise<
    typeof import('@/lib/supabase/middleware')
  >;
}
async function loadProxy() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`../proxy?eligibility=${nonce}`) as Promise<typeof import('../proxy')>;
}

test('proxy emits a fresh nonce-bound enforcing CSP and forwards the nonce to rendering', async () => {
  const { proxy } = await import(`../proxy?csp=${Date.now()}-${Math.random()}`);
  const first = await proxy(adminRequest('/'));
  const second = await proxy(adminRequest('/'));
  const firstPolicy = first.headers.get('content-security-policy');
  const secondPolicy = second.headers.get('content-security-policy');
  const firstNonce = first.headers.get('x-middleware-request-x-nonce');
  const secondNonce = second.headers.get('x-middleware-request-x-nonce');

  expect(firstPolicy).toContain("script-src 'self' 'nonce-");
  expect(firstPolicy).toContain("'strict-dynamic'");
  expect(firstPolicy).toContain("object-src 'none'");
  expect(firstPolicy).toContain("base-uri 'none'");
  expect(firstPolicy).toContain("frame-ancestors 'none'");
  expect(firstNonce).toBeTruthy();
  expect(firstPolicy).toContain(`'nonce-${firstNonce}'`);
  expect(secondPolicy).toContain(`'nonce-${secondNonce}'`);
  expect(secondNonce).not.toBe(firstNonce);
});
describe('password recovery proof', () => {
  test('is user-bound and can be consumed only once', () => {
    recordPasswordRecoveryProof('user-a');
    expect(consumePasswordRecoveryProof('user-b')).toBe(false);

    recordPasswordRecoveryProof('user-a');
    expect(consumePasswordRecoveryProof('user-a')).toBe(true);
    expect(consumePasswordRecoveryProof('user-a')).toBe(false);
  });
});
describe('public eligibility proxy', () => {
  test('public eligibility skip decisions keep session hints eligible for live checks', () => {
    expect(shouldSkipPublicEligibilitySession({
      pathname: '/',
      method: 'GET',
      hasSessionHint: true,
    })).toBe(false);
    expect(shouldSkipPublicEligibilitySession({
      pathname: '/api/shorten',
      method: 'POST',
      hasSessionHint: true,
    })).toBe(false);

    expect(shouldSkipPublicEligibilitySession({
      pathname: '/',
      method: 'GET',
      hasSessionHint: false,
    })).toBe(true);
    expect(shouldSkipPublicEligibilitySession({
      pathname: '/api/shorten',
      method: 'GET',
      hasSessionHint: false,
    })).toBe(true);

    for (const pathname of ['/api/privacy/onboarding', '/auth/callback', '/privacy/onboarding', '/auth/reset-password', '/auth/required']) {
      expect(shouldSkipPublicEligibilitySession({
        pathname,
        method: 'GET',
        hasSessionHint: true,
      })).toBe(true);
    }

    expect(shouldSkipPublicEligibilitySession({
      pathname: '/admin',
      method: 'GET',
      hasSessionHint: false,
    })).toBe(false);
  });
  test('only the exact method/path matrix can bypass eligibility', () => {
    for (const { pathname, method } of [
      { pathname: '/privacy', method: 'POST' },
      { pathname: '/data-deletion', method: 'POST' },
      { pathname: '/auth/callback', method: 'POST' },
      { pathname: '/auth//callback', method: 'GET' },
      { pathname: '/privacy/', method: 'GET' },
      { pathname: '/%70rivacy', method: 'GET' },
      { pathname: '/privacy%2f', method: 'GET' },
      { pathname: '/privacy%5c', method: 'GET' },
      { pathname: '/privacy\\', method: 'GET' },
      { pathname: '/privacy%252f', method: 'GET' },
      { pathname: '/privacy%zz', method: 'GET' },
      { pathname: '/privacy.evil', method: 'GET' },
      { pathname: '/api/privacy/onboarding/evil', method: 'GET' },
      { pathname: '/api/privacy/onboarding/', method: 'POST' },
      { pathname: '/api/privacy//onboarding', method: 'POST' },
      { pathname: '/api/privacy/%6fonboarding', method: 'POST' },
      { pathname: '/api/health', method: 'POST' },
      { pathname: '/auth/reset-password', method: 'POST' },
      { pathname: '/api/shorten/evil', method: 'GET' },
      { pathname: '/api/shorten/', method: 'HEAD' },
      { pathname: '/api/shorten', method: 'POST' },
      { pathname: '/auth/required', method: 'get' },
    ]) {
      expect(classifyPublicEligibilitySessionRoute({ pathname, method })).toBe('protected');
      expect(shouldSkipPublicEligibilitySession({
        pathname,
        method,
        hasSessionHint: true,
      })).toBe(false);
      expect(shouldSkipPublicEligibilitySession({
        pathname,
        method,
        hasSessionHint: false,
      })).toBe(false);
    }

    for (const { pathname, method, routeClass } of [
      { pathname: '/', method: 'GET', routeClass: 'credentialless-public' },
      { pathname: '/privacy', method: 'HEAD', routeClass: 'credentialless-public' },
      { pathname: '/api/health', method: 'HEAD', routeClass: 'credentialless-public' },
      { pathname: '/api/privacy/onboarding', method: 'POST', routeClass: 'loop-safe' },
      { pathname: '/auth/callback', method: 'GET', routeClass: 'loop-safe' },
      { pathname: '/auth/reset-password', method: 'GET', routeClass: 'loop-safe' },
    ] as const) {
      expect(classifyPublicEligibilitySessionRoute({ pathname, method })).toBe(routeClass);
    }
  });

  test('credentialless public pages and APIs bypass session lookup', async () => {
    supabaseMockState = {
      userId: 'held-user-id',
      privacyEligibility: {
        schemaVersion: 1,
        eligible: false,
        reasonCode: 'PRIVACY_AGE_BLOCKED',
        policyVersionId: '11111111-1111-4111-8111-111111111111',
        contentSha256: 'a'.repeat(64),
      },
    };

    const { proxy } = await loadProxy();
    for (const path of ['/', '/home-frame', '/stamp', '/api/shorten']) {
      const response = await proxy(adminRequest(path));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  test('onboarding, callback, and health loop-safe paths remain available to held sessions', async () => {
    supabaseMockState = {
      userId: 'held-user-id',
      privacyEligibility: {
        schemaVersion: 1,
        eligible: false,
        reasonCode: 'PRIVACY_AGE_BLOCKED',
        policyVersionId: '11111111-1111-4111-8111-111111111111',
        contentSha256: 'a'.repeat(64),
      },
    };

    const { proxy } = await loadProxy();
    for (const path of ['/api/privacy/onboarding', '/auth/callback', '/privacy/onboarding', '/auth/reset-password']) {
      const response = await proxy(requestWithSupabaseSessionHint(path));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });
});
describe('admin auth redirect helpers', () => {
  test('관리자 next 경로와 쿼리를 안전하게 보존한다', () => {
    expect(getSafeAuthNextPath('/admin?module=storyboard')).toBe(
      '/admin?module=storyboard',
    );
    expect(isAdminAuthRedirect('admin', '/admin?module=storyboard')).toBe(true);
    expect(getSafeAuthNextPath('https://evil.test/admin')).toBe('/');
    expect(getSafeAuthNextPath('//evil.test/admin')).toBe('/');
    expect(getSafeAuthNextPath('/admin\\evil')).toBe('/');
    expect(getSafeAuthNextPath('/admin?redirect=<script>')).toBe('/');
    expect(getSafeAuthNextPath(`/admin?${'x'.repeat(181)}`)).toBe('/');
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

  test('홈 쿼리 로그인 성공은 success-aware cleanup을 사용하고 관리자 redirect는 assign을 유지한다', () => {
    const authModalSource = source('components/auth/AuthModal.tsx');
    const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');

    expect(authModalSource).toContain('onAuthSuccess?: () => void;');
    expect(authModalSource).toContain('const closeAfterAuthSuccess = useCallback(() => {');
    expect(authModalSource).toContain('window.location.assign(safeRedirectTo);');
    expect(authModalSource.indexOf('redirectAfterAdminLogin()')).toBeLessThan(
      authModalSource.indexOf('closeAfterAuthSuccess();'),
    );
    expect(homeRuntimeShellSource).toContain('onAuthSuccess={closeAuthAfterSuccess}');
    expect(homeRuntimeShellSource).toContain("window.history.replaceState(window.history.state, '', '/')");
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
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe('/');
    expect(redirectUrl.searchParams.get('auth')).toBe('login');
    expect(redirectUrl.searchParams.get('reason')).toBe('admin');
    expect(redirectUrl.searchParams.get('next')).toBe('/admin?module=storyboard');
  });
  test('관리자 로그인 리디렉션은 초과 길이 또는 잘못된 next 컨텍스트를 루트로 제한한다', async () => {
    supabaseMockState = {
      userId: null,
      authError: new Error('missing session'),
    };

    const { updateSession } = await loadMiddleware();
    for (const path of [`/admin?${'x'.repeat(181)}`, '/admin?next=%']) {
      const response = await updateSession(adminRequest(path));
      const redirectUrl = new URL(response.headers.get('location')!);

      expect(response.status).toBe(307);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(redirectUrl.searchParams.get('next')).toBe('/');
    }
  });
  test('활성 세션 확인이 실패하면 로그인 화면으로 닫힌다', async () => {
    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatus: { account_status: 'active' },
      activeSession: false,
    };

    const { updateSession } = await loadMiddleware();
    const response = await updateSession(adminRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toContain(
      '/?auth=login&reason=admin&next=',
    );
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
    expect(response.headers.get('cache-control')).toBe('no-store');
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
  test('마이페이지 인증 리디렉션은 캐시하지 않는다', async () => {
    supabaseMockState = {
      userId: null,
      authError: new Error('missing session'),
    };

    const { updateSession } = await loadMiddleware();
    const response = await updateSession(adminRequest('/mypage'));

    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toContain('/auth/required?reason=mypage');
  });

  test('Supabase 설정이 없으면 보호된 관리자 JSON 응답을 캐시하지 않는다', async () => {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const configuredAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    try {
      const { updateSession } = await loadMiddleware();
      const response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));

      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({ error: 'Service unavailable' });
    } finally {
      if (configuredUrl === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_URL = configuredUrl;
      }
      if (configuredAnonKey === undefined) {
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      } else {
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = configuredAnonKey;
      }
    }
  });
});
  test('관리자 보호 경로의 비탐색 요청은 리디렉션 대신 닫힌 JSON 응답을 받는다', async () => {
    supabaseMockState = {
      userId: null,
      authError: new Error('missing session'),
    };

    const { updateSession } = await loadMiddleware();
    for (const [path, method] of [
      ['/admin', 'POST'],
      ['/api/admin', 'GET'],
      ['/api/admin/release-auth-proof', 'GET'],
      ['/api/admin/release-auth-proof', 'POST'],
    ] as const) {
      const response = await updateSession(adminRequest(path, method));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('location')).toBeNull();
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    }
  });

  test('관리자 권한 및 상태 권한 오류는 API 요청을 fail closed 한다', async () => {
    const { updateSession } = await loadMiddleware();

    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatus: { account_status: 'disabled' },
    };
    let response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });

    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatus: null,
    };
    response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });

    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatusError: { code: 'PGRST205', message: 'user_account_status schema cache unavailable' },
    };
    response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });

    supabaseMockState = {
      userId: 'admin-user-id',
      role: { role: 'admin' },
      accountStatus: { account_status: 'active' },
      activeSession: false,
    };
    response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
  test('live eligibility denials, malformed receipts, and RPC failures close protected sessions', async () => {
    const { updateSession } = await loadMiddleware();
    const denialReasons = [
      'PRIVACY_POLICY_UNAVAILABLE',
      'PRIVACY_AGE_ATTESTATION_REQUIRED',
      'PRIVACY_POLICY_REATTESTATION_REQUIRED',
      'PRIVACY_AGE_BLOCKED',
      'PRIVACY_GUARDIAN_REQUIRED',
      'PRIVACY_GUARDIAN_CONSENT_REQUIRED',
    ] as const;

    for (const reasonCode of denialReasons) {
      supabaseMockState = {
        userId: 'admin-user-id',
        privacyEligibility: reasonCode === 'PRIVACY_POLICY_UNAVAILABLE'
          ? {
            schemaVersion: 1,
            eligible: false,
            reasonCode,
            policyVersionId: null,
            contentSha256: null,
          }
          : {
            schemaVersion: 1,
            eligible: false,
            reasonCode,
            policyVersionId: '11111111-1111-4111-8111-111111111111',
            contentSha256: 'a'.repeat(64),
          },
      };
      const response = await updateSession(adminRequest());
      const location = response.headers.get('location');

      expect(response.status).toBe(307);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(location).toContain('/auth/required?reason=privacy');
    }

    for (const privacyEligibility of [null, { eligible: true, reasonCode: 'PRIVACY_ELIGIBLE' }]) {
      supabaseMockState = { userId: 'admin-user-id', privacyEligibility };
      const response = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));

      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    }

    supabaseMockState = {
      userId: 'admin-user-id',
      privacyEligibilityError: { code: 'PGRST999' },
    };
    const rpcFailureResponse = await updateSession(adminRequest('/api/admin/release-auth-proof', 'POST'));
    expect(rpcFailureResponse.status).toBe(403);
    expect(rpcFailureResponse.headers.get('cache-control')).toBe('no-store');
  });
  test('existing accounts are classification-only and missing privacy evidence stays onboarding-required', () => {
    const middleware = source('lib/supabase/middleware.ts');
    const eligibility = source('lib/privacy/eligibility.ts');

    expect(middleware).toContain('await getCurrentPrivacyEligibility(supabase)');
    expect(middleware).not.toContain('auth.admin.createUser');
    expect(middleware).not.toContain('confirm_privacy_onboarding');
    expect(middleware).not.toContain('privacy_age_profiles');
    expect(eligibility).toContain("rpc('get_current_privacy_eligibility')");
    expect(eligibility).not.toContain('submit_privacy_consent');
  });
