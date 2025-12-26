import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback } from "react";

interface Bookmark {
    id: string;
    user_id: string;
    restaurant_id: string;
    created_at: string;
}

interface BookmarkWithRestaurant extends Bookmark {
    restaurant: {
        id: string;
        name: string;
        category: string[] | null;
        road_address: string | null;
        jibun_address: string | null;
        youtube_link: string | null;
        review_count: number;
    };
}

export function useBookmarks() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['bookmarks', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];

            const { data, error } = await (supabase as any)
                .from('user_bookmarks')
                .select(`
                    id,
                    user_id,
                    restaurant_id,
                    created_at,
                    restaurant:restaurants(
                        id,
                        name,
                        categories,
                        road_address,
                        jibun_address,
                        youtube_link,
                        review_count
                    )
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return (data || []).map((item: any) => ({
                ...item,
                restaurant: {
                    ...item.restaurant,
                    category: item.restaurant?.categories
                }
            })) as BookmarkWithRestaurant[];
        },
        enabled: !!user?.id,
    });
}

export function useBookmarkIds() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['bookmark-ids', user?.id],
        queryFn: async () => {
            if (!user?.id) return new Set<string>();

            const { data, error } = await (supabase as any)
                .from('user_bookmarks')
                .select('restaurant_id')
                .eq('user_id', user.id);

            if (error) throw error;

            return new Set((data || []).map((item: any) => item.restaurant_id));
        },
        enabled: !!user?.id,
    });
}

export function useToggleBookmark() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const addBookmark = useMutation({
        mutationFn: async (restaurantId: string) => {
            if (!user?.id) throw new Error('로그인이 필요합니다');

            const { error } = await (supabase as any)
                .from('user_bookmarks')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                });

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] });
        },
    });

    const removeBookmark = useMutation({
        mutationFn: async (restaurantId: string) => {
            if (!user?.id) throw new Error('로그인이 필요합니다');

            const { error } = await (supabase as any)
                .from('user_bookmarks')
                .delete()
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] });
        },
    });

    const toggleBookmark = useCallback(async (restaurantId: string, isBookmarked: boolean) => {
        if (isBookmarked) {
            await removeBookmark.mutateAsync(restaurantId);
        } else {
            await addBookmark.mutateAsync(restaurantId);
        }
    }, [addBookmark, removeBookmark]);

    return {
        toggleBookmark,
        isLoading: addBookmark.isPending || removeBookmark.isPending,
    };
}
