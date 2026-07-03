import type { FilterState } from '@/components/filters/filter-state';
import type { Region } from '@/types/restaurant';

type RestaurantQueryBounds = {
    south: number;
    west: number;
    north: number;
    east: number;
};

export function buildMapViewRestaurantsQueryOptions({
    bounds,
    filters,
    isLoaded,
    selectedCountry,
}: {
    bounds:
        | {
              south: number;
              west: number;
              north: number;
              east: number;
          }
        | undefined;
    filters: FilterState;
    isLoaded: boolean;
    selectedCountry: string | null | undefined;
}) {
    return {
        bounds,
        category: filters.categories.length > 0 ? filters.categories : undefined,
        region: selectedCountry as Region | undefined,
        minReviews: filters.minReviews,
        featuredTheme: filters.featuredTheme ?? null,
        includeVerifiedReviewCounts: false,
        enabled: isLoaded && !!selectedCountry,
    };
}

export function buildOverseasRestaurantsQueryOptions({
    filters,
    refreshTrigger,
    selectedCountry,
}: {
    filters: FilterState;
    refreshTrigger: number;
    selectedCountry: string | null;
}) {
    return {
        category: filters.categories.length > 0 ? filters.categories : undefined,
        minReviews: filters.minReviews,
        featuredTheme: filters.featuredTheme ?? null,
        region: selectedCountry as Region | undefined,
        includeVerifiedReviewCounts: false,
        enabled: !!selectedCountry,
        refreshTrigger,
    };
}

export function buildNaverRestaurantsQueryOptions({
    bounds,
    compact = false,
    filters,
    isLoaded,
    selectedRegion,
}: {
    bounds?: {
        south: number;
        west: number;
        north: number;
        east: number;
    };
    compact?: boolean;
    filters: FilterState;
    isLoaded: boolean;
    selectedRegion: Region | null;
}) {
    return {
        bounds,
        category: filters.categories.length > 0 ? filters.categories : undefined,
        compact,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        featuredTheme: filters.featuredTheme ?? null,
        includeVerifiedReviewCounts: false,
        enabled: isLoaded,
    };
}

export function resolveNaverRestaurantQueryBounds({
    firstLoadViewportBounds,
    shouldUseFullMapData,
}: {
    firstLoadViewportBounds?: RestaurantQueryBounds;
    shouldUseFullMapData: boolean;
}): RestaurantQueryBounds | undefined {
    return shouldUseFullMapData ? undefined : firstLoadViewportBounds;
}
