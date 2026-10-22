import { useQuery } from "@tanstack/react-query";

import type { Tables } from "@/integrations/supabase/types";
import type { Restaurant } from "@/types/restaurant";
import { publicReviewedVideoFrames } from "@/components/restaurant/RestaurantEvidenceCarousel";
import { hydrateRestaurantDetailWithMergeContext } from "@/lib/restaurant-merged-media";
import { postgrestIn } from "@/lib/supabase-rest-client";
import { fetchRestaurantsRecoveringMissingEmbed, mergeRestaurants, RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";
import { lookupPublishedPopularityTier, projectPublishedPopularityTier, type PublishedPopularityLookup } from "@/lib/evidence-engineering/published-popularity";

type DBRestaurant = Tables<"restaurants">;

function collectRestaurantMergeContextIds(restaurant: Restaurant | null | undefined): string[] {
    if (!restaurant?.id) return [];

    // Compact map rows intentionally keep merged child records to id-only shape.
    // Detail hydration depends on those ids to refetch full media fields on demand.
    return [...new Set([
        restaurant.id,
        ...(restaurant.mergedRestaurants?.map((mergedRestaurant) => mergedRestaurant.id).filter(Boolean) ?? []),
    ])].sort();
}

function hydrateDbRestaurant(dbData: DBRestaurant, publishedTier: PublishedPopularityLookup = lookupPublishedPopularityTier): Restaurant {
    const embedded = (dbData as { restaurant_evidence_frames?: unknown }).restaurant_evidence_frames;
    return {
        ...dbData,
        popularity_tier: publishedTier(dbData.id),
        evidence_frames: publicReviewedVideoFrames([Array.isArray(embedded) ? embedded : []]),
        address: dbData.road_address || dbData.jibun_address || '',
        category: dbData.categories,
    } as Restaurant;
}

export function buildRestaurantDetailFromMergeRows(
    mergeContextRestaurant: Restaurant,
    rows: DBRestaurant[],
    publishedTier: PublishedPopularityLookup = lookupPublishedPopularityTier,
): Restaurant | null {
    if (rows.length === 0) {
        const fallback = hydrateRestaurantDetailWithMergeContext(null, mergeContextRestaurant);
        return fallback ? projectPublishedPopularityTier(fallback, publishedTier) : null;
    }

    const mergeContextIds = collectRestaurantMergeContextIds(mergeContextRestaurant);
    const hydratedRows = rows.map((row) => hydrateDbRestaurant(row, publishedTier));
    const primaryDetail = hydratedRows.find((restaurant) => restaurant.id === mergeContextRestaurant.id) ?? hydratedRows[0] ?? null;
    const mergedCandidates = mergeRestaurants(rows, publishedTier);
    const mergedCandidate = mergedCandidates.find((restaurant) =>
        restaurant.id === mergeContextRestaurant.id ||
        restaurant.mergedRestaurants?.some((mergedRestaurant) => mergeContextIds.includes(mergedRestaurant.id))
    ) ?? mergedCandidates[0] ?? null;

    const hydrated = hydrateRestaurantDetailWithMergeContext(primaryDetail, mergedCandidate ?? mergeContextRestaurant);
    return hydrated ? projectPublishedPopularityTier(hydrated, publishedTier) : null;
}

export function useRestaurantWithMergeContext(mergeContextRestaurant: Restaurant | null | undefined) {
    const mergeContextIds = collectRestaurantMergeContextIds(mergeContextRestaurant);

    return useQuery({
        queryKey: ["restaurant-merge-detail", mergeContextIds],
        queryFn: async () => {
            if (!mergeContextRestaurant || mergeContextIds.length === 0) return null;

            const rows = await fetchRestaurantsRecoveringMissingEmbed<DBRestaurant>([
                ['select', RESTAURANT_MERGE_SELECT],
                ['id', postgrestIn(mergeContextIds)],
            ]);

            return buildRestaurantDetailFromMergeRows(mergeContextRestaurant, rows);
        },
        enabled: !!mergeContextRestaurant?.id,
    });
}
