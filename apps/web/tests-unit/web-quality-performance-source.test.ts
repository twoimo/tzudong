import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('web quality performance source contracts', () => {
    test('map marker HTML avoids loading oversized maker-image PNGs in the initial viewport', () => {
        const clusterMarkerSource = source('lib/cluster-marker.ts');

        expect(clusterMarkerSource).toContain('CATEGORY_MARKER_VISUALS');
        expect(clusterMarkerSource).toContain('createCategoryMarkerGlyphHTML');
        expect(clusterMarkerSource).not.toContain("'/images/maker-images/korean.png'");
        expect(clusterMarkerSource).not.toContain('src="${imagePath}"');
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
