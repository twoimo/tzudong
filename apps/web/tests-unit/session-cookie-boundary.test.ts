import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { stringToBase64URL } from '@supabase/ssr';
import { createClientForCookieStore, getConsumedPkceCookieNames } from '../lib/supabase/server';
import { getAuthCookieContract, readServerAuthCookies } from '../lib/auth/session-cookies';

const url = 'https://current.supabase.co';
const contract = getAuthCookieContract(url);

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

for (const legacyKey of [contract.legacyKey, contract.previousKey]) test(`server rejects old and mixed credentials: ${legacyKey}`, () => {
  const old = { name: legacyKey, value: 'old-synthetic' }, current = { name: contract.key, value: 'new-synthetic' };
  expect(readServerAuthCookies([old], url)).not.toContainEqual({ name: contract.key, value: old.value });
  expect(readServerAuthCookies([old, current, { name: contract.marker, value: '1' }], url)).not.toContainEqual(current);
  expect(readServerAuthCookies([current], url)).not.toContainEqual(current);
  expect(readServerAuthCookies([current, { name: contract.marker, value: 'pending' }], url)).not.toContainEqual(current);
  expect(readServerAuthCookies([current, { name: contract.marker, value: '1' }], url)).toContainEqual(current);
});

test('native cutover requires fresh login and preserves unrelated draft storage', async () => {
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try {
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://session-cookie.test/');await page.addScriptTag({content:await migrationBrowserBundle()});
  const result=await page.evaluate(({url,contract})=>{
   const migrate=(globalThis as unknown as {migrate(url:string):void}).migrate;
   localStorage.setItem('owned-draft-fixture','draft-preserved');
   for(const key of [contract.legacyKey,contract.previousKey])for(const suffix of ['.0','.1','-code-verifier'])document.cookie=`${key}${suffix}=old-synthetic; Path=/`;
   migrate(url);
   const first=document.cookie;
   document.cookie=`${contract.legacyKey}=late-old-response; Path=/`;migrate(url);
   return {noImport:!first.includes(contract.key+'='),noLegacy:!document.cookie.includes('old-synthetic')&&!document.cookie.includes('late-old-response'),complete:document.cookie.includes(contract.marker+'=1'),draft:localStorage.getItem('owned-draft-fixture')==='draft-preserved'};
  },{url,contract});expect(result).toEqual({noImport:true,noLegacy:true,complete:true,draft:true});
 }finally{await browser.close();}
},15000);

for (const intentionalExchange of [false, true]) test(`actual SSR never publishes auth cookies, stale opt-in=${!intentionalExchange}`, async () => {
  const savedFetch = globalThis.fetch;
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated' };
  const token = `header.${stringToBase64URL(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
  const initial = { access_token: token, refresh_token: 'synthetic-initial', expires_at: 1, user };
  let refreshes = 0;
  const writes: string[] = [];
  globalThis.fetch = (async () => { refreshes++; return new Response(JSON.stringify({ access_token: token, token_type: 'bearer', refresh_token: 'synthetic-rotated', expires_in: 3600, user }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  try {
    const client = Reflect.apply(createClientForCookieStore, undefined, [{ getAll: () => [{ name: contract.key, value: 'base64-' + stringToBase64URL(JSON.stringify(initial)) }, { name: contract.marker, value: '1' }], set: name => { writes.push(name); } },
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
    const client = Reflect.apply(createClientForCookieStore, undefined, [{ getAll: () => [{ name: contract.key, value: 'base64-' + stringToBase64URL(JSON.stringify(initial)) }, { name: contract.marker, value: '1' }], set: name => { writes.push(name); } },
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


for (const failure of ['old-cookie-delete', 'marker', 'preexisting-fragment'] as const) test(`cutover recovery never imports credentials: ${failure}`, async () => {
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try {
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://session-cookie.test/');await page.addScriptTag({content:await migrationBrowserBundle()});
  const result=await page.evaluate(({url,contract,failure})=>{
   const migrate=(globalThis as unknown as {migrate(url:string):void}).migrate;
   document.cookie=`${contract.legacyKey}=old-synthetic; Path=/`;
   if(failure==='preexisting-fragment')document.cookie=`${contract.key}.0=partial; Path=/`;
   const native=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;
   if(failure!=='preexisting-fragment')Object.defineProperty(document,'cookie',{configurable:true,get:()=>native.get!.call(document),set:value=>{
    if(failure==='marker'?String(value).startsWith(contract.marker+'='):String(value).startsWith(contract.legacyKey+'=')&&/max-age=0/i.test(String(value)))return;
    native.set!.call(document,value);
   }});
   let failed=false;try{migrate(url)}catch{failed=true}
   const uncommitted=!document.cookie.includes(contract.marker+'=1');Reflect.deleteProperty(document,'cookie');migrate(url);
   return {failed,uncommitted,noCredential:!document.cookie.includes(contract.key+'=')&&!document.cookie.includes(contract.key+'.'),complete:document.cookie.includes(contract.marker+'=1')};
  },{url,contract,failure});expect(result).toEqual({failed:failure!=='preexisting-fragment',uncommitted:failure!=='preexisting-fragment',noCredential:true,complete:true});
 }finally{await browser.close();}
},20000);

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
