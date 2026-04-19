import type { Restaurant } from '@/types/restaurant';

export const CATEGORY_ICON_MAP: Record<string, string> = {
    '고기': '/images/maker-images/meat_bbq.png',
    '치킨': '/images/maker-images/chicken.png',
    '한식': '/images/maker-images/korean.png',
    '중식': '/images/maker-images/chinese.png',
    '일식': '/images/maker-images/cutlet_sashimi.png',
    '양식': '/images/maker-images/western.png',
    '분식': '/images/maker-images/snack_bar.png',
    '카페·디저트': '/images/maker-images/cafe_dessert.png',
    '아시안': '/images/maker-images/asian.png',
    '패스트푸드': '/images/maker-images/fastfood.png',
    '족발·보쌈': '/images/maker-images/pork_feet.png',
    '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
    '피자': '/images/maker-images/pizza.png',
    '찜·탕': '/images/maker-images/stew.png',
    '야식': '/images/maker-images/late_night.png',
    '도시락': '/images/maker-images/lunch_box.png',
};

export const DEFAULT_OVERSEAS_ICON = '/images/maker-images/asian.png';
export const DEFAULT_OVERSEAS_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
export const MIN_OVERSEAS_ZOOM = 2;
export const MAX_OVERSEAS_ZOOM = 22;

export const COUNTRY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
    미국: { lat: 39.8283, lng: -98.5795, zoom: 5 },
    일본: { lat: 35.1815, lng: 136.9066, zoom: 10 },
    대만: { lat: 25.0330, lng: 121.5654, zoom: 10 },
    태국: { lat: 13.7563, lng: 100.5018, zoom: 11 },
    인도네시아: { lat: -6.9667, lng: 110.4167, zoom: 7 },
    튀르키예: { lat: 41.0082, lng: 28.9784, zoom: 11 },
    헝가리: { lat: 47.4979, lng: 19.0402, zoom: 11 },
    오스트레일리아: { lat: -33.8688, lng: 151.2093, zoom: 10 },
};

export const DEFAULT_OVERSEAS_CENTER = { lat: 20, lng: 0, zoom: 2 };

export const mapZoomToSlider = (zoom: number) =>
    Math.round(((zoom - MIN_OVERSEAS_ZOOM) / (MAX_OVERSEAS_ZOOM - MIN_OVERSEAS_ZOOM)) * 100);

export const sliderToMapZoom = (value: number) =>
    MIN_OVERSEAS_ZOOM + (value / 100) * (MAX_OVERSEAS_ZOOM - MIN_OVERSEAS_ZOOM);

export function getOverseasInitialConfig(selectedCountry: string | null | undefined) {
    return selectedCountry
        ? OVERSEAS_REGIONS[selectedCountry]?.center ?? DEFAULT_OVERSEAS_CENTER
        : DEFAULT_OVERSEAS_CENTER;
}

export function getNextOverseasWheelSlider({
    currentMapZoom,
    deltaY,
    previousTargetSlider,
    timeDiffMs,
}: {
    currentMapZoom: number;
    deltaY: number;
    previousTargetSlider: number;
    timeDiffMs: number;
}) {
    const currentSlider = mapZoomToSlider(currentMapZoom);
    const baseSlider = timeDiffMs < 400 && Math.abs(previousTargetSlider - currentSlider) < 5
        ? previousTargetSlider
        : currentSlider;

    return deltaY > 0
        ? Math.max(baseSlider - 1, 0)
        : Math.min(baseSlider + 1, 100);
}

export function getRestaurantCategoryIcon(restaurant: Pick<Restaurant, 'categories'>) {
    const categories = restaurant.categories;
    const category = Array.isArray(categories) ? categories[0] : categories;
    return CATEGORY_ICON_MAP[category ?? ''] || DEFAULT_OVERSEAS_ICON;
}
import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
