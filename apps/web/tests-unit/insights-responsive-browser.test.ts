import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Locator, type Page } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import { buildInsightsResponsiveFixture, type InsightsResponsiveMode } from './fixtures/insights-responsive-fixture';
import { compileResponsiveCss } from './fixtures/responsive-css';

let browser: Browser;
let script: string;
let memberCss: string;
let adminCss: string;

beforeAll(async () => {
  [script, memberCss, adminCss] = await Promise.all([
    buildInsightsResponsiveFixture(),
    compileResponsiveCss(['globals.css', 'app-globals.css', '../styles/product-ui.css']),
    compileResponsiveCss(['globals.css', 'app-globals.css', '../styles/product-ui.css', '../styles/admin-ui.css']),
  ]);
}, 60_000);

afterAll(async () => { await browser?.close(); });

async function openInsights(mode: InsightsResponsiveMode, width: number, height: number) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  // This is a real browser preference; chart rendering and production CSS stay intact.
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: width === 454 && height === 312 });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors: string[] = [];
  let networkRequests = 0;
  page.on('pageerror', error => errors.push(error.message.slice(0, 200)));
  const url = 'https://insights-responsive.fixture.test/' + (mode === 'admin' ? 'admin?module=insights' : 'insights');
  await page.route('**/*', route => {
    if (route.request().url() === url && route.request().resourceType() === 'document') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    }
    if (route.request().url() === 'https://insights-responsive.fixture.test/favicon.ico') return route.fulfill({ status: 204 });
    networkRequests++;
    return route.abort();
  });
  await page.goto(url);
  await page.addStyleTag({ content: mode === 'admin' ? adminCss : memberCss });
  await page.addScriptTag({ content: script });
  // MainLayout initially renders an unbounded hydration branch. Wait for its
  // actual mobile/tablet scroll boundary before measuring a loaded chart.
  await ui(page.locator('#main-content')).toHaveCSS('overflow-y', 'hidden');
  await ui(page.getByRole('heading', { name: '영상 성과 인사이트', exact: true })).toBeVisible();
  await ui(page.locator('[data-insights-card] svg[role="img"]')).toHaveAccessibleName(/조회수.*전체 기간.*8개 영상/);
  return { context, page, errors, networkRequests: () => networkRequests };
}

const cardFor = (page: Page) => page.locator('[data-insights-card="true"]');
const areaFor = (page: Page) => cardFor(page).locator(':scope > [data-slot="card-content"]');
const previewFor = (page: Page) => page.getByRole('dialog', { name: '영상 미리보기', exact: true });

// Visible DOM boxes can still be clipped by a flex ancestor. Check the full
// control against every overflow boundary and its actual painted hit target.
async function expectReachable(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await ui.poll(() => target.evaluate(element => {
    const box = element.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      // Programmatic scrollIntoView must not make an otherwise unreachable
      // control pass by moving an ancestor that touch/wheel cannot scroll.
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
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.left >= left - 1 && box.right <= right + 1
      && box.top >= top - 1 && box.bottom <= bottom + 1 && hit !== null && element.contains(hit);
  })).toBe(true);
}

