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
  parseFreshPrivacyOnboardingConfirmationReceipt,
} from '@/lib/privacy/onboarding';
import {
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_VERSION,
  privacyPolicyHashInput,
} from '@/lib/privacy/policy';
import {
  hasLivePrivacyEligibilityReceipt,
  parsePrivacyEligibilityReceipt,
} from '@/lib/privacy/eligibility';

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
    challengeToken: 'b'.repeat(64),
    policyVersionId: POLICY_ID,
    contentSha256: 'c'.repeat(64),
    ageBand: 'age_14_plus',
    intent: 'oauth',
    oauthNonce: 'b'.repeat(64),
    origin: 'https://www.tzudong.app',
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
    policyVersion: PRIVACY_POLICY_VERSION,
    ...overrides,
  };
}
const OAUTH_REJECTION_TEST_USER_ID = '33333333-3333-4333-8333-333333333333';
const OAUTH_REJECTION_AUDIT_ID = '44444444-4444-4444-8444-444444444444';

let oauthRejectionSignOutFails = false;
let oauthRejectionSignOutScopes: string[] = [];

function resetOAuthRejectionRouteMock() {
  oauthRejectionSignOutFails = false;
  oauthRejectionSignOutScopes = [];
}

function oauthRejectionRequest() {
  const challenge = signedChallenge(Date.now() + 60_000);
  if (!challenge) throw new Error('Expected signed OAuth onboarding challenge');

  return new Request(
    'https://www.tzudong.app/auth/callback?code=oauth-code&next=%2Fsafe',
    {
      headers: {
        cookie: `${ONBOARDING_CHALLENGE_COOKIE}=${challenge}`,
      },
    },
  );
}

const { GET, revokeRejectedCallbackSession } = await import('../app/auth/callback/route.ts');

