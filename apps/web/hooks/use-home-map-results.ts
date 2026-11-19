import { useEffect, useMemo } from 'react';
import { markInitialLoadMilestone } from '@/lib/performance/initial-load-milestones';
import type { FilterState } from '@/components/filters/filter-state';
import type { Region } from '@/types/restaurant';
import { useRestaurants } from '@/hooks/use-restaurants';
import { buildNaverRestaurantsQueryOptions, buildOverseasRestaurantsQueryOptions } from '@/lib/map-query-helpers';
import { buildHomeMapResultSummary } from '@/lib/home-map-result-summary';

/** Shared by home chrome and map renderers; no viewport or partial-page membership. */
export function useHomeMapResults({ mapMode, filters, selectedRegion, selectedCountry, showUserSubmittedMarkers = true }: {
    mapMode: 'domestic' | 'overseas';
    filters: FilterState;
    selectedRegion: Region | null;
    selectedCountry: string | null;
    showUserSubmittedMarkers?: boolean;
}) {
    const options = mapMode === 'domestic'
        ? buildNaverRestaurantsQueryOptions({ compact: true, filters, selectedRegion })
        : buildOverseasRestaurantsQueryOptions({ filters, selectedCountry, refreshTrigger: 0 });
    const query = useRestaurants({ ...options, requireComplete: true, homeMapMode: mapMode, showUserSubmittedMarkers });
    useEffect(() => {
        if (mapMode === 'domestic' && query.isError) markInitialLoadMilestone('dataError');
    }, [mapMode, query.isError]);
    // Shared provider placeholders belong to the previous filter, not this result set.
    const isPending = query.isPending || query.isPlaceholderData;
    const summary = useMemo(() => buildHomeMapResultSummary({
        data: query.data, isPending, isError: query.isError,
        mapMode, selectedCountry, filters, showUserSubmittedMarkers,
    }), [query.data, isPending, query.isError, mapMode, selectedCountry, filters, showUserSubmittedMarkers]);
    return {
        ...query, isPending, isLoading: isPending && query.isFetching,
        isSuccess: query.isSuccess && !isPending, status: isPending ? 'pending' as const : query.status,
        data: summary.status === 'ready' ? summary.restaurants : undefined, summary,
    };
}
