import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
interface DraftAuthGlobals {
 __authDraft:{owner:string;other:string;publicRead():Promise<unknown>;clear():Promise<unknown>;signOut():Promise<void>;refresh():void;save(id:string,text:string):Promise<unknown>;read(id:string):Promise<{content:string}|null>};
 __authEvents:{failCleanup:boolean;holdCleanup:boolean;cleanupEntered:boolean;releaseCleanup():void;holdEligibility:boolean;rejectEligibility:boolean;eligibilityEntered:boolean;releaseEligibility():void;holdLogout:boolean;logoutEntered:boolean;release():void;storeOnly(id:string|null):void;emit(id:string|null):void};
 __pendingLogout:Promise<void>;__authRoot:{unmount():void};
}
const root=join(import.meta.dir,'..');
for (const replacement of ['different-owner', 'same-owner-new-family'] as const) test(`stale published auth cannot dispatch logout for ${replacement}`, async () => {
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage();let requests=0;
  await page.route('**/*',route=>{
   if(route.request().url().endsWith('/api/auth/logout')){requests++;return route.fulfill({status:200,body:'{}'});}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
  });
  await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(replacement=>{
   const w=globalThis as unknown as DraftAuthGlobals;
   if(replacement==='same-owner-new-family')localStorage.setItem('synthetic-auth-family','renewed');
   w.__authEvents.storeOnly(replacement==='different-owner'?w.__authDraft.other:w.__authDraft.owner);
  },replacement);
  const superseded=await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authDraft.signOut().then(()=>false,error=>error.code==='AUTH_LOGOUT_SUPERSEDED'));
  expect(superseded).toBe(true);expect(requests).toBe(0);
 }finally{await browser.close();}
},15000);
async function bundle(composer: 'submission' | 'edit' | 'review' | 'new-review' | null = null){
 const entry=`import React from 'react';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import RestaurantSubmissionModal from './components/modals/RestaurantSubmissionModal';import {EditRestaurantModal} from './components/modals/EditRestaurantModal';import {ReviewEditModal} from './components/reviews/ReviewEditModal';import {ReviewModal} from './components/reviews/ReviewModal';import {createRoot} from 'react-dom/client';import {AuthProvider,useAuth} from './contexts/AuthContext';import {clearBrowserDraftsForUser} from './lib/privacy/browser-draft-cleanup';import {saveDraft,getDraft} from '@/lib/reviewDraftDB';import {captureBrowserDraftEpoch} from '@/lib/privacy/browser-draft-lifecycle';
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',rid='33333333-3333-4333-8333-333333333333';
 globalThis.__authDraft={owner,other,publicRead:()=>getDraft(owner,rid),clear:()=>clearBrowserDraftsForUser(owner),save:(uid,text)=>saveDraft({userId:uid,restaurantId:rid,visitedDate:'2026-10-20',visitedTime:'12:00',categories:['분식'],content:text}),read:async uid=>{const db=await new Promise(resolve=>{const r=indexedDB.open('tzudong-review-drafts',3);r.onsuccess=()=>resolve(r.result);});const row=await new Promise(resolve=>{const r=db.transaction('review-drafts').objectStore('review-drafts').get(['v3-'+uid,rid]);r.onsuccess=()=>resolve(r.result);});db.close();return row??null;}};
 const selected=${JSON.stringify(composer)};const restaurant={id:rid,name:'합성 식당'};const initial={name:'합성 식당',address:'합성 주소',phone:'',category:['분식'],youtube_reviews:[],requestKind:'edit'};const review={id:'22222222-2222-4222-8222-222222222222',restaurantId:rid,restaurantName:restaurant.name,content:'합성 기존 리뷰입니다. 실제 방문이 아닙니다.',categories:['분식'],foodPhotos:[]};
 function Composer(){const [value,setValue]=React.useState('');if(selected==='submission')return <RestaurantSubmissionModal isOpen onClose={()=>{}} presentation="map-panel"/>;if(selected==='edit')return <EditRestaurantModal isOpen onClose={()=>{}} restaurant={restaurant} initialFormData={initial} presentation="map-panel"/>;if(selected==='review')return <ReviewEditModal isOpen onClose={()=>{}} review={review}/>;if(selected==='new-review')return <ReviewModal isOpen onClose={()=>{}} restaurant={restaurant} presentation="map-panel"/>;return <input value={value} onChange={e=>setValue(e.target.value)}/>};function Consumer(){const auth=useAuth();globalThis.__authDraft.signOut=()=>{const pending=auth.signOut();pending.catch(()=>{});return pending;};globalThis.__authDraft.refresh=auth.completeNicknameSetup;return <><output>{auth.isLoading?'loading':auth.user?.id??'signed-out'}</output>{auth.user&&<Composer key={auth.user.id+':'+captureBrowserDraftEpoch(auth.user.id).generation}/>}</>}
 const root=createRoot(document.getElementById('root'));globalThis.__authRoot=root;root.render(<AuthProvider><QueryClientProvider client={new QueryClient()}><Consumer/></QueryClientProvider></AuthProvider>);`;
 const inert:Record<string,string>={
  'next/image':`import React from 'react';export default function Image({fill,unoptimized,...props}){return React.createElement('img',props)}`,
  'next/link':`import React from 'react';export default function Link(props){return React.createElement('a',props)}`,
  'next/navigation':`export const useRouter=()=>({push(){},replace(){},refresh(){}});`,
  '@/lib/no-toast':`export const toast={success(){},error(){},warning(){},info(){}};`,
  '@/hooks/use-toast':`export const toast=()=>{};export const useToast=()=>({toast});`,
  '@/integrations/supabase/client':`const s=uid=>({access_token:'synthetic-'+uid+'-'+(localStorage.getItem('synthetic-auth-family')??'0'),user:{id:uid},expires_at:Math.floor(Date.now()/1000)+3600});let session=s('11111111-1111-4111-8111-111111111111'),callback;const key='synthetic-auth-owner';const stored=()=>{const uid=localStorage.getItem(key);return uid===null?session:uid?s(uid):null};globalThis.__authEvents={storeOnly(uid){localStorage.setItem(key,uid??'')},emit(uid){session=uid?s(uid):null;this.storeOnly(uid);callback?.(uid?'SIGNED_IN':'SIGNED_OUT',session)},holdLogout:false,logoutEntered:false,release:()=>{}};const chain={select(){return this},eq(){return this},async maybeSingle(){return {data:null,error:null}}};export const supabase={from(){return chain},rpc(){throw new Error('SYNTHETIC_RPC_NOT_ALLOWED')},storage:{from(){return {upload(){throw new Error('SYNTHETIC_MEDIA_NOT_ALLOWED')},list(){throw new Error('SYNTHETIC_MEDIA_NOT_ALLOWED')},remove(){throw new Error('SYNTHETIC_MEDIA_NOT_ALLOWED')}}}},auth:{getUser:async()=>({data:{user:stored()?.user??null},error:null}),getSession:async()=>({data:{session:stored()}}),onAuthStateChange(cb){callback=cb;return {data:{subscription:{unsubscribe(){callback=null}}}}},async signOut(){globalThis.__authEvents.emit(null);if(globalThis.__authEvents.holdLogout){globalThis.__authEvents.logoutEntered=true;await new Promise(resolve=>globalThis.__authEvents.release=resolve)}return {error:null}}}};`,
  '@/lib/auth/browser-logout':`export const captureBrowserLogout=()=>({isCurrent:()=>true,isCleared:()=>true,async clearIfCurrent(owns){if(!owns())return false;globalThis.__authEvents.storeOnly(null);return true}});`,
  '@/lib/privacy/eligibility':`export const getCurrentPrivacyEligibility=async()=>{const io=globalThis.__authEvents;const ready=!io.rejectEligibility;io.rejectEligibility=false;if(io.holdEligibility){io.holdEligibility=false;io.eligibilityEntered=true;await new Promise(resolve=>io.releaseEligibility=resolve)}return {ready}};export const hasLivePrivacyEligibilityReceipt=value=>value?.ready===true;export const signOutRejectedPrivacySession=async()=>{};`,
  '@/lib/public-profile-read':`export const isPublicProfileInvalidSessionError=()=>false;export const readPublicProfileSummaries=async()=>[{nickname:'합성 계정'}];`,
  '@/lib/debug-log':`export const DEBUG_LOG_EVENT={},DEBUG_LOG_REASON_CODE={};export const debugLog=()=>{};`,
 };
 const idb=Bun.resolveSync('idb',root);
 const built=await Bun.build({entrypoints:['auth-race'],target:'browser',format:'iife',write:false,define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture',setup(b){if(process.env.TZUDONG_AUTH_MULTITAB_BASELINE_DIR)b.onLoad({filter:/\.(ts|tsx)$/},args=>{const path=join(process.env.TZUDONG_AUTH_MULTITAB_BASELINE_DIR!,args.path.slice(root.length+1));if(existsSync(path))return {contents:readFileSync(path,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};});b.onResolve({filter:/^idb$/},()=>({path:'idb',namespace:'idb'}));b.onLoad({filter:/.*/,namespace:'idb'},()=>({contents:`export * from '${idb}';import {openDB as open} from '${idb}';export async function openDB(name,...args){const io=globalThis.__authEvents;if(name==='tzudong-review-drafts'&&io?.failCleanup)throw new Error('SYNTHETIC_IDB_UNAVAILABLE');const db=await open(name,...args);if(name==='tzudong-review-drafts'&&io?.holdCleanup){io.holdCleanup=false;io.cleanupEntered=true;await new Promise(resolve=>io.releaseCleanup=resolve);}return db;}`,loader:'ts',resolveDir:root}));b.onResolve({filter:/^auth-race$/},()=>({path:'entry',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:entry,loader:'tsx',resolveDir:root}));b.onResolve({filter:/^(?:@\/|next\/)/},a=>inert[a.path]?{path:a.path,namespace:'inert'}:{path:Bun.resolveSync('./'+a.path.slice(2),root)});b.onLoad({filter:/.*/,namespace:'inert'},a=>({contents:inert[a.path],loader:'ts',resolveDir:root}));}}]});
 if(!built.success)throw new Error(built.logs.map(String).join('\n'));return built.outputs[0].text();
}
for(const event of ['sign-out','switch-owner','relogin-during-logout','unmount-during-eligibility','relogin-before-cleanup','relogin-with-cleanup-failure'])test(`actual AuthProvider preserves draft ownership during ${event}`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):r.request().url().endsWith('/api/auth/logout')?r.fulfill({status:200,body:'{}'}):r.abort());
  await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});const output=page.locator('output');await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;await d.save(d.owner,'이전 합성 계정 초안');});
  if(event==='relogin-with-cleanup-failure'){
   await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.failCleanup=true;w.__pendingLogout=w.__authDraft.signOut();});await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__pendingLogout);await browserExpect(output).toHaveText('signed-out');await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.emit(w.__authDraft.owner);});await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
   expect(await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authDraft.publicRead().then(()=>'',e=>e.message))).toBe('DRAFT_READ_UNAVAILABLE');await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__pendingLogout);await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  }else if(event==='relogin-before-cleanup'){
   await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.holdCleanup=true;w.__authEvents.emit(null);});await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.cleanupEntered);await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.emit(w.__authDraft.owner);});await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
   expect(await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return await d.read(d.owner)===null;})).toBe(true);await page.evaluate(()=>{(globalThis as unknown as DraftAuthGlobals).__authEvents.releaseCleanup();});
  }else if(event==='unmount-during-eligibility'){
   await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.holdEligibility=true;w.__authEvents.emit(w.__authDraft.owner);});await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.eligibilityEntered);
   await page.evaluate(()=>{(globalThis as unknown as DraftAuthGlobals).__authRoot.unmount();});await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authDraft.clear());await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.releaseEligibility());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   expect(await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;try{await d.save(d.owner,'오래된 합성 쓰기');return false}catch{return true}})).toBe(true);
  }else if(event==='relogin-during-logout'){
   await page.evaluate(()=>{(globalThis as unknown as DraftAuthGlobals).__authEvents.holdCleanup=true;(globalThis as unknown as DraftAuthGlobals).__pendingLogout=(globalThis as unknown as DraftAuthGlobals).__authDraft.signOut();});await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.cleanupEntered);
   await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.emit((globalThis as unknown as DraftAuthGlobals).__authDraft.owner));await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;await d.save(d.owner,'다시 로그인한 합성 초안');});
   await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.releaseCleanup());expect(await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__pendingLogout.then(()=>false,e=>e.code==='AUTH_LOGOUT_SUPERSEDED'))).toBe(true);await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
   expect(await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return (await d.read(d.owner))?.content==='다시 로그인한 합성 초안';})).toBe(true);
  }else{
   await page.evaluate(event=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;(globalThis as unknown as DraftAuthGlobals).__authEvents.emit(event==='sign-out'?null:d.other);},event);await browserExpect(output).toHaveText(event==='sign-out'?'signed-out':'22222222-2222-4222-8222-222222222222');
   await browserExpect.poll(()=>page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return await d.read(d.owner)===null;})).toBe(true);
   expect(await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;try{await d.save(d.owner,'오래된 합성 쓰기');return false}catch{return true}})).toBe(true);
  }
  expect(errors).toEqual([]);
 }finally{await browser.close();}
},20000);

