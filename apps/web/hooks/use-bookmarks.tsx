import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useMemo } from "react";
import type { Restaurant } from "@/types/restaurant";
import { findCanonicalVisitedRestaurant } from "@/lib/restaurant-visit-matching";
import {
    getRestaurantReviewLookupName,
    selectRelatedRestaurantReviewIds,
} from "@/lib/restaurant-review-lookup";

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
        category: string[];
        road_address: string | null;
        jibun_address: string | null;
        youtube_link: string | null;
        review_count: number;
        lat: number | null;
        lng: number | null;
    };
}

// [성능 최적화] 북마크 데이터 캐싱 시간 설정
const BOOKMARK_STALE_TIME = 2 * 60 * 1000; // 2분간 stale 상태가 되지 않음
const BOOKMARK_GC_TIME = 10 * 60 * 1000; // 10분간 캐시 유지

interface BookmarkRow {
    id: string;
    user_id: string;
    restaurant_id: string;
    created_at: string;
}

interface RestaurantRow {
    id: string;
    approved_name: string;
    categories: string[] | string;
    road_address: string | null;
    jibun_address: string | null;
    youtube_link: string | null;
    review_count: number | null;
    lat: number | null;
    lng: number | null;
    status?: string | null;
}

interface BookmarkIdRow {
    restaurant_id: string;
}

function toRestaurant(row: RestaurantRow): Restaurant {
    return {
        ...row,
        name: row.approved_name,
    } as Restaurant;
}

async function fetchApprovedCandidatesByRestaurantNames(restaurants: Restaurant[]): Promise<Restaurant[]> {
    const approvedNames = [
        ...new Set(
            restaurants
                .map((restaurant) => (restaurant.approved_name || restaurant.name || '').trim())
                .filter(Boolean)
        ),
    ];

    if (approvedNames.length === 0) return [];

    const { data } = await supabase
        .from('restaurants')
        .select('*')
        .eq('status', 'approved')
        .in('approved_name', approvedNames);

    return ((data ?? []) as Restaurant[]).map((restaurant) => ({
        ...restaurant,
        name: restaurant.approved_name || restaurant.name,
    }));
}

function resolveCanonicalBookmarkedRestaurant(
    bookmarkedRestaurant: Restaurant,
    approvedRestaurants: Restaurant[]
): Restaurant {
    if (bookmarkedRestaurant.status === 'approved') return bookmarkedRestaurant;

    return (findCanonicalVisitedRestaurant({
        reviewedRestaurant: bookmarkedRestaurant,
        reviewedRestaurantId: bookmarkedRestaurant.id,
        approvedRestaurants,
    }) as Restaurant | null) ?? bookmarkedRestaurant;
}

async function fetchRelatedBookmarkRestaurantIds(restaurantId: string): Promise<string[]> {
    const { data: restaurantRow } = await supabase
        .from('restaurants')
        .select('id, name:approved_name, approved_name, road_address, jibun_address')
        .eq('id', restaurantId)
        .maybeSingle();

    const restaurant = restaurantRow as Restaurant | null;
    if (!restaurant) return [restaurantId];

    const lookupName = getRestaurantReviewLookupName(restaurant);
    if (!lookupName) return [restaurantId];

    const { data: relatedRestaurantRows } = await supabase
        .from('restaurants')
        .select('id, name:approved_name, approved_name, road_address, jibun_address')
        .eq('approved_name', lookupName);

    return selectRelatedRestaurantReviewIds(
        restaurant,
        (relatedRestaurantRows ?? []) as Restaurant[]
    );
}

