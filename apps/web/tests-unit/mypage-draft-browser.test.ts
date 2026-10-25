import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { javascriptStringLiteral } from './fixtures/javascript-string-literal';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';

(existsSync(chromeForTestingExecutable()) ? test : test.skip)('submission mode round-trip cannot recreate an explicitly discarded draft', async () => {
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await prepare(page);
    await page.getByRole('button', { name: '제보 열기', exact: true }).click();
    const field = page.getByPlaceholder('예: 명동 짜장면');
    await browserExpect(field).toBeEditable();
    await field.fill('삭제할 합성 제보 초안');
    await page.getByRole('button', { name: /쯔양에게 맛집 제보/ }).click();
    await browserExpect(field).toBeEditable();
    await browserExpect(field).toHaveValue('');
    await page.getByRole('button', { name: /쯔양이 다녀간 맛집/ }).click();
    await browserExpect(page.getByRole('button', { name: '복원하기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '삭제하고 새로 작성', exact: true }).click();
    await browserExpect(field).toBeEditable();
    await page.getByRole('button', { name: '제보 닫기', exact: true }).click();
    await browserExpect(field).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as unknown as { __readSubmission(): Promise<unknown> }).__readSubmission())).toBeNull();
    await page.getByRole('button', { name: '제보 열기', exact: true }).click();
    await browserExpect(field).toBeEditable();
    await browserExpect(page.getByRole('button', { name: '복원하기', exact: true })).toHaveCount(0);
  } finally {
    await browser.close();
  }
}, 30_000);