async function expectChartFitsArea(page: Page, width: number) {
  const area = areaFor(page);
  const minimum = width < 768 ? 220 : 300;
  await ui(area).toHaveCSS('min-height', minimum + 'px');
  await ui.poll(() => area.evaluate((element, minHeight) => {
    const svg = element.querySelector('svg[role="img"]');
    if (!svg) return false;
    const outer = element.getBoundingClientRect(), chart = svg.getBoundingClientRect();
    return chart.width > 0 && chart.height >= minHeight - 1
      && chart.left >= outer.left - 1 && chart.right <= outer.right + 1
      && chart.top >= outer.top - 1 && chart.bottom <= outer.bottom + 1;
  }, minimum)).toBe(true);
  expect(await area.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function scrollChartToBottom(page: Page, height: number) {
  const card = cardFor(page);
  await page.mouse.move(0, 0);
  await ui(previewFor(page)).toHaveCount(0);
  await card.hover();
  await page.mouse.wheel(0, 30_000);
  await ui.poll(() => card.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  if (height <= 390) expect(await card.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await ui(previewFor(page)).toHaveCount(0);
}

function visibleTilePoint(page: Page, middle = false) {
  return areaFor(page).evaluate((element, preferMiddle) => {
    const svg = element.querySelector('svg[role="img"]');
    const card = element.closest('[data-insights-card]')?.getBoundingClientRect();
    if (!svg || !card) return null;
    const paths = [...svg.querySelectorAll('.ztd-mark > path:first-child')]
      .filter(path => Number(getComputedStyle(path).opacity) > 0)
      .map(path => path.getBoundingClientRect())
      .filter(rect => rect.width > 4 && rect.height > 4);
    const finalBottom = Math.max(...paths.map(rect => rect.bottom));
    const points = paths.filter(rect => preferMiddle || rect.bottom >= finalBottom - 1).map(rect => ({
      x: rect.x + rect.width / 2,
      y: preferMiddle
        ? Math.max(rect.top + 2, card.top + 2, Math.min(innerHeight / 2, rect.bottom - 2, card.bottom - 2))
        : rect.bottom - 2,
    })).filter(point => {
      const hit = document.elementFromPoint(point.x, point.y);
      return point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight
        && hit !== null && svg.contains(hit) && hit.closest('.ztd-mark') !== null;
    });
    points.sort((a, b) => preferMiddle ? Math.abs(a.y - innerHeight / 2) - Math.abs(b.y - innerHeight / 2) : b.y - a.y);
    return points[0] ?? null;
  }, middle);
}

async function expectPreviewFields(page: Page, changeMode = false) {
  const preview = previewFor(page);
  await ui(preview).toBeVisible();
  await ui.poll(() => preview.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1
      && rect.top >= -1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1
      && element.scrollHeight <= element.clientHeight + 1;
  })).toBe(true);
  expect(await preview.evaluate(element => !document.querySelector('[data-insights-card]')?.contains(element))).toBe(true);
  const body = preview.locator('[data-insights-preview-body]');
  await ui(body).toHaveCSS('overflow-y', 'auto');
  const fields = body.locator('p');
  await ui(fields).toHaveText([
    /^반응형 검증용 합성 영상 /, /^카테고리:/, /^조회수:/, /^좋아요:/, /^댓글수:/, /^영상 길이:/,
    changeMode ? /증감률:/ : /^비율:/, ...(changeMode ? [/^이전 좋아요:/] : []),
  ]);
  const box = (await body.boundingBox())!;
  expect(box.height).toBeGreaterThan(18);
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.wheel(0, -20_000);
  await ui.poll(() => body.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(1);
  // Read every retained field through normal wheel input. Every text line must
  // fit both axes of its actual scroll owner and viewport when brought into view.
  for (const paragraph of await fields.all()) {
    const delta = await paragraph.evaluate(element => {
      const owner = element.closest('[data-insights-preview-body]')!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.ceil(rect.bottom - owner.bottom));
    });
    if (delta > 0) await page.mouse.wheel(0, delta + 1);
    await ui.poll(() => paragraph.evaluate(element => {
      const owner = element.closest('[data-insights-preview-body]')!;
      const bounds = owner.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      return owner.scrollWidth <= owner.clientWidth + 1 && lines.length > 0 && lines.every(line =>
        line.left >= Math.max(0, bounds.left) - 1 && line.right <= Math.min(innerWidth, bounds.right) + 1
        && line.top >= Math.max(0, bounds.top) - 1 && line.bottom <= Math.min(innerHeight, bounds.bottom) + 1);
    })).toBe(true);
  }
  await ui(preview).toBeVisible();
  return body;
}

async function reachChartBottom(page: Page, width: number, height: number) {
  await expectChartFitsArea(page, width);
  await scrollChartToBottom(page, height);
  // A short card is allowed to show only part of the chart at once. Its last
  // painted tile must nevertheless be reachable through the real wheel owner.
  await ui.poll(() => visibleTilePoint(page)).not.toBeNull();
  const point = (await visibleTilePoint(page))!;
  const focusedBeforeHover = await page.evaluateHandle(() => document.activeElement);
  await page.mouse.move(point.x, point.y);
  await expectPreviewFields(page);
  expect(await page.evaluate(element => document.activeElement === element, focusedBeforeHover)).toBe(true);
  await expectChartFitsArea(page, width);
  await page.keyboard.press('Escape');
  await ui(previewFor(page)).toHaveCount(0);
  expect(await page.evaluate(element => document.activeElement === element, focusedBeforeHover)).toBe(true);
  await focusedBeforeHover.dispose();
  // Re-enter, then use the preview's real action to open the existing complete
  // detail dialog. The hover layer must not remain over that dialog.
  await page.mouse.move(0, 0);
  await page.mouse.move(point.x, point.y);
  await ui(previewFor(page)).toBeVisible();
  await previewFor(page).getByRole('button', { name: '영상 상세 열기', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /^영상 상세:/ });
  await ui(detail).toBeFocused();
  await ui(previewFor(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await ui(detail).toHaveCount(0);
  await ui(page.getByRole('button', { name: '영상 탐색', exact: true })).toBeFocused();
  await expectChartFitsArea(page, width);
}

async function exerciseShortPreviewInputs(page: Page) {
  const chart = areaFor(page).getByRole('group', { name: /^트리맵 기준:/ });
  await chart.focus();
  await chart.press('Home');
  await chart.press('ArrowRight');
  await ui(previewFor(page)).toHaveCount(0);
  await chart.press('Enter');
  const detail = page.getByRole('dialog', { name: /^영상 상세:/ });
  await ui(detail).toBeFocused();
  await ui(detail.getByRole('status')).toContainText('반응형 검증용 합성 영상 2:');
  await page.keyboard.press('Escape');
  await ui(detail).toHaveCount(0);

  // Change mode retains the eighth "previous metric" paragraph. Hover near the
  // middle of this short viewport to exercise the preview's own real scroll.
  const change = page.getByRole('group', { name: '표시 방식', exact: true }).getByRole('button', { name: '증감률', exact: true });
  await expectReachable(change);
  await change.click();
  await ui(areaFor(page).getByRole('img')).toHaveAccessibleName(/좋아요.*증감률/);
  await scrollChartToBottom(page, 312);
  const point = (await visibleTilePoint(page, true))!;
  expect(point).not.toBeNull();
  await page.mouse.move(point.x, point.y);
  const body = await expectPreviewFields(page, true);
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollTop > 0)).toBe(true);

  // Close while the pointer is over the preview AND a real tile beneath it.
  // Re-exposure at the same coordinate must stay closed; physical movement
  // within that same tile must be able to resume its actual cached datum.
  const overlap = await page.evaluate(() => {
    const previewBody = document.querySelector('[data-insights-preview-body]')!.getBoundingClientRect();
    const card = document.querySelector('[data-insights-card]')!.getBoundingClientRect();
    for (const path of document.querySelectorAll('[data-insights-card] .ztd-mark > path:first-child')) {
      const tile = path.getBoundingClientRect();
      const left = Math.max(previewBody.left, card.left, tile.left), right = Math.min(previewBody.right, card.right, tile.right);
      const top = Math.max(previewBody.top, card.top, tile.top), bottom = Math.min(previewBody.bottom, card.bottom, tile.bottom);
      if (right - left > 16 && bottom - top > 16) return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    return null;
  });
  expect(overlap).not.toBeNull();
  await page.mouse.move(overlap!.x, overlap!.y);
  await page.keyboard.press('Escape');
  await ui(previewFor(page)).toHaveCount(0);
  await page.mouse.move(overlap!.x, overlap!.y);
  await ui(previewFor(page)).toHaveCount(0);
  await page.mouse.move(overlap!.x + 3, overlap!.y);
  await expectPreviewFields(page, true);
  await previewFor(page).getByRole('button', { name: '영상 미리보기 닫기', exact: true }).click();
  await ui(previewFor(page)).toHaveCount(0);
  await ui(change).toBeFocused();

  // The same chart still opens full detail with touch, without a hover layer.
  await page.mouse.move(0, 0);
  const touchPoint = (await visibleTilePoint(page))!;
  await page.touchscreen.tap(touchPoint.x, touchPoint.y);
  await ui(detail).toBeFocused();
  await ui(detail.getByRole('status').locator('p')).toHaveCount(8);
  await ui(previewFor(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await ui(detail).toHaveCount(0);
}

async function exerciseControls(page: Page) {
  for (const name of ['표시 방식', '지표', '기간', '클러스터 크기']) {
    const controls = page.getByRole('group', { name, exact: true }).getByRole('button');
    await expectReachable(controls.first());
    await expectReachable(controls.last());
  }
  // Exercise an actual query transition, while all transport remains synthetic GET.
  const likes = page.getByRole('group', { name: '지표', exact: true }).getByRole('button', { name: '좋아요', exact: true });
  await expectReachable(likes);
  await likes.click();
  await ui(page.locator('[data-insights-card] svg[role="img"]')).toHaveAccessibleName(/좋아요.*전체 기간.*8개 영상/);
}

async function expectBoundedPopover(popover: Locator) {
  await ui(popover).toBeVisible();
  await ui.poll(() => popover.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1
      && rect.top >= -1 && rect.bottom <= innerHeight + 1;
  })).toBe(true);
  await ui(popover).toHaveCSS('overflow-y', 'auto');
}

async function exercisePopovers(page: Page) {
  const explorer = page.getByRole('button', { name: '영상 탐색', exact: true });
  await expectReachable(explorer);
  await explorer.click();
  const detail = page.getByRole('dialog', { name: /^영상 상세:/ });
  await ui(detail).toBeFocused();
  await expectBoundedPopover(detail);
  await detail.hover();
  await page.mouse.wheel(0, 20_000);
  await ui.poll(() => detail.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await expectReachable(detail.getByRole('status').locator('p').last());
  await page.keyboard.press('Escape');
  await ui(detail).toHaveCount(0);
  await ui(explorer).toBeFocused();

  const help = page.getByRole('button', { name: '트리맵 읽는 법', exact: true });
  await expectReachable(help);
  await help.click();
  const helpDialog = page.getByRole('dialog', { name: '트리맵 읽는 법', exact: true });
  await ui(helpDialog).toBeFocused();
  await expectBoundedPopover(helpDialog);
  // Help has no child controls. Focus must enter its bounded body so a keyboard
  // user can scroll text even when the available popover height is very short.
  await page.keyboard.press('End');
  await ui.poll(() => helpDialog.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  await expectReachable(helpDialog.locator('p').last());
  await page.keyboard.press('Escape');
  await ui(helpDialog).toHaveCount(0);
  await ui(help).toBeFocused();
}

async function expectLayoutBoundary(page: Page, mode: InsightsResponsiveMode, width: number, height: number) {
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  const card = cardFor(page);
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && document.body.scrollWidth <= innerWidth && document.getElementById('main-content')?.scrollTop === 0)).toBe(true);
  const nav = page.getByRole('navigation', { name: '주요 탐색', exact: true });
  if (mode === 'member') {
    await ui(nav).toBeVisible();
    for (const button of await nav.getByRole('button').all()) await expectReachable(button);
    expect(await nav.getByRole('button').count()).toBe(5);
    const navBox = (await nav.boundingBox())!, cardBox = (await card.boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(navBox.y + 1);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(height + 1);
  } else {
    await ui(nav).toHaveCount(0);
    await ui(page.locator('[data-admin-embedded-module-id="insights"]')).toBeVisible();
    const frame = (await page.locator('[data-admin-console-inline-module-panel]').boundingBox())!;
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  }
}

async function expectReadOnly(page: Page) {
  expect(await page.evaluate(() => {
    const state = (globalThis as unknown as { __insightsResponsiveFixture: {
      writes: number; reads: number; unexpectedRequests: number; lastMetric: string; navigation: string[];
    } }).__insightsResponsiveFixture;
    return { writes: state.writes, read: state.reads > 0, unexpected: state.unexpectedRequests, metric: state.lastMetric, navigation: state.navigation };
  })).toEqual({ writes: 0, read: true, unexpected: 0, metric: 'likes', navigation: [] });
}

async function diagnostics(page: Page) {
  return page.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    };
    const tooltip = document.querySelector<HTMLElement>('[data-insights-hover-preview]');
    const plot = document.querySelector('[data-insights-preview-body]')?.getBoundingClientRect();
    const tipStyle = tooltip ? getComputedStyle(tooltip) : null;
    // Numeric geometry only: no user titles, query payloads or DOM snapshots.
    const tooltipText = tooltip ? [...tooltip.querySelectorAll('p')].slice(0, 8).map(paragraph => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const lines = [...range.getClientRects()];
      const style = getComputedStyle(paragraph);
      return {
        lineCount: lines.length, whiteSpace: style.whiteSpace, textWrap: style.getPropertyValue('text-wrap'),
        overflowX: plot ? Math.max(0, ...lines.map(line => Math.max(plot.left - line.left, line.right - plot.right))) : null,
        overflowY: plot ? Math.max(0, ...lines.map(line => Math.max(plot.top - line.top, line.bottom - plot.bottom))) : null,
      };
    }) : null;
    return {
      viewport: [innerWidth, innerHeight], card: measure('[data-insights-card]'),
      area: measure('[data-insights-card] > [data-slot="card-content"]'), svg: measure('[data-insights-card] svg[role="img"]'),
      tooltip: measure('[data-insights-hover-preview]'), tooltipBody: measure('[data-insights-preview-body]'), tooltipText,
      tooltipPosition: tipStyle ? { left: tipStyle.left, top: tipStyle.top, transform: tipStyle.transform, maxWidth: tipStyle.maxWidth } : null,
      activeTag: document.activeElement?.tagName,
    };
  });
}

