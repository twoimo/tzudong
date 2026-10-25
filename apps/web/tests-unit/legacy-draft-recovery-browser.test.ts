import {test,expect} from 'bun:test';
import {chromium,expect as browserExpect,type Page} from '@playwright/test';
import {bundle,type TabFixture} from './fixtures/draft-mixed-fixture';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const kinds=['review','submission','edit'];

test('review completion cleans its captured legacy revision even after the current revision was replaced', async () => {
 const f=await setup();try{
  const current=await f.page(false);
  await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());
  await save(current,'review','제출할 합성 리뷰 X');
  await current.evaluate(async()=>{
   const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('tzudong-review-drafts');request.onsuccess=()=>resolve(request.result);});
   const transaction=db.transaction('review-drafts','readwrite');
   const store=transaction.objectStore('review-drafts');
   const request=store.get(['v3-11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333']);
   request.onsuccess=()=>store.put({...request.result,userId:'v2-11111111-1111-4111-8111-111111111111'});
   await new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});db.close();
  });
  await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());
  await save(current,'review','다른 작성기의 새 합성 리뷰 Y');
  expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect((await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',true)))?.content).toBe('다른 작성기의 새 합성 리뷰 Y');
  expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('review',false,'v2-11111111-1111-4111-8111-111111111111'))).toBeNull();
  await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.prepareReviewRemoval());
  expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.finishReviewRemoval())).toBe(true);
  expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('review'))).toBe(0);
 }finally{await f.browser.close();}
},20000);
async function setup(){
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
 const page=async(legacy:boolean,ui=false)=>{const p=await context.newPage();await p.goto('https://draft-recovery.test/');await p.addScriptTag({content:await bundle(legacy?'v6':null,ui)});return p;};
 return {browser,context,page};
}
async function save(p:Page,kind:string,text:string,id=owner){await p.evaluate(({kind,text,id})=>(globalThis as unknown as TabFixture).__tab.save(kind,text,id),{kind,text,id});}
for (const kind of kinds) test(`${kind} v2 drafts require explicit recovery and retain their original expiry`, async () => {
 const f=await setup();try {
  const page=await f.page(false);await page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(page,kind,'직전 버전 합성 초안');
  const before=await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);
  await page.evaluate(async ({kind,owner})=>{
   const name=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts';
   const store=kind==='review'?'review-drafts':kind==='submission'?'submission-drafts':'edit-request-drafts';
   const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('FIXTURE_OPEN_FAILED'));});
   const target=kind==='submission'?'new':'33333333-3333-4333-8333-333333333333';
   const tx=db.transaction(store,'readwrite');const request=tx.objectStore(store).get(['v3-'+owner,target]);
   request.onsuccess=()=>{tx.objectStore(store).put({...request.result,userId:'v2-'+owner});tx.objectStore(store).delete(['v3-'+owner,target]);};
   await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Error('FIXTURE_MOVE_FAILED'));});db.close();
  },{kind,owner});
  expect(await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();
  expect(await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(1);
  const after=await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);
  expect(after?.savedAt).toBe(before?.savedAt);expect(after?.expiresAt).toBe(before?.expiresAt);
  expect(await page.evaluate(({kind,owner})=>(globalThis as unknown as TabFixture).__tab.data(kind,false,'v2-'+owner),{kind,owner})).toBeNull();
  await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.remove(kind),kind);
  expect(await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);
 } finally {await f.browser.close();}
},20000);
for(const kind of kinds)test(`${kind} recovery is explicit, preserves expiry and never overwrites current text`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'이전 버전 합성 원문');
  const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());const before=await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind);expect(before).not.toBeNull();
  expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(1);
  const after=await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind);expect(after?.savedAt).toBe(before?.savedAt);expect(after?.expiresAt).toBe(before?.expiresAt);expect(after?.userId).toBe('v3-'+owner);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).toBeNull();
  expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);await save(current,kind,'현재 버전의 새 합성 원문');await save(old,kind,'늦게 수정된 이전 버전 원문');
  expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('현재 버전의 새 합성 원문');await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('현재 버전의 새 합성 원문');
 }finally{await f.browser.close();}
},20000);
for(const kind of kinds)test(`${kind} recovery rejects the previous account and its cleanup preserves another owner`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'이전 계정의 합성 원문');
  const current=await f.page(false);await current.evaluate(id=>(globalThis as unknown as TabFixture).__tab.activate(id),other);await save(current,kind,'다른 계정의 새 합성 원문',other);
  expect(await current.evaluate(async kind=>{try{await (globalThis as unknown as TabFixture).__tab.recover(kind);return false}catch{return true}},kind)).toBe(true);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();
  await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());const row=await current.evaluate(({kind,other})=>(globalThis as unknown as TabFixture).__tab.data(kind,true,other),{kind,other});expect(row?.userId).toBe('v3-'+other);expect(row?.content??row?.name??row?.restaurant_name).toBe('다른 계정의 새 합성 원문');
  await save(old,kind,'구버전이 되살린 이전 계정 입력');expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind).then(()=>'',error=>error.message),kind)).toBe('DRAFT_READ_UNAVAILABLE');
 }finally{await f.browser.close();}
},20000);
for(const kind of kinds)test(`${kind} delayed recovery cannot import into a replacement session`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'가져오기 전 합성 원문');const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.start(kind,'recover'),kind);await current.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);
  const replacement=await f.page(false);await replacement.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());await replacement.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(replacement,kind,'새 세션의 합성 원문');await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.pending)).toBe(false);expect(await replacement.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('새 세션의 합성 원문');
 }finally{await f.browser.close();}
},20000);
test('actual profile recovery control imports all three stores only after the user action',async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());for(const kind of kinds)await save(old,kind,'명시적으로 가져올 합성 초안');const current=await f.page(false,true);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());
  for(const kind of kinds)expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();await current.getByRole('button',{name:'이전 버전 초안 가져오기',exact:true}).click();await browserExpect(current.getByRole('status')).toContainText('3개 초안을 가져왔습니다.');for(const kind of kinds)expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('명시적으로 가져올 합성 초안');
 }finally{await f.browser.close();}
},20000);

