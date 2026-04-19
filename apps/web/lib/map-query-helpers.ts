import type { FilterState } from '@/components/filters/filter-state';
import type { Region } from '@/types/restaurant';

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
        region: selectedCountry as Region | undefined,
        enabled: !!selectedCountry,
        refreshTrigger,
    };
}

export function buildNaverRestaurantsQueryOptions({
    filters,
    isLoaded,
    selectedRegion,
}: {
    filters: FilterState;
    isLoaded: boolean;
    selectedRegion: Region | null;
}) {
    return {
        category: filters.categories.length > 0 ? filters.categories : undefined,
        region: selectedRegion || undefined,
        minReviews: filters.minReviews,
        enabled: isLoaded,
    };
}