for(const suspended of [false,true])for(const event of ['other-owner','same-owner-relogin','logout-pending'])test(`AuthProvider ${suspended?'frozen':'active'} tab resumes ${event} without SDK events`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):r.abort());
  const a=await context.newPage(),b=await context.newPage();const source=await bundle();
  for(const p of [a,b]){await p.goto('https://draft-auth.test/mypage/profile');await p.addScriptTag({content:source});await browserExpect(p.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');}
  await a.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;await d.save(d.owner,'이전 탭 합성 초안');});
  await a.locator('input').fill('이전 세션의 미저장 합성 입력');
  const cdp=await context.newCDPSession(a);if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  if(event==='logout-pending'){
   // The shared SDK session has not disappeared yet, but draft authority has
   // already been revoked. A focus event must not undo the in-flight logout.
   await b.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authDraft.clear());
  }else{
   await b.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.emit(null));await browserExpect(b.locator('output')).toHaveText('signed-out');
   await browserExpect.poll(()=>b.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return await d.read(d.owner)===null;})).toBe(true);
   await b.evaluate(event=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.emit(event==='other-owner'?w.__authDraft.other:w.__authDraft.owner);},event);
   await browserExpect(b.locator('output')).toHaveText(event==='other-owner'?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111');
   await b.evaluate(async event=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;await d.save(event==='other-owner'?d.other:d.owner,'다른 탭 새 세션 초안');},event);
  }
  if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'active'});
  await a.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await browserExpect(a.locator('output')).toHaveText(event==='logout-pending'?'signed-out':event==='other-owner'?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111');
  if(event!=='logout-pending')await browserExpect(a.locator('input')).toHaveValue('');
  if(event==='logout-pending')expect(await a.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;try{await d.save(d.owner,'늦은 합성 초안');return false}catch{return true}})).toBe(true);
  else expect(await a.evaluate(async event=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return (await d.read(event==='other-owner'?d.other:d.owner))?.content;},event)).toBe('다른 탭 새 세션 초안');
 }finally{await browser.close();}
},20000);

