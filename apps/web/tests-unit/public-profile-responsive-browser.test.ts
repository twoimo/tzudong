import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Locator, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { buildPublicProfileResponsiveFixture } from './fixtures/public-profile-responsive-fixture';
import { compileResponsiveCss } from './fixtures/responsive-css';

let browser: Browser;
let script: string;
let appCss: string;
let homeCss: string;

beforeAll(async () => {
  script = await buildPublicProfileResponsiveFixture();
  appCss = await compileResponsiveCss(['globals.css', 'app-globals.css', 'home-interactive-globals.css']);
  homeCss = await compileResponsiveCss(['globals.css', 'home-app-globals.css', 'home-interactive-globals.css']);
}, 60_000);

afterAll(async () => { await browser?.close(); });

async function openProfile(width: number, height: number) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto('https://public-profile.fixture.test/');
  await page.addStyleTag({ content: width >= 1280 ? homeCss : appCss });
  await page.addScriptTag({ content: script });
  await ui(page.getByRole('tablist')).toBeVisible();
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  return { context, page, errors };
}

// Visibility alone misses clipped descendants. Require the complete control to
// be within the available frame, and hit-test its centre against real paint.
async function expectReachable(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const frame = (await page.locator('[data-fixture-profile-frame]').boundingBox())!;
  const box = (await target.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
  expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  expect(await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const painted = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return painted === element || (painted !== null && element.contains(painted));
  })).toBe(true);
}

async function reachLastItem(page: Page, name: string, last: Locator) {
  const tab = page.getByRole('tab', { name });
  await tab.focus();
  await ui(tab).toBeFocused();
  await expectReachable(page, tab);
  await tab.press('Enter');
  await ui(tab).toHaveAttribute('aria-selected', 'true');
  const body = page.getByRole('tabpanel').locator(':scope > div');
  expect(await body.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(128);
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

  // Scroll the actual per-tab owner so its production IntersectionObserver
  // admits the next page; no forced clicks or replacement pagination logic.
  if (await last.count() === 0) {
    await body.scrollIntoViewIfNeeded();
    await body.hover();
    await page.mouse.wheel(0, 20_000);
    await ui.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  await ui(last).toHaveCount(1);
  await expectReachable(page, last);
  await last.focus();
  await ui(last).toBeFocused();
  await last.press('Enter');
}

for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [844, 390], [454, 312], [1440, 900]]) {
  test(`public profile keeps all tabs and final items reachable at ${width}x${height}`, async () => {
    const { context, page, errors } = await openProfile(width, height);
    try {
      const owner = page.locator('[data-user-profile-scroll="true"]');
      const initial = await owner.evaluate(element => ({ height: element.clientHeight, total: element.scrollHeight }));
      if (height <= 390) expect(initial.total).toBeGreaterThan(initial.height);
      else expect(initial.total).toBeLessThanOrEqual(initial.height + 1);

      await reachLastItem(page, '도장 (30)', page.getByRole('button', { name: '검증 맛집 30 맛집 상세 열기', exact: true }));
      await reachLastItem(page, '리뷰 (30)', page.getByRole('button', { name: '검증 맛집 30 맛집 상세 보기', exact: true }));
      await reachLastItem(page, '좋아요 (30)', page.getByRole('link', { name: /^검증 사용자 30 / }));
      const back = page.getByRole('button', { name: width >= 1280 ? '프로필 패널 닫기' : '프로필 뒤로 가기', exact: true });
      await expectReachable(page, back);
      await back.click();
      expect(await page.evaluate(() => {
        const fixture = (globalThis as unknown as { __profileFixture: { writes: number; back: number; openedUsers: string[]; openedRestaurants: string[] } }).__profileFixture;
        return { writes: fixture.writes, back: fixture.back, users: fixture.openedUsers, restaurants: fixture.openedRestaurants };
      })).toEqual({ writes: 0, back: 1, users: ['liker-30'], restaurants: ['restaurant-30', 'restaurant-30'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }, 45_000);
}

test('short profile loading, retry, missing and empty states remain reachable', async () => {
  const { context, page, errors } = await openProfile(454, 312);
  const mode = (value: string) => page.evaluate(value => {
    (globalThis as unknown as { __profileFixture: { setMode(value: string): void } }).__profileFixture.setMode(value);
  }, value);
  try {
    await mode('loading');
    const skeleton = page.locator('[data-user-profile-panel-skeleton]');
    await ui(skeleton).toBeVisible();
    expect(await skeleton.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expectReachable(page, skeleton.locator('article').last());

    await mode('error');
    const retry = page.getByRole('button', { name: '다시 시도', exact: true });
    await expectReachable(page, retry);
    await retry.click();
    expect(await page.evaluate(() => (globalThis as unknown as { __profileFixture: { retries: number } }).__profileFixture.retries)).toBe(1);

    await mode('missing');
    await expectReachable(page, page.getByText('사용자를 찾을 수 없습니다', { exact: true }));
    await mode('tab-error');
    await ui(page.getByRole('tablist')).toBeVisible();
    await expectReachable(page, page.getByRole('button', { name: '다시 시도', exact: true }));
    await mode('empty');
    await expectReachable(page, page.getByText('아직 도장이 없습니다', { exact: true }));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 30_000);
