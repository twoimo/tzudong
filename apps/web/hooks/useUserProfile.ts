'use client';

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ============================================================================
// Type Definitions
// ============================================================================

/** 티어 정보 타입 */
interface TierInfo {
    readonly name: string;
    readonly color: string;
    readonly bgColor: string;
}

/** 사용자 기본 프로필 정보 */
export interface UserProfile {
    userId: string;
    nickname: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
    tier: TierInfo;
}

/** 사용자 리뷰 정보 */
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

/** 좋아요를 누른 사용자 정보 */
export interface Liker {
    userId: string;
    nickname: string;
    likedReviewCount: number;
}

/** 도장(스탬프) 정보 */
export interface UserStamp {
    restaurantId: string;
    restaurantName: string;
    visitedDate?: string;
    createdAt: string;
}

// ============================================================================
// Constants
// ============================================================================

/** 티어 임계값 및 정보 (내림차순 정렬 - 가장 높은 티어부터) */
const TIER_THRESHOLDS: ReadonlyArray<{ threshold: number; tier: TierInfo }> = [
    { threshold: 100, tier: { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" } },
    { threshold: 50, tier: { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" } },
    { threshold: 25, tier: { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" } },
    { threshold: 10, tier: { name: "🥈 실버", color: "text-gray-600", bgColor: "bg-gray-50" } },
    { threshold: 5, tier: { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" } },
] as const;

const DEFAULT_TIER: TierInfo = { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };

/** Query 기본 설정 */
const QUERY_STALE_TIME = 1000 * 60 * 5; // 5분
const QUERY_GC_TIME = 1000 * 60 * 10; // 10분

// ============================================================================
// Utility Functions
// ============================================================================

/** 티어 계산 함수 - 이진 탐색 최적화 */
export function getUserTier(reviewCount: number): TierInfo {
    for (const { threshold, tier } of TIER_THRESHOLDS) {
        if (reviewCount >= threshold) return tier;
    }
    return DEFAULT_TIER;
}

/** Map에 카운트 증가 헬퍼 */
function incrementMapCount(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
}

/** 좋아요 수 카운트 맵 생성 */
function buildLikesCountMap(likes: Array<{ review_id: string }> | null): Map<string, number> {
    const likesMap = new Map<string, number>();
    if (!likes) return likesMap;

    for (const like of likes) {
        incrementMapCount(likesMap, like.review_id);
    }
    return likesMap;
}

// ============================================================================
// Database Query Types (Supabase response shapes)
// ============================================================================

interface ProfileRow {
    user_id: string;
    nickname: string;
}

interface ReviewRow {
    id: string;
    is_verified: boolean;
}

interface ReviewWithRestaurantRow {
    id: string;
    restaurant_id: string;
    content: string;
    is_verified: boolean;
    created_at: string;
    visited_at: string | null;
    restaurants: { name: string } | null;
}

interface StampRow {
    restaurant_id: string;
    visited_at: string | null;
    created_at: string;
    restaurants: { name: string } | null;
}

interface ReviewLikeRow {
    review_id: string;
    user_id?: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * 특정 사용자의 프로필 정보 조회
 * - 프로필, 리뷰 수, 좋아요 수를 한 번에 조회
 */
export function useUserProfile(userId: string) {
    return useQuery({
        queryKey: ['user-profile', userId],
        queryFn: async (): Promise<UserProfile | null> => {
            if (!userId) return null;

            // 병렬 쿼리: 프로필 + 리뷰 동시 조회
            const [profileResult, reviewsResult] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('user_id, nickname')
                    .eq('user_id', userId)
                    .single(),
                supabase
                    .from('reviews')
                    .select('id, is_verified')
                    .eq('user_id', userId),
            ]);

            const { data: profile, error: profileError } = profileResult;
            if (profileError || !profile) return null;

            const typedProfile = profile as ProfileRow;
            const reviews = (reviewsResult.data ?? []) as ReviewRow[];

            const verifiedReviewCount = reviews.filter(r => r.is_verified).length;
            const reviewIds = reviews.map(r => r.id);

            // 좋아요 수 조회 (있을 경우에만)
            let totalLikes = 0;
            if (reviewIds.length > 0) {
                const { count } = await supabase
                    .from('review_likes')
                    .select('*', { count: 'exact', head: true })
                    .in('review_id', reviewIds);

                totalLikes = count ?? 0;
            }

            return {
                userId: typedProfile.user_id,
                nickname: typedProfile.nickname,
                reviewCount: verifiedReviewCount,
                verifiedReviewCount,
                totalLikes,
                tier: getUserTier(verifiedReviewCount),
            };
        },
        enabled: !!userId,
        staleTime: QUERY_STALE_TIME,
        gcTime: QUERY_GC_TIME,
    });
}

/**
 * 특정 사용자의 리뷰 목록 조회
 * - 승인된 리뷰만 조회하고 좋아요 수 포함
 */
export function useUserReviews(userId: string) {
    return useQuery({
        queryKey: ['user-reviews', userId],
        queryFn: async (): Promise<UserReview[]> => {
            if (!userId) return [];

            const { data: reviews, error: reviewsError } = await supabase
                .from('reviews')
                .select('id, restaurant_id, content, is_verified, created_at, visited_at, restaurants(name)')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError || !reviews?.length) return [];

            const typedReviews = reviews as ReviewWithRestaurantRow[];
            const reviewIds = typedReviews.map(r => r.id);

            // 좋아요 수 조회
            const { data: likes } = await supabase
                .from('review_likes')
                .select('review_id')
                .in('review_id', reviewIds);

            const likesMap = buildLikesCountMap(likes as ReviewLikeRow[] | null);

            return typedReviews.map(r => ({
                id: r.id,
                restaurantId: r.restaurant_id,
                restaurantName: r.restaurants?.name ?? '알 수 없음',
                rating: 5,
                content: r.content,
                isVerified: r.is_verified,
                likeCount: likesMap.get(r.id) ?? 0,
                createdAt: r.created_at,
                visitedDate: r.visited_at ?? undefined,
            }));
        },
        enabled: !!userId,
        staleTime: 0, // 탭 전환 시 즉시 fetch
        gcTime: QUERY_GC_TIME,
        refetchOnMount: 'always',
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
            const { data: reviews, error: reviewsError } = await supabase
                .from('reviews')
                .select('id')
                .eq('user_id', userId);

            if (reviewsError || !reviews?.length) return [];

            const reviewIds = (reviews as Array<{ id: string }>).map(r => r.id);

            // 2. 해당 리뷰들에 좋아요를 누른 사용자 조회
            const { data: likes, error: likesError } = await supabase
                .from('review_likes')
                .select('user_id, review_id')
                .in('review_id', reviewIds);

            if (likesError || !likes?.length) return [];

            // 사용자별 좋아요 수 집계
            const likerMap = new Map<string, number>();
            for (const like of likes as Array<{ user_id: string }>) {
                incrementMapCount(likerMap, like.user_id);
            }

            if (likerMap.size === 0) return [];

            // 3. 좋아요를 누른 사용자들의 프로필 조회
            const likerIds = Array.from(likerMap.keys());
            const { data: profiles, error: profilesError } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', likerIds);

            if (profilesError || !profiles) return [];

            // 좋아요 수 기준 내림차순 정렬 후 반환
            return (profiles as ProfileRow[])
                .map(p => ({
                    userId: p.user_id,
                    nickname: p.nickname || '익명',
                    likedReviewCount: likerMap.get(p.user_id) ?? 0,
                }))
                .sort((a, b) => b.likedReviewCount - a.likedReviewCount);
        },
        enabled: !!userId,
        staleTime: QUERY_STALE_TIME,
        gcTime: QUERY_GC_TIME,
    });
}

/**
 * 특정 사용자의 도장(방문한 맛집) 목록 조회
 * - 승인된 리뷰 기준
 */
export function useUserStamps(userId: string) {
    return useQuery({
        queryKey: ['user-stamps', userId],
        queryFn: async (): Promise<UserStamp[]> => {
            if (!userId) return [];

            const { data: reviews, error: reviewsError } = await supabase
                .from('reviews')
                .select('restaurant_id, visited_at, created_at, restaurants(name)')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError || !reviews?.length) return [];

            return (reviews as StampRow[]).map(r => ({
                restaurantId: r.restaurant_id,
                restaurantName: r.restaurants?.name ?? '알 수 없음',
                visitedDate: r.visited_at ?? undefined,
                createdAt: r.created_at,
            }));
        },
        enabled: !!userId,
        staleTime: QUERY_STALE_TIME,
        gcTime: QUERY_GC_TIME,
    });
}
