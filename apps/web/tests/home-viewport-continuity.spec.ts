import { expect, test } from '@playwright/test';
import { openMobileSearchAndSelect, waitForMockMapReady } from './mobile-home-map-helpers';
import { installViewportContinuityMocks } from './home-viewport-continuity-helpers';
import { hidePopupOverlay } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('home keeps its map instance and detail selection across both viewport boundaries', async ({ page }) => {
    await installViewportContinuityMocks(page);
    await page.goto('/');
    await hidePopupOverlay(page);
    await waitForMockMapReady(page);
    await openMobileSearchAndSelect(page, '정원분식');
    await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
    const map = await page.getByTestId('map-container').elementHandle();
    expect(map).not.toBeNull();
    const mapsCreated = await page.evaluate(() => (window as Window & { __viewportMapCreates?: number }).__viewportMapCreates);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        await expect.poll(() => map!.evaluate(element => element.isConnected)).toBe(true);
        expect(await page.evaluate(() => (window as Window & { __viewportMapCreates?: number }).__viewportMapCreates)).toBe(mapsCreated);
        await expect(page.locator('main#main-content')).toHaveCount(1);
        await expect(page.getByTestId('map-container')).toBeVisible();
    }
});
