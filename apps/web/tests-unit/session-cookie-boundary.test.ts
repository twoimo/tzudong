import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { stringToBase64URL } from '@supabase/ssr';
import { createClientForCookieStore, getConsumedPkceCookieNames } from '../lib/supabase/server';
import { getAuthCookieContract, readServerAuthCookies } from '../lib/auth/session-cookies';

const url = 'https://current.supabase.co';
const contract = getAuthCookieContract(url);

for (const newer of ['login', 'logout'] as const) test(`migration cannot replace a committed ${newer} after its first native cookie snapshot`, async () => {
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://session-cookie.test/');await page.addScriptTag({content:await migrationBrowserBundle()});
  const result=await page.evaluate(({url,contract,newer})=>{
   document.cookie=`${contract.legacyKey}=old-synthetic; Path=/`;
   const descriptor=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;let first=true;
   Object.defineProperty(document,'cookie',{configurable:true,get(){
    const snapshot=descriptor.get!.call(document);
    if(first){first=false;if(newer==='login')descriptor.set!.call(document,`${contract.key}=new-synthetic; Path=/`);descriptor.set!.call(document,`${contract.marker}=1; Path=/`);}
    return snapshot;
   },set(value){descriptor.set!.call(document,value);}});
   try{(globalThis as unknown as {migrate(url:string):void}).migrate(url);}finally{delete (document as unknown as {cookie?:string}).cookie;}
   return {newSessionPreserved:document.cookie.includes(`${contract.key}=new-synthetic`),oldSessionImported:document.cookie.includes(`${contract.key}=old-synthetic`),committed:document.cookie.includes(`${contract.marker}=1`)};
  },{url,contract,newer});
  expect(result).toEqual({newSessionPreserved:newer==='login',oldSessionImported:false,committed:true});
 }finally{await browser.close();}
},15000);

async function migrationBrowserBundle() {
    const built = await Bun.build({ entrypoints: ['boundary-fixture'], target: 'browser', format: 'iife', write: false,
      plugins: [{ name: 'boundary', setup(builder) {
        builder.onResolve({ filter: /^boundary-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import {migrateBrowserAuthCookies} from './lib/auth/session-cookies';globalThis.migrate=migrateBrowserAuthCookies;", loader: 'ts', resolveDir: import.meta.dir + '/..' }));
      } }],
    });
    if (!built.success) throw new Error('COOKIE_BOUNDARY_BUNDLE_FAILED');
    return built.outputs[0].text();
}

test('server legacy read is allowed only before the upgraded marker', () => {
  const old = { name: contract.legacyKey, value: 'synthetic' };
  expect(readServerAuthCookies([old], url)).toContainEqual({ name: contract.key, value: old.value });
  expect(readServerAuthCookies([old, { name: contract.marker, value: '1' }], url))
    .not.toContainEqual({ name: contract.key, value: old.value });
});

test('native browser migration preserves chunks and never reimports a late legacy write after logout', async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('https://session-cookie.test/');
    await page.addScriptTag({ content: await migrationBrowserBundle() });
    const result = await page.evaluate(({ url, contract }) => {
      const migrate = (globalThis as unknown as { migrate(url: string): void }).migrate;
      document.cookie = `${contract.legacyKey}.0=first; Path=/`;
      document.cookie = `${contract.legacyKey}.1=second; Path=/`;
      document.cookie = `${contract.legacyKey}-code-verifier=verifier; Path=/`;
      document.cookie = 'unrelated=kept; Path=/';
      migrate(url);
      const copied = document.cookie.includes(`${contract.key}.0=first`)
        && document.cookie.includes(`${contract.key}.1=second`)
        && document.cookie.includes(`${contract.key}-code-verifier=verifier`);
      for (const name of [contract.key + '.0', contract.key + '.1', contract.key + '-code-verifier']) {
        document.cookie = `${name}=; Path=/; Max-Age=0`;
      }
      document.cookie = `${contract.legacyKey}.0=late-old-tab; Path=/`;
      migrate(url);
      return { copied, marker: document.cookie.includes(`${contract.marker}=1`),
        restored: document.cookie.includes(`${contract.key}.0=`), unrelated: document.cookie.includes('unrelated=kept') };
    }, { url, contract });
    expect(result).toEqual({ copied: true, marker: true, restored: false, unrelated: true });
  } finally { await browser.close(); }
}, 20000);

