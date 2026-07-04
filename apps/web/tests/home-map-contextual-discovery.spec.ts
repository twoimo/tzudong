import { test, expect } from '@playwright/test';
import { hidePopupOverlay } from './helpers';
import {
  installMobileHomeMapTestMocks,
  waitForMarkerCount,
  waitForMockMapReady,
  zoomMockMap,
} from './mobile-home-map-helpers';

test.describe('home map contextual visible-marker discovery', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await installMobileHomeMapTestMocks(page);
    await page.goto('/');
    await hidePopupOverlay(page);
    await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 15000 });
    await waitForMockMapReady(page);
  });

  test('desktop map-home panel shows visible marker restaurants only after individual markers render', async ({ page }) => {
    await expect(page.locator('[data-desktop-left-panel-map-home="true"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-desktop-left-panel-visible-marker-restaurants="true"]')).toHaveCount(0);

    await zoomMockMap(page, 8);
    await page.waitForFunction(
      () => document.querySelectorAll('.cluster-marker-container').length > 0,
      undefined,
      { timeout: 15000 }
    );
    await expect(page.locator('[data-desktop-left-panel-visible-marker-restaurants="true"]')).toHaveCount(0);

    const clicked = await page.locator('.cluster-marker-container').evaluateAll((elements) => {
      const target = elements[0];
      if (!(target instanceof HTMLElement)) return false;

      target.click();
      return true;
    });
    expect(clicked).toBe(true);

    await waitForMarkerCount(page, 3);

    const contextualSection = page.locator('[data-desktop-left-panel-visible-marker-restaurants="true"]');
    await expect(contextualSection).toBeVisible({ timeout: 5000 });
    await expect(contextualSection).toContainText('맛집 목록');
    await expect(contextualSection).toContainText(/정원분식|명동칼국수|서울돈까스/);
    await page.locator('[data-desktop-left-panel-map-home="true"]').screenshot({
      path: 'test-results/home-map-contextual-discovery-desktop.png',
    });
  });

  test('desktop category filter commits immediately without apply action', async ({ page }) => {
    await page.getByLabel('카테고리 필터').click();
    await expect(page.getByText('카테고리 필터')).toBeVisible();
    await expect(page.getByRole('button', { name: '적용하기' })).toHaveCount(0);
    const categoryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/rest/v1/restaurants') &&
        response.status() === 200 &&
        (url.searchParams.get('categories') || '').includes('한식');
    });


    await page.getByRole('option', { name: /한식\s*1개/ }).click();
    await expect(page.getByLabel('카테고리 필터')).toContainText('1개 선택됨');
    const filteredRows = await categoryResponse.then((response) => response.json());
    expect(filteredRows).toHaveLength(1);
    expect(filteredRows[0].approved_name).toBe('명동칼국수');

    await page.locator('[data-testid="map-container"]').screenshot({
      path: 'test-results/g002-desktop-category-immediate.png',
    });
  });

  test('desktop browser back from list detail restores the home map list state', async ({ page }) => {
    const popularRestaurantButton = page.getByRole('button', { name: /정원분식 인기 맛집 상세 보기/ });
    await expect(popularRestaurantButton).toBeVisible({ timeout: 15000 });
    await popularRestaurantButton.click();

    await expect(page.getByTestId('restaurant-detail-panel')).toBeVisible({ timeout: 5000 });
    const detailRouteState = await page.evaluate(() => ({
      url: window.location.href,
      state: window.history.state,
    }));
    const detailUrl = new URL(detailRouteState.url);
    expect(detailUrl.pathname).toBe('/');
    expect(detailUrl.searchParams.get('restaurant')).toBeTruthy();
    expect(detailUrl.searchParams.get('mapMode')).toBe('domestic');
    expect(detailUrl.searchParams.get('restore')).toBeTruthy();
    expect(detailUrl.searchParams.has('r')).toBe(false);
    expect(detailRouteState.state?.kind).toBe('tzudong.home.detail.v1');

    await page.goBack();

    await expect(page.getByTestId('restaurant-detail-panel')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('[data-desktop-left-panel-map-home="true"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /정원분식 인기 맛집 상세 보기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /명동칼국수 인기 맛집 상세 보기/ })).toBeVisible();
    await page.locator('[data-desktop-left-panel-map-home="true"]').screenshot({
      path: 'test-results/home-route-restore-desktop.png',
    });
    const restoredState = await page.evaluate(() => ({
      pathname: window.location.pathname,
      search: window.location.search,
      state: window.history.state,
    }));
    expect(restoredState.pathname).toBe('/');
    expect(restoredState.search).toBe('');
    expect(restoredState.state?.kind).toBe('tzudong.home.list.v1');
  });
});
