import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LeaderboardUser {
    id: string;
    rank: number;
    username: string;
    reviewCount: number;
    verifiedReviewCount: number;
    totalLikes: number;
}

export const useLeaderboard = () => {
    return useQuery({
        queryKey: ['leaderboard-all-users'],
        queryFn: async () => {
            try {
                // Get all profiles (모든 사용자)
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
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

                // Get all reviews for these users
                const userIds = profilesData.map(profile => profile.user_id);
                const { data: allReviewsData, error: allReviewsError } = await supabase
                    .from('reviews')
                    .select('id, user_id, is_verified')
                    .in('user_id', userIds);

                if (allReviewsError) {
                    console.warn('전체 리뷰 데이터 조회 실패:', allReviewsError.message);
                }

                // Get likes data for all reviews
                let reviewIds: string[] = [];
                if (allReviewsData) {
                    reviewIds = allReviewsData.map(review => review.id);
                }

                const { data: likesData, error: likesError } = await supabase
                    .from('review_likes')
                    .select('review_id')
                    .in('review_id', reviewIds);

                if (likesError) {
                    console.warn('좋아요 데이터 조회 실패:', likesError.message);
                }

                // Create review stats maps
                const reviewCountMap = new Map<string, number>();
                const verifiedReviewCountMap = new Map<string, number>();
                const totalLikesMap = new Map<string, number>();

                // Create likes count map for each review
                const reviewLikesMap = new Map<string, number>();
                if (likesData) {
                    likesData.forEach(like => {
                        const current = reviewLikesMap.get(like.review_id) || 0;
                        reviewLikesMap.set(like.review_id, current + 1);
                    });
                }

                if (allReviewsData && allReviewsData.length > 0) {
                    allReviewsData.forEach(review => {
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

                // Calculate user stats for all profiles
                const users = profilesData.map(profile => {
                    const reviewCount = reviewCountMap.get(profile.user_id) || 0;
                    const verifiedReviewCount = verifiedReviewCountMap.get(profile.user_id) || 0;
                    const totalLikes = totalLikesMap.get(profile.user_id) || 0;

                    return {
                        id: profile.user_id,
                        username: profile.nickname,
                        reviewCount,
                        verifiedReviewCount,
                        totalLikes,
                    };
                });

                // Sort by review count and assign rank
                return users
                    .sort((a, b) => b.reviewCount - a.reviewCount)
                    .map((user, index) => ({
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
