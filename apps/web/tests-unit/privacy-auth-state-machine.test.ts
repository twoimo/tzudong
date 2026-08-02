import { afterAll, describe, expect, mock, test } from 'bun:test';

import {
  classifyPublicEligibilitySessionRoute,
  shouldSkipPublicEligibilitySession,
} from '@/lib/auth/public-eligibility-session';
import {
  consumePasswordRecoveryProof,
  recordPasswordRecoveryProof,
} from '@/lib/auth/password-recovery-proof';
import {
  ONBOARDING_CHALLENGE_COOKIE,
  sealOnboardingChallenge,
} from '@/lib/privacy/onboarding';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const POLICY_ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);

let exchangeCalls = 0;
let signOutCalls = 0;
let confirmationCalls = 0;
let callbackUser: { id: string } | null = { id: USER_ID };

mock.module('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => {
        exchangeCalls += 1;
        return { error: null };
      },
      getUser: async () => ({ data: { user: callbackUser }, error: null }),
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    },
  }),
}));

mock.module('@/lib/supabase/service-role', () => ({
  createSupabaseServiceRoleClient: () => ({
    rpc: async () => {
      confirmationCalls += 1;
      return { data: null, error: null };
    },
  }),
}));

const previousSecret = process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
process.env.PRIVACY_ONBOARDING_COOKIE_SECRET = 'x'.repeat(32);
afterAll(() => {
  if (previousSecret === undefined) delete process.env.PRIVACY_ONBOARDING_COOKIE_SECRET;
  else process.env.PRIVACY_ONBOARDING_COOKIE_SECRET = previousSecret;
});

describe('privacy auth state machine', () => {
  test('preserves incomplete sessions only on literal loop-safe routes and denies every near match', () => {
    for (const { pathname, method } of [
      { pathname: '/auth/callback', method: 'GET' },
      { pathname: '/privacy/onboarding', method: 'HEAD' },
      { pathname: '/api/privacy/onboarding', method: 'POST' },
      { pathname: '/auth/reset-password', method: 'GET' },
    ]) {
      expect(classifyPublicEligibilitySessionRoute({ pathname, method })).toBe('loop-safe');
      expect(shouldSkipPublicEligibilitySession({ pathname, method, hasSessionHint: true })).toBe(true);
    }

    for (const { pathname, method } of [
      { pathname: '/auth/callback/', method: 'GET' },
      { pathname: '/privacy/onboarding', method: 'POST' },
      { pathname: '/api/privacy/onboarding/', method: 'POST' },
      { pathname: '/auth/reset-password', method: 'POST' },
      { pathname: '/privacy%2fonboarding', method: 'GET' },
      { pathname: '/mypage', method: 'GET' },
    ]) {
      expect(classifyPublicEligibilitySessionRoute({ pathname, method })).toBe('protected');
      expect(shouldSkipPublicEligibilitySession({ pathname, method, hasSessionHint: true })).toBe(false);
    }
  });

  test('makes a password-recovery proof user-bound and once-only', () => {
    recordPasswordRecoveryProof(USER_ID);
    expect(consumePasswordRecoveryProof('other-user')).toBe(false);

    recordPasswordRecoveryProof(USER_ID);
    expect(consumePasswordRecoveryProof(USER_ID)).toBe(true);
    expect(consumePasswordRecoveryProof(USER_ID)).toBe(false);
  });

  test('rejects an ambiguous OAuth identity before confirmation can mutate onboarding state', async () => {
    exchangeCalls = 0;
    signOutCalls = 0;
    confirmationCalls = 0;
    callbackUser = { id: 'not-a-uuid' };
    const challenge = sealOnboardingChallenge({
      version: 1,
      challengeId: POLICY_ID,
      challengeToken: HASH,
      oauthNonce: HASH,
      policyVersionId: POLICY_ID,
      contentSha256: HASH,
      ageBand: 'age_14_plus',
      intent: 'oauth',
      origin: 'http://localhost:3000',
      expiresAt: Date.now() + 60_000,
    });
    expect(challenge).not.toBeNull();

    const { GET } = await import(`@/app/auth/callback/route?state-machine=${Date.now()}`);
    const response = await GET(new Request('http://localhost:3000/auth/callback?code=provider-code', {
      headers: { cookie: `${ONBOARDING_CHALLENGE_COOKIE}=${challenge}` },
    }));

    expect(response.headers.get('location')).toBe('http://localhost:3000/');
    expect(exchangeCalls).toBe(1);
    expect(signOutCalls).toBe(2);
    expect(confirmationCalls).toBe(0);
  });
});