interface DraftFormGlobals {
 __setDraftOwner(id:string):void;__renewDraftOwner():Promise<void>;__readOwnerSubmission(owner:string,mode?:'new'|'request'):Promise<{restaurant_name:string}|null>; __seedReview(owner?:string,contentOnly?:boolean):Promise<unknown>; __readReview():Promise<{content:string}|null>; __seedReviewEdit():Promise<unknown>; __readReviewEdit():Promise<{content:string}|null>; __seedEdit(owner:string,name:string):Promise<unknown>; __readOwnerEdit(owner:string):Promise<{name:string}|null>;
 __draftUI:{target():void;leave():void};
}
const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
async function bundle(presentation: 'auto' | 'map-panel' = 'map-panel') {
  const entry = `import React,{useState,useMemo} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import {ReviewModal} from './components/reviews/ReviewModal';import {saveDraft as seedReview,getDraft as readReview} from './lib/reviewDraftDB';globalThis.__readReview=()=>readReview('fixture-owner','11111111-1111-4111-8111-111111111111');globalThis.__seedReview=(owner='fixture-owner',contentOnly=false)=>seedReview({userId:owner,restaurantId:'11111111-1111-4111-8111-111111111111',currentStep:3,visitedDate:contentOnly?'':'2026-10-20',visitedTime:contentOnly?'':'12:00',categories:contentOnly?[]:['분식'],content:'첫 식당 합성 초안 원문'});import RestaurantSubmissionModal from './components/modals/RestaurantSubmissionModal';import {EditRestaurantModal} from './components/modals/EditRestaurantModal';import {ReviewEditModal} from './components/reviews/ReviewEditModal';import {getDraft as readSubmission} from './lib/submissionDraftDB';globalThis.__readSubmission=()=>readSubmission('fixture-owner','new');globalThis.__readOwnerSubmission=(owner,mode='new')=>readSubmission(owner,mode);
  const restaurant={id:'11111111-1111-4111-8111-111111111111',name:'합성 식당'};
  import {saveDraft as seedEdit,getDraft as readEdit} from './lib/editRequestDraftDB';globalThis.__seedEdit=(owner,name)=>seedEdit({userId:owner,restaurantId:restaurant.id,name,address:'합성 주소',phone:'',category:['분식'],youtube_reviews:[{youtube_link:'https://youtu.be/AbCdEfGhI12',tzuyang_review:'합성 자료',restaurant_id:restaurant.id}],requestKind:'edit',currentStep:1});globalThis.__readOwnerEdit=owner=>readEdit(owner,restaurant.id);
  const initial={name:'합성 식당',address:'합성 주소',phone:'',category:['분식'],youtube_reviews:[],requestKind:'edit'};
  globalThis.__seedReviewEdit=()=>seedReview({userId:'fixture-owner',restaurantId:'edit_22222222-2222-4222-8222-222222222222',visitedDate:'',visitedTime:'',categories:['분식'],content:'보존할 합성 리뷰 수정 초안'});globalThis.__readReviewEdit=()=>readReview('fixture-owner','edit_22222222-2222-4222-8222-222222222222');
  const review={id:'22222222-2222-4222-8222-222222222222',restaurantId:restaurant.id,restaurantName:restaurant.name,content:'합성 기존 리뷰 본문입니다. 실제 방문 기록이 아닙니다.',categories:['분식'],foodPhotos:[]};
  globalThis.__draftIO={hold:false,started:0,release:()=>{}};globalThis.fetch=async()=>new Response('',{status:503});
  function Fixture(){const [kind,setKind]=useState(null);const [target,setTarget]=useState(0);const targetRestaurant=useMemo(()=>target?{...restaurant,id:'33333333-3333-4333-8333-333333333333'}:restaurant,[target]);const targetReview=useMemo(()=>target?{...review,id:'44444444-4444-4444-8444-444444444444',restaurantId:targetRestaurant.id}:review,[target,targetRestaurant]);globalThis.__draftUI={leave:()=>setKind(null),target:()=>setTarget(value=>value?0:1)};return <><button onClick={()=>setKind('submission')}>제보 열기</button><button onClick={()=>setKind('edit')}>수정 요청 열기</button><button onClick={()=>setKind('review')}>리뷰 수정 열기</button><button onClick={()=>setKind('new-review')}>새 리뷰 열기</button>{kind==='submission'&&<RestaurantSubmissionModal isOpen onClose={()=>setKind(null)} presentation="${presentation}"/>}{kind==='edit'&&<EditRestaurantModal isOpen onClose={()=>setKind(null)} restaurant={targetRestaurant} initialFormData={initial} presentation="map-panel"/>}{kind==='new-review'&&<ReviewModal isOpen onClose={()=>setKind(null)} restaurant={targetRestaurant} presentation="map-panel"/>}{kind==='review'&&<ReviewEditModal isOpen onClose={()=>setKind(null)} review={targetReview}/>}</>}
  createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><Fixture/></QueryClientProvider>);`;
  const inert: Record<string, string> = {
    'next/image': `import React from 'react';export default function Image({fill,unoptimized,...props}){return <img {...props}/>}`,
    'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>}`,
    'next/navigation': 'export const useRouter=()=>({push(){},replace(){},refresh(){}});',
    '@/contexts/AuthContext': `import {useSyncExternalStore} from 'react';import {activateBrowserDraftOwner} from '@/lib/privacy/browser-draft-lifecycle';import {clearBrowserDraftsForUser} from '@/lib/privacy/browser-draft-cleanup';let user={id:'fixture-owner'};const listeners=new Set();globalThis.__setDraftOwner=id=>{globalThis.__sessionOwner=id;user={id};listeners.forEach(fn=>fn());};globalThis.__renewDraftOwner=async()=>{const id=user.id;await clearBrowserDraftsForUser(id);activateBrowserDraftOwner(id);user={id};listeners.forEach(fn=>fn());};const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};export const useAuth=()=>({user:useSyncExternalStore(subscribe,()=>user)});`,
    '@/integrations/supabase/client': `export const getSupabaseBrowserClient=()=>supabase;export const commitSupabaseBrowserSession=async()=>{throw new Error('SYNTHETIC_AUTH_PUBLICATION_NOT_ALLOWED')};export const supabase={auth:{getUser:async()=>({data:{user:{id:globalThis.__sessionOwner||'fixture-owner'}}}),getSession:async()=>({data:{session:{user:{id:globalThis.__sessionOwner||'fixture-owner'}}}})},rpc(){throw new Error('REMOTE_RPC_FORBIDDEN')},from(table){const io=globalThis.__editSubmitIO;if(!io||!['restaurant_submissions','restaurant_submission_items'].includes(table))throw new Error('REMOTE_WRITE_FORBIDDEN');return {insert(){io.inserts=(io.inserts||0)+1;if(table==='restaurant_submissions')return {select(){return {single:async()=>({data:{id:'synthetic-submission'},error:null})}}};io.entered=true;return new Promise(resolve=>{io.release=()=>resolve({error:null})})}}},storage:{from(){return {upload(){throw new Error('REMOTE_MEDIA_FORBIDDEN')},list(){throw new Error('REMOTE_MEDIA_FORBIDDEN')},remove(){throw new Error('REMOTE_MEDIA_FORBIDDEN')}}}}};`,
    // This UI fixture owns account identity and draft scheduling only. Actual
    // isolated issuer/session behavior has its own native auth boundary suite.
    '@/lib/auth/isolated-browser-account': `import {supabase} from '@/integrations/supabase/client';export const readCurrentBrowserAuthUser=()=>supabase.auth.getUser();const reject=async()=>{throw new Error('SYNTHETIC_ACCOUNT_WRITE_NOT_ALLOWED')};export const createMemoryAuthClient=reject;export const updateCurrentBrowserAuthUser=reject;export const reauthenticateBrowserAccount=reject;export const changeBrowserAccountPassword=reject;`,
    '@/lib/no-toast': `export const toast={success(){},error(){},warning(){},info(){}};`,
    '@/hooks/use-toast': `export const toast=()=>{};export const useToast=()=>({toast});`,
  };
  const built = await Bun.build({ entrypoints: ['mypage-draft-fixture'], target: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'mypage-draft-fixture', setup(builder) {
    if (process.env.TZUDONG_SUBMISSION_DISCARD_BASELINE) builder.onLoad({filter:/RestaurantSubmissionModal\.tsx$/},()=>({contents:readFileSync(process.env.TZUDONG_SUBMISSION_DISCARD_BASELINE!,'utf8'),loader:'tsx',resolveDir:join(root,'components/modals')}));
    if (process.env.TZUDONG_EDIT_SUBMIT_BASELINE) builder.onLoad({filter:/EditRestaurantModal\.tsx$/},()=>({contents:readFileSync(process.env.TZUDONG_EDIT_SUBMIT_BASELINE!,'utf8'),loader:'tsx',resolveDir:join(root,'components/modals')}));
    if (process.env.TZUDONG_NEW_REVIEW_BASELINE) builder.onLoad({filter:/ReviewModal\.tsx$/},()=>({contents:readFileSync(process.env.TZUDONG_NEW_REVIEW_BASELINE!,'utf8'),loader:'tsx',resolveDir:join(root,'components/reviews')}));
    if (process.env.TZUDONG_MYPAGE_REVIEW_BASELINE) builder.onLoad({filter:/ReviewEditModal\.tsx$/},()=>({contents:readFileSync(process.env.TZUDONG_MYPAGE_REVIEW_BASELINE!,'utf8'),loader:'tsx',resolveDir:join(root,'components/reviews')}));
    if(process.env.TZUDONG_DRAFT_UNLOAD_BASELINE_DIR)builder.onLoad({filter:/\.(ts|tsx)$/},args=>{const path=join(process.env.TZUDONG_DRAFT_UNLOAD_BASELINE_DIR!,args.path.slice(root.length+1));if(existsSync(path))return {contents:readFileSync(path,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};});
    const idbPath=Bun.resolveSync('idb',root);
    builder.onResolve({filter:/^idb$/},()=>({path:'held-idb',namespace:'held-idb'}));
    builder.onLoad({filter:/.*/,namespace:'held-idb'},()=>({contents:`export * from ${javascriptStringLiteral(idbPath)};import {openDB as open} from ${javascriptStringLiteral(idbPath)};export async function openDB(name,...args){const db=await open(name,...args);const io=globalThis.__draftIO;const names={submission:'tzudong-submission-drafts',edit:'tzudong-edit-request-drafts',review:'tzudong-review-drafts'};if(io?.hold&&name===names[io.kind||'submission']){io.hold=false;io.entered=true;await new Promise(resolve=>{io.release=resolve;});}return db;}`,loader:'ts',resolveDir:root}));
    builder.onResolve({filter:/^@\/lib\/(submissionDraftDB|reviewDraftDB|editRequestDraftDB)$/},args=>({path:args.path.slice('@/lib/'.length),namespace:'delayed-store'}));
    builder.onLoad({filter:/.*/,namespace:'delayed-store'},args=>{const kind=args.path==='submissionDraftDB'?'submission':args.path==='reviewDraftDB'?'review':'edit';const path=join(root,'lib',args.path+'.ts');return {contents:`export * from ${javascriptStringLiteral(path)};import {saveDraft as write,deleteDraft as remove} from ${javascriptStringLiteral(path)};export async function deleteDraft(...args){const io=globalThis.__draftIO;if(io.failDelete){io.failDelete=false;throw new Error('SYNTHETIC_DELETE_FAILURE')}return remove(...args)}export async function saveDraft(value){const io=globalThis.__draftIO;if((io.kind||'submission')!==${javascriptStringLiteral(kind)})return write(value);io.started++;try{return await write(value)}finally{io.finished=(io.finished||0)+1;}}`,loader:'ts',resolveDir:root};});
    builder.onResolve({ filter: /^mypage-draft-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => inert[args.path] ? { path: args.path, namespace: 'inert' } : { path: Bun.resolveSync('./' + args.path.slice(2), root) });
    builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ contents: inert[args.path], loader: 'tsx', resolveDir: root }));
  } }] });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

