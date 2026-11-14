import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, expect as ui, type Browser } from '@playwright/test';
import PrivacyPage from '../app/privacy/page';
import DataDeletionPage from '../app/data-deletion/page';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { compileResponsiveCss } from './fixtures/responsive-css';

const documents = [
  { name: 'privacy', Component: PrivacyPage, end: '#privacy-authorities' },
  { name: 'data-deletion', Component: DataDeletionPage, end: 'article > footer' },
] as const;
const loadingStates = {
  cold: ['globals.css', 'legal-globals.css'],
  afterHome: ['globals.css', 'home-app-globals.css', 'home-interactive-globals.css', 'legal-globals.css'],
  afterApp: ['globals.css', 'app-globals.css', 'legal-globals.css'],
} as const;
const styles = new Map<keyof typeof loadingStates, string>();
let browser: Browser | undefined;

beforeAll(async () => {
  for (const [state, entries] of Object.entries(loadingStates)) {
    styles.set(state as keyof typeof loadingStates, await compileResponsiveCss(entries));
  }
}, 60_000);
afterAll(async () => { await browser?.close(); });

for (const { name, Component, end } of documents) {
  for (const state of Object.keys(loadingStates) as (keyof typeof loadingStates)[]) {
    test(`${name} keeps styled document scrolling with ${state} CSS at mobile and tablet sizes`, async () => {
      browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route('**/*', route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
          <style>${styles.get(state)}</style></head><body><div data-local-workspace-app="true">
          ${renderToStaticMarkup(createElement(Component))}</div></body></html>`,
      }));
      try {
        for (const [width, height] of [[390, 844], [820, 1180], [1024, 768]]) {
          await page.setViewportSize({ width, height });
          await page.goto(`http://legal-responsive.fixture.test/${name}`);
          expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
          const geometry = await page.locator('main').evaluate(main => {
            const article = main.querySelector('article')!;
            const mainStyle = getComputedStyle(main);
            const articleStyle = getComputedStyle(article);
            return {
              horizontalPadding: mainStyle.paddingLeft,
              verticalPadding: mainStyle.paddingTop,
              articlePadding: articleStyle.paddingLeft,
              articleBorder: articleStyle.borderTopWidth,
              articleMaxWidth: articleStyle.maxWidth,
              articleWidth: article.getBoundingClientRect().width,
              documentWidth: document.documentElement.scrollWidth,
            };
          });
          expect(geometry.horizontalPadding).toBe('16px');
          expect(geometry.verticalPadding).toBe('40px');
          expect(geometry.articlePadding).toBe(width < 640 ? '20px' : '32px');
          expect(geometry.articleBorder).toBe('1px');
          expect(geometry.articleMaxWidth).toBe('768px');
          expect(geometry.articleWidth).toBeLessThanOrEqual(Math.min(768, width - 32));
          expect(geometry.documentWidth).toBe(width);

          await page.keyboard.press('Control+End');
          await ui.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
          await ui(page.locator(end)).toBeInViewport();
          // Keyboard scrolling may still be animating when the final section
          // first enters the viewport. Keep the exact bottom bound and wait for it.
          await ui.poll(() => page.evaluate(() => {
            const doc = document.documentElement;
            return doc.scrollHeight - window.scrollY - window.innerHeight;
          })).toBeLessThanOrEqual(1);

          if (name === 'privacy') {
            const table = page.locator('table');
            expect(await table.evaluate(element => {
              const owner = element.parentElement!;
              return getComputedStyle(owner).overflowX === 'auto' && owner.scrollWidth > owner.clientWidth;
            })).toBe(true);
          }
        }
      } finally { await context.close(); }
    }, 60_000);
  }
}
