import type { Restaurant } from '@/types/restaurant';

export const MAP_VIEW_DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795, zoom: 4 };

export const MAP_VIEW_COUNTRY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
    미국: { lat: 39.8283, lng: -98.5795, zoom: 5 },
    일본: { lat: 35.1815, lng: 136.9066, zoom: 10 },
    대만: { lat: 25.0330, lng: 121.5654, zoom: 10 },
    태국: { lat: 13.7563, lng: 100.5018, zoom: 11 },
    인도네시아: { lat: -6.9667, lng: 110.4167, zoom: 7 },
    튀르키예: { lat: 41.0082, lng: 28.9784, zoom: 11 },
    헝가리: { lat: 47.4979, lng: 19.0402, zoom: 11 },
    오스트레일리아: { lat: -33.8688, lng: 151.2093, zoom: 10 },
};

export function getMapViewCountryConfig(selectedCountry: string | null | undefined) {
    if (!selectedCountry) {
        return MAP_VIEW_DEFAULT_CENTER;
    }

    return MAP_VIEW_COUNTRY_CENTERS[selectedCountry] ?? MAP_VIEW_DEFAULT_CENTER;
}

export function mergeSearchedRestaurant(restaurants: Restaurant[], searchedRestaurant: Restaurant | null) {
    if (!searchedRestaurant) return restaurants;

    const alreadyExists = searchedRestaurant.mergedRestaurants?.length
        ? restaurants.some((restaurant) =>
            searchedRestaurant.mergedRestaurants?.some((merged) => merged.id === restaurant.id)
        )
        : restaurants.some((restaurant) => restaurant.id === searchedRestaurant.id);

    return alreadyExists ? restaurants : [...restaurants, searchedRestaurant];
}

export function getMapViewMarkerIcon(categories: string | string[] | null | undefined) {
    if (!categories) return '/images/maker-images/korean.png';

    const category = Array.isArray(categories) ? categories[0] : categories;
    const imageMap: Record<string, string> = {
        고기: '/images/maker-images/meat_bbq.png',
        치킨: '/images/maker-images/chicken.png',
        한식: '/images/maker-images/korean.png',
        중식: '/images/maker-images/chinese.png',
        일식: '/images/maker-images/cutlet_sashimi.png',
        양식: '/images/maker-images/western.png',
        분식: '/images/maker-images/snack_bar.png',
        '카페·디저트': '/images/maker-images/cafe_dessert.png',
        아시안: '/images/maker-images/asian.png',
        패스트푸드: '/images/maker-images/fastfood.png',
        '족발·보쌈': '/images/maker-images/pork_feet.png',
        '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
        피자: '/images/maker-images/pizza.png',
        '찜·탕': '/images/maker-images/stew.png',
        야식: '/images/maker-images/late_night.png',
        도시락: '/images/maker-images/lunch_box.png',
    };

    return imageMap[category] || '/images/maker-images/korean.png';
}

export function getAdjustedSelectedRestaurantLng({
    boundsNorthEastLng,
    boundsSouthWestLng,
    lng,
    mapWidth,
    panelWidth,
    sidebarWidth = 0,
}: {
    boundsNorthEastLng: number;
    boundsSouthWestLng: number;
    lng: number;
    mapWidth: number;
    panelWidth: number;
    sidebarWidth?: number;
}) {
    const lngSpan = boundsNorthEastLng - boundsSouthWestLng;
    const rightPanelLngSpan = lngSpan * (panelWidth / mapWidth);
    const leftSidebarLngSpan = lngSpan * (sidebarWidth / mapWidth);
    const offset = (rightPanelLngSpan / 2) - (leftSidebarLngSpan / 2);
    return lng + offset;
}
