import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const ownerId = '11111111-1111-4111-8111-111111111111';
type Scenario = 'current' | 'replaced' | 'generation-changed' | 'remote-failed' | 'local-only' | 'mismatched-user' | 'lookup-failed' | 'missing-session';
type Probe = {
  run(scenario: Scenario): Promise<boolean>;
  entered: boolean;
  release(): void;
  scopes: string[];
  authorizationMatches: boolean;
  events: number;
  current: boolean;
};

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['rejection-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"https://current.supabase.co"' },
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), root) }));
      builder.onResolve({ filter: /^rejection-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        loader: 'ts', resolveDir: root,
        contents: `
          import {createClient} from '@supabase/supabase-js';
          import {captureBrowserLogout} from './lib/auth/browser-logout';
          import {signOutRejectedPrivacySession} from './lib/privacy/eligibility';
          const state=globalThis.__rejection={entered:false,release(){},scopes:[],authorizationMatches:true,events:0,current:true};
          addEventListener('home:auth-session-updated',event=>{
            if(event.detail?.source==='auth-privacy-session-cleared')state.events++;
          });
          state.run=async scenario=>{
            const token='synthetic-captured-access-token';
            const sdk=createClient('https://current.supabase.co','synthetic-public-key',{
              auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
              global:{fetch:async(input,init)=>{
                state.scopes.push(new URL(String(input)).searchParams.get('scope'));
                state.authorizationMatches&&=new Headers(init?.headers).get('authorization')==='Bearer '+token;
                if(state.scopes.length===1){state.entered=true;await new Promise(resolve=>state.release=resolve);}
                return new Response(scenario==='remote-failed'?'{}':null,{status:scenario==='remote-failed'?500:204});
              }}
            });
            const client={auth:{admin:sdk.auth.admin,
              getSession:async()=>({data:{session:scenario==='missing-session'?null:{access_token:token,user:{id:${JSON.stringify(ownerId)}}}},error:scenario==='lookup-failed'?new Error('SYNTHETIC_LOOKUP_FAILURE'):null}),
              signOut(){throw new Error('MUTABLE_SINGLETON_SIGNOUT_USED');}
            }};
            return signOutRejectedPrivacySession(client,{
              userId:scenario==='mismatched-user'?'22222222-2222-4222-8222-222222222222':${JSON.stringify(ownerId)},
              isCurrent:()=>state.current,browserLogout:captureBrowserLogout(),
              scope:scenario==='local-only'?'local':'global'
            });
          };
        `,
      }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  return built.outputs[0].text();
}

for (const scenario of ['current', 'replaced', 'generation-changed', 'remote-failed', 'local-only', 'mismatched-user', 'lookup-failed', 'missing-session'] as const) {
  test(`rejected privacy session uses captured JWT + native cookie ownership: ${scenario}`, async () => {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' }));
      await page.goto('https://rejected-session.test/');
      await page.addScriptTag({ content: await bundle() });
      await page.evaluate(scenario => {
        document.cookie = 'sb-current-v2-auth-token=old-synthetic; Path=/';
        document.cookie = 'unrelated=preserve; Path=/';
        const state = (globalThis as unknown as { __rejection: Probe }).__rejection;
        (globalThis as unknown as { __pending: Promise<boolean> }).__pending = state.run(scenario);
      }, scenario);
      if (scenario !== 'mismatched-user' && scenario !== 'lookup-failed' && scenario !== 'missing-session') {
        await page.waitForFunction(() => (globalThis as unknown as { __rejection: Probe }).__rejection.entered);
        await page.evaluate(scenario => {
          const state = (globalThis as unknown as { __rejection: Probe }).__rejection;
          if (scenario === 'replaced') document.cookie = 'sb-current-v2-auth-token=new-synthetic; Path=/';
          if (scenario === 'generation-changed') state.current = false;
          state.release();
        }, scenario);
      }
      const result = await page.evaluate(async () => {
        const state = (globalThis as unknown as { __rejection: Probe }).__rejection;
        return { cleared: await (globalThis as unknown as { __pending: Promise<boolean> }).__pending,
          scopes: state.scopes, authorizationMatches: state.authorizationMatches, events: state.events,
          currentCookie: document.cookie.includes('sb-current-v2-auth-token='),
          replacement: document.cookie.includes('sb-current-v2-auth-token=new-synthetic'),
          unrelated: document.cookie.includes('unrelated=preserve'),
          tombstone: document.cookie.includes('tz-auth-v2-current=1'),
        };
      });
      const stale = scenario === 'replaced' || scenario === 'generation-changed';
      const denied = scenario === 'mismatched-user' || scenario === 'lookup-failed';
      expect(result.cleared).toBe(!stale && !denied);
      expect(result.scopes).toEqual(denied || scenario === 'missing-session' ? [] : stale ? ['global'] : scenario === 'local-only' ? ['local'] : ['global', 'local']);
      expect(result.authorizationMatches).toBe(true);
      expect(result.events).toBe(stale || denied ? 0 : 1);
      expect(result.currentCookie).toBe(stale || denied);
      expect(result.replacement).toBe(scenario === 'replaced');
      expect(result.unrelated).toBe(true);
      expect(result.tombstone).toBe(!stale && !denied);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 15_000);
}
