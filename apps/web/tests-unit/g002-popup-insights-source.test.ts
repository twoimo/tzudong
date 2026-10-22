import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldSuppressNoncriticalChromeForPathname } from '@/lib/noncritical-chrome-routes';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('G002 popup and insights hardening contracts', () => {
  test('suppresses noncritical popup chrome on mypage and insights while preserving home eligibility', () => {
    for (const pathname of [
      '/feed',
      '/stamp',
      '/leaderboard',
      '/mypage',
      '/mypage/profile',
      '/insights',
      '/insights/details',
      '/admin',
      '/admin/users',
      '/auth/required',
    ]) {
      expect(shouldSuppressNoncriticalChromeForPathname(pathname), pathname).toBe(true);
    }

    for (const pathname of ['/', '/global-map', '/privacy', '/data-deletion']) {
      expect(shouldSuppressNoncriticalChromeForPathname(pathname), pathname).toBe(false);
    }

    const mainLayoutSource = source('components/layout/MainLayout.tsx');
    const overlayLayoutSource = source('components/layout/OverlayLayout.tsx');

    expect(mainLayoutSource).toContain('shouldSuppressNoncriticalChromeForPathname(pathname)');
    expect(overlayLayoutSource).toContain('shouldSuppressNoncriticalChromeForPathname(pathname)');
    expect(overlayLayoutSource).toContain('routeDirectPanelParam !== null');
  });

  test('direct popup e2e proof does not hide overlays with helpers', () => {
    const specSource = source('tests/g002-popup-insights.spec.ts');

    expect(specSource).toContain("page.goto('/mypage/profile'");
    expect(specSource).toContain("page.goto('/insights'");
    expect(specSource).toContain('[data-popup-overlay="true"]');
    expect(specSource).not.toContain('gotoAndHidePopup');
    expect(specSource).not.toContain('hidePopupOverlay');
    expect(specSource).not.toContain('addStyleTag');
  });

  test('popup close and today-dismiss semantics stay separate', () => {
    const combinedPopupSource = source('components/layout/CombinedPopup.tsx');
    const dailyPopupSource = source('components/recommendation/DailyRecommendationPopup.tsx');

    const combinedCloseBody = combinedPopupSource.match(/const handleClose = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    const combinedDismissBody = combinedPopupSource.match(/const handleDismissToday = useCallback\([\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    expect(combinedCloseBody).toContain('setIsVisible(false)');
    expect(combinedCloseBody).not.toContain('localStorage.setItem');
    expect(combinedDismissBody).toContain("writeBrowserStorageString('local', DISMISSED_DATE_KEY, getTodayString())");

    const dailyCloseBody = dailyPopupSource.match(/const handleClose = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
    const dailyDismissBody = dailyPopupSource.match(/const handleDismissToday = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
    expect(dailyCloseBody).toContain('setIsVisible(false)');
    expect(dailyCloseBody).not.toContain('localStorage.setItem');
    expect(dailyDismissBody).toContain("writeBrowserStorageString('local', POPUP_STORAGE_KEY, tomorrow.toISOString())");
    expect(dailyPopupSource).toContain('const shouldShowPopup = isHomePage;');
  });

  test('insights treemap keeps guidance in an operable popover and chart description', () => {
    const insightsSource = source('app/insights/insights-client.tsx');

    expect(insightsSource).toContain('aria-label="트리맵 읽는 법"');
    expect(insightsSource).toContain('<PopoverTrigger asChild>');
    expect(insightsSource).toContain('<PopoverContent aria-label="트리맵 읽는 법" side="bottom"');
    expect(insightsSource).toContain('<p>{treemapLegendText}</p>');
    expect(insightsSource).toContain('onOpenAutoFocus={(event) => event.preventDefault()}');
    expect(insightsSource).toContain('id="insights-treemap-legend"');
    expect(insightsSource).toContain('id="insights-treemap-small-cell-guidance"');
    expect(insightsSource).toContain('aria-describedby="insights-treemap-legend insights-treemap-small-cell-guidance"');
    expect(insightsSource).not.toContain('data-insights-treemap-context="true"');
  });
});
