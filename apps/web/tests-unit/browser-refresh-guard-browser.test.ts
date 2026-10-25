import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { stringToBase64URL } from '@supabase/ssr';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const key = 'sb-127-v2-auth-token', marker = 'tz-auth-v2-127';
const oldOwner = '11111111-1111-4111-8111-111111111111';
const newOwner = '22222222-2222-4222-8222-222222222222';
function session(owner: string, refresh: string, chunked = false) {
  return { access_token: 'header.' + stringToBase64URL(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.signature',
    refresh_token: refresh, expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer',
    user: { id: owner, aud: 'authenticated', user_metadata: { padding: chunked ? '한글🍜'.repeat(1200) : '' } } };
}

async function fixture(replacement = newOwner, chunked = false, malformed: 'json' | 'missing-token' | null = null) {
  let refreshRequests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') {
        refreshRequests++;
        if (malformed === 'json') return new Response('private-response-fixture', { headers: { 'Content-Type': 'application/json' } });
        if (malformed === 'missing-token') return Response.json({ private: 'private-response-fixture' });
        return Response.json(session(oldOwner, 'rotated-synthetic', chunked));
      }
      return Response.json(session(replacement, 'replacement-synthetic', chunked));
    }
    return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  } });
  const url = `http://127.0.0.1:${server.port}`;
  const built = await Bun.build({ entrypoints: ['refresh-guard-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(url), 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"synthetic-public"' },
    plugins: [{ name: 'fixture', setup(b) {
      if (process.env.TZUDONG_REFRESH_GUARD_BASELINE_DIR) b.onLoad({ filter: /\/integrations\/supabase\/client\.ts$/ }, args => ({ contents: readFileSync(path.join(process.env.TZUDONG_REFRESH_GUARD_BASELINE_DIR!, path.relative(root, args.path)), 'utf8'), loader: 'ts' }));
      b.onResolve({ filter: /^refresh-guard-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, loader: 'ts', contents: `
        import {supabase} from './integrations/supabase/client';
        import {captureBrowserLogout} from './lib/auth/browser-logout';
        import {createBrowserRefreshGuard} from './lib/auth/browser-refresh-guard';
        const events=[];supabase.auth.onAuthStateChange(event=>{events.push(event)});
        globalThis.probe={events,read:()=>supabase.auth.getSession(),refresh:()=>supabase.auth.refreshSession(),
          login:()=>supabase.auth.signInWithPassword({email:'synthetic@example.invalid',password:'synthetic-only'}),
          logout:()=>captureBrowserLogout().clearIfCurrent(()=>true),
          forwardResponse:async()=>{const r=await createBrowserRefreshGuard('${url}').fetch('${url}/auth/v1/token?grant_type=refresh_token',{method:'POST'});return {status:r.status,body:await r.text()}}};
      ` }));
    } }] });
  if (!built.success) { await server.stop(true); throw new Error('REFRESH_GUARD_FIXTURE_BUILD_FAILED'); }
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: key, value: 'base64-' + stringToBase64URL(JSON.stringify(session(oldOwner, 'original-synthetic'))), url }, { name: marker, value: '1', url }]);
  const a = await context.newPage(), b = await context.newPage();
  const script = await built.outputs[0].text();
  for (const page of [a, b]) { await page.goto(url); await page.addScriptTag({ content: script }); await page.evaluate(() => (globalThis as unknown as Fixture).probe.read()); }
  return { a, b, context, refreshRequests: () => refreshRequests, close: async () => { await browser.close(); await server.stop(true); } };
}
interface Fixture {
  probe: { events: string[]; read(): Promise<{ data: { session: { user: { id: string }; refresh_token: string } | null }; error: unknown }>;
    refresh(): ReturnType<Fixture['probe']['read']>; login(): ReturnType<Fixture['probe']['read']>; logout(): Promise<boolean>;
    forwardResponse(): Promise<{ status: number; body: string }> };
  held: { response: boolean; active: boolean; release(): void; settled: boolean; rejected: string | null };
}

for (const chunked of [false, true]) test(`normal actual SDK refresh persists and publishes once, chunked=${chunked}`, async () => {
  const f = await fixture(newOwner, chunked);
  try {
    const result = await f.a.evaluate(async () => {
      const p = (globalThis as unknown as Fixture).probe;
      const refreshed = await p.refresh(); const stored = await p.read();
      return { owner: stored.data.session?.user.id, tokenMatches: stored.data.session?.refresh_token === refreshed.data.session?.refresh_token,
        error: !!refreshed.error, events: p.events.filter(e => e === 'TOKEN_REFRESHED').length };
    });
    expect(result).toEqual({ owner: oldOwner, tokenMatches: true, error: false, events: 1 });
    expect(f.refreshRequests()).toBe(1);
    expect((await f.context.cookies()).filter(c => c.name.startsWith(key + '.')).length > 1).toBe(chunked);
  } finally { await f.close(); }
}, 20000);