for (const width of [1440, 390]) {
for (const kind of ['submission', 'edit', 'review'] as const) {
 for (const exit of ['close', 'route'] as const) {
  (existsSync(chrome) ? test : test.skip)(`actual ${kind} ${width}px form preserves the last typed text through ${exit} and a different route`, async () => {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let requests = 0; const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        requests++; return route.abort();
      });
      await page.goto('https://mypage-drafts.test/'); await page.addScriptTag({ content: await bundle() });
      const open = page.getByRole('button', { name: {submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기'}[kind], exact: true });
      await open.click();
      const field = kind === 'submission' ? page.getByPlaceholder('예: 명동 짜장면') : kind === 'edit' ? page.getByPlaceholder('맛집 이름을 입력해주세요') : page.locator('textarea:visible');
      await browserExpect(field).toBeVisible().catch(async error => { throw new Error(JSON.stringify({kind,errors,fields:await page.locator('textarea,input').count(),tail:(await page.locator('body').innerText()).slice(-500)})+' '+error.message.split('\n')[0]); }); await field.fill('합성 마지막 입력입니다. 실제 제출하지 않습니다.');
      const close = page.getByRole('button', { name: {submission:'제보 닫기',edit:'맛집 수정 요청 닫기',review:'취소'}[kind], exact: true });
      if (exit === 'close') { await close.click(); await browserExpect(field).toHaveCount(0); }
      else await page.evaluate(() => (globalThis as unknown as {__draftUI:{leave():void}}).__draftUI.leave());
      await page.getByRole('button', { name: kind === 'submission' ? '수정 요청 열기' : '제보 열기', exact: true }).click();
      await page.evaluate(() => (globalThis as unknown as {__draftUI:{leave():void}}).__draftUI.leave());
      await open.click();
      if (kind === 'submission') await page.getByRole('button', { name: '복원하기', exact: true }).click();
      await browserExpect(field).toHaveValue('합성 마지막 입력입니다. 실제 제출하지 않습니다.');
      expect(requests).toBe(0); expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 30_000);
}
 }

}
async function prepare(page: import('@playwright/test').Page, presentation: 'auto' | 'map-panel' = 'map-panel') {
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}) : route.abort());
  await page.goto('https://mypage-drafts.test/'); await page.addScriptTag({content:await bundle(presentation)});
}
for (const mode of ['new', 'request'] as const) (existsSync(chrome) ? test : test.skip)(`late successful ${mode} submission cannot delete or close the next account draft`, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await prepare(page);
    const open = page.getByRole('button', { name: '제보 열기', exact: true });
    const field = page.getByPlaceholder('예: 명동 짜장면');
    await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-other-owner'));
    await open.click();
    if (mode === 'request') await page.getByRole('button', { name: /^쯔양에게 맛집 제보/ }).click();
    await browserExpect(field).toBeEditable();
    await field.fill('다음 계정에서 보존할 합성 초안');
    await page.getByRole('button', { name: '제보 닫기', exact: true }).click();
    await browserExpect(field).toHaveCount(0);
    await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-owner'));
    await open.click();
    if (mode === 'request') await page.getByRole('button', { name: /^쯔양에게 맛집 제보/ }).click();
    await browserExpect(field).toBeEditable();
    await field.fill('이전 계정에서 제출할 합성 제보');
    await page.getByLabel(/주소/).fill('합성 주소 테스트길 123');
    await page.getByRole('button', { name: '분식', exact: true }).click();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    if (mode === 'new') await page.getByLabel(/유튜브 영상 링크/).fill('https://youtu.be/AbCdEfGhI12');
    else await page.getByLabel(/추천 이유/).fill('지연 성공 응답을 검사하기 위한 합성 추천 이유입니다.');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.evaluate(() => {
      const state = { started: false, release: () => {} };
      (globalThis as unknown as { __submissionIO: typeof state }).__submissionIO = state;
      globalThis.fetch = async (input) => {
        if (String(input) !== '/api/mypage/submissions/submit') throw new Error('REMOTE_REQUEST_FORBIDDEN');
        state.started = true;
        return new Promise<Response>(resolve => { state.release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); });
      };
    });
    await page.getByRole('button', { name: mode === 'new' ? '제보하기' : '추천하기', exact: true }).click();
    await browserExpect.poll(() => page.evaluate(() => (globalThis as unknown as { __submissionIO: { started: boolean } }).__submissionIO.started)).toBe(true);
    await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-other-owner'));
    await browserExpect(page.getByRole('button', { name: '복원하기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '복원하기', exact: true }).click();
    await browserExpect(field).toHaveValue('다음 계정에서 보존할 합성 초안');
    await page.evaluate(() => (globalThis as unknown as { __submissionIO: { release(): void } }).__submissionIO.release());
    await browserExpect(page.getByRole('button', { name: '제출 중...', exact: true })).toHaveCount(0);
    expect(await page.evaluate(mode => (globalThis as unknown as DraftFormGlobals).__readOwnerSubmission('fixture-other-owner', mode), mode)).toMatchObject({ restaurant_name: '다음 계정에서 보존할 합성 초안' });
    await browserExpect(field).toHaveValue('다음 계정에서 보존할 합성 초안');
  } finally {
    await browser.close();
  }
}, 30_000);
(existsSync(chrome) ? test : test.skip)('new and recommendation drafts restore independently after immediate type switches', async () => {
  const browser = await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}}); await prepare(page);
    await page.getByRole('button',{name:'제보 열기',exact:true}).click();
    const field=page.getByPlaceholder('예: 명동 짜장면');
    await field.fill('합성 신규 맛집'); await page.getByRole('button',{name:/^쯔양에게 맛집 제보/}).click();
    await browserExpect(field).toHaveValue(''); await field.fill('합성 추천 맛집');
    await page.getByRole('button',{name:/^쯔양이 다녀간 맛집/}).click();
    await browserExpect(field).toBeDisabled(); await page.getByRole('button',{name:'복원하기',exact:true}).click();
    await browserExpect(field).toHaveValue('합성 신규 맛집');
    await page.getByRole('button',{name:/^쯔양에게 맛집 제보/}).click();
    await page.getByRole('button',{name:'복원하기',exact:true}).click(); await browserExpect(field).toHaveValue('합성 추천 맛집');
  } finally { await browser.close(); }
},30_000);
(existsSync(chrome) ? test : test.skip)('clearing every submission text field does not resurrect the earlier draft', async () => {
  const browser = await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}}); await prepare(page);
    const open=page.getByRole('button',{name:'제보 열기',exact:true}); await open.click();
    const field=page.getByPlaceholder('예: 명동 짜장면'); await field.fill('지울 합성 초안'); await field.fill('');
    await page.getByRole('button',{name:'제보 닫기',exact:true}).click();
    expect(await page.evaluate(async () => (await (globalThis as unknown as {__readSubmission():Promise<{restaurant_name:string}|null>}).__readSubmission())?.restaurant_name ?? '')).toBe('');
    await open.click(); const restore=page.getByRole('button',{name:'복원하기',exact:true});
    await browserExpect.poll(async()=>await field.isEnabled()||await restore.isVisible()).toBe(true);if(await restore.isVisible())await restore.click();await browserExpect(field).toHaveValue('');
  } finally { await browser.close(); }
},30_000);
for (const kind of ['submission','edit','review'] as const) {
 (existsSync(chrome) ? test : test.skip)(`actual ${kind} form keeps text after a storage failure and retries close`,async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
    const open=page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기'}[kind],exact:true});await open.click();
    const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.getByPlaceholder('맛, 분위기, 서비스 등 상세한 후기를 작성해주세요');
    await browserExpect(field).toBeEditable();
    await page.evaluate(()=>{
      const globals=globalThis as unknown as {__failDraftWrite:boolean};globals.__failDraftWrite=true;
      const original=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(globals.__failDraftWrite && args[1]==='readwrite')throw new DOMException('SYNTHETIC_STORAGE_FAILURE','UnknownError');return original.apply(this,args);};
    });
    await field.fill('저장 오류 뒤 유지할 합성 입력입니다.');
    const close=page.getByRole('button',{name:{submission:'제보 닫기',edit:'맛집 수정 요청 닫기',review:'취소'}[kind],exact:true});await close.click();
    await browserExpect(field).toHaveValue('저장 오류 뒤 유지할 합성 입력입니다.');await browserExpect(close).toBeVisible(); await browserExpect(close).toBeEnabled();
    await page.evaluate(()=>{(globalThis as unknown as {__failDraftWrite:boolean}).__failDraftWrite=false;});
    await close.click(); await browserExpect(field).toHaveCount(0); await open.click();
    if(kind==='submission')await page.getByRole('button',{name:'복원하기',exact:true}).click();
    await browserExpect(field).toHaveValue('저장 오류 뒤 유지할 합성 입력입니다.');
  } finally {await browser.close();}
 },30_000);
}

