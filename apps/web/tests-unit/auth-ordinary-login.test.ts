import { describe, expect, test } from 'bun:test';
import { hasEligibleOrdinaryOAuthSession } from '../lib/auth/callback-session';
import { rejectPrivacyIneligibleBrowserSession } from '../lib/auth/rejected-browser-session';
import { buildHomeAuthLoginErrorPath, isHomePrivacyOnboardingRequest, readHomeAuthLoginRequestFromLocation, resolveRequestedAuthRedirect } from '../lib/auth/auth-redirect';
import { HOME_AUTH_SESSION_UPDATED_EVENT } from '../lib/home-auth-events';
import { PRIVACY_POLICY_CONTENT_SHA256, PRIVACY_POLICY_VERSION } from '../lib/privacy/policy';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const POLICY_ID = '22222222-2222-4222-8222-222222222222';

function eligibleReceipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eligible: true,
    reasonCode: 'PRIVACY_ELIGIBLE',
    policyVersionId: POLICY_ID,
    policyVersion: PRIVACY_POLICY_VERSION,
    contentSha256: PRIVACY_POLICY_CONTENT_SHA256,
    ...overrides,
  };
}

function callbackClient({
  receipt = eligibleReceipt() as unknown,
  rpcError = null as unknown,
  exchangeError = null as unknown,
  userError = null as unknown,
  userId = USER_ID,
} = {}) {
  const calls: string[] = [];
  const client = {
    auth: {
      async exchangeCodeForSession(code: string) {
        calls.push(`exchange:${code}`);
        return { error: exchangeError };
      },
      async getUser() {
        calls.push('getUser');
        return { data: { user: userError ? null : { id: userId } }, error: userError };
      },
    },
    async rpc(name: string) {
      calls.push(`rpc:${name}`);
      return { data: receipt, error: rpcError };
    },
  };
  return { client: client as never, calls };
}

describe('ordinary OAuth login eligibility', () => {
  test('a valid current-policy receipt is accepted after exchange and authenticated user lookup', async () => {
    const { client, calls } = callbackClient();

    expect(await hasEligibleOrdinaryOAuthSession(client, 'oauth-code')).toBe(true);
    expect(calls).toEqual(['exchange:oauth-code', 'getUser', 'rpc:get_current_privacy_eligibility']);
  });

  test('ineligible, missing, malformed, and stale-policy receipts are rejected', async () => {
    for (const receipt of [
      eligibleReceipt({ eligible: false, reasonCode: 'PRIVACY_AGE_BLOCKED' }),
      eligibleReceipt({ eligible: false, reasonCode: 'PRIVACY_AGE_ATTESTATION_REQUIRED' }),
      eligibleReceipt({ eligible: false, reasonCode: 'PRIVACY_POLICY_REATTESTATION_REQUIRED' }),
      null,
      { eligible: true, reasonCode: 'PRIVACY_ELIGIBLE' },
      eligibleReceipt({ contentSha256: 'a'.repeat(64) }),
    ]) {
      const { client, calls } = callbackClient({ receipt });
      expect(await hasEligibleOrdinaryOAuthSession(client, 'oauth-code')).toBe(false);
      expect(calls.at(-1)).toBe('rpc:get_current_privacy_eligibility');
    }
  });

  test('exchange, user, and RPC failures reject before a session is published', async () => {
    for (const failure of [
      { exchangeError: { code: 'auth_error' } },
      { userError: { code: 'auth_error' } },
      { userId: 'invalid-user-id' },
      { rpcError: { code: 'PGRST999' } },
    ]) {
      const { client } = callbackClient(failure);
      expect(await hasEligibleOrdinaryOAuthSession(client, 'oauth-code')).toBe(false);
    }
  });

  test('the fixed callback error opens login without qualifying as privacy onboarding', () => {
    const path = buildHomeAuthLoginErrorPath('/admin?module=storyboard');
    const url = new URL(path, 'https://www.tzudong.app');
    expect(path).toBe('/?auth=login&reason=login_failed&next=%2Fadmin%3Fmodule%3Dstoryboard');
    expect(isHomePrivacyOnboardingRequest(url)).toBe(false);
    const request = readHomeAuthLoginRequestFromLocation(url);
    expect(request).toEqual({ requested: true, reason: 'login_failed', nextPath: '/admin?module=storyboard' });
    expect(resolveRequestedAuthRedirect(request.reason, request.nextPath)).toBe('/admin?module=storyboard');
    expect(resolveRequestedAuthRedirect(request.reason, '/stamp')).toBe('/stamp');
    expect(buildHomeAuthLoginErrorPath('https://attacker.example')).toBe('/?auth=login&reason=login_failed');
    expect(buildHomeAuthLoginErrorPath('//attacker.example')).toBe('/?auth=login&reason=login_failed');
    expect(resolveRequestedAuthRedirect(request.reason, 'https://attacker.example')).toBeNull();
  });
});

describe('rejected browser login session', () => {
  async function withCapturedHomeEvents(run: (events: Event[]) => Promise<void>) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const events: Event[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { dispatchEvent: (event: Event) => { events.push(event); return true; } },
    });
    try {
      await run(events);
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  }

  test('publishes no session only after an authenticated absence readback', async () => {
    await withCapturedHomeEvents(async (events) => {
      const calls: string[] = [];
      const client = { auth: {
        async signOut({ scope }: { scope: string }) { calls.push(scope); return { error: null }; },
        async getUser() { calls.push('getUser'); return { data: { user: null }, error: null }; },
      } };
      expect(await rejectPrivacyIneligibleBrowserSession(client as never)).toBe(true);
      expect(calls).toEqual(['global', 'local', 'getUser']);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(HOME_AUTH_SESSION_UPDATED_EVENT);
      expect((events[0] as CustomEvent).detail).toEqual({ hasSession: false, source: 'auth-modal-rejected-login' });
    });
  });

  test('failed sign-outs with a remaining user do not publish false session state', async () => {
    await withCapturedHomeEvents(async (events) => {
      const calls: string[] = [];
      const client = { auth: {
        async signOut({ scope }: { scope: string }) { calls.push(scope); throw new Error('offline'); },
        async getUser() { calls.push('getUser'); return { data: { user: { id: USER_ID } }, error: null }; },
      } };
      expect(await rejectPrivacyIneligibleBrowserSession(client as never)).toBe(false);
      expect(calls).toEqual(['global', 'local', 'getUser']);
      expect(events).toEqual([]);
    });
  });

  test('a readback exception also keeps the home session provider mounted', async () => {
    await withCapturedHomeEvents(async (events) => {
      const client = { auth: {
        async signOut() { return { error: null }; },
        async getUser(): Promise<never> { throw new Error('readback unavailable'); },
      } };
      expect(await rejectPrivacyIneligibleBrowserSession(client as never)).toBe(false);
      expect(events).toEqual([]);
    });
  });
});