for (const suspended of [false, true]) test(`${suspended ? 'frozen' : 'active'} resume admits B after A cleanup without reviving A`, async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().resourceType() === 'document' ? route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}) : route.abort());
  const a = await context.newPage(), b = await context.newPage();
  const source = await bundle();
  for (const page of [a, b]) {
   await page.goto('https://draft-auth.test/mypage/profile');
   await page.addScriptTag({content:source});
   await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  }
  const cdp = await context.newCDPSession(a);
  if (suspended) await cdp.send('Page.setWebLifecycleState', {state:'frozen'});
  // The new SDK session is B. Only A's cleanup marker reaches this document;
  // no SIGNED_IN event is replayed after that marker supersedes publication.
  await b.evaluate(async () => {
   const w = globalThis as unknown as DraftAuthGlobals;
   w.__authEvents.storeOnly(w.__authDraft.other);
   await w.__authDraft.clear();
  });
  if (suspended) await cdp.send('Page.setWebLifecycleState', {state:'active'});
  await a.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})));
  await browserExpect(a.locator('output')).toHaveText('22222222-2222-4222-8222-222222222222');
  expect(await a.evaluate(async () => {
   const d = (globalThis as unknown as DraftAuthGlobals).__authDraft;
   await d.save(d.other, '새 소유자의 합성 초안');
   try { await d.save(d.owner, '삭제된 소유자의 늦은 쓰기'); return false; } catch { return true; }
  })).toBe(true);
 } finally { await browser.close(); }
}, 20000);

