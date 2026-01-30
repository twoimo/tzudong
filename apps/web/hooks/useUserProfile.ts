'use client';

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Restaurant } from "@/types/restaurant";

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
    avatarUrl?: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
    avgLikesPerReview: number;
    qualityScore: number;
    tier: TierInfo;
}

/** 사용자 리뷰 정보 (ReviewCard용) */
export interface UserReview {
    id: string;
    restaurantId: string;
    restaurantName: string;
    rating: number; // Deprecated but kept for compatibility
    content: string;
    isVerified: boolean;
    likeCount: number;
    isLikedByUser: boolean; // [추가] 뷰어가 좋아요 눌렀는지 여부
    createdAt: string;
    visitedDate?: string;
    photos: { url: string; type: string }[]; // [추가] 리뷰 사진
    restaurant?: Restaurant; // [추가] 맛집 전체 정보 (모달 표시용)
}

/** 좋아요를 누른 사용자 정보 */
export interface Liker {
    userId: string;
    nickname: string;
    likedReviewCount: number;
}

/** 도장(스탬프) 정보 (StampCard용) */
export interface UserStamp {
    restaurant: Restaurant; // [수정] Restaurant 전체 객체 포함
    visitedDate?: string;
    createdAt: string;
}

// ============================================================================
// Constants
// ============================================================================

/** 티어 임계값 및 정보 (품질 점수 기준, 내림차순 정렬) */
const TIER_THRESHOLDS: ReadonlyArray<{ threshold: number; tier: TierInfo }> = [
    { threshold: 150, tier: { name: "👑 마스터", color: "text-purple-600", bgColor: "bg-purple-50" } },
    { threshold: 75, tier: { name: "💎 다이아몬드", color: "text-blue-600", bgColor: "bg-blue-50" } },
    { threshold: 35, tier: { name: "🏆 골드", color: "text-yellow-600", bgColor: "bg-yellow-50" } },
    { threshold: 15, tier: { name: "🥈 실버", color: "text-gray-600", bgColor: "bg-gray-50" } },
    { threshold: 7, tier: { name: "🥉 브론즈", color: "text-amber-600", bgColor: "bg-amber-50" } },
] as const;

const DEFAULT_TIER: TierInfo = { name: "🌱 뉴비", color: "text-green-600", bgColor: "bg-green-50" };

/** Query 기본 설정 */
const QUERY_STALE_TIME = 1000 * 60 * 5; // 5분
const QUERY_GC_TIME = 1000 * 60 * 10; // 10분

// ============================================================================
// Utility Functions
// ============================================================================

