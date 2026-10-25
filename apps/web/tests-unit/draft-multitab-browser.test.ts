import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
const root=join(import.meta.dir,'..');
interface TabFixture {
 __tab:{hold:string|null;entered:boolean;release():void;pending:Promise<unknown>;result:unknown;save(kind:string,text:string):Promise<unknown>;read(kind:string):Promise<unknown>;clear():Promise<unknown>;activate():Promise<unknown>;start(kind:string,operation:string):Promise<void>};
}
async function bundle(){
 const entry=`import * as review from './lib/reviewDraftDB';import * as submission from './lib/submissionDraftDB';import * as edit from './lib/editRequestDraftDB';import {clearBrowserDraftsForUser} from './lib/privacy/browser-draft-cleanup';import {activateBrowserDraftOwner} from './lib/privacy/browser-draft-lifecycle';
 const uid='11111111-1111-4111-8111-111111111111',rid='33333333-3333-4333-8333-333333333333';const stores={review,submission,edit};const names={review:'tzudong-review-drafts',submission:'tzudong-submission-drafts',edit:'tzudong-edit-request-drafts'};
 const input=(kind,text)=>kind==='review'?{userId:uid,restaurantId:rid,visitedDate:'2026-10-20',visitedTime:'12:00',categories:['분식'],content:text}:kind==='submission'?{userId:uid,submissionMode:'new',restaurant_name:text,address:'',phone:'',categories:[],youtube_link:'',description:''}:{userId:uid,restaurantId:rid,name:text,address:'',phone:'',category:[],youtube_reviews:[]};
 const tab=globalThis.__tab={hold:null,entered:false,release:()=>{},pending:Promise.resolve(),result:undefined,save:(kind,text)=>stores[kind].saveDraft(input(kind,text)),activate:()=>activateBrowserDraftOwner(uid),clear:()=>clearBrowserDraftsForUser(uid),
 async read(kind){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(names[kind]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('RAW_READ_FAILED'));});const store=kind==='review'?'review-drafts':kind==='submission'?'submission-drafts':'edit-request-drafts';const row=await new Promise(resolve=>{const r=db.transaction(store).objectStore(store).get(['v3-'+uid,kind==='submission'?'new':rid]);r.onsuccess=()=>resolve(r.result);});db.close();return row?row.content??row.restaurant_name??row.name:null;},
 async start(kind,operation){tab.hold=names[kind];tab.pending=(operation==='save'?tab.save(kind,'오래된 탭 합성 초안'):operation==='delete-one'?stores[kind].deleteDraft(uid,kind==='submission'?'new':rid):operation==='get'?stores[kind].getDraft(uid,kind==='submission'?'new':rid):operation==='get-all'?stores[kind].getAllDraftsByUser(uid):tab.clear()).then(value=>{tab.result=value;return true},()=>false);}};`;
 const idb=Bun.resolveSync('idb',root);
 const built=await Bun.build({entrypoints:['tab-fixture'],target:'browser',format:'iife',write:false,plugins:[{name:'fixture',setup(b){
  if(process.env.TZUDONG_MULTITAB_BASELINE_DIR)b.onLoad({filter:/\.(ts|tsx)$/},args=>{const path=join(process.env.TZUDONG_MULTITAB_BASELINE_DIR!,args.path.slice(root.length+1));if(existsSync(path))return {contents:readFileSync(path,'utf8'),loader:'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};});
  b.onResolve({filter:/^tab-fixture$/},()=>({path:'entry',namespace:'entry'}));b.onLoad({filter:/.*/,namespace:'entry'},()=>({contents:entry,loader:'ts',resolveDir:root}));
  b.onResolve({filter:/^idb$/},()=>({path:'idb',namespace:'held'}));b.onLoad({filter:/.*/,namespace:'held'},()=>({contents:`export * from '${idb}';import {openDB as open} from '${idb}';export async function openDB(name,...args){const db=await open(name,...args);const tab=globalThis.__tab;if(tab?.hold===name){tab.hold=null;tab.entered=true;await new Promise(resolve=>tab.release=resolve);}return db;}`,loader:'ts',resolveDir:root}));
 }}]});if(!built.success)throw new Error(built.logs.map(String).join('\n'));return built.outputs[0].text();
}
for(const suspended of [false,true])for(const kind of ['review','submission','edit'])for(const operation of ['save','delete-one','delete-all','get','get-all'])test(`two ${suspended ? 'frozen' : 'active'} tabs protect ${kind} draft from stale ${operation} after logout and re-login`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div></div>'}));const a=await context.newPage(),b=await context.newPage();const source=await bundle();for(const p of [a,b]){await p.goto('https://draft-tabs.test/');await p.addScriptTag({content:source});}
  await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await a.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'초기 합성 초안'),kind);await a.evaluate(({kind,operation})=>(globalThis as unknown as TabFixture).__tab.start(kind,operation),{kind,operation});await a.waitForFunction(()=>(globalThis as unknown as TabFixture).__tab.entered);
  const cdp=await context.newCDPSession(a);
  if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
  await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());await b.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'새 세션 합성 초안'),kind);
  if(suspended)await cdp.send('Page.setWebLifecycleState',{state:'active'});
  await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.release());await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.pending);expect(await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('새 세션 합성 초안');
  if(operation==='get')expect(await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.result)).toBeNull();
  if(operation==='get-all')expect(await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.result)).toEqual([]);
 }finally{await browser.close();}
},20000);

for(const kind of ['review','submission','edit'])test(`revoked ${kind} session stays blocked in a freshly loaded tab`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const context=await browser.newContext();await context.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));const source=await bundle();const a=await context.newPage();await a.goto('https://draft-tabs.test/');await a.addScriptTag({content:source});await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await a.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'삭제 전 합성 입력'),kind);await a.evaluate(()=>(globalThis as unknown as TabFixture).__tab.clear());
  const b=await context.newPage();await b.goto('https://draft-tabs.test/');await b.addScriptTag({content:source});expect(await b.evaluate(async kind=>{try{await (globalThis as unknown as TabFixture).__tab.save(kind,'재로딩 이전 계정 쓰기');return false}catch{return true}},kind)).toBe(true);expect(await b.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBeNull();
 }finally{await browser.close();}
},20000);
for(const kind of ['review','submission','edit'])test(`${kind} writes fail closed when shared authority is unavailable`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('https://draft-tabs.test/');await page.addScriptTag({content:await bundle()});await page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'보존할 합성 입력'),kind);
  expect(await page.evaluate(async kind=>{const original=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='tzudong-draft-authority-v3')throw new Error('SYNTHETIC_STORAGE_DENIED');return original.call(this,key)};try{await (globalThis as unknown as TabFixture).__tab.save(kind,'실패해야 할 합성 입력');return false}catch{return true}finally{Storage.prototype.getItem=original}},kind)).toBe(true);expect(await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('보존할 합성 입력');
  await page.evaluate(()=>(globalThis as unknown as TabFixture).__tab.activate());await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.save(kind,'검증 후 합성 입력'),kind);expect(await page.evaluate(kind=>(globalThis as unknown as TabFixture).__tab.read(kind),kind)).toBe('검증 후 합성 입력');
 }finally{await browser.close();}
},20000);
