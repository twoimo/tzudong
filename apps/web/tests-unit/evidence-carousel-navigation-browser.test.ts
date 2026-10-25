import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from '@typescript/old';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, expect as ui } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = chromium.executablePath();
const localTest = existsSync(chrome) ? test : test.skip;
const rows = JSON.parse(readFileSync(resolve(appRoot, '../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
const frames = rows.frames.slice(0, 3).map((row: { frame: unknown }) => row.frame);

function actualPanelSwipeDeclarations(): string {
  const source = ts.createSourceFile('RestaurantDetailPanel.tsx', readFileSync(join(appRoot, 'components/restaurant/RestaurantDetailPanel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['RESTAURANT_DETAIL_SWIPE_THRESHOLD', 'RESTAURANT_DETAIL_SWIPE_INTENT_RATIO',
    'contentSwipeStartXRef', 'contentSwipeStartYRef', 'contentSwipeDirectionRef', 'isContentSwipingRef',
    'handleContentSwipeStart', 'handleContentSwipeMove', 'handleContentSwipeEnd', 'handleContentSwipeCancel']);
  const declarations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
      names.delete(node.name.text);
      declarations.push(`const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect([...names]).toEqual([]);
  return declarations.join('\n');
}

async function bundle() {
  const entry = `import React, { useCallback, useRef } from 'react'; import { createRoot } from 'react-dom/client';
    import { RestaurantVideoCarousel } from './components/restaurant/RestaurantVideoCarousel';
    import { handleDesktopArrowNavigationEvent } from './lib/home-map-keyboard-navigation';
    let navigations = 0, panelStarts = 0;
    window.sceneFixture = { reset: () => { navigations = 0; panelStarts = 0; }, count: () => navigations, starts: () => panelStarts };
    window.addEventListener('keydown', event => handleDesktopArrowNavigationEvent({ event,
      isDesktop: innerWidth >= 1024, isPanelOpen: true, hasCurrentRestaurant: true, swipeableCount: 2,
      onNavigate: () => { navigations++; return true; } }));
    function App() {
      const onSwipeLeft = () => { navigations++; }, onSwipeRight = onSwipeLeft, hideSwipeHint = () => { panelStarts++; };
      ${actualPanelSwipeDeclarations()}
      return <div style={{width:'min(100%,420px)'}} onTouchStart={handleContentSwipeStart} onTouchMove={handleContentSwipeMove}
        onTouchEnd={handleContentSwipeEnd} onTouchCancel={handleContentSwipeCancel}>
        <div id='outside' tabIndex={0} style={{height:100}}>Restaurant navigation area</div>
        <RestaurantVideoCarousel videos={[]} frames={[${JSON.stringify(frames)}]} />
      </div>;
    }
    createRoot(document.getElementById('root')).render(<App />);`;
  const built = await Bun.build({ entrypoints: ['scene-navigation-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'scene-navigation', setup(builder) {
      builder.onResolve({ filter: /^scene-navigation-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), appRoot) }));
    }}] });
  expect(built.success).toBe(true);
  return built.outputs[0].text();
}

for (const width of [1440, 390, 820]) {
  localTest(`scene navigation keeps the restaurant selected at ${width}px`, async () => {
    const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
    try {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
      const page = await context.newPage();
      const errors: string[] = [], external: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://scene-navigation.test') { external.push(url.origin); return route.abort(); }
        if (url.pathname.startsWith('/evidence-frames/')) return route.fulfill({contentType:'image/webp', body:readFileSync(join(appRoot,'public',url.pathname))});
        return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"test"}};</script></body></html>'});
      });
      const css = await postcss([tailwind()]).process('@import "./app/globals.css";\n@import "./app/home-detail-globals.css";', {from:join(appRoot,'scene-navigation-fixture.css')});
      await page.goto('https://scene-navigation.test/');
      await page.addStyleTag({content:css.css});
      await page.addScriptTag({ content: await bundle() });
      const carousel = page.getByRole('region', {name:'쯔양 영상과 장면 넘기기',exact:true});
      const choices = page.getByRole('group', {name:'영상과 장면 바로 선택'}).getByRole('button');
      await ui(choices).toHaveCount(3);
      await ui(choices.nth(0)).toHaveAttribute('aria-pressed','true');
      await ui(page.getByRole('button',{name:'다음 영상 또는 장면',exact:true})).toBeEnabled();
      const count = () => page.evaluate(() => (window as unknown as {sceneFixture:{count():number}}).sceneFixture.count());
      const starts = () => page.evaluate(() => (window as unknown as {sceneFixture:{starts():number}}).sceneFixture.starts());
      const reset = () => page.evaluate(() => (window as unknown as {sceneFixture:{reset():void}}).sceneFixture.reset());
      if (width === 1440) {
        await carousel.focus(); await page.keyboard.press('ArrowRight');
        expect(await count()).toBe(0);
        await ui(choices.nth(1)).toHaveAttribute('aria-pressed','true');
        await page.locator('#outside').focus(); await page.keyboard.press('ArrowRight');
        expect(await count()).toBe(1);
        await reset();
        await choices.nth(0).click();
        await ui(choices.nth(0)).toHaveAttribute('aria-pressed','true');
      }
      const session = await context.newCDPSession(page);
      async function swipe(selector: string) {
        const box = await page.locator(selector).boundingBox();
        if (!box) throw new Error('SWIPE_TARGET_MISSING');
        const x = box.x + Math.min(box.width - 20, 300), y = box.y + Math.min(box.height / 2, 80);
        await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y,id:1}]});
        for (let step = 1; step <= 8; step++) {
          await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:x-step*25,y,id:1}]});
          await page.waitForTimeout(20);
        }
        await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      }
      await swipe('[aria-label="쯔양 영상과 장면 넘기기"]');
      expect(await starts()).toBe(0);
      expect(await count()).toBe(0);
      await ui(choices.nth(1)).toHaveAttribute('aria-pressed','true');
      await swipe('#outside');
      expect(await starts()).toBe(1);
      expect(await count()).toBe(1);
      expect(external).toEqual([]); expect(errors).toEqual([]);
      await context.close();
    } finally { await browser.close(); }
  }, 60_000);
}
