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
    expect(mapsCreated).toBeGreaterThan(0);

    await page.evaluate(() => {
        const probe = { maxDetailPanels: 0, wrongControlFrames: 0, stop: false };
        (window as Window & { __detailChromeProbe?: typeof probe }).__detailChromeProbe = probe;
        const frame = () => {
            probe.maxDetailPanels = Math.max(probe.maxDetailPanels, document.querySelectorAll('[data-testid="restaurant-detail-panel"]').length);
            const mobileNavigation = document.querySelector('[data-testid="bottom-nav"]');
            const wrongControl = innerWidth >= 1280 && !mobileNavigation
                ? document.querySelector('[aria-label="지도 상단 제어"]')
                : innerWidth < 1280 && mobileNavigation && document.querySelector('[data-desktop-left-map-panel]');
            if (wrongControl) probe.wrongControlFrames++;
            if (!probe.stop) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        await expect.poll(() => map!.evaluate(element => element.isConnected)).toBe(true);
        expect(await page.evaluate(() => (window as Window & { __viewportMapCreates?: number }).__viewportMapCreates)).toBe(mapsCreated);
        await expect(page.locator('main#main-content')).toHaveCount(1);
        await expect(page.getByTestId('map-container')).toBeVisible();
    }
    expect(await page.evaluate(() => {
        const probe = (window as Window & { __detailChromeProbe?: { maxDetailPanels: number; wrongControlFrames: number; stop: boolean } }).__detailChromeProbe!;
        probe.stop = true;
        if (probe.wrongControlFrames) throw new Error('Control chrome disagreed with the active viewport');
        return probe.maxDetailPanels;
    })).toBeLessThanOrEqual(1);
});

test('mobile map fullscreen is cleared on desktop and stays cleared when returning', async ({ page }) => {
    await installViewportContinuityMocks(page);
    await page.goto('/');
    await hidePopupOverlay(page);
    await waitForMockMapReady(page);
    await openMobileSearchAndSelect(page, '정원분식');
    await expect(page.getByTestId('restaurant-detail-panel')).toBeVisible();
    const clickMockMap = () => page.evaluate(() => {
        const map = (window as typeof window & { __TZUDONG_DEBUG_MAP__?: unknown }).__TZUDONG_DEBUG_MAP__;
        if (!map) throw new Error('Mock map is not initialized');
        window.naver.maps.Event.trigger(map, 'click');
    });
    // The provider fixture does not forward DOM clicks into SDK events.
    // A mock SDK blank click first peeks the sheet; the next enters fullscreen.
    await page.waitForTimeout(400); // Existing marker-click suppression interval.
    await clickMockMap();
    await expect.poll(() => page.locator('[data-sheet-state]').evaluate(element => element.getBoundingClientRect().height / innerHeight)).toBeLessThan(0.3);
    await page.waitForTimeout(500); // Existing map-interaction collapse suppression interval.
    await clickMockMap();
    await expect(page.locator('[data-sheet-state]')).toHaveCount(0);
    const map = await page.getByTestId('map-container').elementHandle();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
    await expect(page.locator('[data-sheet-state]')).toHaveCount(1);
    expect(await map!.evaluate(element => element.isConnected)).toBe(true);
});


test('desktop collapse is scoped to desktop and mobile sheet globals clear before returning', async ({ page }) => {
    await installViewportContinuityMocks(page);
    await page.goto('/');
    await hidePopupOverlay(page);
    await waitForMockMapReady(page);
    await openMobileSearchAndSelect(page, '정원분식');
    const map = await page.getByTestId('map-container').elementHandle();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--mobile-sheet-hide-bottom-nav'))).toBe('1');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--mobile-sheet-hide-bottom-nav'))).toBe('0');
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-mobile-sheet-source'))).toBe(false);
    await page.getByRole('button', { name: /패널 접기$/, exact: false }).click();
    await expect(page.locator('[data-desktop-left-map-panel]')).toHaveAttribute('data-panel-collapsed', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('restaurant-detail-panel')).toBeVisible();
    await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
    expect(await map!.evaluate(element => element.isConnected)).toBe(true);
});
