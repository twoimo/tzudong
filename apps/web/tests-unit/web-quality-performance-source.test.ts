import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, "..", relativePath), "utf8");
const exists = (relativePath: string) =>
  existsSync(join(import.meta.dir, "..", relativePath));
const sourceFilesUnder = (relativeDir: string): string[] => {
  const absoluteDir = join(import.meta.dir, "..", relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules") return [];
      return sourceFilesUnder(relativePath);
    }

    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [relativePath] : [];
  });
};

describe("web quality performance source contracts", () => {
  test("map marker HTML keeps image markers with WebP delivery and PNG fallback", () => {
    const clusterMarkerSource = source("lib/cluster-marker.ts");

    expect(clusterMarkerSource).toContain("CATEGORY_IMAGES");
    expect(clusterMarkerSource).toContain(
      "/images/maker-images/webp/${name}.webp",
    );
    expect(clusterMarkerSource).toContain("/images/maker-images/${name}.png");
    expect(clusterMarkerSource).toContain('type="image/webp"');
    expect(clusterMarkerSource).toContain('src="${image.png}"');
    expect(clusterMarkerSource).toContain('srcset="${image.webp}"');
    expect(clusterMarkerSource).not.toContain("createCategoryMarkerGlyphHTML");
  });

  test("map marker WebP assets are present and substantially smaller than PNG fallbacks", () => {
    const markerDir = join(import.meta.dir, "..", "public/images/maker-images");
    const webpDir = join(markerDir, "webp");
    const pngFiles = readdirSync(markerDir).filter((file) =>
      file.endsWith(".png"),
    );

    expect(pngFiles.length).toBeGreaterThan(0);

    let pngTotal = 0;
    let webpTotal = 0;

    for (const file of pngFiles) {
      const pngPath = join(markerDir, file);
      const webpPath = join(webpDir, file.replace(/\.png$/, ".webp"));

      expect(existsSync(webpPath)).toBe(true);
      pngTotal += statSync(pngPath).size;
      webpTotal += statSync(webpPath).size;
    }

    expect(webpTotal).toBeLessThan(pngTotal * 0.1);
  });

  test("popup ad banners are deferred out of the initial CWV window and inactive media has no src", () => {
    const popupSource = source("components/layout/CombinedPopup.tsx");
    const hookSource = source("hooks/use-ad-banners.tsx");

    expect(popupSource).toContain("POPUP_BANNER_IDLE_DELAY_MS = 30000");
    expect(popupSource).toContain(
      "usePopupAdBanners({ enabled: canLoadBanners })",
    );
    expect(popupSource).toContain(
      "src={isActive ? banner.video_url : undefined}",
    );
    expect(popupSource).toContain("banner.image_url && isActive");
    expect(popupSource).toContain(
      "['pointerdown', 'keydown', 'wheel', 'touchstart']",
    );
    expect(hookSource).toContain("options: { enabled?: boolean } = {}");
    expect(hookSource).toContain("enabled: options.enabled ?? true");
  });

  test("home filter count queries run before dropdown open so triggers do not show stale zero counts", () => {
    const regionSelectorSource = source("components/region/RegionSelector.tsx");
    const categoryFilterSource = source(
      "components/filters/CategoryFilter.tsx",
    );

    expect(regionSelectorSource).toContain("queryKey: ['restaurants-count']");
    expect(regionSelectorSource).toContain("enabled: true,");
    expect(regionSelectorSource).not.toContain("enabled: isOpen,");
    expect(categoryFilterSource).toContain("queryKey: categoryQueryKey");
    expect(categoryFilterSource).toContain(
      "? ['restaurants-categories', selectedRegion, selectedCountry]",
    );
    expect(categoryFilterSource).toContain(": ['restaurants-count']");
    expect(categoryFilterSource).toContain("enabled: true,");
    expect(categoryFilterSource).not.toContain("enabled: isOpen,");
    expect(regionSelectorSource).toContain("contentSide?:");
    expect(regionSelectorSource).toContain("z-[180]");
    expect(regionSelectorSource).toContain("<span className=\"whitespace-nowrap\">대한민국</span>");
    expect(regionSelectorSource).not.toContain("<span>전국</span>");
    expect(categoryFilterSource).toContain("contentSide?:");
    expect(categoryFilterSource).toContain("카테고리 검색…");
    expect(categoryFilterSource).toContain("z-[180]");
    expect(categoryFilterSource).toContain("rounded-2xl border-border bg-card");
  });

  test("home map runtime renders directly while supporting queries stay intent-gated", () => {
    const pageSource = source("app/page.tsx");
    const homeClientSource = source("app/home-client.tsx");
    const homeRuntimeShellSource = source("app/home-runtime-shell.tsx");
    const homeClientSidePanelsSource = source("app/home-client-sidepanels.tsx");
    const restaurantSearchSource = source(
      "components/search/RestaurantSearch.tsx",
    );
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const mobileNotificationSource = source(
      "components/home/MobileNotificationMenuButton.tsx",
    );
    const homeControlPanelSource = source(
      "components/home/home-control-panel.tsx",
    );
    const homeDesktopControlPanelSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );
    const desktopLeftPanelMapHomeSource = source(
      "components/home/DesktopLeftPanelMapHome.tsx",
    );
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const popularRestaurantsSource = source("lib/popular-restaurants.ts");
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const desktopBookmarksSource = source(
      "components/home/DesktopLeftPanelBookmarks.tsx",
    );
    const desktopNotificationsSource = source(
      "components/home/DesktopLeftPanelNotifications.tsx",
    );
    const homeClientEffectsSource = source("app/home-client-effects.tsx");
    const homeViewportModeSource = source("hooks/useHomeViewportMode.ts");
    const regionSelectorSource = source("components/region/RegionSelector.tsx");
    const categoryFilterSource = source(
      "components/filters/CategoryFilter.tsx",
    );
    const mapQuerySource = source("lib/map-query-helpers.ts");
    const naverMapSource = source("components/map/NaverMapView.tsx");
    const mapViewSidepanelsSource = source("components/map/map-view-sidepanels.tsx");
    const naverMapSidepanelsSource = source("components/map/naver-map-sidepanels.tsx");
    const headerSource = source("components/layout/Header.tsx");
    const bannerAnnouncementsHookSource = source(
      "hooks/use-banner-announcements.tsx",
    );
    const deviceTypeSource = source("hooks/useDeviceType.ts");
    const mapIndicatorsSource = source(
      "components/map/naver-map-overlay-indicators.tsx",
    );
    const mapOverlayNoticeSource = source(
      "components/map/map-overlay-notice.tsx",
    );
    const mapViewIndicatorsSource = source(
      "components/map/map-view-overlay-indicators.tsx",
    );
    const overlayStackSource = source(
      "components/map/naver-map-overlay-stack.tsx",
    );
    const overlayPositionSource = source(
      "lib/naver-map-overlay-position-helpers.ts",
    );
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const floatingNavSource = source(
      "components/layout/FloatingNavButtons.tsx",
    );

    expect(pageSource).toContain(
      "import { HomeRuntimeShell } from './home-runtime-shell'",
    );
    expect(pageSource).toContain("import HomeClient from './home-client'");
    expect(pageSource).toContain("<HomeRuntimeShell>");
    expect(pageSource).toContain("<HomeClient />");
    expect(pageSource).not.toContain("<HomeInitialShell />");
    expect(pageSource).not.toContain("homeFrameBootstrap");
    expect(pageSource).not.toContain("homeDeepLinkPreviewBootstrap");
    expect(pageSource).not.toContain(
      "frame.src = '/home-frame' + window.location.search + window.location.hash",
    );
    expect(pageSource).not.toContain("function HomeDeepLinkPreview()");
    expect(pageSource).not.toContain('id="home-deep-link-preview"');
    expect(pageSource).not.toContain("searchParams: Promise");
    expect(pageSource).not.toContain("export default async function HomePage");
    expect(pageSource).not.toContain("fetchHomeDeepLinkPreviewRestaurant");
    expect(pageSource).not.toContain(
      "fetchSupabaseRows<HomeDeepLinkPreviewRestaurant>",
    );
    expect(pageSource).not.toContain("HomeLandingShell");
    expect(pageSource).not.toContain("HomeMapIsland");
    expect(pageSource).not.toContain("지도 준비하기");
    expect(source("app/home-frame/page.tsx")).toContain("<HomeRuntimeShell>");
    expect(source("app/home-frame/page.tsx")).toContain("<HomeClient />");
    expect(source("proxy.ts")).not.toContain(
      "NextResponse.rewrite(new URL('/home-static.html', request.url))",
    );
    expect(source("proxy.ts")).not.toContain("isRootPageRequest");
    expect(source("proxy.ts")).toContain("'/'");
    expect(source("proxy.ts")).toContain("'/home-frame'");
    expect(exists("app/home-initial-shell.tsx")).toBe(false);
    expect(exists("public/home-static.html")).toBe(false);
    expect(homeClientSource).toContain("<HomeMapContainer");
    expect(homeClientSource).toContain("<HomeControlPanel");
    expect(homeClientSource).toContain("isPanelCollapsed={isPanelCollapsed}");
    expect(homeClientSource).toContain("desktopMapLayout={desktopMapLayout}");
    expect(homeClientSource).toContain("desktopPanelSide={desktopPanelSide}");
    expect(homeClientSource).toContain("setDesktopMapLayout(preferences.desktopMapLayout)");
    expect(homeClientSource).toContain("setDesktopPanelSide(preferences.desktopPanelSide)");
    expect(homeClientSource).toContain("setDesktopMapLayout(customEvent.detail.preferences.desktopMapLayout)");
    expect(homeClientSource).toContain("setDesktopPanelSide(customEvent.detail.preferences.desktopPanelSide)");
    expect(homeClientSource).toContain(
      "onTogglePanelCollapse={togglePanelCollapse}",
    );
    expect(homeClientSource.indexOf("<HomeMapContainer")).toBeLessThan(
      homeClientSource.indexOf(
        "{isViewportResolved && !(isMobileOrTablet && isMapFullscreen)",
      ),
    );
    expect(source("components/home/home-map-container.tsx")).not.toContain(
      "import { useRestaurantWithMergeContext }",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "HydratedDetailRestaurant",
    );
    const hydratedDetailSource = source(
      "components/home/HydratedDetailRestaurant.tsx",
    );
    expect(hydratedDetailSource).toContain("@/hooks/use-restaurant-detail");
    expect(hydratedDetailSource).not.toContain(
      "DETAIL_HYDRATION_IDLE_DELAY_MS",
    );
    expect(hydratedDetailSource).toContain(
      "useRestaurantWithMergeContext(restaurant)",
    );
    expect(hydratedDetailSource).not.toContain(
      "shouldHydrateDetail ? restaurant : null",
    );
    expect(source("hooks/use-restaurants.tsx")).not.toContain(
      "useRestaurantWithMergeContext",
    );
    expect(homeClientSource).not.toContain(
      "지도를 먼저 그리고 맛집 데이터를 순서대로 연결합니다",
    );
    expect(homeClientSource).not.toContain("홈 지도 화면 준비 중");
    expect(homeClientSource).not.toContain("쯔동여지도 로딩 중");
    expect(homeClientSource).toContain("tzudong:home-initial-intent");
    expect(homeClientSource).toContain(
      "initialIntent={initialMobileOverlayIntent}",
    );
    expect(homeClientSource).toContain('setActivePanel("control")');
    expect(
      source("components/restaurant/RestaurantDetailPanel.tsx"),
    ).not.toContain("RESTAURANT_DETAIL_REVIEW_IDLE_DELAY_MS");
    expect(
      source("components/restaurant/RestaurantDetailPanel.tsx"),
    ).not.toContain("리뷰를 잠시 후 불러옵니다");
    expect(source("components/restaurant/RestaurantDetailPanel.tsx")).toContain(
      "const shouldLoadReviewData = Boolean(restaurantId);",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "handleSheetHandleKeyDown",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "onKeyDown={handleSheetHandleKeyDown}",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "event.key === 'ArrowUp'",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "event.key === 'Escape'",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "focus-visible:ring-2",
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      'aria-label="상세 패널 닫기"',
    );
    expect(source("components/home/home-map-container.tsx")).toContain(
      "flex h-12 w-11 items-center",
    );
    expect(homeClientSource).not.toContain(
      "function HomeControlPanelLoadingShell()",
    );
    expect(homeClientSource).not.toContain("쯔동여지도 검색하기");
    expect(homeClientSource).toContain("loading: () => null");
    expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
    expect(homeRuntimeShellSource).toContain("function MobileHomeLayout");
    expect(homeRuntimeShellSource).toContain(
      "function HomeRuntimePendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeProgressiveShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeLoadingSpinner",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<HomeRuntimeProgressiveShell />",
    );
    expect(homeRuntimeShellSource).not.toContain('role="status"');
    expect(homeRuntimeShellSource).not.toContain(
      'aria-label="쯔동여지도 로딩 중"',
    );
    expect(homeRuntimeShellSource).not.toContain("animate-spin rounded-full");
    expect(homeRuntimeShellSource).not.toContain(
      'aria-label="쯔동여지도 홈 미리보기"',
    );
    expect(homeRuntimeShellSource).not.toContain(
      'role="status" aria-live="polite"',
    );
    expect(homeRuntimeShellSource).not.toContain('aria-busy="true"');
    expect(homeRuntimeShellSource).not.toContain('data-home-intent="search"');
    expect(homeRuntimeShellSource).not.toContain("지도를 준비하고 있어요");
    expect(homeRuntimeShellSource).not.toContain(
      "지도 화면을 먼저 준비하고 맛집 정보를 순서대로 불러옵니다",
    );
    expect(homeRuntimeShellSource).not.toContain("bg-gradient-to-r");
    expect(homeRuntimeShellSource).not.toContain("motion-reduce:animate-none");
    expect(homeRuntimeShellSource).not.toContain("motion-reduce:hidden");
    expect(homeRuntimeShellSource).not.toContain("홈 지도 준비 단계");
    expect(homeRuntimeShellSource).not.toContain(
      "rounded-3xl border border-border bg-background/90 px-8 py-7",
    );
    expect(homeRuntimeShellSource).not.toContain("animate-bounce");
    expect(homeRuntimeShellSource).not.toContain("@keyframes");
    expect(homeRuntimeShellSource).not.toContain("지도를 준비하고 있어요");
    expect(homeRuntimeShellSource).not.toContain("쯔동여지도 검색하기");
    expect(homeRuntimeShellSource).not.toContain("bg-[radial-gradient");
    expect(homeRuntimeShellSource).not.toContain("bg-[linear-gradient");
    expect(homeRuntimeShellSource).toContain(
      "import MobileBottomNav from '@/components/layout/MobileBottomNav'",
    );
    expect(homeRuntimeShellSource).toContain("<MobileBottomNav");
    expect(homeRuntimeShellSource).not.toContain(
      "MOBILE_BOTTOM_NAV_IDLE_DELAY_MS",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function MobileBottomNavLoadingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "MOBILE_BOTTOM_NAV_LOADING_ITEMS",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "handleBottomNavLoadingIntent",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "requestAuthUi({ source: 'mobile-bottom-nav-loading-shell-my'",
    );
    expect(homeRuntimeShellSource).not.toContain("router.push(path)");
    expect(homeRuntimeShellSource).not.toContain(
      "function MobileTopControlPendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain("shouldLoadMobileBottomNav");
    expect(homeRuntimeShellSource).toContain("const OverlayLayout = lazy(");
    expect(homeRuntimeShellSource).toContain("<QueryProvider>");
    expect(homeRuntimeShellSource).toContain(
      "fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}",
    );
    expect(homeRuntimeShellSource).not.toContain(
      'fallback={<div className="h-full w-full">{children}</div>}',
    );
    expect(homeRuntimeShellSource).not.toContain("if (!hasMounted)");
    expect(homeRuntimeShellSource).not.toContain("setHasMounted");
    expect(homeRuntimeShellSource).toContain("if (viewportMode === 'pending')");
    expect(homeRuntimeShellSource).toContain("if (viewportMode === 'desktop')");
    expect(homeRuntimeShellSource).not.toContain(
      "from '@/hooks/useDeviceType'",
    );
    expect(homeClientSource).toContain(
      "const viewportMode = useHomeViewportMode()",
    );
    expect(homeClientSource).toContain(
      'const isViewportResolved = viewportMode !== "pending"',
    );
    expect(homeClientSource).toContain(
      "isViewportResolved && !(isMobileOrTablet && isMapFullscreen)",
    );
    expect(homeClientSource).toContain(
      "isViewportResolved && shouldRenderSidePanels",
    );
    expect(homeClientSource).toContain("const shouldRenderSidePanels = Boolean(");
    expect(homeClientSource).not.toContain("activeRightPanel ||\n    isAnnouncementSheetOpen");
    expect(homeClientSidePanelsSource).not.toContain("void activeRightPanel");
    expect(homeClientSidePanelsSource).not.toContain("activeRightPanel:");
    expect(homeClientSource).not.toContain(
      "const { isDesktop, isMobileOrTablet } = useDeviceType()",
    );
    expect(homeViewportModeSource).toContain(
      "export type HomeViewportMode = 'pending' | 'mobileOrTablet' | 'desktop'",
    );
    expect(homeViewportModeSource).toContain(
      "const [mode, setMode] = useState<HomeViewportMode>('pending')",
    );
    expect(homeViewportModeSource).toContain(
      "window.innerWidth <= BREAKPOINTS.tabletMax",
    );
    expect(homeViewportModeSource).toContain(
      "previousMode === nextMode ? previousMode : nextMode",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    expect(homeClientSource).not.toContain("home-map-activate-button");
    expect(homeClientSource).toContain("resolveDeviceLocationStateUpdatePlan");
    expect(deviceTypeSource).toContain(
      "function calculateDeviceTypeSnapshot()",
    );
    expect(deviceTypeSource).toContain(
      "const [deviceType, setDeviceType] = useState<DeviceType>(getDesktopDeviceType)",
    );
    expect(deviceTypeSource).toContain(
      "function resolveDeviceTypeState(previous: DeviceType, next: DeviceType): DeviceType",
    );
    expect(deviceTypeSource).toContain(
      "areDeviceTypesEqual(previous, next) ? previous : next",
    );
    expect(homeClientSource).toContain("clearRestaurantDetailSelection");
    expect(homeClientSource).toContain("openRestaurantDetailSelection");
    expect(homeClientSource).toContain("releaseSearchSelectionOwnership");
    expect(homeClientEffectsSource).toContain(
      "clearRestaurantDetailSelection: () => void",
    );
    expect(homeClientEffectsSource).toContain("lastAnnouncementRequestKeyRef");
    expect(homeClientEffectsSource).toContain(
      "lastRestaurantDeepLinkRequestKeyRef",
    );
    expect(homeClientEffectsSource).toContain("lastCoordinateRequestKeyRef");
    expect(homeClientEffectsSource).toContain("pendingAnnouncementRequestRef");
    expect(homeClientEffectsSource).toContain(
      "pendingRestaurantDeepLinkRequestRef",
    );
    expect(homeClientEffectsSource).toContain("pendingCoordinateRequestRef");
    expect(homeClientEffectsSource).not.toContain(
      "MOBILE_RESTAURANT_DEEP_LINK_IDLE_DELAY_MS",
    );
    expect(homeClientEffectsSource).not.toContain(
      "MOBILE_RESTAURANT_DEEP_LINK_ACTIVATION_EVENTS",
    );
    expect(homeClientEffectsSource).not.toContain(
      "function isEmbeddedHomeRuntime()",
    );
    expect(homeClientEffectsSource).toContain(
      "runRestaurantDeepLinkResolution(() =>",
    );
    expect(homeClientEffectsSource).toContain("let isCancelled = false");
    expect(homeClientEffectsSource).toContain(
      "const clearRegisteredRequestKeys = () =>",
    );
    expect(homeClientEffectsSource).toContain("clearRegisteredRequestKeys();");
    expect(homeClientEffectsSource).toContain("window.clearTimeout(timer)");
    expect(homeClientEffectsSource).not.toContain(
      "type HomeState = ReturnType<typeof useHomeState>",
    );
    expect(homeClientEffectsSource).not.toContain(
      "state.clearRestaurantDetailSelection()",
    );
    expect(headerSource).toContain("useBannerAnnouncements();");
    expect(headerSource).toContain(
      "useActiveAnnouncements(isAnnouncementSheetOpen);",
    );
    expect(headerSource).toContain(
      "const activeAnnouncements = activeAnnouncementsData ?? bannerAnnouncements;",
    );
    expect(bannerAnnouncementsHookSource).toContain("fetchSupabaseRows");
    expect(bannerAnnouncementsHookSource).toContain(
      "export function useBannerAnnouncements(enabled = true)",
    );
    expect(bannerAnnouncementsHookSource).toContain(
      "['show_on_banner', 'eq.true']",
    );
    expect(bannerAnnouncementsHookSource).toContain(
      "BANNER_ANNOUNCEMENTS_STALE_TIME_MS",
    );
    expect(bannerAnnouncementsHookSource).not.toContain(
      "@/hooks/use-announcements",
    );
    expect(restaurantSearchSource).toContain(
      "enabled: isFocused || isInlineView",
    );
    expect(homeControlPanelSource).toContain(
      "const loadHomeDesktopControlPanel = async () =>",
    );
    expect(homeControlPanelSource).toContain(
      "import('@/components/home/home-desktop-control-panel')",
    );
    expect(homeControlPanelSource).toContain(
      "const loadMobileControlOverlay = async () =>",
    );
    expect(homeControlPanelSource).toContain(
      "import('@/components/home/MobileControlOverlay')",
    );
    expect(homeControlPanelSource).not.toContain(
      "function MobileControlOverlayLoadingShell",
    );
    expect(homeControlPanelSource).toContain(
      "type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user'",
    );
    expect(homeControlPanelSource).toContain("pendingMobileOverlayIntent");
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('search')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('bookmark')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('notification')}",
    );
    expect(homeControlPanelSource).not.toContain(
      "onClick={() => onActivate('user')}",
    );
    expect(homeControlPanelSource).toContain(
      "Boolean(initialIntent) || (typeof window !== 'undefined' && window.innerWidth <= BREAKPOINTS.tabletMax)",
    );
    expect(homeControlPanelSource).toContain(
      "setPendingMobileOverlayIntent(initialIntent)",
    );
    expect(homeControlPanelSource).toContain(
      "initialIntent={pendingMobileOverlayIntent}",
    );
    expect(homeControlPanelSource).toContain("initialIntent={initialIntent}");
    expect(homeControlPanelSource).not.toContain(
      "MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS",
    );
    expect(homeControlPanelSource).toContain(
      "useDeferredComponent<MobileControlOverlayProps>",
    );
    expect(homeControlPanelSource).toContain(
      "shouldRenderMobile && shouldLoadMobileOverlay",
    );
    expect(homeControlPanelSource).not.toContain(
      "window.addEventListener('pointerdown', requestMobileOverlay",
    );
    expect(homeControlPanelSource).not.toContain(
      "window.addEventListener('touchstart', requestMobileOverlay",
    );
    expect(homeControlPanelSource).toContain("return null;");
    expect(homeControlPanelSource).toContain("shouldLoadDesktopPanel");
    expect(homeControlPanelSource).not.toContain(
      "function DesktopControlPanelLoadingShell()",
    );
    expect(homeControlPanelSource).toContain(
      "setShouldLoadDesktopPanel(window.innerWidth > BREAKPOINTS.tabletMax)",
    );
    expect(homeControlPanelSource).toContain("window.requestAnimationFrame");
    expect(homeControlPanelSource).not.toContain(
      "return <DesktopControlPanelLoadingShell />;",
    );
    expect(homeControlPanelSource).not.toContain(
      "import MobileControlOverlay from '@/components/home/MobileControlOverlay'",
    );
    expect(homeControlPanelSource).not.toContain("useOverseasCountryCounts");
    expect(homeControlPanelSource).not.toContain(
      "const HomeDesktopControlPanel = lazy(",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/search/RestaurantSearch",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/region/RegionSelector",
    );
    expect(homeControlPanelSource).not.toContain(
      "components/filters/CategoryFilter",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const loadDesktopRestaurantSearch = async () =>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'import("@/components/search/RestaurantSearch")',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "DesktopRestaurantSearchLoadingShell",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "useDeferredComponent<RestaurantSearchComponentProps>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const loadDesktopLeftPanelMapHome = async () =>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'import("@/components/home/DesktopLeftPanelMapHome")',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "useDeferredComponent<DesktopLeftPanelMapHomeComponentProps>",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "shouldShowDesktopSearchResults",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "shouldShowDesktopMapHome",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "<DeferredDesktopLeftPanelMapHome",
    );
    expect(homeDesktopControlPanelSource).toContain(
      '<DesktopLeftPanelLoadingState label="홈 추천" />',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'source: "desktop-left-panel-home-feed"',
    );
    expect(homeDesktopControlPanelSource).toContain('selectedRegion={');
    expect(homeDesktopControlPanelSource).toContain(
      'isKoreanOnly={mapMode === "domestic"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "setIsDesktopSearchActive(false);",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-map-home="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-popular-restaurants="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "POPULAR_RESTAURANT_LIMIT = 3",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("fetchPopularRestaurants");
    expect(desktopLeftPanelMapHomeSource).toContain(
      "getPopularRestaurantsQueryKey",
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      "desktopLeftPanelHomePopularQueryKey",
    );
    expect(desktopLeftPanelMapHomeSource).toContain("selectedRegion");
    expect(desktopLeftPanelMapHomeSource).toContain("isKoreanOnly");
    expect(popularRestaurantsSource).toContain("POPULAR_RESTAURANTS_QUERY_KEY");
    expect(popularRestaurantsSource).toContain("KOREAN_RESTAURANT_REGIONS");
    expect(popularRestaurantsSource).toContain(
      ".gt('weekly_search_count', 0)",
    );
    expect(popularRestaurantsSource).toContain("selectedRegion");
    expect(popularRestaurantsSource).toContain("isKoreanOnly");
    expect(popularRestaurantsSource).toContain(".slice(0, limit)");
    expect(restaurantSearchSource).toContain("fetchPopularRestaurants");
    expect(restaurantSearchSource).toContain("getPopularRestaurantsQueryKey");
    expect(desktopLeftPanelMapHomeSource.indexOf(
      'data-desktop-left-panel-popular-restaurants="true"',
    )).toBeLessThan(
      desktopLeftPanelMapHomeSource.indexOf(
        'data-desktop-left-panel-review-feed="true"',
      ),
    );
    expect(desktopLeftPanelMapHomeSource).toContain(
      'data-desktop-left-panel-review-feed="true"',
    );
    expect(desktopLeftPanelMapHomeSource).toContain("shouldLoadReviewFeed");
    expect(desktopLeftPanelMapHomeSource).toContain("requestReviewFeed");
    expect(desktopLeftPanelMapHomeSource).toContain("onWheel={requestReviewFeed}");
    expect(desktopLeftPanelMapHomeSource).toContain("onPointerEnter={requestReviewFeed}");
    expect(desktopLeftPanelMapHomeSource).toContain("사용자 맛집 리뷰 불러오기");
    expect(desktopLeftPanelMapHomeSource).toContain("FeedContent");
    expect(desktopLeftPanelMapHomeSource).toContain("showHeader={false}");
    expect(desktopLeftPanelMapHomeSource).toContain("hideFloatingButton");
    expect(desktopLeftPanelMapHomeSource).toContain("hideReviewModal");
    expect(feedContentSource).toContain("showHeader?: boolean");
    expect(feedContentSource).toContain("showHeader = true");
    expect(feedContentSource).toContain("{showHeader && (");
    expect(homeDesktopControlPanelSource).toContain(
      'activeLeftPanelView === "map"',
    );
    expect(homeDesktopControlPanelSource).toContain("!isPanelOpen");
    expect(homeDesktopControlPanelSource).not.toContain(
      'activeLeftPanelView === "map" && isDesktopSearchActive',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'document.addEventListener("pointerdown", handlePointerDown)',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'document.addEventListener("mousedown", handlePointerDown)',
    );
    expect(source("components/search/RestaurantSearch.tsx")).toContain(
      "hideHistoryAndPopular?: boolean",
    );
    expect(source("components/search/RestaurantSearch.tsx")).toContain(
      "!hideHistoryAndPopular &&",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'import RestaurantSearch from "@/components/search/RestaurantSearch"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "components/region/RegionSelector",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "components/filters/CategoryFilter",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "useOverseasCountryCounts(mapMode)",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-map-panel="true"',
    );
    expect(homeDesktopControlPanelSource).toContain("desktop-left-panel-scrollbarless");
    expect(homeAppGlobalsSource).toContain(".desktop-left-panel-scrollbarless,");
    expect(homeAppGlobalsSource).toContain(".desktop-left-panel-scrollbarless :where(");
    expect(homeAppGlobalsSource).toContain('[class*="overflow-y-auto"]');
    expect(homeAppGlobalsSource).toContain('[class*="overflow-x-auto"]');
    expect(homeAppGlobalsSource).toContain("-ms-overflow-style: none !important");
    expect(homeAppGlobalsSource).toContain("scrollbar-width: none !important");
    expect(homeAppGlobalsSource).toContain(")::-webkit-scrollbar");
    expect(homeAppGlobalsSource).toContain("display: none !important");
    expect(homeAppGlobalsSource).toContain("width: 0 !important");
    expect(homeAppGlobalsSource).toContain("height: 0 !important");
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
    expect(homeDesktopControlPanelSource.indexOf('aria-label="검색어 지우기"')).toBeLessThan(
      homeDesktopControlPanelSource.indexOf("toggleDesktopSearchType();"),
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
    expect(homeDesktopControlPanelSource).toContain("pendingDetailReturnCaptureRef");
    expect(homeDesktopControlPanelSource).toContain("pendingDetailOpen?: boolean");
    expect(homeDesktopControlPanelSource).toContain("!pendingDetailReturnCaptureRef.current");
    expect(homeDesktopControlPanelSource).toContain("captureDetailReturnView(activeLeftPanelViewRef.current, {");
    expect(homeDesktopControlPanelSource).toContain("if (pendingDetailReturnCaptureRef.current) return;");
    expect(homeDesktopControlPanelSource).toContain('captureDetailReturnView("map", { pendingDetailOpen: true })');
    expect(homeDesktopControlPanelSource).toContain("setDesktopSearchQuery(returnState.searchQuery)");
    expect(homeDesktopControlPanelSource).toContain("setDesktopSearchType(returnState.searchType)");
    expect(homeDesktopControlPanelSource).toContain("setIsDesktopSearchActive(returnState.isSearchActive)");
    expect(homeDesktopControlPanelSource).toContain(
      "HOME_DESKTOP_DETAIL_RETURN_CAPTURE_EVENT",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "handleExternalDetailReturnCapture",
    );
    expect(source("app/home-client.tsx")).toContain(
      "requestDesktopDetailReturnCapture();",
    );
    expect(homeDesktopControlPanelSource).toContain("const returnRoute = getDesktopLeftPanelRoute(");
    expect(homeDesktopControlPanelSource).toContain("router.replace(returnRoute, { scroll: false })");
    expect(homeDesktopControlPanelSource).toContain("replaceBrowserHistoryRoute(returnRoute)");
    expect(homeDesktopControlPanelSource).toContain('replaceBrowserHistoryRoute("/")');
    expect(homeDesktopControlPanelSource).toContain(
      "onClose={handleDetailPanelClose}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onClose={handleReturnToMapPanel}",
    );
    expect(homeDesktopControlPanelSource).toContain("showBackButton");
    expect(homeDesktopControlPanelSource).toContain("edgeToEdgeInlineLayout");
    expect(homeDesktopControlPanelSource).toContain(
      "searchQueryValue={desktopSearchQuery}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-map-floating-filters="true"',
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
    expect(homeDesktopControlPanelSource).toContain("motion-reduce:transition-none");
    expect(homeDesktopControlPanelSource).toContain("aria-pressed={preferences.desktopPanelSide === value}");
    expect(homeDesktopControlPanelSource).toContain("aria-pressed={preferences.desktopMapLayout === value}");
    expect(homeDesktopControlPanelSource).toContain("aria-pressed={preferences.desktopPanelDefault === value}");

    expect(homeDesktopControlPanelSource).toContain(
      'data-panel-collapsed={isPanelCollapsed ? "true" : "false"}',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'desktopPanelSide === "right"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      '"translate-x-full"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      '"-translate-x-full"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "const panelToggleLabel = isPanelCollapsed",
    );
    expect(homeDesktopControlPanelSource).toContain('const panelSideLabel = desktopPanelSide === "right" ? "우측" : "좌측"');
    expect(homeDesktopControlPanelSource).toContain("`${panelSideLabel} 패널 펼치기`");
    expect(homeDesktopControlPanelSource).toContain("`${panelSideLabel} 패널 접기`");
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
      'router.replace("/?panel=announcement", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      'router.push("/?panel=announcement", { scroll: false })',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-admin-reviews="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-loading="true"',
    );
    expect(homeDesktopControlPanelSource).toContain('import { Skeleton } from "@/components/ui/skeleton"');
    expect(homeDesktopControlPanelSource).not.toContain("bg-muted animate-pulse");
    expect(homeDesktopControlPanelSource).toContain(
      'aria-label={`${label} 패널 불러오는 중`}',
    );
    expect(homeDesktopControlPanelSource).toContain('role="status"');
    expect(homeDesktopControlPanelSource).toContain('aria-live="polite"');
    expect(homeDesktopControlPanelSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopBookmarksSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopNotificationsSource).toContain(
      "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
    );
    expect(desktopNotificationsSource).not.toContain("<Fragment");
    expect(homeDesktopControlPanelSource).toContain("isInlineDetailOpenPending");
    expect(homeDesktopControlPanelSource).toContain("isDetailPanelTransitionPending");
    expect(homeDesktopControlPanelSource).toContain('<DesktopLeftPanelLoadingState label="맛집 상세" />');
    expect(homeDesktopControlPanelSource).toContain(
      "!hasActiveDetail && !isDetailPanelTransitionPending",
    );
    expect(homeDesktopControlPanelSource).toContain(
      ') : activeLeftPanelView === "feed" && DeferredFeedOverlay ? (',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "onOpenReviewModal={onReviewModalOpen}",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "hideReviewModal={Boolean(onReviewModalOpen)}",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "hideFloatingButton\n              initialReviewId",
    );
    expect(homeDesktopControlPanelSource).not.toContain("다음 단계 후보");
    expect(homeDesktopControlPanelSource).not.toContain(
      "관리자 계정은 운영 화면 진입 시 사이드 패널 펼침 정책을 유지합니다.",
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
    expect(restaurantDetailPanelSource.indexOf('<Settings className="h-4 w-4" aria-hidden="true" />')).toBeLessThan(
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
      '!isPanelCollapsed && desktopPanelSide === "left"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      ': "1rem"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      '`calc(min(${DESKTOP_LEFT_PANEL_WIDTH_PX}px, calc(100vw - 32px)) + 1rem)`',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "pointer-events-auto h-9 w-[var(--desktop-floating-nav-button-width)] shrink-0 justify-center rounded-full",
    );
    expect(homeDesktopControlPanelSource).toContain(
      "style={floatingControlsStyle}",
    );
    expect(homeDesktopControlPanelSource.indexOf('{ id: "profile", label: "프로필", icon: UserRound }')).toBeLessThan(
      homeDesktopControlPanelSource.indexOf('{ id: "feed", label: "리뷰", icon: MessageSquare }'),
    );
    expect(homeDesktopControlPanelSource).not.toContain("지도 필터");
    expect(homeDesktopControlPanelSource).toContain(
      "const hasActiveDetail = isPanelOpen && Boolean(panelRestaurant)",
    );
    expect(homeDesktopControlPanelSource).toContain("{!hasActiveDetail && !isDetailPanelTransitionPending && (");
    expect(homeDesktopControlPanelSource).toContain("hasActiveDetail ||");
    expect(homeDesktopControlPanelSource).toContain("isDetailPanelTransitionPending ||");
    expect(homeDesktopControlPanelSource).toContain("isInlinePanelViewActive ||");
    expect(homeDesktopControlPanelSource).toContain(' ? "px-0 py-0"');
    expect(homeDesktopControlPanelSource).toContain(' : "px-4 py-4"');
    expect(homeDesktopControlPanelSource).toContain(
      'data-desktop-left-panel-detail-fill="true"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      'className="rounded-none border-0 shadow-none"',
    );
    expect(homeDesktopControlPanelSource).toContain(
      "h-full min-h-0 overflow-hidden",
    );
    const homeMapContainerSource = source(
      "components/home/home-map-container.tsx",
    );
    expect(homeMapContainerSource).toContain("desktopMapLayout?: HomeMapLayoutMode");
    expect(homeMapContainerSource).toContain("desktopPanelSide?: HomeMapPanelSide");
    expect(homeMapContainerSource).toContain("desktopMapLayout = 'panel-aware'");
    expect(homeMapContainerSource).toContain("desktopMapLayout === 'panel-aware'");
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
      "reservesDesktopLeftPanelSpace={shouldReserveDesktopSidePanel}",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "usesExternalPanel: Boolean(onMarkerClick) && !reservesDesktopLeftPanelSpace",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "reservesDesktopLeftPanelSpace,",
    );

    expect(homeDesktopControlPanelSource).not.toContain(
      "h-[calc(100vh-260px)] min-h-[560px]",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "rounded-xl border border-border bg-background shadow-sm",
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "window.requestAnimationFrame",
    );
    expect(homeDesktopControlPanelSource).toContain("initialIntent");
    expect(homeDesktopControlPanelSource).toContain(
      'initialIntent !== "search"',
    );
    expect(homeDesktopControlPanelSource).not.toContain(
      "setShouldLoadSearch(true)",
    );
    expect(mobileControlSource).toContain("useOverseasCountryCounts(mapMode)");
    expect(mobileControlSource).toContain(
      "initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null",
    );
    expect(mobileControlSource).toContain(
      "type MobileTopDropdown = 'bookmark' | 'notification' | 'user' | null",
    );
    expect(mobileControlSource).toContain(
      "const [openTopDropdown, setOpenTopDropdown] = useState<MobileTopDropdown>",
    );
    expect(mobileControlSource).toContain("setActiveSheet('search')");
    expect(mobileControlSource).toContain(
      "<DropdownMenu open={isBookmarkMenuOpen} onOpenChange={handleBookmarkMenuOpenChange}>",
    );
    expect(mobileControlSource).toContain(
      "<DropdownMenu open={isNotificationMenuOpen} onOpenChange={handleNotificationMenuOpenChange}>",
    );
    expect(mobileControlSource).toContain(
      "enabled: activeSheet === 'region' || activeSheet === 'category'",
    );
    expect(mobileControlSource).toContain('role="dialog"');
    expect(mobileControlSource).not.toContain("transition-all");
    expect(mobileControlSource).toContain('aria-modal="true"');
    expect(mobileControlSource).toContain(
      'aria-labelledby="mobile-map-search-title"',
    );
    expect(mobileControlSource).toContain("handleSearchLayerKeyDown");
    expect(mobileControlSource).toContain(
      "getFocusTrapContainers(searchLayerRef.current",
    );
    expect(mobileControlSource).toContain(
      "searchPreviouslyFocusedElementRef.current?.focus",
    );
    expect(mobileControlSource).toContain("inertSibling.inert = true");
    expect(mobileControlSource).toContain("aria-pressed={isSelected}");
    expect(mobileControlSource).toContain(
      "aria-label={`${category} 카테고리 ${isSelected ? '선택 해제' : '선택'}`}",
    );
    expect(mobileControlSource).toContain("min-h-11");
    expect(mobileControlSource).toContain('role="status"');
    expect(mobileControlSource).toContain("목록을 불러오는 중입니다");
    expect(mobileControlSource).toContain(
      "useDeferredComponent<MobileNotificationMenuButtonProps>",
    );
    expect(mobileControlSource).not.toContain("useNotifications()");
    expect(mobileControlSource).not.toContain(
      "formatDistanceToNow(notification.createdAt",
    );
    expect(mobileNotificationSource).toContain("useNotifications()");
    expect(mobileNotificationSource).toContain(
      "formatDistanceToNow(notification.createdAt",
    );
    expect(regionSelectorSource).toContain("enabled: true,");
    expect(regionSelectorSource).toContain("fetchSupabaseRows");
    expect(regionSelectorSource).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(categoryFilterSource).toContain("enabled: true,");
    expect(categoryFilterSource).toContain("fetchSupabaseRows");
    expect(categoryFilterSource).toContain(
      "? ['restaurants-categories', selectedRegion, selectedCountry]",
    );
    expect(categoryFilterSource).toContain(": ['restaurants-count']");
    expect(categoryFilterSource).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(mapQuerySource).toContain("includeVerifiedReviewCounts: false");
    expect(naverMapSource).toContain("autoLoad: false");
    expect(naverMapSource).toContain("strategy: 'afterInteractive'");
    expect(naverMapSource).not.toContain("strategy: 'lazyOnload'");
    expect(naverMapSource).toContain("buildHomeMapActivationPlan");
    expect(naverMapSource).toContain("isEmbeddedHomeRuntimeWindow");
    expect(naverMapSource).toContain("activationPlan.activateImmediately");
    expect(naverMapSource).not.toContain(
      "window.setTimeout(activateMapRuntime, activationPlan.delayMs)",
    );
    expect(naverMapSource).not.toContain("activationPlan.events.forEach");
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "export const HOME_MAP_AUTO_ACTIVATION_DELAY_MS = 0",
    );
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "activateImmediately: true",
    );
    expect(source("app/home-map-runtime-activation.ts")).toContain(
      "events: []",
    );
    expect(naverMapSource).not.toContain("{ timeout: 2000 }");
    expect(naverMapSource).toContain("NaverMapAnnouncementRuntime");
    expect(naverMapSource).not.toContain(
      'useBannerAnnouncements } from "@/hooks/use-banner-announcements"',
    );
    expect(naverMapSource).not.toContain(
      "useBannerAnnouncements(shouldRunNoncriticalMapEffects)",
    );
    expect(source("components/map/NaverMapAnnouncementRuntime.tsx")).toContain(
      "useBannerAnnouncements(true)",
    );
    expect(naverMapSource).toContain(
      "setShouldRunNoncriticalMapEffects((previous) => previous ? previous : true)",
    );
    expect(naverMapSource).toContain("activateNoncriticalMapEffects();");
    expect(naverMapSource).not.toContain(
      "NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS",
    );
    expect(naverMapSource).not.toContain(
      "setTimeout(activateNoncriticalMapEffects",
    );
    expect(naverMapSource).toContain("NaverMapPresenceRuntime");
    expect(naverMapSource).toContain("HydratedDetailRestaurant");
    expect(naverMapSource).not.toContain("useRestaurantWithMergeContext");
    expect(naverMapSource).not.toContain(
      "import('@/lib/naver-map-presence-client')",
    );
    expect(source("components/map/NaverMapPresenceRuntime.tsx")).toContain(
      "startNaverMapPresence",
    );
    expect(naverMapSource).toContain(
      "areClusterFeaturesEqual(previous, newClusters) ? previous : newClusters",
    );
    expect(naverMapSource).toContain(
      "areRegionalClustersEqual(previous, newRegionalClusters) ? previous : newRegionalClusters",
    );
    expect(naverMapSource).toContain("RESTAURANT_COUNT_TOAST_SETTLE_DELAY_MS");
    expect(naverMapSource).toContain("isFetching: isFetchingRestaurants");
    expect(naverMapSource).toContain(
      "isLoadingRestaurants || isFetchingRestaurants",
    );
    expect(naverMapSource).toContain(
      "setRestaurantCountToastCount(restaurants.length)",
    );
    expect(naverMapSource).toContain(
      "restaurantCountToastCount={restaurantCountToastCount}",
    );
    expect(naverMapSource).not.toContain("count={restaurants.length}");
    expect(source("components/map/naver-map-overlay-stack.tsx")).toContain(
      "count={restaurantCountToastCount}",
    );
    expect(naverMapSource).not.toContain(
      'import { supabase } from "@/integrations/supabase/client"',
    );
    expect(source("hooks/use-restaurants.tsx")).toContain("fetchSupabaseRows");
    expect(source("hooks/use-restaurants.tsx")).not.toContain(
      'import { supabase } from "@/integrations/supabase/client"',
    );
    expect(source("components/home/MobileControlOverlay.tsx")).toContain(
      "fetchSupabaseRows",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "import { supabase } from '@/integrations/supabase/client'",
    );
    expect(mapOverlayNoticeSource).toContain("max-w-[calc(100vw-2rem)]");
    expect(mapOverlayNoticeSource).toContain("min-h-9");
    expect(mapOverlayNoticeSource).toContain("w-fit");
    expect(mapOverlayNoticeSource).not.toContain("flex w-[calc(100vw-2rem)]");
    expect(mapOverlayNoticeSource).toContain("grid-cols-[1.25rem_max-content]");
    expect(mapOverlayNoticeSource).toContain("max-w-full");
    expect(mapOverlayNoticeSource).toContain("whitespace-nowrap");
    expect(mapOverlayNoticeSource).not.toContain("whitespace-normal");
    expect(mapOverlayNoticeSource).not.toContain("[overflow-wrap:anywhere]");
    expect(mapOverlayNoticeSource).not.toContain("truncate break-keep");
    expect(mapOverlayNoticeSource).toContain("aria-live={ariaLive}");
    expect(mapOverlayNoticeSource).toContain("aria-busy={ariaBusy}");
    expect(mapOverlayNoticeSource).toContain('aria-hidden="true">');
    expect(mapIndicatorsSource).toContain("MapOverlayNotice");
    expect(mapIndicatorsSource).toContain("motion-reduce:animate-none");
    expect(mapIndicatorsSource).toContain("isBusy = !isLoaded");
    expect(mapIndicatorsSource).toContain(
      "animate-[fadeInOut_3s_ease-in-out_forwards]",
    );
    expect(mapIndicatorsSource).not.toContain("animation: 'fadeInOut");
    expect(mapIndicatorsSource).not.toContain("🔥 {count}개의 맛집 발견");
    expect(mapViewIndicatorsSource).toContain("ariaBusy");
    expect(mapViewIndicatorsSource).toContain("motion-reduce:animate-none");
    expect(overlayStackSource).toContain(
      "isBusy={isLoadingRestaurants || !isLoaded}",
    );
    expect(overlayStackSource).toContain(
      "role={mapToast.type === 'error' ? 'alert' : 'status'}",
    );
    expect(overlayStackSource).toContain(
      "ariaLive={mapToast.type === 'error' ? 'assertive' : 'polite'}",
    );
    expect(overlayPositionSource).toContain(
      "top-[calc(env(safe-area-inset-top)+114px)]",
    );
    expect(overlayPositionSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+132px)]",
    );
    expect(overlayLayoutSource).toContain("지도 본문으로 건너뛰기");
    expect(overlayLayoutSource).toContain('id="tzudong-map-main"');
    expect(floatingNavSource).toContain('aria-label="지도 화면 보조 탐색"');
    expect(floatingNavSource).toContain("aria-pressed={mapMode ===");
  });

  test("naver marker click centering avoids slow duplicate recenter loops", () => {
    const naverMapSource = source("components/map/NaverMapView.tsx");

    expect(naverMapSource).toContain("applyNaverImmediateMarkerCenter({");
    expect(naverMapSource).toContain(
      "lastImmediateMarkerCenterRef.current = immediateCenterResult.markerCenter",
    );
    expect(naverMapSource).toContain(
      "lastImmediateMarkerCenterRef.current = null;",
    );

    const interactionListenerIndex = naverMapSource.indexOf(
      "const mapEventListeners = interactionListenerPlan.mapEventNames.map",
    );
    const deferredSkipIndex = naverMapSource.indexOf(
      "shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({",
    );

    expect(interactionListenerIndex).toBeGreaterThan(-1);
    expect(deferredSkipIndex).toBeGreaterThan(-1);
    expect(interactionListenerIndex).toBeLessThan(deferredSkipIndex);
  });

  test("device location floating action does not show expanding circle animations", () => {
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const submissionFloatingButtonSource = source(
      "components/home/SubmissionFloatingButton.tsx",
    );
    const restaurantSubmissionSource = source(
      "components/modals/RestaurantSubmissionModal.tsx",
    );
    const homeClientSidePanelsSource = source("app/home-client-sidepanels.tsx");
    const homeClientSource = source("app/home-client.tsx");
    const naverMapSource = source("components/map/NaverMapView.tsx");

    expect(mobileControlSource).not.toContain(
      "isDeviceLocationPending && 'animate-pulse opacity-80'",
    );
    expect(submissionFloatingButtonSource).toContain(
      "resolveDeviceLocationButtonLabel",
    );
    expect(homeClientSidePanelsSource).toContain(
      "presentation={isMobileOrTablet ? 'auto' : 'map-panel'}",
    );
    expect(restaurantSubmissionSource).toContain(
      'data-desktop-map-submission-panel="true"',
    );
    expect(restaurantSubmissionSource).toContain("shouldRenderMapPanel");
    expect(restaurantSubmissionSource).toContain("mobileSheetStyles.frame");
    expect(restaurantSubmissionSource).toContain(
      "data-desktop-map-submission-drag-handle",
    );
    expect(restaurantSubmissionSource).toContain(
      "handleDesktopSubmissionPanelPointerDown",
    );
    expect(restaurantSubmissionSource).toContain("setPointerCapture");
    expect(restaurantSubmissionSource).toContain(
      "translate3d(${desktopSubmissionPanelPosition.x}px, ${desktopSubmissionPanelPosition.y}px, 0)",
    );
    expect(restaurantSubmissionSource).toContain(
      'layoutSource="restaurant-submission"',
    );
    expect(submissionFloatingButtonSource).toContain("onDeviceLocationClick");
    expect(submissionFloatingButtonSource).toContain(
      "aria-label={deviceLocationButtonLabel}",
    );
    expect(submissionFloatingButtonSource).toContain(
      "desktopPanelSide?: HomeMapPanelSide",
    );
    expect(submissionFloatingButtonSource).toContain("shouldOffsetForRightPanel");
    expect(submissionFloatingButtonSource).toContain(
      "DESKTOP_MAP_SIDE_PANEL_WIDTH_CSS",
    );
    expect(
      submissionFloatingButtonSource.indexOf('aria-label="맛집 제보하기"'),
    ).toBeLessThan(
      submissionFloatingButtonSource.indexOf(
        "aria-label={deviceLocationButtonLabel}",
      ),
    );
    expect(
      mobileControlSource.indexOf('aria-label="맛집 제보하기"'),
    ).toBeLessThan(
      mobileControlSource.indexOf("aria-label={deviceLocationButtonLabel}"),
    );
    expect(submissionFloatingButtonSource).toContain(
      'isDeviceLocationPending && "opacity-80"',
    );
    expect(submissionFloatingButtonSource).not.toContain("animate-pulse");
    expect(homeClientSource).toContain(
      "onDeviceLocationClick={handleDeviceLocationClick}",
    );
    expect(homeClientSource).toContain(
      "isDeviceLocationPending={isDeviceLocationPending}",
    );
    expect(homeClientSource).toContain("desktopPanelSide={desktopPanelSide}");
    expect(homeClientSource).toContain("isPanelCollapsed={isPanelCollapsed}");
    expect(naverMapSource).not.toContain("new naver.maps.Circle");
    expect(naverMapSource).not.toContain("deviceLocationAccuracyCircleRef");
  });

  test("profile/stamp/map regressions stay fixed while preserving deferred map loading", () => {
    const overlayPanelSource = source("components/layout/OverlayPagePanel.tsx");
    const stampCardSource = source("components/stamp/StampCard.tsx");
    const stampPageSource = source("app/stamp/page.tsx");
    const stampLoadingSource = source("app/stamp/loading.tsx");
    const skeletonLoadersSource = source("components/ui/skeleton-loaders.tsx");
    const userProfilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const naverMapSource = source("components/map/NaverMapView.tsx");
    const mapViewSidepanelsSource = source("components/map/map-view-sidepanels.tsx");
    const naverMapSidepanelsSource = source("components/map/naver-map-sidepanels.tsx");

    const userProfilePanelIndex =
      overlayPanelSource.indexOf("<UserProfilePanel");

    expect(userProfilePanelIndex).toBeGreaterThan(0);
    expect(
      overlayPanelSource.lastIndexOf(
        '"w-[min(400px,calc(100vw-1rem))]"',
        userProfilePanelIndex,
      ),
    ).toBeGreaterThan(0);
    expect(
      overlayPanelSource.lastIndexOf(
        '"rounded-2xl border border-border shadow-2xl overflow-hidden"',
        userProfilePanelIndex,
      ),
    ).toBeGreaterThan(0);
    expect(stampCardSource).toContain(
      "getRestaurantDisplayName(typedRestaurant)",
    );
    expect(stampCardSource).toContain(
      "alt={`${restaurantDisplayName} 썸네일`}",
    );
    expect(stampCardSource).toContain("title={restaurantDisplayName}");
    expect(stampCardSource).toContain(
      "absolute inset-0 z-10 flex items-center justify-center overflow-hidden",
    );
    expect(stampCardSource).toContain("<img");
    expect(stampCardSource).toContain('src="/images/stamp-clear.png"');
    expect(stampCardSource).toContain(
      "stampSize?: 'default' | 'compact' | 'mobile'",
    );
    expect(stampCardSource).toContain(
      "const resolvedStampSize = stampSize ?? size",
    );
    expect(stampCardSource).toContain(
      "const isStampCompact = resolvedStampSize === 'compact'",
    );
    expect(stampCardSource).toContain("const stampImageStyle = resolvedStampSize === 'mobile'");
    expect(stampCardSource).toContain("height: '70%'");
    expect(stampCardSource).toContain("maxHeight: '8.5rem'");
    expect(stampCardSource).toContain("maxWidth: '40%'");
    expect(stampCardSource).toContain('role={isGuideCard ? undefined : "button"}');
    expect(stampCardSource).toContain("onKeyDown={handleCardKeyDown}");
    expect(stampCardSource).toContain("focus-visible:ring-primary");
    expect(stampCardSource).toContain("transition-[filter,opacity,transform]");
    expect(stampCardSource).toContain("const category = useMemo(");
    expect(stampCardSource).not.toContain("transition-all");
    expect(stampCardSource).not.toContain("style={showStamp ? { filter: 'grayscale(1)' } : undefined}");
    expect(stampCardSource).toContain(
      "pointer-events-none absolute inset-0 flex items-center justify-center",
    );
    expect(stampCardSource).toContain("w-36 h-36 md:w-40 md:h-40");
    expect(stampCardSource).toContain("w-48 h-48 sm:w-56 sm:h-56");
    expect(stampPageSource).toContain(
      'stampSize={isDesktop ? "compact" : "mobile"}',
    );
    expect(stampCardSource).toContain("grayscale opacity-60");
    expect(stampCardSource).not.toContain("absolute inset-0 bg-black/");
    expect(skeletonLoadersSource).toContain(
      "function StampPageSkeletonComponent",
    );
    expect(skeletonLoadersSource).toContain(
      'data-testid="stamp-page-skeleton"',
    );
    expect(stampLoadingSource).toContain("return <StampPageSkeleton />");
    expect(stampPageSource).toContain(
      "if (!isMounted || authLoading) return <StampPageSkeleton />",
    );
    expect(userProfilePanelSource).toContain("import { StampCard }");
    expect(userProfilePanelSource).toContain("import { ReviewCard }");
    expect(userProfilePanelSource).toContain(
      "const USER_PROFILE_PAGE_SIZE = 15",
    );
    expect(userProfilePanelSource).toContain("const PROFILE_TABS = [");
    expect(userProfilePanelSource).toContain('role="tablist"');
    expect(userProfilePanelSource).toContain(
      "grid w-full grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1",
    );
    expect(userProfilePanelSource).toContain(
      "onClick={() => handleTabChange(tab.value)}",
    );
    expect(userProfilePanelSource).toContain("aria-selected={isActive}");
    expect(userProfilePanelSource).toContain(
      "whitespace-nowrap rounded-lg border px-2 py-2.5 text-xs",
    );
    expect(userProfilePanelSource).toContain(
      "border-border/70 bg-background text-foreground shadow-sm",
    );
    expect(userProfilePanelSource).toContain("grid w-full grid-cols-3 gap-2");
    expect(
      userProfilePanelSource.split(
        "gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'",
      ).length - 1,
    ).toBe(2);
    expect(userProfilePanelSource).toContain(
      "border border-border/60 bg-card/80",
    );
    expect(userProfilePanelSource).toContain(
      "const ProfileSectionHeader = memo",
    );
    expect(userProfilePanelSource).toContain("방문 도장과 리뷰 활동");
    expect(userProfilePanelSource).toContain("visibleStampCount");
    expect(userProfilePanelSource).toContain("stampLoadMoreRef");
    expect(userProfilePanelSource).toContain(
      'className="flex-shrink-0 -mr-2 h-10 w-10"',
    );
    expect(userProfilePanelSource).toContain("<StampCard");
    expect(userProfilePanelSource).toContain("<ReviewCard");
    expect(userProfilePanelSource).toContain('size="default"');
    expect(userProfilePanelSource).toContain('stampSize="compact"');
    expect(userProfilePanelSource).not.toContain(
      "import { Tabs, TabsContent, TabsList, TabsTrigger }",
    );
    expect(userProfilePanelSource).not.toContain("<TabsTrigger");
    expect(userProfilePanelSource).not.toContain(
      "const StampItem = memo(function StampItem",
    );
    expect(userProfilePanelSource).not.toContain(
      "const ReviewItem = memo(function ReviewItem",
    );
    expect(userProfilePanelSource).not.toContain(
      '<ScrollArea className="h-full">',
    );
    expect(userProfilePanelSource).toContain("data-user-profile-panel-skeleton");
    expect(userProfilePanelSource).toContain("data-user-profile-tab-skeleton");
    expect(userProfilePanelSource).toContain('import { Skeleton } from "@/components/ui/skeleton"');
    expect(userProfilePanelSource).not.toContain('import { GlobalLoader } from "@/components/ui/global-loader"');
    expect(mapViewSidepanelsSource).toContain("showDesktopBackButton");
    expect(mapViewSidepanelsSource).toContain("data-map-detail-panel-skeleton");
    expect(naverMapSidepanelsSource).toContain("showDesktopBackButton");
    expect(naverMapSidepanelsSource).toContain("data-map-detail-panel-skeleton");
    expect(naverMapSidepanelsSource).toContain("<Suspense fallback={<NaverMapDetailPanelSkeleton />}>");
    expect(naverMapSource).toContain("resolveNaverRestaurantQueryBounds");
    expect(naverMapSource).toContain(
      "shouldUseFullMapData: shouldRunNoncriticalMapEffects",
    );
    expect(
      naverMapSource.match(/activateNoncriticalMapEffects\(\);/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("review like heart keeps the previous feed-style mobile and desktop overlay layout", () => {
    const reviewCardSource = source("components/reviews/ReviewCard.tsx");
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const profilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const restaurantDetailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampPageSource = source("app/stamp/page.tsx");

    expect(reviewCardSource).toContain(
      "const [optimisticLike, setOptimisticLike] = useState",
    );
    expect(reviewCardSource).toContain(
      "import { Avatar, AvatarFallback, AvatarImage }",
    );
    expect(reviewCardSource).toContain(
      '<Avatar className="h-8 w-8 bg-primary/10">',
    );
    expect(reviewCardSource).toContain("<AvatarImage");
    expect(reviewCardSource).toContain(
      '<AvatarFallback className="bg-primary/10">',
    );
    expect(reviewCardSource).toContain("setOptimisticLike({");
    expect(reviewCardSource).toContain("pendingLikeRef.current");
    expect(reviewCardSource).toContain(
      "const pendingLike = pendingLikeRef.current",
    );
    expect(reviewCardSource).toContain(
      "onLike(review.id, optimisticLike.isLiked, optimisticLike.count)",
    );
    expect(reviewCardSource).toContain("optimisticLike.isLiked ?");
    expect(reviewCardSource).toContain(
      "typeof (result as Promise<void>).catch === 'function'",
    );
    expect(reviewCardSource).not.toContain("if (!currentUserId)");
    expect(reviewCardSource).toContain("import { cn } from");
    expect(reviewCardSource).toContain(
      "group -m-1.5 flex items-center gap-1 rounded-full",
    );
    expect(reviewCardSource).toContain("active:text-red-500");
    expect(reviewCardSource).toContain("data-liked={optimisticLike.isLiked}");
    expect(reviewCardSource).toContain("const LIKED_HEART_COLOR = '#ef4444';");
    expect(reviewCardSource).toContain(
      "color={optimisticLike.isLiked ? LIKED_HEART_COLOR : undefined}",
    );
    expect(reviewCardSource).toContain(
      'fill={optimisticLike.isLiked ? LIKED_HEART_COLOR : "none"}',
    );
    expect(reviewCardSource).toContain(
      'stroke={optimisticLike.isLiked ? LIKED_HEART_COLOR : "currentColor"}',
    );
    expect(reviewCardSource).toContain(
      "group-active:fill-red-500 group-active:text-red-500",
    );
    expect(reviewCardSource).toContain(
      "[&_path]:fill-red-500 [&_path]:stroke-red-500",
    );
    expect(reviewCardSource).toContain(
      "text-xs font-medium transition-colors group-active:text-red-500",
    );
    expect(reviewCardSource).toContain('"text-muted-foreground');
    expect(reviewCardSource).toContain('"text-red-500"');
    expect(reviewCardSource).not.toContain(
      'className="group relative flex h-8 w-8 items-center justify-center rounded-full',
    );
    expect(reviewCardSource).toContain(
      "aria-label={`좋아요 ${optimisticLike.count}개${optimisticLike.isLiked ? ' 취소' : ' 누르기'}`}",
    );
    expect(reviewCardSource).toContain("aria-pressed={optimisticLike.isLiked}");
    expect(reviewCardSource).toContain(
      'aria-label={isShareCopied ? "리뷰 링크 복사됨" : "리뷰 공유"}',
    );
    expect(reviewCardSource).toContain(
      "aria-label={`${review.restaurantName} 맛집 상세 보기`}",
    );
    expect(reviewCardSource).not.toContain(
      "aria-label={`좋아요 ${review.likeCount}개`}",
    );
    expect(reviewCardSource).not.toContain(
      "absolute inset-0 flex items-center justify-center text-[9px]",
    );
    expect(reviewCardSource).not.toContain(
      "text-[10px] font-bold leading-none tabular-nums",
    );
    expect(feedContentSource).toContain(
      "onLike={(reviewId, currentIsLiked, currentCount) => toggleLike(reviewId, currentIsLiked, currentCount, review.userId)}",
    );
    expect(restaurantDetailSource).toContain(
      "const handleLikeReview = async (reviewId: string, currentIsLiked?: boolean)",
    );
    expect(restaurantDetailSource).toContain(
      "const isCurrentlyLiked = currentIsLiked ?? likedReviews.has(reviewId);",
    );
    expect(profilePanelSource).toContain(
      "const handleLike = useCallback(async (reviewId: string, currentIsLikedOverride?: boolean)",
    );
    expect(profilePanelSource).toContain(
      "const currentIsLiked = currentIsLikedOverride ?? targetReview.isLikedByUser;",
    );

    for (const parentSource of [
      feedContentSource,
      profilePanelSource,
      restaurantDetailSource,
      stampPageSource,
    ]) {
      expect(parentSource).not.toContain("throw new Error('LOGIN_REQUIRED')");
      expect(parentSource).toContain("throw error;");
    }
  });

  test("auth-gated review actions open UI prompts without uncaught LOGIN_REQUIRED throws", () => {
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const profilePanelSource = source(
      "components/profile/UserProfilePanel.tsx",
    );
    const restaurantDetailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampPageSource = source("app/stamp/page.tsx");

    expect(feedContentSource).toContain("if (!user) {");
    expect(feedContentSource).toContain("if (onOpenAuth) {");
    expect(feedContentSource).toContain("onOpenAuth();");
    expect(feedContentSource).toContain("return;");
    expect(profilePanelSource).toContain("title: '로그인 필요'");
    expect(restaurantDetailSource).toContain("setIsAuthModalOpen(true);");
    expect(stampPageSource).toContain("console.warn('로그인이 필요합니다.');");

    for (const authGateSource of [
      feedContentSource,
      profilePanelSource,
      restaurantDetailSource,
      stampPageSource,
    ]) {
      expect(authGateSource).not.toContain("LOGIN_REQUIRED");
    }
  });

  test("overlay and review icon buttons expose stable accessible names", () => {
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const restaurantReviewsPanelSource = source(
      "components/stamp/RestaurantReviewsPanel.tsx",
    );
    const stampOverlaySource = source(
      "components/overlay-pages/StampOverlay.tsx",
    );
    const leaderboardOverlaySource = source(
      "components/overlay-pages/LeaderboardOverlay.tsx",
    );
    const leaderboardListSource = source(
      "components/leaderboard/LeaderboardList.tsx",
    );
    const leaderboardPageSource = source("app/leaderboard/page.tsx");
    const leaderboardLoadingSource = source("app/leaderboard/loading.tsx");
    const leaderboardSkeletonSource = source("components/ui/skeleton-loaders.tsx");
    const leaderboardUtilsSource = source(
      "components/leaderboard/leaderboard-utils.ts",
    );

    expect(feedContentSource).toContain(
      'aria-label={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}',
    );
    expect(feedContentSource).toContain(
      'aria-label={isFilterExpanded ? "검색 필터 접기" : "검색 필터 펼치기"}',
    );
    expect(feedContentSource).toContain('aria-label="리뷰 패널 닫기"');
    expect(feedContentSource).toContain('aria-label="리뷰 작성"');
    expect(restaurantReviewsPanelSource).toContain(
      'aria-label="맛집 리뷰 패널 닫기"',
    );
    expect(stampOverlaySource).toContain('"모든 맛집 보기"');
    expect(stampOverlaySource).toContain('"안 가본 곳만 보기"');
    expect(stampOverlaySource).toContain('"도장 필터 접기"');
    expect(stampOverlaySource).toContain('"도장 필터 펼치기"');
    expect(stampOverlaySource).toContain('aria-label="도장 패널 닫기"');
    expect(stampOverlaySource).toContain(
      'data-desktop-left-panel-stamp-mobile-parity="true"',
    );
    expect(stampOverlaySource).toContain('stampSize="mobile"');
    expect(stampOverlaySource).toContain('size="default"');
    expect(stampOverlaySource).toContain("const skeletonCardCount = singleColumnCards ? 8 : 16");
    expect(stampOverlaySource).toContain("count={skeletonCardCount}");
    expect(stampOverlaySource).toContain("const skeletonGridColumns = singleColumnCards");
    expect(stampOverlaySource).toContain("grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 md:gap-4");
    expect(stampOverlaySource).toContain("columns={skeletonGridColumns}");
    expect(stampOverlaySource).toContain(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 mt-4 overflow-hidden",
    );
    expect(stampOverlaySource).toContain(
      "pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1.5rem)]",
    );
    expect(stampOverlaySource).toContain("md:pb-6");
    expect(stampOverlaySource).toContain("filters.fanVisitsMin");
    expect(stampOverlaySource).toContain("<Slider");
    expect(stampOverlaySource).toContain('aria-label="도장 맛집 검색"');
    expect(stampOverlaySource).toContain('name="stamp-overlay-search"');
    expect(stampOverlaySource).toContain('placeholder="맛집명 검색…"');
    expect(stampOverlaySource).toContain("const deferredSearchQuery = useDeferredValue(filters.searchQuery)");
    expect(stampOverlaySource).toContain("function getStampRestaurantCategories(restaurant: Restaurant): string[]");
    expect(stampOverlaySource).toContain("const normalizedCategoriesByRestaurantId = useMemo(() => new Map(");
    expect(stampOverlaySource).toContain("normalizedCategoriesByRestaurantId.get(r.id) ?? []");
    expect(stampOverlaySource).toContain("value={[filters.fanVisitsMin ?? 0]}");
    expect(stampOverlaySource).not.toContain("defaultValue={[filters.fanVisitsMin ?? 0]}");
    expect(stampOverlaySource).toContain("isError: isRestaurantsError");
    expect(stampOverlaySource).toContain("도장 맛집을 불러오지 못했습니다");
    expect(stampOverlaySource).toContain("조건에 맞는 도장 맛집이 없습니다");
    expect(leaderboardOverlaySource).toContain(
      'aria-label="랭킹 및 티어 산정 기준 보기"',
    );
    expect(leaderboardOverlaySource).toContain('aria-label="랭킹 패널 닫기"');
    expect(leaderboardOverlaySource).toContain(
      'data-desktop-left-panel-leaderboard-list="true"',
    );
    expect(leaderboardOverlaySource).toContain(
      "DESKTOP_LEFT_PANEL_LEADERBOARD_LIST_STYLE",
    );
    expect(leaderboardOverlaySource).toContain("width: 'calc(100% - 1.5rem)'");
    expect(leaderboardOverlaySource).toContain("maxWidth: '368px'");
    expect(leaderboardOverlaySource).toContain("marginInline: 'auto'");
    expect(leaderboardOverlaySource).toContain(
      'className="flex h-10 items-center justify-center"',
    );
    expect(leaderboardOverlaySource).toContain("compactLeftPanel");
    expect(leaderboardOverlaySource).toContain(
      "const scrollRef = useRef<HTMLDivElement>(null);",
    );
    expect(leaderboardOverlaySource).toContain(
      "{ root: scrollRef.current, threshold: 0.1 }",
    );
    expect(leaderboardOverlaySource).toContain(
      'className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"',
    );
    expect(leaderboardOverlaySource).not.toContain(
      'import { ScrollArea } from "@/components/ui/scroll-area"',
    );
    expect(leaderboardOverlaySource).not.toContain("<ScrollArea");
    expect(leaderboardListSource).toContain("compactLeftPanel?: boolean");
    expect(leaderboardListSource).toContain(
      '? "flex items-center gap-2 pl-2 pr-5',
    );
    expect(leaderboardListSource).toContain("pl-2 pr-6 sm:px-6");
    expect(leaderboardListSource).not.toContain("px-4 sm:px-6 md:px-6");
    expect(leaderboardPageSource).toContain('className="pl-2 pr-6 sm:px-6"');
    expect(leaderboardLoadingSource).toContain(
      'className="pl-2 pr-6 sm:px-6"',
    );
    expect(leaderboardSkeletonSource).toContain("compactLeftPanel?: boolean");
    expect(leaderboardSkeletonSource).toContain("compactLeftPanel = false");
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "px-2 py-4" : "p-4"',
    );
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "gap-2" : "gap-3"',
    );
    expect(leaderboardSkeletonSource).toContain(
      'compactLeftPanel ? "w-7" : "w-9"',
    );
    expect(leaderboardOverlaySource).toContain("compactLeftPanel");
    expect(leaderboardListSource).toContain(
      "const COMPACT_LEFT_PANEL_ROW_STYLE = {",
    );
    expect(leaderboardListSource).toContain("paddingLeft: '0.5rem'");
    expect(leaderboardListSource).toContain("paddingRight: '1.25rem'");
    expect(leaderboardListSource).toContain(
      "? COMPACT_LEFT_PANEL_ROW_STYLE",
    );
    expect(leaderboardListSource).toContain(
      'compactLeftPanel && "w-7 sm:w-7"',
    );
    expect(leaderboardUtilsSource).toContain("getRankIconElement");
    expect(leaderboardUtilsSource).not.toContain("getRankIcon =");
    expect(leaderboardPageSource).toContain(
      "{ root: scrollRef.current, threshold: 0.1 }",
    );
    expect(leaderboardPageSource).toContain(
      'aria-label="랭킹 및 티어 산정 기준 보기"',
    );
  });

  test("desktop direct feature routes hand off to the home left panel and suppress popup blockers", () => {
    const feedPageSource = source("app/feed/page.tsx");
    const stampPageSource = source("app/stamp/page.tsx");
    const leaderboardPageSource = source("app/leaderboard/page.tsx");
    const overlayLayoutSource = source("components/layout/OverlayLayout.tsx");
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const combinedPopupSource = source("components/layout/CombinedPopup.tsx");
    const testHelpersSource = source("tests/helpers.ts");

    expect(feedPageSource).toContain(
      "const target = reviewId ? `/?panel=feed&review=${encodeURIComponent(reviewId)}` : '/?panel=feed';",
    );
    expect(stampPageSource).toContain("router.replace('/?panel=stamp')");
    expect(leaderboardPageSource).toContain(
      "router.replace('/?panel=leaderboard')",
    );
    expect(overlayLayoutSource).toContain("function getDirectOverlayPanel");
    expect(overlayLayoutSource).toContain("const DIRECT_OVERLAY_PANELS");
    expect(overlayLayoutSource).toContain(
      "setActiveOverlayPanel(directPanelParam);",
    );
    expect(overlayLayoutSource).toContain(
      'HOME_OVERLAY_PANEL_OPENED_EVENT = "homeOverlayPanelOpened"',
    );
    expect(overlayLayoutSource).toContain(
      "new CustomEvent(HOME_OVERLAY_PANEL_OPENED_EVENT",
    );
    const homeClientSourceForOverlayEvents = source("app/home-client.tsx");
    const homeClientEffectsSource = source("app/home-client-effects.tsx");
    const desktopLeftPanelEntrySource = source("lib/desktop-left-panel-entry.ts");
    expect(homeClientSourceForOverlayEvents).toContain(
      "window.addEventListener(",
    );
    expect(homeClientSourceForOverlayEvents).toContain(
      '"homeOverlayPanelOpened"',
    );
    expect(homeClientEffectsSource).toContain("selectBookmarkRestaurant");
    expect(homeClientEffectsSource).toContain("notifyInlineDetailOpenFailed");
    expect(homeClientEffectsSource).toContain("HOME_DESKTOP_INLINE_DETAIL_OPEN_FAILED_EVENT");
    expect(desktopLeftPanelEntrySource).toContain(
      '"home:desktop-inline-detail-open-failed"',
    );
    expect(homeClientSourceForOverlayEvents).toContain(
      "handleHomeOverlayPanelOpened",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "DESKTOP_LEFT_PANEL_ROUTE_VIEWS",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "router.replace(`/?panel=${panel}`, { scroll: false })",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.replace("/?panel=profile", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.replace("/?panel=bookmarks", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      '{ id: "notifications", label: "알림", icon: Bell }',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'router.replace("/?panel=notifications", { scroll: false })',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      '"settings"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      'data-desktop-left-panel-view="settings"',
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "writeHomeMapUserPreferences(",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "user.id,",
    );
    expect(source("app/home-client.tsx")).toContain(
      "readHomeMapUserPreferences(user.id)",
    );
    expect(source("app/home-client.tsx")).toContain(
      "HOME_MAP_USER_PREFERENCES_EVENT",
    );
    expect(source("app/home-client.tsx")).toContain(
      "!customEvent.detail.preservePanelCollapse",
    );
    expect(source("components/home/home-desktop-control-panel.tsx")).toContain(
      "preservePanelCollapse: true",
    );
    expect(source("lib/home-map-user-preferences.ts")).toContain(
      "preservePanelCollapse?: boolean",
    );
    expect(overlayLayoutSource).toContain(
      'router.replace("/", { scroll: false });',
    );
    expect(overlayLayoutSource).toContain(
      'router.replace(buildDirectOverlayHref("feed", reviewId),',
    );
    expect(overlayLayoutSource).toContain("scroll: false");
    expect(mainLayoutSource).toContain('pathname?.startsWith("/auth/") ||');
    expect(mainLayoutSource).toContain('pathname === "/feed"');
    expect(mainLayoutSource).toContain('pathname === "/stamp"');
    expect(mainLayoutSource).toContain('pathname === "/leaderboard"');
    expect(overlayLayoutSource).toContain(
      'pathname?.startsWith("/auth/") || routeDirectPanelParam !== null',
    );
    expect(overlayLayoutSource).toContain(
      "const directPanelParam = isHomeRoute ? null : routeDirectPanelParam",
    );
    expect(combinedPopupSource).toContain('data-popup-overlay="true"');
    expect(testHelpersSource).toContain('[data-popup-overlay="true"]');
  });

  test("direct utility routes render clear fallback states instead of blank or invalid panel configs", () => {
    const resetPasswordSource = source("app/auth/reset-password/page.tsx");
    const authRequiredSource = source("app/auth/required/page.tsx");
    const globalMapSource = source("app/global-map/page.tsx");
    const middlewareSource = source("lib/supabase/middleware.ts");

    expect(resetPasswordSource).not.toContain(`if (!isValidSession) {
        return null;
    }`);
    expect(resetPasswordSource).toContain(
      "비밀번호 재설정 링크를 확인해주세요",
    );
    expect(resetPasswordSource).toContain("홈으로 돌아가기");
    expect(authRequiredSource).toContain("로그인이 필요합니다");
    expect(authRequiredSource).toContain(
      "관리자 콘솔은 관리자 계정으로 로그인한 뒤 사용할 수 있습니다.",
    );
    expect(authRequiredSource).toContain(
      "마이페이지는 로그인한 뒤 사용할 수 있습니다.",
    );
    expect(middlewareSource).toContain(
      "new URL('/auth/required', request.url)",
    );
    expect(middlewareSource).toContain(
      "redirectUrl.searchParams.set('reason', reason)",
    );
    expect(middlewareSource).toContain(
      "redirectAuthRequiredWithSessionCookies(request, sourceResponse, 'admin')",
    );
    expect(middlewareSource).toContain("const isMyPageRequest");
    expect(middlewareSource).toContain(
      "pathname === '/mypage' || pathname.startsWith('/mypage/')",
    );
    expect(middlewareSource).toContain("getRequestedPathWithSearch(request)");
    expect(middlewareSource).toContain(
      "redirectMyPageAuthRequiredWithSessionCookies",
    );
    expect(globalMapSource).toContain(
      "defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={100}",
    );
    expect(globalMapSource).toContain(
      'aria-label={isGridMode ? "단일 지도 보기" : "국가별 지도 보기"}',
    );
    expect(globalMapSource).toContain("restaurantMatchesOverseasCountry");
    expect(source("lib/overseas-region-matching.ts")).toContain(
      "getOverseasSearchTermsForCountry",
    );
    expect(source("components/filters/CategoryFilter.tsx")).toContain(
      "buildOverseasCountryAddressOrFilter(selectedCountry,",
    );
    expect(source("hooks/use-google-maps.tsx")).toContain(
      "window.gm_authFailure",
    );
    const mapViewSource = source("components/map/MapView.tsx");
    expect(mapViewSource).toContain("hasGoogleRuntimeError");
    expect(mapViewSource).toContain(
      "This page didn't load Google Maps correctly",
    );
    expect(mapViewSource).toContain(
      "markersRef.current.push({ marker, restaurantId: restaurant.id });",
    );
    expect(mapViewSource).toContain(
      "const restaurant = restaurantsById.get(restaurantId);",
    );
    expect(mapViewSource).toContain(
      "console.warn('MapView: Advanced marker creation skipped', { restaurantId: restaurant.id, error });",
    );
    expect(mapViewSource).toContain(
      "console.warn('MapView: keeping previous valid bounds after bounds query failure', error);",
    );
    expect(source("lib/map-view-state-helpers.ts")).toContain(
      "throw new Error('Google Maps bounds contain non-finite coordinates')",
    );
    expect(globalMapSource).not.toContain(
      "defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}",
    );
  });

  test("admin utility APIs stay behind admin auth and short URLs cannot become open redirects", () => {
    const proxySource = source("proxy.ts");
    const naverSearchSource = source("app/api/naver-search/route.ts");
    const naverGeocodeSource = source("app/api/naver-geocode/route.ts");
    const youtubeMetaSource = source("app/api/youtube-meta/route.ts");
    const shortenSource = source("app/api/shorten/route.ts");
    const shortRedirectSource = source("app/s/[code]/page.tsx");

    expect(proxySource).not.toContain("'/api/naver-'");
    expect(proxySource).not.toContain("'/api/youtube-meta'");
    expect(proxySource).toContain("'/api/shorten'");
    for (const routeSource of [
      naverSearchSource,
      naverGeocodeSource,
      youtubeMetaSource,
    ]) {
      expect(routeSource).toContain(
        "import { requireAdmin } from '@/lib/auth/require-admin';",
      );
      expect(routeSource).toContain("const auth = await requireAdmin();");
      expect(
        routeSource.indexOf("const auth = await requireAdmin();"),
      ).toBeLessThan(
        routeSource.indexOf("request.json") === -1
          ? routeSource.indexOf("new URL(request.url)")
          : routeSource.indexOf("request.json"),
      );
    }

    expect(shortenSource).toContain("function getAllowedShortUrlTarget");
    expect(shortenSource).toContain("trimmedTargetUrl.startsWith('//')");
    expect(shortenSource).toContain("function isValidReviewId");
    expect(shortenSource).toContain(".from('reviews')");
    expect(shortenSource).toContain(".maybeSingle();");
    expect(shortenSource).toContain(
      "target_url: allowedTarget.canonicalTargetUrl",
    );
    expect(shortenSource).toContain("restaurant_id: review.restaurant_id");
    expect(shortenSource).toContain("restaurant_name: null");
    expect(shortenSource).not.toContain("restaurantId || null");
    expect(shortenSource).not.toContain("restaurantName || null");
    expect(shortenSource).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    expect(shortRedirectSource).toContain("function isSafeRedirectTarget");
    expect(shortRedirectSource).toContain("trimmedTargetUrl.startsWith('//')");
    expect(shortRedirectSource).toContain(
      "isValidReviewId(target.searchParams.get",
    );
    expect(shortRedirectSource).toContain("redirect('/');");
  });

  test("feed direct route defers heavy modals and detail panels until interaction", () => {
    const feedPageSource = source("app/feed/page.tsx");
    const feedContentSource = source("components/feed/FeedContent.tsx");
    const homeSidePanelsSource = source("app/home-client-sidepanels.tsx");

    expect(homeSidePanelsSource).toContain('data-desktop-map-review-panel="true"');
    expect(homeSidePanelsSource).toContain('role="dialog"');
    expect(homeSidePanelsSource).toContain('tabIndex={-1}');
    expect(homeSidePanelsSource).toContain("desktopReviewPanelOpenerRef");
    expect(homeSidePanelsSource).toContain("desktopReviewPanelRef.current?.focus({ preventScroll: true })");
    expect(homeSidePanelsSource).toContain('data-desktop-map-review-drag-handle="true"');
    expect(homeSidePanelsSource).toContain("onKeyDown={handleDesktopReviewPanelKeyDown}");
    expect(homeSidePanelsSource).toContain("DESKTOP_REVIEW_PANEL_KEYBOARD_STEP");
    expect(homeSidePanelsSource).toContain("ArrowLeft: [-step, 0]");
    expect(homeSidePanelsSource).toContain(
      "style={{ transform: `translate3d(${desktopReviewPanelPosition.x}px, ${desktopReviewPanelPosition.y}px, 0)` }}",
    );
    expect(homeSidePanelsSource).toContain("setPointerCapture(event.pointerId)");
    expect(homeSidePanelsSource).toContain("releasePointerCapture(event.pointerId)");
    expect(homeSidePanelsSource).toContain("inline");

    expect(feedPageSource).toContain("const RestaurantDetailPanel = dynamic(");
    expect(feedPageSource).toContain("const ReviewModal = dynamic(");
    expect(feedPageSource).toContain("const EditRestaurantModal = dynamic(");
    expect(feedPageSource).not.toContain(
      "import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';",
    );
    expect(feedPageSource).toContain("{isReviewModalOpen && (");
    expect(feedContentSource).toContain("const ReviewModal = dynamic(");
    expect(feedContentSource).toContain("const ReviewEditModal = dynamic(");
    expect(feedContentSource).toContain(
      "{!hideReviewModal && isReviewModalOpen && (",
    );
    expect(feedContentSource).toContain("{editingReview && (");
  });

  test("/mypage avoids client-side redirect work and defers desktop-only sidebar cost", () => {
    const myPageSource = source("app/mypage/page.tsx");
    const myPageLayoutSource = source("app/mypage/layout.tsx");
    const myPageLayoutContentSource = source(
      "app/mypage/mypage-layout-content.tsx",
    );
    const myPageLoadingSource = source("app/mypage/loading.tsx");
    const myPageSidebarSource = source("components/mypage/MyPageSidebar.tsx");
    const returnToMapButtonSource = source("components/layout/ReturnToMapButton.tsx");
    const myPageSectionSkeletonSource = source(
      "components/mypage/MyPageSectionSkeleton.tsx",
    );
    const myPageProfileSource = source("app/mypage/profile/page.tsx");
    const myPageSectionSources = [
      source("app/mypage/bookmarks/page.tsx"),
      source("app/mypage/reviews/page.tsx"),
      source("app/mypage/submissions/new/page.tsx"),
      source("app/mypage/submissions/edit/page.tsx"),
      source("app/mypage/submissions/recommend/page.tsx"),
    ];

    expect(myPageSource).toContain('redirect("/mypage/submissions/new")');
    expect(myPageSource).not.toContain('"use client"');
    expect(myPageSource).not.toContain("useEffect");
    expect(myPageSource).not.toContain("useRouter");
    expect(myPageLayoutSource).toContain("<AppRuntimeLayout>");
    expect(myPageLayoutContentSource).toContain("dynamic(");
    expect(myPageLayoutContentSource).not.toContain("function MyPageMobileBrandHeader()");
    expect(myPageLayoutContentSource).not.toContain('data-mypage-mobile-brand-logo="true"');
    expect(myPageLayoutContentSource).not.toContain('<MyPageMobileBrandHeader />');
    expect(myPageLayoutContentSource).toContain('data-mypage-viewport-layout="edge-to-edge"');
    expect(myPageLayoutContentSource).toContain('data-mypage-mobile-return-slot="true"');
    expect(myPageLayoutContentSource).toContain('data-mypage-mobile-return-skeleton="true"');
    expect(myPageLayoutContentSource).toContain('<ReturnToMapButton className="w-fit" />');
    expect(myPageLayoutContentSource).not.toContain('<ReturnToMapButton className="mb-3 w-fit md:hidden" />');
    expect(myPageLayoutContentSource).toContain("w-full max-w-none");
    expect(myPageLayoutContentSource).not.toContain("container mx-auto h-full min-h-0 max-w-6xl flex");
    expect(myPageLayoutContentSource).toContain("shouldRenderSidebar");
    expect(myPageLayoutContentSource).toContain(
      "function MyPageSidebarExpandedPlaceholder()",
    );
    expect(myPageLayoutContentSource).toContain(
      'data-mypage-left-panel-expanded="pending"',
    );
    expect(myPageLayoutContentSource).toContain(
      "const shouldShowSidebarFrame = userLoading || Boolean(user);",
    );
    expect(myPageLayoutContentSource).toContain("if (!shouldShowSidebarFrame) return null;");
    expect(myPageLayoutContentSource).toContain("function MyPageContentLoadingState()");
    expect(myPageLayoutContentSource).toContain('data-mypage-content-loading="true"');
    expect(myPageLayoutContentSource).toContain('data-mypage-content-hero-skeleton="true"');
    expect(myPageLayoutContentSource).toContain('data-mypage-content-actions-skeleton="true"');
    expect(myPageLayoutContentSource).toContain("rounded-3xl border border-border bg-card p-4");
    expect(myPageLayoutContentSource).toContain("<Skeleton");
    expect(myPageLayoutContentSource).not.toContain("<GlobalLoader");
    expect(myPageSectionSkeletonSource).toContain(
      'data-mypage-section-loading="true"',
    );
    expect(myPageSectionSkeletonSource).toContain("<Skeleton");
    expect(myPageLoadingSource).toContain("<MyPageSectionSkeleton />");
    expect(myPageLoadingSource).not.toContain("animate-pulse");
    for (const sectionSource of myPageSectionSources) {
      expect(sectionSource).toContain("<MyPageSectionSkeleton");
      expect(sectionSource).not.toContain("GlobalLoader");
      expect(sectionSource).not.toContain("fullScreen");
    }
    expect(myPageLayoutContentSource).not.toContain('router.replace("/")');
    expect(myPageLayoutContentSource).not.toContain("requestAuthUi({ source: 'mypage-guard'");
    expect(myPageLayoutContentSource).not.toContain("fullScreen");
    expect(myPageLayoutContentSource).toContain(
      'window.matchMedia("(min-width: 768px)")',
    );
    expect(myPageSidebarSource).toContain(
      'data-mypage-left-panel-expanded="true"',
    );
    expect(myPageSidebarSource).not.toContain('data-mypage-sidebar-brand="true"');
    expect(myPageSidebarSource).not.toContain('data-mypage-sidebar-logo="true"');
    expect(myPageSidebarSource).toContain('<ReturnToMapButton className="self-stretch justify-start" />');
    expect(myPageSidebarSource).not.toContain('aria-label="쯔동여지도 홈으로 이동"');
    expect(myPageSidebarSource).not.toContain('<span className="truncate">쯔동여지도</span>');
    expect(myPageSidebarSource).not.toContain('src="/logo.png"');
    expect(myPageSidebarSource).toContain('aria-current={isActive ? "page" : undefined}');
    expect(myPageSidebarSource).toContain('focus-visible:ring-2 focus-visible:ring-primary');
    expect(returnToMapButtonSource).toContain('data-return-to-map-button="true"');
    expect(returnToMapButtonSource).toContain("function canUseBrowserBack()");
    expect(returnToMapButtonSource).toContain('window.history.length <= 1');
    expect(returnToMapButtonSource).toContain("new URL(document.referrer).origin === window.location.origin");
    expect(returnToMapButtonSource).toContain("router.back()");
    expect(returnToMapButtonSource).toContain("router.push(fallbackHref)");
    expect(returnToMapButtonSource).toContain('fallbackHref = "/"');
    expect(myPageSidebarSource).toContain("await import('@/lib/image-utils')");
    expect(myPageSidebarSource).not.toContain(
      "import { compressImage } from '@/lib/image-utils'",
    );
    expect(myPageSidebarSource).toContain("import NextImage from 'next/image'");
    expect(myPageSidebarSource).toContain(
      'htmlFor="mypage-sidebar-avatar-upload"',
    );
    expect(myPageSidebarSource).toContain('id="mypage-sidebar-avatar-upload"');
    expect(myPageSidebarSource).toContain(
      'className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2',
    );
    expect(myPageSidebarSource).toContain("aspectRatio: '1 / 1'");
    expect(myPageSidebarSource).toContain("borderRadius: '9999px'");
    expect(myPageSidebarSource).toContain("<NextImage");
    expect(myPageSidebarSource).toContain('sizes="80px"');
    expect(myPageSidebarSource).toContain(
      'className="rounded-full object-cover"',
    );
    expect(myPageSidebarSource).not.toContain("AvatarImage");
    expect(myPageProfileSource).toContain('data-mypage-profile-page="true"');
    expect(myPageProfileSource).toContain('data-mypage-profile-hero="true"');
    expect(myPageProfileSource).toContain('data-mypage-profile-summary="true"');
    expect(myPageProfileSource).toContain('data-mypage-next-actions="true"');
    expect(myPageProfileSource).toContain('마이페이지 허브');
    expect(myPageProfileSource).toContain('바로 할 수 있는 일');
    expect(myPageProfileSource).toContain('지도 환경설정');
    expect(myPageProfileSource).toContain('href: "/?panel=settings"');
    expect(myPageProfileSource).toContain('const profileCompletionPercent = Math.round');
    expect(myPageProfileSource).toContain('const joinedDateLabel = format(createdAt');
    expect(myPageProfileSource).toContain('htmlFor="profile-avatar-upload"');
    expect(myPageProfileSource).toContain('id="profile-avatar-upload"');
    expect(myPageProfileSource).toContain(
      'className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2',
    );
    expect(myPageProfileSource).toContain("aspectRatio: '1 / 1'");
    expect(myPageProfileSource).toContain("borderRadius: '9999px'");
    expect(myPageProfileSource).toContain("<NextImage");
    expect(myPageProfileSource).toContain('sizes="96px"');
    expect(myPageProfileSource).toContain(
      'className="rounded-full object-cover"',
    );
    expect(myPageProfileSource).toContain(
      'className="flex h-full w-full items-center justify-center rounded-full bg-primary/10"',
    );
    expect(myPageProfileSource).toContain(
      'className="absolute inset-0 flex items-center justify-center rounded-full',
    );
    expect(myPageProfileSource).not.toContain("AvatarImage");
    expect(myPageProfileSource).not.toContain("sm:h-18 sm:w-18");
  });

  test("page-level loaders keep fullscreen opt-in while map fallbacks stay embedded", () => {
    const globalLoaderSource = source("components/ui/global-loader.tsx");
    const mapSkeletonSource = source("components/skeletons/MapSkeleton.tsx");

    expect(globalLoaderSource).toContain("h-[var(--full-height,100vh)]");
    expect(mapSkeletonSource).toContain('variant?: "embedded" | "fullscreen"');
    expect(mapSkeletonSource).toContain('variant = "embedded"');
    expect(mapSkeletonSource).toContain(
      "fixed inset-0 z-50 h-[var(--full-height,100vh)]",
    );
    expect(mapSkeletonSource).toContain("relative h-full min-h-[320px]");
    expect(mapSkeletonSource).toContain(
      'message = "지도 화면을 준비하고 있어요"',
    );
    expect(mapSkeletonSource).toContain('className="sr-only"');
    expect(mapSkeletonSource).not.toContain("bg-[radial-gradient");
    expect(mapSkeletonSource).not.toContain("bg-[linear-gradient");
    expect(mapSkeletonSource).not.toContain("rgba(239,68,68");
    expect(mapSkeletonSource).not.toContain("left-[18%]");
    expect(mapSkeletonSource).not.toContain("rounded-2xl bg-background/90");
    expect(mapSkeletonSource).not.toContain("GlobalLoader");
    expect(mapSkeletonSource).not.toContain("맛있는 발견을 준비하고 있습니다");
    expect(source("app/auth/reset-password/loading.tsx")).toContain(
      "<GlobalLoader",
    );
    expect(source("app/loading.tsx")).toContain(
      '<MapSkeleton variant="fullscreen" />',
    );
    expect(source("app/home-client-loader.tsx")).not.toContain("<GlobalLoader");
    expect(source("app/home-client-loader.tsx")).toContain(
      'className="sr-only"',
    );
    expect(source("app/feed/page.tsx")).toContain("<GlobalLoader");

    const appLoaderTags = sourceFilesUnder("app").flatMap((relativePath) => {
      const contents = source(relativePath);
      return (contents.match(/<GlobalLoader[\s\S]*?(?:\/>|>)/g) ?? []).map(
        (tag) => ({ relativePath, tag }),
      );
    });

    expect(appLoaderTags.length).toBeGreaterThan(0);
    for (const { relativePath, tag } of appLoaderTags) {
      expect(`${relativePath}: ${tag}`).toContain("fullScreen");
    }
  });

  test("intent-loaded mobile modal shells do not render desktop dialog on the first client paint", () => {
    const deviceTypeSource = source("hooks/useDeviceType.ts");
    const mobileSheetModalPaths = [
      "components/auth/AuthModal.tsx",
      "components/modals/EditRestaurantModal.tsx",
      "components/modals/RestaurantSubmissionModal.tsx",
      "components/profile/NicknameSetupModal.tsx",
      "components/profile/ProfileModal.tsx",
      "components/reviews/ReviewEditModal.tsx",
      "components/reviews/ReviewModal.tsx",
    ];

    expect(deviceTypeSource).toContain(
      "function isBrowserMobileOrTabletViewport()",
    );
    expect(deviceTypeSource).toContain(
      "window.innerWidth <= BREAKPOINTS.tabletMax",
    );
    expect(deviceTypeSource).toContain(
      "export function useImmediateMobileOrTablet()",
    );

    for (const relativePath of mobileSheetModalPaths) {
      const modalSource = source(relativePath);
      expect(modalSource).toContain("useImmediateMobileOrTablet");
      expect(modalSource).not.toContain(
        "const { isMobileOrTablet } = useDeviceType()",
      );
    }

    const authModalSource = source("components/auth/AuthModal.tsx");
    const reviewModalSource = source("components/reviews/ReviewModal.tsx");
    expect(authModalSource).toContain("AUTH_MODAL_DESKTOP_CONTENT_CLASS_NAME");
    expect(authModalSource).toContain("AUTH_MODAL_DESKTOP_CONTENT_STYLE");
    expect(authModalSource).toContain("min(calc(100vw - 2rem), 28rem)");
    expect(authModalSource).toContain("dispatchHomeAuthSessionUpdated");
    expect(reviewModalSource).toContain("<BottomSheet");
    expect(reviewModalSource).toContain("MOBILE_FULL_FORM_SHEET");
    expect(reviewModalSource).toContain('layoutSource="review-modal"');
    expect(reviewModalSource).toContain('aria-label="리뷰 작성 단계 진행률"');
    expect(reviewModalSource).toContain(
      "영수증 인증부터 후기 등록까지 3단계로 쉽게 작성해주세요.",
    );
    expect(reviewModalSource).not.toContain(
      'className="fixed inset-0 z-[110] h-[100dvh] bg-background"',
    );
  });

  test("auth user state lookups have Supabase index migration coverage", () => {
    const migrationDir = join(import.meta.dir, "..", "supabase/migrations");
    const migrationFile = readdirSync(migrationDir).find((file) =>
      file.endsWith("_optimize_auth_user_state_indexes.sql"),
    );

    expect(migrationFile).toBeDefined();

    const migrationSource = source(`supabase/migrations/${migrationFile}`);
    expect(migrationSource).toContain("information_schema.columns");
    expect(migrationSource).toContain("profiles_user_id_idx");
    expect(migrationSource).toContain("on public.profiles (user_id)");
    expect(migrationSource).toContain("user_roles_user_id_role_idx");
    expect(migrationSource).toContain("on public.user_roles (user_id, role)");
  });

  test("user-facing Supabase reads avoid wide fanout and redundant stamp fetches", () => {
    const feedSource = source("components/feed/FeedContent.tsx");
    const detailSource = source(
      "components/restaurant/RestaurantDetailPanel.tsx",
    );
    const stampSource = source("app/stamp/page.tsx");
    const leaderboardSource = source("hooks/useLeaderboard.ts");
    const userProfileSource = source("hooks/useUserProfile.ts");
    const myReviewsSource = source("app/mypage/reviews/page.tsx");
    const appIndexMigration = source(
      "supabase/migrations/20260506085634_optimize_app_query_indexes.sql",
    );

    expect(feedSource).toContain("FEED_REVIEW_SELECT");
    expect(feedSource).toContain("Promise.all([");
    expect(feedSource).toContain("likeCount: reviewRow.like_count || 0");
    expect(feedSource).not.toContain(
      ".from('reviews')\n                .select('*')",
    );

    expect(detailSource).toContain("RESTAURANT_DETAIL_REVIEW_SELECT");
    expect(detailSource).toContain(
      "queryKey: ['restaurant-reviews', restaurant?.id, user?.id]",
    );
    expect(detailSource).toContain(
      "const RESTAURANT_DETAIL_REVIEW_STALE_MS = 60 * 1000",
    );
    expect(detailSource).toContain(
      "const RESTAURANT_DETAIL_REVIEW_GC_MS = 5 * 60 * 1000",
    );
    expect(detailSource).toContain(
      "staleTime: RESTAURANT_DETAIL_REVIEW_STALE_MS",
    );
    expect(detailSource).toContain(
      "gcTime: RESTAURANT_DETAIL_REVIEW_GC_MS",
    );
    expect(detailSource).toContain("if (viewMode !== 'reviews') return;");
    expect(detailSource).not.toContain("refetchOnMount: 'always'");
    expect(detailSource).not.toContain("staleTime: 0");
    expect(detailSource).toContain("likeCount: review.like_count || 0");
    expect(detailSource).not.toContain(".select('review_id, user_id')");

    expect(stampSource).toContain("STAMP_REVIEW_SELECT");
    expect(stampSource).toContain("isLoading: isRestaurantsLoading");
    expect(stampSource).not.toContain("queryKey: ['restaurants-stamp']");

    expect(leaderboardSource).toContain(
      ".select('id, user_id, is_verified, created_at, like_count')",
    );
    expect(leaderboardSource).not.toContain(
      "const reviewIds = allReviewsData.map",
    );
    expect(userProfileSource).toContain("USER_PROFILE_RESTAURANT_SELECT");
    expect(userProfileSource).toContain("viewerLikesResult");
    expect(userProfileSource).toContain("likeCount: r.like_count || 0");
    expect(myReviewsSource).toContain("MY_REVIEWS_SELECT");
    expect(myReviewsSource).not.toContain('.select("*")');

    expect(appIndexMigration).toContain("restaurants_status_review_count_idx");
    expect(appIndexMigration).toContain(
      "reviews_restaurant_verified_created_idx",
    );
    expect(appIndexMigration).toContain("review_likes_review_user_idx");
    expect(appIndexMigration).toContain(
      "announcements_active_banner_priority_created_idx",
    );
    expect(appIndexMigration).toContain(
      "restaurant_submissions_status_created_idx",
    );
    expect(appIndexMigration).toContain("notifications_user_created_idx");
    expect(appIndexMigration).toContain("ad_banners_active_priority_idx");
    expect(appIndexMigration).toContain("ocr_logs_user_success_created_idx");
  });

  test("admin review queue avoids fetching approved review history", () => {
    const evaluationsSource = source("app/admin/evaluations/page.tsx");

    expect(evaluationsSource).toContain(
      "queryKey: ['admin-reviews-inline', user?.id, isAdmin]",
    );
    expect(evaluationsSource).toContain(".select(ADMIN_REVIEW_SELECT)");
    expect(evaluationsSource).toContain(".eq('is_verified', false)");
    expect(evaluationsSource).toContain(
      ".order('created_at', { ascending: false })",
    );
  });

  test("Supabase reads use explicit response shapes instead of broad selects", () => {
    const broadSelectPattern =
      /(?:\.select\(\s*(['"])\*\1|\.select\(\s*\)|\['select',\s*['"]\*|['"]\*, name:approved_name)/;
    const offenders = ["app", "components", "contexts", "hooks", "lib"]
      .flatMap(sourceFilesUnder)
      .filter((relativePath) => broadSelectPattern.test(source(relativePath)));

    expect(offenders).toEqual([]);

    const restaurantSource = source("hooks/use-restaurants.tsx");
    expect(restaurantSource).toContain("RESTAURANT_MERGE_SELECT");
    expect(restaurantSource).not.toContain("'unique_id'");
    expect(restaurantSource).not.toContain("'ai_rating'");
    expect(restaurantSource).not.toContain("'visit_count'");
    expect(restaurantSource).not.toContain("'description'");
  });

  test("global chrome assets stay small and cacheable without changing page UI", () => {
    const layoutSource = source("app/layout.tsx");
    const appRuntimeShellSource = source("app/app-runtime-shell.tsx");
    const appProvidersSource = source("app/app-providers.tsx");
    const appToasterSource = source("components/ui/app-toaster.tsx");
    const toastSource = source("components/ui/toast.tsx");
    const homeRuntimeShellSource = source("app/home-runtime-shell.tsx");
    const noToastSource = source("lib/no-toast.ts");
    const homeAppGlobalsSource = source("app/home-app-globals.css");
    const homeTailwindConfigSource = source("tailwind.home.config.ts");
    const mainLayoutSource = source("components/layout/MainLayout.tsx");
    const headerSource = source("components/layout/Header.tsx");
    const mobileControlSource = source(
      "components/home/MobileControlOverlay.tsx",
    );
    const homeMapUserMenuSource = source("components/home/HomeMapUserMenu.tsx");
    const navigationPrefetcherSource = source(
      "components/layout/NavigationPrefetcher.tsx",
    );
    const mobileBottomNavSource = source(
      "components/layout/MobileBottomNav.tsx",
    );
    const nextConfigSource = source("next.config.mjs");
    const viewportFixSource = source("public/scripts/viewport-height-fix.js");
    const authContextSource = source("contexts/AuthContext.tsx");
    const faviconPath = join(import.meta.dir, "..", "public/favicon.ico");
    const faviconPngPath = join(
      import.meta.dir,
      "..",
      "public/favicon-32x32.png",
    );
    const appleIconPath = join(
      import.meta.dir,
      "..",
      "public/apple-touch-icon.png",
    );

    expect(statSync(faviconPath).size).toBeLessThan(16 * 1024);
    expect(statSync(faviconPngPath).size).toBeLessThan(8 * 1024);
    expect(statSync(appleIconPath).size).toBeLessThan(32 * 1024);
    expect(layoutSource).toContain(
      "{ url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }",
    );
    expect(layoutSource).toContain(
      "{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }",
    );
    expect(layoutSource).toContain('href="https://oapi.map.naver.com"');
    expect(layoutSource).toContain('href="https://openapi.map.naver.com"');
    expect(layoutSource).toContain('href="https://ssl.pstatic.net"');
    expect(layoutSource).toContain('href="https://img.youtube.com"');
    expect(layoutSource).toContain("supabasePreconnectUrl");
    expect(layoutSource).not.toContain("supabaseDnsPrefetchUrl");
    expect(layoutSource).toContain(
      '<link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://img.youtube.com" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />',
    );
    expect(layoutSource).not.toContain(
      '<link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://openapi.map.naver.com" />',
    );
    expect(layoutSource).toContain(
      '<link rel="dns-prefetch" href="https://ssl.pstatic.net" />',
    );
    expect(layoutSource).toContain('href="//nrbe.map.naver.net"');
    expect(layoutSource).toContain('href="//static.naver.net"');
    expect(layoutSource).toContain(
      '<script src="/scripts/viewport-height-fix.js" defer />',
    );
    expect(layoutSource).not.toContain("next/script");
    expect(layoutSource).not.toContain('strategy="beforeInteractive"');
    expect(layoutSource).not.toContain("next/font/google");
    expect(layoutSource).not.toContain("Noto_Serif_KR");
    expect(layoutSource).not.toContain("QueryProvider");
    expect(layoutSource).not.toContain("AppProviders");
    expect(layoutSource).not.toContain("MainLayout");
    expect(appRuntimeShellSource).toContain("import './app-globals.css'");
    expect(source("app/providers.tsx")).toContain(
      "let browserQueryClient: QueryClient | undefined;",
    );
    expect(source("app/providers.tsx")).toContain(
      "browserQueryClient ??= makeQueryClient();",
    );
    expect(appRuntimeShellSource).toContain("<QueryProvider>");
    expect(appRuntimeShellSource).toContain("<AppProviders>");
    expect(appRuntimeShellSource).toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    expect(headerSource).toContain("v2.0.0 © 타이니번");
    expect(mobileControlSource).toContain("v2.0.0 © 타이니번");
    expect(homeMapUserMenuSource).toContain("v2.0.0 © 타이니번");
    expect(homeMapUserMenuSource).toContain("사업자: 601-09-04613");
    expect(homeMapUserMenuSource).toContain('aria-label="사업자 정보 펼치기/접기"');
    expect(headerSource).not.toContain("v1.0.0 © 타이니번");
    expect(mobileControlSource).not.toContain("v1.0.0 © 타이니번");
    expect(headerSource).not.toContain("v2.0.0 @ 타이니번");
    expect(mobileControlSource).not.toContain("v2.0.0 @ 타이니번");
    expect(homeMapUserMenuSource).not.toContain("v2.0.0 @ 타이니번");
    expect(appProvidersSource).toContain("<AppToaster />");
    expect(homeRuntimeShellSource).toContain(
      "import { AppToaster } from '@/components/ui/app-toaster';",
    );
    expect(homeRuntimeShellSource).toContain("<AppToaster />");
    expect(noToastSource).toContain(
      'import { toast as appToast } from "@/hooks/use-toast";',
    );
    expect(noToastSource).toContain("createElement(AppToaster)");
    expect(noToastSource).not.toContain("toast-disabled");
    expect(appToasterSource).toContain(
      '<ToastProvider swipeDirection="right">',
    );
    expect(appToasterSource).toContain("<ToastViewport />");
    expect(toastSource).toContain("top-[calc(env(safe-area-inset-top)+114px)]");
    expect(toastSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+132px)]",
    );
    expect(toastSource).not.toContain(
      "top-[calc(env(safe-area-inset-top)+7.25rem)]",
    );
    expect(toastSource).toContain("z-[250]");
    expect(toastSource).toContain("w-[min(300px,calc(100vw-1.5rem))]");
    expect(toastSource).toContain("sm:w-[min(300px,calc(100vw-1.5rem))]");
    expect(toastSource).not.toContain(
      "var(--mobile-bottom-nav-effective-height",
    );
    expect(toastSource).toContain("sm:right-3");
    expect(toastSource).not.toContain("pr-7");
    expect(toastSource).not.toContain("absolute right-2 top-2");
    expect(toastSource).not.toContain("sm:w-[min(340px,calc(100vw-2rem))]");
    expect(toastSource).not.toContain("sm:w-[min(360px,calc(100vw-2rem))]");
    expect(toastSource).not.toContain("sm:w-[min(420px,calc(100vw-2rem))]");
    expect(toastSource).toContain("data-[state=open]:fade-in-0");
    expect(toastSource).not.toContain(
      "data-[state=open]:slide-in-from-top-full",
    );
    expect(toastSource).toContain("opacity-100");
    expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
    expect(homeRuntimeShellSource).toContain("function MobileHomeLayout");
    expect(homeRuntimeShellSource).toContain(
      "function HomeRuntimePendingShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeProgressiveShell",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "function HomeRuntimeLoadingSpinner",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<HomeRuntimeProgressiveShell />",
    );
    expect(homeRuntimeShellSource).toContain("const OverlayLayout = lazy(");
    expect(homeRuntimeShellSource).toContain("<QueryProvider>");
    expect(homeRuntimeShellSource).toContain(
      "fallback={<HomeRuntimePendingShell>{children}</HomeRuntimePendingShell>}",
    );
    expect(homeRuntimeShellSource).not.toContain(
      "<MainLayout>{children}</MainLayout>",
    );
    expect(homeAppGlobalsSource).toContain(
      '@config "../tailwind.home.config.ts"',
    );
    expect(homeTailwindConfigSource).toContain("./components/home/**/*");
    expect(homeTailwindConfigSource).not.toContain("./components/admin/");
    expect(homeTailwindConfigSource).not.toContain(
      "./components/restaurant/**/*",
    );
    expect(source("tailwind.home.detail.config.ts")).toContain(
      "./components/restaurant/**/*",
    );
    expect(source("components/map/map-view-deferred-panels.tsx")).toContain(
      "import '@/app/home-detail-globals.css'",
    );
    expect(source("tailwind.home.deferred.config.ts")).toContain(
      "./components/admin/AdminRestaurantModal.tsx",
    );
    expect(source("app/home-client-sidepanels.tsx")).toContain(
      "import './home-deferred-globals.css'",
    );
    expect(source("app/home-frame/page.tsx")).toContain("<HomeRuntimeShell>");
    expect(authContextSource).toContain("HOME_AUTH_BOOTSTRAP_DELAY_MS = 30000");
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "setTimeout(activateNoncriticalMapEffects",
    );
    expect(authContextSource).toContain("shouldDelayAuthBootstrap");
    expect(authContextSource).toContain("hasPersistedSupabaseSessionHint");
    expect(authContextSource).toContain("hasSupabaseAuthSessionHint");
    expect(authContextSource).toContain(
      "shouldBootstrapAuthOnGeneralInteraction",
    );
    expect(authContextSource).toContain("AUTH_USER_STATE_CACHE_TTL_MS");
    expect(authContextSource).toContain("authUserStateRequests");
    expect(authContextSource).toContain("loadAuthUserState");
    expect(authContextSource).toContain("activeAuthUserIdRef");
    expect(authContextSource).toContain("window.setTimeout(() =>");
    expect(authContextSource).toContain("signOut({ scope: 'local' })");
    expect(authContextSource).toContain("dispatchHomeAuthSessionUpdated");
    expect(authContextSource).toContain(
      'import("@/integrations/supabase/client")',
    );
    expect(authContextSource).not.toContain("const checkAdminRole");
    expect(authContextSource).not.toContain("const checkProfileStatus");
    expect(authContextSource).not.toContain("import { supabase }");
    expect(source("contexts/NotificationContext.tsx")).toContain(
      "import('@/integrations/supabase/client')",
    );
    expect(source("contexts/NotificationContext.tsx")).not.toContain(
      "import { supabase }",
    );
    expect(source("app/home-client-effects.tsx")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("app/home-client-effects.tsx")).toContain(
      "import('./home-supabase-actions')",
    );
    expect(source("app/home-supabase-actions.ts")).toContain(
      "fetchSupabaseRows",
    );
    expect(source("app/home-supabase-actions.ts")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "@/integrations/supabase/client",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "NaverMapAnnouncementRuntime",
    );
    expect(source("components/map/NaverMapAnnouncementRuntime.tsx")).toContain(
      "useBannerAnnouncements(true)",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "NaverMapPresenceRuntime",
    );
    expect(source("components/map/NaverMapView.tsx")).toContain(
      "HydratedDetailRestaurant",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "useRestaurantWithMergeContext",
    );
    expect(source("components/map/NaverMapView.tsx")).not.toContain(
      "import('@/lib/naver-map-presence-client')",
    );
    expect(source("components/map/NaverMapPresenceRuntime.tsx")).toContain(
      "startNaverMapPresence",
    );
    expect(source("components/admin/AdminConsoleOverview.tsx")).toContain(
      "fetchSupabaseExactCount",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "fetchSupabaseExactCount",
    );
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "fetchSupabaseExactCount",
    );
    const bottomSheetSource = source("components/ui/bottom-sheet.tsx");
    expect(bottomSheetSource).toContain("dragHeightRafRef");
    expect(bottomSheetSource).toContain("pendingDragHeightRef");
    expect(bottomSheetSource).toContain(
      "scheduleDragHeightRender(nextHeightSafe);",
    );
    expect(bottomSheetSource).toContain("cancelPendingDragHeightRender();");
    expect(bottomSheetSource).toContain("one pending RAF");
    expect(source("components/home/MobileControlOverlay.tsx")).not.toContain(
      "dragTransformRafRef",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "import { supabase }",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "useBookmarks",
    );
    expect(source("components/layout/Header.tsx")).not.toContain(
      "import { RankingWidget }",
    );
    expect(source("components/layout/Header.tsx")).toContain(
      "useDeferredComponent<HeaderDeferredComponentProps>(shouldLoadAuthenticatedHeaderWidgets, loadRankingWidget)",
    );
    expect(source("components/layout/Header.tsx")).toContain(
      "useDeferredComponent<HeaderDeferredComponentProps>(shouldShowHeaderIcons, loadHeaderBookmarkMenuButton)",
    );
    expect(source("components/layout/HeaderBookmarkMenuButton.tsx")).toContain(
      "useBookmarks",
    );
    expect(mainLayoutSource).toContain("if (!hasMounted)");
    expect(mainLayoutSource).toContain("{children}");
    expect(mainLayoutSource).not.toContain(
      'min-h-screen bg-background" aria-hidden="true"',
    );
    expect(mainLayoutSource).toContain("NONCRITICAL_CHROME_DELAY_MS = 30000");
    expect(mainLayoutSource).toContain(
      "canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome",
    );
    expect(mainLayoutSource).toContain("<CombinedPopup />");
    expect(navigationPrefetcherSource).not.toContain(
      "HOME_ROUTE_PREFETCH_DELAY_MS = 8000",
    );
    expect(navigationPrefetcherSource).toContain(
      "HOME_ROUTE_PREFETCH_IDLE_TIMEOUT_MS = 2500",
    );
    expect(navigationPrefetcherSource).toContain(
      "runWhenIdle(runPrefetch, HOME_ROUTE_PREFETCH_IDLE_TIMEOUT_MS)",
    );
    expect(navigationPrefetcherSource).not.toContain("homeDelayTimer");
    expect(mobileBottomNavSource).not.toContain(
      "HOME_NAV_PREFETCH_DELAY_MS = 8000",
    );
    expect(mobileBottomNavSource).toContain(
      "HOME_NAV_PREFETCH_IDLE_TIMEOUT_MS = 2500",
    );
    expect(mobileBottomNavSource).toContain(
      "runHomeNavPrefetchWhenIdle(prefetchNavigationTargets)",
    );
    expect(mobileBottomNavSource).toContain("MOBILE_BOTTOM_NAV_BUTTON_STYLE");
    expect(mobileBottomNavSource).toContain("minHeight: 60");
    expect(mobileBottomNavSource).toContain(
      "style={MOBILE_BOTTOM_NAV_BUTTON_STYLE}",
    );
    expect(mobileBottomNavSource).toContain("'mobile-bottom-nav'");
    expect(viewportFixSource).toContain(
      "if (window.CSS?.supports?.('height', '100dvh'))",
    );
    expect(viewportFixSource).toContain(
      "window.requestAnimationFrame(updateViewportHeight)",
    );
    expect(nextConfigSource).toContain("source: '/favicon.ico'");
    expect(nextConfigSource).toContain(
      "source: '/:icon(favicon-32x32|apple-touch-icon).png'",
    );
    expect(nextConfigSource).toContain("source: '/scripts/:path*'");
    expect(source("tailwind.config.ts")).not.toContain("tailwindcss-animate");
    expect(source("app/globals.css")).not.toContain("@tailwind utilities");
    expect(source("app/globals.css")).toContain("Minimal home-first root CSS");
    expect(source("app/app-globals.css")).toContain("@tailwind utilities");
    expect(source("app/app-globals.css")).toContain("@keyframes tz-enter");
    expect(source("app/app-globals.css")).toContain(
      ".slide-in-from-top-\\[48\\%\\]",
    );
  });

  test("restaurant search controls keep accessible names and keyboard-safe rows", () => {
    const restaurantSearchSource = source("components/search/RestaurantSearch.tsx");
    const searchHistorySource = source("hooks/use-search-history.ts");
    const mobileControlSource = source("components/home/MobileControlOverlay.tsx");
    const desktopControlSource = source(
      "components/home/home-desktop-control-panel.tsx",
    );

    expect(restaurantSearchSource).toContain('name="restaurant-search"');
    expect(restaurantSearchSource).toContain('aria-label="맛집 검색어 입력"');
    expect(restaurantSearchSource).toContain(
      'aria-label="검색어 지우기"',
    );
    expect(restaurantSearchSource).not.toContain('role="button"');
    expect(restaurantSearchSource).not.toContain('맛집 이름 검색...');
    expect(restaurantSearchSource).not.toContain('검색 중...');
    expect(restaurantSearchSource).toContain('맛집 이름 검색…');
    expect(restaurantSearchSource).toContain('검색 중…');
    expect(restaurantSearchSource).toContain(
      'isPopularRestaurantsLoading',
    );
    expect(restaurantSearchSource).toContain(
      '인기 맛집을 불러오는 중…',
    );
    expect(restaurantSearchSource).toContain(
      '검색하면 최근 검색 맛집이 여기에 쌓입니다.',
    );
    expect(restaurantSearchSource).toContain(
      "edgeToEdgeInlineLayout?: boolean",
    );
    expect(restaurantSearchSource).toContain(
      "const effectiveMaxItems = maxItems ?? 5",
    );
    expect(restaurantSearchSource).toContain("popularMaxItems?: number");
    expect(restaurantSearchSource).toContain(
      "const effectivePopularMaxItems = popularMaxItems ?? effectiveMaxItems",
    );
    expect(restaurantSearchSource).toContain(
      "const popularRestaurantLimit = Math.max(effectivePopularMaxItems, 5)",
    );
    expect(restaurantSearchSource).toContain(
      'edgeToEdgeInlineLayout && "min-h-0 w-full"',
    );
    expect(restaurantSearchSource).toContain(
      '? "min-h-full border-y px-4 py-6"',
    );
    expect(searchHistorySource).toContain("const MAX_HISTORY = 12");
    expect(searchHistorySource).toContain("최대 12개 유지");
    expect(restaurantSearchSource).toContain(
      'focus-visible:ring-2 focus-visible:ring-primary',
    );
    expect(restaurantSearchSource).toContain(
      'aria-hidden="true" />',
    );
    expect(mobileControlSource).toContain(
      'name="mobile-home-restaurant-search"',
    );
    expect(desktopControlSource).toContain(
      'name="desktop-left-panel-restaurant-search"',
    );
  });

});
