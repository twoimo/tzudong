import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createChunks, stringToBase64URL } from '@supabase/ssr';

const root=path.resolve(import.meta.dir,'..');
const key='sb-current-v3-auth-token',marker='tz-auth-v3-current';
const userId='11111111-1111-4111-8111-111111111111';
async function bundle(){
 const r=await Bun.build({entrypoints:['concurrent-cookie-fixture'],target:'browser',format:'iife',write:false,
  define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://current.supabase.co"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"synthetic-public-key"'},
  plugins:[{name:'fixture',setup(b){
   if(process.env.TZUDONG_COOKIE_CONCURRENCY_BASELINE_DIR)b.onLoad({filter:/\/(?:lib\/auth\/(?:session-cookies|browser-logout)|integrations\/supabase\/client)\.ts$/},args=>({contents:readFileSync(path.join(process.env.TZUDONG_COOKIE_CONCURRENCY_BASELINE_DIR!,path.relative(root,args.path)),'utf8'),loader:'ts'}));
   b.onResolve({filter:/^concurrent-cookie-fixture$/},()=>({path:'entry',namespace:'fixture'}));
   b.onResolve({filter:/^@\//},a=>({path:Bun.resolveSync('./'+a.path.slice(2),root)}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'ts',resolveDir:root,contents:`
    import {supabase} from './integrations/supabase/client';
    import {migrateBrowserAuthCookies} from './lib/auth/session-cookies';
    import {captureBrowserLogout} from './lib/auth/browser-logout';
    globalThis.__cookieProbe={read:()=>supabase.auth.getSession(),migrate:()=>migrateBrowserAuthCookies('https://current.supabase.co'),capture:captureBrowserLogout,login:()=>supabase.auth.signInWithPassword({email:'synthetic@example.invalid',password:'synthetic-fixture-only'})};
   `}));
  }}]});if(!r.success)throw Error('COOKIE_CONCURRENCY_FIXTURE_BUILD_FAILED');return r.outputs[0].text();
}
interface Probe {__cookieProbe:{read():Promise<{data:{session:{user:{id:string}}|null};error:unknown}>;migrate():void;capture():ReturnType<typeof import('../lib/auth/browser-logout').captureBrowserLogout>;login():Promise<unknown>}}

for(let trial=0;trial<3;trial++)test(`two actual SDK tabs require fresh login at the legacy cutover: ${trial}`,async()=>{
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();let authRequests=0;
  await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='current.supabase.co'){authRequests++;return route.abort();}return route.fulfill({contentType:'text/html',body:'<!doctype html>'});});
  const token='header.'+stringToBase64URL(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600}))+'.signature';
  const legacy='base64-'+stringToBase64URL(JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId,aud:'authenticated'}}));
  await context.addCookies(createChunks('sb-current-auth-token',legacy).map(c=>({name:c.name,value:c.value,url:'https://cookie-concurrency.test/'})));
  const pages=await Promise.all([context.newPage(),context.newPage()]);await Promise.all(pages.map(p=>p.goto('https://cookie-concurrency.test/')));const script=await bundle();await Promise.all(pages.map(p=>p.addScriptTag({content:script})));
  const reads=await Promise.all(pages.map(p=>p.evaluate(()=>(globalThis as unknown as Probe).__cookieProbe.read().then(r=>({owner:r.data.session?.user.id,failed:!!r.error})))));
  expect(reads).toEqual([{owner:undefined,failed:false},{owner:undefined,failed:false}]);
  const cookies=await context.cookies();expect(cookies.find(c=>c.name===marker)?.value).toBe('1');expect(cookies.some(c=>c.name===key||c.name.startsWith(key+'.'))).toBe(false);expect(cookies.some(c=>c.name==='sb-current-auth-token')).toBe(false);expect(authRequests).toBe(0);
 }finally{await browser.close();}
},20000);

for(const operation of ['sdk-read','sdk-write','logout'] as const)test(`another renderer's cookie batch excludes ${operation}`,async()=>{
 const script=await bundle();const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',route=>{
   if(new URL(route.request().url()).hostname==='current.supabase.co')return route.fulfill({contentType:'application/json',body:JSON.stringify({access_token:'header.'+stringToBase64URL(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600}))+'.signature',refresh_token:'new-synthetic',expires_in:3600,token_type:'bearer',user:{id:userId,aud:'authenticated'}})});
   return route.fulfill({contentType:'text/html',body:'<!doctype html>'});
  });
  const holder=await context.newPage(),actor=await context.newPage();
  await holder.goto('https://cookie-batch.test/');await actor.goto('https://cookie-batch.test/');
  await context.addCookies([{name:key,value:'synthetic-owned',url:'https://cookie-batch.test/'},{name:marker,value:'1',url:'https://cookie-batch.test/'}]);
  await actor.addScriptTag({content:script});
  await holder.evaluate(async()=>{
   const state={held:false,release:()=>{}};(globalThis as unknown as {lockState:typeof state}).lockState=state;
   void navigator.locks.request('tz-auth-cookies:sb-current-v3-auth-token',async()=>{state.held=true;await new Promise<void>(r=>{state.release=r;});});
  });
  await holder.waitForFunction(()=>(globalThis as unknown as {lockState:{held:boolean}}).lockState.held);
  await actor.evaluate(operation=>{
   const state={done:false};(globalThis as unknown as {batchState:typeof state}).batchState=state;
   const probe=(globalThis as unknown as Probe).__cookieProbe;
   const pending=operation==='sdk-read'?probe.read():operation==='sdk-write'?probe.login():probe.capture().clearIfCurrent(()=>true);
   void pending.then(()=>{state.done=true;},()=>{state.done=true;});
  },operation);
  await actor.waitForTimeout(100);
  expect(await actor.evaluate(()=>(globalThis as unknown as {batchState:{done:boolean}}).batchState.done)).toBe(false);
  await holder.evaluate(()=>(globalThis as unknown as {lockState:{release():void}}).lockState.release());
  await actor.waitForFunction(()=>(globalThis as unknown as {batchState:{done:boolean}}).batchState.done);
 }finally{await browser.close();}
},20000);

test('logout rechecks captured ownership after waiting for another tab cookie batch',async()=>{
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  const holder=await context.newPage(),actor=await context.newPage();await holder.goto('https://cookie-owner.test/');await actor.goto('https://cookie-owner.test/');await actor.addScriptTag({content:await bundle()});
  await actor.evaluate(({key,marker})=>{document.cookie=`${key}=old-owned; Path=/`;document.cookie=`${marker}=1; Path=/`;}, {key,marker});
  await holder.evaluate(async()=>{const state={held:false,release:()=>{}};(globalThis as unknown as {lockState:typeof state}).lockState=state;void navigator.locks.request('tz-auth-cookies:sb-current-v3-auth-token',async()=>{state.held=true;await new Promise<void>(r=>{state.release=r;});});});
  await holder.waitForFunction(()=>(globalThis as unknown as {lockState:{held:boolean}}).lockState.held);
  await actor.evaluate(()=>{const state={done:false,cleared:true};(globalThis as unknown as {logoutState:typeof state}).logoutState=state;void (globalThis as unknown as Probe).__cookieProbe.capture().clearIfCurrent(()=>true).then(cleared=>{state.cleared=cleared;state.done=true;});});
  await actor.waitForTimeout(100);await holder.evaluate(key=>{document.cookie=`${key}=new-owned; Path=/`;(globalThis as unknown as {lockState:{release():void}}).lockState.release();},key);
  await actor.waitForFunction(()=>(globalThis as unknown as {logoutState:{done:boolean}}).logoutState.done);
  expect(await actor.evaluate(key=>({cleared:(globalThis as unknown as {logoutState:{cleared:boolean}}).logoutState.cleared,newPreserved:document.cookie.includes(`${key}=new-owned`)}),key)).toEqual({cleared:false,newPreserved:true});
 }finally{await browser.close();}
},20000);

