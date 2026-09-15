import type { PublicProfileLeaderboardRow } from "@/lib/public-profile-read";

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

/** Preserve a successful empty read; never turn a failed read into an empty ranking. */
export async function readLeaderboardUsers(readRows: () => Promise<PublicProfileLeaderboardRow[]>): Promise<LeaderboardUser[]> {
  try {
    const rows = await readRows();
    return rows.map((row, index) => ({
      id: row.user_id,
      rank: index + 1,
      username: row.nickname,
      reviewCount: row.review_count,
      verifiedReviewCount: row.verified_review_count,
      totalLikes: row.total_likes,
      avgLikesPerReview: row.avg_likes_per_review,
      qualityScore: row.quality_score,
    }));
  } catch {
    throw new Error('leaderboard-unavailable');
  }
}
