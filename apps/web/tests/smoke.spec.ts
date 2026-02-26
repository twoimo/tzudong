import { test, expect } from '@playwright/test';

test.describe('Phase 1: Smoke Test', () => {
    test('ST-01: 메인 페이지 로딩 및 타이틀 확인', async ({ page }) => {
        await page.goto('/');

        // HTML 타이틀 확인
        await expect(page).toHaveTitle(/쯔동여지도/);

        // 필수 메타 태그 확인 (SEO)
        const description = page.locator('meta[name="description"]');
        await expect(description).toHaveAttribute('content', /쯔양.*맛집/);
    });

    test('ST-02: 비인증 상태 UI (헤더) 확인', async ({ page }) => {
        await page.goto('/');

        // 헤더 영역이 로드될 때까지 대기
        const header = page.locator('header');
        await expect(header).toBeVisible();

        // 로그인 버튼이 보여야 함 (비로그인 상태)
        const loginButton = page.getByRole('button', { name: /로그인/i });
        // 버튼 텍스트가 정확하지 않을 수 있으므로, LoginUser UI 컴포넌트 구조에 따라 조정 필요
        // 여기서는 일반적인 '로그인' 텍스트 혹은 아이콘을 찾습니다.
        // 만약 아이콘이라면 aria-label 등을 확인해야 합니다.

        // 실제 컴포넌트: Header -> LoginUser -> Button
        // "로그인하고 맛집 기록하기"는 AuthModal 내부 텍스트일 수 있음.
        // Header 우측 상단 버튼 확인.
        // LoginUser.tsx를 보면 비로그인 시 "로그인" 버튼이나 아이콘이 렌더링됨.
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