for (const malformed of ['json', 'missing-token'] as const) test(`fetch guard forwards malformed response unchanged to SDK validation: ${malformed}`, async () => {
  const f = await fixture(newOwner, false, malformed);
  try {
    const before = (await f.context.cookies()).map(c => [c.name, c.value]).sort();
    const forwarded = await f.a.evaluate(() => (globalThis as unknown as Fixture).probe.forwardResponse());
    expect(forwarded.status).toBe(200);
    expect(forwarded.body).toBe(malformed === 'json' ? 'private-response-fixture' : JSON.stringify({ private: 'private-response-fixture' }));
    expect(f.refreshRequests()).toBe(1);
    expect((await f.context.cookies()).map(c => [c.name, c.value]).sort()).toEqual(before);
    expect(await f.a.evaluate(() => (globalThis as unknown as Fixture).probe.events.filter(e => e === 'TOKEN_REFRESHED' || e === 'SIGNED_OUT').length)).toBe(0);
  } finally { await f.close(); }
}, 20000);

for (const replacement of ['other-account', 'same-account', 'logout'] as const) for (const chunked of [false, true]) {
  test(`post-guard suspended refresh cannot overwrite ${replacement}, chunked=${chunked}`, async () => {
    const f = await fixture(replacement === 'same-account' ? oldOwner : newOwner, chunked);
    try {
      await f.a.evaluate(() => {
        const g = globalThis as unknown as Fixture;
        const state = g.held = { response: false, active: false, release: () => {}, settled: false, rejected: null };
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (...args) => { const r = await nativeFetch(...args); if (String(args[0] instanceof Request ? args[0].url : args[0]).includes('grant_type=refresh_token')) state.response = true; return r; };
        const request = navigator.locks.request.bind(navigator.locks);
        // Hold delivery after the native lock is RELEASED, so another actual
        // SDK client can commit before A resumes with its stale guard snapshot.
        Object.defineProperty(navigator.locks, 'request', { configurable: true, value: (...args: Parameters<typeof request>) => request(...args).then(async result => {
          if (state.response && Array.isArray(result) && !state.active) { state.active = true; await new Promise<void>(resolve => { state.release = resolve; }); }
          return result;
        }) });
        void g.probe.refresh().then(() => { state.settled = true; }, error => { state.settled = true; state.rejected = error instanceof Error ? error.message : 'unknown'; });
      });
      await f.a.waitForFunction(() => (globalThis as unknown as Fixture).held.active);
      if (replacement === 'logout') expect(await f.b.evaluate(() => (globalThis as unknown as Fixture).probe.logout())).toBe(true);
      else expect(await f.b.evaluate(() => (globalThis as unknown as Fixture).probe.login().then(r => !!r.data.session))).toBe(true);
      const before = (await f.context.cookies()).filter(c => c.name === marker || c.name === key || c.name.startsWith(key + '.')).map(c => [c.name, c.value]).sort();
      await f.a.evaluate(() => (globalThis as unknown as Fixture).held.release());
      await f.a.waitForFunction(() => (globalThis as unknown as Fixture).held.settled);
      const after = (await f.context.cookies()).filter(c => c.name === marker || c.name === key || c.name.startsWith(key + '.')).map(c => [c.name, c.value]).sort();
      expect(after).toEqual(before);
      expect(await f.a.evaluate(() => (globalThis as unknown as Fixture).held.rejected)).toBe('AUTH_REFRESH_SUPERSEDED');
      expect(await f.a.evaluate(() => (globalThis as unknown as Fixture).probe.events.filter(e => e === 'TOKEN_REFRESHED').length)).toBe(0);
      const stored = await f.b.evaluate(() => (globalThis as unknown as Fixture).probe.read().then(r => ({ owner: r.data.session?.user.id ?? null, replacement: r.data.session?.refresh_token === 'replacement-synthetic' })));
      expect(stored).toEqual({ owner: replacement === 'logout' ? null : replacement === 'same-account' ? oldOwner : newOwner, replacement: replacement !== 'logout' });
      expect(f.refreshRequests()).toBe(1);
    } finally { await f.close(); }
  }, 20000);
}
