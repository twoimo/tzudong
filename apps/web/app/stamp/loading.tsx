import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 도장 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function StampLoading() {
    return (
        <GlobalLoader
            message="도장 데이터를 불러오는 중..."
            subMessage="쯔양의 맛집 기록을 확인하고 있습니다"
        />
    );
}
