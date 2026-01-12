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
        // [실시간 업데이트] Optimistic Update 적용 - 북마크 추가 시 카운트 +1
        onMutate: async (restaurantId) => {
            await queryClient.cancelQueries({ queryKey: ['bookmark-ids', user?.id] });
            await queryClient.cancelQueries({ queryKey: ['bookmark-count', restaurantId] });

            const previousIds = queryClient.getQueryData(['bookmark-ids', user?.id]) as string[] | undefined;
            const previousCount = queryClient.getQueryData(['bookmark-count', restaurantId]) as number | undefined;

            // Optimistic Update: ID 추가 및 카운트 +1
            queryClient.setQueryData(['bookmark-ids', user?.id], [...(previousIds || []), restaurantId]);
            queryClient.setQueryData(['bookmark-count', restaurantId], (previousCount || 0) + 1);

            return { previousIds, previousCount, restaurantId };
        },
        onError: (err, restaurantId, context) => {
            if (context?.previousIds) {
                queryClient.setQueryData(['bookmark-ids', user?.id], context.previousIds);
            }
            if (context?.previousCount !== undefined) {
                queryClient.setQueryData(['bookmark-count', restaurantId], context.previousCount);
            }
        },
        onSettled: (data, error, restaurantId) => {
            queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-count', restaurantId] });
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
        // [실시간 업데이트] Optimistic Update 적용 - 북마크 삭제 시 카운트 -1
        onMutate: async (restaurantId) => {
            await queryClient.cancelQueries({ queryKey: ['bookmark-ids', user?.id] });
            await queryClient.cancelQueries({ queryKey: ['bookmark-count', restaurantId] });

            const previousIds = queryClient.getQueryData(['bookmark-ids', user?.id]) as string[] | undefined;
            const previousCount = queryClient.getQueryData(['bookmark-count', restaurantId]) as number | undefined;

            // Optimistic Update: ID 제거 및 카운트 -1
            queryClient.setQueryData(
                ['bookmark-ids', user?.id],
                (previousIds || []).filter(id => id !== restaurantId)
            );
            queryClient.setQueryData(['bookmark-count', restaurantId], Math.max(0, (previousCount || 1) - 1));

            return { previousIds, previousCount, restaurantId };
        },
        onError: (err, restaurantId, context) => {
            if (context?.previousIds) {
                queryClient.setQueryData(['bookmark-ids', user?.id], context.previousIds);
            }
            if (context?.previousCount !== undefined) {
                queryClient.setQueryData(['bookmark-count', restaurantId], context.previousCount);
            }
        },
        onSettled: (data, error, restaurantId) => {
            queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-count', restaurantId] });
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

/**
 * 특정 맛집의 북마크 카운트를 가져오는 훅
 * [성능 최적화] 북마크 카운트는 실시간성이 낮으므로 staleTime 5분
 * [주의] user_bookmarks 테이블의 RLS 정책이 "Anyone can view bookmarks" (FOR SELECT USING (true))로 설정되어 있어야 정확한 전체 카운트가 표시됩니다.
 */
export function useBookmarkCount(restaurantId: string) {
    return useQuery({
        queryKey: ['bookmark-count', restaurantId],
        queryFn: async () => {
            const { count, error } = await (supabase as any)
                .from('user_bookmarks')
                .select('*', { count: 'exact', head: true })
                .eq('restaurant_id', restaurantId);

            if (error) throw error;
            return count || 0;
        },
        enabled: !!restaurantId,
        staleTime: 5 * 60 * 1000, // 5분 (북마크 카운트는 자주 변하지 않음)
        gcTime: BOOKMARK_GC_TIME,
    });
}
