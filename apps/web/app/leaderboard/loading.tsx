import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 랭킹 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function LeaderboardLoading() {
    return (
        <GlobalLoader
            message="랭킹 데이터를 불러오는 중..."
            subMessage="사용자들의 기록을 확인하고 있습니다"
        />
    );
}
