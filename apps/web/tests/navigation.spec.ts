import { test, expect } from '@playwright/test';
import { hidePopupOverlay } from './helpers';

test.describe('Phase 3: Navigation Features', () => {

    test('NAV-01: 하단 네비게이션 바 동작 (모바일)', async ({ page, isMobile }) => {
        // 모바일 환경에서만 실행
        if (!isMobile) test.skip();

        await page.goto('/');
        await hidePopupOverlay(page);
        await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 10000 });

        // 하단 네비게이션 바 확인
        const bottomNav = page.getByTestId('bottom-nav');
        await expect(bottomNav).toBeVisible();

        // 도장 탭 클릭
        const stampTab = page.getByTestId('bottom-nav-stamp');
        await stampTab.click();
        await expect(page).toHaveURL(/\/stamp/);

        // 랭킹 탭 클릭
        await hidePopupOverlay(page);
        const leaderboardTab = page.getByTestId('bottom-nav-leaderboard');
        await leaderboardTab.click();
        await expect(page).toHaveURL(/\/leaderboard/);

        // 홈 탭 클릭
        await hidePopupOverlay(page);
        const homeTab = page.getByTestId('bottom-nav-home');
        await homeTab.click();
        await expect(page).toHaveURL(/^http.*:8080\/($|\?)/);
    });

    test('NAV-02: URL 직접 접근 - 각 페이지 정상 로딩', async ({ page }) => {
        // 스탬프 페이지
        await page.goto('/stamp');
        await hidePopupOverlay(page);
        await expect(page.getByRole('heading', { name: /도장/i })).toBeVisible({ timeout: 15000 });

        // 리더보드 페이지
        await page.goto('/leaderboard');
        await hidePopupOverlay(page);
        await expect(page.getByRole('heading', { name: /랭킹/i })).toBeVisible({ timeout: 15000 });

        // 피드 페이지
        await page.goto('/feed');
        await hidePopupOverlay(page);
        await expect(page.getByTestId('feed-page-container')).toBeVisible({ timeout: 15000 });
    });

    test('NAV-03: 페이지 타이틀 확인', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/쯔동여지도/);

        await page.goto('/stamp');
        await expect(page).toHaveTitle(/쯔동여지도/);

        await page.goto('/leaderboard');
        await expect(page).toHaveTitle(/쯔동여지도/);
    });
});
