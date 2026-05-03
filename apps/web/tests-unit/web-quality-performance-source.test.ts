import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

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

    test('home map loads immediately while heavy supporting queries stay intent-gated', () => {
        const homeClientSource = source('app/home-client.tsx');
        const homeClientLoaderSource = source('app/home-client-loader.tsx');
        const restaurantSearchSource = source('components/search/RestaurantSearch.tsx');
        const mobileControlSource = source('components/home/MobileControlOverlay.tsx');
        const regionSelectorSource = source('components/region/RegionSelector.tsx');
        const categoryFilterSource = source('components/filters/CategoryFilter.tsx');
        const mapQuerySource = source('lib/map-query-helpers.ts');
        const naverMapSource = source('components/map/NaverMapView.tsx');

        expect(homeClientSource).toContain('<HomeMapContainer');
        expect(homeClientLoaderSource).toContain('return <HomeClient />');
        expect(homeClientSource).not.toContain('DeferredHomeMapPlaceholder');
        expect(homeClientSource).not.toContain('isMapActivated ? (');
        expect(homeClientLoaderSource).not.toContain('HomeMapIntentPlaceholder');
        expect(homeClientSource).not.toContain('home-map-activate-button');
        expect(restaurantSearchSource).toContain('enabled: isFocused || isInlineView');
        expect(mobileControlSource).toContain("enabled: activeSheet === 'region' || activeSheet === 'category'");
        expect(regionSelectorSource).toContain('enabled: isOpen');
        expect(categoryFilterSource).toContain('enabled: isOpen');
        expect(mapQuerySource).toContain('includeVerifiedReviewCounts: false');
        expect(naverMapSource).toContain('window.requestIdleCallback');
    });

    test('/mypage avoids client-side redirect work and defers desktop-only sidebar cost', () => {
        const myPageSource = source('app/mypage/page.tsx');
        const myPageLayoutSource = source('app/mypage/layout.tsx');
        const myPageSidebarSource = source('components/mypage/MyPageSidebar.tsx');

        expect(myPageSource).toContain('redirect("/mypage/submissions/new")');
        expect(myPageSource).not.toContain('"use client"');
        expect(myPageSource).not.toContain('useEffect');
        expect(myPageSource).not.toContain('useRouter');
        expect(myPageLayoutSource).toContain('dynamic(');
        expect(myPageLayoutSource).toContain('shouldRenderSidebar');
        expect(myPageLayoutSource).toContain('window.matchMedia("(min-width: 768px)")');
        expect(myPageSidebarSource).toContain("await import('@/lib/image-utils')");
        expect(myPageSidebarSource).not.toContain("import { compressImage } from '@/lib/image-utils'");
    });
});