(existsSync(chrome) ? test : test.skip)('a delayed write coalesces newer input and a fresh form waits before offering restoration',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
  const open=page.getByRole('button',{name:'제보 열기',exact:true});await open.click();
  const field=page.getByPlaceholder('예: 명동 짜장면');await browserExpect(field).toBeEditable();
  await page.evaluate(()=>{(globalThis as unknown as {__draftIO:{hold:boolean}}).__draftIO.hold=true;});
  await field.fill('첫 합성 입력');await browserExpect.poll(()=>page.evaluate(()=>(globalThis as unknown as {__draftIO:{started:number}}).__draftIO.started)).toBe(1);
  await field.fill('중간 합성 입력');await field.fill('마지막 합성 입력');
  await page.evaluate(()=>(globalThis as unknown as {__draftUI:{leave():void}}).__draftUI.leave());await open.click();
  await browserExpect(field).toBeDisabled();
  await page.evaluate(()=>(globalThis as unknown as {__draftIO:{release():void}}).__draftIO.release());
  const restore=page.getByRole('button',{name:'복원하기',exact:true});await browserExpect(restore).toBeVisible();
  expect(await page.evaluate(()=>(globalThis as unknown as {__draftIO:{started:number}}).__draftIO.started)).toBe(2);
  await restore.click();await browserExpect(field).toHaveValue('마지막 합성 입력');
 } finally {await browser.close();}
},30_000);
(existsSync(chrome) ? test : test.skip)('a stale form cannot start a draft write for a different current session',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);await page.getByRole('button',{name:'제보 열기',exact:true}).click();
  const field=page.getByPlaceholder('예: 명동 짜장면');await browserExpect(field).toBeEditable();
  await page.evaluate(()=>{(globalThis as unknown as {__sessionOwner:string}).__sessionOwner='other-owner';});await field.fill('계정 경계를 확인할 합성 입력');
  await page.getByRole('button',{name:'제보 닫기',exact:true}).click();await browserExpect(field).toHaveValue('계정 경계를 확인할 합성 입력');
  await browserExpect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(()=>(globalThis as unknown as {__draftIO:{started:number}}).__draftIO.started)).toBe(0);
 } finally {await browser.close();}
},30_000);

