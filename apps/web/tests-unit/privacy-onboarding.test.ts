import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';

import {
  UNDER_14_SIGNUP_UNAVAILABLE,
  clearRejectedOnboardingCookies,
  ONBOARDING_CHALLENGE_COOKIE,
  parseOnboardingStart,
  readOnboardingChallenge,
  sealOnboardingChallenge,
} from '@/lib/privacy/onboarding';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  privacyPolicyHashInput,
} from '@/lib/privacy/policy';
import { parsePrivacyEligibilityReceipt } from '@/lib/privacy/eligibility';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const POLICY_ID = '11111111-1111-4111-8111-111111111111';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';
const originalSecret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
const testCookieSecret = 'test-only-onboarding-cookie-secret-at-least-32-bytes';
beforeEach(() => {
  process.env.PRIVACY_ONBOARDING_COOKIE_SECRET = testCookieSecret;
  resetOAuthRejectionRouteMock();
});
afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  } else {
    process.env.PRIVACY_ONBOARDING_COOKIE_SECRET = originalSecret;
  }
});

function validStart(overrides: Record<string, unknown> = {}) {
  return {
    policyVersion: POLICY_ID,
    ageBand: 'age_14_plus',
    intent: 'password',
    policyAcknowledged: true,
    marketing: {
      email: false,
      sms: false,
      push: false,
      nightByChannel: { email: false, sms: false, push: false },
    },
    ...overrides,
  };
}

function signedChallenge(expiresAt: number) {
  return sealOnboardingChallenge({
    version: 1,
    challengeId: CHALLENGE_ID,
    challengeToken: 'a'.repeat(64),
    policyVersionId: POLICY_ID,
    contentSha256: 'c'.repeat(64),
    ageBand: 'age_14_plus',
    intent: 'oauth',
    oauthNonce: 'b'.repeat(64),
    expiresAt,
  });
}

function rawSignedChallenge(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${createHmac('sha256', testCookieSecret).update(encoded).digest('base64url')}`;
}
function validEligibilityReceipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eligible: true,
    reasonCode: 'PRIVACY_ELIGIBLE',
    policyVersionId: POLICY_ID,
    contentSha256: 'a'.repeat(64),
    ...overrides,
  };
}
type OAuthRejectionReadback = 'absent' | 'live';

const OAUTH_REJECTION_TEST_USER_ID = '33333333-3333-4333-8333-333333333333';
const OAUTH_REJECTION_AUDIT_ID = '44444444-4444-4444-8444-444444444444';

let oauthRejectionReadback: OAuthRejectionReadback = 'absent';
let oauthRejectionSignOutFails = false;
let oauthRejectionGetUserCalls = 0;
let oauthRejectionSignOutScopes: string[] = [];
let oauthRejectionHoldRequests: Array<Record<string, unknown>> = [];

function resetOAuthRejectionRouteMock() {
  oauthRejectionReadback = 'absent';
  oauthRejectionSignOutFails = false;
  oauthRejectionGetUserCalls = 0;
  oauthRejectionSignOutScopes = [];
  oauthRejectionHoldRequests = [];
}

function oauthRejectionRequest() {
  const challenge = signedChallenge(Date.now() + 60_000);
  if (!challenge) throw new Error('Expected signed OAuth onboarding challenge');

  return new Request(
    `https://www.tzudong.app/auth/callback?code=oauth-code&onboarding=1&onboarding_nonce=${'b'.repeat(64)}&next=%2Fsafe`,
    {
      headers: {
        cookie: `${ONBOARDING_CHALLENGE_COOKIE}=${challenge}`,
      },
    },
  );
}

mock.module('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      signOut: async ({ scope }: { scope: 'global' | 'local' }) => {
        oauthRejectionSignOutScopes.push(scope);
        if (oauthRejectionSignOutFails) throw new Error(`${scope} sign-out failed`);
      },
      getUser: async () => {
        oauthRejectionGetUserCalls += 1;
        if (oauthRejectionGetUserCalls === 1) {
          return { data: { user: { id: OAUTH_REJECTION_TEST_USER_ID } }, error: null };
        }

        return oauthRejectionReadback === 'absent'
          ? { data: { user: null }, error: null }
          : { data: { user: { id: OAUTH_REJECTION_TEST_USER_ID } }, error: null };
      },
    },
  }),
}));

mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => ({
    rpc: async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === 'confirm_privacy_onboarding') {
        return { data: null, error: new Error('onboarding confirmation rejected') };
      }
      if (functionName !== 'hold_privacy_onboarding_compensation') {
        throw new Error(`Unexpected RPC: ${functionName}`);
      }

      oauthRejectionHoldRequests.push(args);
      return {
        data: {
          schemaVersion: 1,
          operationId: CHALLENGE_ID,
          challengeId: CHALLENGE_ID,
          userId: OAUTH_REJECTION_TEST_USER_ID,
          status: 'held',
          reasonCode: 'ONBOARDING_OAUTH_REJECTED',
          auditId: OAUTH_REJECTION_AUDIT_ID,
          readback: {
            passed: true,
            holdRecorded: true,
            auditRecorded: true,
            active: true,
          },
        },
        error: null,
      };
    },
  }),
}));

const oauthCallbackRoute = await import('../app/auth/callback/route.ts?oauth-rejection-proof');
const oauthCallbackGet = oauthCallbackRoute.GET as (request: Request) => Promise<Response>;
mock.restore();

describe('privacy onboarding challenge', () => {
  test('만료·변조·비정규 정책 해시 또는 nonce challenge를 거부한다', () => {
    const expired = signedChallenge(Date.now() - 1);
    const active = signedChallenge(Date.now() + 60_000);
    const rawPayload = {
      version: 1,
      challengeId: CHALLENGE_ID,
      challengeToken: 'a'.repeat(64),
      policyVersionId: POLICY_ID,
      contentSha256: 'c'.repeat(64),
      ageBand: 'age_14_plus',
      intent: 'oauth',
      oauthNonce: 'b'.repeat(64),
      expiresAt: Date.now() + 60_000,
    };

    expect(typeof expired).toBe('string');
    expect(readOnboardingChallenge(expired!)).toBeNull();
    expect(typeof active).toBe('string');
    expect(readOnboardingChallenge(`${active}x`)).toBeNull();
    expect(readOnboardingChallenge(rawSignedChallenge({
      ...rawPayload,
      contentSha256: 'C'.repeat(64),
    }))).toBeNull();
    expect(readOnboardingChallenge(rawSignedChallenge({
      ...rawPayload,
      oauthNonce: 'B'.repeat(64),
    }))).toBeNull();
    const withoutHash: Record<string, unknown> = { ...rawPayload };
    delete withoutHash.contentSha256;
    expect(readOnboardingChallenge(rawSignedChallenge(withoutHash))).toBeNull();
    expect(readOnboardingChallenge(rawSignedChallenge({
      ...rawPayload,
      unexpected: true,
    }))).toBeNull();
  });

  test('rejected onboarding responses expire all bounded Supabase auth chunks', () => {
    const response = NextResponse.json({ code: 'REJECTED' }, { status: 403 });
    clearRejectedOnboardingCookies(response, new Request('https://www.tzudong.app/api/privacy/onboarding', {
      headers: {
        cookie: [
          'sb-project-auth-token.0=one',
          'sb-project-auth-token.1=two',
          'sb-project-auth-token-code-verifier=three',
          'sb-project-other=four',
        ].join('; '),
      },
    }));

    const expiredNames = response.cookies.getAll()
      .filter((cookie) => cookie.maxAge === 0)
      .map((cookie) => cookie.name);
    expect(expiredNames).toEqual(expect.arrayContaining([
      'tzudong_onboarding_challenge',
      'privacy_onboarding_password_recovery',
      'sb-project-auth-token.0',
      'sb-project-auth-token.1',
      'sb-project-auth-token-code-verifier',
    ]));
    expect(expiredNames).not.toContain('sb-project-other');
  });

  test('재사용과 정책 불일치는 서버의 원자적 확정 경로로 넘긴다', () => {
    const onboardingRoute = source('app/api/privacy/onboarding/route.ts');

    expect(onboardingRoute).toContain("rpc('confirm_privacy_onboarding'");
    expect(onboardingRoute).toContain('result.policyVersionId !== payload.policyVersionId');
    expect(onboardingRoute).toContain('contentSha256: currentPolicy.contentSha256');
    expect(onboardingRoute).toContain('contentSha256: challenge.contentSha256');
    expect(onboardingRoute).toContain('p_challenge_token: payload.challengeToken');
  });

  test('OAuth callback은 cookie challenge와 정규 lowercase nonce가 모두 일치해야 한다', () => {
    const callbackRoute = source('app/auth/callback/route.ts');

    expect(callbackRoute).toContain('onboarding_nonce');
    expect(callbackRoute).toContain("challenge.intent !== 'oauth'");
    expect(callbackRoute).toContain('LOWER_SHA256_PATTERN.test(returnedNonce)');
    expect(callbackRoute).toContain('safeEquals(challenge.oauthNonce, returnedNonce)');
    expect(callbackRoute).toContain("await supabase.auth.signOut({ scope: 'local' })");
  });

  test('browser auth contexts cannot bypass the privacy onboarding challenge', () => {
    const authContext = source('contexts/AuthContext.tsx');
    const authContextBase = source('contexts/AuthContextBase.tsx');
    const authModal = source('components/auth/AuthModal.tsx');
    const onboardingRoute = source('app/api/privacy/onboarding/route.ts');
    const callbackRoute = source('app/auth/callback/route.ts');

    for (const contextSource of [authContext, authContextBase]) {
      expect(contextSource).not.toContain('auth.signUp');
      expect(contextSource).not.toContain('signInWithOAuth');
    }
    expect(authContext).not.toContain('signUp');
    expect(authContext).not.toContain('signInWithGoogle');
    expect(authContextBase).not.toContain('signUp');
    expect(authContextBase).not.toContain('signInWithGoogle');

    expect(authModal).toContain('startOnboardingChallenge("password")');
    expect(authModal).toContain('action: "password_signup"');
    expect(onboardingRoute).toContain('signupClient.auth.signUp');
    expect(authModal).toContain('startOnboardingChallenge("oauth")');
    expect(authModal).toContain('onboarding_nonce');
    expect(callbackRoute).toContain('confirmOAuthOnboarding(challenge, userId)');
  });

  test('live eligibility receipt gates browser sessions without process-global policy state', () => {
    const authContext = source('contexts/AuthContext.tsx');
    const authModal = source('components/auth/AuthModal.tsx');
    const passwordLogin = authModal.slice(
      authModal.indexOf('const handleLogin = useCallback'),
      authModal.indexOf('const handleSignup = useCallback'),
    );
    const passwordSignup = authModal.slice(
      authModal.indexOf('const handleSignup = useCallback'),
      authModal.indexOf('const handleForgotPassword = useCallback'),
    );
    const eligibilityLookupIndex = authContext.indexOf('const eligibility = await getCurrentPrivacyEligibility(supabase);');
    const roleLookupIndex = authContext.indexOf('.from("user_roles")');
    const profileLookupIndex = authContext.indexOf('.from("profiles")');

    expect(authContext).not.toContain('privacy_age_profiles');
    expect(authContext).not.toContain('as never');
    expect(authContext).not.toContain('takePendingPrivacyEligibilityPolicyBinding');
    expect(authModal).not.toContain('registerPendingPrivacyEligibilityPolicyBinding');
    expect(authContext).toContain("getCurrentPrivacyEligibility(supabase)");
    expect(eligibilityLookupIndex).toBeGreaterThan(-1);
    expect(roleLookupIndex).toBeGreaterThan(eligibilityLookupIndex);
    expect(profileLookupIndex).toBeGreaterThan(eligibilityLookupIndex);
    expect(authContext).toContain('await signOutRejectedPrivacySession(supabase)');
    expect(authContext).toContain("dispatchHomeAuthSessionUpdated({ hasSession: true, source: 'auth-eligible-session' })");

    const loginEligibilityIndex = passwordLogin.indexOf('const eligibility = await getCurrentPrivacyEligibility(supabase);');
    expect(loginEligibilityIndex).toBeGreaterThan(-1);
    expect(passwordLogin.indexOf('toast.success("로그인 성공!")')).toBeGreaterThan(loginEligibilityIndex);
    expect(passwordLogin.indexOf('dispatchHomeAuthSessionUpdated({')).toBeGreaterThan(loginEligibilityIndex);
    expect(passwordLogin.indexOf('redirectAfterAdminLogin()')).toBeGreaterThan(loginEligibilityIndex);
    expect(passwordLogin).toContain('await rejectPrivacyIneligibleSession(signedInUserId)');
    expect(passwordLogin).toContain('privacyEligibilityGuidance(eligibility.reasonCode)');

    const signupEligibilityIndex = passwordSignup.indexOf('const eligibility = await getCurrentPrivacyEligibility(supabase);');
    expect(signupEligibilityIndex).toBeGreaterThan(-1);
    expect(passwordSignup).toContain('const challenge = await startOnboardingChallenge("password");');
    expect(passwordSignup).toContain('action: "password_signup"');
    expect(passwordSignup.indexOf('toast.success("회원가입 완료! 환영합니다.")')).toBeGreaterThan(signupEligibilityIndex);
    expect(passwordSignup.indexOf('dispatchHomeAuthSessionUpdated({')).toBeGreaterThan(signupEligibilityIndex);
    expect(passwordSignup.indexOf('redirectAfterAdminLogin()')).toBeGreaterThan(signupEligibilityIndex);
  });
});
describe('live privacy eligibility receipt', () => {
  test('eligible current receipt is accepted only with the exact bounded schema', () => {
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt())).toEqual(validEligibilityReceipt());
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ extra: true }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ schemaVersion: 2 }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ policyVersionId: 'not-a-uuid' }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ contentSha256: 'A'.repeat(64) }))).toBeNull();
  });

  test('missing profile, policy drift, adult block, and guardian expiry or withdrawal remain fail-closed', () => {
    const ineligible = (reasonCode: string) => parsePrivacyEligibilityReceipt(validEligibilityReceipt({
      eligible: false,
      reasonCode,
    }));

    expect(ineligible('PRIVACY_AGE_ATTESTATION_REQUIRED')?.eligible).toBeFalse();
    expect(parsePrivacyEligibilityReceipt({
      schemaVersion: 1,
      eligible: false,
      reasonCode: 'PRIVACY_POLICY_UNAVAILABLE',
      policyVersionId: null,
      contentSha256: null,
    })?.eligible).toBeFalse();
    expect(ineligible('PRIVACY_POLICY_REATTESTATION_REQUIRED')?.eligible).toBeFalse();
    expect(ineligible('PRIVACY_AGE_BLOCKED')?.eligible).toBeFalse();
    expect(ineligible('PRIVACY_GUARDIAN_REQUIRED')?.eligible).toBeFalse();
    expect(ineligible('PRIVACY_GUARDIAN_CONSENT_REQUIRED')?.eligible).toBeFalse();
  });

  test('malformed, contradictory, and error receipts cannot open a session', () => {
    expect(parsePrivacyEligibilityReceipt(null)).toBeNull();
    expect(parsePrivacyEligibilityReceipt({ error: 'database detail' })).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({
      eligible: false,
      reasonCode: 'PRIVACY_ELIGIBLE',
    }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt({
      schemaVersion: 1,
      eligible: false,
      reasonCode: 'PRIVACY_POLICY_UNAVAILABLE',
      policyVersionId: POLICY_ID,
      contentSha256: 'a'.repeat(64),
    })).toBeNull();
    const eligibilitySource = source('lib/privacy/eligibility.ts');
    expect(eligibilitySource).toContain('const receipt = error === null ? parsePrivacyEligibilityReceipt(data) : null;');
    expect(eligibilitySource).toContain('return { eligible: false, reasonCode: null, receipt: null };');
  });
});

