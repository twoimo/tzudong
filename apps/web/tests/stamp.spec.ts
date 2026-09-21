import { test, expect } from '@playwright/test';
import { hidePopupOverlay, expandMobileFilter } from './helpers';

test.describe('Phase 3: Stamp Page Features', () => {
    test.beforeEach(async ({ page, isMobile }) => {
        await page.goto(isMobile ? '/stamp' : '/?panel=stamp');
        await hidePopupOverlay(page);
        // 모바일/태블릿은 독립 /stamp 페이지, 데스크탑은 지도 좌측 패널에서 도장 UX를 제공한다.
        if (isMobile) {
            await expect(page.getByTestId('stamp-page-container')).toBeVisible({ timeout: 15000 });
        } else {
            await expect(page.locator('[data-desktop-left-map-panel="true"]')).toBeVisible({ timeout: 15000 });
        }
        await expect(page.getByRole('heading', { name: /쯔동여지도 도장/i })).toBeVisible({ timeout: 15000 });
    });

    test('STAMP-01: 스탬프 페이지 로딩 및 헤더 렌더링', async ({ page }) => {
        // 페이지 타이틀 확인
        const header = page.getByRole('heading', { name: /쯔동여지도 도장/i });
        await expect(header).toBeVisible();

        // 총 개수 표시 확인
        const totalCount = page.getByText(/전체.*개|\(\d+개\)/).first();
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

    test('STAMP-06: 내부 스크롤 끝에서 다음 도장 카드 로딩', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium에서 모바일 라우트의 내부 스크롤 회귀를 검증합니다.');

        await page.setViewportSize({ width: 560, height: 964 });
        await page.goto('/stamp');
        await hidePopupOverlay(page);

        const scrollContainer = page.locator('[data-stamp-scroll-container="true"]');
        await expect(scrollContainer).toBeVisible({ timeout: 15000 });

        const cards = page.locator('[aria-label*="도장 카드 열기"]');
        await expect(cards.first()).toBeVisible({ timeout: 15000 });
        const loadMoreStatus = page
            .locator('[data-stamp-load-more-sentinel="true"]')
            .getByRole('status');
        await expect(loadMoreStatus).toBeVisible({ timeout: 15000 });
        const initialCardCount = await cards.count();
        expect(initialCardCount).toBeGreaterThan(0);

        await scrollContainer.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
        });

        await expect.poll(() => cards.count(), { timeout: 10000 }).toBeGreaterThan(initialCardCount);
    });
});