for (const intentionalExchange of [false, true]) test(`actual SSR never publishes auth cookies, stale opt-in=${!intentionalExchange}`, async () => {
  const savedFetch = globalThis.fetch;
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated' };
  const token = `header.${stringToBase64URL(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  const initial = { access_token: token, refresh_token: 'synthetic-initial', expires_at: 1, user };
  let refreshes = 0;
  const writes: string[] = [];
  globalThis.fetch = (async () => { refreshes++; return new Response(JSON.stringify({ access_token: token, token_type: 'bearer', refresh_token: 'synthetic-rotated', expires_in: 3600, user }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  try {
    const client = Reflect.apply(createClientForCookieStore, undefined, [{ getAll: () => [{ name: contract.key, value: 'base64-' + stringToBase64URL(JSON.stringify(initial)) }], set: name => { writes.push(name); } },
      { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' }, { allowSessionCookieWrites: intentionalExchange }]);
    expect((await client.auth.getSession()).error).toBeNull();
    expect((await client.auth.getSession()).data.session?.refresh_token).toBe('synthetic-rotated');
    expect(refreshes).toBe(1);
    expect(writes).toEqual([]);
  } finally { globalThis.fetch = savedFetch; }
});


for (const accepted of [false, true]) test(`stale callback write/commit flags cannot enable HTTP auth cookies: ${accepted}`, async () => {
  const savedFetch = globalThis.fetch;
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated' };
  const token = `header.${stringToBase64URL(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  const initial = { access_token: token, refresh_token: 'synthetic-initial', expires_at: 1, user };
  const writes: string[] = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({ access_token: token, token_type: 'bearer', refresh_token: 'synthetic-rotated', expires_in: 3600, user }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    const client = Reflect.apply(createClientForCookieStore, undefined, [{ getAll: () => [{ name: contract.key, value: 'base64-' + stringToBase64URL(JSON.stringify(initial)) }], set: name => { writes.push(name); } },
      { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' }, { allowSessionCookieWrites: true, deferSessionCookieWrites: true }]);
    expect((await client.auth.getSession()).data.session?.refresh_token).toBe('synthetic-rotated');
    expect(writes).toEqual([]);
    if (!accepted) {
      await client.auth.signOut({ scope: 'global' });
      await client.auth.signOut({ scope: 'local' });
    }
    expect(writes).toEqual([]);
  } finally { globalThis.fetch = savedFetch; }
});


for (const failure of ['chunk', 'marker', 'preexisting-fragment'] as const) test(`incomplete native migration stays uncommitted and preserves recovery: ${failure}`, async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto('https://session-cookie.test/');
    await page.addScriptTag({ content: await migrationBrowserBundle() });
    const result = await page.evaluate(({ failure, url, contract }) => {
      const migrate = (globalThis as unknown as { migrate(url: string): void }).migrate;
      document.cookie = `${contract.legacyKey}.0=first; Path=/`;
      document.cookie = `${contract.legacyKey}.1=second; Path=/`;
      document.cookie = `${contract.legacyKey}-code-verifier=verifier; Path=/`;
      if (failure === 'preexisting-fragment') document.cookie = `${contract.key}.0=partial; Path=/`;
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
      if (failure !== 'preexisting-fragment') Object.defineProperty(document, 'cookie', { configurable: true, get: () => descriptor.get!.call(document), set(value: string) {
        if (value.startsWith(failure === 'chunk' ? `${contract.key}.1=` : `${contract.marker}=`)) return;
        descriptor.set!.call(document, value);
      } });
      let failed = false;
      try { migrate(url); } catch { failed = true; }
      const uncommitted = !document.cookie.includes(`${contract.marker}=1`);
      const legacyPreserved = document.cookie.includes(`${contract.legacyKey}.0=first`) && document.cookie.includes(`${contract.legacyKey}.1=second`);
      if (failure === 'preexisting-fragment') return { failed, uncommitted, legacyPreserved, retryComplete: true };
      Reflect.deleteProperty(document, 'cookie');
      migrate(url);
      const retryComplete = document.cookie.includes(`${contract.key}.0=first`) && document.cookie.includes(`${contract.key}.1=second`)
        && document.cookie.includes(`${contract.key}-code-verifier=verifier`) && document.cookie.includes(`${contract.marker}=1`);
      return { failed, uncommitted, legacyPreserved, retryComplete };
    }, { failure, url, contract });
    expect(result).toEqual({ failed: true, uncommitted: true, legacyPreserved: true, retryComplete: true });
  } finally { await browser.close(); }
}, 20000);

for (const allowPkceCookieWrites of [false, true]) test(`SSR verifier-only opt-in preserves PKCE but blocks session publication: ${allowPkceCookieWrites}`, async () => {
  const savedFetch=globalThis.fetch;
  const writes: string[]=[];
  const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated'};
  const access_token='header.'+stringToBase64URL(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600}))+'.signature';
  globalThis.fetch=(async()=>Response.json({access_token,refresh_token:'synthetic-exchanged',expires_in:3600,token_type:'bearer',user})) as typeof fetch;
  try {
    const client=createClientForCookieStore({getAll:()=>[],set:name=>{writes.push(name);}},
      {NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-public'}, {allowPkceCookieWrites});
    const oauth=await client.auth.signInWithOAuth({provider:'google',options:{skipBrowserRedirect:true}});
    expect(oauth.error).toBeNull();
    expect(new URL(oauth.data.url!).searchParams.get('code_challenge')).toBeTruthy();
    const exchange=await client.auth.exchangeCodeForSession('synthetic-one-use-code');
    expect(exchange.error).toBeNull();
    expect(exchange.data.session?.refresh_token).toBe('synthetic-exchanged');
    expect(getConsumedPkceCookieNames(client)).toContain(contract.key+'-code-verifier');
    expect(writes.some(name=>name===contract.key||/^\d+$/.test(name.slice(contract.key.length+1))||name===contract.marker)).toBe(false);
    if(allowPkceCookieWrites){expect(writes.length).toBeGreaterThan(0);expect(writes.every(name=>name===contract.key+'-code-verifier')).toBe(true);}
    else expect(writes).toEqual([]);
  } finally {globalThis.fetch=savedFetch;}
});
