import type { FilterState } from '@/components/filters/filter-state';
import { REGIONS, type Restaurant } from '@/types/restaurant';
import { filterHomeMapRestaurantsByMode, getOverseasCountryKeywords, type HomeMapMode } from '@/lib/home-map-mode-filter';
import { OVERSEAS_REGION_LIST } from '@/constants/overseas-regions';
import type { HomeMapContextualRestaurantsPayload } from '@/lib/home-map-contextual-restaurants';
import { hasRenderableOverseasCoordinates } from '@/lib/overseas-map-marker-helpers';
import { isUserSubmittedRestaurant } from '@/lib/restaurant-marker-kind';

export type HomeMapResultSummary = {
    active: boolean;
    status: 'pending' | 'error' | 'ready' | 'select-country';
    restaurants: Restaurant[];
    count: number | null;
    regionCounts: Record<string, number>;
    countryCounts: Record<string, number>;
    categoryCounts: Record<string, number>;
};

export function hasActiveHomeMapResultFilters(filters: FilterState) {
    // Only conditions actually consumed by the map query count as active.
    return Boolean(filters.featuredTheme || filters.categories.length || filters.minReviews > 0);
}

/** Choose the visible cohort before calculating a relative theme threshold. */
export function selectHomeMapResultCandidates(
    data: Restaurant[], mapMode: HomeMapMode, selectedCountry: string | null,
    showUserSubmittedMarkers = true,
) {
    return filterHomeMapRestaurantsByMode(data, mapMode,
        mapMode === 'overseas' ? getOverseasCountryKeywords(selectedCountry) : null)
        .filter((restaurant) => hasRenderableOverseasCoordinates(restaurant)
            && (mapMode === 'overseas' || showUserSubmittedMarkers || !isUserSubmittedRestaurant(restaurant)));
}

/** A complete, current query result. Never pass a popularity/latest page here. */
export function buildHomeMapResultSummary({
    data, isPending, isError, mapMode, selectedCountry, filters, showUserSubmittedMarkers = true,
}: {
    data?: Restaurant[];
    isPending: boolean;
    isError: boolean;
    mapMode: HomeMapMode;
    selectedCountry: string | null;
    filters: FilterState;
    showUserSubmittedMarkers?: boolean;
}): HomeMapResultSummary {
    const status = mapMode === 'overseas' && !selectedCountry ? 'select-country'
        : isError ? 'error' : isPending || !data ? 'pending' : 'ready';
    const restaurants = status === 'ready'
        ? selectHomeMapResultCandidates(data!, mapMode, selectedCountry, showUserSubmittedMarkers)
        : [];
    const regionCounts: Record<string, number> = {};
    const countryCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    for (const restaurant of restaurants) {
        const address = [restaurant.road_address, restaurant.jibun_address].filter(Boolean).join(' ');
        const region = address.includes('울릉') ? '울릉도' : address.includes('욕지') ? '욕지도'
            : REGIONS.find((candidate) => address.includes(candidate));
        if (region) regionCounts[region] = (regionCounts[region] ?? 0) + 1;
        const countryAddress = [restaurant.road_address, restaurant.jibun_address, restaurant.english_address].filter(Boolean).join(' ').toLowerCase();
        for (const country of OVERSEAS_REGION_LIST) {
            if (getOverseasCountryKeywords(country)?.some((keyword) => countryAddress.includes(keyword))) {
                countryCounts[country] = (countryCounts[country] ?? 0) + 1;
            }
        }
        for (const category of new Set(restaurant.categories ?? [])) {
            categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
        }
    }
    return { active: hasActiveHomeMapResultFilters(filters), status, restaurants,
        count: status === 'ready' ? restaurants.length : null, regionCounts, countryCounts, categoryCounts };
}

export function homeMapResultStatusText(summary: HomeMapResultSummary): string {
    if (summary.status === 'pending') return '맛집 결과를 불러오는 중입니다';
    if (summary.status === 'error') return '맛집 결과를 불러오지 못했습니다';
    if (summary.status === 'select-country') return '국가를 선택해 주세요';
    return summary.count === 0 ? '선택한 조건에 맞는 맛집이 없습니다' : `현재 지도 결과 ${summary.count}곳`;
}

export function homeMapResultCountLabel(summary: HomeMapResultSummary, count: number | undefined) {
    return summary.status === 'ready' ? `${count ?? 0}` : summary.status === 'error' ? '확인 불가' : '—';
}

/** A viewport receipt from an old filter/mode may arrive later than its query. */
export function reconcileHomeMapContextualResults(
    summary: HomeMapResultSummary,
    payload: HomeMapContextualRestaurantsPayload | null | undefined,
    mode: HomeMapMode,
): HomeMapContextualRestaurantsPayload | null {
    if (summary.status !== 'ready' || !payload?.isEligible || payload.mode !== mode) return null;
    const current = new Map(summary.restaurants.map((restaurant) => [restaurant.id, restaurant]));
    if (payload.restaurants.some((restaurant) => !current.has(restaurant.id))) return null;
    return { ...payload, restaurants: payload.restaurants.map((restaurant) => current.get(restaurant.id)!),
        totalVisibleCount: Math.min(payload.totalVisibleCount, summary.count ?? 0) };
}
