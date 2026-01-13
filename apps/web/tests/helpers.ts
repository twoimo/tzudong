import { Page } from '@playwright/test';

/**
 * 페이지 로딩 후 popup overlay 및 dev overlay를 숨기는 헬퍼 함수
 * 모든 테스트의 beforeEach에서 호출하여 클릭 차단 문제 해결
 */
export async function hidePopupOverlay(page: Page): Promise<void> {
    await page.addStyleTag({
        content: `
            [data-popup-overlay="true"] { display: none !important; }
            nextjs-portal { display: none !important; }
            [data-nextjs-dev-overlay] { display: none !important; }
        `
    });
}

/**
 * 페이지 로딩 및 popup overlay 숨김 처리를 포함한 goto 래퍼
 */
export async function gotoAndHidePopup(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await hidePopupOverlay(page);
}

/**
 * 모바일 환경에서 필터 버튼이 보이면 확장
 */
export async function expandMobileFilter(page: Page): Promise<void> {
    const filterBtn = page.getByRole('button', { name: /필터/i }).first();
    if (await filterBtn.isVisible()) {
        await filterBtn.click();
        // 애니메이션 대기
        await page.waitForTimeout(300);
    }
}
