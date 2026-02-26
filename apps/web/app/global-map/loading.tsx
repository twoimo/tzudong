import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 글로벌 맵 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function GlobalMapLoading() {
    return (
        <GlobalLoader
            message="글로벌 지도를 불러오는 중..."
            subMessage="해외 맛집 데이터를 준비하고 있습니다"
        />
    );
}