test('missing Web Locks fails closed before a logout cookie mutation',async()=>{
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://cookie-no-lock.test/');await page.addScriptTag({content:await bundle()});
  const result=await page.evaluate(async({key,marker})=>{document.cookie=`${key}=owned; Path=/`;document.cookie=`${marker}=1; Path=/`;const before=document.cookie;Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});let code='';try{await (globalThis as unknown as Probe).__cookieProbe.capture().clearIfCurrent(()=>true);}catch(e){code=e instanceof Error?e.message:'unknown';}return {code,unchanged:before===document.cookie};},{key,marker});
  expect(result).toEqual({code:'AUTH_COOKIE_LOCK_UNAVAILABLE',unchanged:true});
 }finally{await browser.close();}
},20000);

for(const release of ['tab-closed','timeout'] as const)test(`cookie lock ${release} preserves a bounded, retryable logout`,async()=>{
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  const holder=await context.newPage(),actor=await context.newPage();await holder.goto('https://cookie-lock-lifetime.test/');await actor.goto('https://cookie-lock-lifetime.test/');await actor.addScriptTag({content:await bundle()});
  await actor.evaluate(({key,marker})=>{document.cookie=`${key}=owned; Path=/`;document.cookie=`${marker}=1; Path=/`;},{key,marker});
  await holder.evaluate(async()=>{const state={held:false,release:()=>{}};(globalThis as unknown as {lockState:typeof state}).lockState=state;void navigator.locks.request('tz-auth-cookies:sb-current-v3-auth-token',async()=>{state.held=true;await new Promise<void>(r=>{state.release=r;});});});
  await holder.waitForFunction(()=>(globalThis as unknown as {lockState:{held:boolean}}).lockState.held);
  const pending=actor.evaluate(async()=>{try{return {cleared:await (globalThis as unknown as Probe).__cookieProbe.capture().clearIfCurrent(()=>true),code:''};}catch(e){return {cleared:false,code:e instanceof Error?e.message:'unknown'};}});
  if(release==='tab-closed')await holder.close();
  const result=await pending;
  if(release==='tab-closed')expect(result).toEqual({cleared:true,code:''});
  else{
   expect(result).toEqual({cleared:false,code:'AUTH_COOKIE_LOCK_TIMEOUT'});
   expect(await actor.evaluate(key=>document.cookie.includes(`${key}=owned`),key)).toBe(true);
   await holder.close();
   expect(await actor.evaluate(()=>(globalThis as unknown as Probe).__cookieProbe.capture().clearIfCurrent(()=>true))).toBe(true);
  }
 }finally{await browser.close();}
},20000);

