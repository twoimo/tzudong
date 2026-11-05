import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';

const app = join(import.meta.dir, '..');
const chromeAvailable = existsSync(chromium.executablePath());
const browserTest = chromeAvailable ? test : test.skip;
const ui = browserExpect.configure({ timeout: 1500 });
const baseline = process.env.SCROLL_REVEAL_BASELINE === '73edf0720d9ec3a8dcdfc1a102767ad52481cce6';
let browser: Browser;
let script: string;
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ScrollEffects} from './components/layout/ScrollEffects';
const original=document.querySelectorAll.bind(document);
window.scrollFixture={scans:0,unmount:()=>{}};
document.querySelectorAll=(selector)=>{if(selector==='[data-scroll-reveal]')window.scrollFixture.scans++;return original(selector);};
const root=createRoot(document.getElementById('react-root'));
root.render(<><ScrollEffects/><main id="scroller" style={{height:'100vh',overflowY:'auto'}}>
{Array.from({length:12},(_,i)=><section key={i} data-scroll-reveal="panel" id={'panel-'+i} style={{height:300,marginBottom:24,border:'1px solid gray'}}><h2>Section {i+1}</h2><button>Action {i+1}</button></section>)}
</main><div id="noise"/></>);
window.scrollFixture.unmount=()=>root.unmount();
`;

beforeAll(async () => {
  if (!chromeAvailable) return;
  const bundle = await Bun.build({ entrypoints: ['scroll-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'scroll-fixture', setup(builder) {
      builder.onResolve({ filter: /^scroll-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: app }));
      if (baseline) {
        builder.onResolve({ filter: /components\/layout\/ScrollEffects$/ }, () => ({ path: 'ScrollEffects.tsx', namespace: 'baseline' }));
        builder.onLoad({ filter: /.*/, namespace: 'baseline' }, () => ({ contents: execFileSync('git', ['show', '73edf0720d9ec3a8dcdfc1a102767ad52481cce6:apps/web/components/layout/ScrollEffects.tsx'], { cwd: app, encoding: 'utf8' }), loader: 'tsx', resolveDir: app }));
      }
      builder.onResolve({ filter: /^@\// }, ({ path }) => {
        const target = join(app, path.slice(2));
        const resolved = ['', '.ts', '.tsx'].map(suffix => target + suffix).find(existsSync);
        return resolved ? { path: resolved } : undefined;
      });
    } }] });
  expect(bundle.success).toBe(true); script = await bundle.outputs[0].text();
  browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
});
afterAll(async () => { await browser?.close(); });

async function run(check: (page: Page) => Promise<void>, width = 390, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion });
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="react-root"></div></body></html>' }) : route.abort());
  try {
    await page.goto('http://scroll.fixture.test/');
    const productCss = baseline ? execFileSync('git', ['show', '73edf0720d9ec3a8dcdfc1a102767ad52481cce6:apps/web/styles/product-ui.css'], { cwd: app, encoding: 'utf8' }) : readFileSync(join(app, 'styles/product-ui.css'), 'utf8');
    await page.addStyleTag({ content: readFileSync(join(app, 'styles/interface-motion.css'), 'utf8') + '\n' + productCss });
    await page.addScriptTag({ content: script });
    await page.getByRole('heading', { name: 'Section 1', exact: true }).waitFor();
    await check(page); expect(errors).toEqual([]);
  } finally { await context.close(); }
}

for (const width of [390, 820, 1440]) {
  browserTest(`scroll reveal remains readable, completes once and respects keyboard focus at ${width}px`, async () => run(async page => {
    await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'waiting');
    expect(await page.locator('#panel-0').getAttribute('data-reveal-state')).not.toBe('waiting');
    await page.locator('#panel-11').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined))));
    expect(await page.locator('#panel-11').evaluate(el => Number(getComputedStyle(el).opacity))).toBeGreaterThanOrEqual(.9);
    await page.getByRole('button', { name: 'Action 12', exact: true }).focus();
    await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'visible');
    await page.locator('#scroller').evaluate(el => { el.scrollTop = 0; });
    await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'visible');
  }, width));
}

browserTest('unrelated child mutations do not rescan the entire document', async () => run(async page => {
  await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'waiting');
  const before = await page.evaluate(() => (window as unknown as { scrollFixture: { scans: number } }).scrollFixture.scans);
  await page.locator('#noise').evaluate(el => { for (let i = 0; i < 200; i++) el.appendChild(document.createElement('span')); });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => (window as unknown as { scrollFixture: { scans: number } }).scrollFixture.scans)).toBe(before);
}));

browserTest('starting with reduced motion can later enable it, and disable it without hiding content', async () => run(async page => {
  expect(await page.locator('#panel-11').getAttribute('data-reveal-state')).toBeNull();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'waiting');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ui(page.locator('#panel-11')).not.toHaveAttribute('data-reveal-state', 'waiting');
  expect(await page.locator('#panel-11').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
}, 390, 'reduce'));

browserTest('removing waiting elements clears stale state and unmount disconnects mutation work', async () => run(async page => {
  await ui(page.locator('#panel-11')).toHaveAttribute('data-reveal-state', 'waiting');
  await page.locator('#panel-11').evaluate(el => { el.remove(); document.getElementById('noise')!.appendChild(el); });
  await ui(page.locator('#panel-11')).not.toHaveAttribute('data-reveal-state', 'waiting');
  await page.evaluate(() => (window as unknown as { scrollFixture: { unmount: () => void } }).scrollFixture.unmount());
  await page.locator('body').evaluate(el => { el.appendChild(document.createElement('div')); });
  expect(await page.locator('[data-reveal-state="waiting"]').count()).toBe(0);
}));
