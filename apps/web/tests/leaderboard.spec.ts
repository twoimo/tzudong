import { test, expect } from '@playwright/test';
import { hidePopupOverlay } from './helpers';

test('LEADERBOARD-01: 빈 결과 캐시 후 재진입하면 최신 랭킹을 다시 읽는다', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium에서 캐시 재검증 흐름을 검증합니다.');

    await page.setViewportSize({ width: 560, height: 964 });

    let serveEmptyResult = true;
    const leaderboardRpc = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
        if (!serveEmptyResult) {
            await route.continue();
            return;
        }

        serveEmptyResult = false;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
        });
    };

    await page.route('**/rest/v1/rpc/read_public_profile_leaderboard_page', leaderboardRpc);
    await page.goto('/leaderboard');
    await hidePopupOverlay(page);
    await expect(page.getByText('아직 랭킹 데이터가 없습니다')).toBeVisible({ timeout: 15000 });
    await page.unroute('**/rest/v1/rpc/read_public_profile_leaderboard_page', leaderboardRpc);

    await page.getByTestId('bottom-nav-stamp').click();
    await expect(page).toHaveURL(/\/stamp/);
    await page.getByTestId('bottom-nav-leaderboard').click();
    await expect(page).toHaveURL(/\/leaderboard/);
    await expect(page.getByRole('link', { name: '쯔동마스터' })).toBeVisible({ timeout: 15000 });
});