for(const denied of ['all','second-chunk'] as const)test(`SDK cannot report a successful login when cookie persistence is denied: ${denied}`,async()=>{
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const context=await browser.newContext();
  const token='header.'+stringToBase64URL(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600}))+'.signature';
  const old={access_token:token,refresh_token:'old-synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId,aud:'authenticated'}};
  const original='base64-'+stringToBase64URL(JSON.stringify(old));
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='current.supabase.co'?r.fulfill({contentType:'application/json',body:JSON.stringify({...old,expires_in:3600,token_type:'bearer',refresh_token:'new-synthetic',user:{...old.user,user_metadata:{padding:denied==='second-chunk'?'x'.repeat(6000):''}}})}):r.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  const page=await context.newPage();await page.goto('https://cookie-write-denied.test/');await context.addCookies([{name:key,value:original,url:'https://cookie-write-denied.test/'},{name:marker,value:'1',url:'https://cookie-write-denied.test/'}]);await page.addScriptTag({content:await bundle()});
  await page.evaluate(()=>(globalThis as unknown as Probe).__cookieProbe.read());
  const result=await page.evaluate(async({key,denied})=>{
   const native=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;let rejected=false,code='';
   Object.defineProperty(document,'cookie',{configurable:true,get(){return native.get!.call(document);},set(value:string){if(value.startsWith((denied==='all'?key:key+'.1')+'=')||denied==='all'&&value.startsWith(key+'.'))return;native.set!.call(document,value);}});
   try{await (globalThis as unknown as Probe).__cookieProbe.login();}catch(e){rejected=true;code=e instanceof Error?e.message:'unknown';}finally{Reflect.deleteProperty(document,'cookie');}
   return {rejected,code};
  },{key,denied});
  expect(result).toEqual({rejected:true,code:'AUTH_COOKIE_WRITE_FAILED'});
  if(denied==='all')expect((await context.cookies()).find(c=>c.name===key)?.value).toBe(original);
 }finally{await browser.close();}
},20000);

for(const newer of ['login','logout'] as const)test(`late legacy HTTP response cannot create a v3 session: ${newer}`,async()=>{
 const script=await bundle();let responseAccepted=0;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
  if(new URL(request.url).pathname==='/commit'){
   responseAccepted++;const headers=new Headers();headers.append('Set-Cookie',newer==='login'?'sb-current-auth-token=new-synthetic; Path=/':'sb-current-auth-token=; Path=/; Max-Age=0');return new Response('ok',{headers});
  }return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});
 }});
 const browser=await chromium.launch({executablePath:chromeForTestingExecutable(),headless:true});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.port}/`);await page.addScriptTag({content:script});
  const result=await page.evaluate(({key,marker,newer})=>{
   document.cookie='sb-current-auth-token=old-synthetic; Path=/';const descriptor=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;let first=true;
   Object.defineProperty(document,'cookie',{configurable:true,get(){const snapshot=descriptor.get!.call(document);if(first){first=false;const xhr=new XMLHttpRequest();xhr.open('GET','/commit',false);xhr.send();if(xhr.status!==200)throw Error('HTTP_COMMIT_FAILED');}return snapshot;},set(value){descriptor.set!.call(document,value);}});
   try{(globalThis as unknown as Probe).__cookieProbe.migrate();}finally{delete (document as unknown as {cookie?:string}).cookie;}
   return {newPreserved:document.cookie.includes(`${key}=new-synthetic`),oldImported:document.cookie.includes(`${key}=old-synthetic`),committed:document.cookie.includes(`${marker}=1`),expectedNew:newer==='login'};
  },{key,marker,newer});
  expect(result.newPreserved).toBe(false);expect(result.oldImported).toBe(false);expect(result.committed).toBe(true);expect(responseAccepted).toBe(1);
 }finally{await browser.close();await server.stop(true);}
},20000);
