import type { HomeMapResultSummary } from '@/lib/home-map-result-summary';

type RegionCountScope = {
    mapMode: 'domestic' | 'overseas';
    selectedRegion: string | null;
    selectedCountry: string | null;
};

/** Facets describe the current query only; an unqueried region is not a known zero. */
export function getHomeMapRegionOptionCount(
    summary: HomeMapResultSummary,
    { mapMode, selectedRegion, selectedCountry }: RegionCountScope,
    option: string,
): number | undefined {
    if (summary.status !== 'ready') return undefined;

    if (mapMode === 'domestic') {
        if (selectedRegion && option !== selectedRegion) return undefined;
        if (option === 'all') return summary.count ?? undefined;
        return summary.regionCounts[option] ?? 0;
    }

    if (!selectedCountry || option !== selectedCountry) return undefined;
    return summary.countryCounts[option] ?? 0;
}
