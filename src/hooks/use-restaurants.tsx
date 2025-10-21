import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";

interface UseRestaurantsOptions {
    bounds?: {
        south: number;
        west: number;
        north: number;
        east: number;
    };
    category?: string[];
    minRating?: number;
    minReviews?: number;
    minUserVisits?: number;
    minJjyangVisits?: number;
    enabled?: boolean;
}

export function useRestaurants(options: UseRestaurantsOptions = {}) {
    const { bounds, category, minRating, minReviews, minUserVisits, minJjyangVisits, enabled = true } = options;

    return useQuery({
        queryKey: ["restaurants", bounds, category, minRating, minReviews, minUserVisits, minJjyangVisits],
        queryFn: async () => {
            let query = supabase
                .from("restaurants")
                .select("*")
                .order("ai_rating", { ascending: false });

            // Apply bounds filter if provided
            if (bounds) {
                query = query
                    .gte("lat", bounds.south)
                    .lte("lat", bounds.north)
                    .gte("lng", bounds.west)
                    .lte("lng", bounds.east);
            }

            // Apply category filter
            if (category && category.length > 0) {
                query = query.in("category", category);
            }

            // Apply rating filter
            if (minRating && minRating > 1) {
                query = query.gte("rating_ai", minRating);
            }

            // Apply review count filter
            if (minReviews && minReviews > 0) {
                query = query.gte("review_count", minReviews);
            }

            // Apply user visit count filter
            if (minUserVisits && minUserVisits > 0) {
                query = query.gte("visit_count", minUserVisits);
            }

            // Apply jjyang visit count filter
            if (minJjyangVisits && minJjyangVisits > 0) {
                query = query.gte("jjyang_visit_count", minJjyangVisits);
            }

            const { data, error } = await query;

            if (error) throw error;
            return (data || []) as Restaurant[];
        },
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}

export function useRestaurant(id: string | null) {
    return useQuery({
        queryKey: ["restaurant", id],
        queryFn: async () => {
            if (!id) return null;

            const { data, error } = await supabase
                .from("restaurants")
                .select("*")
                .eq("id", id)
                .single();

            if (error) throw error;
            return data as Restaurant;
        },
        enabled: !!id,
    });
}

