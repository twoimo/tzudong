import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const owner = '99999999-9999-4999-8999-999999999999';
const fixedRestaurant = { id: '11111111-1111-4111-8111-111111111111', name: '합성 영수증 식당' };
const matchedRestaurant = { id: '33333333-3333-4333-8333-333333333333', name: '합성 매칭 식당' };
const ocrResultRef = '44444444-4444-4444-8444-444444444444';
const ocrResultRevision = '55555555-5555-4555-8555-555555555555';
const visitedDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const reviewDraft = '합성 영수증 초안입니다. 실제 방문 기록이 아니며 테스트에서만 사용합니다.';
const receiptBytes = 2048;
const receiptAccept = 'image/avif,image/jpeg,image/png,image/webp';

type Restaurant = { id: string; name: string };
type ReceiptCase = {
  width: number;
  presentation: 'auto' | 'map-panel';
  inline?: boolean;
  restaurant: Restaurant | null;
  stream: Array<'ok' | 'terminal' | 'interrupted'>;
  storeName: string;
  restaurants?: Restaurant[];
};
type OcrRequest = { name: string; size: number; type: string; restaurantId: string | null; restaurantName: string | null; force: string | null; authorization: string };
type ReceiptIO = {
  toasts: string[];
  streams: OcrRequest[];
  statuses: OcrRequest[];
  saves: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
  uploads: Array<{ bucket: string; path: string; size: number; type: string; upsert: boolean }>;
  successes: number;
  closes: number;
};

