import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("mobile and desktop parity source contracts", () => {
  test("responsive overflow smoke includes the unified admin console route", () => {
    const responsiveSpecSource = source("tests/responsive-overflow.spec.ts");
    const responsiveScriptSource = source("scripts/run-responsive-tests.mjs");
    const playwrightConfigSource = source("playwright.config.ts");

    expect(responsiveSpecSource).toContain("'/admin'");
    expect(responsiveSpecSource).toContain("'/admin?module=restaurants'");
    expect(responsiveSpecSource).toContain("'/admin/evaluations'");
    expect(playwrightConfigSource).toContain("'bun run dev:playwright'");
    expect(responsiveScriptSource).toContain("serverMode === 'dev' ? 'bun run dev:playwright' : 'bun run start:playwright'");
    expect(responsiveScriptSource).toContain("spawnSync('bun', ['run', 'build']");
    expect(responsiveScriptSource).toContain(
      "admin route responsive cases will be skipped",
    );
  });
  test("responsive runner emits only fixed failure codes and allowlisted library facts", () => {
    const runner = source("scripts/run-responsive-tests.mjs");

    expect(runner).toContain("import { logCliError } from './privacy-safe-cli-log.mjs';");
    expect(runner).toContain("const SAFE_LIBRARY_NAME_PATTERN = /^lib[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;");
    expect(runner).toContain("const MISSING_LIBRARY_LINE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._+-]{0,127})\\s+=>\\s+not found$/;");
    expect(runner).toContain("stdio: 'ignore'");
    expect(runner).toContain("RESPONSIVE_TEST_LIBRARY_INSPECTION_FAILED");
    expect(runner).toContain("logMissingLibraryFacts(libraryCheck.missingLibraries, console.error)");
    expect(runner).not.toMatch(/console\.(?:log|warn|error)\([^)]*(?:stdout|stderr|output)/);
    for (const unsafeSink of [
      "stdio: 'inherit'",
      'ldd failed: ${',
      'ldd.stderr',
      'error.message',
      'console.error(`- ${lib}`)',
    ]) expect(runner).not.toContain(unsafeSink);
  });

  test("admin evaluation metric parsers accept LAAJ objects without name", () => {
    const pageSource = source("app/admin/evaluations/admin-evaluation-page.tsx");
    const numeric = pageSource.split("function parseNumericEvaluationMetric")[1] ?? "";
    expect(numeric).toContain("typeof value.eval_value !== 'number'");
    expect(numeric.slice(0, 350)).not.toContain("typeof value.name !== 'string'");
    expect(numeric).toContain("typeof value.name === 'string' ? value.name : ''");
    const bool = pageSource.split("function parseBooleanEvaluationMetric")[1] ?? "";
    expect(bool.slice(0, 350)).not.toContain("typeof value.name !== 'string'");
    expect(bool).toContain("typeof value.eval_value !== 'boolean'");
  });
  test("responsive runner emits only fixed failure codes and allowlisted library facts", () => {
    const runner = source("scripts/run-responsive-tests.mjs");

    expect(runner).toContain("import { logCliError } from './privacy-safe-cli-log.mjs';");
    expect(runner).toContain("const SAFE_LIBRARY_NAME_PATTERN = /^lib[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;");
    expect(runner).toContain("const MISSING_LIBRARY_LINE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._+-]{0,127})\\s+=>\\s+not found$/;");
    expect(runner).toContain("stdio: 'ignore'");
    expect(runner).toContain("RESPONSIVE_TEST_LIBRARY_INSPECTION_FAILED");
    expect(runner).toContain("logMissingLibraryFacts(libraryCheck.missingLibraries, console.error)");
    expect(runner).not.toMatch(/console\.(?:log|warn|error)\([^)]*(?:stdout|stderr|output)/);
    for (const unsafeSink of [
      "stdio: 'inherit'",
      'ldd failed: ${',
      'ldd.stderr',
      'error.message',
      'console.error(`- ${lib}`)',
    ]) expect(runner).not.toContain(unsafeSink);
  });

  test("admin console exposes both mobile-width and desktop-width navigation affordances", () => {
    const adminPageSource = source("app/admin/page.tsx");
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const insightsClientSource = source("app/insights/insights-client.tsx");

    expect(adminPageSource).toContain("<AdminConsoleOverview initialStoryboardResult={initialStoryboardResult} />");
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
    expect(consoleSource).toContain('data-admin-console-mobile-header="true"');
    expect(consoleSource).toContain('data-admin-console-menu-trigger="hamburger"');
    expect(consoleSource).not.toContain(
      'data-admin-console-menu-trigger="desktop-hamburger"',
    );
    expect(consoleSource).not.toContain("Unified admin console");
    expect(consoleSource).toContain("md:hidden");
    expect(consoleSource).toContain("md:flex");
    expect(source("app/app-globals.css")).toMatch(
      /grid-template-columns:\s*fit-content\(var\(--admin-sidebar-expanded-max-width\)\)\s*minmax\(0, 1fr\);/,
    );
    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: 4.5rem minmax(0, 1fr);",
    );
    expect(consoleSource).toContain("md:w-full");
    expect(consoleSource).toContain("md:items-center md:px-1.5");
    expect(consoleSource).toContain(
      "overscroll-contain scrollbar-hide border-y border-border",
    );
    expect(consoleSource).not.toContain("pb-[calc(env(safe-area-inset-bottom)+5.75rem)]");
    expect(consoleSource).toContain("flex h-14 shrink-0 transform-gpu items-center gap-2");
    expect(consoleSource).toContain("translate3d(0, 0, 0)");
    expect(consoleSource).toContain(
      'data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}',
    );
    expect(consoleSource).toContain(
      "const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);",
    );
    expect(consoleSource).toContain(
      "const [showSidebarLabels, setShowSidebarLabels] = useState(false);",
    );
    expect(consoleSource).toContain("ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY");
    expect(consoleSource).toContain("SIDEBAR_LABEL_REVEAL_DELAY_MS");
    expect(consoleSource).toContain("handleToggleSidebarCollapsed");
    expect(consoleSource).toContain("setShowSidebarLabels(false)");
    expect(consoleSource).toContain("관리자 사이드바 펼치기");
    expect(consoleSource).toContain("관리자 사이드바 접기");
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain("AdminEvaluationModule");
    expect(consoleSource).toContain('initialView="submissions"');
    expect(consoleSource).toContain('initialSubmissionTab="reviews"');
    expect(consoleSource).toContain("AdminBannerModule");
    expect(consoleSource).toContain('<InsightsModule key="admin-insights" embedded />');
    expect(consoleSource).toContain('href: "/admin?module=banners"');
    expect(consoleSource).toContain('href: "/admin?module=insights"');
    expect(consoleSource).not.toContain('href: "/admin/banners"');
    expect(consoleSource).not.toContain('href: "/insights"');
    expect(insightsClientSource).toContain("embedded || (!isAuthLoading && !!user)");
    expect(consoleSource).not.toContain("AdminAnnouncementModule");
    expect(consoleSource).not.toContain('id: "announcements"');
    expect(consoleSource).not.toContain("/admin?module=announcements");
    expect(consoleSource).toContain("useSearchParams");
    expect(consoleSource).toContain("router.replace");
    expect(consoleSource).toContain(
      'window.history.replaceState(window.history.state, "", nextHref)',
    );
  });

  test("admin evaluations keep equivalent mobile-card and desktop-table controls", () => {
    const tableSource = source("components/admin/EvaluationTableNew.tsx");

    expect(tableSource).toContain("const mobileControls = (");
    expect(tableSource).toContain("const mobileCards = (");
    expect(tableSource).toContain(
      "grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden",
    );
    expect(tableSource).toContain("hidden rounded-lg border lg:block");
    expect(tableSource).toContain('aria-label="상호·영상 ID 검색"');
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
    expect(tableSource).toContain("{ value: 'true', label: '일치' }");
    expect(tableSource).toContain("{ value: 'false_match', label: '불일치' }");
    expect(tableSource).toContain("{ value: 'review', label: '검토' }");
    expect(tableSource).toContain("{ value: 'false_geocode', label: '실패' }");
    expect(tableSource).not.toContain("{ value: 'candidate', label: '승격 후보' }");
    expect(tableSource).not.toContain("label: '추가 확인'");
    expect(tableSource).toContain("{ value: 'missing', label: '누락' }");
    expect(tableSource).not.toContain("Missing 사유:");
    expect(tableSource).not.toContain("Reasoning Basis");
    expect(tableSource).not.toContain("Tzuyang Review");
  });

  test("admin evaluation delete is immediate while restore keeps inline typed confirmation", () => {
    const evaluationsSource = source("app/admin/evaluations/admin-evaluation-page.tsx");

    expect(evaluationsSource).not.toContain("EVALUATION_DELETE_CONFIRMATION");
    expect(evaluationsSource).not.toContain("검수삭제");
    expect(evaluationsSource).toContain(
      "const EVALUATION_RESTORE_CONFIRMATION = '검수복원'",
    );
    expect(evaluationsSource).toContain("휴지통 아이콘 클릭 즉시 status를 'deleted'로 변경");
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
    const evaluationsSource = source("app/admin/evaluations/admin-evaluation-page.tsx");

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
    expect(headerSource).toContain('data-admin-console-menu-item="true"');
    expect(headerSource).not.toContain(
      "router.push('/admin?module=announcements')",
    );
    expect(mobileOverlaySource).toContain("router.push('/admin')");
    expect(mobileOverlaySource).toContain('data-admin-console-menu-item="true"');
    expect(headerSource).toContain("관리자 콘솔");
    expect(mobileOverlaySource).toContain("관리자 콘솔");
    expect(headerSource).toContain("인사이트");
    expect(mobileOverlaySource).toContain("인사이트");
    expect(mobileOverlaySource).not.toContain("openAdminAnnouncements");
    expect(mobileOverlaySource).not.toContain("공지사항");
    expect(mobileOverlaySource).not.toContain("Megaphone");
    expect(navigationRoutesSource).toContain("'/admin'");
    expect(navigationRoutesSource).toContain("'/admin?module=restaurants'");
    expect(navigationRoutesSource).toContain("'/admin?module=banners'");
    expect(navigationRoutesSource).toContain("'/admin?module=insights'");
    expect(navigationRoutesSource).not.toContain("'/admin/banners'");
    expect(mobileBottomNavSource).toContain("path: '/'");
    expect(mobileBottomNavSource).toContain("path: '/stamp'");
    expect(mobileBottomNavSource).not.toContain("label: '제보'");
    expect(mobileBottomNavSource).not.toContain("testId: 'submissions'");
    expect(mobileBottomNavSource).not.toContain("mobile-bottom-nav-submissions");
    expect(mobileBottomNavSource).toContain("isMobileNavItemActive(pathname, item)");
    expect(mobileBottomNavSource).toContain("'font-sans'");
    expect(mobileBottomNavSource).toContain(
      "'text-[12px] font-medium leading-none tracking-normal'",
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
    const themeFilterIconSource = source(
      "components/home/home-map-theme-filter-icons.tsx",
    );
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const floatingNavSource = source(
      "components/layout/FloatingNavButtons.tsx",
    );
    const stampOverlaySource = source(
      "components/overlay-pages/StampOverlay.tsx",
    );
    const stampPageSource = source("app/stamp/page.tsx");
    const stampCardSource = source("components/stamp/StampCard.tsx");
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
      "pointer-events-auto inline-flex h-9 snap-start shrink-0 items-center gap-1 rounded-full",
    );
    expect(mobileOverlaySource).toContain("text-xs font-medium");
    expect(mobileOverlaySource).toContain(
      "rounded-full h-9 px-2 home-map-floating-control-text text-xs font-medium",
    );
    expect(homeAppGlobalsSource).toContain(".home-map-floating-control-text");
    expect(homeAppGlobalsSource).toContain("font-size: 0.75rem");
    expect(homeAppGlobalsSource).toContain("line-height: 1rem");
    expect(mobileOverlaySource.match(/home-map-floating-control-text/g)).toHaveLength(5);
    expect(homeDesktopControlPanelSource.match(/home-map-floating-control-text/g)).toHaveLength(6);
    expect(mobileOverlaySource).not.toContain(
      "pointer-events-auto inline-flex h-11 min-h-11 snap-start shrink-0 items-center gap-1 rounded-full",
    );
    expect(mobileOverlaySource).not.toContain(
      "rounded-full h-11 min-h-11 px-2 text-xs font-medium",
    );
    expect(mobileOverlaySource).not.toContain(
      "w-[clamp(84px,28vw,105px)] h-11 min-h-11 px-2",
    );
    expect(mobileOverlaySource).toContain("data-mobile-topic-slider");
    expect(mobileOverlaySource).toContain("flex w-full max-w-full snap-x gap-2 overflow-x-auto px-0.5");
    expect(mobileOverlaySource).not.toContain("mt-2 -mx-3 flex snap-x");
    expect(mobileOverlaySource).toContain("<HomeMapThemeFilterIcon themeId={theme.id} />");
    expect(mobileOverlaySource).toContain("카테고리 필터 열기");
    expect(mobileOverlaySource).toContain('aria-expanded={false}');
    expect(mobileOverlaySource).toContain('data-mobile-map-sheet-trigger="region"');
    expect(mobileOverlaySource).toContain('data-mobile-map-sheet-trigger="category"');
    expect(mobileOverlaySource).toContain('mobileSheetTriggerRef');
    expect(mobileOverlaySource).toContain('`[data-mobile-map-sheet-trigger="${trigger}"]`');
    expect(mobileOverlaySource).toContain('role="dialog"');
    expect(mobileOverlaySource).toContain(
      '<span className="font-medium">대한민국</span>',
    );
    expect(mobileOverlaySource).not.toContain(
      '<span className="font-medium">전국</span>',
    );
    expect(mobileOverlaySource).toContain("handleSearchLayerKeyDown");
    expect(source("app/home-client.tsx")).toContain("onMapInteraction={handleMapInteraction}");
    expect(mobileOverlaySource).toContain("mapInteractionEpoch?: number");
    expect(mobileOverlaySource).toContain("visibleMarkerSheetHeightRequestKey");
    expect(mobileOverlaySource).toContain("height: VISIBLE_MARKER_SHEET_HEIGHT, mode: 'exact'");
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
      "pointer-events-auto flex items-center gap-1.5 min-h-11 rounded-full shadow-lg bg-background/95 backdrop-blur-sm border border-border px-1.5",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex-1 h-9 rounded-full flex items-center gap-2 px-2 bg-secondary/40 min-w-0",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80 focus-visible:ring-2 focus-visible:ring-primary touch-manipulation",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'aria-label="검색어 지우기"',
    );
    expect(homeDesktopControlPanelSource).toContain('aria-label="검색 닫기"');
    expect(homeDesktopControlPanelSource).toContain(
      "const hasDesktopSearchQuery = desktopSearchQuery.trim().length > 0",
    );
    expect(homeDesktopControlPanelSource).toContain("{hasDesktopSearchQuery ? (");
    expect(homeDesktopControlPanelSource).toContain('aria-label="지도 메뉴 열기"');
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-menu-trigger="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-menu="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const desktopMapMenuItemClass =",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "z-[180] w-max min-w-[max-content] max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "z-[180] w-44 rounded-2xl border-border bg-card p-1.5 font-sans shadow-2xl",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DropdownMenuLabel",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      ">지도 메뉴<",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "max-w-[min(22rem,calc(100vw-4rem))] rounded-xl px-3 py-2 text-foreground",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-foreground whitespace-nowrap focus:bg-accent focus:text-foreground",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '<Menu className="h-5 w-5" aria-hidden="true" />',
    );
    expect(homeDesktopControlPanelSource).toContain('alt="로고"');
    expect(homeDesktopControlPanelSource).toContain("width={24}");
    expect(homeDesktopControlPanelSource).toContain("height={24}");
    expect(homeDesktopControlPanelSource).toContain(
      "text-sm text-foreground outline-none placeholder:text-foreground/70",
    );
    expect(homeDesktopControlPanelSource).toContain("bg-secondary/40");
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
    const homeClientSource = source("app/home-client.tsx");
    expect(homeClientSource).toContain("requestDesktopDetailReturnCapture();");
    expect(homeClientSource).toContain("returnToRestaurantListPanel");
    expect(homeClientSource).toContain("closeRestaurantDetailPanel");
    expect(homeDesktopControlPanelSource).toContain(
      "const returnRoute = getDesktopLeftPanelRoute(",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "(onDetailPanelBack ?? onPanelClose)?.()",
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
      'data-desktop-map-mode-toggle="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'className="fixed right-4 top-4 z-[70] min-w-0"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-theme-filters="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const desktopMapFloatingControlStyle = {",
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
      "const DESKTOP_MAP_FLOATING_FILTER_WIDTH = \"10.9375rem\"",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '"--desktop-map-floating-filter-width": DESKTOP_MAP_FLOATING_FILTER_WIDTH',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "flex w-[var(--desktop-map-floating-filter-width)] items-center gap-0.5 rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain("HOME_MAP_THEME_FILTERS.map");
    expect(homeDesktopControlPanelSource).toContain("<HomeMapThemeFilterIcon themeId={theme.id} />");
    expect(mobileOverlaySource).toContain("<span>{theme.label}</span>");
    expect(homeDesktopControlPanelSource).toContain("<span>{theme.label}</span>");
    expect(mobileOverlaySource).not.toContain("theme.shortLabel");
    expect(homeDesktopControlPanelSource).not.toContain("theme.shortLabel");
    expect(themeFilterIconSource).toContain('"hot-view": TrendingUp');
    expect(themeFilterIconSource).toContain('"comment-hot": MessageCircle');
    expect(themeFilterIconSource).toContain('"fresh-video": Clock3');
    expect(themeFilterIconSource).toContain('"repeat-video": Repeat2');
    expect(themeFilterIconSource).toContain('"fan-signal": Sparkles');
    expect(homeDesktopControlPanelSource).toContain("!w-full !min-w-max");
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
      'aria-label="이전 목록으로 돌아가기"',
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
      restaurantDetailPanelSource.indexOf('aria-label="이전 목록으로 돌아가기"'),
    );
    expect(restaurantDetailPanelSource).not.toContain(
      'className="mr-1 h-9 w-9 shrink-0 rounded-full border border-border bg-background hover:bg-secondary/80"',
    );
    expect(restaurantDetailPanelSource).not.toContain("뒤로가기");
    expect(restaurantDetailPanelSource).toContain(
      'size="icon"',
    );
    expect(restaurantDetailPanelSource).not.toContain(
      'className="h-9 w-9 shrink-0 rounded-full"',
    );
    expect(restaurantDetailPanelSource).toContain(
      '<ArrowLeft className="h-4 w-4" aria-hidden="true" />',
    );
    expect(restaurantDetailPanelSource).toContain("function MapProviderLogo");
    expect(restaurantDetailPanelSource).toContain('data-map-provider-logo="naver"');
    expect(restaurantDetailPanelSource).toContain('data-map-provider-logo="kakao"');
    expect(restaurantDetailPanelSource).toContain('data-map-provider-logo="google"');
    expect(restaurantDetailPanelSource).toContain('<MapProviderLogo provider="naver" />');
    expect(restaurantDetailPanelSource).toContain('<MapProviderLogo provider="kakao" />');
    expect(restaurantDetailPanelSource).toContain('<MapProviderLogo provider="google" />');
    expect(restaurantDetailPanelSource).toContain('aria-label="네이버 지도로 길찾기 열기"');
    expect(restaurantDetailPanelSource).toContain('aria-label="카카오맵으로 길찾기 열기"');
    expect(restaurantDetailPanelSource).toContain('aria-label="구글 지도로 길찾기 열기"');
    expect(restaurantDetailPanelSource).not.toContain('text-green-600 font-black text-lg">N</span>');
    expect(restaurantDetailPanelSource).not.toContain('text-foreground font-black text-lg">K</span>');
    expect(restaurantDetailPanelSource).not.toContain('text-white font-black text-lg">G</span>');
    expect(homeDesktopControlPanelSource).toContain('resultView="inline"');
    expect(homeDesktopControlPanelSource).toContain("hideSearchControls");
    expect(homeDesktopControlPanelSource).not.toContain(
      'data-desktop-map-floating-nav="true"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'className="fixed top-4 z-[70] flex flex-col items-start gap-2"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DESKTOP_FLOATING_NAV_ROW_STARTS",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "data-desktop-map-floating-nav-row={",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'rowStart === 0 ? "account" : "content"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DESKTOP_FLOATING_NAV_BUTTON_WIDTH",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      '"--desktop-floating-nav-button-width": DESKTOP_FLOATING_NAV_BUTTON_WIDTH',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "pointer-events-auto h-9 w-[var(--desktop-floating-nav-button-width)] shrink-0 justify-center rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const revealDesktopLeftPanel = useCallback",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onSetPanelCollapsed?.(false);",
    );
    expect(homeDesktopControlPanelSource).toContain(
      `revealDesktopLeftPanel();
      setActiveLeftPanelView(panel);`,
    );
    expect(homeDesktopControlPanelSource).toContain(
      `revealDesktopLeftPanel();
    setActiveProfileUserId(user.id);`,
    );
    expect(homeDesktopControlPanelSource).toContain(
      `revealDesktopLeftPanel();
    setActiveLeftPanelView("bookmarks");`,
    );
    expect(homeDesktopControlPanelSource).toContain(
      `revealDesktopLeftPanel();
    setActiveLeftPanelView("notifications");`,
    );
    expect(homeDesktopControlPanelSource).toContain(
      "DESKTOP_LEFT_PANEL_AUTH_TOASTS",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'profile: "로그인 후 프로필을 확인할 수 있어요"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'bookmarks: "로그인 후 북마크를 확인할 수 있어요"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'notifications: "로그인 후 알림을 확인할 수 있어요"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'settings: "로그인 후 지도 환경설정을 사용할 수 있어요"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'review: "로그인 후 리뷰를 작성할 수 있어요"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'showDesktopLeftPanelAuthToast("profile");',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'showDesktopLeftPanelAuthToast("bookmarks");',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'showDesktopLeftPanelAuthToast("notifications");',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const DESKTOP_MAP_MENU_ITEMS = [",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "] as const satisfies ReadonlyArray<DesktopMapMenuItem>;",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const handleDesktopMapMenuItemSelect = useCallback",
    );
    expect(homeDesktopControlPanelSource).toContain('case "profile":');
    expect(homeDesktopControlPanelSource).toContain("handleAccountClick();");
    expect(homeDesktopControlPanelSource).toContain('case "bookmarks":');
    expect(homeDesktopControlPanelSource).toContain("handleBookmarkClick();");
    expect(homeDesktopControlPanelSource).toContain('case "notifications":');
    expect(homeDesktopControlPanelSource).toContain("handleNotificationClick();");
    expect(homeDesktopControlPanelSource).toContain("handleShortcutClick(id);");
    expect(homeDesktopControlPanelSource).toContain(
      "DESKTOP_MAP_MENU_ITEMS.map((item) =>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClick={() => handleDesktopMapMenuItemSelect(item.id)}",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "const desktopMapMenuItems = useMemo",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "The hamburger menu intentionally lives in the expanded desktop search slot.",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "we do not add a second map-floating nav because the old map overlay buttons",
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
    expect(myPageProfileSource).toContain("data-mypage-desktop-tier-progress");
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-tier-metrics="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-recent-activity="true"',
    );
    expect(myPageProfileSource).toContain(
      'data-mypage-desktop-recent-activity-row="true"',
    );
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
      'activeLeftPanelView === "map" &&\n    hasDesktopSearchIntent',
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
    expect(stampPageSource).toContain(
      'data-stamp-guide-loading-card="mobile-page"',
    );
    expect(stampOverlaySource).toContain(
      'data-stamp-guide-loading-card="desktop-left-panel"',
    );
    expect(stampCardSource).toContain('data-stamp-guide-badge="true"');
    expect(stampCardSource).toContain('data-stamp-guide-close="true"');
    expect(stampCardSource).toContain('aria-label="가이드 닫기"');
    expect(stampOverlaySource).toContain(
      "isUserStampsReady={isGuideCard ? true : isUserStampsReady}",
    );
    expect(stampOverlaySource).toContain('guideLabel={isGuideCard ? "가이드" : undefined}');
    expect(stampOverlaySource).toContain(
      "onGuideClose={isGuideCard ? dismissStampGuide : undefined}",
    );
    expect(stampPageSource).toContain("showStampGuide && (");
    expect(stampOverlaySource).toContain("showStampGuide && (");
    expect(stampOverlaySource).toContain("singleColumnCards?: boolean");
    expect(stampOverlaySource).toContain("singleColumnCards = false");
    expect(stampOverlaySource).toContain(
      'data-stamp-card-grid-single-column={singleColumnCards ? "true" : "false"}',
    );
    expect(stampOverlaySource).toContain("const STAMP_PAGE_SIZE = 5");
    expect(stampOverlaySource).toContain(
      "const skeletonCardCount = STAMP_PAGE_SIZE",
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
    expect(homeDesktopControlPanelSource).toContain('label: "알림"');
    expect(homeDesktopControlPanelSource).toContain('case "notifications":');
    expect(homeDesktopControlPanelSource).toContain("handleNotificationClick();");
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
      'const DEVICE_LOCATION_ENABLE_TOAST = "위치 서비스(GPS) 기능을 켜주세요.";',
    );
    expect(source("app/home-client.tsx")).toContain(
      "toast.error(DEVICE_LOCATION_ENABLE_TOAST);",
    );
    expect(source("app/home-client.tsx")).toContain(
      'toast.info("로그인 후 프로필을 확인할 수 있어요");',
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "toast.error('맛집 정보를 불러오지 못했어요');",
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "toast.error('공지사항을 불러오지 못했어요');",
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "openPanelRef.current('announcement');",
    );
    expect(source("app/home-client-effects.tsx")).not.toContain(
      "togglePanelCollapse();",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain(
      "toast.error('로그인 후 알림을 확인할 수 있어요');",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain(
      'data-mobile-bottom-right-safe-area-owner="mobile-floating-actions"',
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain(
      'data-fixed-control-region="mobile-map-actions"',
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain("event.stopPropagation();");
    expect(source("components/home/MobileControlOverlay.tsx")).toContain("onDeviceLocationClick?.();");
    expect(source("components/home/MobileControlOverlay.tsx")).toContain("activeSheet !== 'search'");
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
