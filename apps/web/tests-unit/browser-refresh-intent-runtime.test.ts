import { beforeAll, expect, test } from 'bun:test';
import vm from 'node:vm';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { createBrowserRefreshGuard } from '../lib/auth/browser-refresh-guard';
import type { captureBrowserLogout } from '../lib/auth/browser-logout';
import type { commitSupabaseBrowserSession } from '../integrations/supabase/client';

// Production adapter + pinned SDK in two realms; all cookies, locks and issuer
// responses are in-memory fixtures. No server, browser or network is started.
const issuer = 'https://issuer.test', origin = 'https://app.test';
const key = 'sb-issuer-v3-auth-token';
const ids = { A: '11111111-1111-4111-8111-111111111111', B: '22222222-2222-4222-8222-222222222222' };
type Owner = keyof typeof ids;
type Probe = {
  client: SupabaseClient;
  captureLogout: typeof captureBrowserLogout;
  commit: typeof commitSupabaseBrowserSession;
  snapshot(): string;
  guard(): ReturnType<typeof createBrowserRefreshGuard>;
};
let bundle: string;
beforeAll(async () => {
  const root = path.resolve(import.meta.dir, '..');
  const built = await Bun.build({ entrypoints: ['refresh-intent-entry'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(issuer), 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"synthetic-public"' },
    plugins: [{ name: 'refresh-intent-entry', setup(build) {
      build.onResolve({ filter: /^refresh-intent-entry$/ }, () => ({ path: 'entry', namespace: 'refresh-intent' }));
      build.onLoad({ filter: /.*/, namespace: 'refresh-intent' }, () => ({ loader: 'ts', resolveDir: root, contents: `
        import {getSupabaseBrowserClient,commitSupabaseBrowserSession} from './integrations/supabase/client';
        import {captureBrowserLogout} from './lib/auth/browser-logout';
        import {captureBrowserAuthState} from './lib/auth/browser-commit-state';
        import {getAuthCookieContract} from './lib/auth/session-cookies';
        import {createBrowserRefreshGuard} from './lib/auth/browser-refresh-guard';
        globalThis.probe = {client:getSupabaseBrowserClient(),captureLogout:captureBrowserLogout,
          commit:commitSupabaseBrowserSession,
          snapshot:()=>captureBrowserAuthState(getAuthCookieContract('${issuer}')),
          guard:()=>createBrowserRefreshGuard('${issuer}')};
      ` }));
    } }],
  });
  if (!built.success) throw new Error('REFRESH_INTENT_FIXTURE_BUILD_FAILED');
  bundle = await built.outputs[0].text();
});

function gate() {
  let entered!: () => void, release!: () => void;
  return { entered: () => entered(), waiting: new Promise<void>(r => { entered = r; }),
    release: () => release(), held: new Promise<void>(r => { release = r; }) };
}

function fixture(chunked = false) {
  const cookies = new Map<string, string>(), storage = new Map<string, string>(), locks = new Map<string, Promise<unknown>>();
  const clients: SupabaseClient[] = [];
  const tokens = new Map<string, Owner>();
  const state = { sequence: 0, refreshDispatches: 0, refreshFailure: false, malformedResponse: null as 'json' | 'missing-token' | null,
    refreshGate: null as ReturnType<typeof gate> | null };
  // The SDK wraps fetch exceptions as retryable. Advance only its fixture
  // clock/timers through the real backoff, without sleeping or raising timeouts.
  let now = 2_000_000_000_000;
  class Clock extends Date { static now() { return now; } }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function session(who: Owner, expired = false) {
    const refresh_token = `synthetic-refresh-${++state.sequence}`;
    tokens.set(refresh_token, who);
    const expires_at = Math.floor(now / 1000) + (expired ? -3600 : 3600);
    return { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: ids[who], exp: expires_at }) + '.c2ln',
      refresh_token, token_type: 'bearer', expires_in: expired ? -3600 : 3600, expires_at,
      user: { id: ids[who], aud: 'authenticated', user_metadata: chunked ? { padding: 'x'.repeat(6000) } : {} } };
  }
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== issuer) throw new Error('OFFLINE_ISSUER_BOUNDARY');
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname !== '/auth/v1/token') throw new Error('OFFLINE_ISSUER_BOUNDARY');
    const body = await request.json() as { email?: string; refresh_token?: string };
    const refresh = url.searchParams.get('grant_type') === 'refresh_token';
    const who = refresh ? tokens.get(body.refresh_token ?? '') : body.email?.startsWith('B') ? 'B' : 'A';
    if (refresh) {
      state.refreshDispatches++;
      if (state.refreshGate) { const hold = state.refreshGate; state.refreshGate = null; hold.entered(); await hold.held; }
      if (state.refreshFailure) return Response.json({ code: 'refresh_token_not_found', message: 'fixture rejection' },
        { status: 400, headers: { 'x-supabase-api-version': '2024-01-01' } });
      if (state.malformedResponse) return new Response(state.malformedResponse === 'json' ? '{' : '{}',
        { headers: { 'Content-Type': 'application/json' } });
    }
    // Unknown synthetic credentials have an ordinary fixture error response.
    if (!who) return Response.json({ error: 'fixture_unknown_token' }, { status: 400 });
    return Response.json(session(who));
  };
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
    set cookie(value: string) {
      const [pair] = value.split(';'), index = pair.indexOf('='), name = pair.slice(0, index);
      if (/max-age=0(?:;|$)/i.test(value)) cookies.delete(name); else cookies.set(name, pair.slice(index + 1));
    } };
  function realm(): Probe {
    const location = { pathname: '/auth/complete', protocol: 'https:', href: `${origin}/auth/complete`, origin };
    const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, AbortSignal, AbortController, DOMException,
      TextEncoder, TextDecoder, atob, btoa, crypto, Date: Clock,
      setTimeout: (callback: () => void, delay = 0) => setTimeout(() => { now += delay; callback(); }, 0),
      clearTimeout, setInterval, clearInterval, queueMicrotask, fetch: transport, WebSocket,
      console: { log() {}, warn() {}, error() {}, debug() {} }, document, location,
      window: { document, location, addEventListener() {}, removeEventListener() {} },
      localStorage: { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => { storage.set(name, String(value)); }, removeItem: (name: string) => { storage.delete(name); } },
      navigator: { locks: { request: (name: string, _options: unknown, action: () => unknown) => {
        const result = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(action); locks.set(name, result); return result;
      } } },
    });
    vm.runInContext(bundle, context);
    const probe = context.probe as Probe; clients.push(probe.client); return probe;
  }
  const a = realm(), b = realm();
  return { a, b, state, session, expireAccessTokens: () => { now += 3_601_000; },
    login: (probe: Probe, who: Owner) => probe.client.auth.signInWithPassword({ email: `${who}@example.invalid`, password: 'synthetic-only' }),
    credentials: () => [...cookies].sort(),
    stored: () => {
      const value = cookies.get(key) ?? [...cookies].filter(([name]) => name.startsWith(`${key}.`))
        .sort(([a], [b]) => Number(a.slice(key.length + 1)) - Number(b.slice(key.length + 1))).map(([, value]) => value).join('');
      return value ? JSON.parse(Buffer.from(value.slice(7), 'base64url').toString()) as ReturnType<typeof session> : null;
    },
    close: () => Promise.all(clients.map(client => client.auth.dispose())),
  };
}
const refreshUrl = `${issuer}/auth/v1/token?grant_type=refresh_token`;
const refreshInit = (token: string) => ({ method: 'POST', body: JSON.stringify({ refresh_token: token }) });

