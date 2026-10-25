import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect as browserExpect } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = chromeForTestingExecutable();
const artifactDir = resolve(root, 'performance/renewal-20261023/chrome');
const entry = `
import React, { useState } from 'react';import { createRoot } from 'react-dom/client';
import { MapPanelHeader } from './components/home/map-panel-chrome';
import { DeviceLocationDisclosure } from './components/home/DeviceLocationDisclosure';
import { Button } from './components/ui/button';import { Badge } from './components/ui/badge';
import { wrapMarkerWithPopularityTier, syncPopularityMarkerZoom } from './lib/evidence-engineering/popularity-marker';
const state=globalThis.__chrome={actions:0,closed:0,location:0,zoom(value){syncPopularityMarkerZoom(document.querySelector('[data-fixture-marker]'),value)}};
function App(){const [title,setTitle]=useState('긴 상호명 확인');state.setTitle=setTitle;return <main className="mx-auto mt-4 space-y-4 border border-border bg-card" style={{width:'min(392px,calc(100vw - 32px))'}}>
<MapPanelHeader title={title} wrapTitle titleAs="h2" closeLabel="맛집 상세 닫기" onClose={()=>state.closed++} titleAddon={<><Badge>한식</Badge><Badge>분식</Badge></>} actions={<><Button variant="outline" onClick={()=>state.actions++}>저장</Button><Button variant="outline" onClick={()=>state.actions++}>공유</Button><Button variant="outline" onClick={()=>state.actions++}>길찾기</Button></>}/>
<div className="p-4"><DeviceLocationDisclosure id="fixture-location" onConfirm={()=>state.location++}><Button>현재 위치</Button></DeviceLocationDisclosure></div>
<div data-fixture-marker className="relative mx-auto mt-12 h-16 w-16" dangerouslySetInnerHTML={{__html:wrapMarkerWithPopularityTier('<span>맛집</span>','fire')}}/>
</main>};createRoot(document.getElementById('root')).render(<App/>);
`;

(existsSync(chrome) ? test : test.skip)('real panel chrome preserves long titles, actions, location consent and zoom hysteresis in seven viewports and both themes', async () => {
  const built = await Bun.build({ entrypoints: ['chrome-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'chrome-fixture', setup(builder) {
      builder.onResolve({ filter: /^chrome-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: root }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), root) }));
    }}] });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  const script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
  const css = await postcss([tailwind()]).process('@import "./app/globals.css";\n@import "./app/home-app-globals.css";\n@import "./app/home-detail-globals.css";', { from: join(root, 'renewal-fixture.css') });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  mkdirSync(artifactDir, { recursive: true });
  try {
    for (const [width, height] of [[360,800],[390,844],[768,1024],[1024,768],[1440,900],[1518,954],[1920,1080]]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
        try {
          const page = await context.newPage();
          await page.route('**/*', route => route.request().resourceType() === 'document'
            ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }) : route.abort());
          await page.goto('https://chrome.test/');
          await page.addStyleTag({ content: css.css });
          await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
          await page.addScriptTag({ content: script });
          for (const title of ['유성분식', '맛있는한식과분식을함께하는아주긴상호명불당신도시본점', 'TheVeryLongRestaurantNameWithoutSpacesAndWithSeveralBranches']) {
            await page.evaluate(title => (globalThis as unknown as { __chrome: {setTitle(value: string): void} }).__chrome.setTitle(title), title);
            const heading = page.getByRole('heading', { name: title, exact: true });
            await browserExpect(heading).toBeVisible();
            const bounds = await heading.boundingBox();
            const close = await page.getByRole('button', { name: '맛집 상세 닫기', exact: true }).boundingBox();
            expect(bounds && close && bounds.x + bounds.width <= close.x).toBe(true);
            expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
          }
          for (const name of ['저장', '공유', '길찾기']) await page.getByRole('button', { name, exact: true }).click();
          await page.getByRole('button', { name: '맛집 상세 닫기', exact: true }).click();
          expect(await page.evaluate(() => {const s=(globalThis as unknown as {__chrome:{actions:number;closed:number}}).__chrome;return [s.actions,s.closed]})).toEqual([3,1]);
          await page.getByRole('button', { name: '현재 위치', exact: true }).click();
          await browserExpect(page.getByRole('alertdialog')).toBeVisible();
          expect(await page.evaluate(()=>(globalThis as unknown as {__chrome:{location:number}}).__chrome.location)).toBe(0);
          await page.getByRole('button', { name: '취소', exact: true }).click();
          expect(await page.evaluate(()=>(globalThis as unknown as {__chrome:{location:number}}).__chrome.location)).toBe(0);
          await page.getByRole('button', { name: '현재 위치', exact: true }).click();
          await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
          expect(await page.evaluate(()=>(globalThis as unknown as {__chrome:{location:number}}).__chrome.location)).toBe(1);
          for (const [zoom, visible] of [[12.9,false],[13,true],[12.75,true],[12.5,false],[Number.NaN,false],[13,true]] as const) {
            await page.evaluate(zoom => (globalThis as unknown as {__chrome:{zoom(value:number):void}}).__chrome.zoom(zoom), zoom);
            expect(await page.locator('.tz-popularity-flame').evaluate(element => getComputedStyle(element).display !== 'none')).toBe(visible);
          }
          expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await page.screenshot({ path: join(artifactDir, `${width}-${theme}.png`) });
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}, 90_000);
