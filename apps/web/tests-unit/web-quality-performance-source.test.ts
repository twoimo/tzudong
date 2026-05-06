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

    test('home map runtime renders directly while supporting queries stay intent-gated', () => {
        const pageSource = source('app/page.tsx');
        const homeClientSource = source('app/home-client.tsx');
        const homeRuntimeShellSource = source('app/home-runtime-shell.tsx');
        const restaurantSearchSource = source('components/search/RestaurantSearch.tsx');
        const mobileControlSource = source('components/home/MobileControlOverlay.tsx');
        const homeControlPanelSource = source('components/home/home-control-panel.tsx');
        const homeDesktopControlPanelSource = source('components/home/home-desktop-control-panel.tsx');
        const regionSelectorSource = source('components/region/RegionSelector.tsx');
        const categoryFilterSource = source('components/filters/CategoryFilter.tsx');
        const mapQuerySource = source('lib/map-query-helpers.ts');
        const naverMapSource = source('components/map/NaverMapView.tsx');

        expect(pageSource).toContain('<HomeRuntimeShell>');
        expect(pageSource).toContain('<HomeClient />');
        expect(pageSource).not.toContain('HomeLandingShell');
        expect(pageSource).not.toContain('HomeMapIsland');
        expect(pageSource).not.toContain('지도 준비하기');
        expect(homeClientSource).toContain('<HomeMapContainer');
        expect(homeRuntimeShellSource).toContain("import './home-app-globals.css'");
        expect(homeRuntimeShellSource).toContain('function MobileHomeLayout');
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).not.toContain('<MainLayout>{children}</MainLayout>');
        expect(homeClientSource).not.toContain('home-map-activate-button');
        expect(restaurantSearchSource).toContain('enabled: isFocused || isInlineView');
        expect(homeControlPanelSource).toContain('const loadHomeDesktopControlPanel = async () =>');
        expect(homeControlPanelSource).toContain("import('@/components/home/home-desktop-control-panel')");
        expect(homeControlPanelSource).toContain('shouldLoadDesktopPanel');
        expect(homeControlPanelSource).not.toContain('const HomeDesktopControlPanel = lazy(');
        expect(homeControlPanelSource).not.toContain('components/search/RestaurantSearch');
        expect(homeControlPanelSource).not.toContain('components/region/RegionSelector');
        expect(homeControlPanelSource).not.toContain('components/filters/CategoryFilter');
        expect(homeDesktopControlPanelSource).toContain('components/search/RestaurantSearch');
        expect(homeDesktopControlPanelSource).toContain('components/region/RegionSelector');
        expect(homeDesktopControlPanelSource).toContain('components/filters/CategoryFilter');
        expect(mobileControlSource).toContain("enabled: activeSheet === 'region' || activeSheet === 'category'");
        expect(regionSelectorSource).toContain('enabled: isOpen');
        expect(categoryFilterSource).toContain('enabled: isOpen');
        expect(mapQuerySource).toContain('includeVerifiedReviewCounts: false');
        expect(naverMapSource).toContain('autoLoad: false');
        expect(naverMapSource).toContain('useBannerAnnouncements } from "@/hooks/use-banner-announcements"');
        expect(naverMapSource).toContain("import('@/lib/naver-map-presence-client')");
        expect(naverMapSource).not.toContain('import { supabase } from "@/integrations/supabase/client"');
        expect(source('hooks/use-restaurants.tsx')).toContain('fetchSupabaseRows');
        expect(source('hooks/use-restaurants.tsx')).not.toContain('import { supabase } from "@/integrations/supabase/client"');
        expect(source('components/home/MobileControlOverlay.tsx')).toContain('fetchSupabaseRows');
        expect(source('components/home/MobileControlOverlay.tsx')).not.toContain("import { supabase } from '@/integrations/supabase/client'");
    });

    test('profile/stamp/map regressions stay fixed while preserving deferred map loading', () => {
        const overlayPanelSource = source('components/layout/OverlayPagePanel.tsx');
        const stampCardSource = source('components/stamp/StampCard.tsx');
        const userProfilePanelSource = source('components/profile/UserProfilePanel.tsx');
        const naverMapSource = source('components/map/NaverMapView.tsx');

        const userProfilePanelIndex = overlayPanelSource.indexOf('<UserProfilePanel');

        expect(userProfilePanelIndex).toBeGreaterThan(0);
        expect(overlayPanelSource.lastIndexOf('border-l border-border', userProfilePanelIndex)).toBeGreaterThan(0);
        expect(overlayPanelSource.lastIndexOf('"w-[400px]"', userProfilePanelIndex)).toBeGreaterThan(0);
        expect(stampCardSource).toContain('getRestaurantDisplayName(typedRestaurant)');
        expect(stampCardSource).toContain('alt={`${restaurantDisplayName} 썸네일`}');
        expect(stampCardSource).toContain('title={restaurantDisplayName}');
        expect(stampCardSource).toContain('absolute inset-0 z-10 flex items-center justify-center overflow-hidden');
        expect(stampCardSource).toContain('<img');
        expect(stampCardSource).toContain('src="/images/stamp-clear.png"');
        expect(userProfilePanelSource).toContain('const StampItem = memo(function StampItem');
        expect(userProfilePanelSource).toContain('const ReviewItem = memo(function ReviewItem');
        expect(userProfilePanelSource).toContain('<ScrollArea className="h-full">');
        expect(userProfilePanelSource).toContain('{onClose ? <X className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}');
        expect(userProfilePanelSource).not.toContain('className="flex-shrink-0 -mr-2 h-10 w-10"');
        expect(userProfilePanelSource).not.toContain('import { StampCard }');
        expect(userProfilePanelSource).not.toContain('import { ReviewCard }');
        expect(naverMapSource).toContain('resolveNaverRestaurantQueryBounds');
        expect(naverMapSource).toContain('shouldUseFullMapData: shouldRunNoncriticalMapEffects');
        expect(naverMapSource.match(/activateNoncriticalMapEffects\(\);/g)?.length).toBeGreaterThanOrEqual(3);
    });

    test('/mypage avoids client-side redirect work and defers desktop-only sidebar cost', () => {
        const myPageSource = source('app/mypage/page.tsx');
        const myPageLayoutSource = source('app/mypage/layout.tsx');
        const myPageLayoutContentSource = source('app/mypage/mypage-layout-content.tsx');
        const myPageSidebarSource = source('components/mypage/MyPageSidebar.tsx');

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
        expect(homeRuntimeShellSource).toContain('const OverlayLayout = lazy(');
        expect(homeRuntimeShellSource).not.toContain('<MainLayout>{children}</MainLayout>');
        expect(homeAppGlobalsSource).toContain('@config "../tailwind.home.config.ts"');
        expect(homeTailwindConfigSource).toContain('./components/home/**/*');
        expect(homeTailwindConfigSource).not.toContain('./components/admin/');
        expect(homeTailwindConfigSource).not.toContain('./components/restaurant/**/*');
        expect(source('tailwind.home.detail.config.ts')).toContain('./components/restaurant/**/*');
        expect(source('components/map/map-view-deferred-panels.tsx')).toContain("import '@/app/home-detail-globals.css'");
        expect(source('tailwind.home.deferred.config.ts')).toContain('./components/admin/AdminRestaurantModal.tsx');
        expect(source('app/home-client-sidepanels.tsx')).toContain("import './home-deferred-globals.css'");
        expect(source('app/page.tsx')).toContain('<HomeRuntimeShell>');
        expect(authContextSource).toContain('HOME_AUTH_BOOTSTRAP_DELAY_MS = 30000');
        expect(source('components/map/NaverMapView.tsx')).toContain('NONCRITICAL_MAP_SIDE_EFFECT_DELAY_MS = 30000');
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
        expect(source('components/map/NaverMapView.tsx')).toContain("import('@/lib/naver-map-presence-client')");
        expect(source('components/layout/Header.tsx')).toContain('fetchSupabaseExactCount');
        expect(source('components/layout/Header.tsx')).not.toContain('import { supabase }');
        expect(source('components/layout/Header.tsx')).not.toContain('useBookmarks');
        expect(source('components/layout/HeaderBookmarkMenuButton.tsx')).toContain('useBookmarks');
        expect(mainLayoutSource).toContain('if (!hasMounted)');
        expect(mainLayoutSource).toContain('{children}');
        expect(mainLayoutSource).not.toContain('min-h-screen bg-background" aria-hidden="true"');
        expect(mainLayoutSource).toContain('NONCRITICAL_CHROME_DELAY_MS = 30000');
        expect(mainLayoutSource).toContain('canMountNoncriticalChrome && <CombinedPopup />');
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