for(const kind of ['submission','edit','review'] as const)(existsSync(chrome)?test:test.skip)(`actual ${kind} form isolates text when the account changes without remount`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage();await prepare(page);await page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기'}[kind],exact:true}).click();
  const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');await browserExpect(field).toBeEnabled();await field.fill('첫 계정의 합성 초안');
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-other-owner'));await browserExpect(field).toBeEnabled();await browserExpect(field).not.toHaveValue('첫 계정의 합성 초안');await field.fill('둘째 계정의 합성 초안');
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-owner'));if(kind==='submission')await page.getByRole('button',{name:'복원하기',exact:true}).click();await browserExpect(field).toHaveValue('첫 계정의 합성 초안');
 }finally{await browser.close();}
},30000);
for(const kind of ['edit','review'] as const)(existsSync(chrome)?test:test.skip)(`actual ${kind} form isolates immediate edits between two restaurant targets`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage();await prepare(page);await page.getByRole('button',{name:kind==='edit'?'수정 요청 열기':'리뷰 수정 열기',exact:true}).click();const field=kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');await browserExpect(field).toBeEnabled();await field.fill('첫 식당의 합성 초안');
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.target());await browserExpect(field).toBeEnabled();await browserExpect(field).not.toHaveValue('첫 식당의 합성 초안');await field.fill('둘째 식당의 합성 초안');
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.target());await browserExpect(field).toHaveValue('첫 식당의 합성 초안');await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.target());await browserExpect(field).toHaveValue('둘째 식당의 합성 초안');
 }finally{await browser.close();}
},30000);

(existsSync(chrome)?test:test.skip)('actual new review separates restaurant targets without leaking text and restores the first last edit',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await prepare(page);await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__seedReview());await page.getByRole('button',{name:'새 리뷰 열기',exact:true}).click();
  const field=page.locator('textarea:visible');await browserExpect(field).toHaveValue('첫 식당 합성 초안 원문');await field.fill('첫 식당의 마지막 합성 입력');await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.target());
  await browserExpect(field).toHaveCount(0);await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.target());await browserExpect(field).toHaveValue('첫 식당의 마지막 합성 입력');expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);

for(const kind of ['submission','edit','review'] as const)(existsSync(chrome)?test:test.skip)(`actual ${kind} form discards previous-session memory when the same owner returns`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage();await prepare(page);await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__setDraftOwner('11111111-1111-4111-8111-111111111111'));
  await page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기','new-review':'새 리뷰 열기'}[kind],exact:true}).click();
  const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');
  await browserExpect(field).toBeEnabled();await field.fill('이전 세션의 합성 입력');await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__renewDraftOwner());await browserExpect(field).toBeEnabled();await browserExpect(field).not.toHaveValue('이전 세션의 합성 입력');
 }finally{await browser.close();}
},30000);

(existsSync(chrome)?test:test.skip)('new review same-owner session change drops prior form memory and queued writes',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage();await prepare(page);await page.evaluate(async()=>{const d=globalThis as unknown as DraftFormGlobals;d.__setDraftOwner('11111111-1111-4111-8111-111111111111');await d.__seedReview('11111111-1111-4111-8111-111111111111');});await page.getByRole('button',{name:'새 리뷰 열기',exact:true}).click();const field=page.locator('textarea:visible');await browserExpect(field).toHaveValue('첫 식당 합성 초안 원문');await field.fill('이전 세션의 합성 새 리뷰');await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__renewDraftOwner());await browserExpect(field).toHaveCount(0);
 }finally{await browser.close();}
},30000);

(existsSync(chrome)?test:test.skip)('actual submission discard retains the restore prompt after delete failure and retries both namespaces',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message.split('\n')[0]));await prepare(page);const open=page.getByRole('button',{name:'제보 열기',exact:true});await open.click();const field=page.getByPlaceholder('예: 명동 짜장면');await field.fill('삭제 재시도할 합성 제보');await page.getByRole('button',{name:'제보 닫기',exact:true}).click();await open.click();await browserExpect(page.getByRole('button',{name:'복원하기',exact:true})).toBeVisible();
  await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('tzudong-submission-drafts');r.onsuccess=()=>resolve(r.result)});const tx=db.transaction('submission-drafts','readwrite'),store=tx.objectStore('submission-drafts'),read=store.get(['v3-fixture-owner','new']);read.onsuccess=()=>store.put({...read.result,userId:'fixture-owner'});await new Promise<void>(resolve=>{tx.oncomplete=()=>resolve()});db.close();(globalThis as unknown as {__draftIO:{failDelete:boolean}}).__draftIO.failDelete=true;});
  const count=()=>page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('tzudong-submission-drafts');r.onsuccess=()=>resolve(r.result)});const n=await new Promise<number>(resolve=>{const r=db.transaction('submission-drafts').objectStore('submission-drafts').count();r.onsuccess=()=>resolve(r.result)});db.close();return n;});expect(await count()).toBe(2);
  await page.getByRole('button',{name:'삭제하고 새로 작성',exact:true}).click();await browserExpect(page.getByRole('button',{name:'복원하기',exact:true})).toBeVisible();await browserExpect(field).toBeDisabled();expect(await count()).toBe(2);
  await page.getByRole('button',{name:'삭제하고 새로 작성',exact:true}).click();await browserExpect(page.getByRole('button',{name:'복원하기',exact:true})).toHaveCount(0);await browserExpect(field).toBeEnabled();expect(await count()).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);

