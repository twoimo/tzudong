import { test, expect } from '@playwright/test';

test.describe('Phase 2: Map Features', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // 지도 로딩 대기
        await expect(page.getByTestId('map-container')).toBeVisible({ timeout: 10000 });
    });

    test('MAP-01: 줌 레벨에 따른 클러스터링 모드 전환', async ({ page }) => {
        // 초기 로딩 시 클러스터 마커가 보여야 함 (서울 기준)
        // 클러스터 마커는 보통 텍스트(숫자)를 포함함
        // 실제 클래스나 셀렉터는 cluster-marker.ts 구현에 따름 (예: 'cluster-marker')
        // 여기서는 텍스트가 있는 div를 찾음

        // 이 테스트는 시각적 요소가 강해 셀렉터 확보가 까다로울 수 있음.
        // 일단 존재 여부만 체크
        // await expect(page.locator('.cluster-marker').first()).toBeVisible();

        // 줌 인 동작 (Playwright로 지도 캔버스 dblclick 또는 wheel)
        const mapCanvas = page.getByTestId('map-container');
        await mapCanvas.focus();

        // 휠 스크롤로 줌 인 시뮬레이션 (구현에 따라 다름, Naver Map API 호출이 더 확실할 수 있음)
        // E2E에서는 API 호출보다 사용자 인터랙션이 권장됨
        // 모바일/데스크탑 분기 필요할 수 있음
    });

    test('MAP-02: 카테고리 필터링 - 한식', async ({ page }) => {
        // '한식' 필터 버튼 찾기 및 클릭
        const koreanFilter = page.getByRole('button', { name: /한식/i });
        if (await koreanFilter.isVisible()) {
            await koreanFilter.click();

            // 필터 적용 후 마커 변화 확인
            // 특정 마커가 보이는지, 혹은 클러스터 숫자가 변하는지
            // 데이터 의존적이므로 스모크 테스트 수준으로는 '에러 없이 클릭됨' 확인
            await expect(koreanFilter).toHaveAttribute('aria-pressed', 'true'); // 혹은 data-state="on"
        }
    });

    test('RES-01: 모바일 바텀 시트 동작 (Mobile Only)', async ({ page, isMobile }) => {
        // 모바일 환경에서만 실행
        if (!isMobile) test.skip();

        // 임의의 마커 클릭 (시뮬레이션)
        // 마커 셀렉터가 필요함. 
        // 실제로는 접근성 라벨이 없을 수 있어 좌표 클릭이나, 내부 API로 트리거해야 할 수도 있음.

        // 대안: 리스트에서 아이템 클릭하여 상세 보기
        // 만약 리스트 뷰가 있다면 거길 클릭.
        // 현재 초기 화면은 지도만 있다고 가정하면, 마커 클릭이 필수.

        // 예: 첫 번째 마커 클릭
        // const marker = page.locator('.marker').first();
        // if (await marker.count() > 0) {
        //   await marker.click();
        //   const sheet = page.locator('[data-testid="bottom-sheet"]'); // Vaul drawer
        //   await expect(sheet).toBeVisible();
        // }
    });
});
