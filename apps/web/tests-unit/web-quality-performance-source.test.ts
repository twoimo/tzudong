import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('web quality performance source contracts', () => {
    test('map marker HTML keeps the restored category image markers', () => {
        const clusterMarkerSource = source('lib/cluster-marker.ts');

        expect(clusterMarkerSource).toContain('CATEGORY_IMAGES');
        expect(clusterMarkerSource).toContain("'/images/maker-images/korean.png'");
        expect(clusterMarkerSource).toContain('src="${imagePath}"');
        expect(clusterMarkerSource).not.toContain('createCategoryMarkerGlyphHTML');
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
});
