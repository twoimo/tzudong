import { expect, test, type Page } from '@playwright/test';

const RESTAURANT = {
  id: 'dependency-panel-fixture',
  name: '패널 의존성 검증 맛집',
  approved_name: '패널 의존성 검증 맛집',
  road_address: '튀르키예 이스탄불',
  jibun_address: null,
  english_address: 'Istanbul Türkiye',
  categories: ['한식'],
  status: 'approved',
  source_type: 'youtube',
  lat: 41.0082,
  lng: 28.9784,
  youtube_link: 'https://www.youtube.com/watch?v=8kE5Uq_YV08',
  review_count: 0,
};
const DEPENDENCY_PROOF_SUPABASE_HOST = 'dependency-proof.supabase.co';


async function openGlobalMap(page: Page) {
  await page.addInitScript(() => {
    window.__tzudongGoogleMapsLoadState = {
      status: 'error',
      message: 'Google Maps is intentionally disabled for this dependency smoke test.',
    };
  });
  await page.goto('/global-map', { waitUntil: 'domcontentloaded' });
  // The trigger is server-rendered before its pointer handler is hydrated.
  // Wait for the client-fetched fixture to prove this page can handle input.
  await expect(page.getByRole('button', { name: /패널 의존성 검증 맛집/ })).toBeVisible({ timeout: 15_000 });
}

async function openProductionDetailPanel(page: Page) {
  await openGlobalMap(page);
  const fallback = page.locator('[data-global-map-google-fallback="true"]');
  await expect(fallback).toBeVisible({ timeout: 15_000 });
  await fallback.getByRole('button', { name: /패널 의존성 검증 맛집/ }).click();
  await expect(page.locator('[data-global-map-panel="detail"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('dependency modernization browser contracts', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });
  test.beforeEach(async ({ page, baseURL }) => {
    const admittedOrigin = new URL(baseURL!);
    expect(admittedOrigin.protocol).toBe('http:');
    expect(admittedOrigin.hostname).toBe('localhost');
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === DEPENDENCY_PROOF_SUPABASE_HOST && url.pathname === '/rest/v1/restaurants') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'content-range': '0-0/1' },
          body: JSON.stringify([RESTAURANT]),
        });
        return;
      }
      if (url.origin === admittedOrigin.origin) {
        await route.continue();
        return;
      }
      await route.abort();
    });
  });

  test('serves the npm-built application without network access', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('main', { name: '쯔동여지도 지도 본문' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '지도 메뉴 열기' })).toBeVisible({ timeout: 15_000 });
    expect(pageErrors).toEqual([]);
  });

  test('commits a keyboard selection and restores focus in the production Radix select', async ({ page }) => {
    await openGlobalMap(page);
    const select = page.getByRole('combobox').first();
    await expect(select).toBeVisible({ timeout: 15_000 });
    await expect(select).toContainText('튀르키예');

    await select.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('option')).toHaveCount(8);
    await expect(page.getByRole('option', { name: /튀르키예/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('option', { name: /오스트레일리아/ })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(listbox).toBeHidden();
    await expect(select).toBeFocused();
    await expect(select).toContainText('오스트레일리아');
  });

  test('resizes real production percentage panels by pointer and keyboard within limits', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openProductionDetailPanel(page);

    const group = page.locator('[data-global-map-panel-group="true"]');
    const mapPanel = page.locator('[data-global-map-panel="map"]');
    const detailPanel = page.locator('[data-global-map-panel="detail"]');
    const separator = page.locator('[data-global-map-resize-handle="true"]');
    await expect(separator).toHaveAttribute('role', 'separator');
    await expect(separator).toHaveAccessibleName('글로벌 지도 상세 패널 너비 조절');

    const measure = async () => {
      const [groupBox, mapBox, detailBox] = await Promise.all([
        group.boundingBox(),
        mapPanel.boundingBox(),
        detailPanel.boundingBox(),
      ]);
      expect(groupBox).not.toBeNull();
      expect(mapBox).not.toBeNull();
      expect(detailBox).not.toBeNull();
      return {
        group: groupBox!.width,
        map: mapBox!.width,
        detail: detailBox!.width,
        percent: (detailBox!.width / groupBox!.width) * 100,
      };
    };
    const dragBy = async (deltaX: number) => {
      const box = await separator.boundingBox();
      expect(box).not.toBeNull();
      const x = box!.x + box!.width / 2;
      const y = box!.y + box!.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + deltaX, y, { steps: 12 });
      await page.mouse.up();
    };

    const initial = await measure();
    expect(initial.percent).toBeGreaterThanOrEqual(19);
    expect(initial.percent).toBeLessThanOrEqual(34);

    await dragBy(-120);
    const pointer = await measure();
    expect(pointer.detail).toBeGreaterThan(initial.detail + 40);
    expect(pointer.map).toBeLessThan(initial.map - 40);
    expect(Math.abs(pointer.group - initial.group)).toBeLessThanOrEqual(2);

    await separator.focus();
    const ariaBefore = await separator.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    const keyboard = await measure();
    await expect(separator).toBeFocused();
    await expect(separator).not.toHaveAttribute('aria-valuenow', ariaBefore ?? '');
    expect(Math.abs(keyboard.detail - pointer.detail)).toBeGreaterThan(0);

    await dragBy(-2_000);
    const maximum = await measure();
    expect(maximum.percent).toBeGreaterThanOrEqual(32);
    expect(maximum.percent).toBeLessThanOrEqual(34);

    await dragBy(2_000);
    const minimum = await measure();
    expect(minimum.percent).toBeGreaterThanOrEqual(19);
    expect(minimum.percent).toBeLessThanOrEqual(21);
  });
});