for (const nextOwner of ['other-owner', 'same-owner-renewal'] as const) test(`late HTTP logout cannot revoke ${nextOwner}`, async () => {
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page = await browser.newPage();
  let releaseHttp: (() => Promise<void>) | undefined;
  await page.route('**/*', async route => {
   if (route.request().resourceType() === 'document') return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
   if (route.request().url().endsWith('/api/auth/logout')) { releaseHttp = () => route.fulfill({status:200,body:'{}'}); return; }
   return route.abort();
  });
  await page.goto('https://draft-auth.test/mypage/profile'); await page.addScriptTag({content:await bundle()});
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(() => { const w=globalThis as unknown as DraftAuthGlobals; w.__pendingLogout=w.__authDraft.signOut(); });
  await browserExpect.poll(() => Boolean(releaseHttp)).toBe(true);
  const id = await page.evaluate(next => { const w=globalThis as unknown as DraftAuthGlobals; const id=next==='other-owner'?w.__authDraft.other:w.__authDraft.owner; w.__authEvents.emit(id); return id; },nextOwner);
  await browserExpect(page.locator('output')).toHaveText(id);
  await page.evaluate(async id => { await (globalThis as unknown as DraftAuthGlobals).__authDraft.save(id,'지연 HTTP 이후 새 세션 합성 초안'); },id);
  await releaseHttp!(); expect(await page.evaluate(() => (globalThis as unknown as DraftAuthGlobals).__pendingLogout.then(()=>false,e=>e.code==='AUTH_LOGOUT_SUPERSEDED'))).toBe(true);
  await browserExpect(page.locator('output')).toHaveText(id);
  expect(await page.evaluate(async id => (await (globalThis as unknown as DraftAuthGlobals).__authDraft.read(id))?.content,id)).toBe('지연 HTTP 이후 새 세션 합성 초안');
 } finally { await browser.close(); }
},20000);


