import { LeaderboardSkeleton } from "@/components/ui/skeleton-loaders";

/**
 * [PERF] 랭킹 페이지 로딩 UI - 스켈레톤으로 즉각적 페이지 전환
 */
export default function LeaderboardLoading() {
    return <LeaderboardSkeleton count={8} />;
}