async function readFixtureDraft(page:import('@playwright/test').Page,kind:string){
 return page.evaluate(async kind=>{
  const names={submission:['tzudong-submission-drafts','submission-drafts','new'],edit:['tzudong-edit-request-drafts','edit-request-drafts','11111111-1111-4111-8111-111111111111'],review:['tzudong-review-drafts','review-drafts','edit_22222222-2222-4222-8222-222222222222'],'new-review':['tzudong-review-drafts','review-drafts','11111111-1111-4111-8111-111111111111']};
  const [name,store,target]=names[kind as keyof typeof names];
  const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result)});
  const row=await new Promise<Record<string,unknown>|undefined>(resolve=>{const request=db.transaction(store).objectStore(store).get(['v3-fixture-owner',target]);request.onsuccess=()=>resolve(request.result)});db.close();return String(row?.content??row?.name??row?.restaurant_name??'');
 },kind);
}
for(const kind of ['submission','edit','review','new-review'] as const)for(const leave of [false,true])
(existsSync(chrome)?test:test.skip)(`pending ${kind} draft blocks native reload ${leave?'after composer unmount':'while editing'} until persisted`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
  if(kind==='new-review')await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__seedReview());
  await page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기','new-review':'새 리뷰 열기'}[kind],exact:true}).click();
  const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');await browserExpect(field).toBeEditable();
  await page.evaluate(kind=>{const io=(globalThis as unknown as {__draftIO:{hold:boolean;kind:string;entered:boolean}}).__draftIO;io.kind=kind==='review'||kind==='new-review'?'review':kind;io.hold=true;io.entered=false;},kind);
  await field.click();await field.fill((await field.inputValue()) + ' reload-pending');await page.waitForFunction(()=>(globalThis as unknown as {__draftIO:{entered:boolean}}).__draftIO.entered);
  if(leave)await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__draftUI.leave());
  let dialogs=0;page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload'){dialogs++;await dialog.dismiss()}else await dialog.dismiss()});
  await page.reload({timeout:5000}).catch(()=>null);expect(dialogs).toBe(1);expect(await page.evaluate(()=>Boolean((globalThis as unknown as {__draftIO:unknown}).__draftIO))).toBe(true);
  if(!leave)await browserExpect(field).toHaveValue(/reload-pending/);
  await page.evaluate(()=>(globalThis as unknown as {__draftIO:{release():void}}).__draftIO.release());
  await browserExpect.poll(()=>readFixtureDraft(page,kind)).toContain('reload-pending');
  await page.reload({timeout:5000});expect(dialogs).toBe(1);
 }finally{await browser.close();}
},20000);

for(const kind of ['submission','edit','review','new-review'] as const)
(existsSync(chrome)?test:test.skip)(`failed ${kind} save protects open input during native reload and releases after retry`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);if(kind==='new-review')await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__seedReview());
  await page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기','new-review':'새 리뷰 열기'}[kind],exact:true}).click();const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');await browserExpect(field).toBeEditable();
  await page.evaluate(kind=>{const io=(globalThis as unknown as {__draftIO:{kind:string;started:number;finished:number}}).__draftIO;io.kind=kind==='review'||kind==='new-review'?'review':kind;io.started=0;io.finished=0;const globals=globalThis as unknown as {__failDraftWrite:boolean};globals.__failDraftWrite=true;const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(globals.__failDraftWrite&&args[1]==='readwrite')throw new DOMException('SYNTHETIC_STORAGE_FAILURE','UnknownError');return original.apply(this,args)};},kind);
  await field.click();await field.fill((await field.inputValue()) + ' failed-reload');await page.waitForFunction(()=>{const io=(globalThis as unknown as {__draftIO:{started:number;finished:number}}).__draftIO;return io.started>0&&io.finished===io.started});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  let dialogs=0;page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload')dialogs++;await dialog.dismiss()});await page.reload({timeout:5000}).catch(()=>null);expect(dialogs).toBe(1);await browserExpect(field).toHaveValue(/failed-reload/);
  await page.evaluate(()=>{(globalThis as unknown as {__failDraftWrite:boolean}).__failDraftWrite=false});await field.fill((await field.inputValue()) + ' retried');await browserExpect.poll(()=>readFixtureDraft(page,kind)).toContain('failed-reload retried');await page.reload({timeout:5000});expect(dialogs).toBe(1);
 }finally{await browser.close();}
},20000);

(existsSync(chrome)?test:test.skip)('revoked previous-session queue cannot keep blocking native reload',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await prepare(page);
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__setDraftOwner('11111111-1111-4111-8111-111111111111'));
  await page.getByRole('button',{name:'제보 열기',exact:true}).click();
  const field=page.getByPlaceholder('예: 명동 짜장면');await browserExpect(field).toBeEditable();
  await page.evaluate(()=>{(globalThis as unknown as {__draftIO:{hold:boolean}}).__draftIO.hold=true});
  await field.click();await page.keyboard.type('revoked reload draft');
  await page.waitForFunction(()=>(globalThis as unknown as {__draftIO:{entered:boolean}}).__draftIO.entered);
  await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__renewDraftOwner());
  await browserExpect(field).not.toHaveValue('revoked reload draft');await browserExpect(field).toBeEditable();
  expect(await page.evaluate(()=>(globalThis as unknown as {__draftIO:{started:number}}).__draftIO.started)).toBe(1);
  let dialogs=0;page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload')dialogs++;await dialog.dismiss()});
  await page.reload({timeout:5000}).catch(()=>null);expect(dialogs).toBe(0);
 }finally{await browser.close();}
},20000);

for (const discard of [false,true]) {
 (existsSync(chrome)?test:test.skip)(`renewed account ${discard?'discard':'save'} survives the older IDB write completing later`,async()=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
   const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
   const owner='11111111-1111-4111-8111-111111111111';
   await page.evaluate(owner=>(globalThis as unknown as DraftFormGlobals).__setDraftOwner(owner),owner);
   const open=page.getByRole('button',{name:'제보 열기',exact:true});await open.click();
   const field=page.getByPlaceholder('예: 명동 짜장면');await browserExpect(field).toBeEditable();
   await page.evaluate(()=>{(globalThis as unknown as {__draftIO:{hold:boolean}}).__draftIO.hold=true;});
   await field.fill('이전 세션 합성 초안');await page.waitForFunction(()=>(globalThis as unknown as {__draftIO:{entered:boolean}}).__draftIO.entered);
   await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__renewDraftOwner());
   await browserExpect(field).toHaveValue('');await browserExpect(field).toBeEditable();
   expect(await page.evaluate(()=>(globalThis as unknown as {__draftIO:{started:number}}).__draftIO.started)).toBe(1);
   await field.fill('갱신한 세션의 합성 초안');
   const read=()=>page.evaluate(owner=>(globalThis as unknown as DraftFormGlobals).__readOwnerSubmission(owner),owner);
   await browserExpect.poll(async()=>(await read())?.restaurant_name).toBe('갱신한 세션의 합성 초안');
   if(discard){
    await page.getByRole('button',{name:'제보 닫기',exact:true}).click();await open.click();
    await page.getByRole('button',{name:'삭제하고 새로 작성',exact:true}).click();
    await browserExpect(field).toBeEditable();await browserExpect(field).toHaveValue('');
    await browserExpect.poll(read).toBeNull();
   }
   await page.evaluate(()=>(globalThis as unknown as {__draftIO:{release():void}}).__draftIO.release());
   await page.waitForFunction(()=>{const io=(globalThis as unknown as {__draftIO:{started:number;finished:number}}).__draftIO;return io.started===io.finished;});
   expect((await read())?.restaurant_name??null).toBe(discard?null:'갱신한 세션의 합성 초안');
   await browserExpect(field).toHaveValue(discard?'':'갱신한 세션의 합성 초안');
  }finally{await browser.close();}
 },30000);
}