/** 티어 계산 함수 - 품질 점수 기준 */
export function getUserTier(qualityScore: number): TierInfo {
    for (const { threshold, tier } of TIER_THRESHOLDS) {
        if (qualityScore >= threshold) return tier;
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
    avatar_url?: string | null;
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
                    .select('user_id, nickname, avatar_url')
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

            // 전체 리뷰 수 = 조회된 모든 리뷰의 수
            const reviewCount = reviews.length;
            // 인증된 리뷰 수 (도장)
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

            // 품질 점수 계산
            const avgLikesPerReview = verifiedReviewCount > 0
                ? totalLikes / verifiedReviewCount
                : 0;
            const qualityScore = Math.round(
                verifiedReviewCount * (1 + avgLikesPerReview * 0.1) * 10
            ) / 10;

            return {
                userId: typedProfile.user_id,
                nickname: typedProfile.nickname,
                avatarUrl: typedProfile.avatar_url || undefined,
                reviewCount,
                verifiedReviewCount,
                totalLikes,
                avgLikesPerReview: Math.round(avgLikesPerReview * 10) / 10,
                qualityScore,
                tier: getUserTier(qualityScore),
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
 * - [수정] 사진 정보 및 뷰어의 좋아요 상태 포함
 */
export function useUserReviews(userId: string, viewerId?: string) {
    return useQuery({
        queryKey: ['user-reviews', userId, viewerId],
        queryFn: async (): Promise<UserReview[]> => {
            if (!userId) return [];

            // 1. 리뷰 조회
            const { data: reviews, error: reviewsError } = await supabase
                .from('reviews')
                .select('id, restaurant_id, content, is_verified, created_at, visited_at, food_photos')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError || !reviews?.length) return [];

            // 2. 관련 데이터 ID 추출
            const reviewIds = reviews.map((r: any) => r.id);
            const restaurantIds = [...new Set(reviews.map((r: any) => r.restaurant_id))];

            // 3. 맛집 정보 조회
            const { data: restaurants } = await supabase
                .from('restaurants')
                .select('*')
                .in('id', restaurantIds);

            const restaurantMap = new Map(
                restaurants?.map((r: any) => {
                    const mappedR = { ...r };
                    if (mappedR.approved_name) {
                        mappedR.name = mappedR.approved_name;
                    }
                    return [r.id, mappedR as Restaurant];
                }) || []
            );

            // 4. 좋아요 정보 조회 (뷰어 기준 + 전체 개수)
            // 개수는 별도 카운트 쿼리가 필요할 수 있으나, 여기서는 기존 로직대로 likes 테이블 조회
            const { data: likes } = await supabase
                .from('review_likes')
                .select('review_id, user_id')
                .in('review_id', reviewIds);

            const likesCountMap = new Map<string, number>();
            const userLikedMap = new Map<string, boolean>();

            if (likes) {
                (likes as any[]).forEach(l => {
                    likesCountMap.set(l.review_id, (likesCountMap.get(l.review_id) || 0) + 1);
                    if (viewerId && l.user_id === viewerId) {
                        userLikedMap.set(l.review_id, true);
                    }
                });
            }

            // 5. 데이터 병합
            return reviews.map((r: any) => {
                const photos = r.food_photos?.map((url: string) => ({
                    url: url,
                    type: 'image'
                })) || [];

                const restaurant = restaurantMap.get(r.restaurant_id);

                return {
                    id: r.id,
                    restaurantId: r.restaurant_id,
                    restaurantName: restaurant?.name ?? '알 수 없음',
                    restaurant: restaurant,
                    rating: 5,
                    content: r.content,
                    isVerified: r.is_verified,
                    likeCount: likesCountMap.get(r.id) || 0,
                    isLikedByUser: userLikedMap.get(r.id) || false,
                    createdAt: r.created_at,
                    visitedDate: r.visited_at ?? undefined,
                    photos: photos,
                };
            });
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
 * - [수정] StampCard에 필요한 모든 맛집 정보 조회
 */
export function useUserStamps(userId: string) {
    return useQuery({
        queryKey: ['user-stamps', userId],
        queryFn: async (): Promise<UserStamp[]> => {
            if (!userId) return [];

            // 1. 리뷰(도장) 조회
            const { data: reviews, error: reviewsError } = await supabase
                .from('reviews')
                .select('restaurant_id, visited_at, created_at')
                .eq('user_id', userId)
                .eq('is_verified', true)
                .order('created_at', { ascending: false });

            if (reviewsError || !reviews?.length) return [];

            // 2. 맛집 ID 추출
            const restaurantIds = [...new Set(reviews.map(r => r.restaurant_id))];

            // 3. 맛집 상세 정보 조회
            const { data: restaurants } = await supabase
                .from('restaurants')
                .select('*')
                .in('id', restaurantIds);

            const restaurantMap = new Map(
                restaurants?.map(r => {
                    const mappedR = { ...r };
                    if (mappedR.approved_name) {
                        mappedR.name = mappedR.approved_name;
                    }
                    return [r.id, mappedR as Restaurant];
                }) || []
            );

            // 4. 데이터 병합
            return reviews.map((r: any) => {
                const restaurant = restaurantMap.get(r.restaurant_id);
                // 맛집 정보가 없으면 스킵되어야 하지만, 일단 타입 안전을 위해 빈 객체 또는 처리 필요
                if (!restaurant) return null;

                return {
                    restaurant: restaurant,
                    visitedDate: r.visited_at ?? undefined,
                    createdAt: r.created_at,
                };
            }).filter(item => item !== null) as UserStamp[];
        },
        enabled: !!userId,
        staleTime: QUERY_STALE_TIME,
        gcTime: QUERY_GC_TIME,
    });
}
