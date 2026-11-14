import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as ui, type Browser, type Locator } from '@playwright/test';
import { chromeForTestingExecutable } from './fixtures/chrome-for-testing';
import {
  buildAdminResponsiveFixture, finalIncidentAuditId,
  knowledgeResponsivePayload, privacyResponsivePayload,
} from './fixtures/admin-responsive-fixture';

let browser: Browser;
let built: Awaited<ReturnType<typeof buildAdminResponsiveFixture>>;
beforeAll(async () => { built = await buildAdminResponsiveFixture(); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function openModule(mode: 'privacy' | 'pipeline' | 'knowledge' | 'evaluation', width: number, height: number) {
  browser ??= await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors: string[] = [], writes: string[] = [], unexpected: string[] = [], reads: string[] = [];
  const url = `https://admin-responsive.fixture.test/${mode === 'privacy' ? 'admin/privacy-incidents' : 'admin'}?fixture=${mode}`;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const target = new URL(request.url());
    if (request.method() !== 'GET') {
      writes.push(request.method() + ' ' + target.pathname);
      return route.abort();
    }
    if (request.url() === url) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (target.origin === 'https://admin-responsive.fixture.test') {
      if (target.pathname === '/api/admin/privacy-incidents') {
        reads.push(target.pathname);
        return route.fulfill({ json: privacyResponsivePayload });
      }
      if (target.pathname === '/api/admin/knowledge-graph') {
        reads.push(target.pathname + target.search);
        return route.fulfill({ json: knowledgeResponsivePayload(target.searchParams.has('cursor')) });
      }
      if (target.pathname === '/api/admin/pipeline') {
        reads.push(target.pathname);
        return route.fulfill({ json: { source: 'job_api', jobs: [], failures: [], targets: [], gauges: {}, dataEnv: 'local_db' } });
      }
      if (target.pathname === '/api/admin/system-status') {
        reads.push(target.pathname);
        return route.fulfill({ json: { runDaily: { manifestStatus: 'available', checkedAt: '2026-11-14T12:00:00Z', stale: false, stepEvents: [] } } });
      }
      if (target.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    }
    unexpected.push(target.origin + target.pathname);
    return route.abort();
  });
  await page.goto(url);
  await page.addStyleTag({ content: built.css });
  await page.addScriptTag({ content: built.script });
  await ui(page.locator('#main-content')).toBeVisible();
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
  return { page, context, reads, verify: async () => {
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  } };
}

// DOM presence and Playwright's visible state do not detect an internal hidden
// ancestor. Check the full painted bounds through every clipping ancestor after
// normal scrolling, including open shadow roots used by the measured skeleton.
async function expectReachable(target: Locator, hitTest = true) {
  await ui(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  await ui.poll(() => target.evaluate((element, hitTest) => {
    const measured = element instanceof SVGGElement ? element.querySelector('rect') ?? element : element;
    const box = measured.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) return false;
    for (let parent: Element | null = element; parent;) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX) && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) return false;
      if (/auto|scroll|hidden|clip/.test(style.overflowY) && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) return false;
      // scrollIntoView must not manufacture reachability by scrolling a hidden
      // ancestor that touch/wheel users cannot operate.
      if (/hidden|clip/.test(style.overflowX) && Math.abs(parent.scrollLeft) > 1) return false;
      if (/hidden|clip/.test(style.overflowY) && Math.abs(parent.scrollTop) > 1) return false;
      const root = parent.getRootNode();
      parent = parent.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    if (!hitTest) return true;
    const painted = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return painted === element || (painted !== null && element.contains(painted));
  }, hitTest)).toBe(true);
}

const sizes = [[390, 844], [820, 1180], [1024, 768], [844, 390], [820, 600]] as const;

