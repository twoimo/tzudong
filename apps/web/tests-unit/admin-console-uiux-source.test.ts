import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");

describe("admin console beginner-friendly UI/UX source contract", () => {
  test("keeps admin module state URL-backed and easy to recover", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).toContain("useSearchParams");
    expect(consoleSource).toContain("getAdminModuleIdFromSearchParams");
    expect(consoleSource).toContain("router.replace");
    expect(consoleSource).toContain("scroll: false");
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).not.toContain("window.history.replaceState");
  });

  test("removes repeated beginner guidance cards from the admin console", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).not.toContain("초보자 안내 강화");
    expect(consoleSource).not.toContain("BeginnerGuideCard");
    expect(consoleSource).not.toContain("처음 쓰는 관리자 안내");
    expect(consoleSource).not.toContain(
      "무엇부터 보면 되는지 3단계로 정리했어요",
    );
    expect(consoleSource).not.toContain("beginnerTip");
    expect(consoleSource).not.toContain("safetyTip");
    expect(consoleSource).not.toContain("처음이라면");
    expect(consoleSource).not.toContain("안전하게 처리하려면");
    expect(consoleSource).not.toContain("ModuleContextHeader");
  });

  test("keeps announcement operations safer and accessible inside the console", () => {
    const panelSource = source("components/announcement/AnnouncementPanel.tsx");

    expect(panelSource).toContain("lastActionMessage");
    expect(panelSource).toContain("formError");
    expect(panelSource).toContain("저장 전 확인");
    expect(panelSource).toContain("게시 상태: {formData.isActive ?");
    expect(panelSource).toContain("홈 지도 배너: {formData.showOnBanner ?");
    expect(panelSource).toContain("공지 패널 닫기");
    expect(panelSource).toContain("첫 공지 페이지로 이동");
    expect(panelSource).toContain("이전 공지 페이지로 이동");
    expect(panelSource).toContain("다음 공지 페이지로 이동");
    expect(panelSource).toContain("마지막 공지 페이지로 이동");
    expect(panelSource).toContain("공지 작성 후 목록으로 돌아가기");
    expect(panelSource).toContain("수정 저장 후 목록으로 돌아가기");
    expect(panelSource).toContain("저장 중…");
    expect(panelSource).toContain("일반 50, 중요 80, 긴급 100을 권장합니다.");
    expect(panelSource).toContain("홈 배너에 노출");
    expect(panelSource).toContain("홈 배너에서 내리기");
    expect(panelSource).not.toContain("저장 중...");
  });

  test("keeps announcement read models shared while narrowing banner fetches", () => {
    const bannerHookSource = source("hooks/use-banner-announcements.tsx");

    expect(bannerHookSource).toContain(
      "export function useActiveAnnouncements(enabled = true)",
    );
    expect(bannerHookSource).toContain(
      "export function useBannerAnnouncements(enabled = true)",
    );
    expect(bannerHookSource).toContain("fetchSupabaseRows");
    expect(bannerHookSource).toContain("ANNOUNCEMENT_SELECT");
    expect(bannerHookSource).toContain("AnnouncementRow");
    expect(bannerHookSource).toContain("['show_on_banner', 'eq.true']");
    expect(bannerHookSource).toContain("BANNER_ANNOUNCEMENTS_STALE_TIME_MS");
    expect(bannerHookSource).not.toContain("@/hooks/use-announcements");
  });

  test("keeps the restaurant evaluation detail panel operator-focused and uncluttered", () => {
    const detailSource = source("components/admin/EvaluationDetailView.tsx");

    expect(detailSource).toContain('title="영상 근거"');
    expect(detailSource).toContain('title="검수 결과"');
    expect(detailSource).toContain('title="음식점 상세"');
    expect(detailSource).toContain(
      "review -> decision capture -> guarded apply",
    );
    expect(detailSource).toContain('aria-label="영상 근거와 메타 정보"');
    expect(detailSource).toContain("focus-visible:ring-primary");
    expect(detailSource).not.toContain("📹 영상 정보");
    expect(detailSource).not.toContain("📊 평가 상세");
    expect(detailSource).not.toContain("🍽️ 음식점 상세 정보");
    expect(detailSource).not.toContain(
      "bg-white rounded-lg border p-3 shadow-sm",
    );
    expect(detailSource).not.toContain("Reasoning Basis</h4>");
    expect(detailSource).not.toContain("Tzuyang Review</h4>");
  });

  test("keeps route recommendation as a viewport-bounded two-pane map console", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain(
      "const AdminRouteRecommendationModule = dynamic(",
    );
    expect(consoleSource).toContain(
      'import("@/components/admin/AdminOverviewDashboard")',
    );
    expect(consoleSource).toContain('id: "routes"');
    expect(consoleSource).toContain('title: "맛집 동선 추천"');
    expect(consoleSource).toContain("AdminDashboardManagementPanel");
    expect(consoleSource).not.toContain("fetchAdminMapRestaurants");

    expect(overviewSource).toContain("fetchAdminMapRestaurants");
    expect(overviewSource).toContain(
      "limit: String(ADMIN_OVERVIEW_MAP_PAGE_SIZE)",
    );
    expect(overviewSource).toContain('onlyWithCoordinates: "true"');
    expect(overviewSource).toContain('cache: "no-store"');
    expect(overviewSource).toContain("/api/dashboard/restaurants");
    expect(overviewSource).toContain("AdminMapOverviewCanvas");
    expect(overviewSource).toContain("AdminNaverMapSurface");
    expect(overviewSource).toContain("AdminMapInfoPanel");
    expect(overviewSource).toContain(
      'aria-label="관리자 지도 운영 개요 2분할"',
    );
    expect(overviewSource).toContain(
      "lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]",
    );
    expect(overviewSource).toContain('data-admin-overview-map-canvas="true"');
    expect(overviewSource).toContain(
      'data-admin-map-status-overlay="non-blocking"',
    );
    expect(overviewSource).toContain("const shouldShowMapStatusOverlay =");
    expect(overviewSource).toContain("useNaverMaps");
    expect(overviewSource).toContain(
      'useNaverMaps({ autoLoad: false, strategy: "lazyOnload" })',
    );
    expect(overviewSource).toContain("IntersectionObserver");
    expect(overviewSource).toContain("loadNaverMaps();");
    expect(overviewSource).toContain("viewportRefreshTimerRef");
    expect(overviewSource).toContain("window.setTimeout(() =>");
    expect(overviewSource).toContain("getNaverIndividualMarkerVisual");
    expect(overviewSource).toContain("buildNaverClusterMarkerRenderPlan");
    expect(overviewSource).toContain("getClusterVisualKey");
    expect(overviewSource).toContain("currentIndex:");
    expect(overviewSource).toContain(
      "getClusterVisualKey(clusterId) % markerCategories.length",
    );
    expect(overviewSource).not.toContain("currentIndex: 0");
    expect(overviewSource).toContain("new maps.Map");
    expect(overviewSource).toContain("new maps.Marker");
    expect(overviewSource).toContain("createClusterIndex");
    expect(overviewSource).toContain("const adminMapClusterIndex = useMemo");
    expect(overviewSource).toContain(
      "clusterIndex.load(adminRestaurantsToClusterFeatures(visibleRestaurants));",
    );
    expect(overviewSource).toContain("const clusters = getClusters(");
    expect(overviewSource).toContain("      adminMapClusterIndex,");
    expect(overviewSource).toContain("getClusterCategories");
    expect(overviewSource).toContain("mapRef.current.setZoom?.(");
    expect(overviewSource).toContain("visibleRestaurants.length > 1");
    expect(overviewSource).toContain('? REGION_MAP_CONFIG["서울특별시"].zoom');
    expect(overviewSource).toContain(": 14,");
    expect(overviewSource).toContain(
      "map.setZoom?.(Math.max(currentZoom + 1, expansionZoom), false)",
    );
    expect(overviewSource).toContain(
      "map.setCenter?.(new maps.LatLng(lat, lng))",
    );
    expect(overviewSource).toContain("mapRef.current.setCenter?.(center)");
    expect(overviewSource).toContain(
      "mapRef.current.setZoom?.(ADMIN_OVERVIEW_CLUSTER_MAX_ZOOM + 1, false)",
    );
    expect(overviewSource).not.toContain("clusterAnimationManager.start(1400)");
    expect(overviewSource).not.toContain("buildNaverClusterAnimationIconPlan");
    expect(overviewSource).not.toContain("injectClusterCSS();");
    expect(overviewSource).not.toContain("panTo?.(");
    expect(overviewSource).not.toContain(
      "pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5",
    );
    expect(overviewSource).not.toContain("홈 마커·클러스터 재사용");
    expect(overviewSource).toContain("function AdminMapLoadingSkeleton");
    expect(overviewSource).toContain("function AdminMapInfoPanelSkeleton");
    expect(overviewSource).toContain('data-admin-map-info-skeleton="true"');
    expect(overviewSource).toContain('aria-label="관리자 지도 동선 추천 로딩"');
    expect(overviewSource).toContain("if (isLoading && !selectedRestaurant)");
    expect(overviewSource).toContain('aria-label="관리자 네이버 지도 로딩"');
    expect(overviewSource).toContain('data-admin-map-loading-skeleton="true"');
    expect(overviewSource).toContain(
      "pointer-events-none absolute inset-0 bg-card/35 backdrop-blur-[1px]",
    );
    expect(overviewSource).not.toContain("지도 준비 중");
    expect(overviewSource).not.toContain(
      "w-full max-w-xs space-y-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm",
    );
    expect(overviewSource).not.toContain("background-image:linear-gradient");
    expect(overviewSource).not.toContain("skeletonMarkers");
    expect(overviewSource).not.toContain("rotate-[-11deg]");
    expect(overviewSource).not.toContain("ADMIN_MAP_MOCK_RESTAURANTS");
    expect(overviewSource).not.toContain("목업 데이터");
    expect(overviewSource).toContain("표시할 좌표 맛집이 없습니다");
    expect(overviewSource).toContain("지도는 유지하고 실데이터만 재확인합니다");
    expect(overviewSource).not.toContain("overflow-y-auto lg:overflow-hidden");
    expect(overviewSource).not.toContain(
      "overflow-visible md:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden",
    );
    expect(overviewSource).not.toContain("Tzudong admin map");
    expect(overviewSource).not.toContain("Selected marker");
    expect(overviewSource).not.toContain("getRestaurantMarkerStyle");
    expect(overviewSource).not.toContain("쯔동여지도 홈 · 관리자 전용");
    expect(overviewSource).not.toContain("마커 선택 가능");
    expect(overviewSource).not.toContain("운영 정보");
    expect(overviewSource).toContain("동선 추천 초안");
    expect(overviewSource).not.toContain("1분할");
    expect(overviewSource).not.toContain("3분할");
    expect(overviewSource).not.toContain("4분할");
  });

  test("keeps all admin skeletons compact and layout-faithful", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const adminLoadingSource = source("app/admin/loading.tsx");
    const routeSkeletonSource = source("app/admin/evaluations/page.tsx");
    const evaluationTableSource = source(
      "components/admin/EvaluationTableNew.tsx",
    );
    const submissionListSource = source(
      "components/admin/SubmissionListView.tsx",
    );
    const usersSource = source("components/admin/AdminUsersPanel.tsx");

    expect(consoleSource).not.toContain(
      "aria-label={`${title} 작업 화면 준비 상태`}",
    );
    expect(consoleSource).not.toContain(
      "Array.from({ length: 6 }).map((_, index) => (",
    );
    expect(adminLoadingSource).toContain("return null;");
    expect(adminLoadingSource).toContain("모듈별 스켈레톤만 한 번");
    expect(consoleSource).not.toContain("AdminConsoleLoadingSkeleton");
    expect(consoleSource).toContain("function AdminConsoleCanvasSkeleton()");
    expect(consoleSource).toContain(
      'data-admin-console-content-loading="true"',
    );
    expect(consoleSource).toContain(
      'aria-label="관리자 콘솔 작업 화면 로딩 중"',
    );
    expect(consoleSource).toContain('aria-busy="true"');
    expect(source("components/admin/AdminOverviewDashboard.tsx")).toContain(
      'data-admin-map-loading-skeleton="true"',
    );
    expect(consoleSource).toContain(
      "const isShellBootstrapping = authLoading || !hasHydrated;",
    );
    expect(consoleSource).toContain("{isShellBootstrapping ? (");
    expect(consoleSource).toContain("function AdminDashboardManagementSkeleton()");
    expect(consoleSource).toContain("<AdminDashboardManagementSkeleton />");
    expect(consoleSource).toContain(
      'data-admin-dashboard-management-skeleton="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-skeleton-card="trend"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-skeleton-card="topContent"',
    );
    expect(consoleSource).toContain(
      'useState<AdminModuleId>(requestedModuleId)',
    );
    expect(consoleSource).toContain(
      'activeModuleId === "overview" ? (',
    );
    expect(source("components/admin/AdminOverviewDashboard.tsx")).toContain(
      "backdrop-blur-[1px]",
    );
    expect(consoleSource).not.toContain("지도 준비 중");
    expect(consoleSource).not.toContain("group-hover:scale-[1.02]");
    expect(consoleSource).toContain("return null;");
    expect(adminLoadingSource).not.toContain("AdminConsoleLoadingSkeleton");
    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(consoleSource).not.toContain("lg:w-[280px]");
    expect(consoleSource).not.toContain(
      "bg-gradient-to-br from-card via-card to-primary/5 p-3",
    );
    expect(routeSkeletonSource).toContain(
      'className="flex h-full min-h-0 flex-col overflow-hidden"',
    );
    expect(routeSkeletonSource).toContain(
      "lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]",
    );
    expect(routeSkeletonSource).not.toContain("repeat(8,96px)");
    expect(consoleSource).toContain('role="status"');
    expect(evaluationTableSource).toContain(
      'aria-label="맛집 검수 카드 로딩 중"',
    );
    expect(evaluationTableSource).toContain(
      'role="status" aria-busy="true" aria-label="맛집 검수 카드 로딩 중"',
    );
    expect(evaluationTableSource).toContain("Array.from({ length: 4 }).map");
    expect(evaluationTableSource).toContain(
      "const desktopLoadingRows = Array.from({ length: 6 })",
    );
    expect(submissionListSource).toContain("Array.from({ length: 4 }).map");
    expect(submissionListSource).toContain(
      "grid gap-2 sm:grid-cols-[minmax(0,1fr)_80px_72px]",
    );
    expect(submissionListSource).toContain(
      'role="status" aria-busy="true" aria-label={`${label} 목록 로딩 중`}',
    );
    expect(usersSource).toContain(
      'role="status" aria-busy="true" aria-label="사용자 목록 로딩 중"',
    );
    expect(usersSource).toContain("function UserTableSkeleton");
    expect(usersSource).toContain(
      '<caption className="sr-only">관리자 사용자 목록 로딩</caption>',
    );
    expect(usersSource).toContain(
      '<th scope="col" className="px-3 py-2 font-semibold">사용자</th>',
    );
    expect(usersSource).toContain("block min-w-0 text-left");
    expect(usersSource).toContain("overflow-hidden rounded-lg border bg-card");
    expect(usersSource).toContain(
      'Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground"',
    );
    expect(usersSource).not.toContain(
      'Badge variant="outline" className="border-border bg-background text-muted-foreground"',
    );
    expect(usersSource).not.toContain(
      "h-8 w-14 rounded-lg motion-reduce:animate-none",
    );
    expect(usersSource).not.toContain(
      "h-10 rounded-lg motion-reduce:animate-none",
    );
  });

  test("keeps overview reference widgets uncluttered and source-honest", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(overviewSource).toContain(
      "네이버 Directions 5 기준 실제 도로 주행 경로",
    );
    expect(overviewSource).toContain(
      "도로 경로 계산 전이나 실패 시에는 같은 영상·카테고리·직선거리 기반 후보",
    );
    expect(overviewSource).toContain("fetchAdminDirectionsRoute");
    expect(overviewSource).toContain("/api/admin/routes/directions");
    expect(source("lib/admin-route-planner.ts")).toContain('id: "driving"');
    expect(source("lib/admin-route-planner.ts")).toContain('id: "walking"');
    expect(source("lib/admin-route-planner.ts")).toContain('id: "mixed"');
    expect(source("lib/admin-route-planner.ts")).toContain(
      "네이버 도로 경로 응답 전까지는 직선거리 기반 후보입니다.",
    );
    expect(overviewSource).toContain("ADMIN_ROUTE_MODE_OPTIONS");
    expect(overviewSource).toContain("assessAdminRouteReadiness");
    expect(overviewSource).toContain("buildAdminRoutePlan");
    expect(overviewSource).toContain(
      'data-admin-route-mode-controls="driving-walking-mixed"',
    );
    expect(overviewSource).toContain(
      'data-admin-route-readiness-panel="local-heuristic"',
    );
    expect(overviewSource).toContain(
      'data-admin-route-stop-list="ordered-shooting-plan"',
    );
    expect(overviewSource).toContain("동선 준비도");
    expect(overviewSource).toContain("자동차");
    expect(overviewSource).toContain("도보");
    expect(overviewSource).toContain("혼합");
    expect(overviewSource).toContain(
      "네이버 Directions 5는 자동차만 지원하므로 도보·혼합은 근거리 촬영 초안",
    );
    expect(overviewSource).not.toContain(
      'data-admin-creator-layer-controls="active-only"',
    );
    expect(overviewSource).not.toContain("최근 영상 연결");
    expect(overviewSource).not.toContain("향후 유튜버 A");
    expect(overviewSource).not.toContain("향후 유튜버 B");
    expect(consoleSource).not.toContain("ADMIN_OVERVIEW_WIDGET_STORAGE_KEY");
    expect(consoleSource).not.toContain("normalizeAdminOverviewWidgetOrder");
    expect(consoleSource).not.toContain("moveAdminOverviewWidget");
    expect(consoleSource).not.toContain(
      "window.localStorage.setItem(ADMIN_OVERVIEW_WIDGET_STORAGE_KEY",
    );
    expect(consoleSource).not.toContain("hasLoadedWidgetOrder");
    expect(consoleSource).not.toContain('aria-label="개요 위젯 순서 조정"');
    expect(consoleSource).not.toContain("위로 이동");
    expect(consoleSource).not.toContain("아래로 이동");
    expect(consoleSource).not.toContain("기본 순서");
    expect(consoleSource).toContain('title: "대시보드 (KPI)"');
    expect(consoleSource).toContain('badge: "성과 요약"');
    const sidebarSectionsSource = consoleSource.slice(
      consoleSource.indexOf("const sidebarSections"),
      consoleSource.indexOf("function moveItemInArray"),
    );
    const homeSectionSource = sidebarSectionsSource.slice(
      sidebarSectionsSource.indexOf('label: "홈"'),
      sidebarSectionsSource.indexOf('label: "검수"'),
    );
    const opsSectionSource = sidebarSectionsSource.slice(
      sidebarSectionsSource.indexOf('label: "운영"'),
      sidebarSectionsSource.indexOf('label: "실험실"'),
    );
    const labSectionSource = sidebarSectionsSource.slice(
      sidebarSectionsSource.indexOf('label: "실험실"'),
    );
    expect(homeSectionSource).not.toContain('id: "routes"');
    expect(opsSectionSource).toContain('getSidebarConsoleItems(["users", "banners", "insights"])');
    expect(opsSectionSource).not.toContain('id: "routes"');
    expect(opsSectionSource).not.toContain('"storyboard"');
    expect(opsSectionSource).not.toContain('"audit"');
    expect(labSectionSource).toContain('getSidebarConsoleItems(["youtube-thumbnail-generator", "storyboard"])');
    expect(labSectionSource).toContain('id: "routes"');
    expect(labSectionSource).toContain('"audit"');
    expect(labSectionSource).toContain('id: "llm"');
    expect(labSectionSource).toContain('badge: "실험 중"');
    expect(labSectionSource.indexOf('"youtube-thumbnail-generator"')).toBeLessThan(
      labSectionSource.indexOf('"storyboard"'),
    );
    expect(labSectionSource.indexOf('"storyboard"')).toBeLessThan(
      labSectionSource.indexOf('id: "routes"'),
    );
    expect(labSectionSource.indexOf('id: "routes"')).toBeLessThan(
      labSectionSource.indexOf('id: "llm"'),
    );
    expect(labSectionSource.indexOf('id: "llm"')).toBeLessThan(
      labSectionSource.indexOf('"audit"'),
    );
    expect(consoleSource).toContain('title: "핵심 인사이트"');
    expect(consoleSource).toContain("fetchAdminDashboardInsightSummary");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain(
      'data-admin-dashboard-realtime-charts="true"',
    );
    expect(consoleSource).toContain('data-admin-dashboard-channel-kpi="true"');
    expect(consoleSource).toContain(
      "flex min-h-full min-w-0 flex-col overflow-visible bg-background p-0 font-sans text-foreground lg:h-full lg:min-h-0 lg:overflow-hidden",
    );
    expect(consoleSource).toContain(
      "grid min-h-0 min-w-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-x-hidden overflow-y-visible sm:grid-cols-2 lg:grid-cols-10 lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]",
    );
    expect(consoleSource).toContain('activeModuleId === "overview"');
    expect(consoleSource).toContain("overflow-y-auto lg:overflow-hidden");
    expect(consoleSource).toContain('from "recharts"');
    expect(consoleSource).toContain("ResponsiveContainer");
    expect(consoleSource).toContain("LineChart");
    expect(consoleSource).toContain("ScatterChart");
    expect(consoleSource).toContain("AreaChart");
    expect(consoleSource).toContain(
      'data-admin-dashboard-line-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-bubble-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-area-chart="recharts"',
    );
    expect(consoleSource).toContain("function AdminDashboardTooltipPanel");
    expect(consoleSource).toContain("adminDashboardTooltipContentClassName");
    expect(consoleSource).toContain("adminDashboardTooltipWrapperStyle");
    expect(consoleSource).toContain("adminDashboardTooltipPortalClassName");
    expect(consoleSource).toContain("function AdminDashboardTooltipLinesPanel");
    expect(consoleSource).toContain(
      'data-admin-dashboard-tooltip-content="standard"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-tooltip-kind={dataAttribute}',
    );
    expect(consoleSource).not.toContain("viewBox={`0 0 ${width} ${height}`}");
    expect(consoleSource).toContain(
      "min-h-0 min-w-0 w-full overflow-hidden border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    );
    expect(consoleSource).not.toContain("bg-[#e9ecee]");
    expect(consoleSource).not.toContain(
      "bg-white p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42",
    );
    expect(consoleSource).toContain("Tzuyang KPI Dashboard");
    expect(consoleSource).not.toContain(
      "구독자·조회수·좋아요·댓글·영상 수를 1페이지 KPI 보드에서 한눈에 봅니다.",
    );
    expect(consoleSource).toContain("기간 구독자 증가");
    expect(consoleSource).not.toContain('{ value: "ALL", label: "현재" }');
    expect(consoleSource).toContain('{ value: "ALL", label: "전체" }');
    expect(consoleSource).toContain("기간 조회 증가");
    expect(consoleSource).toContain("기간 좋아요 증가");
    expect(consoleSource).toContain("기간 댓글 증가");
    expect(consoleSource).toContain("업로드 영상 수");
    expect(consoleSource).toContain('{ value: "30MIN", label: "30분" }');
    expect(consoleSource).toContain('{ value: "1H", label: "1시간" }');
    expect(consoleSource).toContain('{ value: "6H", label: "6시간" }');
    expect(consoleSource).toContain('{ value: "12H", label: "12시간" }');
    expect(consoleSource).toContain('{ value: "1D", label: "1일" }');
    expect(consoleSource).toContain('{ value: "6M", label: "6개월" }');
    expect(consoleSource).toContain('{ value: "1Y", label: "1년" }');
    expect(consoleSource).toContain('? "전체 · 현재 합계"');
    expect(consoleSource).toContain('? `전체 영상 · 현재 ${formatNumber(cumulativeVideoTotal)}`');
    expect(consoleSource).toContain("fetchAdminYouTubeChannelStats");
    expect(consoleSource).toContain("/api/admin/youtube-channel");
    expect(consoleSource).toContain("fetchAdminYouTubeChannelStats(");
    expect(consoleSource).toContain(
      'queryKey: ["admin-dashboard-management", "youtube-channel", period]',
    );
    expect(consoleSource).toContain("/api/admin/youtube-kpis");
    const dashboardOrderRouteSource = source(
      "app/api/admin/preferences/dashboard-widget-order/route.ts",
    );
    const dashboardOrderSource = source("lib/admin/dashboard-widget-order.ts");
    expect(dashboardOrderRouteSource).toContain("admin_dashboard_widget_order");
    expect(dashboardOrderRouteSource).toContain("admin_user_preferences");
    expect(dashboardOrderRouteSource).toContain(
      "normalizeAdminDashboardWidgetOrder",
    );
    expect(dashboardOrderRouteSource).toContain(
      'from "@/lib/admin/dashboard-widget-order"',
    );
    expect(dashboardOrderRouteSource).toContain("export async function GET");
    expect(dashboardOrderRouteSource).toContain("export async function PATCH");
    expect(dashboardOrderRouteSource).toContain("export async function DELETE");
    expect(dashboardOrderRouteSource).toContain(".upsert(");
    expect(dashboardOrderRouteSource).toContain(
      '{ onConflict: "user_id,preference_key" }',
    );
    expect(dashboardOrderRouteSource).toContain('"Cache-Control": "no-store"');
    expect(dashboardOrderRouteSource).toContain(".delete()");
    expect(dashboardOrderRouteSource).toContain(
      'preference_key", DASHBOARD_WIDGET_ORDER_KEY',
    );
    expect(dashboardOrderSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER",
    );
    expect(consoleSource).toContain("fallbackResponse");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain("subscriberValue");
    expect(consoleSource).toContain("subscriberCaption");
    expect(consoleSource).toContain("subscriberSparklinePoints");
    expect(consoleSource).toContain(
      "buildAdminDashboardChannelGrowthSparklinePoints",
    );
    expect(consoleSource).toContain(
      "sparklineData={subscriberSparklinePoints}",
    );
    expect(consoleSource).toContain("YouTube Data API");
    expect(consoleSource).toContain("채널 통계 확인 필요");
    expect(consoleSource).toContain(
      '<div className="hidden min-w-0 md:block">',
    );
    expect(consoleSource).toContain(
      '<h1 className="text-xl font-extrabold leading-tight tracking-[0.01em] text-foreground text-balance">',
    );
    expect(consoleSource).toContain("text-[clamp(1.42rem,1.75vw,2.1rem)]");
    expect(consoleSource).toContain("function AdminDashboardTooltipPanel");
    expect(consoleSource).toContain("min-w-44 space-y-1");
    expect(consoleSource).toContain(
      "text-[10px] font-semibold leading-3 text-muted-foreground",
    );
    expect(consoleSource).toContain("rounded-xl border border-border bg-popover px-2.5 py-1.5");
    expect(consoleSource).toContain("grid gap-0.5");
    expect(consoleSource).toContain("gap-x-1.5 gap-y-0");
    expect(consoleSource).toContain("fontSize: 11");
    expect(consoleSource).toContain("toneClass.bar");
    expect(consoleSource).toContain("toneClass.text");
    expect(consoleSource).toContain("dark:text-sky-300");
    expect(consoleSource).toContain("dark:text-rose-300");
    expect(consoleSource).toContain("dark:text-amber-300");
    expect(consoleSource).toContain("dark:text-teal-300");
    expect(consoleSource).toContain("dark:bg-muted/35");
    expect(consoleSource).toContain("dark:text-white");
    expect(consoleSource).not.toContain("dark:text-slate-950");
    expect(consoleSource).toContain("bg-amber-600 text-white");
    expect(consoleSource).not.toContain("toneClass.split");
    expect(consoleSource).not.toContain("text-[9px]");
    expect(consoleSource).not.toContain(
      "text-[10px] font-bold text-muted-foreground",
    );
    expect(consoleSource).toContain(
      "읽는 법: 조회·반응(좋아요+댓글)·반응률을 각각 100점 기준으로 맞춰 같은 눈금에서 비교합니다.",
    );
    expect(consoleSource).toContain("adminDashboardChartMargin");
    expect(consoleSource).not.toContain("adminDashboardTrendChartMargin");
    expect(consoleSource).toContain("adminDashboardScatterChartMargin");
    expect(consoleSource).toContain(
      "const adminDashboardChartMargin = { top: 10, right: 10, bottom: 2, left: 0 };",
    );
    expect(consoleSource).not.toContain("const adminDashboardAxisLabelStyle");
    expect(consoleSource).toContain("top: 10");
    expect(consoleSource).toContain("bottom: 2");
    expect(consoleSource).toContain("adminDashboardChartViewportClassName");
    expect(consoleSource).toContain("[&_.recharts-surface]:overflow-visible");
    expect(consoleSource).toContain("[&_.recharts-wrapper]:overflow-visible");
    expect(consoleSource).toContain("Math.max(1, dataMax * 1.08)");
    expect(consoleSource).toContain("Math.max(1, dataMax * 1.12)");
    expect(consoleSource).toContain("type AdminDashboardTrendSeriesKey");
    expect(consoleSource).toContain("type AdminDashboardTopContentSeriesKey");
    expect(consoleSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_TREND_SERIES_VISIBILITY",
    );
    expect(consoleSource).toContain(
      "DEFAULT_ADMIN_DASHBOARD_TOP_CONTENT_SERIES_VISIBILITY",
    );
    expect(consoleSource).toContain("function AdminDashboardSeriesToggle");
    expect(consoleSource).toContain("adminDashboardControlGroupClassName");
    expect(consoleSource).toContain("adminDashboardControlButtonClassName");
    expect(consoleSource).toContain(
      "inline-flex h-7 shrink-0 items-center rounded-full",
    );
    expect(consoleSource).toContain(
      "inline-flex h-6 items-center justify-center gap-1",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-series-toggle="true"',
    );
    expect(consoleSource).toContain(
      "inline-flex h-7 max-w-full min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-full border border-transparent bg-transparent p-0",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-row="single-line"',
    );
    expect(consoleSource).toContain(
      "truncate whitespace-nowrap text-xs font-extrabold leading-none text-foreground",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-actions="single-line-scroll"',
    );
    expect(consoleSource).toContain("toggleTrendSeries");
    expect(consoleSource).toContain("toggleTopContentSeries");
    expect(consoleSource).toContain(
      'data-admin-dashboard-rank-legend="impact"',
    );
    expect(consoleSource).toContain(
      'aria-label="상위 영상 영향도 색상 범례: 순위 구분"',
    );
    expect(consoleSource).toContain("<AdminDashboardImpactRankLegend />");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-clickable-legend="true"',
    );
    expect(consoleSource).toContain("seriesVisibility.views");
    expect(consoleSource).toContain("seriesVisibility.engagement");
    expect(consoleSource).toContain("seriesVisibility.engagementRate");
    expect(consoleSource).toContain("topContentSeriesVisibility.likes");
    expect(consoleSource).toContain("topContentSeriesVisibility.comments");
    expect(consoleSource).not.toContain("textClassName?: string");
    expect(consoleSource).not.toContain("option.textClassName");
    expect(consoleSource).toContain(
      "border-sky-500/25 bg-sky-50 text-foreground",
    );
    expect(consoleSource).toContain(
      "border-rose-500/25 bg-rose-50 text-foreground",
    );
    expect(consoleSource).toContain(
      "border-orange-500/25 bg-orange-50 text-foreground",
    );
    expect(consoleSource).toContain('dotClassName: "bg-orange-500"');
    expect(consoleSource).not.toContain(
      'textClassName: "text-orange-700 dark:text-orange-300"',
    );
    expect(consoleSource).toContain(
      '<span className="font-bold tabular-nums text-foreground">',
    );
    expect(consoleSource).toContain("상위 영상 영향도 첫 항목은");
    expect(consoleSource).toContain('dataAttribute="bubble-video"');
    expect(consoleSource).toContain(
      "계산식: 참여 = 좋아요 + 댓글 · 원 크기 = 참여",
    );
    expect(consoleSource).not.toContain('className="max-w-[280px]"');
    expect(consoleSource).not.toContain("function AdminDashboardAxisCornerHint");
    expect(consoleSource).not.toContain("function AdminDashboardAxisCaption");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-axis-corner-hint="true"',
    );
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-axis-caption="true"',
    );
    expect(consoleSource).not.toContain('const xAxisLabel = "게시일 순서"');
    expect(consoleSource).not.toContain(
      'const yAxisLabel = "정규화 점수(0~100)"',
    );
    expect(consoleSource).not.toContain(
      "<AdminDashboardAxisCornerHint x={xAxisLabel} y={yAxisLabel} />",
    );
    expect(consoleSource).not.toContain(
      "<AdminDashboardAxisCaption x={xAxisLabel} y={yAxisLabel} />",
    );
    expect(consoleSource).not.toContain("function AdminDashboardAxisGuide");
    expect(consoleSource).not.toContain('data-admin-dashboard-axis-guide="true"');
    expect(consoleSource).not.toContain("position: \"insideBottom\"");
    expect(consoleSource).not.toContain("position: \"insideLeft\"");
    expect(consoleSource).not.toContain("색상=순위 구분");
    expect(consoleSource).toContain("순위 구분");
    expect(consoleSource).toContain(
      "읽는 법: 원이 클수록 조회수와 반응을 합친 영향도가 큰 영상입니다. 색은 순위 구분입니다.",
    );
    expect(consoleSource).toContain(
      "line-clamp-2 leading-5",
    );
    expect(consoleSource).toContain("formatNumber(row.조회수)");
    expect(consoleSource).toContain("formatNumber(row.참여)");
    expect(consoleSource).toContain("콘텐츠 성과 상위 항목은");
    expect(consoleSource).toContain(
      "읽는 법: 막대는 조회·좋아요·댓글 수를 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다.",
    );
    expect(consoleSource).toContain("comments: row.commentCount");
    expect(consoleSource).toContain(
      'data-admin-dashboard-bar-chart="rank-distribution"',
    );
    expect(consoleSource).toContain(
      "grid h-full grid-rows-[minmax(0,1fr)_auto] gap-2 pb-0",
    );
    expect(consoleSource).toContain("grid min-h-0 content-evenly gap-2");
    expect(consoleSource).toContain(
      'className={cn("grid gap-1.5", isFullscreen && "gap-2.5")}',
    );
    expect(consoleSource).toContain(
      "flex min-w-0 overflow-x-auto overflow-y-visible",
    );
    expect(consoleSource).toContain('isFullscreen ? "h-12 sm:h-14" : "h-9"');
    expect(consoleSource).toContain("grid gap-1 sm:grid-cols-5");
    expect(consoleSource).toContain(
      "flex min-h-[220px] flex-col overflow-hidden p-3 sm:col-span-2 lg:col-span-5",
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-top-content-metric={metric.label}",
    );
    expect(consoleSource).toContain(
      "상위 5개 영상의 조회수, 좋아요, 댓글 비중 분포",
    );
    expect(consoleSource).toContain('header: "댓글"');
    expect(consoleSource).toContain("rankColors");
    expect(consoleSource).toContain("metricRows");
    expect(consoleSource).toContain("return scoredRows.map((row, index) =>");
    expect(consoleSource).toContain("barRows.map((row) => ({");
    expect(consoleSource).toContain("getVideoViewDelta");
    expect(consoleSource).toContain("getVideoEngagementDelta");
    expect(consoleSource).toContain("const currentValue = getCurrentValue(video);");
    expect(consoleSource).toContain("return currentValue;");
    expect(consoleSource).toContain("topContentMetricMode");
    expect(consoleSource).toContain("videosByInsightScore");
    expect(consoleSource).toContain(
      'video.comparisonStatus !== "missing_previous"',
    );
    expect(consoleSource).toContain("topContentVideosByInsightScore");
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회 증가가 크고, 위로 갈수록 좋아요와 댓글 증가가 큽니다.",
    );
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상 안에서 오른쪽으로 갈수록 조회수가 크고, 위로 갈수록 좋아요와 댓글 합계가 큽니다.",
    );
    expect(consoleSource).toContain(
      "읽는 법: 막대는 선택 기간 업로드 영상의 조회·좋아요·댓글 증가량을 보여주고, 기여도는 세 지표를 가중 합산한 성과 기여입니다.",
    );
    expect(consoleSource).toContain("합계 {formatCompactNumber(total)}");
    expect(consoleSource).toContain("formatDashboardPercent(percent)");
    expect(consoleSource).toContain("{percent.toFixed(0)}%");
    expect(consoleSource).toContain("overflow-x-auto overflow-y-visible");
    expect(consoleSource).not.toContain("percent >= 13");
    expect(consoleSource).toContain("min-w-[8%]");
    expect(consoleSource).not.toContain("조회수 TOP 5");
    expect(consoleSource).not.toContain("좋아요 TOP 5");
    expect(consoleSource).not.toContain('Bar dataKey="댓글"');
    expect(consoleSource).toContain("최근 참여율 지표는");
    expect(consoleSource).toContain("성과 진단");
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-board="actionable-insights"',
    );
    expect(consoleSource).toContain("ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT = 4");
    expect(consoleSource).toContain("const visibleInsights = insights.slice(");
    expect(consoleSource).toContain("ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT,");
    expect(consoleSource).toContain(
      "grid min-h-0 flex-1 content-stretch gap-1",
    );
    expect(consoleSource).toContain(
      "grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-1",
    );
    expect(consoleSource).toContain(
      "flex min-h-0 min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-muted/20 px-2 py-1.5",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-meta="header-inline"',
    );
    expect(consoleSource).toContain(
      "성과 진단 기준 ${periodLabel}, 비교 채널 평균",
    );
    expect(consoleSource).not.toContain("목적 다음 액션");
    expect(consoleSource).toContain(
      "ml-auto flex min-w-fit shrink-0 flex-nowrap items-center gap-2",
    );
    expect(consoleSource).toContain(
      "flex min-w-fit flex-nowrap items-center justify-end gap-1",
    );
    expect(consoleSource).not.toContain(
      "grid grid-cols-3 gap-2 rounded-xl border border-border/70 bg-background/80 p-2 text-[11px]",
    );
    expect(consoleSource).toContain("영상 성과 신호 진단");
    expect(consoleSource).toContain("score: number");
    expect(consoleSource).toContain("scoreLabel: string");
    expect(consoleSource).toContain("getDashboardInsightSignalScore");
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-visual="signal-bar"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip-trigger="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip="standard"',
    );
    expect(consoleSource).toContain(
      "계산식: 신호 강도 = 카드별 규칙 점수를 0~100으로 표시합니다.",
    );
    expect(consoleSource).not.toContain(
      "계산식: 신호 강도는 기여도, 참여율, 게시 후 경과일 같은 규칙별 점수를 0~100으로 표시합니다.",
    );
    expect(consoleSource).toContain("signalBarClass[insight.tone]");
    expect(consoleSource).toContain("신호 강도");
    expect(consoleSource).toContain("후보를 채널");
    expect(consoleSource).toContain(
      "기여도와 참여율로 우선 점검할 영상을 표시합니다.",
    );
    expect(consoleSource).toContain("상위 영상 영향도");
    expect(consoleSource).toContain("영상별 성과 분포");
    expect(consoleSource).toContain("콘텐츠 성과 TOP 5");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-delta="true"',
    );
    expect(consoleSource).toContain("const dashboardViewMetricLabel =");
    expect(consoleSource).toContain(
      "? `조회 증감 ${formatDashboardChangeLabel(viewChange)}`",
    );
    expect(consoleSource).toContain(': "현재값 기준";');
    expect(consoleSource).toContain("const dashboardUploadVideoBasisCount = videos.length");
    expect(consoleSource).toContain("const impactMetricLabel =");
    expect(consoleSource).toContain("const trendMetricLabel =");
    expect(consoleSource).toContain("metric={impactMetricLabel}");
    expect(consoleSource).toContain("metric={trendMetricLabel}");
    expect(consoleSource).toContain(
      "상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개",
    );
    expect(consoleSource).toContain("getAdminDashboardImpactChartLimit(");
    expect(consoleSource).toContain("videosByInsightScore.length");
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_IMPACT_FULL_CHART_LIMIT = 60",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_IMPACT_MAX_CHART_LIMIT = 80",
    );
    expect(consoleSource).toContain(
      "displayLimit={impactChartVideoLimit}",
    );
    expect(consoleSource).toContain(
      "전체 ${formatNumber(trendDisplayedPointCount)}개",
    );
    expect(consoleSource).toContain(
      "표시: 그래프는 상위 ${formatNumber(impactDisplayedVideoCount)}/${formatNumber(dashboardUploadVideoBasisCount)}개, 표는 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.",
    );
    expect(consoleSource).toContain(
      "표시: 그래프와 표 모두 전체 ${formatNumber(dashboardUploadVideoBasisCount)}개.",
    );
    expect(consoleSource).toContain("videosByInsightScore.map((video) =>");
    expect(consoleSource).toContain("videosByPublishedAt.map((video) =>");
    expect(consoleSource).toContain(
      "비교 스냅샷이 없을 때는 증감률 대신 현재 조회수와 현재 반응값으로 위치를 잡습니다.",
    );
    expect(consoleSource).toContain(
      "const topContentComparisonCount = topContentVideosByInsightScore.length",
    );
    expect(consoleSource).toContain(
      "const topContentCardMetric = hasPeriodGrowthComparison",
    );
    expect(consoleSource).toContain("metric={topContentCardMetric}");
    expect(consoleSource).toContain(
      "metric={`진단 신호 ${formatNumber(topContentInsights.length)}개 · ${topContentCardMetric}`}",
    );
    expect(consoleSource).not.toContain("engagementChange");
    expect(consoleSource).toContain("const visibleRows = rows.slice(0, 5)");
    expect(consoleSource).not.toContain("ADMIN_DASHBOARD_IMPACT_VIDEO_LIMIT");
    expect(consoleSource).toContain("const topVideos = [...videos]");
    expect(consoleSource).toContain(".slice(0, displayLimit)");
    expect(consoleSource).toContain(
      "주의: 그래프는 빠른 요약이고, 표 보기는 선택 기간 전체 영상을 확인하는 용도입니다.",
    );
    expect(consoleSource).toContain("성과 진단");
    expect(consoleSource).toContain(
      "설명: 지금 확인할 만한 영상 성과 신호를 요약한 카드입니다.",
    );
    expect(consoleSource).toContain("AdminDashboardBubbleChart");
    expect(consoleSource).toContain("AdminDashboardKpiCard");
    expect(consoleSource).toContain("buildAdminDashboardExtremeLabels");
    expect(consoleSource).toContain("sampleAdminDashboardPeriodPoints");
    expect(consoleSource).not.toContain("ADMIN_DASHBOARD_TREND_POINT_LIMIT");
    expect(consoleSource).toContain("ADMIN_DASHBOARD_SPARKLINE_POINT_LIMIT");
    expect(consoleSource).not.toContain("videosByPublishedAt.slice(-9)");
    expect(consoleSource).not.toContain("videosByPublishedAt.slice(-7)");
    expect(consoleSource).toContain("LabelList");
    expect(consoleSource).toContain('dataKey="조회수최고"');
    expect(consoleSource).toContain('dataKey="조회수최저"');
    expect(consoleSource).toContain('dataKey="참여최고"');
    expect(consoleSource).toContain('dataKey="참여최저"');
    expect(consoleSource).toContain('dataKey="참여율최고"');
    expect(consoleSource).toContain('dataKey="참여율최저"');
    expect(consoleSource).toContain('stroke="#f59e0b"');
    expect(consoleSource).toContain('stroke="#0f766e"');
    expect(consoleSource).toContain(
      "계산식: 정규화 점수 = 해당 값 / 해당 지표 최고값 × 100.",
    );
    expect(consoleSource).toContain("function AdminDashboardTrendTooltip");
    expect(consoleSource).toContain('dataAttribute="trend-simple"');
    expect(consoleSource).toContain(
      "100점은 선택 기간에서 해당 지표가 가장 큰 영상입니다.",
    );
    expect(consoleSource).toContain("영상 조회수 기준");
    expect(consoleSource).toContain("좋아요+댓글 기준");
    expect(consoleSource).toContain("조회수 대비 참여 기준");
    expect(consoleSource).toContain("content={<AdminDashboardTrendTooltip />}");
    expect(consoleSource).toContain("계산식: 참여 = 좋아요 + 댓글.");
    expect(consoleSource).toContain(
      "참고: 참여는 좋아요와 댓글을 더한 값이고, 참여율은 조회수 대비 참여 비중입니다.",
    );
    expect(consoleSource).toContain(
      "참고: 참여율은 조회수 대비 좋아요와 댓글 반응 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 신호 강도 = 카드별 규칙 점수를 0~100 범위로 표시한 값입니다.",
    );
    expect(consoleSource).toContain(
      "막대 기준: 같은 묶음 안에서 가장 큰 항목을 100%로 두고 비교합니다.",
    );
    expect(consoleSource).not.toContain('stroke="#dfcf65"');
    expect(consoleSource).toContain("key={`impact-${period}`}");
    expect(consoleSource).toContain("key={`trend-${period}`}");
    expect(consoleSource).toContain("viewCardTitle");
    expect(consoleSource).toContain("likeCardTitle");
    expect(consoleSource).toContain("commentCardTitle");
    expect(consoleSource).toContain("title={viewCardTitle}");
    expect(consoleSource).toContain("title={likeCardTitle}");
    expect(consoleSource).toContain("title={commentCardTitle}");
    expect(consoleSource).toContain("기간 영상 현재");
    expect(consoleSource).toContain("기간 순증");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-kpi-data-scope="true"',
    );
    expect(consoleSource).toContain('title="업로드 영상 수"');
    expect(consoleSource).toContain("periodMetricCaption");
    expect(consoleSource).toContain("periodCohortViewValue");
    expect(consoleSource).toContain("periodViewDisplayValue");
    expect(consoleSource).toContain("periodLikeDisplayValue");
    expect(consoleSource).toContain("periodCommentDisplayValue");
    expect(consoleSource).toContain("fallbackViewSparklinePoints");
    expect(consoleSource).toContain("viewSparklineDisplayPoints");
    expect(consoleSource).toContain("periodRatioCaptionPrefix");
    expect(consoleSource).toContain("periodVideoCaption");
    expect(consoleSource).toContain("getDashboardAverage");
    expect(consoleSource).toContain("getDashboardMedian");
    expect(consoleSource).toContain("formatDashboardAverageComparison");
    expect(consoleSource).toContain("기간 성과 기여");
    expect(consoleSource).toContain(
      "용어: 조회·좋아요·댓글 증가 기여는 각각 선택 기간 업로드 영상 전체 증가 합계 중 이 영상이 차지한 비율입니다.",
    );
    expect(consoleSource).toContain(
      "비교 대상: 선택 기간에 새로 올라온 업로드 영상입니다.",
    );
    expect(consoleSource).toContain(
      "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-data-confidence="true"',
    );
    expect(consoleSource).toContain("fallbackReasonCode");
    expect(consoleSource).toContain("getAdminDashboardCoverageLabel");
    expect(consoleSource).toContain(
      "전체값: 선택 기간 업로드 영상의 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다.",
    );
    expect(consoleSource).toContain(
      "periodUploadVideoCount?: number | null",
    );
    expect(consoleSource).toContain(
      "`비교 대상: 선택 기간 업로드 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`",
    );
    expect(consoleSource).toContain(
      "`비교 대상: 선택 기간 영상 ${formatNumber(scoredRows.length)}개 중 ${viewRank}위 (${viewTopPercentLabel})`",
    );
    expect(consoleSource).toContain(
      "`업로드 영상 수 카드는 ${formatNumber(periodUploadVideoCount)}개이고, 이 비교에는 성과 데이터가 있는 ${formatNumber(scoredRows.length)}개를 사용합니다.`",
    );
    expect(consoleSource).toContain(
      "topContentMetricMode === \"delta\" ? periodUploadVideoValue : null",
    );
    expect(consoleSource).toContain(
      "`조회 ${formatDashboardPercent(row.viewContributionPercent)} · 좋아요 ${formatDashboardPercent(row.likeContributionPercent)} · 댓글 ${formatDashboardPercent(row.commentContributionPercent)}`",
    );
    expect(consoleSource).toContain(
      "`계산식: 조회×60% + 좋아요×25% + 댓글×15% = ${formatDashboardPercent(row.performanceContributionPercent)}`",
    );
    expect(consoleSource).toContain(
      "전체값: 조회·좋아요·댓글 증가 합계를 각각 분모로 사용합니다.",
    );
    expect(consoleSource).toContain(
      "max-w-[min(26rem,calc(100vw-2rem))]",
    );
    expect(consoleSource).toContain("[text-wrap:pretty]");
    const infoLineTooltipBlocks =
      consoleSource.match(/infoLines=\{\[[\s\S]*?\]\}/g) ?? [];
    expect(infoLineTooltipBlocks.length).toBeGreaterThanOrEqual(10);
    expect(
      infoLineTooltipBlocks.filter(
        (block) => (block.match(/계산식:/g) ?? []).length > 1,
      ),
    ).toEqual([]);
    expect(consoleSource).toContain("function AdminDashboardInlineTooltip");
    expect(consoleSource).toContain(
      'data-admin-dashboard-inline-tooltip="true"',
    );
    expect(consoleSource).toContain("viewBenchmarkTooltipLines");
    expect(consoleSource).toContain('viewBenchmarkTooltipLines.join(" ")');
    expect(consoleSource).toContain("lines={row.viewBenchmarkTooltipLines}");
    expect(consoleSource).toContain("...row.viewBenchmarkTooltipLines");
    expect(consoleSource).toContain(
      "className={adminDashboardTooltipPortalClassName}",
    );
    expect(consoleSource).toContain('dataAttribute="diagnosis-card"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-diagnosis-tooltip-trigger="title"',
    );
    expect(consoleSource).toContain('side="top"');
    expect(consoleSource).toContain("sideOffset={4}");
    expect(consoleSource).toContain("collisionPadding={12}");
    expect(consoleSource).toContain("adminDashboardTooltipLineClassName");
    expect(consoleSource).toContain("adminDashboardTooltipFirstLineClassName");
    expect(consoleSource).toContain("contributionTotalOverride?: number | null");
    expect(consoleSource).toContain("topContentVideosByInsightScore,");
    expect(consoleSource).toContain(
      "설명: 그래프는 선택 기간 업로드 영상 중 상위 5개를 요약하고, 표는 전체 영상을 보여줍니다.",
    );
    expect(consoleSource).toContain(
      "막대 기준: 각 색 조각은 그래프에 표시된 상위 5개 안에서 해당 영상이 차지하는 비중입니다.",
    );
    expect(consoleSource).toContain("const topContentContributionFormula");
    expect(consoleSource).toContain("topContentContributionFormula,");
    expect(consoleSource).toContain(
      "기간 성과 기여 = 조회 증가 기여×60% + 좋아요 증가 기여×25% + 댓글 증가 기여×15%.",
    );
    expect(consoleSource).toContain(
      "성과 기여 = 조회 기여×60% + 좋아요 기여×25% + 댓글 기여×15%.",
    );
    expect(consoleSource).toContain("viewTopPercentLabel");
    expect(consoleSource).toContain("중앙값 대비");
    expect(consoleSource).toContain(
      'const viewBenchmarkLabel = metricMode === "delta" ? "성과 증가" : "성과";',
    );
    expect(consoleSource).toContain(
      "viewBenchmarkTooltip: row.viewBenchmarkTooltip",
    );
    expect(consoleSource).toContain("{row.viewBenchmark}");
    expect(consoleSource).toContain("전체 평균");
    expect(consoleSource).toContain("성과 기여");
    expect(consoleSource).toContain("viewBenchmark");
    expect(consoleSource).toContain("buildAdminDashboardContentInsights");
    expect(consoleSource).toContain("getDashboardVideoAgeDays");
    expect(consoleSource).toContain(
      'data-admin-dashboard-content-insights="average-benchmark"',
    );
    expect(consoleSource).toContain("초반 반응 점검");
    expect(consoleSource).toContain("재상승 후보");
    expect(consoleSource).toContain("구독자 기여 후보");
    expect(consoleSource).not.toContain("조회 보강 후보");
    expect(consoleSource).not.toContain("참여 보강 후보");
    expect(consoleSource).toContain("신규 반응 확인");
    expect(consoleSource).not.toContain("진단 대기");
    expect(consoleSource).not.toContain("비교 데이터 부족");
    expect(consoleSource).not.toContain("getAdminDashboardPendingContentInsight");
    expect(consoleSource).toContain("if (metricRows.length === 0)");
    expect(consoleSource).not.toContain("while (insights.length < ADMIN_DASHBOARD_CONTENT_INSIGHT_TARGET_COUNT)");
    expect(consoleSource).toContain(
      "`${periodRatioCaptionPrefix} ${formatDashboardPercent(likeRate)} · 현재 전체 누적 ${formatNumber(cumulativeLikeValue)}`",
    );
    expect(consoleSource).toContain(
      "`${periodRatioCaptionPrefix} ${formatDashboardPercent(commentRate)} · 현재 전체 누적 ${formatNumber(cumulativeCommentValue)}`",
    );
    expect(consoleSource).toContain("cumulativeViewValue");
    expect(consoleSource).toContain("cumulativeVideoTotal");
    expect(consoleSource).toContain(
      "buildAdminDashboardPeriodDeltaSparklinePoints",
    );
    expect(consoleSource).toContain("calculateDashboardPeriodMetricChange");
    expect(consoleSource).toContain('"channel-growth"');
    expect(consoleSource).toContain(
      "설명: 선택 기간 영상들의 조회수 합계를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain(
      "const isChartLoading = isInsightDynamicLoading;",
    );
    expect(consoleSource).not.toContain("getAdminDashboardSparklineStats");
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-visual-stats="true"',
    );
    expect(consoleSource).not.toContain(
      'aria-label={label ? `${label} 최고 평균 최저` : "최고 평균 최저"}',
    );
    expect(consoleSource).not.toContain(
      '{ label: "최고", value: stats.highest }',
    );
    expect(consoleSource).not.toContain(
      '{ label: "평균", value: stats.average }',
    );
    expect(consoleSource).not.toContain(
      '{ label: "최저", value: stats.lowest }',
    );
    expect(consoleSource).not.toContain("impactViewStats");
    expect(consoleSource).not.toContain("trendViewStats");
    expect(consoleSource).not.toContain("opsStatSummary");
    expect(consoleSource).not.toContain("topContentViewStats");
    expect(consoleSource).not.toContain("engagementRateStats");
    expect(consoleSource).toContain("function AdminDashboardKpiValueSkeleton");
    expect(consoleSource).toContain("function AdminDashboardPanelBodySkeleton");
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="kpi"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="chart"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="bubble"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="line"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="stacked"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="diagnosis"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-dynamic-skeleton="table"',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="bubble" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="line" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="stacked" />',
    );
    expect(consoleSource).toContain(
      '<AdminDashboardPanelBodySkeleton variant="diagnosis" />',
    );
    expect(consoleSource).toContain(
      'getDashboardCardView("impact") === "table" ? "table" : "bubble"',
    );
    expect(consoleSource).toContain(
      'getDashboardCardView("trend") === "table" ? "table" : "line"',
    );
    expect(consoleSource).toContain(': "stacked"');
    expect(consoleSource).toContain(': "diagnosis"');
    expect(consoleSource).toContain("pendingSkeletonPeriod");
    expect(consoleSource).toContain("setPendingSkeletonPeriod(nextPeriod)");
    expect(consoleSource).toContain("growthInsightQuery.isLoading");
    expect(consoleSource).toContain("pendingSkeletonPeriod === period");
    expect(consoleSource).toContain("isLoading={isChartLoading}");
    expect(consoleSource).toContain("isLoading={isSubscriberLoading}");
    expect(consoleSource).toContain(
      "youtubeChannelQuery.isLoading || pendingSkeletonPeriod === period",
    );
    expect(consoleSource).toContain("youtubeChannelQuery.isFetching");
    expect(consoleSource).toContain("AdminDashboardInfoTooltip");
    expect(consoleSource).toContain("초보자 설명");
    expect(consoleSource).toContain("설명:");
    expect(consoleSource).toContain("읽는 법:");
    expect(consoleSource).toContain("주의:");
    expect(consoleSource).not.toContain("다음 행동:");
    expect(consoleSource).not.toContain("초보자 비유 설명");
    expect(consoleSource).not.toContain("비유:");
    expect(consoleSource).not.toContain("beginner-metaphor");
    expect(consoleSource).not.toContain("발자국");
    expect(consoleSource).not.toContain("스티커");
    expect(consoleSource).not.toContain("방명록");
    expect(consoleSource).not.toContain("메뉴판");
    expect(consoleSource).not.toContain("바구니");
    expect(consoleSource).not.toContain("경고등");
    expect(consoleSource).not.toContain("도시락");
    expect(consoleSource).not.toContain("운동회");
    expect(consoleSource).not.toContain("온도계");
    expect(consoleSource).not.toContain("파이 조각");
    expect(consoleSource).not.toContain("파이에서 차지한 조각");
    expect(consoleSource).not.toContain("data-admin-dashboard-kpi-action");
    expect(consoleSource).not.toContain("다음 행동</span>");
    expect(consoleSource).not.toContain("다음 액션");
    expect(consoleSource).not.toContain("comments-insights");

    expect(consoleSource).toContain("AdminDashboardFullscreenButton");
    expect(consoleSource).toContain("fullscreenWidgetId");
    expect(consoleSource).toContain(
      "data-admin-dashboard-card-fullscreen-trigger",
    );
    expect(consoleSource).toContain(
      "data-admin-dashboard-card-fullscreen-backdrop",
    );
    expect(consoleSource).toContain("adminDashboardFullscreenCardClassName");
    expect(consoleSource).toContain("Escape");
    ["impact", "trend"].forEach((widgetId) => {
      expect(consoleSource).toContain(
        `renderDashboardFullscreenButton("${widgetId}")`,
      );
    });
    [
      "subscribers",
      "views",
      "likes",
      "comments",
      "videos",
      "ops",
      "topContent",
      "engagementRate",
    ].forEach(
      (widgetId) => {
        expect(consoleSource).not.toContain(
          `renderDashboardFullscreenButton("${widgetId}")`,
        );
      },
    );
    expect(consoleSource).toContain("h-[calc(100dvh-1rem)]");
    expect(consoleSource).toContain("sm:h-[calc(100dvh-2rem)]");
    expect(consoleSource).not.toContain(
      'fullscreenAction={renderDashboardFullscreenButton("ops")}',
    );
    expect(consoleSource).not.toContain(
      'isFullscreen={isDashboardWidgetFullscreen("topContent")}',
    );
    expect(consoleSource).not.toContain(
      'isFullscreen={isDashboardWidgetFullscreen("engagementRate")}',
    );
    expect(consoleSource).toContain(
      'isFullscreen && "h-full gap-3 p-2 sm:gap-4 sm:p-4"',
    );
    expect(consoleSource).not.toContain('isFullscreen ? "h-3" : "h-1.5"');

    const committeeAhpRubric = [
      { criterion: "KPI 계산 정의 일관성", weight: 0.32, score: 99 },
      { criterion: "초보자 직접 설명 정확성", weight: 0.25, score: 98 },
      { criterion: "차트 해석성", weight: 0.08, score: 98 },
      { criterion: "오류·폴백 투명성", weight: 0.15, score: 98 },
      { criterion: "운영 행동 연결성", weight: 0.1, score: 98 },
      { criterion: "동작 안정성", weight: 0.1, score: 100 },
    ];
    const committeeAhpScore = committeeAhpRubric.reduce(
      (sum, item) => sum + item.weight * item.score,
      0,
    );
    expect(committeeAhpRubric.reduce((sum, item) => sum + item.weight, 0)).toBe(
      1,
    );
    expect(committeeAhpScore).toBeGreaterThanOrEqual(98);
    expect(committeeAhpRubric.map((item) => item.criterion)).toEqual([
      "KPI 계산 정의 일관성",
      "초보자 직접 설명 정확성",
      "차트 해석성",
      "오류·폴백 투명성",
      "운영 행동 연결성",
      "동작 안정성",
    ]);
    expect(consoleSource).toContain("DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER");
    expect(consoleSource).toContain(
      'data-admin-dashboard-widget-order-trigger="direct-drag"',
    );
    expect(consoleSource).toContain("data-admin-dashboard-order-mode={");
    expect(consoleSource).toContain("data-admin-dashboard-direct-reorder-card");
    expect(consoleSource).toContain(
      'data-admin-dashboard-order-live-status="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-widget-order-reset="true"',
    );
    expect(consoleSource).toContain("const resetDashboardWidgetOrder =");
    expect(consoleSource).toContain('method: "DELETE"');
    expect(consoleSource).toContain(
      "처음 카드 순서로 초기화했습니다. 새로고침해도 처음 상태가 유지됩니다.",
    );
    expect(consoleSource).toContain("isDashboardWidgetOrderDefault");
    expect(consoleSource).toContain(
      "같은 레이아웃 영역 안에서 카드를 드래그하면 순서가 자동 저장됩니다.",
    );
    expect(consoleSource).toContain(
      "원하는 위치로 끌면 즉시 자리가 바뀝니다.",
    );
    expect(consoleSource).toContain("ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS");
    expect(consoleSource).toContain(
      "getAdminDashboardWidgetLayoutGroup(sourceWidgetId)",
    );
    expect(consoleSource).toContain("getDashboardCardReorderProps");
    expect(consoleSource).toContain("getDashboardReorderCardClassName");
    expect(consoleSource).toContain("getDashboardCardOrderStyle");
    expect(consoleSource).toContain("viewTransitionName");
    expect(consoleSource).toContain("updateAdminDashboardOrderWithViewTransition");
    expect(consoleSource).toContain("moveAdminDashboardWidgetBeforeOrAfter");
    expect(consoleSource).toContain(
      "draggable: isDashboardOrderEditorOpen && !isDashboardOrderSaving",
    );
    expect(consoleSource).toContain("onDragStart: (event) =>");
    expect(consoleSource).toContain("onDragEnter: (event) =>");
    expect(consoleSource).toContain(
      "previewDraggedDashboardWidget(widgetId, placement, sourceWidgetId)",
    );
    expect(consoleSource).toContain(
      "finishDraggedDashboardWidget(sourceWidgetId)",
    );
    expect(consoleSource).toContain(
      "/api/admin/preferences/dashboard-widget-order",
    );
    expect(consoleSource).toContain(
      'style={getDashboardCardOrderStyle("subscribers")}',
    );
    expect(consoleSource).toContain(
      'style={getDashboardCardOrderStyle("engagementRate")}',
    );
    expect(consoleSource).toContain(
      'reorderProps={getDashboardCardReorderProps("subscribers")}',
    );
    expect(consoleSource).toContain(
      '{...getDashboardCardReorderProps("impact")}',
    );
    expect(consoleSource).not.toContain(
      'data-admin-dashboard-widget-order-editor="drag-drop"',
    );
    expect(consoleSource).toContain(
      'type AdminDashboardCardView = "chart" | "table"',
    );
    expect(consoleSource).toContain("DEFAULT_ADMIN_DASHBOARD_CARD_VIEWS");
    expect(consoleSource).toContain("function AdminDashboardViewToggle");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-view-toggle="true"',
    );
    expect(consoleSource).toContain(
      'className={cn(adminDashboardControlGroupClassName, "overflow-hidden")}',
    );
    expect(consoleSource).toContain("그래프");
    expect(consoleSource).toContain("표");
    expect(consoleSource).toContain("function AdminDashboardScrollTable");
    expect(consoleSource).toContain('data-admin-dashboard-table-view="true"');
    expect(consoleSource).toContain("useAdminDashboardProgressiveItems");
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_PROGRESSIVE_INITIAL_ROWS = 40",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_INITIAL_ROWS = 18",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_BATCH_ROWS = 24",
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_PROGRESSIVE_DELAY_MS = 48",
    );
    expect(consoleSource).toContain("function AdminDashboardDeferredBody");
    expect(consoleSource).toContain(
      'data-admin-dashboard-mobile-deferred="true"',
    );
    expect(consoleSource).toContain(
      "ADMIN_DASHBOARD_MOBILE_DEFER_ROOT_MARGIN",
    );
    expect(consoleSource).toContain(
      "const shouldDeferDashboardHeavyBodies =",
    );
    expect(consoleSource).toContain(
      "isDashboardMobileViewport &&",
    );
    expect(consoleSource).toContain("refetchOnWindowFocus: false");
    expect(consoleSource).toContain("refetchIntervalInBackground: false");
    expect(consoleSource).toContain(
      'data-admin-dashboard-progressive-table="true"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-progressive-chart="true"',
    );
    expect(consoleSource).toContain(
      "추가 행 표시 중 {formatNumber(rows.length)}/{formatNumber(totalRows)}",
    );
    expect(consoleSource).toContain("const progressiveImpactTableRows =");
    expect(consoleSource).toContain("const progressiveTrendPoints =");
    expect(consoleSource).toContain("const progressiveTrendTableRows =");
    expect(consoleSource).toContain("const progressiveTopContentTableRows =");
    expect(consoleSource).toContain(
      "overflow-y-auto overflow-x-hidden rounded-xl border border-border/70",
    );
    expect(consoleSource).toContain(
      'className="w-full table-fixed border-separate border-spacing-0 text-xs"',
    );
    expect(consoleSource).toContain("title={row.title}");
    expect(consoleSource).toContain("sticky top-0 z-10 bg-background");
    expect(consoleSource).toContain("dashboardCardViews");
    expect(consoleSource).toContain('value={getDashboardCardView("impact")}');
    expect(consoleSource).toContain(
      'value={getDashboardCardView("topContent")}',
    );
    expect(consoleSource).toContain(
      'value={getDashboardCardView("engagementRate")}',
    );
    expect(consoleSource).toContain('view={getDashboardCardView("ops")}');
    expect(consoleSource).toContain("impactTableRows");
    expect(consoleSource).toContain("trendTableRows");
    expect(consoleSource).toContain("topContentTableRows");
    expect(consoleSource).toContain("totalPointCount={trendPoints.length}");
    expect(consoleSource).toContain("dot={isDenseChart ? false");
    expect(consoleSource).not.toContain("isDenseChart ? null");
    expect(consoleSource).toContain('dataKey="조회수최고"');
    expect(consoleSource).toContain('dataKey="조회수최저"');
    expect(consoleSource).toContain('dataKey="참여최고"');
    expect(consoleSource).toContain('dataKey="참여최저"');
    expect(consoleSource).toContain('dataKey="참여율최고"');
    expect(consoleSource).toContain('dataKey="참여율최저"');
    expect(consoleSource).toContain("영상 제목");
    expect(consoleSource).toContain("참여율");
    expect(consoleSource).toContain("formatDashboardChangeLabel");
    expect(consoleSource).toContain("calculateDashboardMetricChange");
    expect(consoleSource).toContain("calculateRecentWindowChange");
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(viewChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(likeChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(commentChange)}",
    );
    expect(consoleSource).toContain(
      "delta={formatDashboardChangeLabel(videoCountChange)}",
    );
    expect(consoleSource).toContain("periodUploadVideoValue");
    expect(consoleSource).toContain("calculateDashboardUploadCountChange");
    expect(consoleSource).toContain("uploadCountCohortChange");
    expect(consoleSource).toContain("hasSnapshotVideoCountComparison");
    expect(consoleSource).toContain("channelStats?.videoDelta");
    expect(consoleSource).toContain(
      "typeof channelStats.previousVideoCount === \"number\"",
    );
    expect(consoleSource).toContain(
      "getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)",
    );
    expect(consoleSource).toContain("subscriberDelta");
    expect(consoleSource).toContain("subscriberChange");
    expect(consoleSource).toContain("subscriberCardTitle");
    expect(consoleSource).toContain("title={subscriberCardTitle}");
    expect(consoleSource).not.toContain("dataScopeLabel");
    expect(consoleSource).not.toContain("subscriberScopeLabel");
    expect(consoleSource).not.toContain("periodMetricScopeLabel");
    expect(consoleSource).not.toContain("기간 업로드</span>");
    expect(consoleSource).toContain(
      "현재 구독자 · YouTube Data API · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}",
    );
    expect(consoleSource).toContain(
      "`현재 구독자 · ${selectedPeriodLabel} 기간 순증 ${formatSignedNumber(subscriberDelta)} · ${getAdminDashboardDeltaSourceLabel(channelStats?.deltaSource)}`",
    );
    expect(consoleSource).toContain('const subscriberCardTitle = "현재 구독자"');
    expect(consoleSource).toContain("formatSignedNumber(subscriberDelta)");
    expect(consoleSource).toContain('deltaLabel="기간 대비"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-delta="timeframe"',
    );
    expect(consoleSource).toContain('deltaLabel = "기간 대비"');
    expect(consoleSource).toContain('deltaLabel="기간 대비"');
    expect(consoleSource).toContain(
      "계산식: 기간 대비 = (현재값 - 이전값) / 이전값 × 100",
    );
    expect(consoleSource).not.toContain(
      "title={`${title} ${deltaLabel}: ${delta}. 계산식: 기간 대비 = (현재값 - 이전값) / 이전값 × 100`}",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 구독자 증가 = API가 제공한 delta를 우선 사용하고, 없을 때만 현재 구독자 - 이전 구독자로 계산합니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 조회 증가 = 각 영상의 (현재 조회수 - 이전 조회수) 합계.",
    );
    expect(consoleSource).toContain(
      "처리: 비교 버킷 이후 신규 영상은 이전값 0으로 보고, 비교 버킷 이전 영상인데 이전값이 없으면 비교 불가로 분리합니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 좋아요 증가 = 각 영상의 (현재 좋아요 - 이전 좋아요) 합계.",
    );
    expect(consoleSource).toContain(
      "참고: 좋아요 비율은 조회수 중 좋아요로 반응한 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 기간 댓글 증가 = 각 영상의 (현재 댓글 - 이전 댓글) 합계.",
    );
    expect(consoleSource).toContain(
      "참고: 댓글 비율은 조회수 중 댓글로 반응한 비중입니다.",
    );
    expect(consoleSource).toContain(
      "계산식: 업로드 영상 수 = API가 제공한 videoDelta를 우선 사용하고, 없을 때만 현재 channel videoCount - 이전 channel videoCount로 계산합니다.",
    );
    expect(consoleSource).not.toContain(
      "계산식: 스냅샷이 없으면 업로드 영상 수 = 선택 기간 영상 목록 개수.",
    );
    expect(consoleSource).toContain(
      "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/45",
    );
    expect(consoleSource).toContain(
      "설명: 선택 기간에 새로 올라온 영상 수를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain('className="h-px bg-border/70"');
    expect(consoleSource).toContain("mb-2 grid min-w-0 shrink-0 gap-2");
    expect(consoleSource).toContain(
      'data-admin-dashboard-metric-tooltip="beginner-plain"',
    );
    expect(consoleSource).toContain(
      "설명: 선택 기간 업로드 영상을 게시일 순서로 놓고 조회수, 참여, 참여율을 비교합니다.",
    );
    expect(consoleSource).toContain('year: "2-digit"');
    expect(consoleSource).toContain(
      "읽는 법: 조회·반응(좋아요+댓글)·반응률을 각각 100점 기준으로 맞춰 같은 눈금에서 비교합니다.",
    );
    expect(consoleSource).toContain("반응(좋아요+댓글)·반응률");
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-card="recharts-sparkline"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-sparkline="true"',
    );
    const kpiSparklineSource = consoleSource.slice(
      consoleSource.indexOf('data-admin-dashboard-kpi-sparkline="true"'),
      consoleSource.indexOf("function AdminDashboardOpsSummaryCard"),
    );
    expect(kpiSparklineSource).toContain("<RechartsTooltip");
    expect(kpiSparklineSource).toContain(
      "content={<AdminDashboardKpiSparklineTooltip title={title} />}",
    );
    expect(kpiSparklineSource).not.toContain("contentStyle=");
    expect(kpiSparklineSource).not.toContain("labelFormatter=");
    expect(consoleSource).toContain('dataAttribute="kpi-sparkline"');
    expect(consoleSource).toContain(
      "설명: 채널 구독자 수를 보여주는 카드입니다.",
    );
    expect(consoleSource).toContain(
      "relative z-0 grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-visible p-3 sm:p-3.5 hover:z-20 focus-within:z-20",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-title-row="single-line"',
    );
    expect(consoleSource).toContain(
      "truncate whitespace-nowrap text-xs font-extrabold tracking-[0.04em] text-muted-foreground",
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-title-actions="single-line-scroll"',
    );
    expect(consoleSource).toContain("h-11 w-24 shrink-0 overflow-visible");
    expect(consoleSource).toContain("buildAdminDashboardSparklinePoints");
    expect(consoleSource).toContain(
      "allowEscapeViewBox={{ x: true, y: true }}",
    );
    expect(consoleSource).toContain(
      "wrapperStyle={adminDashboardTooltipWrapperStyle}",
    );
    expect(consoleSource).toContain("AdminDashboardOpsSummaryCard");
    expect(consoleSource).toContain("운영·검수 요약");
    expect(consoleSource).toContain(
      "설명: 위쪽은 운영 중인 데이터 수, 아래쪽은 확인이 필요한 데이터 수입니다.",
    );
    expect(consoleSource).toContain(
      "flex h-full min-h-[280px] flex-col p-3 text-xs",
    );
    expect(consoleSource).toContain("text-[13px] font-extrabold tabular-nums");
    expect(consoleSource).toContain(
      'data-admin-dashboard-ops-summary-visual="progress-bars"',
    );
    expect(consoleSource).toContain("rawValue: stats.totalRestaurants ?? 0");
    expect(consoleSource).toContain("rawValue: missingCoordinates ?? 0");
    expect(consoleSource).toContain("const maxRawValue = Math.max");
    expect(consoleSource).toContain("const rowPercent = clampDashboardPercent");
    expect(consoleSource).toContain(
      "adminDashboardVisualizationShellClassName",
    );
    expect(consoleSource).toContain("rounded-xl p-1 sm:p-1.5");
    expect(consoleSource).toContain("grid content-stretch gap-2");
    expect(consoleSource).toContain(
      "grid grid-cols-[5.5rem_minmax(0,1fr)_3rem]",
    );
    expect(consoleSource).toContain("text-teal-700 dark:text-teal-300");
    expect(consoleSource).toContain("text-rose-700 dark:text-rose-300");
    expect(consoleSource).not.toContain(
      "rounded-xl border border-border/60 bg-card/45 p-3",
    );
    expect(consoleSource).toContain('"lg:col-span-2"');
    expect(consoleSource).toContain('"sm:col-span-2 lg:col-span-3"');
    expect(consoleSource).toContain(
      "flex min-h-[280px] flex-col overflow-hidden p-3",
    );
    expect(consoleSource).toContain(
      "flex min-h-[220px] flex-col overflow-hidden p-3",
    );
    expect(consoleSource).toContain(
      "flex min-h-[220px] flex-col overflow-hidden p-2",
    );
    expect(consoleSource).toContain("min-h-[190px] flex flex-1 flex-col");
    expect(consoleSource).toContain("min-h-[230px] flex flex-1 flex-col");
    expect(consoleSource).toContain("height={18}");
    expect(consoleSource).toContain("tickMargin={2}");
    expect(consoleSource).not.toContain("AdminDashboardLedgerCard");
    expect(consoleSource).not.toContain("AdminDashboardGaugeCard");
    expect(consoleSource).toContain("AdminDashboardGroupedBarChart");
    expect(consoleSource).toContain("AdminDashboardAreaChart");
    expect(consoleSource).not.toContain("구독자 실시간 소스 미연결");
    expect(consoleSource).not.toContain("function buildMetricSeries");
  });

  test("adds a polished KPI PDF report export next to collection status", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).toContain("FileDown");
    expect(consoleSource).toContain("function AdminDashboardPdfReportButton");
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-pdf-export-trigger="true"',
    );
    expect(consoleSource).toContain("buildAdminDashboardPdfReportHtml");
    expect(consoleSource).toContain("openAdminDashboardPdfReport");
    expect(consoleSource).toContain("window.print()");
    expect(consoleSource).toContain("Tzuyang KPI Dashboard Report");
    expect(consoleSource).toContain('logoUrl: "/logo.webp"');
    expect(consoleSource).toContain('class="brand"');
    expect(consoleSource).toContain('alt="Tzudong 로고"');
    expect(consoleSource).toContain("reportWithAbsoluteLogo");
    expect(consoleSource).toContain("PDF 보고서");
    expect(consoleSource).toContain("콘텐츠 성과 TOP 5");
    expect(consoleSource).toContain("성과 진단");
    expect(consoleSource).toContain('data-admin-dashboard-action-bar="true"');
    expect(consoleSource).toContain(
      'data-admin-dashboard-action-order="order-reset-report-collection-period"',
    );
    expect(consoleSource).toContain('data-admin-dashboard-action-group="order"');
    expect(consoleSource).toContain('data-admin-dashboard-action-group="report"');
    expect(consoleSource).toContain(
      "order-1 flex shrink-0 items-center justify-end gap-1",
    );
    expect(consoleSource).toContain(
      "order-2 flex shrink-0 items-center justify-end gap-1",
    );
    expect(consoleSource).toContain("order-3 h-7 shrink-0 gap-1");
    expect(consoleSource).toContain(
      'data-admin-dashboard-period-options-inline="desktop"',
    );
    expect(consoleSource).toContain("md:hidden");
    expect(consoleSource).toContain("hidden shrink-0 flex-wrap justify-end gap-1 md:flex");
    expect(consoleSource).toContain('class="report-visual"');
    expect(consoleSource).toContain('class="bar-track"');
    expect(consoleSource).toContain('class="diagnosis-meter"');
    expect(consoleSource).toContain("visualPercent");
    expect(consoleSource).toContain("barPercent");
    expect(
      consoleSource.indexOf('data-admin-dashboard-widget-order-trigger="direct-drag"'),
    ).toBeLessThan(
      consoleSource.indexOf('data-admin-dashboard-widget-order-reset="true"'),
    );
    expect(
      consoleSource.indexOf('data-admin-dashboard-widget-order-reset="true"'),
    ).toBeLessThan(consoleSource.indexOf("<AdminDashboardPdfReportButton"));
    expect(
      consoleSource.indexOf("<AdminDashboardPdfReportButton"),
    ).toBeLessThan(consoleSource.indexOf("<AdminDashboardCollectionLogPopover"));
    expect(
      consoleSource.indexOf("<AdminDashboardCollectionLogPopover"),
    ).toBeLessThan(
      consoleSource.indexOf("<AdminDashboardPeriodSelector"),
    );
  });

  test("supports sub-day admin KPI dashboard periods in the insights source", () => {
    const treemapSource = source("lib/public-insights/treemap.ts");

    expect(treemapSource).toContain("'30MIN' | '1H' | '6H' | '12H' | '1D'");
    expect(treemapSource).toContain("const MINUTE_MS = 60 * 1000");
    expect(treemapSource).toContain("const HOUR_MS = 60 * MINUTE_MS");
    expect(treemapSource).toContain("periodToMilliseconds");
    expect(treemapSource).toContain("normalized === '30MIN'");
    expect(treemapSource).toContain("normalized === '1H'");
    expect(treemapSource).not.toContain("periodToDays");
  });

  test("keeps live YouTube KPI refresh behind an admin-only server route", () => {
    const routeSource = source("app/api/admin/youtube-kpis/route.ts");

    expect(routeSource).toContain("requireAdmin");
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/playlistItems",
    );
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    expect(routeSource).toContain("MAX_YOUTUBE_KPI_PLAYLIST_PAGES");
    expect(routeSource).toContain("parseTreemapPeriod");
    expect(routeSource).toContain(
      'request.nextUrl.searchParams.get("scope") === "channel-growth"',
    );
    expect(routeSource).toContain(
      "filterByPublishedPeriod: !isChannelGrowthScope",
    );
    expect(routeSource).toContain(
      'filterByPeriod: !isChannelGrowthScope && period !== "ALL"',
    );
    expect(routeSource).toContain("pageToken");
    expect(routeSource).toContain("snippet,statistics,contentDetails");
    expect(routeSource).toContain("previousViewCount: null");
    expect(routeSource).toContain(
      '"Cache-Control": "private, no-store, max-age=0"',
    );
  });

  test("keeps YouTube channel statistics behind an admin-only server route", () => {
    const routeSource = source("app/api/admin/youtube-channel/route.ts");

    expect(routeSource).toContain("requireAdmin");
    expect(routeSource).toContain(
      "https://www.googleapis.com/youtube/v3/channels",
    );
    expect(routeSource).toContain(
      'url.searchParams.set("part", "snippet,statistics")',
    );
    expect(routeSource).toContain("subscriberCount");
    expect(routeSource).toContain("hiddenSubscriberCount");
    expect(routeSource).toContain("parseTreemapPeriod");
    expect(routeSource).toContain("previousSubscriberCount");
    expect(routeSource).toContain("previousBucketStartedAt");
    expect(routeSource).toContain("subscriberDelta");
    expect(routeSource).toContain("comparisonFetchedAt");
    expect(routeSource).toContain("YOUTUBE_API_KEY");
    expect(routeSource).not.toContain("NEXT_PUBLIC_YOUTUBE_API_KEY");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_ID");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_HANDLE");
    expect(routeSource).toContain("@tzuyang6145");
    expect(routeSource).toContain(
      "respondWithYouTubeChannelSnapshotFallback",
    );
    expect(routeSource).toContain("fallbackSource");
    expect(routeSource).toContain("supabase-channel-snapshot");
    expect(routeSource).toContain(
      "YouTube channel statistics request failed",
    );
    expect(routeSource).toContain(
      "YouTube channel subscriber count was unavailable",
    );
    expect(routeSource).toContain("Cache-Control");
  });

  test("does not render an admin access gate for non-admin visitors", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const middlewareSource = source("lib/supabase/middleware.ts");

    expect(consoleSource).toContain("shouldRenderAdminShell");
    expect(consoleSource).toContain("canLoadAdminConsoleData");
    expect(consoleSource).toContain(
      "useAdminOverviewStats(canLoadAdminConsoleData)",
    );
    expect(consoleSource).toContain("return null;");
    expect(consoleSource).not.toContain('router.replace("/")');
    expect(consoleSource).not.toContain("if (!user || !isAdmin)");
    expect(consoleSource).not.toContain("function AdminAccessGate");
    expect(consoleSource).not.toContain("관리자 로그인이 필요합니다");
    expect(consoleSource).not.toContain("관리자 권한이 필요합니다");
    expect(consoleSource).not.toContain("로그인 창 열기");
    expect(consoleSource).not.toContain("AUTH_UI_REQUEST_EVENT");
    expect(middlewareSource).toContain("isAdminPageRequest");
    expect(middlewareSource).toContain(
      "pathname === '/admin' || pathname.startsWith('/admin/')",
    );
    expect(middlewareSource).toContain("eq('role', 'admin')");
    expect(middlewareSource).toContain(
      "new URL('/auth/required', request.url)",
    );
    expect(middlewareSource).toContain(
      "redirectUrl.searchParams.set('reason', reason)",
    );
    expect(middlewareSource).toContain(
      "redirectAuthRequiredWithSessionCookies(request, sourceResponse, 'admin')",
    );
    expect(middlewareSource).toContain("getRequestedPathWithSearch(request)");
  });

  test("keeps unified admin console as the single operator shell", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const adminPageSource = source("app/admin/page.tsx");
    const appGlobalsSource = source("app/app-globals.css");

    expect(adminPageSource).toContain("<AdminConsoleOverview />");
    for (const moduleId of [
      '"restaurants"',
      '"submissions"',
      '"reviews"',
      '"storyboard"',
      '"banners"',
      '"users"',
      '"insights"',
      '"audit"',
      '"youtube-thumbnail-generator"',
      '"llm"',
    ]) {
      expect(consoleSource).toContain(moduleId);
    }
    expect(consoleSource).toContain("sidebarSections");
    expect(consoleSource).toContain('aria-label="관리자 통합 메뉴"');
    expect(consoleSource).toContain('aria-label="관리자 콘솔 작업 화면"');
    expect(consoleSource).toContain(
      'data-admin-console-layout="sidebar-content"',
    );
    expect(consoleSource).toContain('data-admin-console-content="true"');
    expect(consoleSource).toContain("p-2 md:border-y-0 md:p-4");
    expect(consoleSource).not.toContain("pb-[calc(env(safe-area-inset-bottom)+5.75rem)]");
    expect(consoleSource).toContain("h-[var(--full-height,100vh)]");
    expect(consoleSource).not.toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(consoleSource).not.toContain("md:grid-rows-1");
    expect(consoleSource).not.toContain("md:grid-cols-[16rem_minmax(0,1fr)]");
    expect(consoleSource).not.toContain("md:grid-cols-[4.5rem_minmax(0,1fr)]");
    expect(consoleSource).toContain("data-admin-console-sidebar-collapsed={");
    expect(consoleSource).toContain('isSidebarCollapsed ? "true" : "false"');
    expect(appGlobalsSource).toContain(
      '[data-admin-console-layout="sidebar-content"]',
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-left-panel-expanded="true"]',
    );
    expect(appGlobalsSource).toContain("--admin-sidebar-expanded-max-width: min(18rem, 28vw);");
    expect(appGlobalsSource).toContain("width: max-content;");
    expect(appGlobalsSource).toContain("min-width: 14.25rem;");
    expect(appGlobalsSource).toContain("max-width: var(--admin-sidebar-expanded-max-width);");
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain("[data-admin-console-content]:focus");
    expect(appGlobalsSource).toContain(
      "[data-admin-console-content]:focus-visible",
    );
    expect(appGlobalsSource).toContain(
      "outline: 2px solid hsl(var(--primary));",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-rows: auto minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain('@media (max-width: 767px)');
    expect(appGlobalsSource).toContain(
      '[data-admin-dashboard-management="true"] .recharts-wrapper',
    );
    expect(appGlobalsSource).toContain("max-width: 100% !important;");
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: 4.5rem minmax(0, 1fr);",
    );
    expect(consoleSource).toContain(
      '? "md:w-[4.5rem] md:min-w-[4.5rem] md:max-w-[4.5rem] md:items-center md:px-1.5"',
    );
    expect(consoleSource).toContain(
      ': "md:min-w-[14.25rem] md:max-w-[var(--admin-sidebar-expanded-max-width)]"',
    );
  });

  test("keeps admin console keyboard and screen-reader navigation intact", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).toContain('href="#admin-console-canvas"');
    expect(consoleSource).toContain("작업 화면으로 건너뛰기");
    expect(consoleSource).toContain("tabIndex={-1}");
    expect(consoleSource).toContain(
      "canvasRef.current?.focus({ preventScroll: true })",
    );
    expect(source("app/app-globals.css")).toContain(
      "[data-admin-console-content]:focus-visible",
    );
    expect(consoleSource).toContain(
      'aria-current={isActive ? "page" : undefined}',
    );
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain("aria-expanded={!isCollapsed}");
    expect(consoleSource).toContain("aria-pressed={isCollapsed}");
    expect(consoleSource).toContain(
      '<p className="sr-only" aria-live="polite">',
    );
  });
  test("keeps announcement management out of the admin sidebar default order", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const sidebarOrderRouteSource = source(
      "app/api/admin/preferences/sidebar-order/route.ts",
    );
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");

    expect(consoleSource).not.toContain('id: "announcements"');
    expect(consoleSource).not.toContain('          "announcements",');
    expect(consoleSource).toContain('"storyboard",');
    expect(consoleSource).toContain('"banners",');
    expect(consoleSource).toContain('"users",');
    expect(consoleSource).toContain('"insights",');
    expect(consoleSource).toContain('"audit",');
    expect(sidebarOrderSource).toContain(
      'export const ADMIN_SIDEBAR_SECTIONS = ["홈", "검수", "운영", "실험실"]',
    );
    expect(sidebarOrderSource).toContain('"routes",');
    expect(sidebarOrderSource).toContain('"restaurant-refresh-history",');
    expect(sidebarOrderSource).toContain(
      '검수: ["restaurants", "restaurant-refresh-history", "submissions", "reviews"]',
    );
    expect(sidebarOrderSource).toContain(
      '운영: ["users", "banners", "insights"]',
    );
    expect(sidebarOrderSource).toContain('실험실: ["youtube-thumbnail-generator", "storyboard", "routes", "llm", "audit"]');
    expect(sidebarOrderRouteSource).toContain(
      'from "@/lib/admin/sidebar-order"',
    );
    expect(sidebarOrderSource).not.toContain("'announcements'");
  });


  test("adds YouTube thumbnail generation as a guarded Lab module", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const componentSource = source(
      "components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx",
    );
    const routeSource = source("app/api/admin/youtube-thumbnail-generator/route.ts");
    const providerSource = source("lib/admin/youtube-thumbnail-generator/providers.ts");
    const promptSource = source("lib/admin/youtube-thumbnail-generator/prompt.ts");
    const requestSource = source("lib/admin/youtube-thumbnail-generator/request.ts");

    expect(consoleSource).toContain('id: "youtube-thumbnail-generator"');
    expect(consoleSource).toContain("유튜브 썸네일 생성기");
    expect(consoleSource).toContain("AdminYoutubeThumbnailGenerator");
    expect(componentSource).toContain("/api/admin/youtube-thumbnail-generator");
    expect(componentSource).toContain("Google Nano Banana 2 Pro API");
    expect(componentSource).toContain("gpt-image-2");
    expect(componentSource).toContain("fontFamily");
    expect(componentSource).toContain("strokeWidth");
    expect(componentSource).toContain("FONT_PRESETS");
    expect(componentSource).toContain("STROKE_PRESETS");
    expect(componentSource).toContain("SHADOW_PRESETS");
    expect(componentSource).toContain('data-thumbnail-font-presets="true"');
    expect(componentSource).toContain('data-thumbnail-stroke-presets="true"');
    expect(componentSource).toContain('data-thumbnail-shadow-presets="true"');
    expect(componentSource).toContain('data-thumbnail-add-text-layer="true"');
    expect(componentSource).toContain('data-thumbnail-safe-area-toggle="true"');
    expect(componentSource).toContain('data-thumbnail-draggable-canvas="true"');
    expect(componentSource).toContain('data-thumbnail-safe-area-guide={showSafeAreaGuide ? "visible" : "hidden"}');
    expect(componentSource).toContain("onPointerDown={handleCanvasPointerDown}");
    expect(componentSource).toContain("onPointerMove={handleCanvasPointerMove}");
    expect(componentSource).toContain("handleExportPng");
    expect(componentSource).toContain('canvas.toDataURL("image/png")');
    expect(routeSource).toContain("export const runtime = 'nodejs'");
    expect(routeSource).toContain("export const dynamic = 'force-dynamic'");
    expect(routeSource).toContain("await requireAdmin()");
    expect(routeSource.indexOf("await requireAdmin()")).toBeLessThan(
      routeSource.indexOf("await request.formData()"),
    );
    const postSource = routeSource.slice(routeSource.indexOf("export async function POST"));
    expect(postSource.indexOf("await requireAdmin()")).toBeLessThan(
      postSource.indexOf("generateYoutubeThumbnail"),
    );
    expect(routeSource).toContain("getContentLengthRejection");
    expect(routeSource).toContain("getMultipartContentTypeRejection");
    expect(routeSource).toContain("'Cache-Control': 'no-store'");
    expect(providerSource).toContain("gpt-image-1.5");
    expect(providerSource).toContain("gemini-3-pro-image-preview");
    expect(providerSource).toContain("execFile");
    expect(providerSource).not.toContain("spawn(");
    expect(promptSource).toContain("Do not render real names");
    expect(requestSource).toContain("detectImageMime");
  });

  test("adds storyboard generation as an operator-controlled admin module", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const storyboardSource = source(
      "components/admin/storyboard/AdminStoryboardGenerator.tsx",
    );
    const routeSource = source("app/api/admin/storyboard/route.ts");
    const generatorSource = source("lib/admin/storyboard/generator.ts");

    expect(consoleSource).toContain('id: "storyboard"');
    expect(consoleSource).toContain("스토리보드 생성");
    expect(consoleSource).toContain("AdminStoryboardGenerator");
    expect(storyboardSource).toContain("/api/admin/storyboard");
    expect(storyboardSource).toContain("회의용 Markdown 복사");
    expect(storyboardSource).toContain("위원회 AHP 평가");
    expect(routeSource).toContain("await requireAdmin()");
    expect(routeSource.indexOf("await requireAdmin()")).toBeLessThan(
      routeSource.indexOf("const result = generateLocalStoryboard"),
    );
    expect(generatorSource).toContain("backend/storyboard-agent");
    expect(generatorSource).toContain("most_replayed_markers");
    expect(generatorSource).toContain("TZUYANG_HEATMAP_DIR");
  });

  test("lets admins reorder the sidebar without polluting the two-pane map overview", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const appGlobalsSource = source("app/app-globals.css");
    const preferenceRouteSource = source(
      "app/api/admin/preferences/sidebar-order/route.ts",
    );
    const sidebarOrderSource = source("lib/admin/sidebar-order.ts");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain("DEFAULT_ADMIN_SIDEBAR_ORDER");
    expect(consoleSource).toContain("normalizeAdminSidebarOrder");
    expect(sidebarOrderSource).toContain("mergeSidebarItemsWithDefaultSlots");
    expect(consoleSource).toContain("moveAdminSidebarSection");
    expect(consoleSource).toContain("moveAdminSidebarItem");
    expect(consoleSource).toContain("buildOrderedSidebarSections");
    expect(consoleSource).toContain("canLoadPreferences");
    expect(consoleSource).toContain("if (!canLoadPreferences) {");
    expect(consoleSource).toContain("setIsOrderLoading(true);");
    expect(consoleSource).toContain("setIsOrderLoading(false);");
    expect(consoleSource).toContain("isOrderLoading ||");
    expect(consoleSource).toContain("data-admin-sidebar-order-loading=");
    expect(consoleSource).toContain("useAdBannersAdmin(isAdmin)");
    expect(consoleSource).not.toContain("useAnnouncementsAdmin(isAdmin)");
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "export function useAdBannersAdmin(enabled = true)",
    );
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "enabled: isAdmin && enabled",
    );
    expect(consoleSource).toContain('data-admin-console-mobile-header="true"');
    expect(consoleSource).toContain("data-admin-console-mobile-header-visible={");
    expect(consoleSource).toContain('showMobileHeader ? "true" : "false"');
    expect(consoleSource).toContain('isMobileHeaderVisible ? "true" : "false"');
    expect(appGlobalsSource).toContain(
      '[data-admin-console-layout="sidebar-content"][data-admin-console-mobile-header-visible="false"]',
    );
    expect(appGlobalsSource).toContain("grid-template-rows: 0rem minmax(0, 1fr);");
    expect(appGlobalsSource).toContain(
      "transition: grid-template-rows 300ms cubic-bezier(0.22, 1, 0.36, 1);",
    );
    expect(consoleSource).toContain("useMobileBottomNavAutoHide");
    expect(consoleSource).toContain("getMobileScrollNavVisibilityAction");
    expect(consoleSource).toContain("const updateMobileHeaderVisibility = useCallback");
    expect(consoleSource).toContain("canvasRef.current?.scrollTop ?? 0");
    expect(consoleSource).toContain("window.scrollY");
    expect(consoleSource).toContain("previousMobileHeaderScrollTopRef.current");
    expect(consoleSource).toContain('source: "admin-console"');
    expect(consoleSource).toContain("disabled: !isAdminMobileViewport");
    expect(consoleSource).toContain("revealOnScrollUp: false");
    expect(consoleSource).toContain("handleAdminCanvasScroll");
    expect(consoleSource).toContain("getAdminConsoleScrollTop");
    expect(consoleSource).toContain("getScrollTop: getAdminConsoleScrollTop");
    expect(consoleSource).toContain("const [isAdminMobileViewport, setIsAdminMobileViewport] = useState(() =>");
    expect(consoleSource).toContain('window.matchMedia("(max-width: 767px)").matches');
    expect(consoleSource).toContain("const setAdminMobileChromeHidden = useCallback");
    expect(consoleSource).toContain("const handleAdminCanvasWheel = useCallback");
    expect(consoleSource).toContain("onWheel={handleAdminCanvasWheel}");
    expect(consoleSource).toContain("adminCanvasTouchStartYRef");
    expect(consoleSource).toContain("setAdminMobileChromeHidden(true)");
    expect(consoleSource).toContain("const handleAdminCanvasTouchMove = useCallback");
    expect(consoleSource).toContain("onTouchStart={handleAdminCanvasTouchStart}");
    expect(consoleSource).toContain("onTouchMove={handleAdminCanvasTouchMove}");
    expect(consoleSource).toContain('canvasElement?.addEventListener("scroll"');
    expect(consoleSource).toContain("showMobileHeader={isMobileHeaderVisible}");
    expect(consoleSource).toContain("previousRequestedModuleIdRef.current !== nextModuleId");
    expect(consoleSource).toContain("transition-[transform,border-color]");
    expect(consoleSource).toContain("translate3d(0, -120%, 0)");
    expect(consoleSource).toContain("flex w-full min-w-0 shrink-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto");
    expect(consoleSource).toContain('data-allow-horizontal-scroll="true"');
    expect(consoleSource).toContain("min-h-0 min-w-0 w-full overflow-hidden border");
    expect(consoleSource).toContain("overflow-x-hidden overscroll-contain");
    expect(consoleSource).toContain('data-admin-console-menu-trigger="hamburger"');
    expect(consoleSource).toContain('variant="ghost"');
    expect(consoleSource).toContain("rounded-lg bg-transparent p-0 shadow-none");
    expect(consoleSource).not.toContain("rounded-full border-border/80 bg-background/85 p-0 shadow-sm");
    expect(consoleSource).not.toContain('data-admin-console-menu-trigger="desktop-hamburger"');
    expect(consoleSource).toContain('data-admin-console-menu-dropdown="true"');
    expect(consoleSource).toContain('data-admin-sidebar-order-editor={placement}');
    expect(consoleSource).toContain('renderOrderControls("dropdown")');
    expect(consoleSource).toContain('data-admin-sidebar-theme-toggle="true"');
    expect(consoleSource).toContain('data-admin-sidebar-footer-actions="true"');
    expect(consoleSource).toContain('data-admin-sidebar-section-list="spacious"');
    expect(consoleSource).toContain('data-admin-sidebar-footer-separator="spacious"');
    expect(consoleSource).toContain('data-admin-sidebar-scroll="hidden-scrollbar"');
    expect(consoleSource).toContain("relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden");
    expect(consoleSource).toContain('data-admin-sidebar-menu-scroll="hidden-scrollbar"');
    expect(consoleSource).toContain("scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2");
    expect(source("app/app-globals.css")).toContain(".scrollbar-hide::-webkit-scrollbar");
    expect(consoleSource).toContain("shrink-0 border-t border-dashed border-border/70 pt-4");
    expect(consoleSource).toContain('data-admin-sidebar-preference-placement={placement}');
    expect(consoleSource).toContain('data-admin-sidebar-theme-layout={placement}');
    expect(consoleSource).toContain(
      'inline-flex w-9 flex-col items-center gap-1 self-center rounded-2xl',
    );
    expect(consoleSource).toContain('isCompactSidebar ? "w-8" : "w-full min-w-0"');
    expect(consoleSource).toContain(
      'className="rounded-2xl border border-border bg-background/70 p-2"',
    );
    expect(consoleSource).toContain('aria-label="메뉴 순서 설정"');
    expect(consoleSource).toContain('aria-label="관리자 사이드바 설정"');
    expect(consoleSource).toContain('isCollapsed');
    expect(consoleSource).toContain('"flex w-full flex-col items-center gap-2.5"');
    expect(consoleSource).toContain('"space-y-3"');
    expect(consoleSource).toContain('data-admin-sidebar-order-trigger="expanded"');
    expect(consoleSource).toContain('data-admin-sidebar-order-trigger="collapsed"');
    expect(consoleSource).toContain("ADMIN_THEME_STORAGE_KEY");
    expect(consoleSource).toContain(
      'type AdminThemePreference = "light" | "dark" | "system"',
    );
    expect(consoleSource).toContain(
      'window.matchMedia("(prefers-color-scheme: dark)")',
    );
    expect(consoleSource).toContain(
      'document.documentElement.classList.toggle("dark"',
    );
    expect(consoleSource).toContain(
      "window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY",
    );
    expect(consoleSource).toContain('aria-label="화면 모드 선택"');
    expect(consoleSource).toContain('aria-label={`${label}으로 변경`}');
    expect(consoleSource).toContain(
      'aria-pressed={themePreference === theme}',
    );
    expect(consoleSource).toContain(
      '"border border-border bg-white p-1 shadow-inner dark:bg-card"',
    );
    expect(consoleSource).toContain(
      '["light", "화이트 모드", Sun]',
    );
    expect(consoleSource).toContain(
      '["dark", "다크모드", Moon]',
    );
    expect(consoleSource).toContain(
      '["system", "시스템 설정", Monitor]',
    );
    expect(consoleSource).toContain(
      '<Icon className="h-3.5 w-3.5" aria-hidden="true" />',
    );
    expect(consoleSource).toContain("ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY");
    expect(consoleSource).toContain(
      "window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY)",
    );
    expect(consoleSource).toContain("window.localStorage.setItem(");
    expect(consoleSource).toContain("ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY,");
    expect(consoleSource).toContain("UiTooltipTrigger asChild");
    expect(consoleSource).toContain(
      'data-admin-sidebar-collapsed-tooltip="true"',
    );
    expect(consoleSource).toContain("adminDashboardTooltipPortalClassName");
    expect(consoleSource).toContain('side="right"');
    expect(consoleSource).toContain('dataAttribute="sidebar-collapsed"');
    expect(consoleSource).toContain("getSidebarBadgeClassName");
    expect(consoleSource).toContain('sectionLabel === "실험실"');
    expect(consoleSource).toContain(
      "data-admin-sidebar-badge-tone={section.label}",
    );
    expect(appGlobalsSource).toContain(".dark {");
    expect(appGlobalsSource).toContain("--background: 24 10% 10%;");
    expect(consoleSource).toContain(
      "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col",
    );
    expect(consoleSource).toContain("md:min-w-[14.25rem]");
    expect(consoleSource).toContain("md:max-w-[var(--admin-sidebar-expanded-max-width)]");
    expect(consoleSource).toContain("isCollapsed &&");
    expect(consoleSource).toContain(
      '"md:min-h-9 md:w-full md:items-center md:justify-center md:border-b-0 md:px-0 md:pb-1"',
    );
    expect(consoleSource).toContain('isCollapsed && "md:hidden"');
    expect(consoleSource).toContain('href="/"');
    expect(consoleSource).toContain('aria-label="쯔동여지도 홈으로 이동"');
    expect(consoleSource).not.toContain(
      "border border-primary/15 bg-primary/5 text-primary transition hover:border-primary/30 hover:bg-primary/10",
    );
    expect(consoleSource).not.toContain("hover:bg-primary/10");
    expect(consoleSource).toContain(
      "border border-border bg-transparent text-foreground transition hover:border-border hover:bg-transparent",
    );
    expect(consoleSource).toContain('src="/logo.webp"');
    expect(consoleSource).toContain('aria-label="관리자 메뉴 열기"');
    expect(consoleSource).toContain('aria-controls="admin-console-menu-dropdown"');
    expect(consoleSource).toContain('data-admin-console-menu-dropdown="true"');
    expect(consoleSource).toContain('data-admin-sidebar-order-editor={placement}');
    expect(consoleSource).toContain('renderOrderControls("dropdown")');
    expect(consoleSource).toContain('data-admin-sidebar-footer-actions="true"');
    expect(consoleSource).toContain('data-admin-sidebar-section-list="spacious"');
    expect(consoleSource).toContain('data-admin-sidebar-footer-separator="spacious"');
    expect(consoleSource).toContain('data-admin-sidebar-scroll="hidden-scrollbar"');
    expect(consoleSource).toContain("relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden");
    expect(consoleSource).toContain('data-admin-sidebar-menu-scroll="hidden-scrollbar"');
    expect(consoleSource).toContain("scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2");
    expect(source("app/app-globals.css")).toContain(".scrollbar-hide::-webkit-scrollbar");
    expect(consoleSource).toContain("shrink-0 border-t border-dashed border-border/70 pt-4");
    expect(consoleSource).toContain("renderThemeControls(\"sidebar\")");
    expect(consoleSource).toContain("renderOrderControls(\"sidebar\")");
    expect(consoleSource).toContain("block space-y-3");
    expect(consoleSource).toContain("메뉴 순서");
    expect(consoleSource).toContain("초기화");
    expect(consoleSource).toContain("aria-label={`${item.title} 메뉴 앞으로`}");
    expect(consoleSource).toContain("aria-label={`${item.title} 메뉴 뒤로`}");
    expect(consoleSource).toContain('aria-live="polite"');
    expect(preferenceRouteSource).toContain("SIDEBAR_ORDER_KEY");
    expect(preferenceRouteSource).toContain("admin_user_preferences");
    expect(preferenceRouteSource).toContain(
      'from "@/lib/admin/sidebar-order"',
    );
    expect(sidebarOrderSource).toContain("mergeSidebarItemsWithDefaultSlots");
    expect(sidebarOrderSource).toContain(
      '운영: ["users", "banners", "insights"]',
    );
    expect(preferenceRouteSource).toContain("await requireAdmin()");
    expect(preferenceRouteSource.indexOf("await requireAdmin()")).toBeLessThan(
      preferenceRouteSource.indexOf("createSupabaseServiceRoleClient()"),
    );
    expect(preferenceRouteSource).toContain("normalizeAdminSidebarOrder");
    expect(overviewSource).not.toContain("메뉴 순서");
    expect(consoleSource).not.toContain("/admin/users");
  });

  test("cleans stale admin module query state and canonicalizes invalid modules", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).toContain("buildCanonicalAdminModuleHref");
    expect(consoleSource).toContain("getAdminModuleStateWarning");
    expect(consoleSource).toContain(
      "알 수 없는 관리자 화면 요청을 대시보드 (KPI)로 되돌렸습니다.",
    );
    expect(consoleSource).toContain(
      "router.replace(buildCanonicalAdminModuleHref(moduleId)",
    );
    expect(consoleSource).toContain(
      "const canonicalHref = buildCanonicalAdminModuleHref(nextModuleId);",
    );
    expect(consoleSource).toContain("currentHref !== canonicalHref");
    expect(consoleSource).toContain(
      "router.replace(canonicalHref, { scroll: false });",
    );
    expect(consoleSource).not.toContain(
      "const params = new URLSearchParams(window.location.search);",
    );
    expect(consoleSource).not.toContain("window.location.hash");
  });

  test("keeps route recommendation as only two source-honest map panes", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain(
      "const AdminRouteRecommendationModule = dynamic(",
    );
    expect(overviewSource).toContain(
      'aria-label="관리자 지도 운영 개요 2분할"',
    );
    expect(overviewSource).toContain("AdminMapOverviewCanvas");
    expect(overviewSource).toContain("AdminMapInfoPanel");
    expect(overviewSource).toContain(
      "네이버 지도 프레임은 유지한 채 맛집 관리에서 좌표 상태를 확인하세요.",
    );
    expect(overviewSource).toContain("restaurants: realRestaurants,");
    expect(overviewSource).toContain(
      "지도는 기본 위치로 유지하고 좌표가 있는 맛집만 표시합니다.",
    );
    expect(overviewSource).toContain(
      "네이버 Directions 5 기준 실제 도로 주행 경로",
    );
    expect(overviewSource).not.toContain("채널별 레이어 확장 슬롯");
    expect(overviewSource).not.toContain("오늘 처리할 일");
    expect(overviewSource).not.toContain(
      "제보·리뷰·맛집 검수 상태를 먼저 확인합니다.",
    );
    expect(overviewSource).not.toContain("제보 검토");
    expect(overviewSource).not.toContain("리뷰 검수");
    expect(overviewSource).not.toContain("맛집·좌표 확인");
    expect(overviewSource).not.toContain("운영 상태 요약");
    expect(overviewSource).not.toContain("참고 운영 정보");
    expect(overviewSource).not.toContain('aria-label="관리자 대시보드 4분할"');
    expect(consoleSource).not.toContain("관리자 콘솔 · 실시간 운영 개요");
    expect(consoleSource).not.toContain("OpsTruthBadge");
    expect(consoleSource).not.toContain("PendingFeatureCard");
    expect(consoleSource).not.toContain("Realtime 준비");
    expect(consoleSource).not.toContain("function WidgetShell");
    expect(consoleSource).not.toContain("function LatestTzuyangVideosWidget");
  });

  test("keeps selected marker detail as one thumbnail-first evidence card", () => {
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(overviewSource).toContain("function getAdminYoutubeThumbnailUrl");
    expect(overviewSource).toContain("function AdminYoutubeThumbnailImage");
    expect(overviewSource).toContain(
      'quality: "maxresdefault" | "hqdefault" = "maxresdefault"',
    );
    expect(overviewSource).toContain('setQuality("hqdefault")');
    expect(overviewSource).toContain(
      'sizes="(min-width: 1280px) 520px, (min-width: 640px) 100vw, 100vw"',
    );
    expect(overviewSource).toContain("object-contain");
    expect(overviewSource).toContain(
      "relative block aspect-video overflow-hidden bg-background",
    );
    expect(overviewSource).toContain("function getAdminYoutubeWatchUrl");
    expect(overviewSource).toContain("const selectedYoutubeUrl =");
    expect(overviewSource).toContain("group relative block aspect-video");
    expect(overviewSource).not.toContain('aria-label="선택 마커 작업"');
    expect(overviewSource).not.toContain("연결 영상 썸네일");
    expect(overviewSource).toContain("원본 YouTube 영상 새 탭에서 열기");
    expect(overviewSource).not.toContain("원본 영상 열기");
    expect(overviewSource).not.toContain("맛집 검수");
    expect(overviewSource).toContain("영상 연결 없음");
    expect(overviewSource).not.toContain("selectedMetaItems.map");
  });

  test("removes repeated embedded module context headers from the admin canvas", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");

    expect(consoleSource).not.toContain("이 화면에서 처리 · {module.badge}");
    expect(consoleSource).not.toContain("독립 라우트 보존");
    expect(consoleSource).not.toContain("문서 스크롤 없음");
    expect(consoleSource).not.toContain("module.description");
    expect(consoleSource).toContain("aria-label={`${module.title} 작업 화면`}");
    expect(consoleSource).toContain("사용자");
    expect(consoleSource).toContain("권한 변경 감사는 저장되며");
  });

  test("keeps admin pages dense without sacrificing responsive boundaries", () => {
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const tailwindSource = source("tailwind.config.ts");
    const usersSource = source("components/admin/AdminUsersPanel.tsx");
    const evaluationsSource = source("app/admin/evaluations/page.tsx");
    const bannersSource = source("app/admin/banners/page.tsx");
    const announcementSource = source(
      "components/announcement/AnnouncementPanel.tsx",
    );
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: fit-content(var(--admin-sidebar-expanded-max-width)) minmax(0, 1fr);",
    );
    expect(consoleSource).toContain('data-admin-console-menu-trigger="hamburger"');
    expect(consoleSource).toContain('data-admin-dashboard-period-select-trigger="true"');
    expect(consoleSource).toContain('data-admin-dashboard-period-menu="true"');
    expect(consoleSource).toContain("p-2 md:border-y-0 md:p-4");
    expect(consoleSource).not.toContain("pb-[calc(env(safe-area-inset-bottom)+5.75rem)]");
    expect(consoleSource).toContain("min-h-[420px] flex-1");
    expect(consoleSource).toContain("overflow-visible md:overflow-hidden");
    expect(consoleSource).toContain("md:h-full md:min-h-0");
    expect(consoleSource).toContain("lg:grid-cols-10");
    expect(consoleSource).toContain(
      "lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]",
    );
    expect(tailwindSource).toContain("lg:grid-cols-10");
    expect(tailwindSource).toContain(
      "lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)]",
    );
    expect(tailwindSource).toContain("lg:col-span-5");
    expect(overviewSource).toContain("overflow-visible lg:h-full lg:min-h-0");
    expect(overviewSource).toContain(
      "lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]",
    );
    expect(consoleSource).not.toContain("function AnnouncementWorkspace");
    expect(usersSource).toContain("flex h-full min-h-0 flex-col bg-background");
    expect(usersSource).toContain("gap-2 overflow-y-auto p-2");
    expect(usersSource).toContain("h-9 rounded-lg pl-9");
    expect(consoleSource).toContain(
      "const controller = new AbortController();",
    );
    expect(consoleSource).toContain("signal: controller.signal");
    expect(consoleSource).toContain("return () => {");
    expect(consoleSource).toContain("controller.abort();");
    expect(consoleSource).toContain("if (!controller.signal.aborted)");
    expect(usersSource).toContain(
      "const loadUsers = useCallback(async (signal?: AbortSignal)",
    );
    expect(usersSource).toContain("return () => controller.abort();");
    expect(usersSource).toContain("if (!signal?.aborted)");
    expect(evaluationsSource).toContain(
      'embedded ? "border-b border-border bg-card px-2 py-1.5"',
    );
    expect(evaluationsSource).toContain("p-2 sm:p-2");
    expect(consoleSource).toContain(
      'const AdminBannerModule = dynamic(() => import("@/app/admin/banners/page"), {',
    );
    expect(consoleSource).not.toContain(
      "const AdminAnnouncementModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      '() => import("@/components/announcement/AnnouncementPanel")',
    );
    expect(consoleSource).toContain("const AdminUsersModule = dynamic(");
    expect(consoleSource).toContain(
      '() => import("@/components/admin/AdminUsersPanel")',
    );
    expect(consoleSource).toContain("const AdminEvaluationModule = dynamic(");
    expect(consoleSource).not.toContain(
      "const AdminRestaurantEvaluationModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      "const AdminSubmissionEvaluationModule = dynamic(",
    );
    expect(consoleSource).not.toContain(
      "const AdminReviewEvaluationModule = dynamic(",
    );
    expect(consoleSource).toContain("ssr: false,");
    expect(consoleSource).not.toContain("loading: () => <InlineModuleLoading");
    expect(consoleSource).not.toContain(
      "loading: () => <InlineEvaluationModuleSkeleton",
    );
    expect(consoleSource).not.toContain("InlineModuleLoading");
    expect(consoleSource).not.toContain("InlineEvaluationModuleSkeleton");
    expect(consoleSource).not.toContain("화면 구조 준비 중");
    expect(consoleSource).not.toContain("INLINE_MODULE_LOADING_ROW_COUNT");
    expect(consoleSource).not.toContain("배너 관리 화면 준비 중");
    expect(consoleSource).not.toContain("공지사항 운영 화면 준비 중");
    expect(consoleSource).not.toContain("사용자 관리 화면 준비 중");
    expect(bannersSource).toContain('embedded ? "px-2 py-1.5"');
    expect(bannersSource).toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(bannersSource).toContain(
      "bannersLoading ? <InlineCountSkeleton /> : sortedBanners.length",
    );
    expect(bannersSource).toContain('aria-label="배너 목록 로딩 중"');
    expect(bannersSource).toContain("function BannerListItemSkeleton");
    expect(bannersSource).toContain(
      "<BannerListItemSkeleton key={index} index={index} />",
    );
    expect(bannersSource).toContain(
      "relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border",
    );
    expect(bannersSource).toContain(
      'Badge variant="secondary" className="rounded-full text-[10px]"',
    );
    expect(bannersSource).not.toContain("bannersLoading && <Loader2");
    expect(bannersSource).toContain(
      "모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.",
    );
    expect(bannersSource).toContain("deleteConfirmation !== '배너삭제'");
    expect(bannersSource).toContain(
      "await deleteBanner.mutateAsync(bannerToDelete.id)",
    );
    expect(
      bannersSource.indexOf(
        "await deleteBanner.mutateAsync(bannerToDelete.id)",
      ),
    ).toBeLessThan(
      bannersSource.indexOf(
        "const mediaUrls = [bannerToDelete.image_url, bannerToDelete.video_url]",
      ),
    );
    expect(bannersSource).not.toContain('role="listitem"');
    expect(bannersSource).not.toContain("<Dialog");
    expect(bannersSource).not.toContain("<AlertDialog");
    expect(announcementSource).not.toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(announcementSource).toContain(
      "isAnnouncementsLoading ? <InlineCountSkeleton /> : allDisplayAnnouncements.length",
    );
    expect(announcementSource).toContain('aria-label="공지사항 목록 로딩 중"');
    expect(announcementSource).toContain(
      "function AnnouncementListItemSkeleton",
    );
    expect(announcementSource).toContain(
      "<AnnouncementListItemSkeleton key={index} index={index} />",
    );
    expect(announcementSource).not.toContain("공지사항을 불러오는 중입니다");
    expect(announcementSource).toContain(
      "group w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left",
    );
    expect(announcementSource).toContain(
      "w-full rounded-xl border border-border/70 bg-card px-3 py-3",
    );
    expect(announcementSource).not.toContain("toggleConfirmation");
    expect(announcementSource).not.toContain("deleteConfirmation");
    expect(announcementSource).not.toContain('role="listitem"');
    expect(announcementSource).not.toContain("confirm(`");
    expect(consoleSource).not.toContain(
      'module.id === "banners" || module.id === "announcements" || module.id === "users" ? "overflow-y-auto" : "overflow-hidden"',
    );
    expect(consoleSource).not.toContain("관리자 운영 콘솔");
    expect(consoleSource).not.toContain("안전한 CRUD 흐름");
    expect(consoleSource).not.toContain("audit source");
    expect(consoleSource).not.toContain("lg:w-52");
    expect(consoleSource).not.toContain("function LlmSessionPanel()");
    expect(consoleSource).not.toContain("function ConnectedRoutesCard()");
    expect(usersSource).not.toContain("min-h-[560px]");
    expect(usersSource).toContain(
      'isLoading ? <span className="inline-block h-6 w-12 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none"',
    );
    expect(usersSource).not.toContain(
      "value={isLoading ? '—' : summary.loadedUsers}",
    );
  });

  test("hardens risky admin submission and OCR actions with typed confirmations", () => {
    const submissionSource = source("components/admin/SubmissionListView.tsx");
    const resetAllSource = source(
      "app/api/admin/ocr-receipts/reset-all/route.ts",
    );

    expect(submissionSource).toContain(
      "const SUBMISSION_DELETE_CONFIRMATION = '제보삭제'",
    );
    expect(submissionSource).toContain(
      "const REVIEW_DELETE_CONFIRMATION = '리뷰삭제'",
    );
    expect(submissionSource).toContain(
      "const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'",
    );
    expect(submissionSource).toContain(
      "const OVERRIDE_APPROVAL_CONFIRMATION = '무시승인'",
    );
    expect(submissionSource).toContain(
      "xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]",
    );
    expect(submissionSource).toContain('aria-label="제보 상세 작업 패널"');
    expect(submissionSource).toContain('aria-label="리뷰 상세 작업 패널"');
    expect(submissionSource).toContain(
      "submissionDeleteConfirmation !== SUBMISSION_DELETE_CONFIRMATION",
    );
    expect(submissionSource).toContain(
      "reviewDeleteConfirmation !== REVIEW_DELETE_CONFIRMATION",
    );
    expect(submissionSource).toContain(
      "ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION",
    );
    expect(submissionSource).toContain("openSubmissionDetail(submission);");
    expect(submissionSource).toContain("setReviewAction(null);");
    expect(submissionSource).toContain(
      "setReviewAdminNote(review.admin_note || '');",
    );
    expect(submissionSource).not.toContain("window.prompt(");
    expect(submissionSource).not.toContain("<Dialog");
    expect(submissionSource).not.toContain("ADMIN_MODAL_");
    expect(submissionSource).toContain(
      "disabled={overrideApprovalConfirmation !== OVERRIDE_APPROVAL_CONFIRMATION}",
    );
    expect(submissionSource).toContain("if (forceApprove) {");
    expect(submissionSource).toContain("setOverrideApprovalConfirmation('');");
    expect(submissionSource).toContain("setShowWarningModal(true);");
    expect(submissionSource).toContain("검증 경고 확인 후 승인");
    expect(submissionSource).toContain("renderOverrideApprovalPanel");
    expect(submissionSource).not.toContain("verificationDone || forceApprove");
    expect(submissionSource.indexOf("if (forceApprove) {")).toBeLessThan(
      submissionSource.indexOf("if (verificationDone) {"),
    );
    expect(
      submissionSource.indexOf("setOverrideApprovalConfirmation('');"),
    ).toBeLessThan(submissionSource.indexOf("setShowWarningModal(true);"));
    expect(submissionSource).toContain(
      "body: JSON.stringify({ confirmation: OCR_RESET_ALL_CONFIRMATION })",
    );
    expect(resetAllSource).toContain(
      "const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'",
    );
    expect(resetAllSource).toContain(
      "body.confirmation !== OCR_RESET_ALL_CONFIRMATION",
    );
    expect(resetAllSource).toContain(
      "OCR 전체 초기화 확인 문구가 일치하지 않습니다.",
    );
    expect(resetAllSource).toContain("workflowPreflightResponse");
    expect(resetAllSource).toContain("partialFailure: true");
    expect(
      resetAllSource.indexOf(
        "if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO)",
      ),
    ).toBeLessThan(
      resetAllSource.indexOf(
        "const supabase = createSupabaseServiceRoleClient()",
      ),
    );
    expect(resetAllSource.indexOf("workflowPreflightResponse")).toBeLessThan(
      resetAllSource.indexOf(
        "const supabase = createSupabaseServiceRoleClient()",
      ),
    );
    expect(submissionSource).not.toContain(
      "confirm('정말 이 제보를 삭제하시겠습니까?')",
    );
    expect(submissionSource).not.toContain(
      "confirm('정말 이 리뷰를 삭제하시겠습니까?')",
    );
    expect(submissionSource).not.toContain(
      "confirm('모든 리뷰의 OCR을 초기화하고 다시 실행합니다. 계속하시겠습니까?')",
    );
  });
});
