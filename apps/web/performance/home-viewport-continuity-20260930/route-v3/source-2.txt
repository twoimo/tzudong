import type { Page } from '@playwright/test';
import { installMobileHomeMapTestMocks } from './mobile-home-map-helpers';

export async function installViewportContinuityMocks(page: Page) {
    await installMobileHomeMapTestMocks(page);
    await page.addInitScript(() => {
        const lab = window as Window & { __viewportMapCreates?: number; __TZUDONG_DEBUG_MAP__?: object };
        const OriginalMap = window.naver.maps.Map as new (...args: unknown[]) => object;
        window.naver.maps.Map = class extends OriginalMap {
            constructor(...args: unknown[]) {
                super(...args);
                lab.__viewportMapCreates = (lab.__viewportMapCreates ?? 0) + 1;
                lab.__TZUDONG_DEBUG_MAP__ = this;
            }
        };
    });
}
