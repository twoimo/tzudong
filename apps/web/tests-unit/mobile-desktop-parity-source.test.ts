import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('mobile and desktop parity source contracts', () => {
  test('responsive overflow smoke includes the unified admin console route', () => {
    const responsiveSpecSource = source('tests/responsive-overflow.spec.ts');
    const responsiveScriptSource = source('scripts/run-responsive-tests.mjs');

    expect(responsiveSpecSource).toContain("'/admin'");
    expect(responsiveSpecSource).toContain("'/admin/evaluations'");
    expect(responsiveSpecSource).toContain("'/admin/banners'");
    expect(responsiveScriptSource).toContain('admin route responsive cases will be skipped');
  });

  test('admin console exposes both mobile-width and desktop-width navigation affordances', () => {
    const adminPageSource = source('app/admin/page.tsx');
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(adminPageSource).toContain('<AdminConsoleOverview />');
    expect(consoleSource).toContain('aria-label="관리자 콘솔 사이드바"');
    expect(consoleSource).toContain('aria-label="관리자 통합 메뉴"');
    expect(consoleSource).toContain('lg:sticky lg:top-0');
    expect(consoleSource).toContain('lg:w-60');
    expect(consoleSource).toContain('lg:w-14');
    expect(consoleSource).toContain('관리자 사이드바 펼치기');
    expect(consoleSource).toContain('관리자 사이드바 접기');
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain('AdminEvaluationModule');
    expect(consoleSource).toContain('AdminBannerModule');
    expect(consoleSource).toContain('AdminAnnouncementModule');
    expect(consoleSource).toContain('id: "announcements"');
    expect(consoleSource).toContain('/admin?module=announcements');
    expect(consoleSource).toContain('useSearchParams');
    expect(consoleSource).toContain('router.replace');
    expect(consoleSource).toContain('getAdminModuleIdFromSearchParams');
    expect(consoleSource).not.toContain('window.history.replaceState');
  });

  test('admin evaluations keep equivalent mobile-card and desktop-table controls', () => {
    const tableSource = source('components/admin/EvaluationTableNew.tsx');

    expect(tableSource).toContain('const mobileControls = (');
    expect(tableSource).toContain('const mobileCards = (');
    expect(tableSource).toContain('grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden');
    expect(tableSource).toContain('hidden rounded-lg border lg:block');
    expect(tableSource).toContain('aria-label="영상 제목 검색"');
    expect(tableSource).toContain('aria-label="검색어 지우기"');
    expect(tableSource).toContain('필터 초기화');
    expect(tableSource).toContain('상세 필터');
    expect(tableSource).toContain('전체 검수 정보');
    expect(tableSource).toContain('레코드 삭제');
    expect(tableSource.match(/되돌리기/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(tableSource.match(/수정/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(tableSource.match(/승인/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test('banner admin mobile cards and desktop table expose matching actions with keyboard upload access', () => {
    const bannerSource = source('app/admin/banners/page.tsx');

    expect(bannerSource).toContain('space-y-3 md:hidden');
    expect(bannerSource).toContain('hidden overflow-hidden border-border bg-card/95 shadow-sm md:block');
    expect(bannerSource.match(/공개 상태 전환/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bannerSource.match(/링크 열기/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bannerSource.match(/수정`}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bannerSource.match(/삭제`}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bannerSource).toContain('role="button"');
    expect(bannerSource).toContain('tabIndex={0}');
    expect(bannerSource).toContain('aria-label="배너 이미지 또는 영상 업로드"');
    expect(bannerSource).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(bannerSource).toContain('isNestedUploadInteractiveTarget(event.target)');
    expect(bannerSource).toContain('focus-visible:ring-2 focus-visible:ring-primary');
    expect(bannerSource).toContain('id="banner-media-upload"');
  });

  test('home navigation parity keeps desktop header routes and mobile overlay routes aligned intentionally', () => {
    const headerSource = source('components/layout/Header.tsx');
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');
    const mobileBottomNavSource = source('components/layout/MobileBottomNav.tsx');
    const navigationRoutesSource = source('components/layout/navigation-routes.ts');

    expect(headerSource).toContain("router.push('/admin')");
    expect(headerSource).toContain("router.push('/admin?module=announcements')");
    expect(mobileOverlaySource).toContain("router.push('/admin')");
    expect(headerSource).toContain('관리자 콘솔');
    expect(mobileOverlaySource).toContain('관리자 콘솔');
    expect(headerSource).toContain('인사이트');
    expect(mobileOverlaySource).toContain('인사이트');
    expect(navigationRoutesSource).toContain("'/admin'");
    expect(navigationRoutesSource).toContain("'/admin/evaluations'");
    expect(navigationRoutesSource).toContain("'/admin/banners'");
    expect(mobileBottomNavSource).toContain("path: '/'");
    expect(mobileBottomNavSource).toContain("path: '/stamp'");
  });
});
