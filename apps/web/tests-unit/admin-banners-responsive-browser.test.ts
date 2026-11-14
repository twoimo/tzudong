import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Locator, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import {
  bannerCount,
  buildAdminBannersResponsiveFixture,
  lastBannerTitle,
  type AdminBannersResponsiveMode,
} from './fixtures/admin-banners-responsive-fixture';

let browser: Browser;
let script: string;
let css: string;

beforeAll(async () => {
  ({ script, css } = await buildAdminBannersResponsiveFixture());
}, 60_000);

afterAll(async () => { await browser?.close(); });

async function openBanners(mode: AdminBannersResponsiveMode, width: number, height: number) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  const blockedNetwork: string[] = [];
  page.on('pageerror', error => errors.push(error.message.slice(0, 200)));
  const url = 'https://admin-banners.fixture.test/' + (mode === 'standalone' ? 'admin/banners' : 'admin?module=banners');
  await page.route('**/*', route => {
    if (route.request().resourceType() === 'document' && route.request().url() === url) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    }
    if (route.request().url() === 'https://admin-banners.fixture.test/favicon.ico') return route.fulfill({ status: 204 });
    blockedNetwork.push(route.request().method() + ':' + route.request().resourceType());
    return route.abort();
  });
  await page.goto(url);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  // MainLayout's first hydration branch has no viewport clipping. Measure only
  // after the production mobile/tablet boundary has actually replaced it.
  await ui(page.locator('#main-content')).toHaveCSS('overflow-y', 'hidden');
  await ui(page.locator('.admin-cms-table-container').getByRole('button', { name: new RegExp(lastBannerTitle) })).toHaveCount(1);
  // All requested widths use the production drawer branch after its media query
  // effect settles; the initial wide inspector must no longer size the grid.
  await ui(page.locator('.admin-cms-inspector')).toHaveCount(0);
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  await ui(page.getByRole('navigation', { name: '주요 탐색', exact: true })).toHaveCount(0);
  expect(await page.locator('[data-admin-console-shell]').count()).toBe(mode === 'embedded' ? 1 : 0);
  return { context, page, errors, blockedNetwork };
}

// No scrollIntoView or focus repair: this checks the result of ordinary wheel
// input. Even a hidden ancestor's programmatic scroll must fail the assertion.
async function expectUnclipped(target: Locator, requireHit = true) {
  await ui(target).toBeVisible();
  await ui.poll(() => target.evaluate((element, requireHit) => {
    const box = element.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/(hidden|clip)/.test(style.overflowX) && Math.abs(parent.scrollLeft) > 1) return false;
      if (/(hidden|clip)/.test(style.overflowY) && Math.abs(parent.scrollTop) > 1) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, rect.left + parent.clientLeft);
        right = Math.min(right, rect.left + parent.clientLeft + parent.clientWidth);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, rect.top + parent.clientTop);
        bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight);
      }
    }
    const fits = box.width > 0 && box.height > 0 && box.left >= left - 1 && box.right <= right + 1
      && box.top >= top - 1 && box.bottom <= bottom + 1;
    if (!fits || !requireHit) return fits;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && element.contains(hit);
  }, requireHit)).toBe(true);
}