test('old same-account eligibility rejection cannot acquire the renewed session draft epoch', async () => {
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage();
  await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):r.abort());
  await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});
  const output=page.locator('output');await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.holdEligibility=true;w.__authEvents.rejectEligibility=true;w.__authDraft.refresh();});
  await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.eligibilityEntered);
  await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.emit(null));await browserExpect(output).toHaveText('signed-out');
  await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.emit(w.__authDraft.owner);});await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;await w.__authDraft.save(w.__authDraft.owner,'새 세션에서 보존할 합성 문장');w.__authEvents.releaseEligibility();});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  expect(await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;return (await d.read(d.owner))?.content;})).toBe('새 세션에서 보존할 합성 문장');
 } finally {await browser.close();}
},20000);


for (const composer of ['submission','edit','review','new-review'] as const) test(`blocked authenticated ${composer} composer requires a verified ownership retry before editing`, async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const script=await bundle(composer);
  await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root"></div><script>'+script.replaceAll('</script','<\\/script')+'</script>'}):r.request().url().endsWith('/api/auth/logout')?r.fulfill({status:200,body:'{}'}):r.fulfill({status:503,body:'{}'}));
  await page.goto('https://draft-auth.test/mypage/profile');const output=page.locator('output');
  try { await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111'); } catch(error) { if(errors.length)throw new Error('SYNTHETIC_FIXTURE_RENDER:'+errors.join(';'));throw error; }
  if(errors.length)throw new Error('SYNTHETIC_FIXTURE_RENDER:'+errors.join(';'));
  await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.failCleanup=true;w.__pendingLogout=w.__authDraft.signOut();});
  await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__pendingLogout);await browserExpect(output).toHaveText('signed-out');
  await page.evaluate(()=>{const w=globalThis as unknown as DraftAuthGlobals;w.__authEvents.emit(w.__authDraft.owner);});await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  const retry=page.getByRole('button',{name:'임시 저장 다시 확인',exact:true});
  await browserExpect(retry).toBeVisible();
  await browserExpect(page.locator('input:not([type="file"]):visible:enabled,textarea:visible:enabled')).toHaveCount(0);
  await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.failCleanup=false);
  await Promise.all([page.waitForEvent('load'),retry.click()]);
  await browserExpect(output).toHaveText('11111111-1111-4111-8111-111111111111');
  await browserExpect(retry).toHaveCount(0);
  if(composer!=='new-review')await browserExpect.poll(()=>page.locator('input:not([type="file"]):visible:enabled,textarea:visible:enabled').count()).toBeGreaterThan(0);
  else await page.evaluate(async()=>{const d=(globalThis as unknown as DraftAuthGlobals).__authDraft;await d.save(d.owner,'권한 재확인 후 합성 초안');});
  expect(errors).toEqual([]);
 }finally{await browser.close();}
},20000);

