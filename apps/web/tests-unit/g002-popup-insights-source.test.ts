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
    expect(combinedDismissBody).toContain('localStorage.setItem(DISMISSED_DATE_KEY, getTodayString())');

    const dailyCloseBody = dailyPopupSource.match(/const handleClose = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
    const dailyDismissBody = dailyPopupSource.match(/const handleDismissToday = \(\) => \{[\s\S]*?\n    \};/)?.[0] ?? '';
    expect(dailyCloseBody).toContain('setIsVisible(false)');
    expect(dailyCloseBody).not.toContain('localStorage.setItem');
    expect(dailyDismissBody).toContain('localStorage.setItem(POPUP_STORAGE_KEY, tomorrow.toISOString())');
    expect(dailyPopupSource).toContain('const shouldShowPopup = isHomePage;');
  });

  test('insights treemap exposes dense context legend and small-cell guidance', () => {
    const insightsSource = source('app/insights/insights-client.tsx');

    expect(insightsSource).toContain('data-insights-treemap-context="true"');
    expect(insightsSource).toContain('트리맵 기준: ${metricLabel} · ${periodLabel} · ${selectedCount.toLocaleString()}개 영상 · ${modeLabel} · ${clusterContextText}');
    expect(insightsSource).toContain('색상 범례: 전체 ${metricLabel} 비중이 높을수록 밝은 초록색입니다.');
    expect(insightsSource).toContain('색상 범례: ${periodLabel} 대비 ${metricLabel} 증감률이 높을수록 밝은 초록색입니다.');
    expect(insightsSource).toContain('작은 칸 안내: 공간이 좁으면 지표나 …만 표시되고');
    expect(insightsSource).toContain('aria-describedby="insights-treemap-context insights-treemap-small-cell-guidance"');
  });
});
