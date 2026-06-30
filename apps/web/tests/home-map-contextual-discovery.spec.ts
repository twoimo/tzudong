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
    await expect(contextualSection).toContainText('지도에 보이는 맛집');
    await expect(contextualSection).toContainText(/정원분식|명동칼국수|서울돈까스/);
    await page.locator('[data-desktop-left-panel-map-home="true"]').screenshot({
      path: 'test-results/home-map-contextual-discovery-desktop.png',
    });
  });
});
