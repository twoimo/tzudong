import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 관리자 페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function AdminLoading() {
    return (
        <GlobalLoader
            message="관리자 페이지를 불러오는 중..."
            subMessage="데이터를 준비하고 있습니다"
        />
    );
}
