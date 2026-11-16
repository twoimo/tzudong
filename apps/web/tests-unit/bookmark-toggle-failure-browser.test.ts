import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as ui } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const restaurant = {
  id: 'restaurant-fixture', approved_name: '합성 식당', categories: ['한식'], road_address: '검증용 주소',
  jibun_address: null, youtube_link: null, review_count: 0, lat: 37.5, lng: 127, status: 'approved',
};

async function fixture() {
  const mocks: Record<string, string> = {
    '@/contexts/AuthContext': `export const useAuth=()=>({user:{id:'user-fixture'}});`,
    '@/integrations/supabase/client': `const restaurant=${JSON.stringify(restaurant)};
      const bookmark={id:'bookmark-fixture',user_id:'user-fixture',restaurant_id:restaurant.id,created_at:'2026-01-01T00:00:00Z'};
      export const supabase={from(table){const call={table,write:false,head:false,single:false};const chain={
        select(_,options){call.head=Boolean(options&&options.head);return chain},insert(){call.write=true;return chain},delete(){call.write=true;return chain},
        eq(){return chain},in(){return chain},order(){return chain},maybeSingle(){call.single=true;return chain},
        then(resolve,reject){const result=call.write?{data:null,error:{message:'SYNTHETIC_WRITE_FAILURE'}}
          :table==='user_bookmarks'?(call.head?{count:1,error:null}:{data:[bookmark],error:null})
          :{data:call.single?restaurant:[restaurant],error:null};return Promise.resolve(result).then(resolve,reject)}};return chain}};`,
    'next/navigation': `export const usePathname=()=>'/mypage/bookmarks';`,
    'next/link': `import React from 'react';export default function Link({href,prefetch,...props}){return <a href={String(href)} {...props}/>}`,
    'next/image': `import React from 'react';export default function Image({fill,priority,unoptimized,loader,...props}){return <img {...props}/>}`,
  };
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{BookmarkButton}from'./components/ui/bookmark-button';import DesktopLeftPanelBookmarks from'./components/home/DesktopLeftPanelBookmarks';
    import BookmarksPage from'./app/mypage/bookmarks/page';import{AppToaster}from'./components/ui/app-toaster';
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}>
      <section aria-label="bookmark-button"><BookmarkButton restaurantId="${restaurant.id}"/></section>
      <section aria-label="desktop-panel"><DesktopLeftPanelBookmarks onRestaurantOpen={()=>{}}/></section>
      <section aria-label="mypage"><BookmarksPage/></section><AppToaster/></QueryClientProvider>);`;
  const result = await Bun.build({ entrypoints: ['bookmark-toggle-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'bookmark-toggle', setup(builder) {
      builder.onResolve({ filter: /^bookmark-toggle-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'stylesheet', namespace: 'fixture-css' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-css' }, () => ({ contents: '', loader: 'js' }));
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => mocks[args.path]
        ? { path: args.path, namespace: 'mock' }
        : args.path.startsWith('@/') ? { path: Bun.resolveSync('./' + args.path.slice(2), root) } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    }}] });
  if (!result.success) throw new Error(result.logs.map(String).join('\n'));
  const script = await result.outputs.find(item => item.path.endsWith('.js'))!.text();
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><body><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"test"}};'
    + script.replaceAll('</script', '<\\/script') + '</script></body></html>';
}

(existsSync(chrome) ? test : test.skip)('a failed bookmark write from every caller shows an error toast and raises no unhandled rejection', async () => {
  const html = await fixture();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const state = globalThis as unknown as { __unhandled: string[] };
      state.__unhandled = [];
      addEventListener('unhandledrejection', event => state.__unhandled.push(String(event.reason?.message ?? event.reason)));
    });
    await page.route('**/*', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: html })
      : route.abort());
    await page.goto('https://bookmark-toggle.test/');
    const drainUnhandled = () => page.evaluate(() => (globalThis as unknown as { __unhandled: string[] }).__unhandled.splice(0));
    const toast = page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem')
      .filter({ hasText: '북마크를 해제하지 못했습니다' }).filter({ hasText: '잠시 후 다시 시도해 주세요.' });
    const outcomes: unknown[] = [];

    for (const caller of ['bookmark-button', 'desktop-panel', 'mypage']) {
      const region = page.getByRole('region', { name: caller });
      const button = caller === 'bookmark-button'
        ? region.getByTitle('북마크 해제', { exact: true })
        : region.getByRole('button', { name: '합성 식당 북마크 삭제', exact: true });
      await ui(button).toBeEnabled();
      await button.click();
      await ui.poll(async () => await page.evaluate(() => (globalThis as unknown as { __unhandled: string[] }).__unhandled.length) + await toast.count(),
        { message: `${caller} failure surfaced` }).toBeGreaterThan(0);
      await page.waitForTimeout(50);
      await ui(button, `${caller} keeps the bookmark after the failed removal`).toBeEnabled();
      outcomes.push({ caller, toastShown: await toast.isVisible(), unhandled: await drainUnhandled() });
      if (await toast.count()) {
        await toast.getByRole('button').click();
        await ui(toast).toHaveCount(0);
      }
    }
    expect(outcomes).toEqual(['bookmark-button', 'desktop-panel', 'mypage'].map(caller => ({ caller, toastShown: true, unhandled: [] })));
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60_000);
