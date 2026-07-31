import { resolveAdBannerDestinationUrl, resolveAdBannerMediaUrl } from '@/lib/ad-banner-url';
import type { AdBanner } from '@/types/ad-banner';

export type PopupBannerCarouselSlide = {
    banner: AdBanner;
    key: string;
    sourceIndex: number;
    isClone: boolean;
};

export function hasPopupBannerPosterMedia(banner: AdBanner) {
    return Boolean(banner.video_url || banner.image_url);
}

export function filterPopupBannersWithPosterMedia(banners: AdBanner[]) {
    return banners.filter(hasPopupBannerPosterMedia);
}
export function resolvePopupBannerForDisplay(banner: AdBanner): AdBanner | null {
    const videoUrl = resolveAdBannerMediaUrl(banner.video_url);
    const imageUrl = resolveAdBannerMediaUrl(banner.image_url);

    if (!videoUrl && !imageUrl) return null;

    return {
        ...banner,
        video_url: videoUrl,
        image_url: imageUrl,
        link_url: resolveAdBannerDestinationUrl(banner.link_url),
    };
}

export function filterPopupBannersWithTrustedPosterMedia(banners: AdBanner[]) {
    return banners
        .map(resolvePopupBannerForDisplay)
        .filter((banner): banner is AdBanner => banner !== null);
}

export function getPopupBannerInitialTrackIndex(count: number) {
    return count > 1 ? 1 : 0;
}

export function buildPopupBannerLoopSlides(banners: AdBanner[]): PopupBannerCarouselSlide[] {
    if (banners.length <= 1) {
        return banners.map((banner, index) => ({
            banner,
            key: banner.id,
            sourceIndex: index,
            isClone: false,
        }));
    }

    const lastIndex = banners.length - 1;
    return [
        {
            banner: banners[lastIndex],
            key: `${banners[lastIndex].id}-clone-before`,
            sourceIndex: lastIndex,
            isClone: true,
        },
        ...banners.map((banner, index) => ({
            banner,
            key: banner.id,
            sourceIndex: index,
            isClone: false,
        })),
        {
            banner: banners[0],
            key: `${banners[0].id}-clone-after`,
            sourceIndex: 0,
            isClone: true,
        },
    ];
}

export function getPopupBannerLoopResetIndex(trackIndex: number, count: number) {
    if (count <= 1) return null;
    if (trackIndex === 0) return count;
    if (trackIndex === count + 1) return 1;
    return null;
}

export function getPopupBannerTrackIndexForSourceIndex(sourceIndex: number, count: number) {
    if (count <= 1) return 0;
    const normalizedSourceIndex = ((sourceIndex % count) + count) % count;
    return normalizedSourceIndex + 1;
}

export function getPopupBannerNavigationTarget(
    currentSourceIndex: number,
    count: number,
    direction: -1 | 1,
) {
    if (count <= 1) {
        return { sourceIndex: 0, trackIndex: 0 };
    }

    const normalizedCurrentIndex = ((currentSourceIndex % count) + count) % count;
    const sourceIndex = (normalizedCurrentIndex + direction + count) % count;

    if (direction === 1 && normalizedCurrentIndex === count - 1) {
        return { sourceIndex, trackIndex: count + 1 };
    }

    if (direction === -1 && normalizedCurrentIndex === 0) {
        return { sourceIndex, trackIndex: 0 };
    }

    return { sourceIndex, trackIndex: sourceIndex + 1 };
}
