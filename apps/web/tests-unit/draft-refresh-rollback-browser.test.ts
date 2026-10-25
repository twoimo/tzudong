import {test,expect,beforeAll,afterAll} from 'bun:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {chromium,type Page} from '@playwright/test';
import {bundle,type TabFixture} from './fixtures/draft-mixed-fixture';
const kinds=['review','submission','edit'];
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
async function setup(){
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
 const page=await context.newPage();await page.goto('https://draft-refresh.test/');return {browser,context,page};
}
async function load(p:Page,version:'base'|'v6'|'v7'|null,reload=false){
 if(reload)await p.reload();await p.addScriptTag({content:await bundle(version)});
 await p.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());
}
async function save(p:Page,kind:string,text:string,id=owner){await p.evaluate(({kind,text,id})=>(globalThis as unknown as TabFixture).__tab.save(kind,text,id),{kind,text,id});}
async function duplicateCurrentLegacy(p:Page,kind:string){
 // Reproduce v8's retained copy, so two-key erasure is never inferred from an empty old namespace.
 await p.evaluate(async kind=>{const names={review:['tzudong-review-drafts','review-drafts'],submission:['tzudong-submission-drafts','submission-drafts'],edit:['tzudong-edit-request-drafts','edit-request-drafts']};const [name,store]=names[kind as keyof typeof names];const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result)});const tx=db.transaction(store,'readwrite'),s=tx.objectStore(store),r=s.get(['v3-11111111-1111-4111-8111-111111111111',kind==='submission'?'new':'33333333-3333-4333-8333-333333333333']);r.onsuccess=()=>s.put({...r.result,userId:'11111111-1111-4111-8111-111111111111'});await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close();},kind);
}
for(const version of ['base','v6','v7'] as const)for(const kind of kinds)test(`${version} reload preserves committed ${kind} and explicit deletion cannot re-import it`,async()=>{
 const f=await setup();try{
  await load(f.page,version);await save(f.page,kind,'갱신 전 확정된 합성 초안');
  const before=await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind);expect(before).not.toBeNull();
  await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();
  expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(1);
  const after=await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);expect(after?.savedAt).toBe(before?.savedAt);expect(after?.expiresAt).toBe(before?.expiresAt);
  await duplicateCurrentLegacy(f.page,kind);await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.remove(kind),kind);
  expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).toBeNull();expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();
  await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);
 }finally{await f.browser.close();}
},20000);

test('submitted imported review removes its unchanged legacy revision and cannot resurrect',async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,'review','제출할 합성 리뷰');await load(f.page,null,true);
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(1);
  await duplicateCurrentLegacy(f.page,'review');await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',false))).toBeNull();
  await load(f.page,null,true);expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(0);
 }finally{await f.browser.close();}
},20000);

for(const kind of kinds)test(`all refreshed tabs remove both ${kind} namespaces and preserve other owner`,async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,kind,'갱신할 합성 원본');
  await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.start(kind,'save'),kind);await f.page.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);
  // This destroys the old document with its held continuation. No task is released in the new realm.
  await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(1);await save(f.page,kind,'갱신 후 새 합성 초안');await duplicateCurrentLegacy(f.page,kind);
  expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).not.toBeNull();expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).not.toBeNull();
  await f.page.evaluate(id=>(globalThis as unknown as TabFixture).__tab.activate(id),other);await save(f.page,kind,'다른 계정 합성 초안',other);await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());
  const cleared=await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());expect(Object.values(cleared as object)).toEqual([true,true,true]);
  for(const current of [false,true])expect(await f.page.evaluate(({kind,current})=>(globalThis as unknown as TabFixture).__tab.data(kind,current),{kind,current})).toBeNull();
  await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);expect(await f.page.evaluate(({kind,other})=>(globalThis as unknown as TabFixture).__tab.data(kind,true,other),{kind,other})).not.toBeNull();
 }finally{await f.browser.close();}
},20000);

for(const kind of kinds)test(`discard ${kind} aborts both keys on second-delete failure and retries`,async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,kind,'실패 시 보존할 합성 초안');await load(f.page,null,true);await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind);await duplicateCurrentLegacy(f.page,kind);
  await f.page.evaluate(()=>{const original=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){if(Array.isArray(key)&&key[0]==='11111111-1111-4111-8111-111111111111')throw new DOMException('Synthetic','UnknownError');return original.call(this,key)};});
  expect(await f.page.evaluate(async kind=>{try{await(globalThis as unknown as TabFixture).__tab.remove(kind);return true}catch{return false}},kind)).toBe(false);
  for(const current of [false,true])expect(await f.page.evaluate(({kind,current})=>(globalThis as unknown as TabFixture).__tab.data(kind,current),{kind,current})).not.toBeNull();
  await load(f.page,null,true);await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.remove(kind),kind);
  for(const current of [false,true])expect(await f.page.evaluate(({kind,current})=>(globalThis as unknown as TabFixture).__tab.data(kind,current),{kind,current})).toBeNull();
 }finally{await f.browser.close();}
},20000);

