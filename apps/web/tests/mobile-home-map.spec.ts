import { test, expect, devices } from '@playwright/test';
import { hidePopupOverlay } from './helpers';
import {
    clickAnyUnselectedMarker,
    closeDetailPanelFromMap,
    installMobileHomeMapTestMocks,
    openMobileSearchAndSelect,
    panMockMap,
    swipeDetailPanelLeft,
    waitForMarkerCount,
    waitForMockMapReady,
    waitForSheetHeightRatioAtMost,
    waitForVisibleMarkers,
    zoomMockMap,
} from './mobile-home-map-helpers';

test.use({
    ...devices['iPhone SE'],
});

test.describe('Phase 1: mobile home map regressions', () => {
    test.beforeEach(async ({ page }) => {
        await installMobileHomeMapTestMocks(page);
        await page.goto('/');
        await hidePopupOverlay(page);
        await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 15000 });
        await waitForMockMapReady(page);
    });

    test('MHM-01: search-selected detail can swipe to the next restaurant', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await waitForVisibleMarkers(page, 3);
        await swipeDetailPanelLeft(page);

        await expect(page.getByTestId('restaurant-detail-panel')).not.toContainText('정원분식', {
            timeout: 5000,
        });
        await expect(
            page
                .getByTestId('restaurant-detail-panel')
                .getByText(/명동칼국수|서울돈까스/)
                .first()
        ).toBeVisible();
    });

    test('MHM-02: tapping a different marker after search opens that restaurant immediately', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await waitForVisibleMarkers(page, 3);
        await clickAnyUnselectedMarker(page);

        await expect(page.getByTestId('restaurant-detail-panel')).not.toContainText('정원분식', {
            timeout: 3000,
        });
        await expect(
            page
                .getByTestId('restaurant-detail-panel')
                .getByText(/명동칼국수|서울돈까스/)
                .first()
        ).toBeVisible();
    });

    test('MHM-03: closing the sheet then tapping another marker does not refresh the home view', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await waitForVisibleMarkers(page, 3);
        await closeDetailPanelFromMap(page);

        const navigationEntriesBefore = await page.evaluate(
            () => window.performance.getEntriesByType('navigation').length
        );

        await page.evaluate(() => {
            (window as typeof window & { __mobileHomeMapSentinel?: string }).__mobileHomeMapSentinel =
                'stable';
        });

        await clickAnyUnselectedMarker(page);

        await expect(page.getByTestId('restaurant-detail-panel')).toBeVisible({ timeout: 3000 });
        await expect(
            page
                .getByTestId('restaurant-detail-panel')
                .getByText(/정원분식|명동칼국수|서울돈까스/)
                .first()
        ).toBeVisible();

        const [navigationEntriesAfter, sentinel] = await Promise.all([
            page.evaluate(() => window.performance.getEntriesByType('navigation').length),
            page.evaluate(
                () =>
                    (window as typeof window & { __mobileHomeMapSentinel?: string })
                        .__mobileHomeMapSentinel
            ),
        ]);

        expect(navigationEntriesAfter).toBe(navigationEntriesBefore);
        expect(sentinel).toBe('stable');
    });

    test('MHM-04: manual post-search pan keeps the detail open but collapses the sheet to peek height', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await panMockMap(page, 160, 0);

        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        await waitForSheetHeightRatioAtMost(page, 0.3);
    });

    test('MHM-05: single-visible post-search swipe falls back to the nearest restaurant', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await zoomMockMap(page, 18);
        await waitForMarkerCount(page, 1);
        await swipeDetailPanelLeft(page);

        await expect(page.getByTestId('restaurant-detail-panel')).not.toContainText('정원분식', {
            timeout: 5000,
        });
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('서울돈까스');
    });
});
