import { test, expect } from './nightly/nightly-test';
import { devices, type Locator, type Page } from '@playwright/test';
import { hidePopupOverlay } from './helpers';
import {
    clickAnyUnselectedMarker,
    installMobileHomeMapTestMocks,
    openMobileSearchAndSelect,
    panMockMap,
    swipeDetailPanelLeft,
    tapMapBackground,
    waitForMarkerCount,
    waitForMockMapReady,
    waitForSheetHeightRatioAtMost,
    waitForVisibleMarkers,
    zoomMockMap,
} from './mobile-home-map-helpers';

const IPHONE_SE_DEVICE = devices['iPhone SE'];

test.use({
    userAgent: IPHONE_SE_DEVICE.userAgent,
    viewport: IPHONE_SE_DEVICE.viewport,
    deviceScaleFactor: IPHONE_SE_DEVICE.deviceScaleFactor,
    isMobile: IPHONE_SE_DEVICE.isMobile,
    hasTouch: IPHONE_SE_DEVICE.hasTouch,
});
test.setTimeout(60000);

const LARGE_MOBILE_RESTORE_VIEWPORTS = [
    {
        name: 'Galaxy S20 Ultra',
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 3.5,
    },
    {
        name: 'iPhone 14 Pro Max',
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
    },
] as const;

async function prepareMobileHomeMapPage(page: Page) {
    await installMobileHomeMapTestMocks(page);
    await page.goto('/');
    await hidePopupOverlay(page);
    await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 15000 });
    await waitForMockMapReady(page);
}

