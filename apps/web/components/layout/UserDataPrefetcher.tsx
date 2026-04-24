'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Restaurant } from '@/types/restaurant';

interface PrefetchedUserReview {
    restaurant_id: string;
    is_verified: boolean;
    restaurant?: Restaurant | null;
}

export default function UserDataPrefetcher() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (user?.id) {
            queryClient.prefetchQuery({
                queryKey: ['user-reviews', user.id],
                queryFn: async () => {
                    const { data, error } = await supabase
                        .from('reviews')
                        .select('restaurant_id, is_verified')
                        .eq('user_id', user.id)
                        .eq('is_verified', true);
                    if (error) throw error;

                    const reviews = (data ?? []) as PrefetchedUserReview[];
                    const restaurantIds = [...new Set(reviews.map((review) => review.restaurant_id).filter(Boolean))];
                    if (restaurantIds.length === 0) return reviews;

                    const { data: restaurants, error: restaurantsError } = await supabase
                        .from('restaurants')
                        .select('id, name:approved_name, approved_name, road_address, jibun_address, status')
                        .in('id', restaurantIds);

                    if (restaurantsError) throw restaurantsError;

                    const restaurantMap = new Map(
                        ((restaurants ?? []) as Restaurant[]).map((restaurant) => [restaurant.id, restaurant])
                    );

                    return reviews.map((review) => ({
                        ...review,
                        restaurant: restaurantMap.get(review.restaurant_id) ?? null,
                    }));
                },
                staleTime: 5 * 60 * 1000,
            });

            queryClient.prefetchQuery({
                queryKey: ['unvisited-restaurants-all'],
                queryFn: async () => {
                    const { data, error } = await supabase
                        .from('restaurants')
                        .select('id, name:approved_name, youtube_link, review_count, categories, road_address, jibun_address, lat, lng, tzuyang_review, created_at')
                        .eq('status', 'approved')
                        .not('youtube_link', 'is', null)
                        .order('created_at', { ascending: false });
                    if (error) throw error;
                    return data;
                },
                staleTime: 5 * 60 * 1000,
            });
        }
    }, [user?.id, queryClient]);

    return null;
}
