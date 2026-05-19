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
    expect(consoleSource).toContain('관리자 콘솔');
    expect(consoleSource).toContain('현재 화면 · {activeSidebarLabel}');
    expect(consoleSource).not.toContain('관리자 메뉴');
    expect(consoleSource).not.toContain('Unified admin console');
    expect(consoleSource).toContain('sticky top-0 z-30');
    expect(consoleSource).toContain('flex gap-2 overflow-x-auto overscroll-x-contain');
    expect(consoleSource).toContain('min-h-11 min-w-[8.25rem]');
    expect(consoleSource).toContain('lg:block lg:min-h-0 lg:flex-1');
    expect(consoleSource).toContain('lg:w-48');
    expect(consoleSource).toContain('lg:w-14');
    expect(consoleSource).toContain('관리자 사이드바 펼치기');
    expect(consoleSource).toContain('관리자 사이드바 접기');
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain('AdminRestaurantEvaluationModule');
    expect(consoleSource).toContain('AdminSubmissionEvaluationModule');
    expect(consoleSource).toContain('AdminReviewEvaluationModule');
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
    expect(tableSource).toContain('getAddressConsistencyDisplayLabel');
    expect(tableSource).not.toContain('border-sky-200 bg-sky-50');
    expect(tableSource).toContain('검수 항목 삭제');
    expect(tableSource.match(/되돌리기/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(tableSource.match(/수정/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(tableSource.match(/승인/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(tableSource).toContain('누락 사유:');
    expect(tableSource).toContain('판정 근거');
    expect(tableSource).toContain('쯔양 리뷰 요약');
    expect(tableSource).toContain("{ value: 'true', label: '확인됨' }");
    expect(tableSource).toContain("{ value: 'false_geocode', label: '실패' }");
    expect(tableSource).toContain("{ value: 'missing', label: '누락' }");
    expect(tableSource).not.toContain('Missing 사유:');
    expect(tableSource).not.toContain('Reasoning Basis');
    expect(tableSource).not.toContain('Tzuyang Review');
  });


  test('admin evaluation destructive actions use inline typed confirmation across breakpoints', () => {
    const evaluationsSource = source('app/admin/evaluations/page.tsx');

    expect(evaluationsSource).toContain("const EVALUATION_DELETE_CONFIRMATION = '검수삭제'");
    expect(evaluationsSource).toContain("const EVALUATION_RESTORE_CONFIRMATION = '검수복원'");
    expect(evaluationsSource).toContain('role="region"');
    expect(evaluationsSource).toContain('aria-label="검수 항목 작업 확인"');
    expect(evaluationsSource).toContain('aria-label="검수 항목 작업 확인 문구"');
    expect(evaluationsSource).toContain('모바일과 데스크톱 모두 같은 흐름으로 처리합니다.');
    expect(evaluationsSource).not.toContain('정말 삭제하시겠습니까?');
    expect(evaluationsSource).not.toContain('복원하시겠습니까?');
  });

  test('embedded submission and review modules cannot switch into restaurant evaluation view', () => {
    const evaluationsSource = source('app/admin/evaluations/page.tsx');

    expect(evaluationsSource).toContain("const canSwitchEvaluationView = !embedded || initialView === 'evaluations';");
    expect(evaluationsSource).toContain('{canSwitchEvaluationView && (');
    expect(evaluationsSource).toContain('onClick={switchToEvaluationListView}');
    expect(evaluationsSource).toContain('onClick={switchToEvaluationSlideView}');
  });

  test('banner admin uses one responsive two-pane editor with keyboard upload access', () => {
    const bannerSource = source('app/admin/banners/page.tsx');

    expect(bannerSource).toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(bannerSource).toContain('role="list" aria-label="배너 목록"');
    expect(bannerSource).toContain('aria-current={isSelected ? "true" : undefined}');
    expect(bannerSource).toContain('데스크톱 배너');
    expect(bannerSource).toContain('모바일 팝업');
    expect(bannerSource).not.toContain('>사이드바</Badge>');
    expect(bannerSource).toContain('선택하면 오른쪽에서 바로 수정합니다.');
    expect(bannerSource).toContain('모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.');
    expect(bannerSource).toContain('삭제는 모달 없이 이 패널에서 처리합니다.');
    expect(bannerSource).toContain('role="button"');
    expect(bannerSource).toContain('tabIndex={0}');
    expect(bannerSource).toContain('aria-label="배너 이미지 또는 영상 업로드"');
    expect(bannerSource).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(bannerSource).toContain('isNestedUploadInteractiveTarget(event.target)');
    expect(bannerSource).toContain('focus-visible:ring-2 focus-visible:ring-primary');
    expect(bannerSource).toContain('id="banner-media-upload"');
  });


  test('legacy admin review panel deletion also avoids native confirm drift', () => {
    const reviewPanelSource = source('components/admin/AdminReviewPanel.tsx');

    expect(reviewPanelSource).toContain("const ADMIN_REVIEW_DELETE_CONFIRMATION = '리뷰삭제'");
    expect(reviewPanelSource).toContain('role="region"');
    expect(reviewPanelSource).toContain('aria-label="관리자 리뷰 삭제 확인"');
    expect(reviewPanelSource).toContain('aria-label="관리자 리뷰 삭제 확인 문구"');
    expect(reviewPanelSource).toContain('모바일과 데스크톱 모두 같은 인라인 확인 흐름으로 처리합니다.');
    expect(reviewPanelSource).not.toContain("confirm('정말로 이 리뷰를 삭제하시겠습니까?')");
  });

  test('my review deletion uses the same inline typed confirmation on mobile and desktop', () => {
    const reviewsSource = source('app/mypage/reviews/page.tsx');

    expect(reviewsSource).toContain('const REVIEW_DELETE_CONFIRMATION = "리뷰삭제"');
    expect(reviewsSource).toContain('deleteReviewConfirmation !== REVIEW_DELETE_CONFIRMATION');
    expect(reviewsSource).toContain('role="region" aria-label="리뷰 삭제 확인"');
    expect(reviewsSource).toContain('aria-label="리뷰 삭제 확인 문구"');
    expect(reviewsSource).toContain('.eq("user_id", user.id)');
    expect(reviewsSource).not.toContain('confirm("정말로 이 리뷰를 삭제하시겠습니까?")');
  });

  test('home navigation parity keeps desktop header routes and mobile overlay routes aligned intentionally', () => {
    const headerSource = source('components/layout/Header.tsx');
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');
    const mobileBottomNavSource = source('components/layout/MobileBottomNav.tsx');
    const navigationRoutesSource = source('components/layout/navigation-routes.ts');

    expect(headerSource).toContain("router.push('/admin')");
    expect(headerSource).not.toContain("router.push('/admin?module=announcements')");
    expect(mobileOverlaySource).toContain("router.push('/admin')");
    expect(headerSource).toContain('관리자 콘솔');
    expect(mobileOverlaySource).toContain('관리자 콘솔');
    expect(headerSource).toContain('인사이트');
    expect(mobileOverlaySource).toContain('인사이트');
    expect(mobileOverlaySource).not.toContain('openAdminAnnouncements');
    expect(mobileOverlaySource).not.toContain('공지사항');
    expect(mobileOverlaySource).not.toContain('Megaphone');
    expect(navigationRoutesSource).toContain("'/admin'");
    expect(navigationRoutesSource).toContain("'/admin/evaluations'");
    expect(navigationRoutesSource).toContain("'/admin/banners'");
    expect(mobileBottomNavSource).toContain("path: '/'");
    expect(mobileBottomNavSource).toContain("path: '/stamp'");
  });

  test('home map controls keep mobile touch targets and desktop map landmarks accessible', () => {
    const mobileOverlaySource = source('components/home/MobileControlOverlay.tsx');
    const homeControlPanelSource = source('components/home/home-control-panel.tsx');
    const homeDesktopControlPanelSource = source('components/home/home-desktop-control-panel.tsx');
    const floatingNavSource = source('components/layout/FloatingNavButtons.tsx');
    const overlayLayoutSource = source('components/layout/OverlayLayout.tsx');
    const detailPanelSource = source('components/restaurant/RestaurantDetailPanel.tsx');

    expect(mobileOverlaySource).toContain('min-h-11');
    expect(mobileOverlaySource).toContain('aria-pressed={isSelected}');
    expect(mobileOverlaySource).toContain('pointer-events-auto h-9 shrink-0 rounded-full');
    expect(mobileOverlaySource).toContain('text-xs font-medium');
    expect(mobileOverlaySource).toContain('rounded-full h-9 px-2 text-xs font-medium');
    expect(mobileOverlaySource).toContain('w-[clamp(84px,28vw,105px)] h-9 px-2');
    expect(mobileOverlaySource).toContain('aria-label="카테고리 더보기"');
    expect(mobileOverlaySource).toContain('aria-expanded={activeSheet ===');
    expect(mobileOverlaySource).toContain('role="dialog"');
    expect(mobileOverlaySource).toContain('handleSearchLayerKeyDown');
    expect(mobileOverlaySource).toContain('getFocusTrapContainers(searchLayerRef.current');
    expect(mobileOverlaySource).toContain('searchPreviouslyFocusedElementRef.current?.focus');
    expect(mobileOverlaySource).toContain('inertSibling.inert = true');
    expect(homeControlPanelSource).not.toContain('function DesktopControlPanelLoadingShell()');
    expect(homeDesktopControlPanelSource).toContain('max-w-[calc(100vw-12rem)]');
    expect(floatingNavSource).toContain('<nav');
    expect(floatingNavSource).toContain('aria-label="지도 화면 보조 탐색"');
    expect(floatingNavSource).toContain('aria-pressed={mapMode ===');
    expect(overlayLayoutSource).toContain('지도 본문으로 건너뛰기');
    expect(overlayLayoutSource).toContain('aria-label="쯔동여지도 지도 본문"');
    expect(detailPanelSource).toContain('lg:[scrollbar-width:thin]');
    expect(detailPanelSource).toContain('aria-label={isShareCopied ?');
  });
});
