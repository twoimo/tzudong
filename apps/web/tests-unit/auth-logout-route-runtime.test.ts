import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const next = require('next/server');
const root = path.resolve(import.meta.dir, '..');
const origin = 'https://logout.fixture.invalid';

// Real route, Next request/response and origin guard; only the SDK I/O is
// replaced. The real local SDK/GoTrue race is retained in the v12 evidence.
function fixture(fails = false) {
  const state = { factoryCalls: 0, logoutCalls: 0, scope: '', captured: false };
  const context = vm.createContext({ URL, process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: origin } } });
  const cache = new Map();
  const allowed = new Set(['app/api/auth/logout/route.ts', 'lib/security/same-origin-mutation.ts', 'lib/auth/callback-origin.ts']);
  function load(relative: string) {
    if (!allowed.has(relative)) throw new Error('UNDECLARED_SOURCE_IMPORT');
    if (cache.has(relative)) return cache.get(relative);
    const record = { exports: {} };
    const imported = (name: string) => {
      if (name === 'next/server') return next;
      if (name === '@/lib/supabase/server') return {
        createClientForCookieStore(store) {
          state.factoryCalls++;
          state.captured = store.getAll().some(cookie => cookie.name === 'sb-fixture-auth-token' && cookie.value === 'synthetic-session');
          return { auth: { async signOut({ scope }) {
            state.logoutCalls++;
            state.scope = scope;
            // Exercise both cookie changes emitted by SSR: refresh and logout.
            // A late server response must publish neither over a newer session.
            store.set('sb-fixture-auth-token', 'synthetic-refreshed', { path: '/' });
            store.set('sb-fixture-auth-token', '', { maxAge: 0, path: '/' });
            return { error: fails ? new Error('synthetic provider detail') : null };
          } } };
        },
      };
      if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
      throw new Error('UNDECLARED_MODULE_IMPORT');
    };
    const source = ts.transpileModule(readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInContext(`(function(module, exports, require) { ${source}\n})`, context)(record, record.exports, imported);
    cache.set(relative, record.exports);
    return record.exports;
  }
  const route = load('app/api/auth/logout/route.ts');
  const post = (options: { origin?: string; query?: string; body?: string; cookie?: boolean } = {}) => new next.NextRequest(`${origin}/api/auth/logout${options.query ?? ''}`, {
    method: 'POST', headers: { origin: options.origin ?? origin, ...(options.cookie === false ? {} : { cookie: 'sb-fixture-auth-token=synthetic-session' }) },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  return { state, route, post };
}

describe('logout route request-scoped cookie ownership', () => {
  test('revokes the captured local session without a response cookie mutation', async () => {
    const f = fixture();
    const request = f.post();
    const response = await f.route.POST(request);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(request.cookies.get('sb-fixture-auth-token')?.value === 'synthetic-session').toBe(true);
    expect(f.state).toEqual({ factoryCalls: 1, logoutCalls: 1, scope: 'local', captured: true });
  });
  test('provider failure stays bounded and cannot clear a newer cookie', async () => {
    const f = fixture(true);
    const response = await f.route.POST(f.post());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'LOGOUT_FAILED' });
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  for (const [name, options, status] of [
    ['foreign origin', { origin: 'https://other.fixture.invalid' }, 403],
    ['query', { query: '?next=/' }, 403],
    ['nonempty body', { body: '{}' }, 400],
  ] as const) test(`${name} is rejected before the SDK`, async () => {
    const f = fixture();
    const response = await f.route.POST(f.post(options));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: 'INVALID_LOGOUT_REQUEST' });
    expect(f.state.factoryCalls).toBe(0);
  });
  test('an already signed-out browser can complete idempotently', async () => {
    const f = fixture();
    const response = await f.route.POST(f.post({ cookie: false }));
    expect(response.status).toBe(200);
    expect(f.state.captured).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
});
