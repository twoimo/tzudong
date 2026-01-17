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
                // [1단계] 모든 프로필 조회
                const { data: profilesData, error: profilesError } = await (supabase
                    .from('profiles') as any)
                    .select('user_id, nickname')
                    .not('nickname', 'is', null)
                    .neq('nickname', '탈퇴한 사용자');

                if (profilesError) {
                    console.warn('프로필 데이터 조회 실패:', profilesError.message);
                    throw new Error(`프로필 데이터 조회 실패: ${profilesError.message}`);
                }

                if (!profilesData || profilesData.length === 0) {
                    return [];
                }

                // [2단계] 해당 사용자들의 모든 리뷰 조회
                const userIds = profilesData.map((profile: any) => profile.user_id);

                let reviewsQuery = supabase
                    .from('reviews')
                    .select('id, user_id, is_verified, created_at')
                    .in('user_id', userIds);

                // 월간 필터 적용
                if (period === 'monthly') {
                    const startOfMonthDate = startOfMonth(new Date());
                    reviewsQuery = reviewsQuery.gte('created_at', formatISO(startOfMonthDate));
                }

                const { data: allReviewsData, error: allReviewsError } = await reviewsQuery;

                if (allReviewsError) {
                    console.warn('전체 리뷰 데이터 조회 실패:', allReviewsError.message);
                }

                // [3단계] 모든 리뷰의 좋아요 데이터 조회
                let reviewIds: string[] = [];
                if (allReviewsData) {
                    reviewIds = allReviewsData.map((review: any) => review.id);
                }

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

                if (allReviewsData && allReviewsData.length > 0) {
                    allReviewsData.forEach((review: any) => {
                        // 총 리뷰 수 계산
                        const currentReviewCount = reviewCountMap.get(review.user_id) || 0;
                        reviewCountMap.set(review.user_id, currentReviewCount + 1);

                        // 승인된 리뷰 수 계산
                        if (review.is_verified) {
                            const currentVerifiedCount = verifiedReviewCountMap.get(review.user_id) || 0;
                            verifiedReviewCountMap.set(review.user_id, currentVerifiedCount + 1);
                        }

                        // 총 좋아요 수 계산 (각 리뷰의 좋아요 수를 합산)
                        const reviewLikes = reviewLikesMap.get(review.id) || 0;
                        const currentLikes = totalLikesMap.get(review.user_id) || 0;
                        totalLikesMap.set(review.user_id, currentLikes + reviewLikes);
                    });
                }

                // [4단계] 각 사용자별 통계 계산 및 품질 점수 산출
                const users = profilesData.map((profile: any) => {
                    const reviewCount = reviewCountMap.get(profile.user_id) || 0;
                    const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
                    const totalLikes = totalLikesMap.get(profile.user_id) || 0;

                    // 평균 좋아요 계산 (0으로 나누기 방지)
                    const avgLikesPerReview = verifiedReviewCount > 0
                        ? totalLikes / verifiedReviewCount
                        : 0;

                    // 품질 점수: 리뷰수 × (1 + 평균좋아요 × 0.1)
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

                // 품질 점수 기준 내림차순 정렬 및 순위 부여
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
