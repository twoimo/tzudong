/**
 * 랭킹 라우트 로딩 경계.
 *
 * route-level Suspense에서는 별도 스켈레톤을 그리지 않습니다.
 * `app/leaderboard/page.tsx`가 정적 헤더와 `LeaderboardSkeleton`을 한 번만
 * 소유해 route fallback과 클라이언트 데이터 로딩이 겹치지 않게 합니다.
 */
export default function LeaderboardLoading() {
    return null;
}