describe('privacy onboarding challenge', () => {
  test('만료·변조·비정규 정책 해시 또는 nonce challenge를 거부한다', () => {
    const expired = signedChallenge(Date.now() - 1);
    const active = signedChallenge(Date.now() + 60_000);
    const rawPayload = {
      version: 1,
      challengeId: CHALLENGE_ID,
      challengeToken: 'b'.repeat(64),
      policyVersionId: POLICY_ID,
      contentSha256: 'c'.repeat(64),
      ageBand: 'age_14_plus',
      intent: 'oauth',
      oauthNonce: 'b'.repeat(64),
      origin: 'https://www.tzudong.app',
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
      oauthNonce: 'a'.repeat(64),
    }))).toBeNull();
    const withoutHash: Record<string, unknown> = { ...rawPayload };
    delete withoutHash.contentSha256;
    expect(readOnboardingChallenge(rawSignedChallenge(withoutHash))).toBeNull();
    expect(readOnboardingChallenge(rawSignedChallenge({
      ...rawPayload,
      unexpected: true,
    }))).toBeNull();
  });
  const rawPayload = {
    version: 1,
    challengeId: CHALLENGE_ID,
    challengeToken: 'b'.repeat(64),
    policyVersionId: POLICY_ID,
    contentSha256: 'c'.repeat(64),
    ageBand: 'age_14_plus',
    intent: 'oauth',
    oauthNonce: 'b'.repeat(64),
    origin: 'https://www.tzudong.app',
    expiresAt: Date.now() + 60_000,
  };
  test('OAuth nonce is the one-time confirmation token and the signed origin is mandatory', () => {
    const onboardingRoute = source('app/api/privacy/onboarding/route.ts');
    const callbackRoute = source('app/auth/callback/route.ts');

    expect(onboardingRoute).toContain('const challengeToken = oauthNonce ?? randomBytes(32).toString(\'hex\');');
    expect(onboardingRoute).toContain('p_token_hash: sha256(challengeToken)');
    expect(onboardingRoute).toContain('p_oauth_nonce_hash: oauthNonce ? sha256(oauthNonce) : null');
    expect(onboardingRoute).toContain('origin: challenge.origin');
    expect(callbackRoute).toContain('p_challenge_token: challenge.challengeToken');
    expect(callbackRoute).toContain('p_oauth_nonce_hash: sha256(challenge.oauthNonce)');
    expect(callbackRoute).toContain('challenge.origin !== origin');
    expect(callbackRoute).toContain('if (challengeCookie && !challenge) return rejectedCallbackRedirect(request, origin);');
    expect(readOnboardingChallenge(rawSignedChallenge({
      ...rawPayload,
      origin: 'https://www.tzudong.app/onboarding',
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
    expect(onboardingRoute).toContain('parseFreshPrivacyOnboardingConfirmationReceipt');
    expect(onboardingRoute).toContain('contentSha256: currentPolicy.contentSha256');
    expect(onboardingRoute).toContain('contentSha256: challenge.contentSha256');
    expect(onboardingRoute).toContain('p_challenge_token: payload.challengeToken');
    expect(onboardingRoute).toContain('isExactChallengeReceipt(result, input, expiresAt)');
    expect(onboardingRoute).toContain("value.expiresAt === expiresAt.toISOString()");
    expect(onboardingRoute).toContain("'schemaVersion',");
    expect(onboardingRoute).toContain("'auditId',");
    expect(onboardingRoute).toContain("rpc('create_privacy_onboarding_challenge'");
    expect(onboardingRoute).toContain('p_token_hash: sha256(challengeToken)');
    expect(onboardingRoute).not.toContain('.from(\'privacy_onboarding_challenges\')');
    expect(onboardingRoute).not.toContain('.from(\'privacy_consent_events\')');
  });

  test('OAuth callback uses only the signed HttpOnly challenge as the onboarding discriminator', () => {
    const callbackRoute = source('app/auth/callback/route.ts');

    expect(callbackRoute).not.toContain("'onboarding_nonce'");
    expect(callbackRoute).not.toContain("'onboarding'");
    expect(callbackRoute).toContain("const onboardingRequested = challenge?.intent === 'oauth'");
    expect(callbackRoute).toContain("if (!challenge || !challenge.oauthNonce || challenge.origin !== origin)");
    expect(callbackRoute).toContain("await supabase.auth.signOut({ scope: 'local' })");
  });

  test('no-challenge OAuth sessions without a live receipt enter only exact onboarding without revocation', () => {
    const callbackRoute = source('app/auth/callback/route.ts');
    const authContext = source('contexts/AuthContext.tsx');
    const onboardingPage = source('app/privacy/onboarding/page.tsx');

    expect(callbackRoute).toContain('return redirectWithOnboardingCookiesCleared(origin, buildHomePrivacyOnboardingPath());');
    expect(callbackRoute).toContain('if (userError || !user?.id || !UUID_PATTERN.test(user.id))');
    expect(authContext).toContain('function isLiteralLoopSafePrivacyOnboarding()');
    expect(authContext).toContain("window.location.pathname === '/privacy/onboarding'");
    expect(authContext).toContain('isHomePrivacyOnboardingRequest(window.location)');
    expect(authContext).toContain('isExistingAccountPrivacyRecoveryActive(nextSession.user.email)');
    expect(authContext).toContain('event === \'PASSWORD_RECOVERY\'');
    expect(authContext).toContain('allowPasswordRecovery && isLiteralPasswordRecoveryRoute()');
    expect(authContext).toContain('recordPasswordRecoveryProof(nextSession.user.id)');
    expect(authContext).toContain('isLiteralPasswordRecoveryRoute(),');
    expect(authContext).toContain('isAuthSessionMissingError(error)');
    expect(onboardingPage).toContain('redirect(buildHomePrivacyOnboardingPath());');
    expect(onboardingPage).not.toContain('<AuthModal');
    const authModal = source('components/auth/AuthModal.tsx');
    const homeRuntime = source('app/home-runtime-shell.tsx');
    expect(authModal).toContain('data-testid="privacy-onboarding-modal"');
    expect(authModal).toContain('Google로 개인정보 확인 완료하기');
    expect(authModal).toContain('reason === AUTH_PRIVACY_ONBOARDING_REASON');
    expect(homeRuntime).toContain("AUTH_PRIVACY_ONBOARDING_REASON ? 'signup' : 'login'");
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
    expect(authModal).not.toContain('onboarding_nonce');
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
    const profileLookupIndex = authContext.indexOf('readPublicProfileSummaries(supabase, [userId])');

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
    expect(passwordLogin).toContain('setAuthTab("signup")');
    expect(passwordLogin).toContain('setIsExistingAccountRecovery(true)');
    expect(passwordLogin).toContain('현재 개인정보 처리방침과 연령 확인을 완료해주세요.');

    const signupEligibilityIndex = passwordSignup.indexOf('const eligibility = await getCurrentPrivacyEligibility(supabase);');
    expect(signupEligibilityIndex).toBeGreaterThan(-1);
    expect(passwordSignup).toContain('const challenge = await startOnboardingChallenge("password");');
    expect(passwordSignup).toContain('action: "password_signup"');
    expect(passwordSignup.indexOf('toast.success("회원가입 완료! 환영합니다.")')).toBeGreaterThan(signupEligibilityIndex);
    expect(passwordSignup.indexOf('dispatchHomeAuthSessionUpdated({', signupEligibilityIndex)).toBeGreaterThan(signupEligibilityIndex);
    expect(passwordSignup.indexOf('redirectAfterAdminLogin()', signupEligibilityIndex)).toBeGreaterThan(signupEligibilityIndex);
  });
});
describe('live privacy eligibility receipt', () => {
  test('eligible current receipt is accepted only with the exact bounded schema', () => {
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt())).toEqual(validEligibilityReceipt());
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ extra: true }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ schemaVersion: 2 }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ policyVersionId: 'not-a-uuid' }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ contentSha256: 'A'.repeat(64) }))).toBeNull();
    expect(parsePrivacyEligibilityReceipt(validEligibilityReceipt({ policyVersion: 'stale-policy' }))).toBeNull();
    expect(hasLivePrivacyEligibilityReceipt({
      eligible: true,
      reasonCode: 'PRIVACY_ELIGIBLE',
      receipt: parsePrivacyEligibilityReceipt(validEligibilityReceipt()),
    })).toBeFalse();
    expect(hasLivePrivacyEligibilityReceipt({
      eligible: true,
      reasonCode: 'PRIVACY_ELIGIBLE',
      receipt: parsePrivacyEligibilityReceipt(validEligibilityReceipt({
        contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
      })),
    })).toBeTrue();
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
      policyVersion: null,
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
      policyVersion: PRIVACY_POLICY_VERSION,
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
    const challengeCreateIndex = onboardingRoute.indexOf('const challenge = await createChallenge(input, requestOrigin(request));');
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
  test('야간 마케팅은 같은 채널의 명시적 일반 마케팅 동의 없이는 만들지 않는다', () => {
    for (const marketing of [
      { email: false, nightByChannel: { email: true } },
      { sms: false, nightByChannel: { sms: true } },
      { push: false, nightByChannel: { push: true } },
    ]) {
      expect(parseOnboardingStart(validStart({ marketing }))).toBeNull();
    }
    expect(parseOnboardingStart(validStart({
      marketing: { email: true, nightByChannel: { email: true } },
    }))?.marketing).toMatchObject({ email: true, night_email: true });
  });
  test('정책 내용 해시는 정확한 렌더링 입력을 고정한다', () => {
    expect(PRIVACY_POLICY_CONTENT_SHA256).toBe('6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b');
    expect(PRIVACY_POLICY_CONTENT_SHA256).toBe(
      createHash('sha256').update(privacyPolicyHashInput(), 'utf8').digest('hex'),
    );
  });
});
describe('fresh onboarding confirmation receipt', () => {
  test('requires an exact verified schema-v1 receipt and accepts a verified replay', () => {
    const receipt = {
      schemaVersion: 1,
      operationId: CHALLENGE_ID,
      challengeId: CHALLENGE_ID,
      userId: OAUTH_REJECTION_TEST_USER_ID,
      policyVersionId: POLICY_ID,
      eligible: true,
      status: 'applied',
      disposition: 'fresh',
      readback: {
        passed: true,
        checks: {
          challengeConsumed: true,
          ageProfileRecorded: true,
          requiredConsentRecorded: true,
          eligible: true,
        },
      },
      auditId: OAUTH_REJECTION_AUDIT_ID,
      errorCode: null,
      ageStatus: 'eligible',
    };

    expect(parseFreshPrivacyOnboardingConfirmationReceipt(
      receipt, CHALLENGE_ID, OAUTH_REJECTION_TEST_USER_ID, POLICY_ID,
    )).toEqual(receipt);
    expect(parseFreshPrivacyOnboardingConfirmationReceipt(
      { ...receipt, disposition: 'idempotent_replay' }, CHALLENGE_ID, OAUTH_REJECTION_TEST_USER_ID, POLICY_ID,
    )).toEqual({ ...receipt, disposition: 'idempotent_replay' });
    expect(parseFreshPrivacyOnboardingConfirmationReceipt(
      { ...receipt, extra: true }, CHALLENGE_ID, OAUTH_REJECTION_TEST_USER_ID, POLICY_ID,
    )).toBeNull();
    const withoutAuditId: Record<string, unknown> = { ...receipt };
    delete withoutAuditId.auditId;
    expect(parseFreshPrivacyOnboardingConfirmationReceipt(
      withoutAuditId, CHALLENGE_ID, OAUTH_REJECTION_TEST_USER_ID, POLICY_ID,
    )).toBeNull();
    expect(parseFreshPrivacyOnboardingConfirmationReceipt(
      { ...receipt, schemaVersion: 2 }, CHALLENGE_ID, OAUTH_REJECTION_TEST_USER_ID, POLICY_ID,
    )).toBeNull();
  });

  test('G016 serializes same-user replay and exposes one canonical nonce-aware signature', () => {
    const onboarding = source('app/api/privacy/onboarding/route.ts');
    const migration = source('../../backend/supabase/migrations/20260801000200_g016_onboarding_confirmation_freshness.sql');

    expect(onboarding).toContain('parseFreshPrivacyOnboardingConfirmationReceipt');
    expect(migration).toContain("'idempotent_replay' ELSE 'fresh'");
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain('g014_confirm_privacy_onboarding_legacy');
    expect(migration).toContain("'policyVersion', v_policy_version");
    expect(migration).toContain('REVOKE ALL ON FUNCTION privacy_retention.g014_confirm_privacy_onboarding_legacy');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding');
    expect(migration).toContain('TO service_role;');
    expect(migration).toContain('p_oauth_nonce_hash text');
    expect(migration).not.toContain('p_oauth_nonce_hash text DEFAULT NULL');
    expect(migration).not.toContain('CREATE FUNCTION public.confirm_privacy_onboarding(\n  p_challenge_id uuid,\n  p_challenge_token text,\n  p_user_id uuid,\n  p_source text,\n  p_guardian_verification_id uuid DEFAULT NULL\n)');
    expect(migration).toContain('p_oauth_nonce_hash IS DISTINCT FROM v_challenge_oauth_nonce_hash');
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

  test('callback finalizes the nonce-bound challenge before live eligibility and rejects ambiguous OAuth without identity mutation', () => {
    const callback = source('app/auth/callback/route.ts');
    const authModal = source('components/auth/AuthModal.tsx');
    const oauthFlowStart = callback.indexOf('let confirmed = false;');
    const oauthFlow = callback.slice(
      oauthFlowStart,
      callback.indexOf('return redirectWithOnboardingCookiesCleared(origin, next);', oauthFlowStart),
    );

    expect(oauthFlow.indexOf('confirmOAuthOnboarding(challenge, userId)')).toBeGreaterThan(-1);
    expect(oauthFlow.indexOf('getCurrentPrivacyEligibility(supabase)')).toBeGreaterThan(
      oauthFlow.indexOf('confirmOAuthOnboarding(challenge, userId)'),
    );
    expect(callback).toContain('eligibility.receipt.policyVersionId !== challenge.policyVersionId');
    expect(callback).toContain('eligibility.receipt.contentSha256 !== challenge.contentSha256');
    expect(callback).toContain("await supabase.auth.signOut({ scope: 'global' })");
    expect(callback).toContain("await supabase.auth.signOut({ scope: 'local' })");
    expect(callback).not.toContain('hold_privacy_onboarding_compensation');
    expect(callback).not.toContain('ONBOARDING_COMPENSATION_HOLD_UNAVAILABLE');
    expect(callback).not.toContain('deleteUser');
    expect(callback).not.toContain('updateUserById');
    expect(callback).toContain('clearRejectedOnboardingCookies(response, request)');
    expect(callback).toContain('function parseCallbackQuery(searchParams: URLSearchParams)');
    expect(callback).toContain("searchParams.getAll(key).length !== 1");
    expect(callback).toContain("!CALLBACK_QUERY_KEYS.has(key)");
    expect(callback).toContain('MAX_OAUTH_CODE_LENGTH');
    expect(authModal).toContain('setIsExistingAccountRecovery(true)');
    expect(authModal).toContain('setAuthTab("signup")');
    expect(authModal).toContain('const challenge = await startOnboardingChallenge("password");');
    expect(authModal).toContain('const { data: existingSession, error: existingSessionError } = await supabase.auth.signInWithPassword({ email, password });');
    expect(authModal).toContain('body: JSON.stringify({ action: "existing_account" })');
    expect(authModal).toContain('await rejectPrivacyIneligibleSession(existingUserId)');
    expect(authModal).toContain('Google 개인정보 확인 계속하기');
  });
  test('rejected OAuth callbacks redirect no-store after attempting both sign-outs even when they fail', async () => {
    oauthRejectionSignOutFails = true;
    const supabase = {
      auth: {
        signOut: async ({ scope }: { scope: 'global' | 'local' }) => {
          oauthRejectionSignOutScopes.push(scope);
          if (oauthRejectionSignOutFails) throw new Error(`${scope} sign-out failed`);
        },
      },
    };

    await revokeRejectedCallbackSession(supabase as never);
    const response = await GET(oauthRejectionRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('location')).toBe('https://www.tzudong.app/');
    expect(oauthRejectionSignOutScopes).toEqual(['global', 'local']);
  });
  test('rejected OAuth callbacks redirect no-store after both sign-outs resolve', async () => {
    const supabase = {
      auth: {
        signOut: async ({ scope }: { scope: 'global' | 'local' }) => {
          oauthRejectionSignOutScopes.push(scope);
        },
      },
    };

    await revokeRejectedCallbackSession(supabase as never);
    const response = await GET(oauthRejectionRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('location')).toBe('https://www.tzudong.app/');
    expect(oauthRejectionSignOutScopes).toEqual(['global', 'local']);
  });

  test('password onboarding keeps explicit Auth absence checks for identity cleanup', () => {
    const onboarding = source('app/api/privacy/onboarding/route.ts');

    expect(onboarding).toContain("error.name === 'AuthSessionMissingError'");
    expect(onboarding).toContain("error.name === 'AuthApiError'");
    expect(onboarding).toContain("error.code === 'user_not_found'");
    expect(onboarding).toContain('user === null && (error === null || isExplicitAuthAbsenceError(error))');
    expect(onboarding).not.toContain('Boolean(error) || !user');
  });

  test('protected middleware releases no stale session and public auth/privacy paths remain loop-safe', () => {
    const proxy = source('proxy.ts');
    const publicEligibility = source('lib/auth/public-eligibility-session.ts');
    const middleware = source('lib/supabase/middleware.ts');

    expect(publicEligibility).toContain("'/privacy'");
    expect(publicEligibility).toContain("'/auth/callback'");
    expect(publicEligibility).toContain("'/api/privacy/onboarding'");
    expect(publicEligibility).toContain("pathname === '/api/shorten'");
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
    expect(onboarding).toContain('readSignupProfileState(');
    expect(onboarding).toContain('isSignupProfileStateReady(signupProfileState)');
    expect(onboarding.indexOf('readSignupProfileState(')).toBeLessThan(
      onboarding.indexOf("confirmChallenge(challenge, creationProvenance.userId, 'password_signup')"),
    );
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
  test('existing-account recovery accepts only an authenticated server-derived password-proof subject', () => {
    const onboarding = source('app/api/privacy/onboarding/route.ts');
    const authModal = source('components/auth/AuthModal.tsx');
    const authContext = source('contexts/AuthContext.tsx');
    const recovery = onboarding.slice(
      onboarding.indexOf('async function recoverExistingPasswordAccount'),
      onboarding.indexOf('const PASSWORD_COMPENSATION_HOLD_REASON'),
    );

    expect(onboarding).toContain("const EXISTING_ACCOUNT_KEYS = ['action'] as const;");
    expect(recovery).toContain('validExistingAccountRequest(body)');
    expect(onboarding.indexOf('isTrustedSameOriginMutation(request)')).toBeLessThan(
      onboarding.indexOf("body.action === 'existing_account'"),
    );
    expect(onboarding.indexOf('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)')).toBeLessThan(
      onboarding.indexOf("body.action === 'existing_account'"),
    );
    expect(onboarding).toContain("action: 'existing_account';");
    expect(recovery).not.toContain('email:');
    expect(recovery).not.toContain('password:');
    expect(recovery).not.toContain('userId: body.');
    expect(recovery).toContain("challenge.intent !== 'password'");
    expect(recovery).toContain("challenge.ageBand !== 'age_14_plus'");
    expect(recovery).toContain("const supabase = await createClient()");
    expect(recovery).toContain('supabase.auth.getUser()');
    expect(recovery).toContain("confirmChallenge(challenge, userId, 'password_signup')");
    expect(recovery).toContain('server-verified password-authenticated proof');
    expect(recovery).toContain('getPrivacyEligibilityForUser(admin, userId)');
    expect(recovery).toContain('getCurrentPolicyVersion()');
    expect(recovery).toContain('currentPolicy.id !== challenge.policyVersionId');
    expect(recovery).toContain('currentPolicy.contentSha256 !== challenge.contentSha256');
    expect(recovery).toContain("status: 'onboarding_confirmed'");
    expect(recovery).toContain('clearOnboardingChallenge(response)');
    expect(recovery).not.toContain('auth.signUp');
    expect(recovery).not.toContain('auth.admin.');
    expect(authModal.indexOf('beginExistingAccountPrivacyRecovery(email)')).toBeLessThan(
      authModal.indexOf('supabase.auth.signInWithPassword({ email, password })', authModal.indexOf('const handleSignup')),
    );
    expect(authModal).toContain('await supabase.auth.refreshSession()');
    expect(authModal).toContain('endExistingAccountPrivacyRecovery(recoveryToken)');
    expect(authContext.indexOf('isExistingAccountPrivacyRecoveryActive(nextSession.user.email)')).toBeLessThan(
      authContext.indexOf('await clearStaleSession(userId, true)'),
    );
    expect(recovery).not.toContain(".from('privacy_");
    expect(recovery).not.toContain('p_user_id: body.');
  });
});
