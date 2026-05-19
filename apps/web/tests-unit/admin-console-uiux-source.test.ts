import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('admin console beginner-friendly UI/UX source contract', () => {
  test('keeps admin module state URL-backed and easy to recover', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('useSearchParams');
    expect(consoleSource).toContain('getAdminModuleIdFromSearchParams');
    expect(consoleSource).toContain('router.replace');
    expect(consoleSource).toContain('scroll: false');
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).not.toContain('window.history.replaceState');
  });

  test('removes repeated beginner guidance cards from the admin console', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).not.toContain('초보자 안내 강화');
    expect(consoleSource).not.toContain('BeginnerGuideCard');
    expect(consoleSource).not.toContain('처음 쓰는 관리자 안내');
    expect(consoleSource).not.toContain('무엇부터 보면 되는지 3단계로 정리했어요');
    expect(consoleSource).not.toContain('beginnerTip');
    expect(consoleSource).not.toContain('safetyTip');
    expect(consoleSource).not.toContain('처음이라면');
    expect(consoleSource).not.toContain('안전하게 처리하려면');
    expect(consoleSource).not.toContain('ModuleContextHeader');
  });

  test('keeps announcement operations safer and accessible inside the console', () => {
    const panelSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(panelSource).toContain('lastActionMessage');
    expect(panelSource).toContain('formError');
    expect(panelSource).toContain('저장 전 확인');
    expect(panelSource).toContain('게시 상태: {formData.isActive ?');
    expect(panelSource).toContain('홈 지도 배너: {formData.showOnBanner ?');
    expect(panelSource).toContain('공지 패널 닫기');
    expect(panelSource).toContain('첫 공지 페이지로 이동');
    expect(panelSource).toContain('이전 공지 페이지로 이동');
    expect(panelSource).toContain('다음 공지 페이지로 이동');
    expect(panelSource).toContain('마지막 공지 페이지로 이동');
    expect(panelSource).toContain('공지 작성 후 목록으로 돌아가기');
    expect(panelSource).toContain('수정 저장 후 목록으로 돌아가기');
    expect(panelSource).toContain('저장 중…');
    expect(panelSource).toContain('일반 50, 중요 80, 긴급 100을 권장합니다.');
    expect(panelSource).toContain('홈 배너에 노출');
    expect(panelSource).toContain('홈 배너에서 내리기');
    expect(panelSource).not.toContain('저장 중...');
  });

  test('keeps announcement read models shared while narrowing banner fetches', () => {
    const bannerHookSource = source('hooks/use-banner-announcements.tsx');

    expect(bannerHookSource).toContain('export function useActiveAnnouncements(enabled = true)');
    expect(bannerHookSource).toContain('export function useBannerAnnouncements(enabled = true)');
    expect(bannerHookSource).toContain('fetchSupabaseRows');
    expect(bannerHookSource).toContain('ANNOUNCEMENT_SELECT');
    expect(bannerHookSource).toContain('AnnouncementRow');
    expect(bannerHookSource).toContain("['show_on_banner', 'eq.true']");
    expect(bannerHookSource).toContain('BANNER_ANNOUNCEMENTS_STALE_TIME_MS');
    expect(bannerHookSource).not.toContain('@/hooks/use-announcements');
  });

  test('keeps the restaurant evaluation detail panel operator-focused and uncluttered', () => {
    const detailSource = source('components/admin/EvaluationDetailView.tsx');

    expect(detailSource).toContain('title="영상 근거"');
    expect(detailSource).toContain('title="검수 결과"');
    expect(detailSource).toContain('title="음식점 상세"');
    expect(detailSource).toContain('review -> decision capture -> guarded apply');
    expect(detailSource).toContain('aria-label="영상 근거와 메타 정보"');
    expect(detailSource).toContain('focus-visible:ring-primary');
    expect(detailSource).not.toContain('📹 영상 정보');
    expect(detailSource).not.toContain('📊 평가 상세');
    expect(detailSource).not.toContain('🍽️ 음식점 상세 정보');
    expect(detailSource).not.toContain('bg-white rounded-lg border p-3 shadow-sm');
    expect(detailSource).not.toContain('Reasoning Basis</h4>');
    expect(detailSource).not.toContain('Tzuyang Review</h4>');
  });

  test('keeps the admin overview as a viewport-bounded two-pane map console', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('fetchAdminMapRestaurants');
    expect(consoleSource).toContain('AdminMapOverviewCanvas');
    expect(consoleSource).toContain('AdminNaverMapSurface');
    expect(consoleSource).toContain('AdminMapInfoPanel');
    expect(consoleSource).toContain('aria-label="관리자 지도 운영 개요 2분할"');
    expect(consoleSource).toContain('xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]');
    expect(consoleSource).toContain('useNaverMaps');
    expect(consoleSource).toContain('getNaverIndividualMarkerVisual');
    expect(consoleSource).toContain('new maps.Map');
    expect(consoleSource).toContain('new maps.Marker');
    expect(consoleSource).toContain('createClusterIndex');
    expect(consoleSource).toContain('getClusterCategories');
    expect(consoleSource).not.toContain('pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5');
    expect(consoleSource).not.toContain('홈 마커·클러스터 재사용');
    expect(consoleSource).toContain('function AdminMapLoadingSkeleton');
    expect(consoleSource).toContain('aria-label="관리자 네이버 지도 로딩"');
    expect(consoleSource).toContain('지도 준비 중');
    expect(consoleSource).not.toContain('w-full max-w-xs space-y-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm');
    expect(consoleSource).not.toContain('background-image:linear-gradient');
    expect(consoleSource).not.toContain('skeletonMarkers');
    expect(consoleSource).not.toContain('rotate-[-11deg]');
    expect(consoleSource).not.toContain('ADMIN_MAP_MOCK_RESTAURANTS');
    expect(consoleSource).not.toContain('목업 데이터');
    expect(consoleSource).toContain('표시할 좌표 맛집이 없습니다');
    expect(consoleSource).not.toContain('overflow-y-auto lg:overflow-hidden');
    expect(consoleSource).not.toContain('overflow-visible md:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden');
    expect(consoleSource).not.toContain('Tzudong admin map');
    expect(consoleSource).not.toContain('Selected marker');
    expect(consoleSource).not.toContain('getRestaurantMarkerStyle');
    expect(consoleSource).toContain('쯔동여지도 홈 · 관리자 전용');
    expect(consoleSource).toContain('마커 선택 가능');
    expect(consoleSource).toContain('운영 정보');
    expect(consoleSource).toContain('동선 추천 초안');
    expect(consoleSource).not.toContain('1분할');
    expect(consoleSource).not.toContain('3분할');
    expect(consoleSource).not.toContain('4분할');
  });

  test('keeps all admin skeletons compact and layout-faithful', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const adminLoadingSource = source('app/admin/loading.tsx');
    const routeSkeletonSource = source('app/admin/evaluations/page.tsx');
    const evaluationTableSource = source('components/admin/EvaluationTableNew.tsx');
    const submissionListSource = source('components/admin/SubmissionListView.tsx');
    const usersSource = source('components/admin/AdminUsersPanel.tsx');

    expect(consoleSource).not.toContain('aria-label={`${title} 작업 화면 준비 상태`}');
    expect(consoleSource).not.toContain('Array.from({ length: 6 }).map((_, index) => (');
    expect(adminLoadingSource).toContain('return null;');
    expect(adminLoadingSource).toContain('모듈별 스켈레톤만 한 번');
    expect(consoleSource).not.toContain('AdminConsoleLoadingSkeleton');
    expect(consoleSource).toContain('if (authLoading) {');
    expect(consoleSource).toContain('return null;');
    expect(adminLoadingSource).not.toContain('AdminConsoleLoadingSkeleton');
    expect(consoleSource).toContain('lg:w-48');
    expect(consoleSource).not.toContain('lg:w-[280px]');
    expect(consoleSource).not.toContain('bg-gradient-to-br from-card via-card to-primary/5 p-3');
    expect(routeSkeletonSource).toContain('className="flex h-full min-h-0 flex-col overflow-hidden"');
    expect(routeSkeletonSource).toContain('lg:grid-cols-[40px_minmax(180px,1fr)_repeat(6,78px)_112px]');
    expect(routeSkeletonSource).not.toContain('repeat(8,96px)');
    expect(consoleSource).toContain('role="status"');
    expect(evaluationTableSource).toContain('aria-label="맛집 검수 카드 로딩 중"');
    expect(evaluationTableSource).toContain('role="status" aria-busy="true" aria-label="맛집 검수 카드 로딩 중"');
    expect(evaluationTableSource).toContain('Array.from({ length: 4 }).map');
    expect(evaluationTableSource).toContain('const desktopLoadingRows = Array.from({ length: 6 })');
    expect(submissionListSource).toContain('Array.from({ length: 4 }).map');
    expect(submissionListSource).toContain('grid gap-2 sm:grid-cols-[minmax(0,1fr)_80px_72px]');
    expect(submissionListSource).toContain('role="status" aria-busy="true" aria-label={`${label} 목록 로딩 중`}');
    expect(usersSource).toContain('role="status" aria-busy="true" aria-label="사용자 목록 로딩 중"');
    expect(usersSource).toContain('function UserTableSkeleton');
    expect(usersSource).toContain('<caption className="sr-only">관리자 사용자 목록 로딩</caption>');
    expect(usersSource).toContain('<th scope="col" className="px-3 py-2 font-semibold">사용자</th>');
    expect(usersSource).toContain('block min-w-0 text-left');
    expect(usersSource).toContain('inline-flex h-9 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium');
    expect(usersSource).toContain('Badge variant="outline" className="border-border bg-background text-muted-foreground"');
    expect(usersSource).not.toContain('h-8 w-14 rounded-lg motion-reduce:animate-none');
    expect(usersSource).not.toContain('h-10 rounded-lg motion-reduce:animate-none');
  });


  test('keeps overview reference widgets uncluttered and source-honest', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('실제 이동시간 API가 붙기 전까지는');
    expect(consoleSource).toContain('승인 맛집과 연결된 데이터가 있을 때만 표시합니다.');
    expect(consoleSource).toContain('향후 유튜버 A');
    expect(consoleSource).toContain('향후 유튜버 B');
    expect(consoleSource).not.toContain('ADMIN_OVERVIEW_WIDGET_STORAGE_KEY');
    expect(consoleSource).not.toContain('normalizeAdminOverviewWidgetOrder');
    expect(consoleSource).not.toContain('moveAdminOverviewWidget');
    expect(consoleSource).not.toContain('window.localStorage.setItem');
    expect(consoleSource).not.toContain('hasLoadedWidgetOrder');
    expect(consoleSource).not.toContain('aria-label="개요 위젯 순서 조정"');
    expect(consoleSource).not.toContain('위로 이동');
    expect(consoleSource).not.toContain('아래로 이동');
    expect(consoleSource).not.toContain('기본 순서');
    expect(consoleSource).not.toContain('function buildMetricSeries');
  });

  test('does not render an admin access gate for non-admin visitors', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const middlewareSource = source('lib/supabase/middleware.ts');

    expect(consoleSource).toContain('router.replace("/")');
    expect(consoleSource).toContain('if (!user || !isAdmin)');
    expect(consoleSource).toContain('return null;');
    expect(consoleSource).not.toContain('function AdminAccessGate');
    expect(consoleSource).not.toContain('관리자 로그인이 필요합니다');
    expect(consoleSource).not.toContain('관리자 권한이 필요합니다');
    expect(consoleSource).not.toContain('로그인 창 열기');
    expect(consoleSource).not.toContain('AUTH_UI_REQUEST_EVENT');
    expect(middlewareSource).toContain('isAdminPageRequest');
    expect(middlewareSource).toContain("pathname === '/admin' || pathname.startsWith('/admin/')");
    expect(middlewareSource).toContain("eq('role', 'admin')");
    expect(middlewareSource).toContain("new URL('/auth/required', request.url)");
    expect(middlewareSource).toContain("redirectUrl.searchParams.set('reason', 'admin')");
  });

  test('keeps unified admin console as the single operator shell', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const adminPageSource = source('app/admin/page.tsx');

    expect(adminPageSource).toContain('<AdminConsoleOverview />');
    for (const moduleId of ['"restaurants"', '"submissions"', '"reviews"', '"storyboard"', '"banners"', '"announcements"', '"users"', '"insights"', '"audit"', '"llm"']) {
      expect(consoleSource).toContain(moduleId);
    }
    expect(consoleSource).toContain('sidebarSections');
    expect(consoleSource).toContain('aria-label="관리자 통합 메뉴"');
    expect(consoleSource).toContain('aria-label="관리자 콘솔 작업 화면"');
  });

  test('keeps admin console keyboard and screen-reader navigation intact', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('href="#admin-console-canvas"');
    expect(consoleSource).toContain('작업 화면으로 건너뛰기');
    expect(consoleSource).toContain('tabIndex={-1}');
    expect(consoleSource).toContain('canvasRef.current?.focus({ preventScroll: true })');
    expect(consoleSource).toContain('aria-current={isActive ? "page" : undefined}');
    expect(consoleSource).toContain('aria-controls="admin-console-canvas"');
    expect(consoleSource).toContain('aria-expanded={!isCollapsed}');
    expect(consoleSource).toContain('aria-pressed={isCollapsed}');
    expect(consoleSource).toContain('<p className="sr-only" aria-live="polite">');
  });
  test('keeps announcements above banners in the admin sidebar default order', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource.indexOf('id: "announcements"')).toBeLessThan(consoleSource.indexOf('id: "banners"'));
    expect(consoleSource).toContain('["announcements", "storyboard", "banners", "users", "insights", "audit"]');
    expect(source('app/api/admin/preferences/sidebar-order/route.ts')).toContain("운영: ['announcements', 'storyboard', 'banners', 'users', 'insights', 'audit']");
  });


  test('adds storyboard generation as an operator-controlled admin module', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const storyboardSource = source('components/admin/storyboard/AdminStoryboardGenerator.tsx');
    const routeSource = source('app/api/admin/storyboard/route.ts');
    const generatorSource = source('lib/admin/storyboard/generator.ts');

    expect(consoleSource).toContain('id: "storyboard"');
    expect(consoleSource).toContain('스토리보드 생성');
    expect(consoleSource).toContain('AdminStoryboardGenerator');
    expect(storyboardSource).toContain('/api/admin/storyboard');
    expect(storyboardSource).toContain('회의용 Markdown 복사');
    expect(storyboardSource).toContain('위원회 AHP 평가');
    expect(routeSource).toContain('await requireAdmin()');
    expect(routeSource.indexOf('await requireAdmin()')).toBeLessThan(routeSource.indexOf('const result = generateLocalStoryboard'));
    expect(generatorSource).toContain('backend/storyboard-agent');
    expect(generatorSource).toContain('most_replayed_markers');
    expect(generatorSource).toContain('TZUYANG_HEATMAP_DIR');
  });

  test('lets admins reorder the sidebar without polluting the two-pane map overview', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const preferenceRouteSource = source('app/api/admin/preferences/sidebar-order/route.ts');
    const overviewSource = consoleSource.slice(
      consoleSource.indexOf('function AdminOverviewDashboard'),
      consoleSource.indexOf('function LlmSessionPanel'),
    );

    expect(consoleSource).toContain('DEFAULT_ADMIN_SIDEBAR_ORDER');
    expect(consoleSource).toContain('normalizeAdminSidebarOrder');
    expect(consoleSource).toContain('moveAdminSidebarSection');
    expect(consoleSource).toContain('moveAdminSidebarItem');
    expect(consoleSource).toContain('buildOrderedSidebarSections');
    expect(consoleSource).toContain('aria-controls="admin-sidebar-order-editor"');
    expect(consoleSource).toContain('sticky top-0 z-30 flex w-full shrink-0 flex-col');
    expect(consoleSource).toContain('isCollapsed && "lg:min-h-9 lg:w-full lg:items-center lg:justify-center lg:border-b-0 lg:px-0 lg:pb-1"');
    expect(consoleSource).toContain('isCollapsed && "lg:hidden"');
    expect(consoleSource).toContain('flex gap-2 overflow-x-auto overscroll-x-contain');
    expect(consoleSource).toContain('lg:block lg:min-h-0 lg:flex-1 lg:space-y-1.5');
    expect(consoleSource).toContain('min-h-11 min-w-[8.25rem]');
    expect(consoleSource).toContain('mt-2 shrink-0 pt-0 lg:mt-auto lg:pt-2');
    expect(consoleSource).toContain('메뉴 순서');
    expect(consoleSource).toContain('초기화');
    expect(consoleSource).toContain('aria-label={`${item.title} 메뉴 앞으로`}');
    expect(consoleSource).toContain('aria-label={`${item.title} 메뉴 뒤로`}');
    expect(consoleSource).toContain('aria-live="polite"');
    expect(preferenceRouteSource).toContain('SIDEBAR_ORDER_KEY');
    expect(preferenceRouteSource).toContain('admin_user_preferences');
    expect(preferenceRouteSource).toContain('await requireAdmin()');
    expect(preferenceRouteSource.indexOf('await requireAdmin()')).toBeLessThan(preferenceRouteSource.indexOf('createSupabaseServiceRoleClient()'));
    expect(preferenceRouteSource).toContain('normalizeAdminSidebarOrder');
    expect(overviewSource).not.toContain('메뉴 순서');
    expect(consoleSource).not.toContain('/admin/users');
  });


  test('cleans stale admin module query state and canonicalizes invalid modules', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('buildCanonicalAdminModuleHref');
    expect(consoleSource).toContain('getAdminModuleStateWarning');
    expect(consoleSource).toContain('알 수 없는 관리자 화면 요청을 개요로 되돌렸습니다.');
    expect(consoleSource).toContain('router.replace(buildCanonicalAdminModuleHref(moduleId)');
    expect(consoleSource).toContain('const canonicalHref = buildCanonicalAdminModuleHref(nextModuleId);');
    expect(consoleSource).toContain('currentHref !== canonicalHref');
    expect(consoleSource).toContain('router.replace(canonicalHref, { scroll: false });');
    expect(consoleSource).not.toContain('const params = new URLSearchParams(window.location.search);');
    expect(consoleSource).not.toContain('window.location.hash');
  });

  test('keeps admin overview as only two source-honest map panes', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const overviewSource = consoleSource.slice(
      consoleSource.indexOf('function AdminOverviewDashboard'),
      consoleSource.indexOf('function LlmSessionPanel'),
    );

    expect(overviewSource).toContain('aria-label="관리자 지도 운영 개요 2분할"');
    expect(overviewSource).toContain('AdminMapOverviewCanvas');
    expect(overviewSource).toContain('AdminMapInfoPanel');
    expect(consoleSource).toContain('요약 API가 실패하면 임의 수치를 만들지 않습니다.');
    expect(consoleSource).toContain('const restaurants = realRestaurants;');
    expect(consoleSource).toContain('운영 콘솔에서는 빈 실데이터 상태를 목업으로 대체하지 않습니다.');
    expect(consoleSource).toContain('실제 이동시간 API가 붙기 전까지는');
    expect(consoleSource).toContain('채널별 레이어 확장 슬롯');
    expect(overviewSource).not.toContain('오늘 처리할 일');
    expect(overviewSource).not.toContain('제보·리뷰·맛집 검수 상태를 먼저 확인합니다.');
    expect(overviewSource).not.toContain('제보 검토');
    expect(overviewSource).not.toContain('리뷰 검수');
    expect(overviewSource).not.toContain('맛집·좌표 확인');
    expect(overviewSource).not.toContain('운영 상태 요약');
    expect(overviewSource).not.toContain('참고 운영 정보');
    expect(overviewSource).not.toContain('aria-label="관리자 대시보드 4분할"');
    expect(consoleSource).not.toContain('관리자 콘솔 · 실시간 운영 개요');
    expect(consoleSource).not.toContain('OpsTruthBadge');
    expect(consoleSource).not.toContain('PendingFeatureCard');
    expect(consoleSource).not.toContain('Realtime 준비');
    expect(consoleSource).not.toContain('function WidgetShell');
    expect(consoleSource).not.toContain('function LatestTzuyangVideosWidget');
  });

  test('keeps selected marker detail split between compact info and YouTube evidence', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).toContain('function getAdminYoutubeThumbnailUrl');
    expect(consoleSource).toContain('function AdminYoutubeThumbnailImage');
    expect(consoleSource).toContain('quality: "maxresdefault" | "hqdefault" = "maxresdefault"');
    expect(consoleSource).toContain('setQuality("hqdefault")');
    expect(consoleSource).toContain('sizes="(min-width: 1280px) 240px, (min-width: 640px) 50vw, 100vw"');
    expect(consoleSource).toContain('sm:grid-cols-2');
    expect(consoleSource).toContain('aria-label="선택 마커 작업"');
    expect(consoleSource.indexOf('aria-label="선택 마커 작업"')).toBeGreaterThan(consoleSource.indexOf('selectedCoordinateText'));
    expect(consoleSource.indexOf('aria-label="선택 마커 작업"')).toBeLessThan(consoleSource.indexOf('연결 영상 썸네일'));
    expect(consoleSource).toContain('연결 영상 썸네일');
    expect(consoleSource).toContain('원본 YouTube 영상 새 탭에서 열기');
    expect(consoleSource).toContain('영상 연결 없음');
    expect(consoleSource).not.toContain('selectedMetaItems.map');
  });

  test('removes repeated embedded module context headers from the admin canvas', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');

    expect(consoleSource).not.toContain('이 화면에서 처리 · {module.badge}');
    expect(consoleSource).not.toContain('독립 라우트 보존');
    expect(consoleSource).not.toContain('문서 스크롤 없음');
    expect(consoleSource).not.toContain('module.description');
    expect(consoleSource).toContain('aria-label={`${module.title} 작업 화면`}');
    expect(consoleSource).toContain('사용자 권한 변경 감사는 저장되며');
  });

  test('keeps admin pages dense without sacrificing responsive boundaries', () => {
    const consoleSource = source('components/admin/AdminConsoleOverview.tsx');
    const usersSource = source('components/admin/AdminUsersPanel.tsx');
    const evaluationsSource = source('app/admin/evaluations/page.tsx');
    const bannersSource = source('app/admin/banners/page.tsx');
    const announcementSource = source('components/announcement/AnnouncementPanel.tsx');

    expect(consoleSource).toContain('lg:w-48');
    expect(consoleSource).toContain('cn("flex gap-2 overflow-x-auto overscroll-x-contain');
    expect(consoleSource).toContain('min-h-11 min-w-[8.25rem]');
    expect(consoleSource).toContain('p-2 sm:p-2 lg:border-y-0 lg:p-2 xl:p-2');
    expect(consoleSource).toContain('min-h-[420px] flex-1');
    expect(consoleSource).toContain('overflow-visible lg:overflow-hidden');
    expect(consoleSource).toContain('overflow-visible xl:h-full xl:min-h-0');
    expect(consoleSource).toContain('flex h-full min-h-0 flex-col bg-background');
    expect(usersSource).toContain('flex h-full min-h-0 flex-col bg-background');
    expect(usersSource).toContain('gap-2 overflow-y-auto p-2');
    expect(usersSource).toContain('h-9 rounded-lg pl-9');
    expect(usersSource).toContain('const loadUsers = useCallback(async (signal?: AbortSignal)');
    expect(usersSource).toContain('return () => controller.abort();');
    expect(usersSource).toContain('if (!signal?.aborted)');
    expect(evaluationsSource).toContain('embedded ? "border-b border-border bg-card px-2 py-1.5"');
    expect(evaluationsSource).toContain('p-2 sm:p-2');
    expect(consoleSource).toContain('const AdminBannerModule = dynamic(() => import("@/app/admin/banners/page"), {');
    expect(consoleSource).toContain('const AdminAnnouncementModule = dynamic(() => import("@/components/announcement/AnnouncementPanel"), {');
    expect(consoleSource).toContain('const AdminUsersModule = dynamic(() => import("@/components/admin/AdminUsersPanel"), {');
    expect(consoleSource).toContain('ssr: false,');
    expect(consoleSource).not.toContain('loading: () => <InlineModuleLoading');
    expect(consoleSource).not.toContain('loading: () => <InlineEvaluationModuleSkeleton');
    expect(consoleSource).not.toContain('InlineModuleLoading');
    expect(consoleSource).not.toContain('InlineEvaluationModuleSkeleton');
    expect(consoleSource).not.toContain('화면 구조 준비 중');
    expect(consoleSource).not.toContain('INLINE_MODULE_LOADING_ROW_COUNT');
    expect(consoleSource).not.toContain('배너 관리 화면 준비 중');
    expect(consoleSource).not.toContain('공지사항 운영 화면 준비 중');
    expect(consoleSource).not.toContain('사용자 관리 화면 준비 중');
    expect(bannersSource).toContain('embedded ? "px-2 py-1.5"');
    expect(bannersSource).toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(bannersSource).toContain('bannersLoading ? <InlineCountSkeleton /> : sortedBanners.length');
    expect(bannersSource).toContain('aria-label="배너 목록 로딩 중"');
    expect(bannersSource).toContain('function BannerListItemSkeleton');
    expect(bannersSource).toContain('<BannerListItemSkeleton key={index} index={index} />');
    expect(bannersSource).toContain('relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border');
    expect(bannersSource).toContain('Badge variant="secondary" className="rounded-full text-[10px]"');
    expect(bannersSource).not.toContain('bannersLoading && <Loader2');
    expect(bannersSource).toContain('모달 없이 선택·편집·삭제를 이 패널에서 처리합니다.');
    expect(bannersSource).toContain("deleteConfirmation !== '배너삭제'");
    expect(bannersSource).toContain('await deleteBanner.mutateAsync(bannerToDelete.id)');
    expect(bannersSource.indexOf('await deleteBanner.mutateAsync(bannerToDelete.id)')).toBeLessThan(bannersSource.indexOf('const mediaUrls = [bannerToDelete.image_url, bannerToDelete.video_url]'));
    expect(bannersSource).not.toContain('role="listitem"');
    expect(bannersSource).not.toContain('<Dialog');
    expect(bannersSource).not.toContain('<AlertDialog');
    expect(announcementSource).toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(announcementSource).toContain('isAnnouncementsLoading ? <InlineCountSkeleton /> : allDisplayAnnouncements.length');
    expect(announcementSource).toContain('aria-label="공지사항 목록 로딩 중"');
    expect(announcementSource).toContain('function AnnouncementListItemSkeleton');
    expect(announcementSource).toContain('<AnnouncementListItemSkeleton key={index} index={index} />');
    expect(announcementSource).toContain('mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground');
    expect(announcementSource).toContain('shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground');
    expect(announcementSource).toContain("toggleConfirmation !== '상태변경'");
    expect(announcementSource).toContain("toggleConfirmation !== '배너변경'");
    expect(announcementSource).not.toContain('role="listitem"');
    expect(announcementSource).not.toContain('confirm(`');
    expect(consoleSource).not.toContain('module.id === "banners" || module.id === "announcements" || module.id === "users" ? "overflow-y-auto" : "overflow-hidden"');
    expect(consoleSource).not.toContain('관리자 운영 콘솔');
    expect(consoleSource).not.toContain('안전한 CRUD 흐름');
    expect(consoleSource).not.toContain('audit source');
    expect(consoleSource).not.toContain('lg:w-52');
    expect(usersSource).not.toContain('min-h-[560px]');
    expect(usersSource).toContain('isLoading ? <span className="inline-block h-6 w-12 rounded-full bg-muted/70 align-middle animate-pulse motion-reduce:animate-none"');
    expect(usersSource).not.toContain("value={isLoading ? '—' : summary.loadedUsers}");
  });

  test('hardens risky admin submission and OCR actions with typed confirmations', () => {
    const submissionSource = source('components/admin/SubmissionListView.tsx');
    const resetAllSource = source('app/api/admin/ocr-receipts/reset-all/route.ts');

    expect(submissionSource).toContain("const SUBMISSION_DELETE_CONFIRMATION = '제보삭제'");
    expect(submissionSource).toContain("const REVIEW_DELETE_CONFIRMATION = '리뷰삭제'");
    expect(submissionSource).toContain("const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'");
    expect(submissionSource).toContain("const OVERRIDE_APPROVAL_CONFIRMATION = '무시승인'");
    expect(submissionSource).toContain('xl:grid-cols-[minmax(330px,0.95fr)_minmax(420px,1.05fr)]');
    expect(submissionSource).toContain('aria-label="제보 상세 작업 패널"');
    expect(submissionSource).toContain('aria-label="리뷰 상세 작업 패널"');
    expect(submissionSource).toContain('submissionDeleteConfirmation !== SUBMISSION_DELETE_CONFIRMATION');
    expect(submissionSource).toContain('reviewDeleteConfirmation !== REVIEW_DELETE_CONFIRMATION');
    expect(submissionSource).toContain('ocrResetConfirmation !== OCR_RESET_ALL_CONFIRMATION');
    expect(submissionSource).toContain('openSubmissionDetail(submission);');
    expect(submissionSource).toContain("setReviewAction(null);");
    expect(submissionSource).toContain("setReviewAdminNote(review.admin_note || '');");
    expect(submissionSource).not.toContain('window.prompt(');
    expect(submissionSource).not.toContain('<Dialog');
    expect(submissionSource).not.toContain('ADMIN_MODAL_');
    expect(submissionSource).toContain('disabled={overrideApprovalConfirmation !== OVERRIDE_APPROVAL_CONFIRMATION}');
    expect(submissionSource).toContain('if (forceApprove) {');
    expect(submissionSource).toContain("setOverrideApprovalConfirmation('');");
    expect(submissionSource).toContain('setShowWarningModal(true);');
    expect(submissionSource).toContain('검증 경고 확인 후 승인');
    expect(submissionSource).toContain('renderOverrideApprovalPanel');
    expect(submissionSource).not.toContain('verificationDone || forceApprove');
    expect(submissionSource.indexOf('if (forceApprove) {')).toBeLessThan(submissionSource.indexOf('if (verificationDone) {'));
    expect(submissionSource.indexOf("setOverrideApprovalConfirmation('');")).toBeLessThan(submissionSource.indexOf('setShowWarningModal(true);'));
    expect(submissionSource).toContain('body: JSON.stringify({ confirmation: OCR_RESET_ALL_CONFIRMATION })');
    expect(resetAllSource).toContain("const OCR_RESET_ALL_CONFIRMATION = 'OCR초기화'");
    expect(resetAllSource).toContain('body.confirmation !== OCR_RESET_ALL_CONFIRMATION');
    expect(resetAllSource).toContain('OCR 전체 초기화 확인 문구가 일치하지 않습니다.');
    expect(resetAllSource).toContain('workflowPreflightResponse');
    expect(resetAllSource).toContain('partialFailure: true');
    expect(resetAllSource.indexOf('if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO)')).toBeLessThan(resetAllSource.indexOf('const supabase = createSupabaseServiceRoleClient()'));
    expect(resetAllSource.indexOf('workflowPreflightResponse')).toBeLessThan(resetAllSource.indexOf('const supabase = createSupabaseServiceRoleClient()'));
    expect(submissionSource).not.toContain("confirm('정말 이 제보를 삭제하시겠습니까?')");
    expect(submissionSource).not.toContain("confirm('정말 이 리뷰를 삭제하시겠습니까?')");
    expect(submissionSource).not.toContain("confirm('모든 리뷰의 OCR을 초기화하고 다시 실행합니다. 계속하시겠습니까?')");
  });

});
