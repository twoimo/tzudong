import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

interface DraftRaceGlobals {
 __draftRaceIO:{entered:boolean;release():void};
 __race(kind:string):Promise<void>;__clear():Promise<boolean>;
 __readback(kind:string):Promise<{deleted:boolean;otherPreserved:boolean}>;
 __lateCleanup(kind:string,single:boolean):Promise<void>;__renew(kind:string):Promise<void>;
 __renewAndWrite(kind:string):Promise<void>;__fresh(kind:string):Promise<boolean>;
 __expiredRead:Promise<unknown>;__startRead(kind:string):Promise<void>;__replaceExpired(kind:string):Promise<void>;__pendingDraftSave:Promise<unknown>;__pendingCleanup:Promise<unknown>;
}
const root = join(import.meta.dir, '..');
async function bundle() {
  const entry = `import * as review from './lib/reviewDraftDB';import * as submission from './lib/submissionDraftDB';import * as edit from './lib/editRequestDraftDB';import {clearBrowserDraftsForUser} from './lib/privacy/browser-draft-cleanup';import {activateBrowserDraftOwner,beginBrowserDraftCleanup} from './lib/privacy/browser-draft-lifecycle';
    const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', restaurant='33333333-3333-4333-8333-333333333333';
    let now=Date.now();Date.now=()=>now;const io=globalThis.__draftRaceIO={hold:null,holdRead:null,entered:false,release:()=>{}};
    const stores={review,submission,edit};
    const input=(kind,userId,text)=>kind==='review'?{userId,restaurantId:restaurant,visitedDate:'2026-10-20',visitedTime:'12:00',categories:['분식'],content:text}:kind==='submission'?{userId,submissionMode:'new',restaurant_name:text,address:'',phone:'',categories:[],youtube_link:'',description:''}: {userId,restaurantId:restaurant,name:text,address:'',phone:'',category:[],youtube_reviews:[]};
    const read=(kind,userId)=>stores[kind].getDraft(userId,kind==='submission'?'new':restaurant);
    const physical=async(kind,userId)=>{const name=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts',store=kind==='review'?'review-drafts':kind==='submission'?'submission-drafts':'edit-request-drafts';const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('physical_read_failed'));});const row=await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(['v3-'+userId,kind==='submission'?'new':restaurant]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('physical_read_failed'));});db.close();return row??null;};
    globalThis.__race=async kind=>{
      await stores[kind].saveDraft(input(kind,other,'다른 합성 계정'));
      io.hold=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts';
      globalThis.__pendingDraftSave=stores[kind].saveDraft(input(kind,owner,'삭제 뒤 돌아오면 안 되는 합성 초안')).then(()=>true,()=>false);
    };
    globalThis.__clear=async()=>{const result=await clearBrowserDraftsForUser(owner);return Object.values(result).every(Boolean);};
    globalThis.__renew=async kind=>{activateBrowserDraftOwner(owner);await stores[kind].saveDraft(input(kind,owner,'새 합성 세션 초안'));};
    globalThis.__lateCleanup=async(kind,single)=>{
      await stores[kind].saveDraft(input(kind,owner,'이전 합성 세션 초안'));
      io.hold=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts';
      globalThis.__pendingCleanup=single?stores[kind].deleteDraft(owner,kind==='submission'?'new':restaurant):clearBrowserDraftsForUser(owner);
    };
    globalThis.__renewAndWrite=async kind=>{beginBrowserDraftCleanup(owner);activateBrowserDraftOwner(owner);await stores[kind].saveDraft(input(kind,owner,'새 합성 세션 초안'));};
    globalThis.__fresh=async kind=>{const d=await physical(kind,owner);return (d?.content??d?.restaurant_name??d?.name)==='새 합성 세션 초안';};
    globalThis.__startRead=async kind=>{await stores[kind].saveDraft(input(kind,owner,'만료될 합성 초안'));io.holdRead=kind==='review'?'tzudong-review-drafts':kind==='submission'?'tzudong-submission-drafts':'tzudong-edit-request-drafts';globalThis.__expiredRead=read(kind,owner).then(value=>({status:"read",value}),error=>({status:"unavailable",code:error.message}));};
    globalThis.__replaceExpired=async kind=>{now+=8*24*60*60*1000;await stores[kind].saveDraft(input(kind,owner,'새 합성 세션 초안'));};
    globalThis.__readback=async kind=>{await globalThis.__pendingDraftSave;return {deleted:await physical(kind,owner)===null,otherPreserved:await physical(kind,other)!==null};};`;
  const idb = Bun.resolveSync('idb',root);
  const built = await Bun.build({entrypoints:['race-fixture'],target:'browser',format:'iife',write:false,plugins:[{name:'race',setup(builder){
    if(process.env.TZUDONG_DRAFT_BASELINE_DIR)builder.onLoad({filter:/\.(ts|tsx)$/},args=>{const path=join(process.env.TZUDONG_DRAFT_BASELINE_DIR!,args.path.slice(root.length+1));if(existsSync(path))return {contents:readFileSync(path,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};});
    builder.onResolve({filter:/^race-fixture$/},()=>({path:'entry',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:entry,loader:'ts',resolveDir:root}));
    builder.onResolve({filter:/^idb$/},()=>({path:'idb',namespace:'delayed-open'}));builder.onLoad({filter:/.*/,namespace:'delayed-open'},()=>({contents:`export * from '${idb}';import {openDB as open} from '${idb}';export async function openDB(name,...args){const db=await open(name,...args);const io=globalThis.__draftRaceIO;if(io?.hold===name){io.hold=null;io.entered=true;await new Promise(resolve=>{io.release=resolve;});}const gate=async row=>{if(io?.holdRead===name){io.holdRead=null;io.entered=true;await new Promise(resolve=>io.release=resolve);}return row;};const bind=(target,key)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;};return new Proxy(db,{get(target,key){if(key==='get')return async(...args)=>gate(await target.get(...args));if(key==='transaction')return(...args)=>{const tx=target.transaction(...args);return new Proxy(tx,{get(t,k){if(k==='store'){const store=t.store;return new Proxy(store,{get(st,sk){if(sk==='get')return async(...input)=>gate(await st.get(...input));return bind(st,sk);}});}return bind(t,k);}});};return bind(target,key);}});}`,loader:'ts',resolveDir:root}));
  }}]});
  if(!built.success)throw new Error(built.logs.map(String).join('\n'));
  return built.outputs[0].text();
}
for(const kind of ['review','submission','edit'])test(`logout cleanup prevents a delayed ${kind} write from resurrecting the old owner's draft`,async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try{
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><div></div>'}):route.abort());await page.goto('https://draft-race.test/');await page.addScriptTag({content:await bundle()});
    await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__race(kind),kind);await page.waitForFunction(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.entered);
    const cleanup=await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__clear());expect(cleanup).toBe(true);
    await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.release());
    const result=await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__readback(kind),kind);expect(result).toEqual({deleted:true,otherPreserved:true});expect(errors).toEqual([]);
  }finally{await browser.close();}
},20000);

