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
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
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
  if (await area.locator('.ztd-tip').count() === 0) {
    expect(await area.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  } else {
    // A translated tooltip can enlarge scrollWidth with its pre-transform box
    // even when its final painted box fits. Measure the painted text as well:
    // the library's nowrap default must not leak a long title outside the plot.
    await ui.poll(() => area.evaluate(element => {
      const tooltip = element.querySelector<HTMLElement>('.ztd-tip');
      if (!tooltip) return false;
      const plot = element.getBoundingClientRect(), tip = tooltip.getBoundingClientRect();
      if (tip.width <= 0 || tip.left < plot.left - 1 || tip.right > plot.right + 1
        || tooltip.scrollWidth > tooltip.clientWidth + 1) return false;
      const paragraphs = [...tooltip.querySelectorAll('p')];
      if (paragraphs.length === 0) return false;
      return paragraphs.every(paragraph => {
        const text = document.createRange();
        text.selectNodeContents(paragraph);
        const lines = [...text.getClientRects()];
        return lines.length > 0 && lines.every(line => line.left >= Math.max(plot.left, tip.left) - 1
          && line.right <= Math.min(plot.right, tip.right) + 1);
      });
    })).toBe(true);
  }
}

async function reachChartBottom(page: Page, width: number, height: number) {
  const card = cardFor(page);
  // Dismiss any previous hover through normal pointer movement; never alter the
  // DOM or tooltip styling to manufacture a no-overflow baseline.
  await page.mouse.move(0, 0);
  await ui(areaFor(page).locator('.ztd-tip')).toHaveCount(0);
  await expectChartFitsArea(page, width);
  await card.hover();
  await page.mouse.wheel(0, 30_000);
  await ui.poll(() => card.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1);
  if (height <= 390) expect(await card.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  // A short card is allowed to show only part of the chart at once. Its last
  // painted tile must nevertheless be reachable through the real wheel owner.
  const lastPaintedPoint = () => areaFor(page).evaluate(element => {
    const svg = element.querySelector('svg[role="img"]');
    if (!svg) return null;
    const paths = [...svg.querySelectorAll('.ztd-mark > path:first-child')]
      .filter(path => Number(getComputedStyle(path).opacity) > 0)
      .map(path => path.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .sort((a, b) => b.bottom - a.bottom);
    const last = paths[0];
    if (!last) return null;
    const x = last.x + last.width / 2, y = last.bottom - Math.min(2, last.height / 2);
    const hit = document.elementFromPoint(x, y);
    return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && hit !== null && svg.contains(hit) ? { x, y } : null;
  });
  await ui.poll(lastPaintedPoint).not.toBeNull();
  const point = (await lastPaintedPoint())!;
  // Exercise a real tile, rather than relying on the card centre coincidentally
  // landing over the chart. This also covers hover on the 1024px layout.
  await page.mouse.move(point.x, point.y);
  await ui(areaFor(page).locator('.ztd-tip')).toHaveCount(1);
  await expectChartFitsArea(page, width);
  // Keep the library's independent vertical placement limitation observable.
  // This is bounded numeric evidence, not a claim that hover Y clipping passed.
  const evidence = await diagnostics(page);
  const verticalClip = Math.max(0, ...(evidence.tooltipText?.map(text => text.overflowY ?? 0) ?? []));
  if (verticalClip > 1) console.info('INSIGHTS_TOOLTIP_VERTICAL_CLIP=' + JSON.stringify({
    route: new URL(page.url()).pathname, viewport: evidence.viewport,
    area: evidence.area, tooltip: evidence.tooltip, maxTextOverflowY: verticalClip,
  }));
  await page.mouse.move(0, 0);
  await ui(areaFor(page).locator('.ztd-tip')).toHaveCount(0);
  await expectChartFitsArea(page, width);
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
    const tooltip = document.querySelector<HTMLElement>('[data-insights-card] .ztd-tip');
    const plot = document.querySelector('[data-insights-card] > [data-slot="card-content"]')?.getBoundingClientRect();
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
      tooltip: measure('[data-insights-card] .ztd-tip'), tooltipText,
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
      await page.setViewportSize({ width: 844, height: 390 });
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