async function wheelToBottom(page: Page, owner: Locator) {
  await expectUnclipped(owner, false);
  const box = (await owner.boundingBox())!;
  // Use the owner's left padding so a nested textarea/control cannot consume
  // the wheel. Coordinates come from the live, already verified DOM box.
  await page.mouse.move(box.x + Math.min(4, box.width / 2), box.y + box.height / 2);
  await page.mouse.wheel(0, 30_000);
  await ui.poll(() => owner.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
}

async function checkLongList(page: Page, mode: AdminBannersResponsiveMode, width: number) {
  const list = page.locator('.admin-cms-table-container[aria-label="배너 목록"]');
  const footer = page.locator('.admin-cms-list-pane > .admin-cms-footer');
  // The mobile console lets its module grow inside the scrollable outer
  // canvas. Standalone pages and tablet modules bound the inner list instead.
  const usesOuterCanvas = mode === 'embedded' && width < 768;
  const owner = usesOuterCanvas ? page.locator('#admin-console-canvas') : list;
  await ui(footer).toContainText(`${bannerCount} / ${bannerCount}개`);

  // The pre-fix standalone min-height-only chain expands to the 30-row content:
  // it cannot satisfy both a viewport-bounded list box and real internal overflow.
  await ui(owner).toHaveCSS('overflow-y', 'auto');
  await expectUnclipped(owner, false);
  expect(await list.evaluate(element => element.clientHeight)).toBeGreaterThan(0);
  expect(await owner.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  if (!usesOuterCanvas) await expectUnclipped(footer);
  await wheelToBottom(page, owner);
  expect(await owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const last = list.getByRole('button', { name: new RegExp(lastBannerTitle) });
  await expectUnclipped(last);
  await expectUnclipped(footer);
  return { owner, last, footer };
}

async function inspectSelectedBanner(page: Page, last: Locator, height: number) {
  await last.click();
  const dialog = page.getByRole('dialog', { name: '배너 수정', exact: true });
  await ui(dialog).toBeVisible();
  await expectUnclipped(dialog, false);
  await ui(dialog.locator('#title')).toHaveValue(lastBannerTitle);
  const save = dialog.getByRole('button', { name: '수정 저장', exact: true });
  await ui(save).toBeDisabled();
  // Disabled mutation actions are checked geometrically, not hit-tested.
  await expectUnclipped(save, false);

  const body = dialog.locator('fieldset.admin-cms-inspector-body');
  await wheelToBottom(page, body);
  if (height <= 390) expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const confirmation = dialog.getByRole('textbox', { name: '배너 삭제 확인 문구', exact: true });
  await expectUnclipped(confirmation);
  await ui(confirmation).toHaveValue('');
  const remove = dialog.getByRole('button', { name: '삭제', exact: true });
  await ui(remove).toBeDisabled();
  await expectUnclipped(remove, false);
  await ui(save).toBeDisabled();

  // Read-only inspection ends using the real header action. Nothing is typed,
  // toggled, uploaded, saved, deleted, or navigated to an external destination.
  const close = dialog.getByRole('button', { name: '목록으로', exact: true });
  await expectUnclipped(close);
  await close.click();
  await ui(dialog).toHaveCount(0);
  const search = page.getByRole('textbox', { name: '배너 제목·설명 검색', exact: true });
  await ui(search).toBeFocused();
  await expectUnclipped(search);
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    };
    return {
      viewport: [innerWidth, innerHeight], main: measure('#main-content'),
      canvas: measure('#admin-console-canvas'), workspace: measure('.admin-cms-workspace'), list: measure('.admin-cms-table-container'),
      footer: measure('.admin-cms-list-pane > .admin-cms-footer'), editor: measure('.admin-cms-inspector-body'),
    };
  });
}

for (const mode of ['standalone', 'embedded'] as const) {
  for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [844, 390]]) {
    test(`${mode} banners keeps a long list, footer and selected editor reachable at ${width}x${height}`, async () => {
      const { context, page, errors, blockedNetwork } = await openBanners(mode, width, height);
      try {
        const { owner, last, footer } = await checkLongList(page, mode, width);
        await inspectSelectedBanner(page, last, height);
        // Restoring search focus may correctly scroll the mobile canvas back up.
        // Prove the last row and footer remain reachable through wheel input.
        await wheelToBottom(page, owner);
        await expectUnclipped(last);
        await expectUnclipped(footer);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.evaluate(() => {
          const state = (globalThis as unknown as { __adminBannersResponsiveFixture: { reads: number; forbidden: string[] } }).__adminBannersResponsiveFixture;
          return { read: state.reads > 0, forbidden: state.forbidden };
        })).toEqual({ read: true, forbidden: [] });
        expect(errors).toEqual([]);
        expect(blockedNetwork).toEqual([]);
      } catch (error) {
        throw new Error(`Admin banner geometry: ${JSON.stringify(await diagnostics(page))}`, { cause: error });
      } finally { await context.close(); }
    }, 45_000);
  }
}