for(const kind of ['review','submission','edit'])for(const operation of ['delete-all','delete-one','old-save'])test(`same owner re-login protects fresh ${kind} text from delayed ${operation}`,async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div></div>'}));await page.goto('https://draft-race.test/');await page.addScriptTag({content:await bundle()});
    if(operation==='old-save'){
      await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__race(kind),kind);await page.waitForFunction(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.entered);await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__clear());await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__renew(kind),kind);
    }else{
      await page.evaluate(({kind,operation})=>(globalThis as unknown as DraftRaceGlobals).__lateCleanup(kind,operation==='delete-one'),{kind,operation});await page.waitForFunction(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.entered);await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__renewAndWrite(kind),kind);
    }
    await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.release());await page.evaluate(async(operation)=>{await (globalThis as unknown as DraftRaceGlobals)[operation==='old-save'?'__pendingDraftSave':'__pendingCleanup'];},operation);
    expect(await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__fresh(kind),kind)).toBe(true);
  }finally{await browser.close();}
},20000);

for(const kind of ['review','submission','edit'])test(`expired ${kind} read cannot delete a fresh replacement at the same key`,async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div></div>'}));await page.goto('https://draft-race.test/');await page.addScriptTag({content:await bundle()});await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__startRead(kind),kind);await page.waitForFunction(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.entered);await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__replaceExpired(kind),kind);await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__draftRaceIO.release());expect(await page.evaluate(()=>(globalThis as unknown as DraftRaceGlobals).__expiredRead)).toEqual({status:'unavailable',code:'DRAFT_READ_UNAVAILABLE'});expect(await page.evaluate(kind=>(globalThis as unknown as DraftRaceGlobals).__fresh(kind),kind)).toBe(true);
 }finally{await browser.close();}
},20000);
