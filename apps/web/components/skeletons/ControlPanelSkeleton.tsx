import { Skeleton } from "@/components/ui/skeleton";

export function ControlPanelSkeleton() {
    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[50]">
            <div className="flex items-center gap-3 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg p-3">
                {/* 지역/국가 선택 스켈레톤 */}
                <Skeleton className="w-32 h-10 rounded-md" />

                {/* 카테고리 필터 스켈레톤 */}
                <Skeleton className="w-48 h-10 rounded-md" />

                {/* 검색창 스켈레톤 (기존 컴포넌트 재사용) */}
                <div className="w-72 h-10 relative">
                    <Skeleton className="w-full h-full rounded-md" />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2">
                        <Skeleton className="w-4 h-4 rounded-full bg-muted-foreground/20" />
                    </div>
                </div>
            </div>
        </div>
    );
}