(existsSync(chrome) ? test : test.skip)('late successful edit request cannot delete or close the next account draft', async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}); await prepare(page);
  await page.evaluate(async () => { const w=globalThis as unknown as DraftFormGlobals; await w.__seedEdit('fixture-owner','이전 계정 합성 수정 요청'); await w.__seedEdit('fixture-other-owner','다음 계정 보존할 합성 수정 초안'); });
  await page.getByRole('button',{name:'수정 요청 열기',exact:true}).click();
  const name=page.getByPlaceholder('맛집 이름을 입력해주세요');
  await browserExpect(name).toHaveValue('이전 계정 합성 수정 요청');
  await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.evaluate(() => { (globalThis as unknown as {__editSubmitIO:unknown}).__editSubmitIO={entered:false,release:()=>{}}; });
  await page.getByRole('button',{name:'수정 요청 제출',exact:true}).click();
  await page.waitForFunction(() => (globalThis as unknown as {__editSubmitIO:{entered:boolean}}).__editSubmitIO.entered);
  await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__setDraftOwner('fixture-other-owner'));
  await browserExpect(name).toHaveValue('다음 계정 보존할 합성 수정 초안');
  await page.evaluate(() => (globalThis as unknown as {__editSubmitIO:{release():void}}).__editSubmitIO.release());
  await browserExpect(page.getByRole('button',{name:'제출 중...',exact:true})).toHaveCount(0);
  await browserExpect.poll(() => page.evaluate(async () => (await (globalThis as unknown as DraftFormGlobals).__readOwnerEdit('fixture-other-owner'))?.name)).toBe('다음 계정 보존할 합성 수정 초안');
  await browserExpect(name).toHaveValue('다음 계정 보존할 합성 수정 초안');
 } finally { await browser.close(); }
},30000);

(existsSync(chrome) ? test : test.skip)('clearing a content-only review persists the empty revision through route return', async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}); await prepare(page);
  await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__seedReview('fixture-owner',true));
  await page.getByRole('button',{name:'새 리뷰 열기',exact:true}).click();
  const field=page.locator('textarea:visible'); await browserExpect(field).toHaveValue('첫 식당 합성 초안 원문');
  await field.fill('');
  await browserExpect.poll(() => page.evaluate(async () => (await (globalThis as unknown as DraftFormGlobals).__readReview())?.content)).toBe('');
  await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__draftUI.leave());
  await page.getByRole('button',{name:'새 리뷰 열기',exact:true}).click();
  await browserExpect(field).toHaveValue('');
 } finally { await browser.close(); }
},30000);

for (const kind of ['submission','edit','review'] as const) (existsSync(chrome) ? test : test.skip)(`failed initial ${kind} draft read preserves the row until explicit retry`, async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}); await prepare(page);
  if (kind==='submission') {
   await page.getByRole('button',{name:'제보 열기',exact:true}).click();
   const field=page.getByPlaceholder('예: 명동 짜장면'); await browserExpect(field).toBeEditable(); await field.fill('보존할 합성 제보 초안');
   await page.getByRole('button',{name:'제보 닫기',exact:true}).click(); await browserExpect(field).toHaveCount(0);
  } else await page.evaluate(async kind => {const w=globalThis as unknown as DraftFormGlobals;if(kind==='edit')await w.__seedEdit('fixture-owner','보존할 합성 수정 초안');else await w.__seedReviewEdit();},kind);
  await page.evaluate(() => { const original=IDBDatabase.prototype.transaction; let fail=true;
   IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>) { if(fail){fail=false;throw new DOMException('SYNTHETIC_INITIAL_READ_FAILURE','UnknownError');}return original.apply(this,args);};
  });
  await page.getByRole('button',{name:{submission:'제보 열기',edit:'수정 요청 열기',review:'리뷰 수정 열기'}[kind],exact:true}).click();
  await browserExpect(page.getByRole('button',{name:'임시 저장 다시 확인',exact:true})).toBeVisible();
  const field=kind==='submission'?page.getByPlaceholder('예: 명동 짜장면'):kind==='edit'?page.getByPlaceholder('맛집 이름을 입력해주세요'):page.locator('textarea:visible');
  await browserExpect(field).toBeDisabled();
  const read=()=>page.evaluate(async kind => {const w=globalThis as unknown as DraftFormGlobals;return kind==='submission'?(await w.__readOwnerSubmission('fixture-owner'))?.restaurant_name:kind==='edit'?(await w.__readOwnerEdit('fixture-owner'))?.name:(await w.__readReviewEdit())?.content;},kind);
  const wanted={submission:'보존할 합성 제보 초안',edit:'보존할 합성 수정 초안',review:'보존할 합성 리뷰 수정 초안'}[kind];
  expect(await read()).toBe(wanted);
  await page.getByRole('button',{name:'임시 저장 다시 확인',exact:true}).click();
  if(kind==='submission')await page.getByRole('button',{name:'복원하기',exact:true}).click();
  await browserExpect(field).toBeEditable(); await browserExpect(field).toHaveValue(wanted); expect(await read()).toBe(wanted);
 } finally {await browser.close();}
},30000);

