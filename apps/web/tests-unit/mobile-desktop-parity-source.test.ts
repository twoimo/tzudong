import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("mobile and desktop parity source contracts", () => {
  test("responsive overflow smoke includes the unified admin console route", () => {
    const responsiveSpecSource = source("tests/responsive-overflow.spec.ts");
    const responsiveScriptSource = source("scripts/run-responsive-tests.mjs");

    expect(responsiveSpecSource).toContain("'/admin'");
    expect(responsiveSpecSource).toContain("'/admin/evaluations'");
    expect(responsiveSpecSource).toContain("'/admin/banners'");
    expect(responsiveScriptSource).toContain(
      "admin route responsive cases will be skipped",
    );
  });

  test("admin console exposes both mobile-width and desktop-width navigation affordances", () => {
    const adminPageSource = source("app/admin/page.tsx");
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(adminPageSource).toContain("<AdminConsoleOverview />");
    expect(consoleSource).toContain('aria-label="관리자 콘솔 사이드바"');
    expect(consoleSource).toContain('aria-label="관리자 통합 메뉴"');
    expect(consoleSource).toContain('data-admin-console-shell="true"');
    expect(consoleSource).not.toContain(
      '<ReturnToMapButton iconOnly className="h-8 w-8" />',
    );
    expect(consoleSource).toContain('aria-label="쯔동여지도 홈으로 이동"');
    expect(consoleSource).toContain(
      'data-admin-console-layout="sidebar-content"',
    );
    expect(consoleSource).toContain('data-admin-console-content="true"');
    expect(consoleSource).toContain(
      'data-admin-console-content-loading="true"',
    );
    expect(consoleSource).toContain("shouldRenderAdminShell");
    expect(consoleSource).toContain("관리자 콘솔");
    expect(consoleSource).toContain("현재 화면 · {activeSidebarLabel}");
    expect(consoleSource).not.toContain("관리자 메뉴");
    expect(consoleSource).not.toContain("Unified admin console");
    expect(consoleSource).toContain("relative z-30 flex max-h-[42dvh]");
    expect(consoleSource).toContain(
      "flex gap-2 overflow-x-auto overscroll-x-contain",
    );
    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: 16rem minmax(0, 1fr);",
    );
    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: 4.5rem minmax(0, 1fr);",
    );
    expect(consoleSource).toContain("md:block md:min-h-0 md:flex-1");
    expect(consoleSource).toContain("md:w-full");
    expect(consoleSource).toContain("md:items-center md:px-1.5");
    expect(consoleSource).toContain("p-2 sm:p-3 md:border-y-0 md:p-4");
    expect(consoleSource).toContain("min-h-11 min-w-[8.25rem]");
    expect(consoleSource).toContain(
      'data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}',
    );
    expect(consoleSource).toContain("setIsSidebarCollapsed(false);");
    expect(consoleSource).toContain("관리자 사이드바 펼치기");
    expect(consoleSource).toContain("관리자 사이드바 접기");
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain("AdminEvaluationModule");
    expect(consoleSource).toContain('initialView="submissions"');
    expect(consoleSource).toContain('initialSubmissionTab="reviews"');
    expect(consoleSource).toContain("AdminBannerModule");
    expect(consoleSource).not.toContain("AdminAnnouncementModule");
    expect(consoleSource).not.toContain('id: "announcements"');
    expect(consoleSource).not.toContain("/admin?module=announcements");
    expect(consoleSource).toContain("useSearchParams");
    expect(consoleSource).toContain("router.replace");
    expect(consoleSource).toContain(
      "useAdminOverviewStats(canLoadAdminConsoleData)",
    );
    expect(consoleSource).not.toContain('router.replace("/")');
    expect(consoleSource).toContain("getAdminModuleIdFromSearchParams");
    expect(consoleSource).not.toContain("window.history.replaceState");
  });

  test("admin evaluations keep equivalent mobile-card and desktop-table controls", () => {
    const tableSource = source("components/admin/EvaluationTableNew.tsx");

    expect(tableSource).toContain("const mobileControls = (");
    expect(tableSource).toContain("const mobileCards = (");
    expect(tableSource).toContain(
      "grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden",
    );
    expect(tableSource).toContain("hidden rounded-lg border lg:block");
    expect(tableSource).toContain('aria-label="영상 제목 검색"');
    expect(tableSource).toContain('aria-label="검색어 지우기"');
    expect(tableSource).toContain("필터 초기화");
    expect(tableSource).toContain("상세 필터");
    expect(tableSource).toContain("전체 검수 정보");
    expect(tableSource).toContain("getAddressConsistencyDisplayLabel");
    expect(tableSource).not.toContain("border-sky-200 bg-sky-50");
    expect(tableSource).toContain("검수 항목 삭제");
    expect(tableSource.match(/되돌리기/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2,
    );
    expect(tableSource.match(/수정/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(tableSource.match(/승인/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(tableSource).toContain("누락 사유:");
    expect(tableSource).toContain("판정 근거");
    expect(tableSource).toContain("쯔양 리뷰 요약");
    expect(tableSource).toContain("{ value: 'true', label: '확인됨' }");
    expect(tableSource).toContain("{ value: 'false_geocode', label: '실패' }");
    expect(tableSource).toContain("{ value: 'missing', label: '누락' }");
    expect(tableSource).not.toContain("Missing 사유:");
    expect(tableSource).not.toContain("Reasoning Basis");
    expect(tableSource).not.toContain("Tzuyang Review");
  });

  test("admin evaluation destructive actions use inline typed confirmation across breakpoints", () => {
    const evaluationsSource = source("app/admin/evaluations/page.tsx");

    expect(evaluationsSource).toContain(
      "const EVALUATION_DELETE_CONFIRMATION = '검수삭제'",
    );
    expect(evaluationsSource).toContain(
      "const EVALUATION_RESTORE_CONFIRMATION = '검수복원'",
    );
    expect(evaluationsSource).toContain('role="region"');
    expect(evaluationsSource).toContain('aria-label="검수 항목 작업 확인"');
    expect(evaluationsSource).toContain(
      'aria-label="검수 항목 작업 확인 문구"',
    );
    expect(evaluationsSource).toContain(
      "모바일과 데스크톱 모두 같은 흐름으로 처리합니다.",
    );
    expect(evaluationsSource).not.toContain("정말 삭제하시겠습니까?");
    expect(evaluationsSource).not.toContain("복원하시겠습니까?");
  });

  test("embedded submission and review modules cannot switch into restaurant evaluation view", () => {
    const evaluationsSource = source("app/admin/evaluations/page.tsx");

    expect(evaluationsSource).toContain(
      "const canSwitchEvaluationView = !embedded || initialView === 'evaluations';",
    );
    expect(evaluationsSource).toContain("{canSwitchEvaluationView && (");
    expect(evaluationsSource).toContain("onClick={switchToEvaluationListView}");
    expect(evaluationsSource).toContain(
      "onClick={switchToEvaluationSlideView}",
    );
  });

  test("banner admin uses one responsive two-pane editor with keyboard upload access", () => {
    const bannerSource = source("app/admin/banners/page.tsx");

    expect(bannerSource).toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(bannerSource).toContain('role="list" aria-label="배너 목록"');
    expect(bannerSource).toContain(
      'aria-current={isSelected ? "true" : undefined}',
    );
    expect(bannerSource).toContain("데스크톱 배너");
    expect(bannerSource).toContain("모바일 팝업");
    expect(bannerSource).not.toContain(">사이드바</Badge>");
    expect(bannerSource).toContain("선택하면 오른쪽에서 바로 수정합니다.");
    expect(bannerSource).toContain(
      "모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.",
    );
    expect(bannerSource).toContain("삭제는 모달 없이 이 패널에서 처리합니다.");
    expect(bannerSource).toContain('role="button"');
    expect(bannerSource).toContain("tabIndex={0}");
    expect(bannerSource).toContain('aria-label="배너 이미지 또는 영상 업로드"');
    expect(bannerSource).toContain(
      "event.key !== 'Enter' && event.key !== ' '",
    );
    expect(bannerSource).toContain(
      "isNestedUploadInteractiveTarget(event.target)",
    );
    expect(bannerSource).toContain(
      "focus-visible:ring-2 focus-visible:ring-primary",
    );
    expect(bannerSource).toContain('id="banner-media-upload"');
  });

  test("legacy admin review panel deletion also avoids native confirm drift", () => {
    const reviewPanelSource = source("components/admin/AdminReviewPanel.tsx");

    expect(reviewPanelSource).toContain(
      "const ADMIN_REVIEW_DELETE_CONFIRMATION = '리뷰삭제'",
    );
    expect(reviewPanelSource).toContain('role="region"');
    expect(reviewPanelSource).toContain('aria-label="관리자 리뷰 삭제 확인"');
    expect(reviewPanelSource).toContain(
      'aria-label="관리자 리뷰 삭제 확인 문구"',
    );
    expect(reviewPanelSource).toContain(
      "모바일과 데스크톱 모두 같은 인라인 확인 흐름으로 처리합니다.",
    );
    expect(reviewPanelSource).not.toContain(
      "confirm('정말로 이 리뷰를 삭제하시겠습니까?')",
    );
  });

  test("my review deletion uses the same inline typed confirmation on mobile and desktop", () => {
    const reviewsSource = source("app/mypage/reviews/page.tsx");

    expect(reviewsSource).toContain(
      'const REVIEW_DELETE_CONFIRMATION = "리뷰삭제"',
    );
    expect(reviewsSource).toContain(
      "deleteReviewConfirmation !== REVIEW_DELETE_CONFIRMATION",
    );
    expect(reviewsSource).toContain('role="region"');
    expect(reviewsSource).toContain('aria-label="리뷰 삭제 확인"');
    expect(reviewsSource).toContain('aria-label="리뷰 삭제 확인 문구"');
    expect(reviewsSource).toContain('.eq("user_id", user.id)');
    expect(reviewsSource).not.toContain(
      'confirm("정말로 이 리뷰를 삭제하시겠습니까?")',
    );
  });

  test("home navigation parity keeps desktop header routes and mobile overlay routes aligned intentionally", () => {
    const headerSource = source("components/layout/Header.tsx");
    const mobileOverlaySource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const mobileBottomNavSource = source(
      "components/layout/MobileBottomNav.tsx",
    );
    const navigationRoutesSource = source(
      "components/layout/navigation-routes.ts",
    );

    expect(headerSource).toContain("router.push('/admin')");
    expect(headerSource).not.toContain(
      "router.push('/admin?module=announcements')",
    );
    expect(mobileOverlaySource).toContain("router.push('/admin')");
    expect(headerSource).toContain("관리자 콘솔");
    expect(mobileOverlaySource).toContain("관리자 콘솔");
    expect(headerSource).toContain("인사이트");
    expect(mobileOverlaySource).toContain("인사이트");
    expect(mobileOverlaySource).not.toContain("openAdminAnnouncements");
    expect(mobileOverlaySource).not.toContain("공지사항");
    expect(mobileOverlaySource).not.toContain("Megaphone");
    expect(navigationRoutesSource).toContain("'/admin'");
    expect(navigationRoutesSource).toContain("'/admin/evaluations'");
    expect(navigationRoutesSource).toContain("'/admin/banners'");
    expect(mobileBottomNavSource).toContain("path: '/'");
    expect(mobileBottomNavSource).toContain("path: '/stamp'");
    expect(mobileBottomNavSource).toContain("'font-serif'");
    expect(mobileBottomNavSource).toContain(
      "'text-[12px] font-medium leading-none tracking-tight'",
    );
    expect(mobileBottomNavSource).toContain(
      "'text-foreground/65 active:text-foreground'",
    );
  });

  test("home map controls keep mobile touch targets and desktop map landmarks accessible", () => {
    const mobileOverlaySource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const homeControlPanelSource = source(
      "components/home/home-control-panel.tsx",
    );
    const homeDesktopControlPanelSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const floatingNavSource = source(
      "components/layout/FloatingNavButtons.tsx",
    );
    const stampOverlaySource = source(
      "components/overlay-pages/StampOverlay.tsx",
    );
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const detailPanelSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const myPageLayoutContentSource = source(
      "app/mypage/mypage-layout-content.tsx",
    );

    expect(mobileOverlaySource).toContain("min-h-11");
    expect(mobileOverlaySource).toContain('aria-label="맛집 검색 열기"');
    expect(mobileOverlaySource).toContain("aria-pressed={isSelected}");
    expect(mobileOverlaySource).toContain(
      "pointer-events-auto h-9 shrink-0 rounded-full",
    );
    expect(mobileOverlaySource).toContain("text-xs font-medium");
    expect(mobileOverlaySource).toContain(
      "rounded-full h-9 px-2 text-xs font-medium",
    );
    expect(mobileOverlaySource).toContain(
      "w-[clamp(84px,28vw,105px)] h-9 px-2",
    );
    expect(mobileOverlaySource).toContain('aria-label="카테고리 더보기"');
    expect(mobileOverlaySource).toContain("aria-expanded={activeSheet ===");
    expect(mobileOverlaySource).toContain('role="dialog"');
    expect(mobileOverlaySource).toContain(
      '<span className="font-medium">대한민국</span>',
    );
    expect(mobileOverlaySource).not.toContain(
      '<span className="font-medium">전국</span>',
    );
    expect(mobileOverlaySource).toContain("handleSearchLayerKeyDown");
    expect(mobileOverlaySource).toContain(
      "getFocusTrapContainers(searchLayerRef.current",
    );
    expect(mobileOverlaySource).toContain(
      "searchPreviouslyFocusedElementRef.current?.focus",
    );
    expect(mobileOverlaySource).toContain("inertSibling.inert = true");
    expect(homeControlPanelSource).not.toContain(
      "function DesktopControlPanelLoadingShell()",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-map-panel="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "desktop-left-panel-scrollbarless",
    );
    expect(homeAppGlobalsSource).toContain(
      ".desktop-left-panel-scrollbarless :where(",
    );
    expect(homeAppGlobalsSource).toContain('[class*="overflow-y-auto"]');
    expect(homeAppGlobalsSource).toContain(")::-webkit-scrollbar");
    expect(homeAppGlobalsSource).toContain(
      "-ms-overflow-style: none !important",
    );
    expect(homeAppGlobalsSource).toContain("scrollbar-width: none !important");
    expect(homeAppGlobalsSource).toContain("display: none !important");
    expect(homeAppGlobalsSource).toContain("width: 0 !important");
    expect(homeAppGlobalsSource).toContain("height: 0 !important");
    expect(homeDesktopControlPanelSource).toContain(
      "overflow-x-hidden overscroll-contain",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'import Image from "next/image"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-bar="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-results="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-home="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "rounded-full border border-border bg-background/95",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pointer-events-auto flex h-12 items-center gap-2 rounded-full border border-border bg-background/95 px-2 shadow-lg backdrop-blur-sm",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex h-9 min-w-0 flex-1 items-center justify-start gap-2 rounded-full px-2.5 hover:bg-secondary/80",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-9 w-9 shrink-0 rounded-full border border-border bg-background p-0 hover:bg-secondary/80",
    );
    expect(
      homeDesktopControlPanelSource.indexOf('aria-label="검색어 지우기"'),
    ).toBeLessThan(
      homeDesktopControlPanelSource.indexOf("toggleDesktopSearchType();"),
    );
    expect(homeDesktopControlPanelSource).toContain(
      "focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2",
    );
    expect(homeDesktopControlPanelSource).toContain("width={26}");
    expect(homeDesktopControlPanelSource).toContain("height={26}");
    expect(homeDesktopControlPanelSource).toContain(
      "text-[15px] text-foreground outline-none placeholder:text-muted-foreground",
    );
    expect(homeDesktopControlPanelSource).not.toContain("bg-secondary/40 px-2");
    expect(homeDesktopControlPanelSource).toContain("hideSearchControls");
    expect(homeDesktopControlPanelSource).toContain(
      'className="h-full min-h-0 px-0 py-0"',
    );
    expect(homeDesktopControlPanelSource).toContain("maxItems={12}");
    expect(homeDesktopControlPanelSource).toContain("popularMaxItems={10}");
    expect(homeDesktopControlPanelSource).toContain("captureDetailReturnView");
    expect(homeDesktopControlPanelSource).toContain("handleDetailPanelClose");
    expect(homeDesktopControlPanelSource).toContain("DesktopDetailReturnState");
    expect(homeDesktopControlPanelSource).toContain("detailReturnStateRef");
    expect(homeDesktopControlPanelSource).toContain(
      "pendingDetailReturnCaptureRef",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pendingDetailOpen?: boolean",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "!pendingDetailReturnCaptureRef.current",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "captureDetailReturnView(activeLeftPanelViewRef.current, {",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "if (pendingDetailReturnCaptureRef.current) return;",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'captureDetailReturnView("map", { pendingDetailOpen: true })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setDesktopSearchQuery(returnState.searchQuery)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setDesktopSearchType(returnState.searchType)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setIsDesktopSearchActive(returnState.isSearchActive)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "handleExternalDetailReturnCapture",
    );
    expect(source("app/home-client.tsx")).toContain(
      "requestDesktopDetailReturnCapture();",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const returnRoute = getDesktopLeftPanelRoute(",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "router.replace(returnRoute, { scroll: false })",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "replaceBrowserHistoryRoute(returnRoute)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'replaceBrowserHistoryRoute("/")',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClose={handleDetailPanelClose}",
    );
    expect(homeDesktopControlPanelSource).toContain("edgeToEdgeInlineLayout");
    expect(homeDesktopControlPanelSource).toContain(
      "searchQueryValue={desktopSearchQuery}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-floating-filters="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "if (!isDesktopLeftPanelRouteView(panelParam)) {",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'setActiveLeftPanelView("map");',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "grid auto-rows-auto grid-cols-[max-content] items-start gap-2",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex w-full min-w-max items-center gap-0.5 rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain("!w-full !min-w-max");
    expect(homeDesktopControlPanelSource).not.toContain(
      "w-[clamp(84px,8vw,105px)] items-center gap-0.5",
    );
    expect(homeDesktopControlPanelSource).toContain("국내 맛집 지도 보기");
    expect(homeDesktopControlPanelSource).toContain("해외 맛집 지도 보기");
    expect(homeDesktopControlPanelSource).toContain("쯔동여지도 검색하기");
    expect(homeDesktopControlPanelSource).toContain("hideHistoryAndPopular");
    expect(homeDesktopControlPanelSource).not.toContain(
      "검색·필터·상세를 왼쪽에서 빠르게 확인하세요.",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "fixed inset-y-0 z-[90] flex",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'desktopPanelSide === "right" ? "right-0 border-l" : "left-0 border-r"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "data-desktop-panel-side={desktopPanelSide}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "motion-reduce:transition-none",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopPanelSide === value}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopMapLayout === value}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-pressed={preferences.desktopPanelDefault === value}",
    );

    expect(homeDesktopControlPanelSource).toContain(
      'data-panel-collapsed={isPanelCollapsed ? "true" : "false"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'desktopPanelSide === "right"',
    );
    expect(homeDesktopControlPanelSource).toContain('"translate-x-full"');
    expect(homeDesktopControlPanelSource).toContain('"-translate-x-full"');
    expect(homeDesktopControlPanelSource).toContain(
      "const panelToggleLabel = isPanelCollapsed",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'const panelSideLabel = desktopPanelSide === "right" ? "우측" : "좌측"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "`${panelSideLabel} 패널 펼치기`",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "`${panelSideLabel} 패널 접기`",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'aria-controls="desktop-left-map-panel"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-expanded={!isPanelCollapsed}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "aria-hidden={isPanelCollapsed}",
    );
    expect(homeDesktopControlPanelSource).toContain("inert={isPanelCollapsed}");
    expect(homeDesktopControlPanelSource).toContain('event.key !== "Escape"');
    expect(homeDesktopControlPanelSource).toContain("flex h-12 w-6");
    expect(homeDesktopControlPanelSource).toContain("rounded-r-lg");
    expect(homeDesktopControlPanelSource).toContain("<ChevronLeft");
    expect(homeDesktopControlPanelSource).toContain("<ChevronRight");
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-announcement="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-admin-reviews="true"',
    );
    expect(homeDesktopControlPanelSource).toContain("loadAnnouncementPanel");
    expect(homeDesktopControlPanelSource).toContain("loadAdminReviewPanel");
    expect(homeDesktopControlPanelSource).toContain(
      "HydratedDetailRestaurant restaurant={panelRestaurant}",
    );
    expect(homeDesktopControlPanelSource).toContain("<RestaurantDetailPanel");
    expect(homeDesktopControlPanelSource).toContain("showDesktopBackButton");
    expect(source("components/restaurant/RestaurantDetailPanel.tsx")).toContain(
      "showDesktopBackButton?: boolean",
    );
    const restaurantDetailPanelSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    expect(restaurantDetailPanelSource).toContain(
      'aria-label="상세 패널 닫기"',
    );
    expect(restaurantDetailPanelSource).toContain(
      "{isAdmin && onEditRestaurant && viewMode === 'detail' && (",
    );
    expect(restaurantDetailPanelSource).toContain(
      "{showDesktopBackButton && !isMobile && viewMode === 'detail' && (",
    );
    expect(
      restaurantDetailPanelSource.indexOf(
        '<Settings className="h-4 w-4" aria-hidden="true" />',
      ),
    ).toBeLessThan(
      restaurantDetailPanelSource.indexOf('aria-label="상세 패널 닫기"'),
    );
    expect(restaurantDetailPanelSource).not.toContain(
      'className="mr-1 h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80"',
    );
    expect(restaurantDetailPanelSource).toContain(
      'className="border-red-800 text-red-800 hover:border-red-900 hover:bg-red-50 hover:text-red-900 dark:border-red-500 dark:text-red-400 dark:hover:border-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"',
    );
    expect(restaurantDetailPanelSource).toContain(
      '<X className="h-4 w-4" aria-hidden="true" />',
    );
    expect(homeDesktopControlPanelSource).toContain('resultView="inline"');
    expect(homeDesktopControlPanelSource).toContain("hideSearchControls");
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-floating-nav="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'className="fixed top-4 z-[70] flex flex-col items-start gap-2"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "DESKTOP_FLOATING_NAV_ROW_STARTS",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-floating-nav-row={rowStart === 0 ? "account" : "content"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "DESKTOP_FLOATING_NAV_BUTTON_WIDTH",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '"--desktop-floating-nav-button-width": DESKTOP_FLOATING_NAV_BUTTON_WIDTH',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pointer-events-auto h-9 w-[var(--desktop-floating-nav-button-width)] shrink-0 justify-center rounded-full",
    );
    expect(
      homeDesktopControlPanelSource.indexOf(
        '{ id: "profile", label: "프로필", icon: UserRound }',
      ),
    ).toBeLessThan(
      homeDesktopControlPanelSource.indexOf(
        '{ id: "feed", label: "리뷰", icon: MessageSquare }',
      ),
    );
    const myPageProfileSource = source("app/mypage/profile/page.tsx");
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-return-slot="true"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'className="mb-2 hidden items-center justify-between gap-3 md:flex"',
    );
    expect(myPageLayoutContentSource).not.toContain(
      'data-mypage-return-skeleton="true"',
    );
    expect(
      myPageLayoutContentSource.match(/<ReturnToMapButton/g)?.length ?? 0,
    ).toBe(0);
    expect(myPageLayoutContentSource).not.toContain(
      '<ReturnToMapButton className="w-fit md:h-9 md:min-h-9 md:px-2.5" />',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-hero="mobile-only"',
    );
    expect(myPageProfileSource).toContain(
      'className="overflow-hidden shadow-none md:hidden"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-hero-layout="standard"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-identity="standard"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-profile-side-layout="matrix"',
    );
    expect(myPageProfileSource).toContain(
      "grid min-w-0 gap-3 sm:gap-5 md:contents",
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-danger-zone-layout="matrix-bottom-right"',
    );
    expect(myPageProfileSource).toContain(
      'className="min-w-0 border-border/70 md:order-4 md:col-start-2 md:row-start-2 md:flex md:h-full md:min-h-0 md:flex-col md:overflow-hidden md:rounded-3xl md:bg-background/85 md:shadow-sm md:backdrop-blur-sm"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-mobile-secondary-actions="true"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-session-card="true"',
    );
    expect(myPageProfileSource).not.toContain(
      'data-mypage-profile-photo-controls="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-avatar-controls="true"',
    );
    expect(myPageProfileSource).toContain(
      'htmlFor="mypage-mobile-avatar-upload"',
    );
    expect(myPageProfileSource).toContain('id="mypage-mobile-avatar-upload"');
    expect(myPageProfileSource).toContain(
      'className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2',
    );
    expect(myPageProfileSource).toContain('sizes="96px"');
    expect(myPageProfileSource).toContain("handleMobileAvatarUpload");
    expect(myPageProfileSource).toContain("handleMobileAvatarDelete");
    expect(
      myPageProfileSource.match(/data-mypage-session-card="true"/g)?.length ??
        0,
    ).toBe(0);
    expect(myPageProfileSource).toContain("const activityActions = [");
    expect(myPageProfileSource).toContain("const reportActions = [");
    expect(myPageProfileSource).toContain("const quickActionSections = [");
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-quick-actions="grouped"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-tier-dashboard="true"',
    );
    expect(myPageProfileSource).toContain(
      "data-mypage-desktop-tier-progress",
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-tier-metrics="true"',
    );
    expect(myPageProfileSource).toContain('data-mypage-desktop-recent-activity="true"');
    expect(myPageProfileSource).toContain('data-mypage-desktop-recent-activity-row="true"');
    expect(myPageProfileSource).toContain("최근 활동");
    expect(myPageProfileSource).not.toContain("바로 할 수 있는 일");
    expect(myPageProfileSource).not.toContain(
      "grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2",
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-mobile-action-row="true"',
    );
    expect(myPageProfileSource).toContain(
      "data-mypage-action-group={section.id}",
    );
    expect(myPageProfileSource).toContain("나의 북마크 내역");
    expect(myPageProfileSource).toContain("나의 리뷰 내역");
    expect(myPageProfileSource).toContain("신규 맛집 제보");
    expect(myPageProfileSource).toContain("수정 요청");
    expect(myPageProfileSource).toContain("쯔양 제보");
    expect(myPageProfileSource).toContain(
      "data-mypage-mobile-action-grid={section.id}",
    );
    expect(homeDesktopControlPanelSource).not.toContain("지도 필터");
    expect(homeDesktopControlPanelSource).toContain(
      "const hasActiveDetail = isPanelOpen && Boolean(panelRestaurant)",
    );
    expect(homeDesktopControlPanelSource).toContain("{!hasActiveDetail && (");
    expect(homeDesktopControlPanelSource).not.toContain(
      "!hasActiveDetail && !isDetailPanelTransitionPending",
    );
    expect(homeDesktopControlPanelSource).toContain("hasActiveDetail ||");
    expect(homeDesktopControlPanelSource).not.toContain(
      "isDetailPanelTransitionPending ||",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "isInlinePanelViewActive ||",
    );
    expect(homeDesktopControlPanelSource).toContain("shouldShowDesktopMapHome");
    expect(homeDesktopControlPanelSource).toContain(
      'activeLeftPanelView === "map" &&\n    !isPanelOpen &&\n    (isDesktopSearchActive',
    );
    expect(homeDesktopControlPanelSource).toContain(' ? "px-0 py-0"');
    expect(homeDesktopControlPanelSource).toContain(' : "px-4 py-4"');
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-detail-fill="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-search-shell="true"',
    );
    expect(stampOverlaySource).toContain(
      'data-desktop-left-panel-stamp-mobile-parity="true"',
    );
    expect(stampOverlaySource).toContain(
      "h-full overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']",
    );
    expect(stampOverlaySource).toContain(
      "shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4",
    );
    expect(stampOverlaySource).toContain(
      "flex flex-wrap items-start justify-between gap-3",
    );
    expect(stampOverlaySource).toContain('stampSize="mobile"');
    expect(stampOverlaySource).toContain('size="default"');
    expect(stampOverlaySource).toContain("singleColumnCards?: boolean");
    expect(stampOverlaySource).toContain("singleColumnCards = false");
    expect(stampOverlaySource).toContain(
      'data-stamp-card-grid-single-column={singleColumnCards ? "true" : "false"}',
    );
    expect(stampOverlaySource).toContain(
      "const skeletonCardCount = singleColumnCards ? 8 : 16",
    );
    expect(stampOverlaySource).toContain("count={skeletonCardCount}");
    expect(stampOverlaySource).toContain(
      "const skeletonGridColumns = singleColumnCards",
    );
    expect(stampOverlaySource).toContain(
      "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 md:gap-4",
    );
    expect(stampOverlaySource).toContain("columns={skeletonGridColumns}");
    expect(stampOverlaySource).toContain('? "grid grid-cols-1 gap-3 md:gap-3"');
    expect(stampOverlaySource).toContain(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-4",
    );
    expect(homeDesktopControlPanelSource).toContain("singleColumnCards");
    expect(homeDesktopControlPanelSource).toContain(
      'className="rounded-none border-0 shadow-none"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-full min-h-0 overflow-hidden",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "h-[calc(100vh-260px)] min-h-[560px]",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "rounded-xl border border-border bg-background shadow-sm",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "router.push(`/?panel=${panel}`",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'source: "desktop-left-panel"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'router.push("/?panel=bookmarks", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      '{ id: "notifications", label: "알림", icon: Bell }',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'router.push("/?panel=notifications", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-view="settings"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "지도와 사이드 패널 맞춤 설정",
    );
    expect(homeDesktopControlPanelSource).toContain("사이드 패널 위치");
    expect(homeDesktopControlPanelSource).toContain("open-notifications");
    expect(homeDesktopControlPanelSource).not.toContain(
      'router.push("/admin")',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "마커를 누르면 쯔양 영상과 리뷰가 여기서 바로 열립니다.",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "오른쪽 지도에서 맛집 마커를 클릭하면 상세 패널이 왼쪽에",
    );
    expect(source("app/home-client.tsx")).toContain(
      "renderDesktopDetailPanel={!isDesktop}",
    );
    expect(source("app/home-client.tsx")).toContain(
      "isPanelCollapsed={isPanelCollapsed}",
    );
    expect(source("app/home-client.tsx")).toContain(
      "onTogglePanelCollapse={togglePanelCollapse}",
    );
    expect(source("app/home-client.tsx")).toContain(
      "onDeviceLocationClick={handleDeviceLocationClick}",
    );
    expect(source("app/home-client.tsx")).toContain(
      'const DEVICE_LOCATION_ENABLE_TOAST = "위치 기능을 켜주세요";',
    );
    expect(source("app/home-client.tsx")).toContain(
      "toast.error(DEVICE_LOCATION_ENABLE_TOAST);",
    );
    expect(source("app/home-client.tsx")).not.toContain(
      "현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해주세요",
    );
    expect(source("app/home-client.tsx")).not.toContain(
      "위치 권한이 차단되어 있어요. 브라우저 설정에서 위치 권한을 허용해주세요",
    );
    expect(source("components/home/SubmissionFloatingButton.tsx")).toContain(
      'aria-label="지도 빠른 작업"',
    );
    expect(source("components/home/SubmissionFloatingButton.tsx")).toContain(
      "aria-label={deviceLocationButtonLabel}",
    );
    expect(source("components/home/SubmissionFloatingButton.tsx")).toContain(
      "desktopPanelSide?: HomeMapPanelSide",
    );
    expect(source("components/home/SubmissionFloatingButton.tsx")).toContain(
      "shouldOffsetForRightPanel",
    );
    expect(source("components/home/SubmissionFloatingButton.tsx")).toContain(
      "DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS",
    );
    expect(source("app/home-client.tsx")).toContain(
      "desktopPanelSide={desktopPanelSide}",
    );
    expect(source("app/home-client-sidepanels.tsx")).toContain(
      "presentation={isMobileOrTablet ? 'auto' : 'map-panel'}",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "presentation?: 'auto' | 'map-panel'",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      'data-desktop-map-submission-panel="true"',
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "shouldRenderMapPanel",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "data-desktop-map-submission-drag-handle",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "handleDesktopSubmissionPanelPointerDown",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "setPointerCapture",
    );
    expect(source("components/modals/RestaurantSubmissionModal.tsx")).toContain(
      "translate3d(${desktopSubmissionPanelPosition.x}px, ${desktopSubmissionPanelPosition.y}px, 0)",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      "presentation?: 'auto' | 'map-panel'",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      'data-desktop-map-edit-panel="true"',
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      'aria-modal="true"',
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      "handleDesktopEditDialogKeyDown",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      "mobileSheetStyles.frame",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      "data-desktop-map-edit-drag-handle",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      "tabIndex={shouldRenderMapPanel ? 0 : undefined}",
    );
    expect(source("components/modals/EditRestaurantModal.tsx")).toContain(
      'aria-label={shouldRenderMapPanel ? "맛집 수정 요청 창 이동 핸들" : undefined}',
    );
    const homeMapContainerSource = source(
      "components/home/home-map-container.tsx",
    );
    expect(homeMapContainerSource).toContain(
      "renderDesktopDetailPanel && isPanelOpen",
    );
    expect(homeMapContainerSource).toContain(
      "desktopMapLayout?: HomeMapLayoutMode",
    );
    expect(homeMapContainerSource).toContain(
      "desktopPanelSide?: HomeMapPanelSide",
    );
    expect(homeMapContainerSource).toContain(
      "desktopMapLayout === 'panel-aware'",
    );
    expect(homeMapContainerSource).toContain("motion-reduce:transition-none");
    expect(homeMapContainerSource).toContain(
      'data-home-map-reserved-left-panel={shouldReserveDesktopLeftPanel ? "true" : "false"}',
    );
    expect(homeMapContainerSource).toContain(
      'data-home-map-reserved-right-panel={shouldReserveDesktopRightPanel ? "true" : "false"}',
    );
    expect(homeMapContainerSource).toContain(
      "data-home-map-panel-side={desktopPanelSide}",
    );
    expect(homeMapContainerSource).toContain(
      "marginLeft: shouldReserveDesktopLeftPanel ? DESKTOP_LEFT_PANEL_WIDTH_CSS : undefined",
    );
    expect(homeMapContainerSource).toContain(
      "marginRight: shouldReserveDesktopRightPanel ? DESKTOP_LEFT_PANEL_WIDTH_CSS : undefined",
    );
    expect(homeMapContainerSource).toContain(
      "reservesDesktopLeftPanelSpace={shouldReserveDesktopSidePanel}",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "usesExternalPanel: Boolean(onMarkerClick) && !reservesDesktopLeftPanelSpace",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "reservesDesktopLeftPanelSpace,",
    );
    expect(floatingNavSource).toContain("<nav");
    expect(floatingNavSource).toContain('aria-label="지도 화면 보조 탐색"');
    expect(floatingNavSource).toContain("aria-pressed={mapMode ===");
    expect(overlayLayoutSource).toContain("지도 본문으로 건너뛰기");
    expect(overlayLayoutSource).toContain("const isHomeRoute = pathname ===");
    expect(overlayLayoutSource).toContain(
      "const shouldRenderRouteOverlayChrome =",
    );
    expect(overlayLayoutSource).toContain(
      "!isHomeRoute && routeDirectPanelParam !== null",
    );
    expect(overlayLayoutSource).toContain(
      "{shouldRenderRouteOverlayChrome && (",
    );
    expect(overlayLayoutSource).toContain("const mainContentLabel =");
    expect(overlayLayoutSource).toContain('"쯔동여지도 지도 본문"');
    expect(overlayLayoutSource).toContain("aria-label={mainContentLabel}");
    expect(detailPanelSource).toContain("lg:[scrollbar-width:thin]");
    expect(detailPanelSource).toContain("aria-label={isShareCopied ?");
  });
});
