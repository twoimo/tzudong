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
