import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { StampCard, type StampCardProps } from '../components/stamp/StampCard';
import type { Restaurant } from '../types/restaurant';

const noop = () => {};
const router: AppRouterInstance = {
    back: noop, forward: noop, refresh: noop, push: noop, replace: noop,
    prefetch: noop, bfcacheId: 'thumbnail-priority-unit-test',
};
const restaurant = {
    id: 'synthetic-restaurant', name: '합성 식당', approved_name: '합성 식당',
    youtube_link: 'https://www.youtube.com/watch?v=abc123DEF45',
    categories: ['한식'], review_count: 0,
} as Restaurant;

// Exercise the real StampCard → YoutubeThumbnail → Next Image render path.
// SSR does not run effects, so this sends no image/probe or data requests.
function render(changes: Partial<StampCardProps> = {}) {
    return renderToStaticMarkup(
        <ImageConfigContext.Provider value={{ ...imageConfigDefault,
            remotePatterns: [{ protocol: 'https', hostname: 'img.youtube.com' }], qualities: [85],
        }}>
            <AppRouterContext.Provider value={router}>
                <StampCard restaurant={restaurant} isVisited={false} isUserStampsReady={false}
                    currentThumbnailIndex={0} onThumbnailChange={noop} onClick={noop} {...changes} />
            </AppRouterContext.Provider>
        </ImageConfigContext.Provider>,
    );
}

describe('stamp card thumbnail loading priority', () => {
    test('ordinary card and list callers keep lazy image loading without a preload', () => {
        for (const layout of ['card', 'list'] as const) {
            const html = render({ layout });
            expect(html).toContain('data-youtube-thumbnail-quality=');
            expect(html).toContain('loading="lazy"');
            expect(html).not.toContain('rel="preload"');
        }
    });

    test('an opted-in card exposes the actual image preload and removes lazy loading', () => {
        const html = render({ thumbnailPriority: true });
        expect(html).toContain('data-youtube-thumbnail-quality="maxresdefault"');
        expect(html).toContain('rel="preload"');
        expect(html).toContain('as="image"');
        expect(html).not.toContain('loading="lazy"');
    });

    test('an opted-in restaurant without a video keeps its non-image fallback', () => {
        const html = render({ thumbnailPriority: true, restaurant: { ...restaurant, youtube_link: null } });
        expect(html).toContain('맛집 상세 열기');
        expect(html).not.toContain('data-youtube-thumbnail-quality=');
        expect(html).not.toContain('rel="preload"');
    });
});