for (const replacement of ['login-B', 'local-logout'] as const) test(`pre-dispatch stale SDK read cannot replace ${replacement}`, async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A');
    // Scheduling hook only: preserve the actual adapter's completed read,
    // releasing its lock before the other realm commits. No supplied token.
    const auth = f.a.client.auth as unknown as { storage: { getItem(name: string): Promise<string | null> } };
    const original = auth.storage.getItem.bind(auth.storage), hold = gate();
    let armed = true;
    auth.storage.getItem = async name => {
      const value = await original(name);
      if (armed && name === key) { armed = false; hold.entered(); await hold.held; }
      return value;
    };
    const refreshing = f.a.client.auth.refreshSession().then(result => result.error, error => error);
    await hold.waiting;
    if (replacement === 'login-B') await f.login(f.b, 'B');
    else expect(await f.b.captureLogout().clearIfCurrent(() => true)).toBe(true);
    const before = f.credentials(); hold.release();
    const error = await refreshing;
    expect(f.stored()?.user.id ?? null).toBe(replacement === 'login-B' ? ids.B : null);
    expect(f.credentials()).toEqual(before);
    expect(f.state.refreshDispatches).toBe(0);
    expect(error?.message).toBe('AUTH_REFRESH_SUPERSEDED');
  } finally { await f.close(); }
});

