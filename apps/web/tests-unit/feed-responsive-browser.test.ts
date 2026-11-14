import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { buildFeedResponsiveFixture } from './fixtures/feed-responsive-fixture';
import { compileResponsiveCss } from './fixtures/responsive-css';

let browser: Browser;
let homeScript: string;
let feedScript: string;
let css: string;

beforeAll(async () => {
  [homeScript, feedScript, css] = await Promise.all([
    buildFeedResponsiveFixture('home-link'),
    buildFeedResponsiveFixture('feed'),
    compileResponsiveCss(['globals.css', 'app-globals.css', 'home-interactive-globals.css']),
  ]);
});

afterAll(async () => { await browser?.close(); });

async function run(width: number, height: number, route: string, script: string, check: (page: Page) => Promise<void>) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', request => request.request().resourceType() === 'document'
    ? request.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : request.abort());
  try {
    await page.goto(`https://responsive-feed.test${route}`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
    await check(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [1090, 749], [1279, 768], [1280, 768], [1363, 936]]) {
  test(`a cold review share link reaches the URL-owned feed at ${width}x${height}`, async () => run(width, height,
    '/?review=fixture-review&mode=overseas', homeScript, async page => {
      await ui(page.locator('[data-route-fixture]')).toBeVisible();
      await ui.poll(() => {
        const url = new URL(page.url());
        return { pathname: url.pathname, panel: url.searchParams.get('panel'), review: url.searchParams.get('review') };
      }).toEqual({ pathname: width < 1280 ? '/feed' : '/', panel: width < 1280 ? null : 'feed', review: 'fixture-review' });
      if (width >= 1280) expect(new URL(page.url()).searchParams.get('mode')).toBe('overseas');
      expect(await page.evaluate(() => (globalThis as unknown as { __routeReplacements: string[] }).__routeReplacements.length)).toBe(1);
    }), 30_000);
}

test('an already selected desktop feed stays stable and follows the tablet breakpoint on resize', async () => run(1363, 936,
  '/?panel=feed&review=fixture-review', homeScript, async page => {
    await ui(page.locator('[data-route-fixture]')).toBeVisible();
    expect(await page.evaluate(() => (globalThis as unknown as { __routeReplacements: string[] }).__routeReplacements)).toEqual([]);
    await page.setViewportSize({ width: 1090, height: 749 });
    await ui(page).toHaveURL('https://responsive-feed.test/feed?review=fixture-review');
  }), 30_000);

test('review identifiers stay one encoded query value on a tablet share link', async () => run(820, 1180,
  '/?review=fixture%26review%3D%ED%95%9C%EC%B6%94', homeScript, async page => {
    await ui(page).toHaveURL('https://responsive-feed.test/feed?review=fixture%26review%3D%ED%95%9C%EC%B6%94');
    expect(new URL(page.url()).searchParams.getAll('review')).toEqual(['fixture&review=한추']);
  }), 30_000);

for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [1090, 749], [844, 390], [454, 312]]) {
  test(`feed controls clear the measured bottom nav and restore after scrolling and login at ${width}x${height}`, async () => run(width, height,
    '/feed', feedScript, async page => {
      const nav = page.getByRole('navigation', { name: '주요 탐색', exact: true });
      const write = page.getByRole('button', { name: '리뷰 작성', exact: true });
      const feed = page.locator('[data-scroll-owner="feed-list"]');
      await ui(write).toBeVisible();
      await ui(nav).toBeVisible();
      const assertClearance = async () => {
        await ui.poll(async () => {
          const button = await write.boundingBox();
          const bottomNav = await nav.boundingBox();
          return button && bottomNav ? bottomNav.y - (button.y + button.height) : -1;
        }).toBeGreaterThanOrEqual(15);
        for (const button of await nav.getByRole('button').all()) {
          expect(await button.evaluate(element => {
            const box = element.getBoundingClientRect();
            const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return target !== null && element.contains(target);
          })).toBe(true);
        }
      };
      await assertClearance();
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 500);
      await ui.poll(() => feed.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await ui.poll(() => page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-bottom-nav-effective-height')))).toBe(0);
      await ui.poll(async () => {
        const box = await write.boundingBox();
        return box ? Math.round(height - box.y - box.height) : -1;
      }).toBe(16);

      await page.mouse.wheel(0, -1000);
      await ui.poll(() => feed.evaluate(element => element.scrollTop)).toBe(0);
      await assertClearance();
      await write.click();
      await ui(page.getByRole('dialog')).toBeVisible();
      await ui(write).toHaveCount(0);
      await page.keyboard.press('Escape');
      await ui(page.getByRole('dialog')).toHaveCount(0);
      await ui(write).toBeVisible();
      await assertClearance();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.evaluate(() => (globalThis as unknown as { __fixtureWrites: number }).__fixtureWrites)).toBe(0);
    }), 30_000);
}
