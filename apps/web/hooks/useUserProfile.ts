'use client';

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 사용자 기본 프로필 정보
 */
export interface UserProfile {
    userId: string;
    nickname: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
    tier: {
        name: string;
        color: string;
        bgColor: string;
    };
}

/**
 * 사용자 리뷰 정보
 */
export interface UserReview {
    id: string;
    restaurantId: string;
    restaurantName: string;
    rating: number;
    content: string;
    isVerified: boolean;
    likeCount: number;
    createdAt: string;
    visitedDate?: string;
}

/**
 * 좋아요를 누른 사용자 정보
 */
export interface Liker {
    userId: string;
    nickname: string;
    likedReviewCount: number; // 해당 사용자의 리뷰 중 몇 개에 좋아요를 눌렀는지
}

/**
 * 티어 계산 함수
 */
export function getUserTier(reviewCount: number) {
    if (reviewCount >= 100) return { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" };
    if (reviewCount >= 50) return { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" };
    if (reviewCount >= 25) return { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" };
    if (reviewCount >= 10) return { name: "🥈 실버", color: "text-gray-600", bgColor: "bg-gray-50" };
    if (reviewCount >= 5) return { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" };
    return { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };
}

/**
 * 특정 사용자의 프로필 정보 조회
 */
export function useUserProfile(userId: string) {
    return useQuery({
        queryKey: ['user-profile', userId],
        queryFn: async (): Promise<UserProfile | null> => {
            if (!userId) return null;

            // 프로필 조회
            const { data: profile, error: profileError } = await (supabase
                .from('profiles') as any)
                .select('user_id, nickname')
                .eq('user_id', userId)
                .single();

            if (profileError || !profile) {
                console.warn('프로필 조회 실패:', profileError?.message);
                return null;
            }

            // 해당 사용자의 리뷰 조회
            const { data: reviews, error: reviewsError } = await (supabase
                .from('reviews') as any)
                .select('id, is_verified')
                .eq('user_id', userId);

            if (reviewsError) {
                console.warn('리뷰 조회 실패:', reviewsError.message);
            }

            const reviewCount = reviews?.length || 0;
            const verifiedReviewCount = reviews?.filter((r: any) => r.is_verified).length || 0;

            // 좋아요 수 조회
            const reviewIds = reviews?.map((r: any) => r.id) || [];
            let totalLikes = 0;

            if (reviewIds.length > 0) {
                const { count, error: likesError } = await (supabase
                    .from('review_likes') as any)
                    .select('*', { count: 'exact', head: true })
                    .in('review_id', reviewIds);

                if (!likesError && count) {
                    totalLikes = count;
                }
            }

            return {
                userId: profile.user_id,
                nickname: profile.nickname,
                reviewCount: verifiedReviewCount, // 승인된 리뷰만 표시
                verifiedReviewCount,
                totalLikes,
                tier: getUserTier(verifiedReviewCount),
            };
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5, // 5분
    });
}

/**
 * 특정 사용자의 리뷰 목록 조회
 */
export function useUserReviews(userId: string) {
    return useQuery({
        queryKey: ['user-reviews', userId],
        queryFn: async (): Promise<UserReview[]> => {
            if (!userId) return [];

            // 승인된 리뷰만 조회
            const { data: reviews, error: reviewsError } = await (supabase
                .from('reviews') as any)
                .select('id,restaurant_id,title,content,is_verified,created_at,visited_at')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError) {
                console.warn('리뷰 목록 조회 실패:', reviewsError.message);
                return [];
            }

            if (!reviews || reviews.length === 0) return [];

            // 맛집 정보 별도 조회
            const restaurantIds = [...new Set(reviews.map((r: any) => r.restaurant_id))];
            const { data: restaurants, error: restaurantsError } = await (supabase
                .from('restaurants') as any)
                .select('id, name')
                .in('id', restaurantIds);

            const restaurantMap = new Map<string, string>();
            if (!restaurantsError && restaurants) {
                restaurants.forEach((r: any) => {
                    restaurantMap.set(r.id, r.name);
                });
            }

            // 각 리뷰별 좋아요 수 조회
            const reviewIds = reviews.map((r: any) => r.id);
            const { data: likes, error: likesError } = await (supabase
                .from('review_likes') as any)
                .select('review_id')
                .in('review_id', reviewIds);

            const likesMap = new Map<string, number>();
            if (!likesError && likes) {
                likes.forEach((like: any) => {
                    likesMap.set(like.review_id, (likesMap.get(like.review_id) || 0) + 1);
                });
            }

            return reviews.map((r: any) => ({
                id: r.id,
                restaurantId: r.restaurant_id,
                restaurantName: restaurantMap.get(r.restaurant_id) || '알 수 없음',
                rating: 5, // 리뷰 테이블에 rating 컨럼 없음 - 기본값 5
                content: r.content,
                isVerified: r.is_verified,
                likeCount: likesMap.get(r.id) || 0,
                createdAt: r.created_at,
                visitedDate: r.visited_at,
            }));
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * 특정 사용자에게 좋아요를 누른 사용자 목록 조회
 */
export function useUserLikers(userId: string) {
    return useQuery({
        queryKey: ['user-likers', userId],
        queryFn: async (): Promise<Liker[]> => {
            if (!userId) return [];

            // 1. 해당 사용자의 모든 리뷰 ID 조회
            const { data: reviews, error: reviewsError } = await (supabase
                .from('reviews') as any)
                .select('id')
                .eq('user_id', userId);

            if (reviewsError || !reviews || reviews.length === 0) {
                return [];
            }

            const reviewIds = reviews.map((r: any) => r.id);

            // 2. 해당 리뷰들에 좋아요를 누른 사용자 조회
            const { data: likes, error: likesError } = await (supabase
                .from('review_likes') as any)
                .select('user_id, review_id')
                .in('review_id', reviewIds);

            if (likesError || !likes || likes.length === 0) {
                return [];
            }

            // 사용자별 좋아요 수 집계 (자기 자신 포함)
            const likerMap = new Map<string, number>();
            likes.forEach((like: any) => {
                likerMap.set(like.user_id, (likerMap.get(like.user_id) || 0) + 1);
            });

            if (likerMap.size === 0) return [];

            // 3. 좋아요를 누른 사용자들의 프로필 조회
            const likerIds = Array.from(likerMap.keys());
            const { data: profiles, error: profilesError } = await (supabase
                .from('profiles') as any)
                .select('user_id, nickname')
                .in('user_id', likerIds);

            if (profilesError || !profiles) {
                return [];
            }

            // 좋아요 수 기준 내림차순 정렬
            return profiles
                .map((p: any) => ({
                    userId: p.user_id,
                    nickname: p.nickname || '익명',
                    likedReviewCount: likerMap.get(p.user_id) || 0,
                }))
                .sort((a: Liker, b: Liker) => b.likedReviewCount - a.likedReviewCount);
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * 도장(스탬프) 정보 - 방문한 맛집
 */
export interface UserStamp {
    restaurantId: string;
    restaurantName: string;
    visitedDate?: string;
    createdAt: string;
}

/**
 * 특정 사용자의 도장(방문한 맛집) 목록 조회
 * 승인된 리뷰 기준
 */
export function useUserStamps(userId: string) {
    return useQuery({
        queryKey: ['user-stamps', userId],
        queryFn: async (): Promise<UserStamp[]> => {
            if (!userId) return [];

            // 승인된 리뷰만 조회
            const { data: reviews, error: reviewsError } = await (supabase
                .from('reviews') as any)
                .select('restaurant_id,visited_at,created_at')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError) {
                console.warn('도장 목록 조회 실패:', reviewsError.message);
                return [];
            }

            if (!reviews || reviews.length === 0) return [];

            // 맛집 정보 별도 조회
            const restaurantIds = [...new Set(reviews.map((r: any) => r.restaurant_id))];
            const { data: restaurants, error: restaurantsError } = await (supabase
                .from('restaurants') as any)
                .select('id, name')
                .in('id', restaurantIds);

            const restaurantMap = new Map<string, string>();
            if (!restaurantsError && restaurants) {
                restaurants.forEach((r: any) => {
                    restaurantMap.set(r.id, r.name);
                });
            }

            return reviews.map((r: any) => ({
                restaurantId: r.restaurant_id,
                restaurantName: restaurantMap.get(r.restaurant_id) || '알 수 없음',
                visitedDate: r.visited_at,
                createdAt: r.created_at,
            }));
        },
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
