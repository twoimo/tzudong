import { test, expect } from '@playwright/test';
import { hidePopupOverlay, expandMobileFilter } from './helpers';

test.describe('Phase 3: Stamp Page Features', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/stamp');
        await hidePopupOverlay(page);
        // 페이지 로딩 대기
        await expect(page.getByTestId('stamp-page-container')).toBeVisible({ timeout: 15000 });
    });

    test('STAMP-01: 스탬프 페이지 로딩 및 헤더 렌더링', async ({ page }) => {
        // 페이지 타이틀 확인
        const header = page.getByRole('heading', { name: /쯔동여지도 도장/i });
        await expect(header).toBeVisible();

        // 총 개수 표시 확인
        const totalCount = page.getByText(/전체.*개/);
        await expect(totalCount).toBeVisible();
    });

    test('STAMP-02: 검색 기능', async ({ page, isMobile }) => {
        // 모바일에서는 필터 확장 필요
        if (isMobile) await expandMobileFilter(page);

        const searchInput = page.getByPlaceholder(/맛집명 검색/i);
        if (await searchInput.isVisible()) {
            await searchInput.fill('정원');
            await page.waitForTimeout(500);
        }
    });

    test('STAMP-03: 지역 필터 동작', async ({ page, isMobile }) => {
        if (isMobile) await expandMobileFilter(page);

        const regionFilter = page.getByRole('button', { name: /지역/i });
        if (await regionFilter.isVisible()) {
            await regionFilter.click();
            const regionPopover = page.getByText('지역 선택');
            await expect(regionPopover).toBeVisible();

            const seoulCheckbox = page.getByLabel('서울');
            if (await seoulCheckbox.isVisible()) {
                await seoulCheckbox.check();
            }
        }
    });

    test('STAMP-04: 카테고리 필터 동작', async ({ page, isMobile }) => {
        if (isMobile) await expandMobileFilter(page);

        const categoryFilter = page.getByRole('button', { name: /카테고리/i });
        if (await categoryFilter.isVisible()) {
            await categoryFilter.click();
            const categoryPopover = page.getByText('카테고리 선택');
            await expect(categoryPopover).toBeVisible();
        }
    });

    test('STAMP-05: 카드/리스트 뷰 전환 (데스크탑)', async ({ page, isMobile }) => {
        if (isMobile) test.skip();

        const viewToggle = page.getByRole('button', { name: /리스트 뷰로 보기|그리드 뷰로 보기/i });
        if (await viewToggle.isVisible()) {
            await viewToggle.click();
            await page.waitForTimeout(300);
        }
    });
});