let built: Promise<string> | undefined;
function bundle() {
  built ??= (async () => {
    const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ReviewModal} from './components/reviews/ReviewModal';import {FEATURE_DATABASE_READY} from './lib/runtime-feature-readiness-contract';
    const config=globalThis.__receiptCase;
    const io=globalThis.__receiptIO={toasts:[],streams:[],statuses:[],saves:[],inserts:[],uploads:[],successes:0,closes:0};
    const result={store_name:config.storeName,date:${JSON.stringify(visitedDate)},time:'12:30',category:'한식',review_draft:${JSON.stringify(reviewDraft)},ocr_result_ref:${JSON.stringify(ocrResultRef)},ocr_result_revision:${JSON.stringify(ocrResultRevision)}};
    const frames=[['progress',{message:'합성 분석 진행',stage:'model_start'}],['field_patch',{data:{date:result.date,time:result.time,category:result.category}}],['field_patch',{final:true,data:{review_draft:result.review_draft}}],['done',{data:result}]]
      .map(([event,data])=>'event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n').join('');
    const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
    const describe=init=>{const form=init.body;const image=form.get('image');return {name:image.name,size:image.size,type:image.type,restaurantId:form.get('selectedRestaurantId'),restaurantName:form.get('selectedRestaurantName'),force:form.get('force'),authorization:init.headers.Authorization};};
    globalThis.fetch=async(input,init={})=>{const url=String(input);
      if(url==='/api/runtime-compatibility/features')return json(FEATURE_DATABASE_READY);
      if(url==='/api/ocr/quota')return json({used:0,max:5,remaining:5,resetAt:'2026-12-01T00:00:00.000Z'});
      if(url==='/api/ocr/extract/stream'){const mode=config.stream[io.streams.length]??'ok';io.streams.push(describe(init));
        if(mode==='interrupted')throw new TypeError('synthetic stream interruption');
        if(mode==='terminal')return json({error:'합성 분석 거절',code:'OCR_SYNTHETIC_REJECTED'},422);
        return new Response(frames,{status:200,headers:{'Content-Type':'text/event-stream'}});}
      if(url==='/api/ocr/results/status'){io.statuses.push(describe(init));return json(result);}
      if(url==='/api/ocr/reviews/save'){io.saves.push(JSON.parse(init.body));return json({ok:true});}
      return new Response('',{status:503});};
    function Fixture(){const [open,setOpen]=useState(true);return open?<ReviewModal isOpen restaurant={config.restaurant} presentation={config.presentation} inline={config.inline} onSuccess={()=>{io.successes++;}} onClose={()=>{io.closes++;setOpen(false);}}/>:<p>리뷰 작성 닫힘</p>;}
    createRoot(document.getElementById('root')).render(<Fixture/>);`;
    const inert: Record<string, string> = {
      'next/image': `import React from 'react';export default function Image({fill,unoptimized,priority,...props}){return <img {...props}/>}`,
      'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>}`,
      'next/navigation': 'export const useRouter=()=>({push(){},replace(){},refresh(){}});',
      'browser-image-compression': 'export default async function imageCompression(file){return file;}',
      '@/contexts/AuthContext': `const user={id:${JSON.stringify(owner)}};export const useAuth=()=>({user});`,
      '@/hooks/use-toast': `export const toast=value=>{globalThis.__receiptIO.toasts.push(value?.title??'');return {id:'',dismiss(){},update(){}};};export const useToast=()=>({toast,toasts:[],dismiss(){}});`,
      '@/integrations/supabase/client': `const io=()=>globalThis.__receiptIO;const session={access_token:'synthetic-access-token',user:{id:${JSON.stringify(owner)}}};
        function table(name){const filters=[];const query={select(){return query;},eq(column,value){filters.push({value,exact:true});return query;},ilike(column,pattern){filters.push({value:pattern.replaceAll('%',''),exact:false});return query;},limit(){return query;},
          async overrideTypes(){if(name!=='restaurants')throw new Error('UNEXPECTED_TABLE_READ');const rows=globalThis.__receiptCase.restaurants??[];return {data:rows.filter(row=>filters.every(filter=>filter.exact?row.name===filter.value:row.name.includes(filter.value))),error:null};},
          async insert(row){io().inserts.push(row);return {error:null};},async maybeSingle(){return {data:null,error:null};}};return query;}
        export const supabase={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:session.user}})},from:table,rpc(){throw new Error('REMOTE_RPC_FORBIDDEN')},
          storage:{from:bucket=>({async upload(path,file,options){io().uploads.push({bucket,path,size:file.size,type:file.type,upsert:options?.upsert});return {data:{path},error:null};},
            async info(path){const upload=io().uploads.find(item=>item.path===path);return upload?{data:{size:upload.size,contentType:upload.type},error:null}:{data:null,error:{statusCode:'404'}};},
            async remove(){return {data:[],error:null};},async list(){return {data:[],error:null};}})}};
        export const getSupabaseBrowserClient=()=>supabase;`,
    };
    const output = await Bun.build({ entrypoints: ['receipt-step-fixture'], target: 'browser', format: 'iife', write: false, define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'receipt-step-fixture', setup(builder) {
      builder.onResolve({ filter: /^receipt-step-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      builder.onResolve({ filter: /^(?:next\/(?:image|link|navigation)|browser-image-compression)$/ }, args => ({ path: args.path, namespace: 'inert' }));
      builder.onResolve({ filter: /^@\// }, args => inert[args.path] ? { path: args.path, namespace: 'inert' } : { path: Bun.resolveSync('./' + args.path.slice(2), root) });
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ contents: inert[args.path], loader: 'tsx', resolveDir: root }));
    } }] });
    if (!output.success) throw new Error(output.logs.map(String).join('\n'));
    return output.outputs.find(file => file.path.endsWith('.js'))!.text();
  })();
  return built;
}

