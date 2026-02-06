import { GlobalLoader } from "@/components/ui/global-loader";

/**
 * [PERF] 루트 로딩 UI - 페이지 전환 시 즉각적 피드백 제공
 * Next.js App Router가 자동으로 Suspense 바운더리를 생성하여
 * 페이지 간 이동 시 빈 화면 대신 이 컴포넌트를 표시합니다.
 *
 * 센터링 전략:
 * - 모바일/태블릿: 상단 헤더(56px) + 하단 네비게이션(60px) 제외 영역 정중앙
 * - 데스크탑(md+): 상단 헤더(64px) 제외 영역 정중앙 (바텀 네비 없음)
 */
export default function RootLoading() {
    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-background
                pt-14 pb-[var(--mobile-bottom-nav-height,60px)]
                md:pt-16 md:pb-0"
            aria-label="페이지 로딩 중"
        >
            <GlobalLoader
                message="쯔동여지도 로딩 중..."
                subMessage="맛있는 발견을 준비하고 있습니다"
                className="h-auto flex-none"
            />
        </div>
    );
}
