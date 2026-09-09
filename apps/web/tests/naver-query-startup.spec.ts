import { test, expect } from './nightly/nightly-test';
import { installDeferredMobileHomeMapTestMocks, waitForMockMapReady, waitForVisibleMarkers } from './mobile-home-map-helpers';

// Requires the repository's admitted local stack and local Naver script mode.
// No real provider traffic, screenshots, traces, payloads or credentials are retained.
test.use({ trace: 'off', screenshot: 'off', video: 'off', preloadNaverMock: false });
test.setTimeout(60000);

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    test(`restaurant data starts before SDK readiness at ${viewport.width}px`, async ({ page }) => {
        expect(process.env.NIGHTLY_MODE === 'local' || process.env.NIGHTLY_LOCAL_ENV_ONLY === '1').toBe(true);
        await page.setViewportSize(viewport);
        let compactRequests = 0;
        let sdkRequests = 0;
        page.on('request', (request) => {
            const url = new URL(request.url());
            if (url.pathname === '/__local/naver-maps.js') sdkRequests++;
            const fields = new Set((url.searchParams.get('select') ?? '').split(',').map((field) => field.trim()));
            if (request.method() === 'GET' && url.pathname === '/rest/v1/restaurants'
                && fields.has('approved_name') && fields.has('lat') && fields.has('lng')
                && fields.has('tzuyang_review') && !fields.has('phone')) compactRequests++;
        });
        const releaseSdk = await installDeferredMobileHomeMapTestMocks(page);
        try {
            // The SDK response is intentionally pending; wait only for DOM readiness.
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await expect.poll(() => sdkRequests, { timeout: 20000 }).toBeGreaterThan(0);
            await expect.poll(() => compactRequests, { timeout: 15000 }).toBeGreaterThan(0);
            expect(await page.evaluate(() => Boolean((window as Window & { naver?: unknown }).naver))).toBe(false);
            await expect(page.locator('[data-testid="marker"]')).toHaveCount(0);
            releaseSdk();
            await waitForMockMapReady(page);
            // At the initial national zoom, the three fixtures form one cluster.
            const cluster = page.locator('.cluster-marker-container').first();
            await expect(cluster).toBeAttached();
            // Use the mock's existing cluster event path, which recenters as it zooms.
            await cluster.evaluate((element) => (element as HTMLElement).click());
            await waitForVisibleMarkers(page, 3);
            await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0);
        } finally {
            releaseSdk();
            // The page fixture owns route teardown; retain its network guards until then.
        }
    });
}