for (const chunked of [false, true]) test(`same-owner SDK refresh persists, chunked=${chunked}`, async () => {
  const f = fixture(chunked);
  try {
    await f.login(f.a, 'A'); const before = f.stored()?.refresh_token;
    const response = await f.a.client.auth.refreshSession();
    expect(response.error).toBeNull(); expect(f.stored()?.user.id).toBe(ids.A);
    expect(f.stored()?.refresh_token).not.toBe(before); expect(f.state.refreshDispatches).toBe(1);
  } finally { await f.close(); }
});

for (const failure of [false, true]) test(`response after B preserves B, SDK cleanup failure=${failure}`, async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const hold = gate(); f.state.refreshGate = hold; f.state.refreshFailure = failure;
    const refreshing = f.a.client.auth.refreshSession().catch(error => error);
    await hold.waiting; await f.login(f.b, 'B'); const before = f.credentials(); hold.release(); await refreshing;
    expect(f.stored()?.user.id).toBe(ids.B); expect(f.credentials()).toEqual(before); expect(f.state.refreshDispatches).toBe(1);
    // Exercise the SDK removal path as well as its stale response guard.
    await expect(f.a.client.auth.signOut({ scope: 'local' })).rejects.toThrow('AUTH_SESSION_REMOVAL_REQUIRES_OWNER');
    expect(f.credentials()).toEqual(before);
  } finally { await f.close(); }
});

test('explicit callback with expired B tokens can refresh and publish over A', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const expected = f.a.snapshot(), candidate = f.session('B', true);
    let published = 0;
    const result = await f.a.commit(candidate, expected, () => true, () => { published++; });
    expect(result.committed).toBe(true); expect(published).toBe(1); expect(f.stored()?.user.id).toBe(ids.B);
    expect(f.stored()?.refresh_token).not.toBe(candidate.refresh_token); expect(f.state.refreshDispatches).toBe(1);
  } finally { await f.close(); }
});

test('SDK refresh error cleanup cannot delete B after reading expired A', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); f.expireAccessTokens(); f.state.refreshFailure = true;
    const auth = f.a.client.auth as unknown as { storage: { getItem(name: string): Promise<string | null> } };
    const original = auth.storage.getItem.bind(auth.storage), hold = gate(); let armed = true;
    auth.storage.getItem = async name => {
      const value = await original(name);
      // This is the SDK's post-error storedNow read, after the rejected refresh.
      if (armed && name === key && f.state.refreshDispatches > 0) { armed = false; hold.entered(); await hold.held; }
      return value;
    };
    const refreshing = f.a.client.auth.refreshSession().catch(error => error);
    await hold.waiting; await f.login(f.b, 'B'); const before = f.credentials(); hold.release();
    expect((await refreshing).message).toBe('AUTH_SESSION_REMOVAL_REQUIRES_OWNER');
    expect(f.stored()?.user.id).toBe(ids.B); expect(f.credentials()).toEqual(before); expect(f.state.refreshDispatches).toBe(1);
  } finally { await f.close(); }
});

test('callback owner lost during refresh cannot publish', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const before = f.credentials(), hold = gate(); let owns = true;
    f.state.refreshGate = hold;
    const pending = f.a.commit(f.session('B', true), f.a.snapshot(), () => owns).catch(error => error);
    await hold.waiting; owns = false; hold.release();
    expect((await pending).message).toBe('AUTH_REFRESH_SUPERSEDED'); expect(f.credentials()).toEqual(before);
  } finally { await f.close(); }
});

test('valid inherited response chain retains ownership through publication', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), candidate = f.session('B', true); let cleaned = 0;
    guard.registerCommit(candidate.refresh_token, f.a.snapshot(), () => true, () => { cleaned++; });
    const first = await (await guard.fetch(refreshUrl, refreshInit(candidate.refresh_token))).json();
    const second = await (await guard.fetch(refreshUrl, refreshInit(first.refresh_token))).json();
    const committed = guard.prepareCommit([{ name: key, value: 'base64-' + Buffer.from(JSON.stringify(second)).toString('base64url'), options: {} }]);
    committed(); expect(cleaned).toBe(1); expect(f.state.refreshDispatches).toBe(2);
  } finally { await f.close(); }
});

for (const invalid of ['stale', 'ambiguous', 'owner-false', 'current-token-owner-false'] as const) test(`inherited ${invalid} refuses dispatch`, async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), expected = f.a.snapshot();
    const token = invalid === 'current-token-owner-false' ? f.stored()!.refresh_token : f.session('B', true).refresh_token;
    guard.registerCommit(token, invalid === 'stale' ? expected + '-stale' : expected, () => !invalid.endsWith('owner-false'));
    if (invalid === 'ambiguous') guard.registerCommit(token, expected + '-other');
    const before = f.credentials();
    await expect(guard.fetch(refreshUrl, refreshInit(token))).rejects.toThrow('AUTH_REFRESH_SUPERSEDED');
    expect(f.state.refreshDispatches).toBe(0); expect(f.credentials()).toEqual(before);
  } finally { await f.close(); }
});

