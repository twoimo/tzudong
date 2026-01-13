import { test, expect } from '@playwright/test';

test.describe('Phase 2: Auth Features', () => {

    test('AUTH-03: 비로그인 상태 제한 확인', async ({ page }) => {
        // 1. 메인 페이지 접속
        await page.goto('/');

        // 2. 헤더에 로그인 버튼이 있는지 확인
        // 정확한 텍스트나 아리아 라벨은 실제 구현에 따라 달라질 수 있음
        // 일반적으로 "로그인" 또는 "Sign In" 텍스트 포함
        const loginBtn = page.getByRole('button', { name: /로그인/i }).first();
        await expect(loginBtn).toBeVisible();

        // 3. 보호된 기능 접근 시도 (예: 제보하기)
        // 제보하기 버튼 찾기 (플로팅 버튼 등)
        // "제보하기" 텍스트가 있는 버튼
        const submitBtn = page.getByRole('button', { name: /제보하기/i });
        if (await submitBtn.isVisible()) {
            await submitBtn.click();

            // 로그인 모달이 떠야 함
            // AuthModal.tsx 참조: DialogTitle "쯔동여지도", Description "쯔양의 맛집을 리뷰하고 공유하세요"
            const authModalTitle = page.getByRole('heading', { name: '쯔동여지도' });
            await expect(authModalTitle).toBeVisible();
        }
    });

    test('AUTH-01: 로그인 모달 UI 확인', async ({ page }) => {
        await page.goto('/');

        // 로그인 버튼 클릭
        await page.getByRole('button', { name: /로그인/i }).first().click();

        // 구글 로그인 버튼 확인
        const googleBtn = page.getByText(/Google로 계속하기/i); // 또는 button name="google"
        await expect(googleBtn).toBeVisible();

        // 카카오 로그인 버튼 확인 (만약 있다면)
        // const kakaoBtn = page.getByText(/Kakao로 계속하기/i);
        // if (await kakaoBtn.count() > 0) {
        //    await expect(kakaoBtn).toBeVisible();
        // }
    });

});
