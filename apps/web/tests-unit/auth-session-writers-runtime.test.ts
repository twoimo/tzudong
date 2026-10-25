import { beforeAll, expect, test } from 'bun:test';
import vm from 'node:vm';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type * as Account from '../lib/auth/isolated-browser-account';
import type * as Pkce from '../lib/auth/isolated-browser-pkce';

// Real pinned SDK + production adapters in separate JS realms. The cookie,
// lock and issuer transports below are fixtures, not browser/hosted evidence.
const issuer = 'http://issuer.test.invalid', origin = 'http://app.test.invalid';
const key = 'sb-issuer-v3-auth-token';
const oldId = '11111111-1111-4111-8111-111111111111', nextId = '22222222-2222-4222-8222-222222222222';
const root = path.resolve(import.meta.dir, '..');
let bundle: string;
beforeAll(async () => {
  const built = await Bun.build({ entrypoints: ['writer-runtime'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(issuer), 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"fixture-public-key"' },
    plugins: [{ name: 'writer-entry', setup(build) {
      build.onResolve({ filter: /^writer-runtime$/ }, () => ({ path: 'writer-runtime', namespace: 'writer-entry' }));
      build.onLoad({ filter: /.*/, namespace: 'writer-entry' }, () => ({ loader: 'ts', contents: `
        import {getSupabaseBrowserClient} from ${JSON.stringify(path.join(root, 'integrations/supabase/client.ts'))};
        import * as account from ${JSON.stringify(path.join(root, 'lib/auth/isolated-browser-account.ts'))};
        import * as pkce from ${JSON.stringify(path.join(root, 'lib/auth/isolated-browser-pkce.ts'))};
        globalThis.probe = { client: getSupabaseBrowserClient(), ...account, ...pkce };
      ` }));
    } }],
  });
  if (!built.success) throw new Error('WRITER_FIXTURE_BUILD_FAILED');
  bundle = await built.outputs[0].text();
});

function fixture() {
  const cookies = new Map<string, string>(), storage = new Map<string, string>(), locks = new Map<string, Promise<unknown>>();
  const events: string[] = [], logouts: Array<{ token: string | null; scope: string | null }> = [];
  const clients: SupabaseClient[] = [];
  const state = { sequence: 0, updates: 0, exchanges: 0, recoveries: 0, logoutStatus: 204,
    userHook: null as ((request: Request) => Promise<Response>) | null,
    passwordHook: null as (() => Promise<void>) | null };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function session(id: string, label: string) {
    return { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, jti: label }) + '.c2lnbmF0dXJl',
      refresh_token: `fixture-refresh-${label}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id, aud: 'authenticated', email: `${id === oldId ? 'old' : 'next'}@example.invalid`, user_metadata: {} } };
  }
  const owner = (request: Request) => {
    const jwt = request.headers.get('Authorization')?.slice(7) ?? '';
    try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub as string; }
    catch { return oldId; }
  };
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== issuer) throw new Error('OFFLINE_ISSUER_BOUNDARY');
    if (url.pathname.endsWith('/token')) {
      if (url.searchParams.get('grant_type') === 'pkce') {
        state.exchanges++;
        return Response.json(session(oldId, 'recovery'));
      }
      const body = await request.json() as { email?: string };
      if (state.passwordHook) { const hook = state.passwordHook; state.passwordHook = null; await hook(); }
      return Response.json(session(body.email?.startsWith('next') ? nextId : oldId, `login-${++state.sequence}`));
    }
    if (url.pathname.endsWith('/user')) {
      if (request.method === 'PUT') state.updates++;
      if (state.userHook) return state.userHook(request);
      return Response.json(session(owner(request), 'read').user);
    }
    if (url.pathname.endsWith('/logout')) {
      logouts.push({ token: request.headers.get('Authorization'), scope: url.searchParams.get('scope') });
      return new Response(null, { status: state.logoutStatus });
    }
    if (url.pathname.endsWith('/recover')) { state.recoveries++; return Response.json({}); }
    throw new Error('UNEXPECTED_ISSUER_OPERATION');
  };
  const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
    set cookie(value: string) {
      const [pair] = value.split(';'), index = pair.indexOf('='), name = pair.slice(0, index);
      if (/max-age=0(?:;|$)/i.test(value)) cookies.delete(name); else cookies.set(name, pair.slice(index + 1));
    },
  };
  const location = { pathname: '/auth/complete', href: `${origin}/auth/complete`, origin, assign() {} };
  const context = vm.createContext({ URL, URLSearchParams, Request, Response, Headers, AbortSignal, AbortController, DOMException, TextEncoder, TextDecoder, atob, btoa,
    crypto, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, fetch: transport, WebSocket,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    document, location, window: { document, location, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => { storage.set(name, String(value)); }, removeItem: (name: string) => { storage.delete(name); } },
    navigator: { locks: { request: (name: string, _options: unknown, action: () => unknown) => {
      const result = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(action); locks.set(name, result); return result;
    } } },
  });
  vm.runInContext(bundle, context);
  const probe = context.probe as { client: SupabaseClient } & typeof Account & typeof Pkce;
  clients.push(probe.client);
  probe.client.auth.onAuthStateChange(event => { events.push(event); });
  return { probe, state, logouts, events,
    credentials: () => [...cookies].filter(([name]) => name === key || name.startsWith(key + '.') || name.startsWith('tz-auth-v3-')).sort(),
    login: (next = false) => probe.client.auth.signInWithPassword({ email: next ? 'next@example.invalid' : 'old@example.invalid', password: 'fixture-only-password' }),
    current: () => probe.client.auth.getSession(),
    async close() { await Promise.all(clients.map(client => client.auth.dispose())); },
  };
}

function gate() {
  let release!: () => void, entered!: () => void;
  return { waiting: new Promise<void>(resolve => { entered = resolve; }), entered: () => entered(),
    held: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}

test('a revoked getUser response cannot remove a later actual SDK login', async () => {
  const f = fixture();
  try {
    await f.login();
    const hold = gate();
    f.state.userHook = async () => { hold.entered(); await hold.held; return Response.json({ code: 'session_not_found', message: 'session_not_found' }, { status: 403, headers: { 'x-supabase-api-version': '2024-01-01' } }); };
    const obsolete = f.probe.client.auth.getUser().then(() => 'accepted', error => error.message);
    await hold.waiting; await f.login(true); const before = f.credentials(); hold.release();
    expect(await obsolete).toBe('AUTH_SESSION_REMOVAL_REQUIRES_OWNER');
    expect(f.credentials()).toEqual(before);
    expect((await f.current()).data.session?.user.id).toBe(nextId);
    expect(f.events.filter(event => event === 'SIGNED_OUT')).toHaveLength(0);
  } finally { await f.close(); }
});

test('updateUser cannot republish its former account after another login', async () => {
  const f = fixture();
  try {
    await f.login(); const hold = gate();
    f.state.userHook = async request => { hold.entered(); await hold.held; return Response.json({ id: oldId, aud: 'authenticated', user_metadata: {}, method: request.method }); };
    const obsolete = f.probe.client.auth.updateUser({ data: { nickname: 'fixture' } }).then(() => 'accepted', error => error.message);
    await hold.waiting; await f.login(true); const before = f.credentials(); hold.release();
    expect(await obsolete).toBe('AUTH_REFRESH_SUPERSEDED');
    expect(f.credentials()).toEqual(before);
    expect((await f.current()).data.session?.user.id).toBe(nextId);
  } finally { await f.close(); }
});

test('unowned SDK setSession and signOut cannot mutate shared credentials', async () => {
  const f = fixture();
  try {
    const first = await f.login(); const before = f.credentials();
    await expect(f.probe.client.auth.setSession({ access_token: first.data.session!.access_token, refresh_token: 'unowned-fixture-token' })).rejects.toThrow('AUTH_SESSION_WRITE_UNOWNED');
    expect(f.credentials()).toEqual(before);
    await expect(f.probe.client.auth.signOut({ scope: 'local' })).rejects.toThrow('AUTH_SESSION_REMOVAL_REQUIRES_OWNER');
    expect(f.credentials()).toEqual(before);
  } finally { await f.close(); }
});

test('reauthentication and password update use memory only and revoke their captured session', async () => {
  const f = fixture();
  try {
    await f.login(); const before = f.credentials();
    await f.probe.changeBrowserAccountPassword({ userId: oldId, email: 'old@example.invalid', password: 'fixture-only-password', newPassword: 'changed-fixture-password' });
    expect(f.credentials()).toEqual(before);
    expect(f.state.updates).toBe(1);
    expect(f.logouts).toHaveLength(1);
    expect(f.logouts[0].scope).toBe('local');
    expect((await f.current()).data.session?.user.id).toBe(oldId);
  } finally { await f.close(); }
});

test('a delayed reauthentication cannot publish or update after an account switch', async () => {
  const f = fixture();
  try {
    await f.login(); const hold = gate();
    f.state.passwordHook = async () => { hold.entered(); await hold.held; };
    const obsolete = f.probe.changeBrowserAccountPassword({ userId: oldId, email: 'old@example.invalid', password: 'fixture-only-password', newPassword: 'changed-fixture-password' }).then(() => 'accepted', error => error.message);
    await hold.waiting; await f.login(true); const before = f.credentials(); hold.release();
    expect(await obsolete).toBe('AUTH_REAUTHENTICATION_FAILED');
    expect(f.state.updates).toBe(0);
    expect(f.credentials()).toEqual(before);
    expect(f.logouts).toHaveLength(1);
    expect(f.logouts[0].scope).toBe('local');
  } finally { await f.close(); }
});

test('wrong-account reauthentication revokes only its unused candidate', async () => {
  const f = fixture();
  try {
    const current = await f.login(); const before = f.credentials();
    await expect(f.probe.reauthenticateBrowserAccount({ userId: oldId, email: 'next@example.invalid', password: 'fixture-only-password' })).rejects.toThrow('AUTH_REAUTHENTICATION_FAILED');
    expect(f.credentials()).toEqual(before);
    expect(f.logouts).toHaveLength(1);
    expect(f.logouts[0].token).not.toBe(`Bearer ${current.data.session!.access_token}`);
  } finally { await f.close(); }
});

test('a cleanup rejection is reported after one password update without a retry', async () => {
  const f = fixture();
  try {
    await f.login(); const before = f.credentials(); f.state.logoutStatus = 500;
    await expect(f.probe.changeBrowserAccountPassword({ userId: oldId, email: 'old@example.invalid', password: 'fixture-only-password', newPassword: 'changed-fixture-password' })).rejects.toThrow('AUTH_ISOLATED_SESSION_CLEANUP_FAILED');
    expect(f.state.updates).toBe(1);
    expect(f.logouts).toHaveLength(1);
    expect(f.credentials()).toEqual(before);
  } finally { await f.close(); }
});

test('recovery owns one explicit exchange and never replaces the current browser account', async () => {
  const f = fixture();
  try {
    await f.login(true);
    await f.probe.requestBrowserPasswordRecovery('old@example.invalid');
    const before = f.credentials();
    const recovery = await f.probe.openBrowserPasswordRecovery('?code=fixture-one-use-code');
    expect(f.credentials()).toEqual(before);
    await recovery.updatePassword('changed-fixture-password');
    await recovery.dispose();
    expect(f.state.exchanges).toBe(1);
    expect(f.state.recoveries).toBe(1);
    expect(f.state.updates).toBe(1);
    expect(f.credentials()).toEqual(before);
    expect((await f.current()).data.session?.user.id).toBe(nextId);
    expect(f.logouts).toHaveLength(1);
    expect(f.logouts[0].scope).toBe('local');
  } finally { await f.close(); }
});

test('recovery refuses password changes after a later login', async () => {
  const f = fixture();
  try {
    await f.login(); await f.probe.requestBrowserPasswordRecovery('old@example.invalid');
    const recovery = await f.probe.openBrowserPasswordRecovery('?code=fixture-one-use-code');
    await f.login(true); const before = f.credentials();
    await expect(recovery.updatePassword('changed-fixture-password')).rejects.toThrow('AUTH_CALLBACK_SUPERSEDED');
    await recovery.dispose();
    expect(f.state.updates).toBe(0);
    expect(f.credentials()).toEqual(before);
    expect(f.logouts.every(logout => logout.scope === 'local')).toBe(true);
  } finally { await f.close(); }
});

test('recovery query rejects mixed, duplicate and empty one-use credentials', async () => {
  const f = fixture();
  try {
    for (const query of ['', '?code=', '?code=a&code=b', '?code=a&token_hash=b&type=recovery', '?token_hash=b&code=&type=recovery', '?code=a&type=signup', '?code=a&unknown=b']) {
      expect(f.probe.parsePasswordRecoveryQuery(query)).toBeNull();
    }
    expect(f.probe.parsePasswordRecoveryQuery('?code=a&type=recovery')).toEqual({ kind: 'code', code: 'a', flowId: null });
  } finally { await f.close(); }
});