for(const kind of kinds)test(`${kind} re-login never automatically restores a legacy write resurrected after logout`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'로그아웃 이전 합성 입력');const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'구버전이 뒤늦게 쓴 합성 입력');expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).not.toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.publicRead(kind),kind)).toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();
 }finally{await f.browser.close();}
},20000);
for(const kind of kinds)test(`${kind} failed legacy import aborts the transaction and retries without partial copies`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'첫 번째 이전 합성 입력');
  await old.evaluate(async kind=>{const name=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts',store=kind==='review'?'review-drafts':kind==='submission'?'submission-drafts':'edit-request-drafts';const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result)});const tx=db.transaction(store,'readwrite');const s=tx.objectStore(store);const r=s.get(['11111111-1111-4111-8111-111111111111',kind==='submission'?'new':'33333333-3333-4333-8333-333333333333']);r.onsuccess=()=>{const row=r.result;if(kind==='submission')row.submissionMode='request';else row.restaurantId='44444444-4444-4444-8444-444444444444';s.put(row)};await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close()},kind);
  const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());expect(await current.evaluate(async kind=>{const original=IDBObjectStore.prototype.put;let writes=0;IDBObjectStore.prototype.put=function(value,key){if(String(value.userId).startsWith('v3-')&&++writes===2)throw new DOMException('synthetic','QuotaExceededError');return original.call(this,value,key)};try{await (globalThis as unknown as TabFixture).__tab.recover(kind);return false}catch{return true}finally{IDBObjectStore.prototype.put=original}},kind)).toBe(true);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).not.toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(2);
 }finally{await f.browser.close();}
},20000);
for(const kind of kinds)for(const invalid of ['expired','media'])test(`${kind} recovery excludes ${invalid} legacy records`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'복원하면 안 되는 이전 합성 입력');
  await old.evaluate(async({kind,invalid})=>{const name=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts',store=kind==='review'?'review-drafts':kind==='submission'?'submission-drafts':'edit-request-drafts';const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result)});const tx=db.transaction(store,'readwrite');const s=tx.objectStore(store);const r=s.get(['11111111-1111-4111-8111-111111111111',kind==='submission'?'new':'33333333-3333-4333-8333-333333333333']);r.onsuccess=()=>{const row=r.result;if(invalid==='expired')row.expiresAt=0;else row.verificationPhoto='data:image/png;base64,SYNTHETIC';s.put(row)};await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close()},{kind,invalid});
  const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();
 }finally{await f.browser.close();}
},20000);
test('actual recovery control reports partial failure and safely retries only missing copies',async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());for(const kind of kinds)await save(old,kind,'부분 실패 후 재시도할 합성 입력');const current=await f.page(false,true);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await current.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='review-drafts'&&String(value.userId).startsWith('v3-')){IDBObjectStore.prototype.put=original;throw new DOMException('synthetic','QuotaExceededError')}return original.call(this,value,key)}});
  const button=current.getByRole('button',{name:'이전 버전 초안 가져오기',exact:true});await button.click();await browserExpect(current.getByRole('status')).toContainText('일부 초안은 가져오지 못했습니다.');await button.click();await browserExpect(current.getByRole('status')).toContainText('1개 초안을 가져왔습니다.');for(const kind of kinds)expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('부분 실패 후 재시도할 합성 입력');
 }finally{await f.browser.close();}
},20000);