test('rejected inherited guard remains counted at capacity', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), token = f.session('B').refresh_token;
    guard.registerCommit(token, f.a.snapshot(), () => false);
    await expect(guard.fetch(refreshUrl, refreshInit(token))).rejects.toThrow('AUTH_REFRESH_SUPERSEDED');
    for (let i = 0; i < 31; i++) guard.registerCommit(`synthetic-pending-${i}`, f.a.snapshot());
    expect(() => guard.registerCommit('synthetic-overflow', f.a.snapshot())).toThrow('AUTH_REFRESH_GUARD_CAPACITY');
    await expect(guard.fetch(refreshUrl, refreshInit(f.stored()!.refresh_token))).rejects.toThrow('AUTH_REFRESH_GUARD_CAPACITY');
    expect(f.state.refreshDispatches).toBe(0);
  } finally { await f.close(); }
});

test('inherited guard is resolved after lock admission, not before it', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), token = f.session('B', true).refresh_token;
    guard.registerCommit(token, f.a.snapshot());
    const pending = guard.fetch(refreshUrl, refreshInit(token));
    // Lock admission yields; poison the registration before its callback runs.
    guard.registerCommit(token, f.a.snapshot() + '-stale');
    await expect(pending).rejects.toThrow('AUTH_REFRESH_SUPERSEDED'); expect(f.state.refreshDispatches).toBe(0);
  } finally { await f.close(); }
});

test('a throwing inherited owner becomes a fixed plain error before dispatch', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), token = f.session('B', true).refresh_token;
    guard.registerCommit(token, f.a.snapshot(), () => { throw new Error('fixture-owner-unavailable'); });
    const error = await guard.fetch(refreshUrl, refreshInit(token)).catch(error => error);
    expect(error.name).toBe('Error'); expect(error.message).toBe('AUTH_REFRESH_SUPERSEDED'); expect(f.state.refreshDispatches).toBe(0);
  } finally { await f.close(); }
});

for (const body of [undefined, '', '{', 'null', '[]', '{}', '{"refresh_token":1}', '{"refresh_token":""}', '{"refresh_token":" "}']) {
  test(`malformed refresh body is rejected locally: ${String(body)}`, async () => {
    const f = fixture();
    try {
      await f.login(f.a, 'A'); const before = f.credentials();
      await expect(f.a.guard().fetch(refreshUrl, { method: 'POST', body })).rejects.toThrow('AUTH_REFRESH_REQUEST_INVALID');
      expect(f.state.refreshDispatches).toBe(0); expect(f.credentials()).toEqual(before);
    } finally { await f.close(); }
  });
}

test('Request-owned body fails closed without consuming it; explicit string override is supported', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), init = refreshInit(f.stored()!.refresh_token), request = new Request(refreshUrl, init);
    await expect(guard.fetch(request)).rejects.toThrow('AUTH_REFRESH_REQUEST_INVALID');
    expect(request.bodyUsed).toBe(false); expect(f.state.refreshDispatches).toBe(0);
    expect((await guard.fetch(request, init)).ok).toBe(true); expect(f.state.refreshDispatches).toBe(1);
  } finally { await f.close(); }
});

test('non-string init.body is unsupported even with a current token', async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const guard = f.a.guard(), token = f.stored()!.refresh_token;
    await expect(guard.fetch(refreshUrl, { method: 'POST', body: new Blob([refreshInit(token).body]) })).rejects.toThrow('AUTH_REFRESH_REQUEST_INVALID');
    expect(f.state.refreshDispatches).toBe(0);
  } finally { await f.close(); }
});

for (const malformed of ['json', 'missing-token'] as const) test(`valid request still forwards malformed response: ${malformed}`, async () => {
  const f = fixture();
  try {
    await f.login(f.a, 'A'); const before = f.credentials(); f.state.malformedResponse = malformed;
    const response = await f.a.guard().fetch(refreshUrl, refreshInit(f.stored()!.refresh_token));
    expect(response.status).toBe(200); expect(await response.text()).toBe(malformed === 'json' ? '{' : '{}');
    expect(f.credentials()).toEqual(before); expect(f.state.refreshDispatches).toBe(1);
  } finally { await f.close(); }
});