for (const [width, height] of sizes) {
  test(`privacy incident history and transition controls remain reachable at ${width}x${height}`, async () => {
    const fixture = await openModule('privacy', width, height);
    const { page } = fixture;
    try {
      const owner = page.locator('[data-privacy-incident-workflow]');
      const last = page.getByText(`감사: ${finalIncidentAuditId}`, { exact: true });
      await ui(last).toHaveCount(1);
      await ui(owner).toHaveCSS('overflow-y', 'auto');
      expect(await owner.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await owner.hover();
      await page.mouse.wheel(0, 20_000);
      await ui.poll(() => owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expectReachable(last);
      const preview = page.getByRole('button', { name: '1. 미리보기 생성', exact: true });
      await expectReachable(preview);
      await preview.focus();
      await ui(preview).toBeFocused();
      // Focus verifies keyboard reachability; issuing a preview is a write and
      // is deliberately outside this layout regression fixture.
      await expectReachable(page.getByRole('button', { name: '개인정보 사고 목록 새로고침' }));
      expect(fixture.reads).toContain('/api/admin/privacy-incidents');
      await fixture.verify();
    } finally { await fixture.context.close(); }
  }, 30_000);

  test(`pipeline final stage and read-only detail remain reachable at ${width}x${height}`, async () => {
    const fixture = await openModule('pipeline', width, height);
    const { page } = fixture;
    try {
      const owner = page.locator('[data-admin-pipeline-dashboard]');
      await ui(page.locator('[data-pipeline-stage]')).toHaveCount(8);
      await ui(page.locator('[data-pipeline-flow-diagram]')).toHaveAttribute('data-flow-direction', 'vertical');
      expect(await page.locator('[data-pipeline-canvas]').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(640);
      await ui(owner).toHaveCSS('overflow-y', 'auto');
      await owner.hover();
      await page.mouse.wheel(0, 20_000);
      const review = page.locator('[data-pipeline-stage="review"]');
      await expectReachable(review);
      if (width >= 768 && height <= 600) {
        expect(await owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      }
      await review.click();
      const detail = page.locator('[data-pipeline-stage-detail="review"]');
      await ui(detail).toBeVisible();
      await expectReachable(detail.getByRole('link', { name: '맛집 검수' }));
      await page.keyboard.press('Escape');
      await ui(detail).toHaveCount(0);
      await ui(review).toBeFocused();
      await expectReachable(review);
      expect(fixture.reads).toContain('/api/admin/pipeline');
      expect(fixture.reads).toContain('/api/admin/system-status');
      if (width < 768) {
        const header = (await page.locator('[data-admin-console-mobile-header]').boundingBox())!;
        const content = (await page.locator('#admin-console-canvas').boundingBox())!;
        expect(header.height).toBe(48);
        expect(Math.abs(content.y - header.y - header.height)).toBeLessThanOrEqual(1);
      }
      await fixture.verify();
    } finally { await fixture.context.close(); }
  }, 30_000);

  test(`knowledge graph footer keeps both pagination controls reachable at ${width}x${height}`, async () => {
    const fixture = await openModule('knowledge', width, height);
    const { page } = fixture;
    try {
      const owner = page.locator('[data-admin-knowledge-graph-panel]');
      await ui(page.locator('[data-knowledge-node="node-1"]')).toHaveCount(1);
      await ui(owner).toHaveCSS('overflow-y', 'auto');
      expect(await page.locator('[data-knowledge-canvas]').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(320);
      await owner.hover();
      await page.mouse.wheel(0, 20_000);
      const nextEdge = page.getByRole('button', { name: '다음 연결 페이지' });
      const nextNode = page.getByRole('button', { name: '다음 지식 페이지' });
      await expectReachable(nextEdge);
      await expectReachable(nextNode);
      if (height <= 390) expect(await owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await nextNode.click();
      await ui(page.locator('[data-knowledge-node="node-2"]')).toHaveCount(1);
      const previous = page.getByRole('button', { name: '이전 지식 페이지' });
      await expectReachable(previous);
      await previous.focus();
      await page.keyboard.press('Enter');
      await ui(page.locator('[data-knowledge-node="node-1"]')).toHaveCount(1);
      expect(fixture.reads.some(path => path.includes('cursor=cursor-2'))).toBe(true);
      await fixture.verify();
    } finally { await fixture.context.close(); }
  }, 30_000);
}

test('evaluation loading table scrolls to the final column and row inside the expanded 1024px admin shell', async () => {
  const fixture = await openModule('evaluation', 1024, 768);
  const { page } = fixture;
  try {
    const owner = page.locator('[data-horizontal-scroll-owner="admin-evaluation-table"]');
    await ui(owner).toBeVisible();
    await ui(owner).toHaveCSS('overflow-x', 'auto');
    const rows = owner.locator('.grid');
    await ui(rows).toHaveCount(17);
    const columns = await rows.evaluateAll(elements => [elements[0], elements[1]].map(row => [...row.children].map(child => child.getBoundingClientRect().left)));
    expect(columns[0]).toHaveLength(9);
    columns[0].forEach((left, index) => expect(Math.abs(left - columns[1][index])).toBeLessThanOrEqual(1));
    expect(await owner.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await owner.focus();
    await ui(owner).toBeFocused();
    await owner.hover();
    await page.mouse.wheel(20_000, 20_000);
    await ui.poll(() => owner.evaluate(element => Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThanOrEqual(1);
    await ui.poll(() => owner.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
    // The sample is intentionally inert. Verify the actual painted Skullet
    // rectangle at the final row/column, not pointer visibility of hidden text.
    const lastPainted = owner.locator('[skullet-layer] [skullet-rect]').last();
    await expectReachable(lastPainted, false);
    await fixture.verify();
  } finally { await fixture.context.close(); }
}, 30_000);
