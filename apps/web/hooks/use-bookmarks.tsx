import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useMemo } from "react";

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

// [성능 최적화] 북마크 데이터 캐싱 시간 설정
const BOOKMARK_STALE_TIME = 2 * 60 * 1000; // 2분간 stale 상태가 되지 않음
const BOOKMARK_GC_TIME = 10 * 60 * 1000; // 10분간 캐시 유지

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
        staleTime: BOOKMARK_STALE_TIME,
        gcTime: BOOKMARK_GC_TIME,
    });
}

export function useBookmarkIds() {
    const { user } = useAuth();

    const query = useQuery({
        queryKey: ['bookmark-ids', user?.id],
        queryFn: async () => {
            if (!user?.id) return [] as string[];

            const { data, error } = await (supabase as any)
                .from('user_bookmarks')
                .select('restaurant_id')
                .eq('user_id', user.id);

            if (error) throw error;

            return (data || []).map((item: any) => item.restaurant_id) as string[];
        },
        enabled: !!user?.id,
        staleTime: BOOKMARK_STALE_TIME,
        gcTime: BOOKMARK_GC_TIME,
    });

    // [성능 최적화] Set 객체를 useMemo로 메모이제이션하여 불필요한 재생성 방지
    const bookmarkIdsSet = useMemo(() => new Set(query.data || []), [query.data]);

    return {
        ...query,
        data: bookmarkIdsSet,
    };
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
        // [성능 최적화] Optimistic Update 적용
        onMutate: async (restaurantId) => {
            await queryClient.cancelQueries({ queryKey: ['bookmark-ids', user?.id] });
            const previousIds = queryClient.getQueryData(['bookmark-ids', user?.id]) as string[] | undefined;
            queryClient.setQueryData(['bookmark-ids', user?.id], [...(previousIds || []), restaurantId]);
            return { previousIds };
        },
        onError: (err, restaurantId, context) => {
            if (context?.previousIds) {
                queryClient.setQueryData(['bookmark-ids', user?.id], context.previousIds);
            }
        },
        onSettled: () => {
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
        // [성능 최적화] Optimistic Update 적용
        onMutate: async (restaurantId) => {
            await queryClient.cancelQueries({ queryKey: ['bookmark-ids', user?.id] });
            const previousIds = queryClient.getQueryData(['bookmark-ids', user?.id]) as string[] | undefined;
            queryClient.setQueryData(
                ['bookmark-ids', user?.id],
                (previousIds || []).filter(id => id !== restaurantId)
            );
            return { previousIds };
        },
        onError: (err, restaurantId, context) => {
            if (context?.previousIds) {
                queryClient.setQueryData(['bookmark-ids', user?.id], context.previousIds);
            }
        },
        onSettled: () => {
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
