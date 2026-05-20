import { useQuery } from "@tanstack/react-query";

import type { Tables } from "@/integrations/supabase/types";
import type { Restaurant } from "@/types/restaurant";
import { hydrateRestaurantDetailWithMergeContext } from "@/lib/restaurant-merged-media";
import { fetchSupabaseRows, postgrestIn } from "@/lib/supabase-rest-client";
import { mergeRestaurants, RESTAURANT_MERGE_SELECT } from "@/hooks/use-restaurants";

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

function hydrateDbRestaurant(dbData: DBRestaurant): Restaurant {
    return {
        ...dbData,
        address: dbData.road_address || dbData.jibun_address || '',
        category: dbData.categories,
    } as Restaurant;
}

function buildRestaurantDetailFromMergeRows(
    mergeContextRestaurant: Restaurant,
    rows: DBRestaurant[],
): Restaurant | null {
    if (rows.length === 0) {
        return hydrateRestaurantDetailWithMergeContext(null, mergeContextRestaurant);
    }

    const mergeContextIds = collectRestaurantMergeContextIds(mergeContextRestaurant);
    const hydratedRows = rows.map(hydrateDbRestaurant);
    const primaryDetail = hydratedRows.find((restaurant) => restaurant.id === mergeContextRestaurant.id) ?? hydratedRows[0] ?? null;
    const mergedCandidates = mergeRestaurants(rows);
    const mergedCandidate = mergedCandidates.find((restaurant) =>
        restaurant.id === mergeContextRestaurant.id ||
        restaurant.mergedRestaurants?.some((mergedRestaurant) => mergeContextIds.includes(mergedRestaurant.id))
    ) ?? mergedCandidates[0] ?? null;

    return hydrateRestaurantDetailWithMergeContext(primaryDetail, mergedCandidate ?? mergeContextRestaurant);
}

export function useRestaurantWithMergeContext(mergeContextRestaurant: Restaurant | null | undefined) {
    const mergeContextIds = collectRestaurantMergeContextIds(mergeContextRestaurant);

    return useQuery({
        queryKey: ["restaurant-merge-detail", mergeContextIds],
        queryFn: async () => {
            if (!mergeContextRestaurant || mergeContextIds.length === 0) return null;

            const rows = await fetchSupabaseRows<DBRestaurant>('restaurants', [
                ['select', RESTAURANT_MERGE_SELECT],
                ['id', postgrestIn(mergeContextIds)],
            ]);

            return buildRestaurantDetailFromMergeRows(mergeContextRestaurant, rows);
        },
        enabled: !!mergeContextRestaurant?.id,
    });
}
