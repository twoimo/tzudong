import { test, expect } from './nightly/nightly-test';

test.describe('Phase 1: Smoke Test', () => {
    test('ST-01: 메인 페이지 로딩 및 타이틀 확인', async ({ page }) => {
        await page.goto('/');

        // HTML 타이틀 확인
        await expect(page).toHaveTitle(/쯔동여지도/);

        // 필수 메타 태그 확인 (SEO)
        const description = page.locator('meta[name="description"]');
        await expect(description).toHaveAttribute('content', /쯔양.*맛집/);
    });

    test('ST-02: 비인증 상태 홈 UI 확인', async ({ page }) => {
        await page.goto('/');

        const main = page.getByRole('main');
        await expect(main).toBeVisible();

        const homeRegion = page.getByRole('region', { name: '쯔동여지도 홈 지도 화면' });
        await expect(homeRegion).toBeVisible();

        const searchBox = page.getByRole('textbox', { name: '맛집 검색어 입력' });
        await expect(searchBox).toBeVisible();

        const loginButton = page.getByRole('button', { name: '로그인 열기' });
        await expect(loginButton).toBeVisible();
    });

    // 지도 컨테이너 로딩 확인은 클라이언트 로직이 포함되므로 약간의 대기가 필요할 수 있음
    test('ST-03: 지도 컨테이너 렌더링 확인', async ({ page }) => {
        await page.goto('/');

        // Map skeleton or actual map container
        // HomeMapContainer의 ID나 Class를 확인해야 함
        // home-map-container.tsx를 보면 suspense fallback으로 MapSkeleton이 뜸.
        // 실제 지도는 #map 또는 .map-container 등을 가질 것임.

        // NaverMapView 내부 div (data-testid="map-container")
        const mapDiv = page.getByTestId('map-container');
        await expect(mapDiv).toBeVisible({ timeout: 10000 }); // 지도 로딩 여유 시간
    });
});