for (const mode of ['member', 'admin'] as const) {
  for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [844, 390], [454, 312]]) {
    test(`${mode} insights keeps the chart, controls and popovers reachable at ${width}x${height}`, async () => {
      const { context, page, errors, networkRequests } = await openInsights(mode, width, height);
      try {
        await exerciseControls(page);
        await reachChartBottom(page, width, height);
        if (width === 454 && height === 312) await exerciseShortPreviewInputs(page);
        await exercisePopovers(page);
        await expectLayoutBoundary(page, mode, width, height);
        await expectReadOnly(page);
        expect(errors).toEqual([]);
        expect(networkRequests()).toBe(0);
      } catch (error) {
        throw new Error(`Insights geometry: ${JSON.stringify(await diagnostics(page))}`, { cause: error });
      } finally { await context.close(); }
    }, 45_000);
  }

  test(`${mode} insights remeasures the loaded chart from portrait to short landscape`, async () => {
    const { context, page, errors, networkRequests } = await openInsights(mode, 390, 844);
    try {
      await exerciseControls(page);
      await reachChartBottom(page, 390, 844);
      await expectLayoutBoundary(page, mode, 390, 844);
      await scrollChartToBottom(page, 844);
      const point = (await visibleTilePoint(page))!;
      await page.mouse.move(point.x, point.y);
      await ui(previewFor(page)).toBeVisible();
      await page.setViewportSize({ width: 844, height: 390 });
      await ui(previewFor(page)).toHaveCount(0);
      await reachChartBottom(page, 844, 390);
      await exerciseControls(page);
      await exercisePopovers(page);
      await expectLayoutBoundary(page, mode, 844, 390);
      await expectReadOnly(page);
      expect(errors).toEqual([]);
      expect(networkRequests()).toBe(0);
    } catch (error) {
      throw new Error(`Resized insights geometry: ${JSON.stringify(await diagnostics(page))}`, { cause: error });
    } finally { await context.close(); }
  }, 45_000);
}