test('submitted review preserves a legacy revision changed after capture',async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,'review','제출에 포함된 옛 합성 원본');await load(f.page,null,true);await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'));await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());
  const old=await f.context.newPage();await old.goto('https://draft-refresh.test/');await load(old,'v6');await save(old,'review','다른 구버전 창의 새 합성 리뷰');
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect((await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',false)))?.content).toBe('다른 구버전 창의 새 합성 리뷰');expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',true))).toBeNull();
 }finally{await f.browser.close();}
},20000);

test('conditional review cleanup aborts both keys on legacy delete failure and can retry',async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,'review','원자적으로 삭제할 합성 리뷰');await load(f.page,null,true);await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'));await duplicateCurrentLegacy(f.page,'review');await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());
  await f.page.evaluate(()=>{const original=IDBObjectStore.prototype.delete;let fail=true;IDBObjectStore.prototype.delete=function(key){if(fail&&Array.isArray(key)&&key[0]==='11111111-1111-4111-8111-111111111111'){fail=false;throw new DOMException('Synthetic','UnknownError')}return original.call(this,key)};});
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(false);
  for(const current of [false,true])expect(await f.page.evaluate(current=>(globalThis as unknown as TabFixture).__tab.data('review',current),current)).not.toBeNull();
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  for(const current of [false,true])expect(await f.page.evaluate(current=>(globalThis as unknown as TabFixture).__tab.data('review',current),current)).toBeNull();
 }finally{await f.browser.close();}
},20000);

let capsuleParent:string;
let capsule:string;
beforeAll(async()=>{
 capsuleParent=mkdtempSync(join(tmpdir(),'tzudong-draft-rollback-'));capsule=join(capsuleParent,'candidate');
 const proc=Bun.spawn(['python3',join(import.meta.dir,'../scripts/prepare-draft-compatible-rollback.py'),'--base','56427320a44fdd65a86dc49e7e63d80dd9935c2e','--output',capsule],{stdout:'pipe',stderr:'pipe'});
 const stderr=await new Response(proc.stderr).text();expect(await proc.exited,stderr).toBe(0);
 const manifest=JSON.parse(readFileSync(join(capsule,'manifest.json'),'utf8'));
 for(const [path,hash] of Object.entries(manifest.files))expect(createHash('sha256').update(readFileSync(join(capsule,'files',path))).digest('hex')).toBe(hash);
 // The rollback must retain the real session and composer fences, not only a key decoder.
 for(const file of ['contexts/AuthContext.tsx','components/auth/AuthModal.tsx','components/reviews/ReviewModal.tsx','components/reviews/ReviewEditModal.tsx','components/modals/RestaurantSubmissionModal.tsx','components/modals/EditRestaurantModal.tsx'])expect(readFileSync(join(capsule,'files/apps/web',file),'utf8')).toBe(readFileSync(join(import.meta.dir,'..',file),'utf8'));
},20000);
afterAll(()=>{if(capsuleParent)rmSync(capsuleParent,{recursive:true,force:true});});
test('compatible rollback retains the complete logout boundary and cancellation callers', () => {
 const manifest=JSON.parse(readFileSync(join(capsule,'manifest.json'),'utf8'));
 for(const file of ['app/home-client.tsx','app/api/auth/logout/route.ts','lib/supabase/server.ts','lib/supabase/middleware.ts','proxy.ts','lib/auth/callback-session.ts','app/auth/callback/route.ts','app/auth/complete/page.tsx','app/api/privacy/onboarding/route.ts','lib/auth/session-cookies.ts','components/home/HomeMapUserMenu.tsx','components/home/MobileControlOverlay.tsx','components/mypage/MyPageTopActions.tsx','components/mypage/MyPageSidebar.tsx','app/mypage/mypage-layout-content.tsx','components/home/SubmissionFloatingButton.tsx']) {
  expect(Boolean(manifest.files['apps/web/'+file]),file).toBe(true);
  expect(readFileSync(join(capsule,'files/apps/web',file),'utf8')).toBe(readFileSync(join(import.meta.dir,'..',file),'utf8'));
 }
});
for (const changed of [false, true]) test(`v2 review copy cleanup preserves later edits: ${changed}`, async () => {
 const f=await setup();try {
  await load(f.page,null);await save(f.page,'review','현재 리뷰 합성 원문');
  await f.page.evaluate(async owner=>{
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('tzudong-review-drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('FIXTURE_OPEN_FAILED'));});
   const tx=db.transaction('review-drafts','readwrite');const store=tx.objectStore('review-drafts');const r=store.get(['v3-'+owner,'33333333-3333-4333-8333-333333333333']);r.onsuccess=()=>store.put({...r.result,userId:'v2-'+owner});
   await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error('FIXTURE_COPY_FAILED'));});db.close();
  },owner);
  await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());
  if(changed)await f.page.evaluate(async owner=>{
   const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('tzudong-review-drafts');r.onsuccess=()=>resolve(r.result);});const tx=db.transaction('review-drafts','readwrite');const store=tx.objectStore('review-drafts');const r=store.get(['v2-'+owner,'33333333-3333-4333-8333-333333333333']);r.onsuccess=()=>store.put({...r.result,content:'구버전에서 뒤늦게 수정한 합성 원문'});await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve();});db.close();
  },owner);
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.publicRead('review'))).toBeNull();
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(changed?1:0);
  if(changed)expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.read('review'))).toBe('구버전에서 뒤늦게 수정한 합성 원문');
 }finally{await f.browser.close();}
},20000);
for(const kind of kinds)test(`compatible rollback reads, updates and removes new ${kind}; unpatched baseline cannot read it`,async()=>{
 const f=await setup();try{
  await load(f.page,null);await save(f.page,kind,'롤백 전 새 형식 합성 초안');const before=await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);
  await load(f.page,'base',true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();
  await f.page.reload();await f.page.addScriptTag({content:await bundle(null,false,owner,join(capsule,'files/apps/web'))});await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());
  const restored=await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind) as {userId:string;content?:string;restaurant_name?:string;name?:string};expect(restored.userId).toBe(owner);expect(restored.content??restored.restaurant_name??restored.name).toBe('롤백 전 새 형식 합성 초안');
  const after=await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);expect(after?.savedAt).toBe(before?.savedAt);expect(after?.expiresAt).toBe(before?.expiresAt);
  await save(f.page,kind,'호환 롤백에서 수정한 합성 초안');await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('호환 롤백에서 수정한 합성 초안');
  await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.remove(kind),kind);for(const current of [false,true])expect(await f.page.evaluate(({kind,current})=>(globalThis as unknown as TabFixture).__tab.data(kind,current),{kind,current})).toBeNull();
 }finally{await f.browser.close();}
},20000);