(existsSync(chrome) ? test : test.skip)('failed initial new review read keeps the stored text until retry', async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
  await page.evaluate(async () => {await (globalThis as unknown as DraftFormGlobals).__seedReview('fixture-owner',true);const original=IDBDatabase.prototype.transaction;let fail=true;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(fail){fail=false;throw new DOMException('SYNTHETIC_INITIAL_READ_FAILURE','UnknownError');}return original.apply(this,args);};});
  await page.getByRole('button',{name:'새 리뷰 열기',exact:true}).click();
  await browserExpect(page.getByRole('button',{name:'임시 저장 다시 확인',exact:true})).toBeVisible();
  await browserExpect(page.locator('textarea:visible')).toHaveCount(0);
  expect((await page.evaluate(() => (globalThis as unknown as DraftFormGlobals).__readReview()))?.content).toBe('첫 식당 합성 초안 원문');
  await page.getByRole('button',{name:'임시 저장 다시 확인',exact:true}).click();
  await browserExpect(page.locator('textarea:visible')).toHaveValue('첫 식당 합성 초안 원문');
 } finally {await browser.close();}
},30000);

for(const mode of ['new','request'] as const) (existsSync(chrome)?test:test.skip)(`committed ${mode} submission retries draft cleanup without sending again`,async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);
  await page.getByRole('button',{name:'제보 열기',exact:true}).click();if(mode==='request')await page.getByRole('button',{name:/^쯔양에게 맛집 제보/}).click();
  const field=page.getByPlaceholder('예: 명동 짜장면');await browserExpect(field).toBeEditable();await field.fill('정리 재시도 합성 제보');await page.getByLabel(/주소/).fill('합성 주소 테스트길 123');await page.getByRole('button',{name:'분식',exact:true}).click();await page.getByRole('button',{name:'다음',exact:true}).click();
  if(mode==='new')await page.getByLabel(/유튜브 영상 링크/).fill('https://youtu.be/AbCdEfGhI12');else await page.getByLabel(/추천 이유/).fill('중복 전송 없는 정리 재시도 검사용 합성 추천 이유입니다.');await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.evaluate(()=>{(globalThis as unknown as {__draftIO:{failDelete:boolean}}).__draftIO.failDelete=true;(globalThis as unknown as {__submitCount:number}).__submitCount=0;globalThis.fetch=async input=>{if(String(input)!=='/api/mypage/submissions/submit')throw new Error('REMOTE_REQUEST_FORBIDDEN');(globalThis as unknown as {__submitCount:number}).__submitCount++;return new Response('{}',{status:200});};});
  await page.getByRole('button',{name:mode==='new'?'제보하기':'추천하기',exact:true}).click();
  await browserExpect(page.getByRole('button',{name:'제출한 초안 정리 다시 시도',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'제출한 초안 정리 다시 시도',exact:true}).click();
  await browserExpect(field).toHaveCount(0);expect(await page.evaluate(()=>(globalThis as unknown as {__submitCount:number}).__submitCount)).toBe(1);
  expect(await page.evaluate(mode=>(globalThis as unknown as DraftFormGlobals).__readOwnerSubmission('fixture-owner',mode),mode)).toBeNull();
 }finally{await browser.close();}
},30000);

(existsSync(chrome)?test:test.skip)('committed edit request retries draft cleanup without another insert',async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page);await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__seedEdit('fixture-owner','정리 재시도 합성 수정 요청'));
  await page.getByRole('button',{name:'수정 요청 열기',exact:true}).click();const field=page.getByPlaceholder('맛집 이름을 입력해주세요');await browserExpect(field).toHaveValue('정리 재시도 합성 수정 요청');await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByRole('button',{name:'다음',exact:true}).click();
  await page.evaluate(()=>{(globalThis as unknown as {__editSubmitIO:unknown}).__editSubmitIO={entered:false,release:()=>{},inserts:0};(globalThis as unknown as {__draftIO:{failDelete:boolean}}).__draftIO.failDelete=true;});
  await page.getByRole('button',{name:'수정 요청 제출',exact:true}).click();await page.waitForFunction(()=>(globalThis as unknown as {__editSubmitIO:{entered:boolean}}).__editSubmitIO.entered);await page.evaluate(()=>(globalThis as unknown as {__editSubmitIO:{release():void}}).__editSubmitIO.release());
  await browserExpect(page.getByRole('button',{name:'제출한 초안 정리 다시 시도',exact:true})).toBeVisible();await page.getByRole('button',{name:'제출한 초안 정리 다시 시도',exact:true}).click();
  await browserExpect(field).toHaveCount(0);expect(await page.evaluate(()=>(globalThis as unknown as {__editSubmitIO:{inserts:number}}).__editSubmitIO.inserts)).toBe(2);expect(await page.evaluate(()=>(globalThis as unknown as DraftFormGlobals).__readOwnerEdit('fixture-owner'))).toBeNull();
 }finally{await browser.close();}
},30000);


for (const presentation of ['auto', 'map-panel'] as const) test(`pending submitted ${presentation} form cannot admit unsent edits or step changes`, async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await prepare(page, presentation);
    await page.getByRole('button', { name: '제보 열기', exact: true }).click();
    const field = page.getByPlaceholder('예: 명동 짜장면');
    await browserExpect(field).toBeEditable();
    await field.fill('제출하는 합성 식당');
    await page.getByLabel(/주소/).fill('합성 주소 테스트길 123');
    await page.getByRole('button', { name: '분식', exact: true }).click();
    if (presentation === 'map-panel') await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.getByLabel(/유튜브 영상 링크/).fill('https://youtu.be/AbCdEfGhI12');
    if (presentation === 'map-panel') await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.evaluate(() => {
      const state = { started: false, release: () => {} };
      (globalThis as unknown as { __submissionIO: typeof state }).__submissionIO = state;
      globalThis.fetch = async input => {
        if (String(input) !== '/api/mypage/submissions/submit') throw new Error('REMOTE_REQUEST_FORBIDDEN');
        state.started = true;
        return new Promise<Response>(resolve => { state.release = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })); });
      };
    });
    await page.getByRole('button', { name: '제보하기', exact: true }).click();
    await page.waitForFunction(() => (globalThis as unknown as { __submissionIO: { started: boolean } }).__submissionIO.started);
    if (presentation === 'auto') await browserExpect(field).toBeDisabled();
    else await browserExpect(page.getByRole('button', { name: '이전', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
    await page.evaluate(() => (globalThis as unknown as { __submissionIO: { release(): void } }).__submissionIO.release());
    await browserExpect(page.getByRole('button', { name: '제출 중...', exact: true })).toHaveCount(0);
  } finally { await browser.close(); }
}, 20000);
