import { expect, test } from './nightly/nightly-test';
import { hidePopupOverlay } from './helpers';

test.describe('Desktop left panel scrollbar chrome', () => {
  test('hides panel scrollbars while preserving usable scroll containers', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, '데스크탑 좌측 패널 전용 회귀 테스트');

    await page.goto('/?panel=stamp', { waitUntil: 'domcontentloaded' });
    await hidePopupOverlay(page);

    const panel = page.locator('#desktop-left-map-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toHaveClass(/desktop-left-panel-scrollbarless/);

    const scrollRoot = panel.locator('.overflow-y-auto').first();
    await expect(scrollRoot).toBeVisible();

    const scrollState = await scrollRoot.evaluate((element) => {
      const previousScrollTop = element.scrollTop;
      element.scrollTop = 1;
      const style = window.getComputedStyle(element);
      const canScrollOrDoesNotNeedScroll =
        element.scrollTop === 1 || element.scrollHeight <= element.clientHeight;
      element.scrollTop = previousScrollTop;

      return {
        canScrollOrDoesNotNeedScroll,
        overflowX: style.overflowX,
        scrollbarWidth: style.scrollbarWidth,
      };
    });

    expect(scrollState).toMatchObject({
      canScrollOrDoesNotNeedScroll: true,
      overflowX: 'hidden',
      scrollbarWidth: 'none',
    });
  });
});
