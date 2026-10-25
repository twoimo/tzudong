import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const panels = { profile: '프로필', bookmarks: '북마크', notifications: '알림', feed: '리뷰', stamp: '도장', leaderboard: '랭킹' };
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Panel from './components/home/home-desktop-control-panel';
const fixture = globalThis.__fixture = { held: new Set(globalThis.__heldPanels || []), failed: new Set(globalThis.__failedPanels || []), waiters: {}, calls: [], auth: [],
  release(name) { this.held.delete(name); for (const resolve of (this.waiters[name] || [])) resolve(); this.waiters[name] = []; },
  async load(name, loader) { this.calls.push(name); if (this.held.has(name)) await new Promise(resolve => (this.waiters[name] ||= []).push(resolve)); if (this.failed.has(name)) throw new Error('offline-fixture'); return loader(); }
};
function Fixture(){const [auth,setAuth]=useState(globalThis.__holdAuth?{user:null,isAuthLoading:true}:{user:{id:'fixture-self'},isAuthLoading:false});const [detail,setDetail]=useState(null);fixture.setAuth=setAuth;fixture.setDetail=setDetail;fixture.closeDetail=()=>setDetail(null);return <Panel mapMode="domestic" selectedRegion={null} selectedCountry={null} selectedCategories={[]} filters={{}} onRegionChange={()=>{}} onCountryChange={()=>{}} onCategoryChange={()=>{}} onThemeChange={()=>{}} onRestaurantSelect={setDetail} onRestaurantSearch={setDetail} onSearchExecute={()=>{}} panelRestaurant={detail} isPanelOpen={Boolean(detail)} onDetailPanelBack={()=>{setDetail(null);return true;}} {...auth} />;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><Fixture/></QueryClientProvider>);
`;

export async function renewalPanelBundle(surface: 'desktop' | 'mobile' | 'outer-mobile' | 'outer-desktop' = 'desktop') {
  const built = await Bun.build({
    entrypoints: ['renewal-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'renewal-fixture', setup(builder) {
      builder.onResolve({ filter: /^renewal-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry.replace("'./components/home/home-desktop-control-panel'", JSON.stringify(surface === 'mobile' ? './components/home/MobileControlOverlay' : surface.startsWith('outer') ? './components/home/home-control-panel' : './components/home/home-desktop-control-panel')).replace('<Panel mapMode=', '<Panel viewportMode="'+(surface === 'outer-mobile' ? 'mobileOrTablet' : 'desktop')+'" onModeChange={()=>{}} onPanelClose={()=>{}} initialIntent={globalThis.__initialIntent} mapMode='), loader: 'tsx', resolveDir: root }));
      const inert: Record<string, string> = {
        'next/navigation': `import { useSyncExternalStore, useMemo } from 'react'; const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)}; const router={push(url){history.pushState({},'',url);window.dispatchEvent(new Event('popstate'));},replace(url){history.replaceState({},'',url);window.dispatchEvent(new Event('popstate'));},prefetch(){}}; export const useRouter=()=>router; export const usePathname=()=>location.pathname; export function useSearchParams(){const value=useSyncExternalStore(subscribe,()=>location.search);return useMemo(()=>new URLSearchParams(value),[value]);}`,
        'next/dynamic': `import React from 'react'; export default function dynamic(loader, options={}) {const Component=React.lazy(()=>loader().then(value=>({default:value.default||value})));return props=><React.Suspense fallback={options.loading?<options.loading/>:null}><Component {...props}/></React.Suspense>;}`,
        'next/image': `import React from 'react'; export default function Image({unoptimized,priority,fill,...props}) {return <img {...props}/>;}`,
        '@/components/home/use-overseas-country-counts': 'export const useOverseasCountryCounts=()=>({});',
        '@/lib/overseas-map-loader': 'export const preloadOverseasMap=()=>{};',
        '@/lib/site-config': 'export const isPublicRestrictedMode=false;export const siteConfig={operator:{copyrightLabel:"합성 운영자"},contact:{}};',
        '@/contexts/AuthContextBase': 'export const useAuth=()=>({signOut:async()=>{}});',
        '@/components/stamp/StampCard': 'export function StampCard(){return null}',
        '@/lib/no-toast': 'export const toast = { info(){}, success(){}, error(){} };',
        '@/lib/auth-ui-events': 'export const requestAuthUi=(value)=>globalThis.__fixture.auth.push(value);',
        '@/components/home/DesktopLeftPanelMapHome': `import React from 'react'; export default function Home(){return <div data-testid="map-home">인기 검색 맛집</div>}`,
        '@/components/home/HydratedDetailRestaurant': `export default function Hydrated({children,restaurant}){return children(restaurant);}`,
        '@/components/region/RegionSelector': 'export default function Region(){return null;}',
        '@/components/filters/CategoryFilter': 'export default function Category(){return null;}',
        '@/components/map/map-view-deferred-panels': `import React from 'react';export function RestaurantDetailPanel({onClose}){return <button onClick={onClose}>상세 닫기</button>;}`,
      };
      const views: Record<string, string> = {
        '@/components/overlay-pages/FeedOverlay': '리뷰', '@/components/overlay-pages/StampOverlay': '도장',
        '@/components/overlay-pages/LeaderboardOverlay': '랭킹', '@/components/profile/UserProfilePanel': '프로필',
        '@/components/home/DesktopLeftPanelBookmarks': '북마크', '@/components/home/DesktopLeftPanelNotifications': '알림',
        '@/components/announcement/AnnouncementPanel': '공지', '@/components/admin/AdminReviewPanel': '리뷰 관리',
        '@/components/search/RestaurantSearch': '검색',
        '@/components/home/MobileBookmarkMenuButton':'북마크', '@/components/home/MobileNotificationMenuButton':'알림',
        ...(surface.startsWith('outer') ? {'@/components/home/MobileControlOverlay':'지도 메뉴','@/components/home/home-desktop-control-panel':'지도 메뉴'} : {}),
      };
      for (const [path, title] of Object.entries(views)) inert[path] = `import React,{useState} from 'react';export function UserProfilePanel({onClose}){const [note,setNote]=useState('');return <section data-loaded-panel="${title}"><h2>${title}</h2><input aria-label="${title} 상태" value={note} onChange={e=>setNote(e.target.value)}/><div data-fixture-scroll style={{height:80,overflow:'auto'}}><div style={{height:800}}>합성 목록</div></div><button onClick={onClose}>패널 닫기</button></section>};export default UserProfilePanel;`;
      for (const [path,title] of [['@/components/home/MobileBookmarkMenuButton','북마크'],['@/components/home/MobileNotificationMenuButton','알림']]) inert[path] = `import React from 'react';export default function Menu({open,onOpenChange}){return <><button aria-label="${title}" onClick={()=>onOpenChange(!open)}>${title}</button>{open&&<section data-loaded-panel="${title}"><h2>${title}</h2></section>}</>}`;
      inert['@/components/search/RestaurantSearch'] = `import React from 'react';export default function Search({onRestaurantSearch,onSearchQueryChange}){return <section data-loaded-panel="검색"><button onClick={()=>{onRestaurantSearch({id:'fixture-restaurant',name:'정원분식'});onSearchQueryChange('');}}>정원분식 선택</button></section>;}`;
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => inert[args.path]
        ? { path: args.path, namespace: 'inert' }
        : { path: Bun.resolveSync('./' + args.path.slice(2), root) });
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ contents: inert[args.path], loader: 'tsx', resolveDir: root }));
      builder.onLoad({ filter: /(?:home-desktop-control-panel|home-control-panel|MobileControlOverlay)\.tsx$/ }, args => ({
        // Replace only the dynamic-import transport boundary. State, events,
        // Radix menu, retry hook and rendered fallback are the actual source.
        contents: readFileSync(args.path, 'utf8').replace(/const mod = await import\(['"]([^'"]+)['"]\);/g,
          (_, path) => `const mod = await globalThis.__fixture.load(${JSON.stringify(views[path] || path)}, () => import(${JSON.stringify(path)}));`),
        loader: 'tsx', resolveDir: join(root, 'components/home'),
      }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(String).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

(existsSync(chrome) ? test : test.skip)('detail close and parent history restore preserve the exact desktop search query', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' })
      : route.abort());
    await page.goto('https://renewal.test/');
    await page.addScriptTag({ content: await renewalPanelBundle() });
    const search = page.getByRole('textbox', { name: '맛집 검색어 입력' });
    await search.fill('정원');
    await page.getByRole('button', { name: '정원분식 선택', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: '상세 닫기', exact: true })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('home:desktop-detail-return-capture')));
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
    await browserExpect(search).toHaveValue('정원');
    await page.getByRole('button', { name: '정원분식 선택', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: '상세 닫기', exact: true })).toBeVisible();
    await page.evaluate(() => {
      (globalThis as unknown as { __fixture: { closeDetail(): void } }).__fixture.closeDetail();
      window.dispatchEvent(new CustomEvent('home.restore.succeeded', { detail: { restoreKey: 'fixture-restore' } }));
    });
    await browserExpect(search).toHaveValue('정원');
    await browserExpect(page.getByRole('button', { name: '정원분식 선택', exact: true })).toBeVisible();
  } finally { await browser.close(); }
}, 30_000);

(existsSync(chrome) ? test : test.skip)('protected panel waits for authentication before restoring a user or requesting login', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await renewalPanelBundle();
    for (const signedIn of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.route('**/*', route => route.request().resourceType() === 'document'
          ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' })
          : route.abort());
        await page.goto('https://renewal.test/?panel=bookmarks');
        await page.evaluate(() => Object.assign(globalThis, { __holdAuth: true }));
        await page.addScriptTag({ content: script });
        await browserExpect(page.getByRole('status')).toContainText('북마크');
        expect(new URL(page.url()).searchParams.get('panel')).toBe('bookmarks');
        expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { auth: unknown[] } }).__fixture.auth)).toEqual([]);
        await page.evaluate(signedIn => {
          (globalThis as unknown as { __fixture: { setAuth(value: unknown): void } }).__fixture.setAuth({
            user: signedIn ? { id: 'fixture-self' } : null, isAuthLoading: false,
          });
        }, signedIn);
        if (signedIn) {
          await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toBeVisible();
          expect(new URL(page.url()).searchParams.get('panel')).toBe('bookmarks');
        } else {
          await browserExpect(page).toHaveURL('https://renewal.test/');
          expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { auth: Array<{reason:string}> } }).__fixture.auth.map(value=>value.reason))).toContain('open-bookmarks');
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 30_000);

(existsSync(chrome) ? test : test.skip)('six actual desktop menu destinations retain their identity through pointer, keyboard, cold loading, retry and history', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await renewalPanelBundle();
    const context = await browser.newContext({ viewport: { width: 1518, height: 954 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' })
      : route.abort());
    await page.goto('https://renewal.test/?panel=bookmarks');
    await page.addScriptTag({ content: script });
    await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toBeVisible();
    await page.evaluate(() => {
      const bad: string[] = [];
      (globalThis as unknown as { __badPanels: string[] }).__badPanels = bad;
      new MutationObserver(() => {
        if (new URLSearchParams(location.search).get('panel') && document.querySelector('[data-testid="map-home"]')) bad.push(location.search);
      }).observe(document.body, { childList: true, subtree: true });
    });
    // Each directed pair in both input modes: 6 * 5 * 2 = 60 transitions.
    for (const input of ['pointer', 'keyboard']) {
      for (const [from, fromTitle] of Object.entries(panels)) {
        await page.evaluate(path => { history.pushState({}, '', path); window.dispatchEvent(new Event('popstate')); }, '/?panel=' + from);
        await browserExpect(page.locator(`[data-loaded-panel="${fromTitle}"]`)).toBeVisible();
        for (const [to, title] of Object.entries(panels)) {
          if (to === from) continue;
          const trigger = page.locator('[data-desktop-map-menu-trigger="true"][data-state]');
          await trigger.click();
          const item = page.getByRole('menuitem', { name: title + ' 패널 열기', exact: true });
          if (input === 'keyboard') { await item.focus(); await page.keyboard.press('Enter'); } else await item.click();
          await browserExpect(page.locator(`[data-loaded-panel="${title}"]`)).toBeVisible();
          await browserExpect(page).toHaveURL(new RegExp('panel=' + to));
          await page.evaluate(path => { history.pushState({}, '', path); window.dispatchEvent(new Event('popstate')); }, '/?panel=' + from);
          await browserExpect(page.locator(`[data-loaded-panel="${fromTitle}"]`)).toBeVisible();
        }
      }
    }
    expect(await page.evaluate(() => (globalThis as unknown as { __badPanels: string[] }).__badPanels)).toEqual([]);
    await page.getByRole('textbox', { name: '맛집 검색어 입력' }).fill('검증 과업');
    await browserExpect(page.locator('[data-loaded-panel="검색"]')).toBeVisible();
    await browserExpect(page).toHaveURL('https://renewal.test/');
    // Fresh mount with an import delayed at the transport boundary.
    await page.goto('https://renewal.test/?panel=notifications');
    await page.evaluate(() => Object.assign(globalThis, { __heldPanels: ['알림'], __failedPanels: ['알림'] }));
    await page.addScriptTag({ content: script });
    await browserExpect(page.getByRole('status')).toContainText('알림');
    await browserExpect(page.getByTestId('map-home')).toHaveCount(0);
    await page.evaluate(() => (globalThis as unknown as { __fixture: { release(name: string): void } }).__fixture.release('알림'));
    await browserExpect(page.getByRole('alert')).toContainText('다시 시도');
    await page.evaluate(() => (globalThis as unknown as { __fixture: { failed: Set<string>; held: Set<string> } }).__fixture.failed.clear());
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await browserExpect(page.locator('[data-loaded-panel="알림"]')).toBeVisible();
    // A late result from a previous view must never replace the newest choice.
    await page.goto('https://renewal.test/?panel=bookmarks');
    await page.evaluate(() => Object.assign(globalThis, { __heldPanels: ['북마크'] }));
    await page.addScriptTag({ content: script });
    await browserExpect(page.getByRole('status')).toContainText('북마크');
    await page.locator('[data-desktop-map-menu-trigger="true"][data-state]').click();
    await page.getByRole('menuitem', { name: '알림 패널 열기', exact: true }).click();
    await browserExpect(page.locator('[data-loaded-panel="알림"]')).toBeVisible();
    await page.evaluate(() => (globalThis as unknown as { __fixture: { release(name: string): void } }).__fixture.release('북마크'));
    await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toHaveCount(0);
    await page.goBack();
    await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toBeVisible();
    await page.goForward();
    await browserExpect(page.locator('[data-loaded-panel="알림"]')).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  } finally { await browser.close(); }
}, 90_000);

(existsSync(chrome) ? test : test.skip)('panel owner preserves local state and DOM scroll across bookmarks, review and profile but resets it for another account', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
    await page.goto('https://renewal.test/?panel=bookmarks'); await page.addScriptTag({ content: await renewalPanelBundle() });
    async function go(id: string) { await page.evaluate(id => { history.pushState({}, '', '/?panel=' + id); window.dispatchEvent(new Event('popstate')); }, id); }
    for (const id of ['bookmarks', 'feed', 'profile'] as const) {
      await go(id); const panel = page.locator(`[data-loaded-panel="${panels[id]}"]`);
      await browserExpect(panel).toBeVisible(); await panel.getByRole('textbox').fill(id);
      await panel.locator('[data-fixture-scroll]').evaluate(e => { e.scrollTop = 240; });
    }
    for (const id of ['bookmarks', 'feed', 'profile'] as const) {
      await go(id); const panel = page.locator(`[data-loaded-panel="${panels[id]}"]`);
      await browserExpect(panel).toBeVisible(); await browserExpect(panel.getByRole('textbox')).toHaveValue(id);
      expect(await panel.locator('[data-fixture-scroll]').evaluate(e => e.scrollTop)).toBe(240);
    }
    await page.evaluate(() => (globalThis as unknown as {__fixture:{setAuth(auth:unknown):void}}).__fixture.setAuth({user:{id:'other-owner'},isAuthLoading:false}));
    await browserExpect(page.getByRole('textbox', { name: '프로필 상태', exact: true })).toHaveValue('');
  } finally { await browser.close(); }
}, 30_000);

(existsSync(chrome) ? test : test.skip)('each destination exposes its own import error and retries without a page reload', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await renewalPanelBundle();
    for (const [id, title] of Object.entries(panels)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.route('**/*', route => route.request().resourceType() === 'document'
          ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
        await page.goto('https://renewal.test/?panel=' + id);
        await page.evaluate(title => Object.assign(globalThis, { __failedPanels: [title] }), title);
        await page.addScriptTag({ content: script });
        await browserExpect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await browserExpect(page.getByRole('alert')).toContainText('불러오지 못했어요');
        await page.evaluate(() => (globalThis as unknown as {__fixture:{failed:Set<string>}}).__fixture.failed.clear());
        await page.getByRole('button', { name: '다시 시도', exact: true }).click();
        await browserExpect(page.locator(`[data-loaded-panel="${title}"]`)).toBeVisible();
        await browserExpect(page).toHaveURL('https://renewal.test/?panel=' + id);
        await browserExpect(page.getByRole('alert')).toHaveCount(0);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}, 45_000);

(existsSync(chrome) ? test : test.skip)('a restored bookmark URL survives until the parent clears the old detail selection', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
    await page.goto('https://renewal.test/?panel=bookmarks'); await page.addScriptTag({ content: await renewalPanelBundle() });
    await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toBeVisible();
    await page.evaluate(() => {
      history.pushState({}, '', '/?restaurant=fixture-restaurant'); window.dispatchEvent(new Event('popstate'));
      (globalThis as unknown as {__fixture:{setDetail(value:unknown):void}}).__fixture.setDetail({id:'fixture-restaurant',name:'합성 식당'});
    });
    await browserExpect(page.getByRole('button', { name: '상세 닫기', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      history.replaceState({}, '', '/?panel=bookmarks'); window.dispatchEvent(new Event('popstate'));
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      (globalThis as unknown as {__fixture:{closeDetail():void}}).__fixture.closeDetail();
      window.dispatchEvent(new CustomEvent('home.restore.succeeded'));
    });
    await browserExpect(page).toHaveURL('https://renewal.test/?panel=bookmarks');
    await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toBeVisible();
  } finally { await browser.close(); }
}, 30_000);

for (const surface of ['outer-mobile','outer-desktop'] as const) (existsSync(chrome) ? test : test.skip)(`${surface} shell import failure exposes retry`, async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:surface==='outer-mobile'?390:1440,height:900}});
  await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):route.abort());
  await page.goto('https://renewal.test/');await page.evaluate(()=>Object.assign(globalThis,{__failedPanels:['지도 메뉴']}));await page.addScriptTag({content:await renewalPanelBundle(surface)});
  await browserExpect(page.getByRole('alert')).toBeVisible();
  await page.evaluate(()=>(globalThis as unknown as {__fixture:{failed:Set<string>}}).__fixture.failed.clear());
  await page.getByRole('button',{name:'다시 시도',exact:true}).click();await browserExpect(page.locator('[data-loaded-panel="지도 메뉴"]')).toBeVisible();
 }finally{await browser.close();}
},20000);
for (const destination of ['bookmark','notification','search'] as const) (existsSync(chrome) ? test : test.skip)(`authenticated mobile ${destination} import failure retries its own destination`, async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):route.abort());
  await page.goto('https://renewal.test/');await page.evaluate(destination=>Object.assign(globalThis,{__failedPanels:['북마크','알림','검색'],__initialIntent:destination}),destination);
  await page.addScriptTag({content:await renewalPanelBundle('mobile')});
  const title={bookmark:'북마크',notification:'알림',search:'검색'}[destination];
  await browserExpect(page.getByRole('alert')).toBeVisible();await browserExpect(page.getByText(/로그인 후 .*확인할 수 있어요/)).toHaveCount(0);
  if(destination==='search')await page.getByPlaceholder('쯔동여지도 검색하기').fill('보존할 검색어');
  await page.evaluate(title=>(globalThis as unknown as {__fixture:{failed:Set<string>}}).__fixture.failed.delete(title),title);
  await page.getByRole('button',{name:'다시 시도',exact:true}).click();await browserExpect(page.locator('[data-loaded-panel="'+title+'"]')).toBeVisible();
  if(destination==='search')await browserExpect(page.getByPlaceholder('쯔동여지도 검색하기')).toHaveValue('보존할 검색어');
  expect(errors).toEqual([]);
 }finally{await browser.close();}
},20000);

for (const surface of ['outer-mobile','outer-desktop','bookmark','notification','search'] as const) (existsSync(chrome) ? test : test.skip)(`${surface} cold import keeps its loading destination`, async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const mobile=!surface.startsWith('outer');const title=mobile?{bookmark:'북마크',notification:'알림',search:'검색'}[surface as 'bookmark'|'notification'|'search']:'지도 메뉴';
  const page=await browser.newPage({viewport:{width:surface==='outer-desktop'?1440:390,height:900}});
  await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):route.abort());
  await page.goto('https://renewal.test/');await page.evaluate(({title,surface})=>Object.assign(globalThis,{__heldPanels:[title],__initialIntent:surface}),{title,surface});
  await page.addScriptTag({content:await renewalPanelBundle(mobile?'mobile':surface as 'outer-mobile'|'outer-desktop')});
  await browserExpect(page.locator('[data-deferred-panel-state="loading"]')).toBeVisible();
  await browserExpect(page.getByText(/로그인 후 .*확인할 수 있어요/)).toHaveCount(0);
  await page.evaluate(title=>(globalThis as unknown as {__fixture:{release(title:string):void}}).__fixture.release(title),title);
  await browserExpect(page.locator('[data-loaded-panel="'+title+'"]')).toBeVisible();
 }finally{await browser.close();}
},20000);
(existsSync(chrome) ? test : test.skip)('late mobile bookmark load cannot replace the selected notification destination', async () => {
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}):route.abort());
  await page.goto('https://renewal.test/');await page.evaluate(()=>Object.assign(globalThis,{__heldPanels:['북마크','알림'],__initialIntent:'bookmark'}));
  await page.addScriptTag({content:await renewalPanelBundle('mobile')});await browserExpect(page.getByRole('heading',{name:'북마크',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'알림',exact:true}).click();
  await browserExpect(page.getByRole('heading',{name:'알림',exact:true})).toBeVisible();
  await page.evaluate(()=>(globalThis as unknown as {__fixture:{release(title:string):void}}).__fixture.release('북마크'));
  await browserExpect(page.getByRole('heading',{name:'알림',exact:true})).toBeVisible();await browserExpect(page.locator('[data-loaded-panel="북마크"]')).toHaveCount(0);
  await page.evaluate(()=>(globalThis as unknown as {__fixture:{release(title:string):void}}).__fixture.release('알림'));
  await browserExpect(page.locator('[data-loaded-panel="알림"]')).toBeVisible();
 }finally{await browser.close();}
},20000);
