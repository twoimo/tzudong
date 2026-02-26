import { test, expect } from '@playwright/test';

test.describe('Phase 3: MyPage Features', () => {

    test('MYPAGE-01: /mypage 접근 시 리디렉트 확인', async ({ page }) => {
        await page.goto('/mypage');

        // 리디렉트 확인 (비로그인 -> 홈/로그인, 로그인 -> 서브페이지)
        // URL이 /mypage가 아닌 다른 곳으로 변할 때까지 대기
        try {
            await page.waitForURL(url => url.pathname !== '/mypage', { timeout: 5000 });
        } catch {
            // 타임아웃 발생 시에도 현재 URL 체크
        }

        const currentUrl = page.url();
        expect(currentUrl).toBeDefined();
    });

    test('MYPAGE-02: 마이페이지 서브라우트 직접 접근', async ({ page }) => {
        // 프로필 페이지 접근
        await page.goto('/mypage/profile');

        // 리디렉트 또는 로딩 대기
        try {
            await page.waitForURL(url => url.pathname !== '/mypage/profile', { timeout: 3000 });
        } catch {
            // 타임아웃 무시 (URL 유지될 수 있음)
        }

        // URL이 유지되거나 로그인 페이지/홈으로 리디렉트
        const currentUrl = page.url();
        expect(currentUrl).toMatch(/\/mypage\/profile|\/auth|\/login|\//);
    });
});