async function openVisibleMarkerSheetFromCluster(page: Page) {
    await zoomMockMap(page, 8);
    await page.waitForFunction(
        () => document.querySelectorAll('.cluster-marker-container').length > 0,
        undefined,
        { timeout: 15000 }
    );

    const clicked = await page.locator('.cluster-marker-container').evaluateAll((elements) => {
        const target = elements[0];
        if (!(target instanceof HTMLElement)) return false;

        target.click();
        return true;
    });
    expect(clicked).toBe(true);

    await waitForMarkerCount(page, 3);

    const sheet = page.locator('[data-mobile-visible-marker-restaurants-sheet="true"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });
    return sheet;
}

async function expectRestoreLayoutSafe(page: Page, restore: Locator) {
    const restoreBox = await restore.boundingBox();
    expect(restoreBox).not.toBeNull();

    const bottomNav = page.getByTestId('bottom-nav');
    await expect(bottomNav).toBeVisible();
    const bottomNavBox = await bottomNav.boundingBox();
    expect(bottomNavBox).not.toBeNull();
    if (restoreBox && bottomNavBox) {
        expect(restoreBox.y + restoreBox.height).toBeLessThanOrEqual(bottomNavBox.y - 4);
    }

    const submissionButton = page.locator('[data-mobile-submission-floating-action="true"]');
    await expect(submissionButton).toBeVisible();
    const submissionBox = await submissionButton.boundingBox();
    expect(submissionBox).not.toBeNull();
    if (restoreBox && submissionBox) {
        expect(restoreBox.y + restoreBox.height).toBeLessThanOrEqual(submissionBox.y - 4);
        const restoreCenterX = restoreBox.x + restoreBox.width / 2;
        const submissionCenterX = submissionBox.x + submissionBox.width / 2;
        expect(Math.abs(restoreCenterX - submissionCenterX)).toBeLessThanOrEqual(4);
        expect(Math.abs(restoreBox.width - submissionBox.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(restoreBox.height - submissionBox.height)).toBeLessThanOrEqual(2);
    }
}

test.describe('Phase 1: mobile home map regressions', () => {
    test.beforeEach(async ({ page }) => {
        await prepareMobileHomeMapPage(page);
    });

    test('MHM-01: search-selected restaurant name remains in the mobile search input', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        await expect(page.getByLabel('맛집 검색 열기')).toContainText('정원분식');

        await page.getByLabel('맛집 검색 열기').click();
        await expect(page.getByLabel('맛집 검색어 입력')).toHaveValue('정원분식');
        await page.getByLabel('검색 닫기').click();
    });

    test('MHM-01b: browser back from search detail restores mobile search context without leaving home', async ({ page }) => {
        await page.evaluate(() => {
            const restoreEvents: Array<{ type: string; detail: unknown }> = [];
            Object.defineProperty(window, '__TZUDONG_HOME_RESTORE_EVENTS__', {
                configurable: true,
                value: restoreEvents,
            });
            window.addEventListener('home.restore.succeeded', (event) => {
                restoreEvents.push({
                    type: event.type,
                    detail: event instanceof CustomEvent ? event.detail : null,
                });
            });
            window.addEventListener('home.restore.failed', (event) => {
                restoreEvents.push({
                    type: event.type,
                    detail: event instanceof CustomEvent ? event.detail : null,
                });
            });
        });

        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        const detailRouteState = await page.evaluate(() => ({
            url: window.location.href,
            state: window.history.state,
        }));
        const detailUrl = new URL(detailRouteState.url);
        expect(detailUrl.pathname).toBe('/');
        expect(detailUrl.searchParams.get('restaurant')).toBe('restaurant-search');
        expect(detailUrl.searchParams.get('mapMode')).toBe('domestic');
        expect(detailUrl.searchParams.get('restore')).toBeTruthy();
        expect(detailUrl.searchParams.has('r')).toBe(false);
        expect(detailRouteState.state?.kind).toBe('tzudong.home.detail.v1');

        await page.goBack();

        await expect(page.getByTestId('restaurant-detail-panel')).toBeHidden({ timeout: 5000 });
        await expect(page.getByLabel('맛집 검색 열기')).toContainText('정원분식');
        await page.screenshot({
            path: 'test-results/home-route-restore-mobile.png',
            fullPage: true,
        });
        await page.getByLabel('맛집 검색 열기').click();
        await expect(page.getByLabel('맛집 검색어 입력')).toHaveValue('정원분식');

        const restoredState = await page.evaluate(() => ({
            pathname: window.location.pathname,
            search: window.location.search,
            state: window.history.state,
            restoreEvents: (window as typeof window & {
                __TZUDONG_HOME_RESTORE_EVENTS__?: Array<{ type: string; detail: unknown }>;
            }).__TZUDONG_HOME_RESTORE_EVENTS__ ?? [],
        }));
        expect(restoredState.pathname).toBe('/');
        expect(restoredState.search).toBe('');
        expect(restoredState.state?.kind).toBe('tzudong.home.list.v1');
        expect(restoredState.restoreEvents.some((event) => event.type === 'home.restore.succeeded')).toBe(true);
    });

    test('MHM-01c: missing restore snapshot emits failed instrumentation without leaving home', async ({ page }) => {
        await page.evaluate(() => {
            const restoreEvents: Array<{ type: string; detail: unknown }> = [];
            Object.defineProperty(window, '__TZUDONG_HOME_RESTORE_EVENTS__', {
                configurable: true,
                value: restoreEvents,
            });
            window.addEventListener('home.restore.failed', (event) => {
                restoreEvents.push({
                    type: event.type,
                    detail: event instanceof CustomEvent ? event.detail : null,
                });
            });
        });

        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        const restoreKey = await page.evaluate(() => {
            const key = window.history.state?.restoreKey;
            if (typeof key !== 'string' || !key) {
                throw new Error('Home detail history state did not expose a restore key');
            }
            window.sessionStorage.removeItem(`tzudong:home-restore:${key}`);
            return key;
        });

        await page.goBack();

        const failedEvent = await page.waitForFunction(() => {
            const events = (window as typeof window & {
                __TZUDONG_HOME_RESTORE_EVENTS__?: Array<{ type: string; detail: { reason?: string } | null }>;
            }).__TZUDONG_HOME_RESTORE_EVENTS__ ?? [];
            return events.find((event) => event.type === 'home.restore.failed') ?? null;
        });

        expect(await failedEvent.jsonValue()).toMatchObject({
            type: 'home.restore.failed',
            detail: {
                restoreKey,
                reason: 'missing',
            },
        });
        expect(new URL(page.url()).pathname).toBe('/');
    });

    test('G002: detail panel owns mobile bottom-right floating actions until in-app close', async ({ page }) => {
        await expect(page.getByLabel('맛집 제보하기')).toBeVisible();
        await expect(page.getByLabel('현재 위치 보기')).toBeVisible();

        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await expect(page.getByLabel('맛집 제보하기')).toHaveCount(0);
        await expect(page.getByLabel('현재 위치 보기')).toHaveCount(0);
        await page.screenshot({
            path: 'test-results/g002-mobile-detail-safe-area.png',
            fullPage: true,
        });

        await page.getByLabel('이전 화면으로 돌아가기').click();
        await expect(page.getByTestId('restaurant-detail-panel')).toBeHidden({ timeout: 5000 });

        await expect(page.getByLabel('맛집 제보하기')).toBeVisible();
        await expect(page.getByLabel('현재 위치 보기')).toBeVisible();
        await page.screenshot({
            path: 'test-results/g002-mobile-floating-actions-restored.png',
            fullPage: true,
        });
    });
    test('G004: mobile detail presents typed distinct domestic addresses', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');

        const detailPanel = page.getByTestId('restaurant-detail-panel');
        await expect(detailPanel).toContainText('정원분식');
        await expect(detailPanel.getByText('도로명 주소')).toBeVisible();
        await expect(detailPanel.getByText('서울특별시 중구 세종대로 110')).toBeVisible();
        await expect(detailPanel.getByText('지번 주소')).toBeVisible();
        await expect(detailPanel.getByText('서울특별시 중구 태평로1가 31')).toBeVisible();
        await expect(detailPanel.getByText('영어 주소')).toBeVisible();
        await expect(detailPanel.getByText('110 Sejong-daero, Jung-gu, Seoul')).toBeVisible();
        await page.screenshot({
            path: 'test-results/g004-mobile-address-presenter.png',
            fullPage: true,
        });
    });

    test('G002: mobile category taps commit immediately without hidden apply action', async ({ page }) => {
        await page.getByLabel(/카테고리 필터 열기/).click();
        await expect(page.getByText('카테고리 필터')).toBeVisible();
        await expect(page.getByRole('button', { name: '적용하기' })).toHaveCount(0);
        const categoryResponse = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname.endsWith('/rest/v1/restaurants') &&
                response.status() === 200 &&
                (url.searchParams.get('categories') || '').includes('한식');
        });


        await page.getByRole('button', { name: /한식\s*\(\d+\)/ }).click({ force: true });
        await expect(page.getByRole('button', { name: /초기화 \(1개 선택됨\)/ })).toBeVisible();
        const filteredRows = await categoryResponse.then((response) => response.json());
        expect(filteredRows).toHaveLength(1);
        expect(filteredRows[0].approved_name).toBe('명동칼국수');
        await page.screenshot({
            path: 'test-results/g002-mobile-category-immediate.png',
            fullPage: true,
        });

        await page.getByRole('button', { name: /초기화 \(1개 선택됨\)/ }).click();
        await expect(page.getByRole('button', { name: /초기화/ })).toHaveCount(0);
    });
    test('MHM-02: search-selected detail can swipe to the next restaurant', async ({ page }) => {
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

    test('MHM-03: tapping a different marker after search opens that restaurant immediately', async ({ page }) => {
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

    test('MHM-04: tapping the map background keeps the selected detail open and does not refresh the home view', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await waitForVisibleMarkers(page, 3);

        const navigationEntriesBefore = await page.evaluate(
            () => window.performance.getEntriesByType('navigation').length
        );

        await page.evaluate(() => {
            (window as typeof window & { __mobileHomeMapSentinel?: string }).__mobileHomeMapSentinel =
                'stable';
        });

        await tapMapBackground(page);
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

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

    test('MHM-05: manual post-search pan keeps the detail open but collapses the sheet to peek height', async ({ page }) => {
        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await panMockMap(page, 160, 0);

        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');
        await waitForSheetHeightRatioAtMost(page, 0.3);
    });

    test('MHM-06: single-visible post-search swipe falls back to the nearest restaurant', async ({ page }) => {
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

    test('MHM-07: tapping a cluster marker reveals the individual markers', async ({ page }) => {
        await zoomMockMap(page, 8);

        await page.waitForFunction(
            () => document.querySelectorAll('.cluster-marker-container').length > 0,
            undefined,
            { timeout: 15000 }
        );
        expect(await page.locator('[data-testid="marker"]').count()).toBe(0);

        const clicked = await page.locator('.cluster-marker-container').evaluateAll((elements) => {
            const target = elements[0];
            if (!(target instanceof HTMLElement)) return false;

            target.click();
            return true;
        });
        expect(clicked).toBe(true);

        await page.waitForFunction(
            () => {
                const map = (window as typeof window & {
                    __TZUDONG_DEBUG_MAP__?: { getZoom?: () => number };
                }).__TZUDONG_DEBUG_MAP__;
                return Number(map?.getZoom?.()) >= 14;
            },
            undefined,
            { timeout: 15000 }
        );

        await waitForMarkerCount(page, 3);
        await page.waitForFunction(
            () => document.querySelectorAll('.cluster-marker-container').length === 0,
            undefined,
            { timeout: 15000 }
        );
    });

    test('MHM-08: zoomed individual markers expose a visible-marker restaurant sheet', async ({ page, browserName }) => {
        const sheet = await openVisibleMarkerSheetFromCluster(page);

        await expect(page.locator('[data-mobile-visible-marker-restaurants-trigger="true"]')).toHaveCount(0);

        await expect(sheet).toContainText(/정원분식|명동칼국수|서울돈까스/);
        const scrollbarState = await sheet.evaluate((element) => {
            const scrollContainer = element.closest('[data-bottom-sheet-layout-source="mobile-control-overlay-sheet"]')
                ?.querySelector(':scope > div.flex-1');
            if (!(scrollContainer instanceof HTMLElement)) {
                return null;
            }

            return {
                scrollbarWidth: window.getComputedStyle(scrollContainer).scrollbarWidth,
                webkitScrollbarDisplay: window.getComputedStyle(scrollContainer, '::-webkit-scrollbar').display,
            };
        });
        if (browserName === 'firefox') {
            expect(scrollbarState).toMatchObject({
                scrollbarWidth: 'none',
            });
        } else {
            expect(scrollbarState).toMatchObject({
                webkitScrollbarDisplay: 'none',
            });
        }

        await page.screenshot({
            path: 'test-results/home-map-contextual-discovery-mobile.png',
            fullPage: true,
        });

        await sheet.getByRole('button', { name: /명동칼국수|서울돈까스|정원분식/ }).first().click();
        await expect(sheet).not.toBeVisible();
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText(/정원분식|명동칼국수|서울돈까스/);
    });
    test('MHM-08b: dismissed visible-marker sheet can be restored without covering mobile chrome', async ({ page }) => {
        const sheet = await openVisibleMarkerSheetFromCluster(page);
        await page.getByLabel('맛집 목록 닫기').click();
        await expect(sheet).not.toBeVisible();

        const restore = page.locator('[data-mobile-visible-marker-restaurants-restore="true"]');
        await expect(restore).toBeVisible({ timeout: 5000 });
        await expect(restore).not.toContainText('목록');
        await expect(restore).not.toContainText('3곳');
        const restoreByRole = page.getByRole('button', { name: '맛집 목록 다시 열기', exact: true });
        await expect(restoreByRole).toBeVisible();
        await expect(restore).toHaveAttribute('aria-label', '맛집 목록 다시 열기');

        await expectRestoreLayoutSafe(page, restore);

        await restore.click();
        await expect(sheet).toBeVisible();
        await expect(restore).not.toBeVisible();
        await page.getByLabel('맛집 목록 닫기').click();
        await expect(sheet).not.toBeVisible();
        await expect(restore).toBeVisible();

        await restore.focus();
        await page.keyboard.press('Enter');
        await expect(sheet).toBeVisible();
        await expect(restore).not.toBeVisible();
        await page.getByLabel('맛집 목록 닫기').click();
        await expect(sheet).not.toBeVisible();
        await expect(restore).toBeVisible();

        await restore.focus();
        await expect(restore).toBeFocused();
        await page.keyboard.press('Space');
        await expect(sheet).toBeVisible();
        await expect(restore).not.toBeVisible();


        await sheet.getByRole('button', { name: /명동칼국수|서울돈까스|정원분식/ }).first().click();
        await expect(sheet).not.toBeVisible();
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText(/정원분식|명동칼국수|서울돈까스/);
        await expect(restore).not.toBeVisible();
    });
});

for (const deviceProfile of LARGE_MOBILE_RESTORE_VIEWPORTS) {
    test.describe(`Large mobile visible-marker restore layout: ${deviceProfile.name}`, () => {
        test.use({
            viewport: deviceProfile.viewport,
            deviceScaleFactor: deviceProfile.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
        });

        test(`MHM-08c: restore control stays safe on ${deviceProfile.name}`, async ({ page }) => {
            await prepareMobileHomeMapPage(page);
            const sheet = await openVisibleMarkerSheetFromCluster(page);

            await page.getByLabel('맛집 목록 닫기').click();
            await expect(sheet).not.toBeVisible();

            const restore = page.locator('[data-mobile-visible-marker-restaurants-restore="true"]');
            await expect(restore).toBeVisible({ timeout: 5000 });
            await expect(restore).not.toContainText('목록');
            await expect(restore).not.toContainText('3곳');
            await expect(restore).toHaveAttribute('aria-label', '맛집 목록 다시 열기');
            await expectRestoreLayoutSafe(page, restore);

            await restore.click();
            await expect(sheet).toBeVisible();
            await expect(restore).not.toBeVisible();
        });
    });
}
