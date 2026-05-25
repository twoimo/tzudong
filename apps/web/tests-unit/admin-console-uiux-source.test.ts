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
    expect(consoleSource).toContain("{authLoading ? (");
    expect(consoleSource).toContain("<AdminConsoleCanvasSkeleton />");
    expect(source("components/admin/AdminOverviewDashboard.tsx")).toContain(
      "backdrop-blur-[1px]",
    );
    expect(consoleSource).not.toContain("지도 준비 중");
    expect(consoleSource).not.toContain("group-hover:scale-[1.02]");
    expect(consoleSource).toContain("return null;");
    expect(adminLoadingSource).not.toContain("AdminConsoleLoadingSkeleton");
    expect(source("app/app-globals.css")).toContain(
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
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
      consoleSource.indexOf("type AdminSidebarOrderPreference"),
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
    expect(opsSectionSource).toContain('id: "routes"');
    expect(opsSectionSource).not.toContain('"audit"');
    expect(labSectionSource).toContain('"audit"');
    expect(labSectionSource).toContain('id: "llm"');
    expect(labSectionSource).toContain('badge: "실험 중"');
    expect(opsSectionSource.indexOf('id: "routes"')).toBeLessThan(
      opsSectionSource.indexOf('"storyboard"'),
    );
    expect(consoleSource).toContain('title: "핵심 인사이트"');
    expect(consoleSource).toContain("fetchAdminDashboardInsightSummary");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain(
      'data-admin-dashboard-realtime-charts="true"',
    );
    expect(consoleSource).toContain('data-admin-dashboard-channel-kpi="true"');
    expect(consoleSource).toContain(
      "flex h-full min-h-0 flex-col overflow-y-auto bg-background p-0 font-sans text-foreground lg:overflow-hidden",
    );
    expect(consoleSource).toContain(
      "grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-visible sm:grid-cols-2 lg:grid-cols-10 lg:grid-rows-[132px_minmax(0,1fr)_minmax(0,0.86fr)] lg:overflow-hidden",
    );
    expect(consoleSource).toContain('activeModuleId === "overview"');
    expect(consoleSource).toContain("overflow-y-auto lg:overflow-hidden");
    expect(consoleSource).toContain('from "recharts"');
    expect(consoleSource).toContain("ResponsiveContainer");
    expect(consoleSource).toContain("LineChart");
    expect(consoleSource).toContain("ScatterChart");
    expect(consoleSource).toContain("RechartsBarChart");
    expect(consoleSource).toContain("AreaChart");
    expect(consoleSource).toContain(
      'data-admin-dashboard-line-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-bubble-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-bar-chart="recharts"',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-area-chart="recharts"',
    );
    expect(consoleSource).toContain("adminDashboardTooltipStyle");
    expect(consoleSource).not.toContain("viewBox={`0 0 ${width} ${height}`}");
    expect(consoleSource).toContain(
      "min-h-0 overflow-hidden border border-border/70 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    );
    expect(consoleSource).not.toContain("bg-[#e9ecee]");
    expect(consoleSource).not.toContain(
      "bg-white p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42",
    );
    expect(consoleSource).toContain("Tzuyang KPI Dashboard");
    expect(consoleSource).not.toContain(
      "구독자·조회수·좋아요·댓글·영상 수를 1페이지 KPI 보드에서 한눈에 봅니다.",
    );
    expect(consoleSource).toContain("구독자수");
    expect(consoleSource).toContain("총 조회수");
    expect(consoleSource).toContain("좋아요수");
    expect(consoleSource).toContain("댓글수");
    expect(consoleSource).toContain("영상 개수");
    expect(consoleSource).toContain('{ value: "30MIN", label: "30분" }');
    expect(consoleSource).toContain('{ value: "1H", label: "1시간" }');
    expect(consoleSource).toContain('{ value: "6H", label: "6시간" }');
    expect(consoleSource).toContain('{ value: "12H", label: "12시간" }');
    expect(consoleSource).toContain('{ value: "1D", label: "1일" }');
    expect(consoleSource).toContain("fetchAdminYouTubeChannelStats");
    expect(consoleSource).toContain("/api/admin/youtube-channel");
    expect(consoleSource).toContain("/api/admin/youtube-kpis");
    const dashboardOrderRouteSource = source(
      "app/api/admin/preferences/dashboard-widget-order/route.ts",
    );
    expect(dashboardOrderRouteSource).toContain("admin_dashboard_widget_order");
    expect(dashboardOrderRouteSource).toContain("admin_user_preferences");
    expect(dashboardOrderRouteSource).toContain(
      "normalizeAdminDashboardWidgetOrder",
    );
    expect(consoleSource).toContain("fallbackResponse");
    expect(consoleSource).toContain("/api/insights/treemap");
    expect(consoleSource).toContain("subscriberValue");
    expect(consoleSource).toContain("YouTube Data API");
    expect(consoleSource).toContain("채널 통계 확인 필요");
    expect(consoleSource).toContain(
      '<h1 className="text-xl font-extrabold tracking-[0.01em] text-foreground text-balance">',
    );
    expect(consoleSource).toContain("text-[clamp(1.42rem,1.75vw,2.1rem)]");
    expect(consoleSource).toContain('fontSize: "12px"');
    expect(consoleSource).toContain("fontSize: 11");
    expect(consoleSource).toContain("toneClass.bar");
    expect(consoleSource).toContain("toneClass.text");
    expect(consoleSource).not.toContain("toneClass.split");
    expect(consoleSource).not.toContain("text-[9px]");
    expect(consoleSource).not.toContain(
      "text-[10px] font-bold text-muted-foreground",
    );
    expect(consoleSource).toContain(
      "조회수, 참여, 참여율을 최근 영상 순서로 정규화해 비교합니다.",
    );
    expect(consoleSource).toContain("상위 영상 영향도 최고 항목은");
    expect(consoleSource).toContain(
      'data-admin-dashboard-bubble-tooltip="video-title"',
    );
    expect(consoleSource).toContain(
      "line-clamp-2 font-extrabold leading-5 text-foreground",
    );
    expect(consoleSource).toContain("formatNumber(row.조회수)");
    expect(consoleSource).toContain("formatNumber(row.참여)");
    expect(consoleSource).toContain("콘텐츠 성과 상위 항목은");
    expect(consoleSource).toContain("조회수가 높은 순서로 정렬합니다.");
    expect(consoleSource).toContain("조회수: row.viewCount");
    expect(consoleSource).not.toContain("댓글: row.commentCount");
    expect(consoleSource).toContain("최근 참여율 지표는");
    expect(consoleSource).toContain("상위 영상 영향도");
    expect(consoleSource).toContain("조회·참여 추이");
    expect(consoleSource).toContain("콘텐츠 성과 TOP 5");
    expect(consoleSource).toContain(
      'data-admin-dashboard-card-title-delta="true"',
    );
    expect(consoleSource).toContain(
      "metric={`조회 증감 ${formatDashboardChangeLabel(viewChange)}`}",
    );
    expect(consoleSource).toContain(
      "(참여 증감 {formatDashboardChangeLabel(engagementChange)})",
    );
    expect(consoleSource).toContain("truncateAdminDashboardAxisLabel");
    expect(consoleSource).toContain("const visibleRows = rows.slice(0, 5)");
    expect(consoleSource).toContain(
      "label: truncateAdminDashboardAxisLabel(row.label)",
    );
    expect(consoleSource).toContain("interval={0}");
    expect(consoleSource).toContain("긴 제목은 말줄임 처리");
    expect(consoleSource).toContain("참여율 변동");
    expect(consoleSource).toContain("AdminDashboardBubbleChart");
    expect(consoleSource).toContain("AdminDashboardKpiCard");
    expect(consoleSource).toContain("AdminDashboardInfoTooltip");
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
    expect(consoleSource).toContain(
      "같은 레이아웃 영역 안에서 카드를 드래그하면 순서가 자동 저장됩니다.",
    );
    expect(consoleSource).toContain("ADMIN_DASHBOARD_WIDGET_LAYOUT_GROUPS");
    expect(consoleSource).toContain(
      "getAdminDashboardWidgetLayoutGroup(sourceWidgetId)",
    );
    expect(consoleSource).toContain("getDashboardCardReorderProps");
    expect(consoleSource).toContain("getDashboardReorderCardClassName");
    expect(consoleSource).toContain(
      "draggable: isDashboardOrderEditorOpen && !isDashboardOrderSaving",
    );
    expect(consoleSource).toContain("onDragStart: (event) =>");
    expect(consoleSource).toContain(
      "moveDraggedDashboardWidget(widgetId, sourceWidgetId)",
    );
    expect(consoleSource).toContain(
      "/api/admin/preferences/dashboard-widget-order",
    );
    expect(consoleSource).toContain(
      'style={{ order: getDashboardWidgetOrder("subscribers") }}',
    );
    expect(consoleSource).toContain(
      'style={{ order: getDashboardWidgetOrder("engagementRate") }}',
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
    expect(consoleSource).toContain("그래프");
    expect(consoleSource).toContain("표");
    expect(consoleSource).toContain("function AdminDashboardScrollTable");
    expect(consoleSource).toContain('data-admin-dashboard-table-view="true"');
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
    expect(consoleSource).toContain(
      'delta={channelStats?.subscriberCount ? "LIVE" : "—"}',
    );
    expect(consoleSource).toContain(
      'data-admin-dashboard-kpi-delta="timeframe"',
    );
    expect(consoleSource).toContain('deltaLabel = "기간 대비"');
    expect(consoleSource).toContain('deltaLabel="실시간"');
    expect(consoleSource).toContain(
      "title={`${title} ${deltaLabel}: ${delta}`}",
    );
    expect(consoleSource).toContain(
      "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/45",
    );
    expect(consoleSource).toContain("선택 기간의 최신 절반과 이전 절반");
    expect(consoleSource).toContain('className="h-px bg-border/70"');
    expect(consoleSource).toContain("mb-2 grid shrink-0 gap-2");
    expect(consoleSource).toContain(
      'data-admin-dashboard-metric-tooltip="true"',
    );
    expect(consoleSource).toContain("X축은 최근 영상 게시일 순서");
    expect(consoleSource).toContain(
      "Y축은 조회수, 참여, 참여율을 각각 0~100점",
    );
    expect(consoleSource).toContain("참여는 좋아요+댓글");
    expect(consoleSource).toContain("참여율은 (좋아요+댓글)/조회수*100");
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
      "formatRechartsTooltipValue(tooltipValue)",
    );
    expect(kpiSparklineSource).toContain(
      'labelFormatter={(label) => String(label ?? "기간")}',
    );
    expect(kpiSparklineSource).toContain(
      "contentStyle={adminDashboardTooltipStyle}",
    );
    expect(consoleSource).toContain(
      "우측 LIVE는 채널 통계 API 연결이 정상이라는 의미입니다.",
    );
    expect(consoleSource).toContain(
      "grid min-h-[132px] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-3.5",
    );
    expect(consoleSource).toContain("h-11 w-24 shrink-0 overflow-hidden");
    expect(consoleSource).toContain("buildAdminDashboardSparklinePoints");
    expect(consoleSource).toContain("AdminDashboardOpsSummaryCard");
    expect(consoleSource).toContain("운영·검수 요약");
    expect(consoleSource).toContain(
      "같은 섹션 안에서 가장 큰 항목 대비 상대 비중",
    );
    expect(consoleSource).toContain(
      "flex h-full min-h-[280px] flex-col p-3.5 text-xs",
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
      "grid min-h-0 flex-1 content-stretch gap-3",
    );
    expect(consoleSource).toContain(
      "grid grid-cols-[5.5rem_minmax(0,1fr)_3rem]",
    );
    expect(consoleSource).toContain(
      'sectionIndex === 0 ? "text-teal-700" : "text-rose-700"',
    );
    expect(consoleSource).not.toContain(
      "rounded-xl border border-border/60 bg-card/45 p-3",
    );
    expect(consoleSource).toContain('"lg:col-span-2"');
    expect(consoleSource).toContain('"sm:col-span-2 lg:col-span-3"');
    expect(consoleSource).toContain("flex min-h-[280px] flex-col p-3.5");
    expect(consoleSource).toContain("flex min-h-[220px] flex-col p-3.5");
    expect(consoleSource).not.toContain("AdminDashboardLedgerCard");
    expect(consoleSource).not.toContain("AdminDashboardGaugeCard");
    expect(consoleSource).toContain("AdminDashboardGroupedBarChart");
    expect(consoleSource).toContain("AdminDashboardAreaChart");
    expect(consoleSource).not.toContain("구독자 실시간 소스 미연결");
    expect(consoleSource).not.toContain("function buildMetricSeries");
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
    expect(routeSource).toContain("YOUTUBE_API_KEY");
    expect(routeSource).not.toContain("NEXT_PUBLIC_YOUTUBE_API_KEY");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_ID");
    expect(routeSource).toContain("YOUTUBE_CHANNEL_HANDLE");
    expect(routeSource).toContain("@tzuyang6145");
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
    expect(consoleSource).toContain("p-2 sm:p-3 md:border-y-0 md:p-4");
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
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      '[data-admin-left-panel-expanded="true"]',
    );
    expect(appGlobalsSource).toContain("width: max-content;");
    expect(appGlobalsSource).toContain("max-width: min(24rem, 32vw);");
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
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
    expect(appGlobalsSource).toContain(
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
    );
    expect(appGlobalsSource).toContain(
      "grid-template-columns: 4.5rem minmax(0, 1fr);",
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

    expect(consoleSource).not.toContain('id: "announcements"');
    expect(consoleSource).not.toContain('          "announcements",');
    expect(consoleSource).toContain('"storyboard",');
    expect(consoleSource).toContain('"banners",');
    expect(consoleSource).toContain('"users",');
    expect(consoleSource).toContain('"insights",');
    expect(consoleSource).toContain('"audit",');
    expect(sidebarOrderRouteSource).toContain(
      'const ADMIN_SIDEBAR_SECTIONS = ["홈", "검수", "운영", "실험실"]',
    );
    expect(sidebarOrderRouteSource).toContain(
      '운영: ["storyboard", "banners", "users", "insights"]',
    );
    expect(sidebarOrderRouteSource).toContain('실험실: ["audit", "llm"]');
    expect(sidebarOrderRouteSource).not.toContain("'announcements'");
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
    const overviewSource = source(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(consoleSource).toContain("DEFAULT_ADMIN_SIDEBAR_ORDER");
    expect(consoleSource).toContain("normalizeAdminSidebarOrder");
    expect(consoleSource).toContain("moveAdminSidebarSection");
    expect(consoleSource).toContain("moveAdminSidebarItem");
    expect(consoleSource).toContain("buildOrderedSidebarSections");
    expect(consoleSource).toContain("canLoadPreferences");
    expect(consoleSource).toContain("if (!canLoadPreferences) {");
    expect(consoleSource).toContain("setIsOrderLoading(true);");
    expect(consoleSource).toContain("setIsOrderLoading(false);");
    expect(consoleSource).toContain(
      "disabled={!canLoadPreferences || isOrderLoading}",
    );
    expect(consoleSource).toContain("data-admin-sidebar-order-loading=");
    expect(consoleSource).toContain("useAdBannersAdmin(isAdmin)");
    expect(consoleSource).not.toContain("useAnnouncementsAdmin(isAdmin)");
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "export function useAdBannersAdmin(enabled = true)",
    );
    expect(source("hooks/use-ad-banners.tsx")).toContain(
      "enabled: isAdmin && enabled",
    );
    expect(consoleSource).toContain(
      'aria-controls="admin-sidebar-order-editor"',
    );
    expect(consoleSource).toContain('data-admin-sidebar-footer-actions="true"');
    expect(consoleSource).toContain('data-admin-sidebar-theme-toggle="true"');
    expect(consoleSource).toContain("ADMIN_THEME_STORAGE_KEY");
    expect(consoleSource).toContain(
      'type AdminThemePreference = "light" | "dark" | "system"',
    );
    expect(consoleSource).toContain("getNextAdminThemePreference");
    expect(consoleSource).toContain(
      'window.matchMedia("(prefers-color-scheme: dark)")',
    );
    expect(consoleSource).toContain(
      'document.documentElement.classList.toggle("dark"',
    );
    expect(consoleSource).toContain(
      "window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY",
    );
    expect(consoleSource).toContain("aria-label={themeToggleLabel}");
    expect(consoleSource).toContain(
      'aria-pressed={themePreference !== "light"}',
    );
    expect(consoleSource).toContain(
      '<Monitor className="h-3.5 w-3.5" aria-hidden="true" />',
    );
    expect(consoleSource).toContain(
      '<Moon className="h-3.5 w-3.5" aria-hidden="true" />',
    );
    expect(consoleSource).toContain(
      '<Sun className="h-3.5 w-3.5" aria-hidden="true" />',
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
    expect(consoleSource).toContain('side="right"');
    expect(consoleSource).toContain("getSidebarBadgeClassName");
    expect(consoleSource).toContain('sectionLabel === "실험실"');
    expect(consoleSource).toContain(
      "data-admin-sidebar-badge-tone={section.label}",
    );
    expect(appGlobalsSource).toContain(".dark {");
    expect(appGlobalsSource).toContain("--background: 24 10% 10%;");
    expect(consoleSource).toContain(
      "relative z-30 flex max-h-[42dvh] w-full shrink-0 flex-col",
    );
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
    expect(consoleSource).toContain('src="/logo.png"');
    expect(consoleSource).toContain(
      "flex gap-2 overflow-x-auto overscroll-x-contain",
    );
    expect(consoleSource).toContain(
      "md:block md:min-h-0 md:flex-1 md:space-y-1.5",
    );
    expect(consoleSource).toContain("min-h-11 min-w-[8.25rem]");
    expect(consoleSource).toContain(
      "mt-2 flex shrink-0 gap-1.5 pt-0 md:mt-auto md:pt-2",
    );
    expect(consoleSource).toContain("메뉴 순서");
    expect(consoleSource).toContain("초기화");
    expect(consoleSource).toContain("aria-label={`${item.title} 메뉴 앞으로`}");
    expect(consoleSource).toContain("aria-label={`${item.title} 메뉴 뒤로`}");
    expect(consoleSource).toContain('aria-live="polite"');
    expect(preferenceRouteSource).toContain("SIDEBAR_ORDER_KEY");
    expect(preferenceRouteSource).toContain("admin_user_preferences");
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
      "grid-template-columns: fit-content(24rem) minmax(0, 1fr);",
    );
    expect(consoleSource).toContain("md:inline-flex");
    expect(consoleSource).toContain(
      '"flex gap-2 overflow-x-auto overscroll-x-contain',
    );
    expect(consoleSource).toContain("min-h-11 min-w-[8.25rem]");
    expect(consoleSource).toContain("p-2 sm:p-3 md:border-y-0 md:p-4");
    expect(consoleSource).toContain("min-h-[420px] flex-1");
    expect(consoleSource).toContain("overflow-visible md:overflow-hidden");
    expect(consoleSource).toContain("md:h-full md:min-h-0");
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
