/**
 * Full GET/POST contracts with one isolated VM per case. No global mock.module,
 * real SDK, network, account, environment-file read, or filesystem write.
 * The source parser, HMAC/digest, policy/profile/eligibility validators and routes
 * run unmodified. Only Auth and database I/O have stateful in-memory doubles.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dir, '../../..');
const req = createRequire(import.meta.url);
const ts = req('typescript');
const next = req('next/server');
const origin = 'https://fixture.invalid';
const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const snapshot = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const cookieCleared = (response, name: string) => response.cookies.get(name)?.maxAge === 0;
const traceContainsInOrder = (events: string[], expected: string[]) => {
  let index = -1;
  return expected.every(event => { index = events.indexOf(event, index + 1); return index >= 0; });
};
// Keep failures free of cookies, credential-like fixtures or raw bodies.
const assert = (label: string, condition: boolean) => expect(condition, label).toBe(true);
const approvedSources = new Set([
  'lib/privacy/onboarding.ts', 'lib/privacy/eligibility.ts', 'lib/privacy/policy.ts',
  'lib/privacy/processing-inventory.ts', 'lib/security/bounded-json-request.ts',
  'lib/security/same-origin-mutation.ts', 'lib/auth/auth-redirect.ts',
  'lib/auth/callback-session.ts', 'lib/profile-mutation.ts',
  'app/api/privacy/onboarding/route.ts', 'app/auth/callback/route.ts',
]);

function fixture(settings: { emailConfirmation?: boolean; denyEligibility?: boolean; denyConfirm?: boolean } = {}) {
  const secret = crypto.randomBytes(48).toString('hex');
  const env = {
    NODE_ENV: 'test', NEXT_PUBLIC_SITE_URL: origin,
    PRIVACY_ONBOARDING_COOKIE_SECRET: secret,
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-only',
  };
  const state = {
    policyId: crypto.randomUUID(), userId: crypto.randomUUID(), auditId: crypto.randomUUID(),
    events: [], challenges: new Map(), confirmed: false, active: true,
    signupCalls: 0, simulatedIdentityMutations: 0, blockedExternalCalls: 0,
    confirmCalls: 0, confirmAccepted: 0, digestMatched: false, nonceMatched: false,
    argumentBindingsValid: true,
  };
  const deny = () => { state.blockedExternalCalls++; throw new Error('OFFLINE_BOUNDARY'); };
  const context = vm.createContext({
    Buffer, URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder,
    ReadableStream, AbortController, Uint8Array, crypto, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, process: { env }, fetch: deny,
  });
  // Provider JSON enters the same realm as production validators. This preserves
  // isPlainRecord's prototype check without mocking or weakening that validator.
  const intoRealm = vm.runInContext('(text) => JSON.parse(text)', context);
  const cache = new Map();
  let policy;
  const eligibility = () => ({
    schemaVersion: 1,
    eligible: state.confirmed && !settings.denyEligibility,
    reasonCode: state.confirmed && !settings.denyEligibility ? 'PRIVACY_ELIGIBLE' : 'PRIVACY_AGE_ATTESTATION_REQUIRED',
    policyVersionId: state.policyId,
    contentSha256: policy.PRIVACY_POLICY_CONTENT_SHA256,
    policyVersion: policy.PRIVACY_POLICY_VERSION,
  });
  async function rpc(name, args = {}) {
    state.events.push(name);
    if (name === 'get_current_privacy_policy_version') return { error: null, data: {
      schemaVersion: 1, policyVersionId: state.policyId, version: policy.PRIVACY_POLICY_VERSION,
      locale: policy.PRIVACY_POLICY_LOCALE, contentSha256: policy.PRIVACY_POLICY_CONTENT_SHA256,
      effectiveAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z', approvalBound: true,
    } };
    if (name === 'create_privacy_onboarding_challenge') {
      const id = crypto.randomUUID();
      state.challenges.set(id, { ...args, consumed: false });
      state.argumentBindingsValid &&= args.p_policy_version_id === state.policyId && args.p_age_band === 'age_14_plus';
      return { error: null, data: { schemaVersion: 1, challengeId: id, policyVersionId: state.policyId,
        ageBand: args.p_age_band, expiresAt: args.p_expires_at, auditId: state.auditId } };
    }
    if (name === 'read_signup_profile_state') {
      state.argumentBindingsValid &&= args.p_user_id === state.userId && args.p_expected_nickname === 'fixture';
      return { error: null, data: { schemaVersion: 1, complete: true, reasonCode: 'SIGNUP_PROFILE_READY',
        nicknameMatches: true, counts: { profile: 1, ordinaryRole: 1, adminRole: 0, stats: 1, activeStatus: 1 } } };
    }
    if (name === 'confirm_privacy_onboarding') {
      state.confirmCalls++;
      const stored = state.challenges.get(args.p_challenge_id);
      state.digestMatched = Boolean(stored && stored.p_token_hash === sha256(args.p_challenge_token));
      state.nonceMatched = Boolean(stored && (args.p_source === 'oauth'
        ? args.p_oauth_nonce_hash === stored.p_oauth_nonce_hash && args.p_oauth_nonce_hash === sha256(args.p_challenge_token)
        : args.p_source === 'password_signup' && args.p_oauth_nonce_hash === null && stored.p_oauth_nonce_hash === null));
      state.argumentBindingsValid &&= args.p_user_id === state.userId && args.p_guardian_verification_id === null;
      if (!state.digestMatched || !state.nonceMatched || !state.argumentBindingsValid || settings.denyConfirm) {
        return { error: { code: 'P0002' }, data: null };
      }
      state.confirmAccepted++;
      const disposition = stored.consumed ? 'idempotent_replay' : 'fresh';
      stored.consumed = true;
      state.confirmed = true;
      return { error: null, data: {
        schemaVersion: 1, operationId: args.p_challenge_id, challengeId: args.p_challenge_id,
        userId: state.userId, policyVersionId: state.policyId, eligible: true, status: 'applied', disposition,
        readback: { passed: true, checks: { challengeConsumed: true, ageProfileRecorded: true, requiredConsentRecorded: true, eligible: true } },
        auditId: state.auditId, errorCode: null, ageStatus: 'eligible',
      } };
    }
    if (name === 'get_privacy_eligibility_for_user' || name === 'get_current_privacy_eligibility') {
      if (name === 'get_privacy_eligibility_for_user') state.argumentBindingsValid &&= args.p_user_id === state.userId;
      return { error: null, data: eligibility() };
    }
    throw new Error('UNDECLARED_RPC');
  }
  const client = { rpc: async (...args) => intoRealm(JSON.stringify(await rpc(...args))), auth: {
    exchangeCodeForSession: async () => { state.events.push('exchange'); return { error: null }; },
    getUser: async () => { state.events.push('getUser'); return { error: null, data: { user: state.active ? { id: state.userId } : null } }; },
    signUp: async () => {
      state.events.push('simulated-signup'); state.signupCalls++;
      return { error: null, data: { user: { id: state.userId, identities: [{}] }, session: settings.emailConfirmation ? null : {} } };
    },
    signOut: async ({ scope }) => { state.events.push(`signOut-${scope}`); state.active = false; return { error: null }; },
    admin: {
      updateUserById: async () => { state.simulatedIdentityMutations++; return { error: null }; },
      deleteUser: async () => { state.simulatedIdentityMutations++; return { error: null }; },
      getUserById: async () => ({ data: { user: null }, error: null }),
    },
  } };
  const providerImports = {
    'node:crypto': crypto, 'next/server': next,
    '@supabase/supabase-js': { createClient: () => client },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/supabase/service-role': { createSupabaseServiceRoleClient: () => client },
    // Unexercised profile avatar/read helpers are denied, never substituted as successes.
    '@/lib/profile-avatar-url': { classifyProfileAvatarUrl: deny, getProfileAvatarVersionedReference: deny, getProfileAvatarVersionedStorageKey: deny },
    '@/lib/public-profile-read': { readPublicProfileSummaries: deny },
  };
  function load(relative) {
    if (!approvedSources.has(relative)) throw new Error('UNDECLARED_SOURCE_IMPORT');
    if (cache.has(relative)) return cache.get(relative);
    const moduleRecord = vm.runInContext('({ exports: {} })', context);
    const moduleRequire = name => {
        if (Object.hasOwn(providerImports, name)) return providerImports[name];
        const file = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(relative), name);
        return load(file.endsWith('.ts') ? file : `${file}.ts`);
      };
    const compiled = ts.transpileModule(snapshot(`apps/web/${relative}`), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const evaluate = vm.runInContext(`(function(module, exports, require) { ${compiled}\n})`, context, { timeout: 2000 });
    evaluate(moduleRecord, moduleRecord.exports, moduleRequire);
    cache.set(relative, moduleRecord.exports);
    return moduleRecord.exports;
  }
  policy = load('lib/privacy/policy.ts');
  const lib = load('lib/privacy/onboarding.ts');
  const route = load('app/api/privacy/onboarding/route.ts');
  const callback = load('app/auth/callback/route.ts');
  const post = (body, cookies = [], requestOrigin = origin) => new next.NextRequest(`${origin}/api/privacy/onboarding`, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json',
      ...(cookies.length ? { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') } : {}) },
    body: JSON.stringify(body),
  });
  const start = async intent => {
    const response = await route.POST(post({ policyVersion: state.policyId, ageBand: 'age_14_plus', intent, policyAcknowledged: true }));
    return { response, cookie: response.cookies.get(lib.ONBOARDING_CHALLENGE_COOKIE) };
  };
  const signup = () => ({ action: 'password_signup', email: 'fixture@example.invalid', password: crypto.randomBytes(8).toString('hex'), nickname: 'fixture' });
  return { state, lib, route, callback, policy, env, post, start, signup };
}

describe('privacy onboarding full route runtime contracts', () => {
  for (const emailConfirmation of [false, true]) test(`password start -> create -> recovery replay (email confirmation ${emailConfirmation})`, async () => {
    const f = fixture({ emailConfirmation });
    const metadata = await f.route.GET(new next.NextRequest(`${origin}/api/privacy/onboarding`));
    const meta = await metadata.json();
    assert('published policy readback binds source hash', metadata.status === 200 && meta.id === f.state.policyId && meta.contentSha256 === f.policy.PRIVACY_POLICY_CONTENT_SHA256);
    const { response: issued, cookie } = await f.start('password');
    assert('challenge issued', issued.status === 201 && Boolean(cookie));
    assert('valid cookie decodes', Boolean(f.lib.readOnboardingChallenge(cookie.value)));
    assert('secure bounded challenge cookie', cookie.httpOnly && cookie.secure && cookie.sameSite === 'lax' && cookie.path === '/' && cookie.maxAge === 900);
    const body = f.signup();
    const response = await f.route.POST(f.post(body, [cookie]));
    const created = await response.json();
    assert('exact creation result', response.status === 201 && created.status === 'created' && created.emailConfirmationRequired === emailConfirmation && Object.keys(created).length === 2);
    assert('single creation and confirmed digest', f.state.signupCalls === 1 && f.state.confirmCalls === 1 && f.state.confirmAccepted === 1 && f.state.digestMatched && f.state.nonceMatched && f.state.argumentBindingsValid);
    assert('ordered source profile/confirmation/eligibility validators', traceContainsInOrder(f.state.events, ['simulated-signup', 'read_signup_profile_state', 'confirm_privacy_onboarding', 'get_privacy_eligibility_for_user']));
    assert('no compensation on success', f.state.simulatedIdentityMutations === 0 && !f.state.events.some(x => x.startsWith('signOut')));
    assert('challenge consumed and response not cacheable', cookieCleared(response, f.lib.ONBOARDING_CHALLENGE_COOKIE) && response.headers.get('cache-control') === 'no-store');
    const recovery = response.cookies.get(f.lib.ONBOARDING_PASSWORD_RECOVERY_COOKIE);
    assert('secure scoped recovery cookie', Boolean(recovery?.value && recovery.httpOnly && recovery.secure && recovery.sameSite === 'strict' && recovery.path === '/api/privacy/onboarding'));
    const repeatedResponse = await f.route.POST(f.post(body, [recovery]));
    const repeated = await repeatedResponse.json();
    assert('replay requires login without duplicate account', repeatedResponse.status === 409 && repeated.code === 'ONBOARDING_PASSWORD_LOGIN_REQUIRED' && f.state.signupCalls === 1 && f.state.confirmAccepted === 1);
    assert('no network attempts', f.state.blockedExternalCalls === 0);
  });

  test('existing password account confirms and accepts same-challenge replay without creating an account', async () => {
    const f = fixture();
    const { cookie } = await f.start('password');
    assert('challenge issued', Boolean(cookie));
    for (const attempt of ['fresh', 'replay']) {
      const response = await f.route.POST(f.post({ action: 'existing_account' }, [cookie]));
      const body = await response.json();
      assert(`${attempt} confirmed`, response.status === 200 && body.status === 'onboarding_confirmed' && Object.keys(body).length === 1);
      assert(`${attempt} cookie cleared`, cookieCleared(response, f.lib.ONBOARDING_CHALLENGE_COOKIE));
    }
    assert('twice-confirmed and no account mutation', f.state.confirmAccepted === 2 && f.state.signupCalls === 0 && f.state.simulatedIdentityMutations === 0);
    assert('authenticated subject before confirm/readback', traceContainsInOrder(f.state.events, ['getUser', 'confirm_privacy_onboarding', 'get_privacy_eligibility_for_user']));
    assert('no network attempts', f.state.blockedExternalCalls === 0);
  });

  for (const rejection of ['none', 'confirmation', 'eligibility', 'nonce']) test(`OAuth callback ${rejection}`, async () => {
    const f = fixture({ denyConfirm: rejection === 'confirmation', denyEligibility: rejection === 'eligibility' });
    const { response: issued, cookie } = await f.start('oauth');
    assert('challenge issued', issued.status === 201 && Boolean(cookie));
    if (rejection === 'nonce') [...f.state.challenges.values()][0].p_oauth_nonce_hash = 'a'.repeat(64);
    const response = await f.callback.GET(new Request(`${origin}/auth/callback?code=fixture&next=%2Fmypage%2Freviews`, {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    }));
    const location = new URL(response.headers.get('location'));
    assert('route actually reaches session/user/confirmation', traceContainsInOrder(f.state.events, ['exchange', 'getUser', 'confirm_privacy_onboarding']));
    assert('independent SQL digest comparison', f.state.digestMatched && f.state.argumentBindingsValid);
    assert('nonce result', f.state.nonceMatched === (rejection !== 'nonce'));
    assert('cookies cleared and response not cacheable', cookieCleared(response, f.lib.ONBOARDING_CHALLENGE_COOKIE) && response.headers.get('cache-control') === 'no-store');
    if (rejection === 'none') {
      assert('exact requested destination', response.status === 307 && location.origin === origin && location.pathname === '/mypage/reviews' && location.search === '');
      assert('confirmation precedes live eligibility', f.state.confirmAccepted === 1 && traceContainsInOrder(f.state.events, ['confirm_privacy_onboarding', 'get_current_privacy_eligibility']));
      assert('success does not revoke', !f.state.events.some(x => x.startsWith('signOut')));
    } else {
      assert('rejected destination', response.status === 307 && location.origin === origin && location.pathname === '/' && location.search === '');
      assert('route itself invokes both revocations', traceContainsInOrder(f.state.events, ['confirm_privacy_onboarding', 'signOut-global', 'signOut-local']));
      assert('no eligibility before confirmation', f.state.events.includes('get_current_privacy_eligibility') === (rejection === 'eligibility'));
    }
    assert('OAuth does not mutate identities', f.state.signupCalls === 0 && f.state.simulatedIdentityMutations === 0);
    assert('no network attempts', f.state.blockedExternalCalls === 0);
  });

  for (const control of ['tamper', 'expiry', 'origin', 'nonce', 'secret']) test(`OAuth rejects ${control} before exchanging provider code`, async () => {
    const f = fixture();
    const { cookie } = await f.start('oauth');
    assert('challenge issued', Boolean(cookie));
    const decoded = f.lib.readOnboardingChallenge(cookie.value);
    assert('control starts with valid cookie', decoded !== null);
    let value = cookie.value;
    if (control === 'tamper') value += 'x';
    if (control === 'expiry') value = f.lib.sealOnboardingChallenge({ ...decoded, expiresAt: Date.now() - 1 });
    if (control === 'origin') value = f.lib.sealOnboardingChallenge({ ...decoded, origin: 'https://other.invalid' });
    if (control === 'nonce') {
      // Sign an invalid semantic payload to distinguish nonce validation from HMAC rejection.
      const payload = Buffer.from(JSON.stringify({ ...decoded, oauthNonce: 'a'.repeat(64) })).toString('base64url');
      value = `${payload}.${crypto.createHmac('sha256', f.env.PRIVACY_ONBOARDING_COOKIE_SECRET).update(`tzudong:onboarding-challenge:v1:${payload}`).digest('base64url')}`;
    }
    if (control === 'secret') f.env.PRIVACY_ONBOARDING_COOKIE_SECRET = crypto.randomBytes(48).toString('hex');
    const response = await f.callback.GET(new Request(`${origin}/auth/callback?code=fixture&next=%2Fmypage%2Freviews`, {
      headers: { cookie: `${cookie.name}=${value}` },
    }));
    assert('rejected to home', response.status === 307 && new URL(response.headers.get('location')).pathname === '/');
    assert('no exchange or confirmation', !f.state.events.includes('exchange') && f.state.confirmCalls === 0);
    assert('rejected challenge cleared', cookieCleared(response, f.lib.ONBOARDING_CHALLENGE_COOKIE));
    assert('no identity or network activity', f.state.signupCalls === 0 && f.state.simulatedIdentityMutations === 0 && f.state.blockedExternalCalls === 0);
  });

  test('password rejects tamper, expiry, wrong secret and cross-origin before signup', async () => {
    for (const control of ['tamper', 'expiry', 'secret', 'origin']) {
      const f = fixture();
      const { cookie } = await f.start('password');
      assert(`${control}: challenge issued`, Boolean(cookie));
      const decoded = f.lib.readOnboardingChallenge(cookie.value);
      assert(`${control}: starts valid`, decoded !== null);
      let value = cookie.value;
      if (control === 'tamper') value += 'x';
      if (control === 'expiry') value = f.lib.sealOnboardingChallenge({ ...decoded, expiresAt: Date.now() - 1 });
      if (control === 'secret') f.env.PRIVACY_ONBOARDING_COOKIE_SECRET = crypto.randomBytes(48).toString('hex');
      const response = await f.route.POST(f.post(f.signup(), [{ ...cookie, value }], control === 'origin' ? 'https://other.invalid' : origin));
      const body = await response.json();
      assert(`${control}: fixed rejection`, response.status === (control === 'origin' ? 403 : 400) && body.code === (control === 'origin' ? 'ONBOARDING_ORIGIN_INVALID' : 'ONBOARDING_CHALLENGE_INVALID'));
      assert(`${control}: no signup, confirmation or network`, f.state.signupCalls === 0 && f.state.confirmCalls === 0 && f.state.blockedExternalCalls === 0);
    }
  });

  for (const rejection of ['confirmation', 'eligibility']) test(`password finalization denies ${rejection}`, async () => {
    const f = fixture({ denyConfirm: rejection === 'confirmation', denyEligibility: rejection === 'eligibility' });
    const { cookie } = await f.start('password');
    assert('challenge issued', Boolean(cookie));
    const response = await f.route.POST(f.post(f.signup(), [cookie]));
    const body = await response.json();
    assert('fixed failure, not success', rejection === 'confirmation'
      ? response.status === 409 && body.code === 'ONBOARDING_PASSWORD_LOGIN_REQUIRED'
      : response.status === 403 && body.code === 'ONBOARDING_FINALIZATION_FAILED');
    assert('correct failure phase reached', f.state.signupCalls === 1 && f.state.confirmCalls === 1 && f.state.confirmAccepted === (rejection === 'eligibility' ? 1 : 0));
    assert('live eligibility only after accepted confirm', f.state.events.includes('get_privacy_eligibility_for_user') === (rejection === 'eligibility'));
    assert('actual route revokes simulated session', traceContainsInOrder(f.state.events, ['confirm_privacy_onboarding', 'signOut-global', 'signOut-local']));
    assert('compensation only in memory and no success recovery', f.state.simulatedIdentityMutations === 2 && !response.cookies.get(f.lib.ONBOARDING_PASSWORD_RECOVERY_COOKIE)?.value);
    assert('no external calls', f.state.blockedExternalCalls === 0);
  });

  test('under-14 start remains denied before challenge or identity creation', async () => {
    const f = fixture();
    const response = await f.route.POST(f.post({ policyVersion: f.state.policyId, ageBand: 'under_14', intent: 'password', policyAcknowledged: true }));
    const body = await response.json();
    assert('fixed under-14 rejection', response.status === 403 && body.code === 'UNDER_14_SIGNUP_UNAVAILABLE');
    assert('no challenge or account', f.state.challenges.size === 0 && f.state.signupCalls === 0 && f.state.confirmCalls === 0 && f.state.blockedExternalCalls === 0);
  });
});
