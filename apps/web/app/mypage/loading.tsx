import { MyPageSectionSkeleton } from "@/components/mypage/MyPageSectionSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * [PERF] 마이페이지 로딩 UI - 즉각적 페이지 전환
 */
export default function MyPageLoading() {
    return (
        <div className="h-full min-h-0 bg-background">
            <div
                className="flex h-full min-h-0 w-full max-w-none"
                data-mypage-viewport-layout="edge-to-edge"
            >
                {/* 사이드바 스켈레톤 */}
                <div className="hidden md:block w-64 shrink-0 border-r border-border p-4">
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton key={index} className="h-9 rounded-md" />
                        ))}
                    </div>
                </div>
                {/* 콘텐츠 스켈레톤 */}
                <div className="flex-1 px-3 py-4 pb-[calc(var(--mobile-bottom-nav-height,60px)+env(safe-area-inset-bottom)+1rem)] sm:px-4 md:px-5 md:py-6 md:pb-6 lg:px-6 lg:py-7">
                    <MyPageSectionSkeleton />
                </div>
            </div>
        </div>
    );
}
