import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { AdBanner } from '../types/ad-banner';

const SUPABASE_ORIGIN = 'https://project-ref.supabase.co';
const MEDIA_PREFIX = `${SUPABASE_ORIGIN}/storage/v1/object/public/ad-banner-images/`;
const VALID_MEDIA_URL = `${MEDIA_PREFIX}campaigns/summer-banner.webp`;
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

mock.module('@/integrations/supabase/client', () => ({
    supabase: {
        storage: {
            from: (bucket: string) => ({
                getPublicUrl: (path: string) => ({
                    data: {
                        publicUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/${bucket}/${path}`,
                    },
                }),
            }),
        },
    },
}));

const {
    resolveAdBannerDestinationUrl,
    resolveAdBannerMediaUrl,
    resolveAdBannerPersistenceUrls,
} = await import('../lib/ad-banner-url.ts?security-contract');
const { filterPopupBannersWithTrustedPosterMedia } = await import(
    '../lib/ad-banner-carousel-helpers.ts?security-contract'
);

const makeBanner = (overrides: Partial<AdBanner>): AdBanner => ({
    id: overrides.id ?? 'banner-1',
    title: overrides.title ?? '테스트 배너',
    description: overrides.description ?? null,
    image_url: overrides.image_url ?? null,
    video_url: overrides.video_url ?? null,
    media_type: overrides.media_type ?? 'image',
    link_url: overrides.link_url ?? null,
    is_active: overrides.is_active ?? true,
    priority: overrides.priority ?? 1,
    display_target: overrides.display_target ?? ['mobile_popup'],
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
    created_by: overrides.created_by ?? null,
});

beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
});

afterAll(() => {
    if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
    mock.restore();
});

describe('ad banner URL trust boundary', () => {
    test('resolves only canonical application paths and YouTube destinations', () => {
        expect(resolveAdBannerDestinationUrl('/restaurants')).toBe('/restaurants');
        expect(resolveAdBannerDestinationUrl('/?restaurant=550e8400-e29b-41d4-a716-446655440000')).toBe(
            '/?restaurant=550e8400-e29b-41d4-a716-446655440000',
        );
        expect(resolveAdBannerDestinationUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        );
        expect(resolveAdBannerDestinationUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        );

        for (const value of [
            'https://sponsor.example/promotion',
            'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'javascript:alert(1)',
            'data:text/html,phishing',
            '//evil.example/promotion',
            '/offers/../admin',
            '/offers/%2e%2e/admin',
            '/offers\\admin',
            '/offers#fragment',
            '/offers?redirect=https://evil.example',
            'https://user:password@www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://www.youtube.com:443/watch?v=dQw4w9WgXcQ',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ%26next%3Devil',
        ]) {
            expect(resolveAdBannerDestinationUrl(value)).toBeNull();
        }
    });

    test('accepts only the configured Supabase public-object URL for banner media', () => {
        expect(resolveAdBannerMediaUrl(VALID_MEDIA_URL)).toBe(VALID_MEDIA_URL);

        for (const value of [
            `http://project-ref.supabase.co/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp`,
            'https://evil.example/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp',
            'https://project-ref.supabase.co.evil.example/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp',
            'https://user:password@project-ref.supabase.co/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp',
            'https://project-ref.supabase.co:443/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp',
            `${SUPABASE_ORIGIN}/storage/v1/object/public/other-bucket/campaigns/summer-banner.webp`,
            `${VALID_MEDIA_URL}?download=1`,
            `${VALID_MEDIA_URL}#fragment`,
            `${MEDIA_PREFIX}campaigns/../private-banner.webp`,
            `${MEDIA_PREFIX}campaigns/%2e%2e/private-banner.webp`,
            `${MEDIA_PREFIX}campaigns\\summer-banner.webp`,
            `${MEDIA_PREFIX}campaigns/summer-banner.webp\n`,
            '//project-ref.supabase.co/storage/v1/object/public/ad-banner-images/campaigns/summer-banner.webp',
            'data:image/webp;base64,AAAA',
        ]) {
            expect(resolveAdBannerMediaUrl(value)).toBeNull();
        }
    });
    test('validates complete persisted media, media type, and destination tuples', () => {
        expect(resolveAdBannerPersistenceUrls({
            image_url: VALID_MEDIA_URL,
            video_url: null,
            media_type: 'image',
            link_url: '/restaurants',
        })).toEqual({
            image_url: VALID_MEDIA_URL,
            video_url: null,
            media_type: 'image',
            link_url: '/restaurants',
        });
        expect(resolveAdBannerPersistenceUrls({
            image_url: null,
            video_url: VALID_MEDIA_URL,
            media_type: 'video',
            link_url: 'https://youtu.be/dQw4w9WgXcQ',
        })).toEqual({
            image_url: null,
            video_url: VALID_MEDIA_URL,
            media_type: 'video',
            link_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        });

        for (const banner of [
            {
                image_url: 'https://legacy.example/banner.webp',
                video_url: null,
                media_type: 'image',
                link_url: '/restaurants',
            },
            {
                image_url: VALID_MEDIA_URL,
                video_url: null,
                media_type: 'image',
                link_url: 'https://sponsor.example/promotion',
            },
            {
                image_url: 'blob:https://tzudong.invalid/local-preview',
                video_url: null,
                media_type: 'image',
                link_url: '/restaurants',
            },
            {
                image_url: VALID_MEDIA_URL,
                video_url: null,
                media_type: 'video',
                link_url: '/restaurants',
            },
        ]) {
            expect(resolveAdBannerPersistenceUrls(banner)).toBeNull();
        }
    });

    test('resolves admin previews and validates writes before Supabase mutations', () => {
        const adminPage = readFileSync(
            new URL('../app/admin/banners/page.tsx', import.meta.url),
            'utf8',
        );
        const hooks = readFileSync(
            new URL('../hooks/use-ad-banners.tsx', import.meta.url),
            'utf8',
        );

        expect(adminPage).toContain('const resolvedUrls = resolveAdBannerPersistenceUrls(banner);');
        expect(adminPage).toContain('setImagePreview(resolvedUrls?.image_url ?? null);');
        expect(adminPage).toContain('setVideoPreview(resolvedUrls?.video_url ?? null);');
        expect(adminPage).toContain('<Image src={resolvedUrls.image_url}');
        expect(adminPage.indexOf('resolveAdBannerDestinationUrl(formData.link_url)')).toBeLessThan(
            adminPage.indexOf('uploadImage.mutateAsync'),
        );

        expect(hooks.indexOf('const resolvedUrls = resolvePersistedBannerUrls(data);')).toBeLessThan(
            hooks.indexOf('.insert({'),
        );
        expect(hooks).toContain('const persistedUrls = await getPersistedBannerUrls(id);');
        expect(hooks).toContain('resolvePersistedBannerUrls(persistedUrls);');
        expect(hooks).toContain('const publicUrl = resolveAdBannerMediaUrl(publicUrlData.publicUrl);');
    });

    test('drops untrusted media and removes invalid destinations before the popup renders', () => {
        const result = filterPopupBannersWithTrustedPosterMedia([
            makeBanner({
                id: 'internal',
                image_url: VALID_MEDIA_URL,
                link_url: '/restaurants',
            }),
            makeBanner({
                id: 'youtube',
                video_url: VALID_MEDIA_URL,
                link_url: 'https://youtu.be/dQw4w9WgXcQ',
            }),
            makeBanner({
                id: 'invalid-destination',
                image_url: VALID_MEDIA_URL,
                link_url: 'https://sponsor.example/promotion',
            }),
            makeBanner({
                id: 'invalid-media',
                image_url: 'https://evil.example/banner.webp',
                link_url: '/restaurants',
            }),
            makeBanner({
                id: 'image-fallback',
                video_url: 'https://evil.example/banner.mp4',
                image_url: VALID_MEDIA_URL,
                link_url: '/restaurants',
            }),
        ]);

        expect(result.map((banner) => banner.id)).toEqual([
            'internal',
            'youtube',
            'invalid-destination',
            'image-fallback',
        ]);
        expect(result.find((banner) => banner.id === 'youtube')?.link_url).toBe(
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        );
        expect(result.find((banner) => banner.id === 'invalid-destination')?.link_url).toBeNull();
        expect(result.find((banner) => banner.id === 'image-fallback')).toMatchObject({
            video_url: null,
            image_url: VALID_MEDIA_URL,
        });
    });

    test('keeps invalid destinations out of clickable and focusable popup elements', () => {
        const source = readFileSync(
            new URL('../components/layout/CombinedPopup.tsx', import.meta.url),
            'utf8',
        );

        expect(source).toContain('filterPopupBannersWithTrustedPosterMedia(banners)');
        expect(source).toContain('onClick={isActionable ? onClick : undefined}');
        expect(source).toContain('tabIndex={isActionable ? 0 : undefined}');
        expect(source).toContain('role={currentBannerDestination ? "button" : "region"}');
        expect(source).toContain('tabIndex={currentBannerDestination ? 0 : undefined}');
    });
});