for(const kind of ['review','edit'])test(`${kind} legacy recovery preserves the current owner's existing twenty-row limit`,async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,kind,'상한 때문에 보존할 이전 합성 초안');const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(current,kind,'새 버전 합성 상한 fixture');
  await current.evaluate(async kind=>{const dbName=kind==='review'?'tzudong-review-drafts':'tzudong-edit-request-drafts',store=kind==='review'?'review-drafts':'edit-request-drafts';const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open(dbName);r.onsuccess=()=>resolve(r.result)});const tx=db.transaction(store,'readwrite'),s=tx.objectStore(store),key=['v3-11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'];const r=s.get(key);r.onsuccess=()=>{const row=r.result;s.delete(key);for(let i=0;i<20;i++)s.put({...row,restaurantId:'synthetic-'+i})};await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close()},kind);
  expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.recover(kind),kind)).toBe(0);expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,true),kind)).toBeNull();expect(await current.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.data(kind,false),kind)).not.toBeNull();
 }finally{await f.browser.close();}
},20000);
test('recovery UI suppresses an old result after an account change during a held import',async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());for(const kind of kinds)await save(old,kind,'계정 전환 전 가져오기 합성 입력');const current=await f.page(false,true);await current.evaluate(()=>{const t=(globalThis as unknown as TabFixture).__tab;t.activate();t.hold='tzudong-review-drafts'});await current.getByRole('button',{name:'이전 버전 초안 가져오기',exact:true}).click();await current.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);
  const replacement=await f.page(false);await replacement.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());await replacement.evaluate(id=>(globalThis as unknown as TabFixture).__tab.activate(id),other);await save(replacement,'review','다른 계정의 새 합성 리뷰',other);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());await browserExpect(current.getByRole('button',{name:'이전 버전 초안 가져오기',exact:true})).toBeEnabled();await browserExpect(current.getByRole('status')).toHaveText('');const row=await replacement.evaluate(id=>(globalThis as unknown as TabFixture).__tab.data('review',true,id),other);expect(row?.content).toBe('다른 계정의 새 합성 리뷰');
 }finally{await f.browser.close();}
},20000);

test('legacy recovery revalidates the record byte limit after adding the owner namespace',async()=>{
 const f=await setup();try{
  const old=await f.page(true);await old.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await save(old,'submission','바이트 경계의 이전 합성 초안');
  const bytes=await old.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('tzudong-submission-drafts');r.onsuccess=()=>resolve(r.result)});const tx=db.transaction('submission-drafts','readwrite'),s=tx.objectStore('submission-drafts'),r=s.get(['11111111-1111-4111-8111-111111111111','new']);let bytes=0;r.onsuccess=()=>{const row=r.result;row.restaurant_name='가'.repeat(200);row.address='나'.repeat(500);row.description='';const base=new TextEncoder().encode(JSON.stringify(row)).byteLength;const korean=Math.floor((8191-base)/3);row.description='다'.repeat(korean)+'a'.repeat(8191-base-3*korean);bytes=new TextEncoder().encode(JSON.stringify(row)).byteLength;if(row.description.length>2000)throw Error('BOUNDARY_FIXTURE_INVALID');s.put(row)};await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close();return bytes});expect(bytes).toBe(8191);
  const current=await f.page(false);await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.recover('submission'))).toBe(0);expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('submission',true))).toBeNull();expect(await current.evaluate(()=>(globalThis as unknown as TabFixture).__tab.data('submission',false))).not.toBeNull();
 }finally{await f.browser.close();}
},20000);
