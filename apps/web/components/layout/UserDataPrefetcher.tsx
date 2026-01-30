'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

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
                    return data;
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