async function open(browser: Browser, receiptCase: ReceiptCase) {
  const page = await browser.newPage({ viewport: { width: receiptCase.width, height: 900 } });
  const consoleText: string[] = [];
  const errors: string[] = [];
  page.on('console', message => consoleText.push(message.text()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto('https://receipt-step.test/');
  await page.evaluate(value => { (globalThis as unknown as { __receiptCase: ReceiptCase }).__receiptCase = value; }, receiptCase);
  await page.addScriptTag({ content: await bundle() });
  return { page, consoleText, errors };
}

const readIO = (page: Page) => page.evaluate(() => (globalThis as unknown as { __receiptIO: ReceiptIO }).__receiptIO);
const waitForIO = (page: Page, predicate: string) => page.waitForFunction(`(io => ${predicate})(globalThis.__receiptIO)`, undefined, { timeout: 10_000 });
const receiptInput = (page: Page) => page.locator(`input[type="file"][accept="${receiptAccept}"]`);
const foodInput = (page: Page) => page.locator('input[type="file"][accept="image/*"]');
const receiptFile = (name = 'synthetic-receipt.jpg', mimeType = 'image/jpeg') => ({ name, mimeType, buffer: Buffer.alloc(receiptBytes, 7) });
const foodFile = { name: 'synthetic-food.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(512, 3) };

function expectNoRawOcrLeak(consoleText: string[], storage: string, storeName: string) {
  const logged = consoleText.join('\n');
  for (const value of [reviewDraft, storeName, ocrResultRef, ocrResultRevision]) {
    expect(logged).not.toContain(value);
    expect(storage).not.toContain(value);
  }
}
const webStorage = (page: Page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

async function withBrowser(run: (browser: Browser) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try { await run(browser); } finally { await browser.close(); }
}

const browserTest = existsSync(chrome) ? test : test.skip;

browserTest('dialog: an AI receipt fills the form and binds its OCR result to the save request', () => withBrowser(async browser => {
  const { page, consoleText, errors } = await open(browser, { width: 1440, presentation: 'auto', restaurant: fixedRestaurant, stream: ['ok'], storeName: fixedRestaurant.name });
  await browserExpect(page.getByRole('button', { name: 'AI 자동 입력', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await receiptInput(page).setInputFiles(receiptFile());
  await waitForIO(page, "io.toasts.includes('영수증 자동 입력 완료')");
  await browserExpect(page.getByText('영수증 사진 첨부됨')).toBeVisible();
  await browserExpect(page.getByText('영수증을 읽고 있습니다')).toHaveCount(0);
  await browserExpect(page.locator('input[type="date"]')).toHaveValue(visitedDate);
  await browserExpect(page.locator('input[type="time"]')).toHaveValue('12:30');
  await browserExpect(page.locator('textarea')).toHaveValue(reviewDraft);
  await browserExpect(page.getByRole('button', { name: '한식 카테고리 선택 해제' })).toBeVisible();
  await browserExpect(page.getByText('AI 입력 · 확인 필요')).toHaveCount(4);

  const analyzed = await readIO(page);
  expect(analyzed.streams).toEqual([{
    name: expect.stringMatching(/^\d+_[a-z0-9]+\.jpg$/), size: receiptBytes, type: 'image/jpeg',
    restaurantId: fixedRestaurant.id, restaurantName: fixedRestaurant.name, force: null,
    authorization: 'Bearer synthetic-access-token',
  }]);
  expect(analyzed.statuses).toEqual([]);

  await foodInput(page).setInputFiles(foodFile);
  await page.getByRole('button', { name: '리뷰 등록', exact: true }).click();
  await waitForIO(page, 'io.closes === 1');
  const saved = await readIO(page);
  expect(saved.saves).toHaveLength(1);
  const save = saved.saves[0];
  expect(save).toMatchObject({
    restaurantId: fixedRestaurant.id, title: `${fixedRestaurant.name} 방문 후기`, content: reviewDraft,
    visitedAt: `${visitedDate}T12:30:00`, categories: ['한식'], ocrResultRef, ocrResultRevision,
  });
  expect(saved.inserts).toEqual([]);
  expect(saved.uploads.map(upload => upload.bucket)).toEqual(['review-verifications', 'review-photos']);
  expect(saved.uploads[0]).toEqual({ bucket: 'review-verifications', path: save.verificationPhoto as string, size: receiptBytes, type: 'image/jpeg', upsert: false });
  expect(String(save.verificationPhoto).startsWith(`${owner}/reviews/${save.reviewId}/verification/`)).toBe(true);
  expect(save.foodPhotos).toEqual([saved.uploads[1].path]);
  expect(saved.successes).toBe(1);
  expect(saved.toasts).toContain('리뷰 등록 완료');
  expectNoRawOcrLeak(consoleText, await webStorage(page), fixedRestaurant.name);
  expect(errors).toEqual([]);
}), 60_000);

browserTest('inline: an interrupted stream reads back the stored result, matches the store, and photo-only saves without the OCR binding', () => withBrowser(async browser => {
  const { page, consoleText, errors } = await open(browser, {
    width: 1440, presentation: 'auto', inline: true, restaurant: null, stream: ['interrupted'],
    storeName: matchedRestaurant.name, restaurants: [matchedRestaurant, { id: '66666666-6666-4666-8666-666666666666', name: '합성 다른 식당' }],
  });
  await receiptInput(page).setInputFiles(receiptFile());
  await waitForIO(page, "io.toasts.includes('영수증 자동 입력 완료')");
  await browserExpect(page.getByText(matchedRestaurant.name, { exact: true })).toBeVisible();
  await browserExpect(page.getByRole('button', { name: '변경', exact: true })).toBeVisible();
  await browserExpect(page.locator('input[type="date"]')).toHaveValue(visitedDate);
  await browserExpect(page.locator('textarea')).toHaveValue(reviewDraft);
  const analyzed = await readIO(page);
  expect(analyzed.streams).toHaveLength(1);
  expect(analyzed.statuses).toEqual([{ ...analyzed.streams[0], restaurantId: null, restaurantName: null }]);
  expect(analyzed.streams[0]).toMatchObject({ restaurantId: null, restaurantName: null, size: receiptBytes });

  await page.getByRole('button', { name: '사진만 첨부', exact: true }).click();
  await browserExpect(page.getByRole('button', { name: '사진만 첨부', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await browserExpect(page.getByText('AI 분석 없이 사진만 첨부합니다.', { exact: false })).toBeVisible();
  await foodInput(page).setInputFiles(foodFile);
  await page.getByRole('button', { name: '리뷰 등록', exact: true }).click();
  await waitForIO(page, 'io.closes === 1');
  const saved = await readIO(page);
  expect(saved.saves).toEqual([]);
  expect(saved.inserts).toHaveLength(1);
  expect(saved.inserts[0]).toMatchObject({
    user_id: owner, restaurant_id: matchedRestaurant.id, title: `${matchedRestaurant.name} 방문 후기`,
    content: reviewDraft, visited_at: `${visitedDate}T12:30:00`, categories: ['한식'], is_verified: false,
    verification_photo: saved.uploads[0].path, food_photos: [saved.uploads[1].path],
  });
  expect(Object.keys(saved.inserts[0]).sort()).toEqual(['categories', 'content', 'food_photos', 'id', 'is_verified', 'restaurant_id', 'title', 'user_id', 'verification_photo', 'visited_at']);
  expect(saved.uploads[0]).toMatchObject({ bucket: 'review-verifications', size: receiptBytes, upsert: false });
  expect(saved.successes).toBe(1);
  expectNoRawOcrLeak(consoleText, await webStorage(page), matchedRestaurant.name);
  expect(errors).toEqual([]);
}), 60_000);

browserTest('map panel: a rejected analysis keeps the photo, retries the same file, and falls back to photo-only input', () => withBrowser(async browser => {
  const { page, consoleText, errors } = await open(browser, { width: 1440, presentation: 'map-panel', restaurant: fixedRestaurant, stream: ['terminal', 'terminal'], storeName: fixedRestaurant.name });
  await browserExpect(page.getByText('1 / 3 · 인증')).toBeVisible();
  await receiptInput(page).setInputFiles(receiptFile());
  const failure = page.getByText('AI 분석에 실패했어요. 사진은 유지되니 직접 입력하거나 다시 시도할 수 있어요.');
  await browserExpect(failure).toBeVisible();
  await browserExpect(page.getByText('합성 분석 거절')).toBeVisible();
  await browserExpect(page.getByText('영수증 사진 첨부됨')).toBeVisible();
  expect((await readIO(page)).toasts).toContain('스마트 스캔 실패');

  await page.getByRole('button', { name: '다시 분석', exact: true }).click();
  await waitForIO(page, 'io.streams.length === 2 && io.toasts.filter(title => title === "스마트 스캔 실패").length === 2');
  await browserExpect(failure).toBeVisible();
  const retried = await readIO(page);
  expect(retried.streams[1]).toEqual(retried.streams[0]);

  await page.getByRole('button', { name: '사진만 첨부하고 직접 입력', exact: true }).click();
  await browserExpect(page.getByText('2 / 3 · 방문 정보')).toBeVisible();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await browserExpect(page.getByRole('button', { name: '사진만 첨부', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await browserExpect(failure).toHaveCount(0);
  await browserExpect(page.getByText('영수증 사진 첨부됨')).toBeVisible();
  const final = await readIO(page);
  expect(final.streams).toHaveLength(2);
  expect(final.statuses).toEqual([]);
  expectNoRawOcrLeak(consoleText, await webStorage(page), fixedRestaurant.name);
  expect(errors).toEqual([]);
}), 60_000);

browserTest('mobile sheet: photo-only rejects unsupported files, clears and reattaches a receipt without OCR', () => withBrowser(async browser => {
  const { page, errors } = await open(browser, { width: 390, presentation: 'auto', restaurant: fixedRestaurant, stream: [], storeName: fixedRestaurant.name });
  await page.getByRole('button', { name: '사진만 첨부', exact: true }).click();
  await browserExpect(page.getByRole('button', { name: '사진만 첨부', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await browserExpect(page.getByText('AI 분석 없이 인증 사진만 첨부됩니다.', { exact: false })).toBeVisible();
  const next = page.getByRole('button', { name: '다음', exact: true });
  await browserExpect(next).toBeDisabled();

  await receiptInput(page).setInputFiles(receiptFile('synthetic-receipt.gif', 'image/gif'));
  await waitForIO(page, "io.toasts.includes('지원하지 않는 영수증 형식')");
  await browserExpect(page.getByText('영수증 인증 사진을 업로드해주세요')).toBeVisible();
  await browserExpect(next).toBeDisabled();

  await receiptInput(page).setInputFiles(receiptFile());
  await browserExpect(page.getByText('영수증 사진 첨부됨')).toBeVisible();
  await browserExpect(next).toBeEnabled();
  await page.getByRole('button', { name: '사진 제거', exact: true }).click();
  await browserExpect(page.getByText('영수증 인증 사진을 업로드해주세요')).toBeVisible();
  await browserExpect(next).toBeDisabled();

  await receiptInput(page).setInputFiles(receiptFile());
  await browserExpect(next).toBeEnabled();
  await next.click();
  await browserExpect(page.getByText('2 / 3 · 방문 정보')).toBeVisible();
  const io = await readIO(page);
  expect(io.streams).toEqual([]);
  expect(io.statuses).toEqual([]);
  expect(errors).toEqual([]);
}), 60_000);

browserTest('mobile sheet: an AI receipt reveals the filled visit fields and then the review step', () => withBrowser(async browser => {
  const { page, consoleText, errors } = await open(browser, { width: 390, presentation: 'auto', restaurant: fixedRestaurant, stream: ['ok'], storeName: fixedRestaurant.name });
  await browserExpect(page.getByText('1 / 3 · 인증')).toBeVisible();
  await receiptInput(page).setInputFiles(receiptFile());
  await waitForIO(page, "io.toasts.includes('영수증 자동 입력 완료')");
  await browserExpect(page.getByText('3 / 3 · 리뷰')).toBeVisible({ timeout: 8_000 });
  await browserExpect(page.locator('textarea')).toHaveValue(reviewDraft);
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await browserExpect(page.locator('input[type="date"]')).toHaveValue(visitedDate);
  await browserExpect(page.locator('input[type="time"]')).toHaveValue('12:30');
  expect((await readIO(page)).streams).toHaveLength(1);
  expectNoRawOcrLeak(consoleText, await webStorage(page), fixedRestaurant.name);
  expect(errors).toEqual([]);
}), 60_000);