test('submitted review preserves independent legacy text already changed before capture',async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,'review','가져온 합성 리뷰');await load(f.page,null,true);await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'));
  const old=await f.context.newPage();await old.goto('https://draft-refresh.test/');await load(old,'v6');await save(old,'review','캡처 전 다른 창에서 수정한 합성 리뷰');
  await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect((await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',false)))?.content).toBe('캡처 전 다른 창에서 수정한 합성 리뷰');
 }finally{await f.browser.close();}
},20000);

test('imported then edited review submission cannot re-import the original text',async()=>{
 const f=await setup();try{
  await load(f.page,'v6');await save(f.page,'review','가져와 수정할 옛 합성 리뷰');await load(f.page,null,true);expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(1);
  expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',false))).toBeNull();await save(f.page,'review','실제 제출할 새 합성 내용');await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  await load(f.page,null,true);expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(0);
 }finally{await f.browser.close();}
},20000);

for(const version of ['base','v6','v7'] as const)for(const frozen of [false,true])for(const kind of kinds)
test(`unrefreshed ${version}/${frozen?'frozen':'active'} ${kind} rewrite preserves current draft and acknowledged raw text across reload`,async()=>{
 const f=await setup();try{
  await load(f.page,version);await save(f.page,kind,'구버전에서 확정 저장한 합성 원문');const current=await f.context.newPage();await current.goto('https://draft-refresh.test/');await load(current,null);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(1);await save(current,kind,'보호할 신버전 합성 초안');
  await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.start(kind,'save'),kind);await f.page.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);const cdp=await f.context.newCDPSession(f.page);if(frozen){await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});}await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());expect(await f.page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.pending)).toBe(true);
  const acknowledged=await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind);expect(acknowledged).not.toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('보호할 신버전 합성 초안');expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);
  await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.start(kind,'save'),kind);await f.page.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);await load(f.page,null,true);
  expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).toEqual(acknowledged);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('보호할 신버전 합성 초안');
  await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.remove(kind),kind);for(const encoded of [false,true])expect(await current.evaluate(({kind,encoded})=>(globalThis as unknown as TabFixture).__tab.data(kind,encoded),{kind,encoded})).toBeNull();await load(f.page,null,true);expect(await f.page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);
 }finally{await f.browser.close();}
},20000);
