import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfMonth, formatISO } from "date-fns";

export interface LeaderboardUser {
    id: string;
    rank: number;
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
    avgLikesPerReview: number;
    qualityScore: number;
}

export const useLeaderboard = (period: 'all' | 'monthly' = 'all') => {
    return useQuery({
        queryKey: ['leaderboard-users', period],
        queryFn: async () => {
            try {
                // [1단계] 리뷰 데이터 먼저 조회 (활동 유저 필터링을 위해)
                let reviewsQuery = supabase
                    .from('reviews')
                    .select('id, user_id, is_verified, created_at');

                // 월간 필터 적용
                if (period === 'monthly') {
                    const startOfMonthDate = startOfMonth(new Date());
                    reviewsQuery = reviewsQuery.gte('created_at', formatISO(startOfMonthDate));
                }

                const { data: allReviewsData, error: allReviewsError } = await reviewsQuery;

                if (allReviewsError) {
                    console.warn('전체 리뷰 데이터 조회 실패:', allReviewsError.message);
                    throw new Error(`리뷰 데이터 조회 실패: ${allReviewsError.message}`);
                }

                if (!allReviewsData || allReviewsData.length === 0) {
                    return [];
                }

                // [2단계] 활동 내역이 있는 사용자 ID 추출
                const activeUserIds = Array.from(new Set(allReviewsData.map((r: any) => r.user_id)));

                // [3단계] 활동 유저의 프로필 조회
                const { data: profilesData, error: profilesError } = await (supabase
                    .from('profiles') as any)
                    .select('user_id, nickname')
                    .in('user_id', activeUserIds)
                    .not('nickname', 'is', null)
                    .neq('nickname', '탈퇴한 사용자');

                if (profilesError) {
                    console.warn('프로필 데이터 조회 실패:', profilesError.message);
                }

                if (!profilesData) {
                    return [];
                }

                // [4단계] 모든 리뷰의 좋아요 데이터 조회
                const reviewIds = allReviewsData.map((review: any) => review.id);

                const { data: likesData, error: likesError } = await (supabase
                    .from('review_likes') as any)
                    .select('review_id')
                    .in('review_id', reviewIds);

                if (likesError) {
                    console.warn('좋아요 데이터 조회 실패:', likesError.message);
                }

                // 통계용 Map 생성
                const reviewCountMap = new Map<string, number>();
                const verifiedReviewCountMap = new Map<string, number>();
                const totalLikesMap = new Map<string, number>();

                // 각 리뷰별 좋아요 수 Map 생성
                const reviewLikesMap = new Map<string, number>();
                if (likesData) {
                    likesData.forEach((like: any) => {
                        const current = reviewLikesMap.get(like.review_id) || 0;
                        reviewLikesMap.set(like.review_id, current + 1);
                    });
                }

                // 리뷰 통계 계산
                allReviewsData.forEach((review: any) => {
                    // 총 리뷰 수 계산
                    const currentReviewCount = reviewCountMap.get(review.user_id) || 0;
                    reviewCountMap.set(review.user_id, currentReviewCount + 1);

                    // 승인된 리뷰 수 계산
                    if (review.is_verified) {
                        const currentVerifiedCount = verifiedReviewCountMap.get(review.user_id) || 0;
                        verifiedReviewCountMap.set(review.user_id, currentVerifiedCount + 1);
                    }

                    // 총 좋아요 수 계산
                    const reviewLikes = reviewLikesMap.get(review.id) || 0;
                    const currentLikes = totalLikesMap.get(review.user_id) || 0;
                    totalLikesMap.set(review.user_id, currentLikes + reviewLikes);
                });

                // [5단계] 각 사용자별 통계 계산 및 품질 점수 산출
                const users = profilesData.map((profile: any) => {
                    const reviewCount = reviewCountMap.get(profile.user_id) || 0;
                    const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
                    const totalLikes = totalLikesMap.get(profile.user_id) || 0;

                    // 평균 좋아요 계산
                    const avgLikesPerReview = verifiedReviewCount > 0
                        ? totalLikes / verifiedReviewCount
                        : 0;

                    // 품질 점수 계산
                    const qualityScore = verifiedReviewCount * (1 + avgLikesPerReview * 0.1);

                    return {
                        id: profile.user_id,
                        username: profile.nickname,
                        reviewCount,
                        verifiedReviewCount,
                        totalLikes,
                        avgLikesPerReview: Math.round(avgLikesPerReview * 10) / 10,
                        qualityScore: Math.round(qualityScore * 10) / 10,
                    };
                });

                return users
                    .sort((a: any, b: any) => b.qualityScore - a.qualityScore)
                    .map((user: any, index: number) => ({
                        ...user,
                        rank: index + 1,
                    }));
            } catch (error) {
                console.warn('리더보드 데이터 조회 중 오류 발생:', error);
                return [];
            }
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
};
