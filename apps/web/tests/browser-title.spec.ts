import { expect, test } from './nightly/nightly-test';

const publicTitleCases = [
    ['/', '쯔양이 다녀간 맛집 지도 - 쯔동여지도'],
    ['/feed', '피드 - 쯔동여지도'],
    ['/global-map', '국내·해외 맛집 지도 - 쯔동여지도'],
    ['/stamp', '도장 - 쯔동여지도'],
    ['/leaderboard', '랭킹 - 쯔동여지도'],
    ['/insights', '맛집 인사이트 - 쯔동여지도'],
    ['/privacy', '개인정보 처리방침 - 쯔동여지도'],
    ['/data-deletion', '데이터 삭제 요청 - 쯔동여지도'],
] as const;

test.describe('browser title policy', () => {
    test.setTimeout(60_000);

    test('public routes expose page-first browser titles', async ({ page }, testInfo) => {
        for (const [path, expectedTitle] of publicTitleCases) {
            await page.goto(path, { waitUntil: 'domcontentloaded' });
            await expect(page).toHaveTitle(expectedTitle);
        }

        await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: '개인정보 처리방침', exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('privacy-title.png'), fullPage: true });
    });
});