for(const transition of ['pagehide','beforeunload'] as const)test(`${transition} abandons a delayed eligibility rejection and pageshow restores the same draft`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.request().resourceType()==='document'?r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):r.abort());
  await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;await w.__authDraft.save(w.__authDraft.owner,'이동 전 보존할 합성 초안');w.__authEvents.rejectEligibility=true;w.__authEvents.holdEligibility=true;w.__authEvents.emit(w.__authDraft.owner);});
  await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.eligibilityEntered);
  await page.evaluate(transition=>{window.dispatchEvent(new PageTransitionEvent(transition,{persisted:true}));(globalThis as unknown as DraftAuthGlobals).__authEvents.releaseEligibility();},transition);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  expect(await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;return(await w.__authDraft.read(w.__authDraft.owner))?.content})).toBe('이동 전 보존할 합성 초안');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  expect(await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;return(await w.__authDraft.publicRead() as {content:string})?.content})).toBe('이동 전 보존할 합성 초안');
 }finally{await browser.close();}
},15000);

for(const logoutTransition of ['pagehide','beforeunload'] as const)test(`${logoutTransition} preserves an explicitly requested logout and its draft deletion`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  let release:()=>void=()=>{};let entered=false;const gate=new Promise<void>(resolve=>release=resolve);
  const page=await browser.newPage();await page.route('**/*',async r=>{if(r.request().url().endsWith('/api/auth/logout')){entered=true;await gate;return r.fulfill({status:200,body:'{}'});}return r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});});
  await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;await w.__authDraft.save(w.__authDraft.owner,'명시적 로그아웃으로 삭제할 합성 초안');w.__pendingLogout=w.__authDraft.signOut();});
  await browserExpect.poll(()=>entered).toBe(true);await page.evaluate(transition=>window.dispatchEvent(new PageTransitionEvent(transition,{persisted:true})),logoutTransition);release();
  await page.evaluate(()=>(globalThis as unknown as DraftAuthGlobals).__pendingLogout);
  expect(await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;return await w.__authDraft.read(w.__authDraft.owner);})).toBeNull();
  await browserExpect(page.locator('output')).toHaveText('signed-out');
 }finally{await browser.close();}
},15000);

test('cross-document navigation starts before pagehide and canceled navigation revalidates without deleting drafts',async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));await page.goto('https://draft-auth.test/mypage/profile');await page.addScriptTag({content:await bundle()});
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;await w.__authDraft.save(w.__authDraft.owner,'취소한 이동 뒤 보존할 합성 초안');w.__authEvents.rejectEligibility=true;w.__authEvents.holdEligibility=true;w.__authEvents.emit(w.__authDraft.owner);});
  await page.waitForFunction(()=>(globalThis as unknown as DraftAuthGlobals).__authEvents.eligibilityEntered);
  await page.evaluate(()=>{const io=globalThis as unknown as {__navigationAbort:AbortController;navigation:EventTarget};io.__navigationAbort=new AbortController();const e=new Event('navigate');Object.defineProperties(e,{destination:{value:{sameDocument:false}},signal:{value:io.__navigationAbort.signal}});io.navigation.dispatchEvent(e);(globalThis as unknown as DraftAuthGlobals).__authEvents.releaseEligibility();});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
  expect(await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;return(await w.__authDraft.read(w.__authDraft.owner))?.content})).toBe('취소한 이동 뒤 보존할 합성 초안');
  await page.evaluate(()=>(globalThis as unknown as {__navigationAbort:AbortController}).__navigationAbort.abort());
  await browserExpect(page.locator('output')).toHaveText('11111111-1111-4111-8111-111111111111');
  expect(await page.evaluate(async()=>{const w=globalThis as unknown as DraftAuthGlobals;return(await w.__authDraft.publicRead() as {content:string})?.content})).toBe('취소한 이동 뒤 보존할 합성 초안');
 }finally{await browser.close();}
},15000);
