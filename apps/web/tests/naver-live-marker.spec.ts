import { expect, test, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hidePopupOverlay } from './helpers';
import {
    clickAnyUnselectedMarker,
    installMobileHomeDataMocks,
    openMobileSearchAndSelect,
    waitForVisibleMarkers,
} from './mobile-home-map-helpers';

function readEnvFileValue(name: string): string | null {
    const envPath = resolve(process.cwd(), '.env.local');
    if (!existsSync(envPath)) return null;

    const line = readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .find((candidate) => candidate.trim().startsWith(`${name}=`));
    if (!line) return null;

    return line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
}

const liveNaverClientId =
    process.env.NEXT_PUBLIC_NAVER_CLIENT_ID?.trim()
    || readEnvFileValue('NEXT_PUBLIC_NAVER_CLIENT_ID')?.trim();
const hasLiveNaverClientId = Boolean(
    liveNaverClientId
    && !/^your[-_]/i.test(liveNaverClientId)
    && liveNaverClientId !== 'test'
);

test.use({
    ...devices['iPhone SE'],
});

test.describe('Naver Maps live provider marker flow', () => {
    test.skip(!hasLiveNaverClientId, 'NEXT_PUBLIC_NAVER_CLIENT_ID is required for live Naver Maps provider smoke');

    test('loads the real Naver Maps provider and opens another restaurant from a marker click', async ({ page }) => {
        await installMobileHomeDataMocks(page);

        await page.goto('/');
        await hidePopupOverlay(page);

        await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 15000 });
        await page.waitForFunction(
            () => {
                const script = document.querySelector('script[src*="oapi.map.naver.com/openapi/v3/maps.js"]');
                const naverWindow = window as typeof window & {
                    naver?: { maps?: { Map?: unknown; Marker?: unknown } };
                };
                return Boolean(script && naverWindow.naver?.maps?.Map && naverWindow.naver?.maps?.Marker);
            },
            undefined,
            { timeout: 30000 }
        );

        await openMobileSearchAndSelect(page, '정원분식');
        await expect(page.getByTestId('restaurant-detail-panel')).toContainText('정원분식');

        await page.evaluate(() => {
            const map = (window as typeof window & {
                __TZUDONG_DEBUG_MAP__?: { setZoom?: (zoom: number) => void };
            }).__TZUDONG_DEBUG_MAP__;
            map?.setZoom?.(18);
        });

        await waitForVisibleMarkers(page, 3);
        await clickAnyUnselectedMarker(page);

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
});
