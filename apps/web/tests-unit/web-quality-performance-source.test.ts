import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const sourceFilesUnder = (relativeDir: string): string[] => {
    const absoluteDir = join(import.meta.dir, '..', relativeDir);
    return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) {
            if (entry.name === '.next' || entry.name === 'node_modules') return [];
            return sourceFilesUnder(relativePath);
        }

        return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [relativePath] : [];
    });
};

describe('web quality performance source contracts', () => {
    test('map marker HTML keeps image markers with WebP delivery and PNG fallback', () => {
        const clusterMarkerSource = source('lib/cluster-marker.ts');

        expect(clusterMarkerSource).toContain('CATEGORY_IMAGES');
        expect(clusterMarkerSource).toContain('/images/maker-images/webp/${name}.webp');
        expect(clusterMarkerSource).toContain('/images/maker-images/${name}.png');
        expect(clusterMarkerSource).toContain('type="image/webp"');
        expect(clusterMarkerSource).toContain('src="${image.png}"');
        expect(clusterMarkerSource).toContain('srcset="${image.webp}"');
        expect(clusterMarkerSource).not.toContain('createCategoryMarkerGlyphHTML');
    });

    test('map marker WebP assets are present and substantially smaller than PNG fallbacks', () => {
        const markerDir = join(import.meta.dir, '..', 'public/images/maker-images');
        const webpDir = join(markerDir, 'webp');
        const pngFiles = readdirSync(markerDir).filter((file) => file.endsWith('.png'));

        expect(pngFiles.length).toBeGreaterThan(0);

        let pngTotal = 0;
        let webpTotal = 0;

        for (const file of pngFiles) {
            const pngPath = join(markerDir, file);
            const webpPath = join(webpDir, file.replace(/\.png$/, '.webp'));

            expect(existsSync(webpPath)).toBe(true);
            pngTotal += statSync(pngPath).size;
            webpTotal += statSync(webpPath).size;
        }

        expect(webpTotal).toBeLessThan(pngTotal * 0.1);
    });

    test('popup ad banners are deferred out of the initial CWV window and inactive media has no src', () => {
        const popupSource = source('components/layout/CombinedPopup.tsx');
        const hookSource = source('hooks/use-ad-banners.tsx');

        expect(popupSource).toContain('POPUP_BANNER_IDLE_DELAY_MS = 30000');
        expect(popupSource).toContain('usePopupAdBanners({ enabled: canLoadBanners })');
        expect(popupSource).toContain('src={isActive ? banner.video_url : undefined}');
        expect(popupSource).toContain('banner.image_url && isActive');
        expect(popupSource).toContain("['pointerdown', 'keydown', 'wheel', 'touchstart']");
        expect(hookSource).toContain('options: { enabled?: boolean } = {}');
        expect(hookSource).toContain('enabled: options.enabled ?? true');
    });

    test('home filter count queries run before dropdown open so triggers do not show stale zero counts', () => {
        const regionSelectorSource = source('components/region/RegionSelector.tsx');
        const categoryFilterSource = source('components/filters/CategoryFilter.tsx');

        expect(regionSelectorSource).toContain("queryKey: ['restaurants-count']");
        expect(regionSelectorSource).toContain('enabled: true,');
        expect(regionSelectorSource).not.toContain('enabled: isOpen,');
        expect(categoryFilterSource).toContain('queryKey: categoryQueryKey');
        expect(categoryFilterSource).toContain("? ['restaurants-categories', selectedRegion, selectedCountry]");
        expect(categoryFilterSource).toContain(": ['restaurants-count']");
        expect(categoryFilterSource).toContain('enabled: true,');
        expect(categoryFilterSource).not.toContain('enabled: isOpen,');
    });

    test('home map runtime renders directly while supporting queries stay intent-gated', () => {
        const pageSource = source('app/page.tsx');
        const homeClientSource = source('app/home-client.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const restaurantSearchSource = source('components/search/RestaurantSearch.tsx');
        const mobileControlSource = source('components/home/MobileControlOverlay.tsx');
        const mobileNotificationSource = source('components/home/MobileNotificationMenuButton.tsx');
        const homeControlPanelSource = source('components/home/home-control-panel.tsx');
        const homeDesktopControlPanelSource = source('components/home/home-desktop-control-panel.tsx');
        const homeClientEffectsSource = source('app/home-client-effects.tsx');
        const regionSelectorSource = source('components/region/RegionSelector.tsx');
        const categoryFilterSource = source('components/filters/CategoryFilter.tsx');
        const mapQuerySource = source('lib/map-query-helpers.ts');
        const naverMapSource = source('components/map/NaverMapView.tsx');
        const headerSource = source('components/layout/Header.tsx');
        const bannerAnnouncementsHookSource = source('hooks/use-banner-announcements.tsx');
        const deviceTypeSource = source('hooks/useDeviceType.ts');

        expect(pageSource).toContain('<HomeInitialShell />');
        expect(pageSource).toContain('homeFrameBootstrap');
        expect(pageSource).toContain("frame.src = '/home-frame' + window.location.search + window.location.hash");
        expect(pageSource).toContain("frame.id = 'home-runtime-frame'");
        expect(pageSource).not.toContain('<HomeDeferredRuntimeGate />');
        expect(pageSource).toContain('function HomeDeepLinkPreview()');
        expect(pageSource).toContain('homeDeepLinkPreviewBootstrap');
        expect(pageSource).toContain('id="home-deep-link-preview"');
        expect(pageSource).toContain('preview.hidden = false');
        expect(pageSource).toContain('<script dangerouslySetInnerHTML={{ __html: homeDeepLinkPreviewBootstrap }} />');
        expect(pageSource).toContain('맛집 정보를 준비 중입니다');
        expect(pageSource).not.toContain('searchParams: Promise');
        expect(pageSource).not.toContain('export default async function HomePage');
        expect(pageSource).not.toContain('fetchHomeDeepLinkPreviewRestaurant');
        expect(pageSource).not.toContain("fetchSupabaseRows<HomeDeepLinkPreviewRestaurant>");
        expect(pageSource).not.toContain('HomeLandingShell');
        expect(pageSource).not.toContain('HomeMapIsland');
        expect(pageSource).not.toContain('지도 준비하기');
        expect(source('app/home-frame/page.tsx')).toContain('<HomeRuntimeShell>');
        expect(source('app/home-frame/page.tsx')).toContain('<HomeClient />');
        expect(source('public/home-static.html')).toContain('id="home-initial-shell"');
        expect(source('public/home-static.html')).toContain('aria-label="쯔동여지도 로딩 중..."');
        expect(source('public/home-static.html')).toContain('class="loader"');
        expect(source('public/home-static.html')).toContain('<p class="title">쯔동여지도 로딩 중...</p>');
        expect(source('public/home-static.html')).toContain('class="loader-wrap"');
        expect(source('public/home-static.html')).not.toContain('.card{padding:28px 32px}');
        expect(source('public/home-static.html')).not.toContain('background:linear-gradient(90deg');
        expect(source('public/home-static.html')).not.toContain('홈 지도를 불러오는 중...');
        expect(source('public/home-static.html')).toContain('property="og:image"');
        expect(source('public/home-static.html')).toContain('name="twitter:card"');
        expect(source('public/home-static.html')).toContain('rel="icon"');
        expect(source('public/home-static.html')).toContain("frame.id='home-runtime-frame'");
        expect(source('public/home-static.html')).toContain("frame.src='/home-frame'+location.search+location.hash");
        expect(source('public/home-static.html')).toContain("frame.style.visibility='hidden'");
        expect(source('public/home-static.html')).toContain("frame.addEventListener('load'");
        expect(source('proxy.ts')).toContain("NextResponse.rewrite(new URL('/home-static.html', request.url))");
        expect(source('proxy.ts')).toContain("'/home-frame'");
        expect(source('proxy.ts')).toContain("request.nextUrl.searchParams.has('_rsc')");
        expect(source('proxy.ts')).toContain("request.headers.get('rsc') === '1'");
        expect(source('proxy.ts')).toContain("request.headers.has('next-router-state-tree')");
        expect(source('proxy.ts')).toContain("accept.includes('text/html')");
        expect(source('proxy.ts')).toContain("fetchDest === 'document'");
        expect(source('app/home-initial-shell.tsx')).toContain('id="home-initial-shell"');
        expect(source('app/home-initial-shell.tsx')).toContain('aria-label="쯔동여지도 로딩 중..."');
        expect(source('app/home-initial-shell.tsx')).toContain('쯔동여지도 로딩 중...');
        expect(source('app/home-initial-shell.tsx')).toContain('text-sm font-medium text-muted-foreground');
        expect(source('app/home-initial-shell.tsx')).not.toContain('bg-gradient-to-r');
        expect(source('app/home-initial-shell.tsx')).toContain('space-y-6 text-center');
        expect(source('app/home-initial-shell.tsx')).not.toContain('rounded-3xl border border-border bg-background/90 px-8 py-7');
        expect(source('app/home-initial-shell.tsx')).not.toContain('홈 지도를 불러오는 중...');
        expect(homeClientSource).toContain('<HomeMapContainer');
        expect(source('components/home/home-map-container.tsx')).not.toContain("import { useRestaurantWithMergeContext }");
        expect(source('components/home/home-map-container.tsx')).toContain('HydratedDetailRestaurant');
        const hydratedDetailSource = source('components/home/HydratedDetailRestaurant.tsx');
        expect(hydratedDetailSource).toContain('@/hooks/use-restaurant-detail');
        expect(hydratedDetailSource).toContain('DETAIL_HYDRATION_IDLE_DELAY_MS');
        expect(hydratedDetailSource).toContain('shouldHydrateDetail ? restaurant : null');
        expect(source('hooks/use-restaurants.tsx')).not.toContain('useRestaurantWithMergeContext');
        expect(homeClientSource).toContain('function HomeControlPanelLoadingShell()');
        expect(homeClientSource).toContain('쯔동여지도 검색하기');
        expect(homeClientSource).toContain('loading: () => <HomeControlPanelLoadingShell />');
        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimePendingShell');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimeLoadingSpinner');
        expect(homeRuntimeShellSource).toContain('<HomeRuntimeLoadingSpinner />');
        expect(homeRuntimeShellSource).toContain('aria-label="쯔동여지도 로딩 중..."');
        expect(homeRuntimeShellSource).toContain('쯔동여지도 로딩 중...');
        expect(homeRuntimeShellSource).toContain('text-sm font-medium text-muted-foreground');
        expect(homeRuntimeShellSource).not.toContain('bg-gradient-to-r');
        expect(homeRuntimeShellSource).toContain('space-y-6');
        expect(homeRuntimeShellSource).not.toContain('rounded-3xl border border-border bg-background/90 px-8 py-7');
        expect(homeRuntimeShellSource).not.toContain('홈 지도를 불러오는 중...');
        expect(homeRuntimeShellSource).toContain('MOBILE_BOTTOM_NAV_IDLE_DELAY_MS = 8000');
        expect(homeRuntimeShellSource).toContain('function MobileBottomNavLoadingShell');
        expect(homeRuntimeShellSource).toContain('MOBILE_BOTTOM_NAV_LOADING_ITEMS');
        expect(homeRuntimeShellSource).toContain('handleBottomNavLoadingIntent');
        expect(homeRuntimeShellSource).toContain("requestAuthUi({ source: 'mobile-bottom-nav-loading-shell-my'");
        expect(homeRuntimeShellSource).toContain('router.push(path)');
        expect(homeRuntimeShellSource).not.toContain('function MobileTopControlPendingShell');
        expect(homeRuntimeShellSource).toContain('shouldLoadMobileBottomNav ? (');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).toContain('<QueryProvider>');
        expect(homeRuntimeShellSource).toContain('fallback={<HomeRuntimePendingShell />}');
        expect(homeRuntimeShellSource).not.toContain('fallback={<div className="h-full w-full">{children}</div>}');
        expect(homeRuntimeShellSource).not.toContain('<MainLayout>{children}</MainLayout>');
        expect(homeClientSource).not.toContain('home-map-activate-button');
        expect(homeClientSource).toContain('resolveDeviceLocationStateUpdatePlan');
        expect(deviceTypeSource).toContain('function calculateDeviceTypeSnapshot()');
        expect(deviceTypeSource).toContain('const [deviceType, setDeviceType] = useState<DeviceType>(getDesktopDeviceType)');
        expect(deviceTypeSource).toContain('function resolveDeviceTypeState(previous: DeviceType, next: DeviceType): DeviceType');
        expect(deviceTypeSource).toContain('areDeviceTypesEqual(previous, next) ? previous : next');
        expect(homeClientSource).toContain('clearRestaurantDetailSelection');
        expect(homeClientSource).toContain('openRestaurantDetailSelection');
        expect(homeClientSource).toContain('releaseSearchSelectionOwnership');
        expect(homeClientEffectsSource).toContain('clearRestaurantDetailSelection: () => void');
        expect(homeClientEffectsSource).toContain('lastAnnouncementRequestKeyRef');
        expect(homeClientEffectsSource).toContain('lastRestaurantDeepLinkRequestKeyRef');
        expect(homeClientEffectsSource).toContain('lastCoordinateRequestKeyRef');
        expect(homeClientEffectsSource).toContain('pendingAnnouncementRequestRef');
        expect(homeClientEffectsSource).toContain('pendingRestaurantDeepLinkRequestRef');
        expect(homeClientEffectsSource).toContain('pendingCoordinateRequestRef');
        expect(homeClientEffectsSource).toContain('MOBILE_RESTAURANT_DEEP_LINK_IDLE_DELAY_MS = 8000');
        expect(homeClientEffectsSource).toContain("MOBILE_RESTAURANT_DEEP_LINK_ACTIVATION_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']");
        expect(homeClientEffectsSource).toContain('function isEmbeddedHomeRuntime()');
        expect(homeClientEffectsSource).toContain('!isMobileOrTablet || isEmbeddedHomeRuntime()');
        expect(homeClientEffectsSource).toContain('runOnMobileRestaurantDeepLinkIntent(() =>');
        expect(homeClientEffectsSource).toContain('let isCancelled = false');
        expect(homeClientEffectsSource).toContain('const clearRegisteredRequestKeys = () =>');
        expect(homeClientEffectsSource).toContain('clearRegisteredRequestKeys();');
        expect(homeClientEffectsSource).toContain('window.clearTimeout(timer)');
        expect(homeClientEffectsSource).toContain('eventCleanups.forEach((cleanup) => cleanup())');
        expect(homeClientEffectsSource).not.toContain('type HomeState = ReturnType<typeof useHomeState>');
        expect(homeClientEffectsSource).not.toContain('state.clearRestaurantDetailSelection()');
        expect(headerSource).toContain('const { data: activeAnnouncements = [], isLoading: isActiveAnnouncementsLoading } = useActiveAnnouncements();');
        expect(headerSource).toContain('announcement.showOnBanner');
        expect(headerSource).not.toContain('useBannerAnnouncements');
        expect(bannerAnnouncementsHookSource).toContain('fetchSupabaseRows');
        expect(bannerAnnouncementsHookSource).toContain('export function useBannerAnnouncements(enabled = true)');
        expect(bannerAnnouncementsHookSource).toContain('const activeAnnouncementsQuery = useActiveAnnouncements(enabled);');
        expect(bannerAnnouncementsHookSource).toContain('announcement.showOnBanner');
        expect(bannerAnnouncementsHookSource).not.toContain("@/hooks/use-announcements");
        expect(bannerAnnouncementsHookSource).not.toContain("['show_on_banner', 'eq.true']");
        expect(restaurantSearchSource).toContain('enabled: isFocused || isInlineView');
        expect(homeControlPanelSource).toContain('const loadHomeDesktopControlPanel = async () =>');
        expect(homeControlPanelSource).toContain("import('@/components/home/home-desktop-control-panel')");
        expect(homeControlPanelSource).toContain('const loadMobileControlOverlay = async () =>');
        expect(homeControlPanelSource).toContain("import('@/components/home/MobileControlOverlay')");
        expect(homeControlPanelSource).toContain('function MobileControlOverlayLoadingShell({ onActivate }');
        expect(homeControlPanelSource).toContain("type MobileControlOverlayIntent = 'search' | 'bookmark' | 'notification' | 'user'");
        expect(homeControlPanelSource).toContain('pendingMobileOverlayIntent');
        expect(homeControlPanelSource).toContain("onClick={() => onActivate('search')}");
        expect(homeControlPanelSource).toContain("onClick={() => onActivate('bookmark')}");
        expect(homeControlPanelSource).toContain("onClick={() => onActivate('notification')}");
        expect(homeControlPanelSource).toContain("onClick={() => onActivate('user')}");
        expect(homeControlPanelSource).toContain('initialIntent={pendingMobileOverlayIntent}');
        expect(homeControlPanelSource).toContain('MOBILE_CONTROL_OVERLAY_IDLE_DELAY_MS = 8000');
        expect(homeControlPanelSource).toContain('useDeferredComponent<MobileControlOverlayProps>');
        expect(homeControlPanelSource).toContain('shouldRenderMobile && shouldLoadMobileOverlay');
        expect(homeControlPanelSource).toContain("window.addEventListener('pointerdown', requestMobileOverlay");
        expect(homeControlPanelSource).toContain("window.addEventListener('touchstart', requestMobileOverlay");
        expect(homeControlPanelSource).toContain('shouldLoadDesktopPanel');
        expect(homeControlPanelSource).not.toContain("import MobileControlOverlay from '@/components/home/MobileControlOverlay'");
        expect(homeControlPanelSource).not.toContain('useOverseasCountryCounts');
        expect(homeControlPanelSource).not.toContain('const HomeDesktopControlPanel = lazy(');
        expect(homeControlPanelSource).not.toContain('components/search/RestaurantSearch');
        expect(homeControlPanelSource).not.toContain('components/region/RegionSelector');
        expect(homeControlPanelSource).not.toContain('components/filters/CategoryFilter');
        expect(homeDesktopControlPanelSource).toContain('const loadDesktopRestaurantSearch = async () =>');
        expect(homeDesktopControlPanelSource).toContain("import('@/components/search/RestaurantSearch')");
        expect(homeDesktopControlPanelSource).toContain('DesktopRestaurantSearchLoadingShell');
        expect(homeDesktopControlPanelSource).toContain('useDeferredComponent<RestaurantSearchComponentProps>');
        expect(homeDesktopControlPanelSource).not.toContain("import RestaurantSearch from '@/components/search/RestaurantSearch'");
        expect(homeDesktopControlPanelSource).toContain('components/region/RegionSelector');
        expect(homeDesktopControlPanelSource).toContain('components/filters/CategoryFilter');
        expect(homeDesktopControlPanelSource).toContain('useOverseasCountryCounts(mapMode)');
        expect(mobileControlSource).toContain('useOverseasCountryCounts(mapMode)');
        expect(mobileControlSource).toContain("initialIntent?: 'search' | 'bookmark' | 'notification' | 'user' | null");
        expect(mobileControlSource).toContain("const shouldOpenBookmarkOnMount = initialIntent === 'bookmark'");
        expect(mobileControlSource).toContain("const shouldOpenNotificationOnMount = initialIntent === 'notification'");
        expect(mobileControlSource).toContain("setActiveSheet('search')");
        expect(mobileControlSource).toContain('defaultOpen={shouldOpenBookmarkOnMount}');
        expect(mobileControlSource).toContain('defaultOpen={shouldOpenNotificationOnMount}');
        expect(mobileControlSource).toContain("enabled: activeSheet === 'region' || activeSheet === 'category'");
        expect(mobileControlSource).toContain('useDeferredComponent<MobileNotificationMenuButtonProps>');
        expect(mobileControlSource).not.toContain('useNotifications()');
        expect(mobileControlSource).not.toContain('formatDistanceToNow(notification.createdAt');
        expect(mobileNotificationSource).toContain('useNotifications()');
        expect(mobileNotificationSource).toContain('formatDistanceToNow(notification.createdAt');
        expect(regionSelectorSource).toContain('enabled: true,');
        expect(regionSelectorSource).toContain('fetchSupabaseRows');
        expect(regionSelectorSource).not.toContain('@/integrations/supabase/client');
        expect(categoryFilterSource).toContain('enabled: true,');
        expect(categoryFilterSource).toContain('fetchSupabaseRows');
        expect(categoryFilterSource).toContain("? ['restaurants-categories', selectedRegion, selectedCountry]");
        expect(categoryFilterSource).toContain(": ['restaurants-count']");
        expect(categoryFilterSource).not.toContain('@/integrations/supabase/client');
        expect(mapQuerySource).toContain('includeVerifiedReviewCounts: false');
        expect(naverMapSource).toContain('autoLoad: false');
        expect(naverMapSource).toContain('buildHomeMapActivationPlan');
        expect(naverMapSource).toContain('window.setTimeout(activateMapRuntime, activationPlan.delayMs)');
        expect(naverMapSource).not.toContain('{ timeout: 2000 }');
        expect(naverMapSource).toContain('NaverMapAnnouncementRuntime');
        expect(naverMapSource).not.toContain('useBannerAnnouncements } from "@/hooks/use-banner-announcements"');
        expect(naverMapSource).not.toContain('useBannerAnnouncements(shouldRunNoncriticalMapEffects)');
        expect(source('components/map/NaverMapAnnouncementRuntime.tsx')).toContain('useBannerAnnouncements(true)');
        expect(naverMapSource).toContain('setShouldRunNoncriticalMapEffects((previous) => previous ? previous : true)');
        expect(naverMapSource).toContain('activateNoncriticalMapEffects();');
        expect(naverMapSource).not.toContain('NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS');
        expect(naverMapSource).not.toContain('setTimeout(activateNoncriticalMapEffects');
        expect(naverMapSource).toContain('NaverMapPresenceRuntime');
        expect(naverMapSource).toContain('HydratedDetailRestaurant');
        expect(naverMapSource).not.toContain('useRestaurantWithMergeContext');
        expect(naverMapSource).not.toContain("import('@/lib/naver-map-presence-client')");
        expect(source('components/map/NaverMapPresenceRuntime.tsx')).toContain("startNaverMapPresence");
        expect(naverMapSource).toContain('areClusterFeaturesEqual(previous, newClusters) ? previous : newClusters');
        expect(naverMapSource).toContain('areRegionalClustersEqual(previous, newRegionalClusters) ? previous : newRegionalClusters');
        expect(naverMapSource).not.toContain('import { supabase } from "@/integrations/supabase/client"');
        expect(source('hooks/use-restaurants.tsx')).toContain('fetchSupabaseRows');
        expect(source('hooks/use-restaurants.tsx')).not.toContain('import { supabase } from "@/integrations/supabase/client"');
        expect(source('components/home/MobileControlOverlay.tsx')).toContain('fetchSupabaseRows');
        expect(source('components/home/MobileControlOverlay.tsx')).not.toContain("import { supabase } from '@/integrations/supabase/client'");
    });

    test('naver marker click centering avoids slow duplicate recenter loops', () => {
        const naverMapSource = source('components/map/NaverMapView.tsx');

        expect(naverMapSource).toContain('applyNaverImmediateMarkerCenter({');
        expect(naverMapSource).toContain('lastImmediateMarkerCenterRef.current = immediateCenterResult.markerCenter');
        expect(naverMapSource).toContain('lastImmediateMarkerCenterRef.current = null;');

        const interactionListenerIndex = naverMapSource.indexOf('const mapEventListeners = interactionListenerPlan.mapEventNames.map');
        const deferredSkipIndex = naverMapSource.indexOf('shouldSkipNaverDeferredCenterAfterImmediateMarkerClick({');

        expect(interactionListenerIndex).toBeGreaterThan(-1);
        expect(deferredSkipIndex).toBeGreaterThan(-1);
        expect(interactionListenerIndex).toBeLessThan(deferredSkipIndex);
    });

    test('profile/stamp/map regressions stay fixed while preserving deferred map loading', () => {
        const overlayPanelSource = source('components/layout/OverlayPagePanel.tsx');
        const stampCardSource = source('components/stamp/StampCard.tsx');
        const stampPageSource = source('app/stamp/page.tsx');
        const stampLoadingSource = source('app/stamp/loading.tsx');
        const skeletonLoadersSource = source('components/ui/skeleton-loaders.tsx');
        const userProfilePanelSource = source('components/profile/UserProfilePanel.tsx');
        const naverMapSource = source('components/map/NaverMapView.tsx');

        const userProfilePanelIndex = overlayPanelSource.indexOf('<UserProfilePanel');

        expect(userProfilePanelIndex).toBeGreaterThan(0);
        expect(overlayPanelSource.lastIndexOf('"w-[min(400px,calc(100vw-1rem))]"', userProfilePanelIndex)).toBeGreaterThan(0);
        expect(overlayPanelSource.lastIndexOf('"rounded-2xl border border-border shadow-2xl overflow-hidden"', userProfilePanelIndex)).toBeGreaterThan(0);
        expect(stampCardSource).toContain('getRestaurantDisplayName(typedRestaurant)');
        expect(stampCardSource).toContain('alt={`${restaurantDisplayName} 썸네일`}');
        expect(stampCardSource).toContain('title={restaurantDisplayName}');
        expect(stampCardSource).toContain('absolute inset-0 z-10 flex items-center justify-center overflow-hidden');
        expect(stampCardSource).toContain('<img');
        expect(stampCardSource).toContain('src="/images/stamp-clear.png"');
        expect(stampCardSource).toContain("stampSize?: 'default' | 'compact'");
        expect(stampCardSource).toContain('const isStampCompact = (stampSize ?? size) === \'compact\'');
        expect(stampCardSource).toContain('w-36 h-36 md:w-40 md:h-40');
        expect(stampCardSource).toContain('w-48 h-48 sm:w-56 sm:h-56');
        expect(stampCardSource).toContain('grayscale opacity-60');
        expect(stampCardSource).toContain("filter: 'grayscale(1)'");
        expect(stampCardSource).not.toContain('absolute inset-0 bg-black/');
        expect(skeletonLoadersSource).toContain('function StampPageSkeletonComponent');
        expect(skeletonLoadersSource).toContain('data-testid="stamp-page-skeleton"');
        expect(stampLoadingSource).toContain('return <StampPageSkeleton />');
        expect(stampPageSource).toContain('if (!isMounted || authLoading) return <StampPageSkeleton />');
        expect(userProfilePanelSource).toContain('import { StampCard }');
        expect(userProfilePanelSource).toContain('import { ReviewCard }');
        expect(userProfilePanelSource).toContain('const USER_PROFILE_PAGE_SIZE = 15');
        expect(userProfilePanelSource).toContain('const PROFILE_TABS = [');
        expect(userProfilePanelSource).toContain('role="tablist"');
        expect(userProfilePanelSource).toContain('grid w-full grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1');
        expect(userProfilePanelSource).toContain('onClick={() => handleTabChange(tab.value)}');
        expect(userProfilePanelSource).toContain('aria-selected={isActive}');
        expect(userProfilePanelSource).toContain('whitespace-nowrap rounded-lg border px-2 py-2.5 text-xs');
        expect(userProfilePanelSource).toContain('border-border/70 bg-background text-foreground shadow-sm');
        expect(userProfilePanelSource).toContain('grid w-full grid-cols-3 gap-2');
        expect(userProfilePanelSource.split("gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'").length - 1).toBe(2);
        expect(userProfilePanelSource).toContain('border border-border/60 bg-card/80');
        expect(userProfilePanelSource).toContain('const ProfileSectionHeader = memo');
        expect(userProfilePanelSource).toContain('방문 도장과 리뷰 활동');
        expect(userProfilePanelSource).toContain('visibleStampCount');
        expect(userProfilePanelSource).toContain('stampLoadMoreRef');
        expect(userProfilePanelSource).toContain('className="flex-shrink-0 -mr-2 h-10 w-10"');
        expect(userProfilePanelSource).toContain('<StampCard');
        expect(userProfilePanelSource).toContain('<ReviewCard');
        expect(userProfilePanelSource).toContain('size="default"');
        expect(userProfilePanelSource).toContain('stampSize="compact"');
        expect(userProfilePanelSource).not.toContain('import { Tabs, TabsContent, TabsList, TabsTrigger }');
        expect(userProfilePanelSource).not.toContain('<TabsTrigger');
        expect(userProfilePanelSource).not.toContain('const StampItem = memo(function StampItem');
        expect(userProfilePanelSource).not.toContain('const ReviewItem = memo(function ReviewItem');
        expect(userProfilePanelSource).not.toContain('<ScrollArea className="h-full">');
        expect(naverMapSource).toContain('resolveNaverRestaurantQueryBounds');
        expect(naverMapSource).toContain('shouldUseFullMapData: shouldRunNoncriticalMapEffects');
        expect(naverMapSource.match(/activateNoncriticalMapEffects\(\);/g)?.length).toBeGreaterThanOrEqual(3);
    });

    test('review like heart keeps the previous feed-style mobile and desktop overlay layout', () => {
        const reviewCardSource = source('components/reviews/ReviewCard.tsx');
        const feedContentSource = source('components/feed/FeedContent.tsx');
        const profilePanelSource = source('components/profile/UserProfilePanel.tsx');
        const restaurantDetailSource = source('components/restaurant/RestaurantDetailPanel.tsx');
        const stampPageSource = source('app/stamp/page.tsx');

        expect(reviewCardSource).toContain('const [optimisticLike, setOptimisticLike] = useState');
        expect(reviewCardSource).toContain("import { Avatar, AvatarFallback, AvatarImage }");
        expect(reviewCardSource).toContain('<Avatar className="h-8 w-8 bg-primary/10">');
        expect(reviewCardSource).toContain('<AvatarImage');
        expect(reviewCardSource).toContain('<AvatarFallback className="bg-primary/10">');
        expect(reviewCardSource).toContain('setOptimisticLike({');
        expect(reviewCardSource).toContain('optimisticLike.isLiked ?');
        expect(reviewCardSource).toContain("typeof (result as Promise<void>).catch === 'function'");
        expect(reviewCardSource).not.toContain('if (!currentUserId)');
        expect(reviewCardSource).toContain('className="flex items-center gap-1 group"');
        expect(reviewCardSource).toContain("className={`w-5 h-5 transition-all");
        expect(reviewCardSource).toContain('text-xs font-medium');
        expect(reviewCardSource).toContain("'text-muted-foreground'");
        expect(reviewCardSource).toContain("'text-red-500'");
        expect(reviewCardSource).not.toContain('className="group relative flex h-8 w-8 items-center justify-center rounded-full');
        expect(reviewCardSource).toContain("aria-label={`좋아요 ${optimisticLike.count}개${optimisticLike.isLiked ? ' 취소' : ' 누르기'}`}");
        expect(reviewCardSource).toContain('aria-pressed={optimisticLike.isLiked}');
        expect(reviewCardSource).toContain('aria-label={isShareCopied ? "리뷰 링크 복사됨" : "리뷰 공유"}');
        expect(reviewCardSource).toContain('aria-label={`${review.restaurantName} 맛집 상세 보기`}');
        expect(reviewCardSource).not.toContain('aria-label={`좋아요 ${review.likeCount}개`}');
        expect(reviewCardSource).not.toContain('absolute inset-0 flex items-center justify-center text-[9px]');
        expect(reviewCardSource).not.toContain('text-[10px] font-bold leading-none tabular-nums');

        for (const parentSource of [feedContentSource, profilePanelSource, restaurantDetailSource, stampPageSource]) {
            expect(parentSource).not.toContain("throw new Error('LOGIN_REQUIRED')");
            expect(parentSource).toContain('throw error;');
        }
    });

    test('auth-gated review actions open UI prompts without uncaught LOGIN_REQUIRED throws', () => {
        const feedContentSource = source('components/feed/FeedContent.tsx');
        const profilePanelSource = source('components/profile/UserProfilePanel.tsx');
        const restaurantDetailSource = source('components/restaurant/RestaurantDetailPanel.tsx');
        const stampPageSource = source('app/stamp/page.tsx');

        expect(feedContentSource).toContain('if (!user) {');
        expect(feedContentSource).toContain('if (onOpenAuth) {');
        expect(feedContentSource).toContain('onOpenAuth();');
        expect(feedContentSource).toContain("return;");
        expect(profilePanelSource).toContain("title: '로그인 필요'");
        expect(restaurantDetailSource).toContain('setIsAuthModalOpen(true);');
        expect(stampPageSource).toContain("console.warn('로그인이 필요합니다.');");

        for (const authGateSource of [feedContentSource, profilePanelSource, restaurantDetailSource, stampPageSource]) {
            expect(authGateSource).not.toContain("LOGIN_REQUIRED");
        }
    });

    test('overlay and review icon buttons expose stable accessible names', () => {
        const feedContentSource = source('components/feed/FeedContent.tsx');
        const restaurantReviewsPanelSource = source('components/stamp/RestaurantReviewsPanel.tsx');
        const stampOverlaySource = source('components/overlay-pages/StampOverlay.tsx');
        const leaderboardOverlaySource = source('components/overlay-pages/LeaderboardOverlay.tsx');
        const leaderboardPageSource = source('app/leaderboard/page.tsx');

        expect(feedContentSource).toContain('aria-label={showMyReviewsOnly ? "모든 리뷰 보기" : "내 리뷰만 보기"}');
        expect(feedContentSource).toContain('aria-label={isFilterExpanded ? "검색 필터 접기" : "검색 필터 펼치기"}');
        expect(feedContentSource).toContain('aria-label="리뷰 패널 닫기"');
        expect(feedContentSource).toContain('aria-label="리뷰 작성"');
        expect(restaurantReviewsPanelSource).toContain('aria-label="맛집 리뷰 패널 닫기"');
        expect(stampOverlaySource).toContain('aria-label={filters.showUnvisitedOnly ? "모든 맛집 보기" : "안 가본 곳만 보기"}');
        expect(stampOverlaySource).toContain('aria-label={isFilterExpanded ? "도장 필터 접기" : "도장 필터 펼치기"}');
        expect(stampOverlaySource).toContain('aria-label="도장 패널 닫기"');
        expect(leaderboardOverlaySource).toContain('aria-label="랭킹 및 티어 산정 기준 보기"');
        expect(leaderboardOverlaySource).toContain('aria-label="랭킹 패널 닫기"');
        expect(leaderboardPageSource).toContain('aria-label="랭킹 및 티어 산정 기준 보기"');
    });




    test('desktop direct feature routes hand off to home overlays and suppress popup blockers', () => {
        const feedPageSource = source('app/feed/page.tsx');
        const stampPageSource = source('app/stamp/page.tsx');
        const leaderboardPageSource = source('app/leaderboard/page.tsx');
        const overlayLayoutSource = source('components/layout/OverlayLayout.tsx');
        const mainLayoutSource = source('components/layout/MainLayout.tsx');
        const combinedPopupSource = source('components/layout/CombinedPopup.tsx');
        const testHelpersSource = source('tests/helpers.ts');

        expect(feedPageSource).toContain("const target = reviewId ? `/?panel=feed&review=${encodeURIComponent(reviewId)}` : '/?panel=feed';");
        expect(stampPageSource).toContain("router.replace('/?panel=stamp')");
        expect(leaderboardPageSource).toContain("router.replace('/?panel=leaderboard')");
        expect(overlayLayoutSource).toContain('function getDirectOverlayPanel');
        expect(overlayLayoutSource).toContain('const DIRECT_OVERLAY_PANELS');
        expect(overlayLayoutSource).toContain('setActiveOverlayPanel(directPanelParam);');
        expect(overlayLayoutSource).toContain("HOME_OVERLAY_PANEL_OPENED_EVENT = 'homeOverlayPanelOpened'");
        expect(overlayLayoutSource).toContain('window.dispatchEvent(new CustomEvent(HOME_OVERLAY_PANEL_OPENED_EVENT');
        expect(source('app/home-client.tsx')).toContain("window.addEventListener('homeOverlayPanelOpened', handleHomeOverlayPanelOpened)");
        expect(overlayLayoutSource).toContain("router.replace('/', { scroll: false });");
        expect(overlayLayoutSource).toContain("router.replace(buildDirectOverlayHref('feed', reviewId), { scroll: false });");
        expect(mainLayoutSource).toContain("pathname?.startsWith('/auth/') || pathname === '/feed' || pathname === '/stamp' || pathname === '/leaderboard'");
        expect(overlayLayoutSource).toContain("pathname?.startsWith('/auth/') || directPanelParam !== null");
        expect(combinedPopupSource).toContain('data-popup-overlay="true"');
        expect(testHelpersSource).toContain('[data-popup-overlay="true"]');
    });

    test('direct utility routes render clear fallback states instead of blank or invalid panel configs', () => {
        const resetPasswordSource = source('app/auth/reset-password/page.tsx');
        const authRequiredSource = source('app/auth/required/page.tsx');
        const globalMapSource = source('app/global-map/page.tsx');
        const middlewareSource = source('lib/supabase/middleware.ts');

        expect(resetPasswordSource).not.toContain(`if (!isValidSession) {
        return null;
    }`);
        expect(resetPasswordSource).toContain('비밀번호 재설정 링크를 확인해주세요');
        expect(resetPasswordSource).toContain('홈으로 돌아가기');
        expect(authRequiredSource).toContain('로그인이 필요합니다');
        expect(authRequiredSource).toContain('관리자 콘솔은 관리자 계정으로 로그인한 뒤 사용할 수 있습니다.');
        expect(middlewareSource).toContain("new URL('/auth/required', request.url)");
        expect(middlewareSource).toContain("redirectUrl.searchParams.set('reason', 'admin')");
        expect(globalMapSource).toContain('defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={100}');
        expect(globalMapSource).toContain('aria-label={isGridMode ? "단일 지도 보기" : "국가별 지도 보기"}');
        expect(globalMapSource).toContain('restaurantMatchesOverseasCountry');
        expect(source('lib/overseas-region-matching.ts')).toContain('getOverseasSearchTermsForCountry');
        expect(source('components/filters/CategoryFilter.tsx')).toContain('buildOverseasCountryAddressOrFilter(selectedCountry,');
        expect(source('hooks/use-google-maps.tsx')).toContain('window.gm_authFailure');
        const mapViewSource = source('components/map/MapView.tsx');
        expect(mapViewSource).toContain('hasGoogleRuntimeError');
        expect(mapViewSource).toContain("This page didn't load Google Maps correctly");
        expect(mapViewSource).toContain('markersRef.current.push({ marker, restaurantId: restaurant.id });');
        expect(mapViewSource).toContain('const restaurant = restaurantsById.get(restaurantId);');
        expect(mapViewSource).toContain("console.warn('MapView: Advanced marker creation skipped', { restaurantId: restaurant.id, error });");
        expect(mapViewSource).toContain("console.warn('MapView: keeping previous valid bounds after bounds query failure', error);");
        expect(source('lib/map-view-state-helpers.ts')).toContain("throw new Error('Google Maps bounds contain non-finite coordinates')");
        expect(globalMapSource).not.toContain('defaultSize={panelRestaurant && isPanelOpen ? 75 : 100} minSize={40} maxSize={80}');
    });

    test('admin utility APIs stay behind admin auth and short URLs cannot become open redirects', () => {
        const proxySource = source('proxy.ts');
        const naverSearchSource = source('app/api/naver-search/route.ts');
        const naverGeocodeSource = source('app/api/naver-geocode/route.ts');
        const youtubeMetaSource = source('app/api/youtube-meta/route.ts');
        const shortenSource = source('app/api/shorten/route.ts');
        const shortRedirectSource = source('app/s/[code]/page.tsx');

        expect(proxySource).not.toContain("'/api/naver-'");
        expect(proxySource).not.toContain("'/api/youtube-meta'");
        expect(proxySource).toContain("'/api/shorten'");
        for (const routeSource of [naverSearchSource, naverGeocodeSource, youtubeMetaSource]) {
            expect(routeSource).toContain("import { requireAdmin } from '@/lib/auth/require-admin';");
            expect(routeSource).toContain('const auth = await requireAdmin();');
            expect(routeSource.indexOf('const auth = await requireAdmin();')).toBeLessThan(routeSource.indexOf('request.json') === -1 ? routeSource.indexOf('new URL(request.url)') : routeSource.indexOf('request.json'));
        }

        expect(shortenSource).toContain('function getAllowedShortUrlTarget');
        expect(shortenSource).toContain("trimmedTargetUrl.startsWith('//')");
        expect(shortenSource).toContain('function isValidReviewId');
        expect(shortenSource).toContain(".from('reviews')");
        expect(shortenSource).toContain('.maybeSingle();');
        expect(shortenSource).toContain('target_url: allowedTarget.canonicalTargetUrl');
        expect(shortenSource).toContain('restaurant_id: review.restaurant_id');
        expect(shortenSource).toContain('restaurant_name: null');
        expect(shortenSource).not.toContain('restaurantId || null');
        expect(shortenSource).not.toContain('restaurantName || null');
        expect(shortenSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
        expect(shortRedirectSource).toContain('function isSafeRedirectTarget');
        expect(shortRedirectSource).toContain("trimmedTargetUrl.startsWith('//')");
        expect(shortRedirectSource).toContain('isValidReviewId(target.searchParams.get');
        expect(shortRedirectSource).toContain("redirect('/');");
    });

    test('feed direct route defers heavy modals and detail panels until interaction', () => {
        const feedPageSource = source('app/feed/page.tsx');
        const feedContentSource = source('components/feed/FeedContent.tsx');

        expect(feedPageSource).toContain("const RestaurantDetailPanel = dynamic(");
        expect(feedPageSource).toContain("const ReviewModal = dynamic(");
        expect(feedPageSource).toContain("const EditRestaurantModal = dynamic(");
        expect(feedPageSource).not.toContain("import { RestaurantDetailPanel } from '@/components/restaurant/RestaurantDetailPanel';");
        expect(feedPageSource).toContain('{isReviewModalOpen && (');
        expect(feedContentSource).toContain("const ReviewModal = dynamic(");
        expect(feedContentSource).toContain("const ReviewEditModal = dynamic(");
        expect(feedContentSource).toContain('{!hideReviewModal && isReviewModalOpen && (');
        expect(feedContentSource).toContain('{editingReview && (');
    });

    test('/mypage avoids client-side redirect work and defers desktop-only sidebar cost', () => {
        const myPageSource = source('app/mypage/page.tsx');
        const myPageLayoutSource = source('app/mypage/layout.tsx');
        const myPageLayoutContentSource = source('app/mypage/mypage-layout-content.tsx');
        const myPageSidebarSource = source('components/mypage/MyPageSidebar.tsx');
        const myPageProfileSource = source('app/mypage/profile/page.tsx');

        expect(myPageSource).toContain('redirect("/mypage/submissions/new")');
        expect(myPageSource).not.toContain('"use client"');
        expect(myPageSource).not.toContain('useEffect');
        expect(myPageSource).not.toContain('useRouter');
        expect(myPageLayoutSource).toContain('<AppRuntimeLayout>');
        expect(myPageLayoutContentSource).toContain('dynamic(');
        expect(myPageLayoutContentSource).toContain('shouldRenderSidebar');
        expect(myPageLayoutContentSource).toContain('window.matchMedia("(min-width: 768px)")');
        expect(myPageSidebarSource).toContain("await import('@/lib/image-utils')");
        expect(myPageSidebarSource).not.toContain("import { compressImage } from '@/lib/image-utils'");
        expect(myPageSidebarSource).toContain("import NextImage from 'next/image'");
        expect(myPageSidebarSource).toContain('htmlFor="mypage-sidebar-avatar-upload"');
        expect(myPageSidebarSource).toContain('id="mypage-sidebar-avatar-upload"');
        expect(myPageSidebarSource).toContain('className="relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2');
        expect(myPageSidebarSource).toContain("aspectRatio: '1 / 1'");
        expect(myPageSidebarSource).toContain("borderRadius: '9999px'");
        expect(myPageSidebarSource).toContain('<NextImage');
        expect(myPageSidebarSource).toContain('sizes="80px"');
        expect(myPageSidebarSource).toContain('className="rounded-full object-cover"');
        expect(myPageSidebarSource).not.toContain('AvatarImage');
        expect(myPageProfileSource).toContain('htmlFor="profile-avatar-upload"');
        expect(myPageProfileSource).toContain('id="profile-avatar-upload"');
        expect(myPageProfileSource).toContain('className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2');
        expect(myPageProfileSource).toContain("aspectRatio: '1 / 1'");
        expect(myPageProfileSource).toContain("borderRadius: '9999px'");
        expect(myPageProfileSource).toContain('<NextImage');
        expect(myPageProfileSource).toContain('sizes="96px"');
        expect(myPageProfileSource).toContain('className="rounded-full object-cover"');
        expect(myPageProfileSource).toContain('className="flex h-full w-full items-center justify-center rounded-full bg-primary/10"');
        expect(myPageProfileSource).toContain('className="absolute inset-0 flex items-center justify-center rounded-full');
        expect(myPageProfileSource).not.toContain('AvatarImage');
        expect(myPageProfileSource).not.toContain('sm:h-18 sm:w-18');
    });

    test('page-level loading spinners stay centered in the viewport', () => {
        const globalLoaderSource = source('components/ui/global-loader.tsx');
        const mapSkeletonSource = source('components/skeletons/MapSkeleton.tsx');

        expect(globalLoaderSource).toContain('h-[var(--full-height,100vh)]');
        expect(mapSkeletonSource).toContain('h-[var(--full-height,100vh)]');
        expect(mapSkeletonSource).toContain('aria-label="쯔동여지도 로딩 중..."');
        expect(mapSkeletonSource).toContain('sr-only');
        expect(mapSkeletonSource).not.toContain('GlobalLoader');
        expect(mapSkeletonSource).not.toContain('맛있는 발견을 준비하고 있습니다');
        expect(source('app/auth/reset-password/loading.tsx')).toContain('<GlobalLoader');
        expect(source('app/home-client-loader.tsx')).toContain('<GlobalLoader');
        expect(source('app/feed/page.tsx')).toContain('<GlobalLoader');

        const appLoaderTags = sourceFilesUnder('app')
            .flatMap((relativePath) => {
                const contents = source(relativePath);
                return (contents.match(/<GlobalLoader[\s\S]*?(?:\/>|>)/g) ?? [])
                    .map((tag) => ({ relativePath, tag }));
            });

        expect(appLoaderTags.length).toBeGreaterThan(0);
        for (const { relativePath, tag } of appLoaderTags) {
            expect(`${relativePath}: ${tag}`).toContain('fullScreen');
        }
    });

    test('intent-loaded mobile modal shells do not render desktop dialog on the first client paint', () => {
        const deviceTypeSource = source('hooks/useDeviceType.ts');
        const mobileSheetModalPaths = [
            'components/auth/AuthModal.tsx',
            'components/modals/EditRestaurantModal.tsx',
            'components/modals/RestaurantSubmissionModal.tsx',
            'components/profile/NicknameSetupModal.tsx',
            'components/profile/ProfileModal.tsx',
            'components/reviews/ReviewEditModal.tsx',
            'components/reviews/ReviewModal.tsx',
        ];

        expect(deviceTypeSource).toContain('function isBrowserMobileOrTabletViewport()');
        expect(deviceTypeSource).toContain('window.innerWidth <= BREAKPOINTS.tabletMax');
        expect(deviceTypeSource).toContain('export function useImmediateMobileOrTablet()');

        for (const relativePath of mobileSheetModalPaths) {
            const modalSource = source(relativePath);
            expect(modalSource).toContain('useImmediateMobileOrTablet');
            expect(modalSource).not.toContain('const { isMobileOrTablet } = useDeviceType()');
        }

        const authModalSource = source('components/auth/AuthModal.tsx');
        expect(authModalSource).toContain('AUTH_MODAL_DESKTOP_CONTENT_CLASS_NAME');
        expect(authModalSource).toContain('AUTH_MODAL_DESKTOP_CONTENT_STYLE');
        expect(authModalSource).toContain('min(calc(100vw - 2rem), 28rem)');
        expect(authModalSource).toContain('dispatchHomeAuthSessionUpdated');
    });

    test('auth user state lookups have Supabase index migration coverage', () => {
        const migrationDir = join(import.meta.dir, '..', 'supabase/migrations');
        const migrationFile = readdirSync(migrationDir).find((file) => file.endsWith('_optimize_auth_user_state_indexes.sql'));

        expect(migrationFile).toBeDefined();

        const migrationSource = source(`supabase/migrations/${migrationFile}`);
        expect(migrationSource).toContain('information_schema.columns');
        expect(migrationSource).toContain('profiles_user_id_idx');
        expect(migrationSource).toContain('on public.profiles (user_id)');
        expect(migrationSource).toContain('user_roles_user_id_role_idx');
        expect(migrationSource).toContain('on public.user_roles (user_id, role)');
    });

    test('user-facing Supabase reads avoid wide fanout and redundant stamp fetches', () => {
        const feedSource = source('components/feed/FeedContent.tsx');
        const detailSource = source('components/restaurant/RestaurantDetailPanel.tsx');
        const stampSource = source('app/stamp/page.tsx');
        const leaderboardSource = source('hooks/useLeaderboard.ts');
        const userProfileSource = source('hooks/useUserProfile.ts');
        const myReviewsSource = source('app/mypage/reviews/page.tsx');
        const appIndexMigration = source('supabase/migrations/20260506085634_optimize_app_query_indexes.sql');

        expect(feedSource).toContain('FEED_REVIEW_SELECT');
        expect(feedSource).toContain('Promise.all([');
        expect(feedSource).toContain('likeCount: reviewRow.like_count || 0');
        expect(feedSource).not.toContain(".from('reviews')\n                .select('*')");

        expect(detailSource).toContain('RESTAURANT_DETAIL_REVIEW_SELECT');
        expect(detailSource).toContain("queryKey: ['restaurant-reviews', restaurant?.id, user?.id]");
        expect(detailSource).toContain('likeCount: review.like_count || 0');
        expect(detailSource).not.toContain(".select('review_id, user_id')");

        expect(stampSource).toContain('STAMP_REVIEW_SELECT');
        expect(stampSource).toContain('isLoading: isRestaurantsLoading');
        expect(stampSource).not.toContain("queryKey: ['restaurants-stamp']");

        expect(leaderboardSource).toContain(".select('id, user_id, is_verified, created_at, like_count')");
        expect(leaderboardSource).not.toContain('const reviewIds = allReviewsData.map');
        expect(userProfileSource).toContain('USER_PROFILE_RESTAURANT_SELECT');
        expect(userProfileSource).toContain('viewerLikesResult');
        expect(userProfileSource).toContain('likeCount: r.like_count || 0');
        expect(myReviewsSource).toContain('MY_REVIEWS_SELECT');
        expect(myReviewsSource).not.toContain('.select("*")');

        expect(appIndexMigration).toContain('restaurants_status_review_count_idx');
        expect(appIndexMigration).toContain('reviews_restaurant_verified_created_idx');
        expect(appIndexMigration).toContain('review_likes_review_user_idx');
        expect(appIndexMigration).toContain('announcements_active_banner_priority_created_idx');
        expect(appIndexMigration).toContain('restaurant_submissions_status_created_idx');
        expect(appIndexMigration).toContain('notifications_user_created_idx');
        expect(appIndexMigration).toContain('ad_banners_active_priority_idx');
        expect(appIndexMigration).toContain('ocr_logs_user_success_created_idx');
    });


  test('admin review queue avoids fetching approved review history', () => {
    const evaluationsSource = source('app/admin/evaluations/page.tsx');

    expect(evaluationsSource).toContain("queryKey: ['admin-reviews-inline', user?.id, isAdmin]");
    expect(evaluationsSource).toContain(".select(ADMIN_REVIEW_SELECT)");
    expect(evaluationsSource).toContain(".eq('is_verified', false)");
    expect(evaluationsSource).toContain(".order('created_at', { ascending: false })");
  });

  test('Supabase reads use explicit response shapes instead of broad selects', () => {
        const broadSelectPattern = /(?:\.select\(\s*(['"])\*\1|\.select\(\s*\)|\['select',\s*['"]\*|['"]\*, name:approved_name)/;
        const offenders = ['app', 'components', 'contexts', 'hooks', 'lib']
            .flatMap(sourceFilesUnder)
            .filter((relativePath) => broadSelectPattern.test(source(relativePath)));

        expect(offenders).toEqual([]);

        const restaurantSource = source('hooks/use-restaurants.tsx');
        expect(restaurantSource).toContain('RESTAURANT_MERGE_SELECT');
        expect(restaurantSource).not.toContain("'unique_id'");
        expect(restaurantSource).not.toContain("'ai_rating'");
        expect(restaurantSource).not.toContain("'visit_count'");
        expect(restaurantSource).not.toContain("'description'");
    });

    test('global chrome assets stay small and cacheable without changing page UI', () => {
        const layoutSource = source('app/layout.tsx');
        const appRuntimeShellSource = source('app/app-runtime-shell.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const homeAppGlobalsSource = source('app/home-app-globals.css');
        const homeTailwindConfigSource = source('tailwind.home.config.ts');
        const mainLayoutSource = source('components/layout/MainLayout.tsx');
        const navigationPrefetcherSource = source('components/layout/NavigationPrefetcher.tsx');
        const mobileBottomNavSource = source('components/layout/MobileBottomNav.tsx');
        const nextConfigSource = source('next.config.mjs');
        const viewportFixSource = source('public/scripts/viewport-height-fix.js');
        const authContextSource = source('contexts/AuthContext.tsx');
        const faviconPath = join(import.meta.dir, '..', 'public/favicon.ico');
        const faviconPngPath = join(import.meta.dir, '..', 'public/favicon-32x32.png');
        const appleIconPath = join(import.meta.dir, '..', 'public/apple-touch-icon.png');

        expect(statSync(faviconPath).size).toBeLessThan(16 * 1024);
        expect(statSync(faviconPngPath).size).toBeLessThan(8 * 1024);
        expect(statSync(appleIconPath).size).toBeLessThan(32 * 1024);
        expect(layoutSource).toContain("{ url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' }");
        expect(layoutSource).toContain("{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }");
        expect(layoutSource).toContain('href="https://oapi.map.naver.com"');
        expect(layoutSource).toContain('href="https://openapi.map.naver.com"');
        expect(layoutSource).toContain('href="https://ssl.pstatic.net"');
        expect(layoutSource).toContain('href="https://img.youtube.com"');
        expect(layoutSource).toContain('supabasePreconnectUrl');
        expect(layoutSource).not.toContain('supabaseDnsPrefetchUrl');
        expect(layoutSource).toContain('<link rel="preconnect" href={supabasePreconnectUrl} crossOrigin="anonymous" />');
        expect(layoutSource).toContain('<link rel="preconnect" href="https://oapi.map.naver.com" crossOrigin="anonymous" />');
        expect(layoutSource).not.toContain('<link rel="preconnect" href="https://img.youtube.com" crossOrigin="anonymous" />');
        expect(layoutSource).toContain('<link rel="dns-prefetch" href="https://img.youtube.com" />');
        expect(layoutSource).not.toContain('<link rel="preconnect" href="https://openapi.map.naver.com" crossOrigin="anonymous" />');
        expect(layoutSource).not.toContain('<link rel="preconnect" href="https://ssl.pstatic.net" crossOrigin="anonymous" />');
        expect(layoutSource).toContain('<link rel="dns-prefetch" href="https://openapi.map.naver.com" />');
        expect(layoutSource).toContain('<link rel="dns-prefetch" href="https://ssl.pstatic.net" />');
        expect(layoutSource).toContain('href="//nrbe.map.naver.net"');
        expect(layoutSource).toContain('href="//static.naver.net"');
        expect(layoutSource).toContain('<script src="/scripts/viewport-height-fix.js" defer />');
        expect(layoutSource).not.toContain('next/script');
        expect(layoutSource).not.toContain('strategy="beforeInteractive"');
        expect(layoutSource).not.toContain('next/font/google');
        expect(layoutSource).not.toContain('Noto_Serif_KR');
        expect(layoutSource).not.toContain('QueryProvider');
        expect(layoutSource).not.toContain('AppProviders');
        expect(layoutSource).not.toContain('MainLayout');
        expect(appRuntimeShellSource).toContain("import './app-globals.css'");
        expect(appRuntimeShellSource).toContain('<QueryProvider>');
        expect(appRuntimeShellSource).toContain('<AppProviders>');
        expect(appRuntimeShellSource).toContain('<MainLayout>{children}</MainLayout>');
        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimePendingShell');
        expect(homeRuntimeShellSource).toContain('function HomeRuntimeLoadingSpinner');
        expect(homeRuntimeShellSource).toContain('<HomeRuntimeLoadingSpinner />');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).toContain('<QueryProvider>');
        expect(homeRuntimeShellSource).toContain('fallback={<HomeRuntimePendingShell />}');
        expect(homeRuntimeShellSource).not.toContain('<MainLayout>{children}</MainLayout>');
        expect(homeAppGlobalsSource).toContain('@config "../tailwind.home.config.ts"');
        expect(homeTailwindConfigSource).toContain('./components/home/**/*');
        expect(homeTailwindConfigSource).not.toContain('./components/admin/');
        expect(homeTailwindConfigSource).not.toContain('./components/restaurant/**/*');
        expect(source('tailwind.home.detail.config.ts')).toContain('./components/restaurant/**/*');
        expect(source('components/map/map-view-deferred-panels.tsx')).toContain("import '@/app/home-detail-globals.css'");
        expect(source('tailwind.home.deferred.config.ts')).toContain('./components/admin/AdminRestaurantModal.tsx');
        expect(source('app/home-client-sidepanels.tsx')).toContain("import './home-deferred-globals.css'");
        expect(source('app/home-frame/page.tsx')).toContain('<HomeRuntimeShell>');
        expect(authContextSource).toContain('HOME_AUTH_BOOTSTRAP_DELAY_MS = 30000');
        expect(source('components/map/NaverMapView.tsx')).not.toContain('NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS');
        expect(source('components/map/NaverMapView.tsx')).not.toContain('setTimeout(activateNoncriticalMapEffects');
        expect(authContextSource).toContain('shouldDelayAuthBootstrap');
        expect(authContextSource).toContain('hasPersistedSupabaseSessionHint');
        expect(authContextSource).toContain('hasSupabaseAuthSessionHint');
        expect(authContextSource).toContain('shouldBootstrapAuthOnGeneralInteraction');
        expect(authContextSource).toContain('AUTH_USER_STATE_CACHE_TTL_MS');
        expect(authContextSource).toContain('authUserStateRequests');
        expect(authContextSource).toContain('loadAuthUserState');
        expect(authContextSource).toContain('activeAuthUserIdRef');
        expect(authContextSource).toContain('window.setTimeout(() =>');
        expect(authContextSource).toContain("signOut({ scope: 'local' })");
        expect(authContextSource).toContain('dispatchHomeAuthSessionUpdated');
        expect(authContextSource).toContain('import("@/integrations/supabase/client")');
        expect(authContextSource).not.toContain('const checkAdminRole');
        expect(authContextSource).not.toContain('const checkProfileStatus');
        expect(authContextSource).not.toContain('import { supabase }');
        expect(source('contexts/NotificationContext.tsx')).toContain("import('@/integrations/supabase/client')");
        expect(source('contexts/NotificationContext.tsx')).not.toContain('import { supabase }');
        expect(source('app/home-client-effects.tsx')).not.toContain('@/integrations/supabase/client');
        expect(source('app/home-client-effects.tsx')).toContain("import('./home-supabase-actions')");
        expect(source('app/home-supabase-actions.ts')).toContain('fetchSupabaseRows');
        expect(source('app/home-supabase-actions.ts')).not.toContain('@/integrations/supabase/client');
        expect(source('components/map/NaverMapView.tsx')).not.toContain('@/integrations/supabase/client');
        expect(source('components/map/NaverMapView.tsx')).toContain('NaverMapAnnouncementRuntime');
        expect(source('components/map/NaverMapAnnouncementRuntime.tsx')).toContain('useBannerAnnouncements(true)');
        expect(source('components/map/NaverMapView.tsx')).toContain('NaverMapPresenceRuntime');
        expect(source('components/map/NaverMapView.tsx')).toContain('HydratedDetailRestaurant');
        expect(source('components/map/NaverMapView.tsx')).not.toContain('useRestaurantWithMergeContext');
        expect(source('components/map/NaverMapView.tsx')).not.toContain("import('@/lib/naver-map-presence-client')");
        expect(source('components/map/NaverMapPresenceRuntime.tsx')).toContain("startNaverMapPresence");
        expect(source('components/admin/AdminConsoleOverview.tsx')).toContain('fetchSupabaseExactCount');
        expect(source('components/layout/Header.tsx')).not.toContain('fetchSupabaseExactCount');
        expect(source('components/home/MobileControlOverlay.tsx')).not.toContain('fetchSupabaseExactCount');
        const bottomSheetSource = source('components/ui/bottom-sheet.tsx');
        expect(bottomSheetSource).toContain('dragHeightRafRef');
        expect(bottomSheetSource).toContain('pendingDragHeightRef');
        expect(bottomSheetSource).toContain('scheduleDragHeightRender(nextHeightSafe);');
        expect(bottomSheetSource).toContain('cancelPendingDragHeightRender();');
        expect(bottomSheetSource).toContain('one pending RAF');
        expect(source('components/home/MobileControlOverlay.tsx')).not.toContain('dragTransformRafRef');
        expect(source('components/layout/Header.tsx')).not.toContain('import { supabase }');
        expect(source('components/layout/Header.tsx')).not.toContain('useBookmarks');
        expect(source('components/layout/Header.tsx')).not.toContain('import { RankingWidget }');
        expect(source('components/layout/Header.tsx')).toContain('useDeferredComponent<HeaderDeferredComponentProps>(shouldLoadAuthenticatedHeaderWidgets, loadRankingWidget)');
        expect(source('components/layout/Header.tsx')).toContain('useDeferredComponent<HeaderDeferredComponentProps>(shouldShowHeaderIcons, loadHeaderBookmarkMenuButton)');
        expect(source('components/layout/HeaderBookmarkMenuButton.tsx')).toContain('useBookmarks');
        expect(mainLayoutSource).toContain('if (!hasMounted)');
        expect(mainLayoutSource).toContain('{children}');
        expect(mainLayoutSource).not.toContain('min-h-screen bg-background" aria-hidden="true"');
        expect(mainLayoutSource).toContain('NONCRITICAL_CHROME_DELAY_MS = 30000');
        expect(mainLayoutSource).toContain('canMountNoncriticalChrome && !shouldSuppressNoncriticalChrome && <CombinedPopup />');
        expect(navigationPrefetcherSource).toContain('HOME_ROUTE_PREFETCH_DELAY_MS = 8000');
        expect(mobileBottomNavSource).toContain('HOME_NAV_PREFETCH_DELAY_MS = 8000');
        expect(viewportFixSource).toContain("if (window.CSS?.supports?.('height', '100dvh'))");
        expect(viewportFixSource).toContain('window.requestAnimationFrame(updateViewportHeight)');
        expect(nextConfigSource).toContain("source: '/favicon.ico'");
        expect(nextConfigSource).toContain("source: '/:icon(favicon-32x32|apple-touch-icon).png'");
        expect(nextConfigSource).toContain("source: '/scripts/:path*'");
        expect(source('tailwind.config.ts')).not.toContain('tailwindcss-animate');
        expect(source('app/globals.css')).not.toContain('@tailwind utilities');
        expect(source('app/globals.css')).toContain('Minimal home-first root CSS');
        expect(source('app/app-globals.css')).toContain('@tailwind utilities');
        expect(source('app/app-globals.css')).toContain('@keyframes tz-enter');
        expect(source('app/app-globals.css')).toContain('.slide-in-from-top-\\[48\\%\\]');
    });

});
