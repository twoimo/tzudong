import type { Page } from '@playwright/test';
import { installMobileHomeMapTestMocks } from './mobile-home-map-helpers';

export async function installViewportContinuityMocks(page: Page) {
    await installMobileHomeMapTestMocks(page, { countMapCreations: true });
}