export function useBookmarks() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['user-bookmarks', user?.id],
        queryFn: async () => {
            if (!user?.id) return [];

            // 1. 북마크 데이터 조회
            const { data: bookmarksData, error: bookmarksError } = await supabase
                .from('user_bookmarks')
                .select('id, user_id, restaurant_id, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (bookmarksError) throw bookmarksError;

            if (!bookmarksData || bookmarksData.length === 0) {
                return [];
            }

            // 2. 맛집 상세 정보 조회
            const restaurantIds = (bookmarksData as BookmarkRow[]).map((b) => b.restaurant_id);

            const { data: restaurantsData, error: restaurantsError } = await supabase
                .from('restaurants')
                .select('id, approved_name, categories, road_address, jibun_address, youtube_link, review_count, lat, lng, status')
                .in('id', restaurantIds);

            if (restaurantsError) throw restaurantsError;

            // 3. 데이터 병합
            const bookmarkedRestaurants = ((restaurantsData ?? []) as unknown as RestaurantRow[]).map(toRestaurant);
            const approvedRestaurants = await fetchApprovedCandidatesByRestaurantNames(bookmarkedRestaurants);
            const restaurantsMap = new Map(bookmarkedRestaurants.map((restaurant) => [
                restaurant.id,
                resolveCanonicalBookmarkedRestaurant(restaurant, approvedRestaurants),
            ]));

            return (bookmarksData as BookmarkRow[])
                .map((bookmark) => {
                    const restaurant = restaurantsMap.get(bookmark.restaurant_id);
                    // 맛집 정보가 없으면(삭제/미승인 등) 필터링 대상이 될 수 있음
                    if (!restaurant) return null;

                    const categories = Array.isArray(restaurant.categories)
                        ? restaurant.categories
                        : (restaurant.categories ? [restaurant.categories as string] : []);

                    return {
                        ...bookmark,
                        restaurant: {
                            id: restaurant.id,
                            name: restaurant.approved_name || restaurant.name || '알 수 없음',
                            category: categories,
                            road_address: restaurant.road_address,
                            jibun_address: restaurant.jibun_address,
                            youtube_link: restaurant.youtube_link,
                            review_count: restaurant.review_count || 0,
                            lat: restaurant.lat,
                            lng: restaurant.lng
                        }
                    };
                })
                .filter((item): item is BookmarkWithRestaurant => item !== null);
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

            const { data, error } = await supabase
                .from('user_bookmarks')
                .select('restaurant_id')
                .eq('user_id', user.id);

            if (error) throw error;

            const bookmarkedRestaurantIds = ((data ?? []) as BookmarkIdRow[]).map((item) => item.restaurant_id);
            if (bookmarkedRestaurantIds.length === 0) return bookmarkedRestaurantIds;

            const { data: restaurantsData } = await supabase
                .from('restaurants')
                .select('id, approved_name, categories, road_address, jibun_address, youtube_link, review_count, lat, lng, status')
                .in('id', bookmarkedRestaurantIds);

            const bookmarkedRestaurants = ((restaurantsData ?? []) as unknown as RestaurantRow[]).map(toRestaurant);
            const approvedRestaurants = await fetchApprovedCandidatesByRestaurantNames(bookmarkedRestaurants);
            const canonicalIds = bookmarkedRestaurants
                .map((restaurant) => resolveCanonicalBookmarkedRestaurant(restaurant, approvedRestaurants).id)
                .filter(Boolean);

            return [...new Set([...bookmarkedRestaurantIds, ...canonicalIds])];
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

            const { error } = await supabase
                .from('user_bookmarks')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                } as never);

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
            queryClient.invalidateQueries({ queryKey: ['user-bookmarks'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] });
            queryClient.invalidateQueries({ queryKey: ['bookmark-count', restaurantId] });
        },
    });

    const removeBookmark = useMutation({
        mutationFn: async (restaurantId: string) => {
            if (!user?.id) throw new Error('로그인이 필요합니다');
            const relatedRestaurantIds = await fetchRelatedBookmarkRestaurantIds(restaurantId);

            const { error } = await supabase
                .from('user_bookmarks')
                .delete()
                .eq('user_id', user.id)
                .in('restaurant_id', relatedRestaurantIds);

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
            queryClient.invalidateQueries({ queryKey: ['user-bookmarks'] });
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
            const relatedRestaurantIds = await fetchRelatedBookmarkRestaurantIds(restaurantId);
            const { count, error } = await supabase
                .from('user_bookmarks')
                .select('*', { count: 'exact', head: true })
                .in('restaurant_id', relatedRestaurantIds);

            if (error) throw error;
            return count || 0;
        },
        enabled: !!restaurantId,
        staleTime: 5 * 60 * 1000, // 5분 (북마크 카운트는 자주 변하지 않음)
        gcTime: BOOKMARK_GC_TIME,
    });
}