describe('minimum-data age and consent choices', () => {
  test('만 14세 미만 가입은 보호자 확인 경로가 배포·읽기검증될 때까지 차단한다', () => {
    expect(parseOnboardingStart(validStart({ ageBand: 'under_14' }))?.ageBand).toBe('under_14');
    expect(parseOnboardingStart(validStart({ ageBand: 'age_14_plus' }))?.ageBand).toBe('age_14_plus');
    expect(parseOnboardingStart(validStart({
      ageBand: 'under_14',
      guardianContact: { email: 'guardian@example.com' },
    }))).toBeNull();
    expect(parseOnboardingStart(validStart({
      marketing: {
        email: false,
        sms: false,
        push: false,
        nightByChannel: { email: false, sms: false, push: false },
        guardianPhone: '010-0000-0000',
      },
    }))).toBeNull();

    const authModal = source('components/auth/AuthModal.tsx');
    const guardianRoute = source('app/api/privacy/guardian/route.ts');
    const onboardingRoute = source('app/api/privacy/onboarding/route.ts');
    const under14StartIndex = onboardingRoute.indexOf("if (input.ageBand === 'under_14')");
    const challengeCreateIndex = onboardingRoute.indexOf('const challenge = await createChallenge(input);');
    const under14PasswordIndex = onboardingRoute.indexOf("if (challenge.ageBand !== 'age_14_plus')");
    const accountCreateIndex = onboardingRoute.indexOf('signupClient.auth.signUp');

    expect(UNDER_14_SIGNUP_UNAVAILABLE).toEqual({
      code: 'UNDER_14_SIGNUP_UNAVAILABLE',
      status: 'blocked',
      message: '만 14세 미만 이용자의 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.',
    });
    expect(authModal).toContain('생년월일이나 주민등록번호를 받지 않습니다');
    expect(authModal).toContain('UNDER_14_SIGNUP_UNAVAILABLE_CODE');
    expect(authModal).not.toContain('guardianEmail');
    expect(authModal).not.toContain('guardianPhone');
    expect(guardianRoute).toContain('under14SignupUnavailableResponse()');
    expect(guardianRoute).not.toContain('createSupabaseServiceRoleClient');
    expect(guardianRoute).not.toContain('request.text');
    expect(guardianRoute).not.toContain('request.json');
    expect(onboardingRoute).toContain('const MAX_REQUEST_BYTES = 16 * 1024;');
    expect(onboardingRoute).toContain('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    expect(onboardingRoute).toContain('hasExactKeys');
    expect(under14StartIndex).toBeGreaterThan(-1);
    expect(under14StartIndex).toBeLessThan(challengeCreateIndex);
    expect(under14PasswordIndex).toBeGreaterThan(-1);
    expect(under14PasswordIndex).toBeLessThan(accountCreateIndex);
  });

  test('선택 마케팅과 야간 채널 동의는 기본 거부이며 필수 정책 동의와 분리된다', () => {
    const parsed = parseOnboardingStart({
      policyVersion: POLICY_ID,
      ageBand: 'age_14_plus',
      intent: 'password',
      policyAcknowledged: true,
    });

    expect(parsed?.marketing).toEqual({
      email: false,
      sms: false,
      push: false,
      night_email: false,
      night_sms: false,
      night_push: false,
    });
    expect(parseOnboardingStart(validStart({ policyAcknowledged: false }))).toBeNull();
  });
  test('정책 내용 해시는 정확한 렌더링 입력을 고정한다', () => {
    expect(PRIVACY_POLICY_CONTENT_SHA256).toBe('1004892064d995543d9b422593c5b4daa49e79532ef0c5a222f2644b09f78d9b');
    expect(PRIVACY_POLICY_CONTENT_SHA256).toBe(
      createHash('sha256').update(privacyPolicyHashInput(), 'utf8').digest('hex'),
    );
  });
});

describe('privacy-safe error handling', () => {
  test('password, token, email, provider error object를 로그나 응답에 싣지 않는다', () => {
    const authModal = source('components/auth/AuthModal.tsx');
    const onboardingRoute = source('app/api/privacy/onboarding/route.ts');
    const callbackRoute = source('app/auth/callback/route.ts');

    expect(authModal).not.toContain('console.');
    expect(authModal).not.toContain('privacy_policy_agreed');
    expect(onboardingRoute).not.toContain('console.');
    expect(callbackRoute).not.toContain('console.');
    expect(onboardingRoute).toContain("message: '요청을 처리할 수 없습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.'");
  });
});
describe('G014 server session release boundaries', () => {
  test('self and service-target eligibility reads are exact RPC-only fail-closed boundaries', () => {
    const eligibility = source('lib/privacy/eligibility.ts');
    const callback = source('app/auth/callback/route.ts');
    const middleware = source('lib/supabase/middleware.ts');

    expect(eligibility).toContain("rpc('get_current_privacy_eligibility')");
    expect(eligibility).toContain("rpc('get_privacy_eligibility_for_user', {");
    expect(eligibility).toContain('p_user_id: userId');
    expect(eligibility).toContain('if (!UUID_PATTERN.test(userId))');
    expect(callback).toContain('await getCurrentPrivacyEligibility(supabase)');
    expect(middleware).toContain('await getCurrentPrivacyEligibility(supabase)');
    expect(callback).not.toContain('privacy_age_profiles');
    expect(middleware).not.toContain('privacy_age_profiles');
    expect(callback).not.toContain('privacy_guardian_verifications');
    expect(middleware).not.toContain('privacy_guardian_verifications');
  });

  test('callback finalizes the nonce-bound challenge before live eligibility and durably holds rejected OAuth identities', () => {
    const callback = source('app/auth/callback/route.ts');
    const oauthFlowStart = callback.indexOf('let confirmed = false;');
    const oauthFlow = callback.slice(
      oauthFlowStart,
      callback.indexOf('return redirectWithOnboardingCookiesCleared(origin, next);', oauthFlowStart),
    );
    const rejectionRedirect = callback.slice(
      callback.indexOf('function rejectedCallbackRedirect'),
      callback.indexOf('function compensationHoldUnavailableResponse'),
    );

    expect(oauthFlow.indexOf('confirmOAuthOnboarding(challenge, userId)')).toBeGreaterThan(-1);
    expect(oauthFlow.indexOf('getCurrentPrivacyEligibility(supabase)')).toBeGreaterThan(
      oauthFlow.indexOf('confirmOAuthOnboarding(challenge, userId)'),
    );
    expect(callback).toContain('eligibility.receipt?.policyVersionId !== challenge.policyVersionId');
    expect(callback).toContain('eligibility.receipt?.contentSha256 !== challenge.contentSha256');
    expect(callback).toContain("admin.rpc('hold_privacy_onboarding_compensation', {");
    expect(callback).not.toContain('as unknown as CompensationHoldRpcClient');
    expect(callback).toContain("p_reason_code: reasonCode");
    expect(callback).toContain("p_idempotency_key: compensationIdempotencyKey");
    expect(callback).toContain("code: 'ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE'");
    expect(callback).toContain('clearRejectedOnboardingCookies(response, request)');
    expect(callback).not.toContain('created_at');
    expect(callback).not.toContain('updateUserById');
    expect(callback).not.toContain('deleteUser');
    expect(rejectionRedirect).toContain('}/`');
    expect(rejectionRedirect).not.toContain('next');
  });
  test('rejected OAuth callbacks keep the durable hold but return no-store 503 when both sign-outs fail and readback is still authenticated', async () => {
    oauthRejectionSignOutFails = true;
    oauthRejectionReadback = 'live';

    const response = await oauthCallbackGet(oauthRejectionRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('location')).toBeNull();
    expect(oauthRejectionSignOutScopes).toEqual(['global', 'local']);
    expect(oauthRejectionGetUserCalls).toBe(2);
    expect(oauthRejectionHoldRequests).toEqual([
      expect.objectContaining({
        p_challenge_id: CHALLENGE_ID,
        p_user_id: OAUTH_REJECTION_TEST_USER_ID,
        p_reason_code: 'ONBOARDING_OAUTH_REJECTED',
      }),
    ]);
  });

  test('a positive session readback blocks rejected OAuth success even when sign-out calls resolve', async () => {
    oauthRejectionReadback = 'live';

    const response = await oauthCallbackGet(oauthRejectionRequest());

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(oauthRejectionSignOutScopes).toEqual(['global', 'local']);
    expect(oauthRejectionHoldRequests).toHaveLength(1);
  });

  test('rejected OAuth callback redirects only after strict absence readback and durable hold both succeed', async () => {
    oauthRejectionSignOutFails = true;
    oauthRejectionReadback = 'absent';

    const response = await oauthCallbackGet(oauthRejectionRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('location')).toBe('https://www.tzudong.app/');
    expect(oauthRejectionSignOutScopes).toEqual(['global', 'local']);
    expect(oauthRejectionHoldRequests).toHaveLength(1);
  });

  test('only explicit Auth absence proves session or identity cleanup', () => {
    const callback = source('app/auth/callback/route.ts');
    const onboarding = source('app/api/privacy/onboarding/route.ts');

    for (const route of [callback, onboarding]) {
      expect(route).toContain("error.name === 'AuthSessionMissingError'");
      expect(route).toContain("error.name === 'AuthApiError'");
      expect(route).toContain("error.code === 'user_not_found'");
      expect(route).toContain('user === null && (error === null || isExplicitAuthAbsenceError(error))');
      expect(route).not.toContain('Boolean(error) || !user');
    }
  });

  test('protected middleware releases no stale session and public auth/privacy paths remain loop-safe', () => {
    const proxy = source('proxy.ts');
    const publicEligibility = source('lib/auth/public-eligibility-session.ts');
    const middleware = source('lib/supabase/middleware.ts');

    expect(publicEligibility).toContain("'/privacy'");
    expect(publicEligibility).toContain("'/auth/callback'");
    expect(publicEligibility).toContain("'/api/privacy/onboarding'");
    expect(publicEligibility).toContain('PUBLIC_API_PREFIXES.some');
    expect(middleware).toContain("redirectUrl.searchParams.set('reason', 'privacy')");
    expect(middleware).toContain('await signOutRejectedPrivacySession(supabase)');
    expect(middleware).toContain("await getCurrentPrivacyEligibility(supabase)");
    expect(proxy).not.toContain('privacyEligibilityCache');
  });

  test('password finalization and replay recovery are same-origin, provenance-bound, held on ambiguity, and non-enumerating', () => {
    const onboarding = source('app/api/privacy/onboarding/route.ts');
    const onboardingLibrary = source('lib/privacy/onboarding.ts');
    const compensation = onboarding.slice(
      onboarding.indexOf('async function compensateFreshPasswordAccount'),
      onboarding.indexOf('async function recoverPasswordSignup'),
    );
    const recovery = onboarding.slice(
      onboarding.indexOf('function passwordLoginRecoveryResponse'),
      onboarding.indexOf('function getResultRecord'),
    );

    expect(onboarding.indexOf('isTrustedSameOriginMutation(request)')).toBeLessThan(
      onboarding.indexOf('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)'),
    );
    expect(onboarding).toContain('ONBOARDING_PASSWORD_RECOVERY_COOKIE');
    expect(onboarding).toContain('PASSWORD_RECOVERY_CODE');
    expect(onboarding).toContain('challengeToken: challenge.challengeToken');
    expect(onboarding).toContain('origin: requestOrigin(request)');
    expect(onboarding).toContain('passwordSignupCreationProvenance(challenge, user)');
    expect(onboarding).toContain('user.identities.length === 0');
    expect(compensation).toContain('if (!creationProvenance)');
    expect(compensation).toContain('await revokePasswordSignupSession(signupClient)');
    expect(compensation).toContain('updateUserById(creationProvenance.userId');
    expect(compensation).toContain('deleteUser(creationProvenance.userId)');
    expect(compensation).toContain('readPasswordIdentityAbsence');
    expect(onboarding).not.toContain('created_at');
    expect(onboarding).toContain("rpc('hold_privacy_onboarding_compensation'");
    expect(onboarding).toContain("p_idempotency_key: compensationIdempotencyKey");
    expect(onboarding).toContain("errorResponse('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE', 503, request)");
    expect(onboarding).toContain('isExactCompensationHoldReceipt');
    expect(recovery).toContain("code: PASSWORD_RECOVERY_CODE");
    expect(recovery).not.toContain('email');
    expect(onboardingLibrary).toContain('SUPABASE_AUTH_COOKIE_PATTERN');
    expect(onboardingLibrary).toContain('MAX_REJECTED_AUTH_COOKIE_CHUNKS');
    expect(onboardingLibrary).toContain('clearRejectedOnboardingCookies');
    expect(onboarding).toContain('clearRejectedOnboardingCookies(response, request)');
    expect(onboarding).not.toContain('ONBOARDING_ACCOUNT_CREATE_FAILED');
  });
});
