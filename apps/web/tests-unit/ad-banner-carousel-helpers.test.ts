import { describe, expect, test } from 'bun:test';

import {
    buildPopupBannerLoopSlides,
    filterPopupBannersWithPosterMedia,
    getPopupBannerInitialTrackIndex,
    getPopupBannerLoopResetIndex,
} from '../lib/ad-banner-carousel-helpers';
import type { AdBanner } from '../types/ad-banner';

const makeBanner = (overrides: Partial<AdBanner>): AdBanner => ({
    id: overrides.id ?? 'banner-1',
    title: overrides.title ?? '테스트 배너',
    description: overrides.description ?? null,
    image_url: overrides.image_url ?? null,
    video_url: overrides.video_url ?? null,
    media_type: overrides.media_type ?? 'none',
    link_url: overrides.link_url ?? null,
    is_active: overrides.is_active ?? true,
    priority: overrides.priority ?? 1,
    display_target: overrides.display_target ?? ['mobile_popup'],
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
    created_by: overrides.created_by ?? null,
});

describe('ad banner carousel helpers', () => {
    test('keeps only popup banners with poster media', () => {
        const result = filterPopupBannersWithPosterMedia([
            makeBanner({ id: 'image', image_url: '/poster.png', media_type: 'image' }),
            makeBanner({ id: 'video', video_url: '/poster.mp4', media_type: 'video' }),
            makeBanner({ id: 'text-only', title: '텍스트 배너', media_type: 'none' }),
        ]);

        expect(result.map((banner) => banner.id)).toEqual(['image', 'video']);
    });

    test('adds edge clones for a seamless infinite loop', () => {
        const slides = buildPopupBannerLoopSlides([
            makeBanner({ id: 'first', image_url: '/first.png', media_type: 'image' }),
            makeBanner({ id: 'second', image_url: '/second.png', media_type: 'image' }),
            makeBanner({ id: 'third', image_url: '/third.png', media_type: 'image' }),
        ]);

        expect(slides.map((slide) => slide.banner.id)).toEqual([
            'third',
            'first',
            'second',
            'third',
            'first',
        ]);
        expect(slides[0]).toMatchObject({ sourceIndex: 2, isClone: true });
        expect(slides[4]).toMatchObject({ sourceIndex: 0, isClone: true });
    });

    test('does not clone single-banner carousels', () => {
        const slides = buildPopupBannerLoopSlides([
            makeBanner({ id: 'only', image_url: '/only.png', media_type: 'image' }),
        ]);

        expect(slides).toHaveLength(1);
        expect(slides[0]).toMatchObject({ key: 'only', sourceIndex: 0, isClone: false });
        expect(getPopupBannerInitialTrackIndex(1)).toBe(0);
        expect(getPopupBannerInitialTrackIndex(3)).toBe(1);
    });

    test('resolves invisible loop reset points after clone transitions', () => {
        expect(getPopupBannerLoopResetIndex(4, 3)).toBe(1);
        expect(getPopupBannerLoopResetIndex(0, 3)).toBe(3);
        expect(getPopupBannerLoopResetIndex(2, 3)).toBeNull();
        expect(getPopupBannerLoopResetIndex(0, 1)).toBeNull();
    });
});
