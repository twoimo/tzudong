import { memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// [PERF] CSS containment 스타일 - 스켈레톤 컨테이너 레이아웃 격리
const CONTAIN_STYLE = { contain: 'content' } as const;

// ========== 리뷰 피드 스켈레톤 ==========
function FeedSkeletonComponent({ count = 3, className }: { count?: number; className?: string }) {
    return (
        <div className={cn("w-full max-w-2xl mx-auto p-4 space-y-4", className)} style={CONTAIN_STYLE}>
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="space-y-3 p-4 rounded-lg border border-border/50">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <Skeleton className="h-4 w-28" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-40 w-full rounded-lg" />
                </div>
            ))}
        </div>
    );
}

// ========== 도장 그리드 스켈레톤 ==========
function StampGridSkeletonComponent({
    count = 8,
    columns = "grid-cols-1 md:grid-cols-3 lg:grid-cols-4",
    showHeader = true,
    className,
}: {
    count?: number;
    columns?: string;
    showHeader?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("w-full p-4 space-y-4", className)} style={CONTAIN_STYLE}>
            {showHeader && <Skeleton className="h-6 w-32" />}
            <div className={cn("grid gap-3", columns)}>
                {Array.from({ length: count }, (_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="aspect-video w-full rounded-lg" />
                        <Skeleton className="h-4 w-3/4" />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ========== 도장 페이지 전체 스켈레톤 ==========
function StampPageSkeletonComponent() {
    return (
        <div
            className="h-full overflow-hidden bg-background"
            style={CONTAIN_STYLE}
            data-testid="stamp-page-skeleton"
            aria-busy="true"
            aria-label="도장 페이지를 불러오는 중"
        >
            <div className="h-full overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
                <div className="shrink-0 space-y-4 border-b border-border bg-background px-3 py-3 sm:px-5 sm:py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-[min(15rem,100%)] space-y-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                <Skeleton className="h-7 w-32 max-w-full rounded-lg" />
                                <Skeleton className="h-4 w-12 rounded-full" />
                            </div>
                            <Skeleton className="h-4 w-52 max-w-full rounded-full" />
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2" aria-hidden="true">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <Skeleton className="h-10 w-10 rounded-md" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
                        <Skeleton className="h-10 rounded-md lg:col-span-2" />
                        <Skeleton className="h-10 rounded-md" />
                        <Skeleton className="h-10 rounded-md" />
                        <Skeleton className="h-10 rounded-md" />
                        <Skeleton className="h-10 rounded-md" />
                    </div>
                </div>
                <div className="flex-1 min-h-0 px-4 sm:px-6 pt-6 pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1.5rem)] md:pb-6 bg-background">
                    <StampGridSkeleton count={16} showHeader={false} className="p-0" />
                </div>
            </div>
        </div>
    );
}

// ========== 랭킹 스켈레톤 ==========
function LeaderboardSkeletonComponent({
    count = 8,
    showHeader = true,
    className,
    compactLeftPanel = false,
}: {
    count?: number;
    showHeader?: boolean;
    className?: string;
    compactLeftPanel?: boolean;
}) {
    return (
        <div
            className={cn(
                "w-full space-y-3",
                compactLeftPanel ? "px-2 py-4" : "p-4",
                className,
            )}
            style={CONTAIN_STYLE}
        >
            {showHeader && <Skeleton className="h-6 w-32" />}
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className={cn(
                        "flex items-center py-2",
                        compactLeftPanel ? "gap-2" : "gap-3",
                    )}
                >
                    <Skeleton
                        className={cn(
                            "h-9 rounded-full",
                            compactLeftPanel ? "w-7" : "w-9",
                        )}
                    />
                    <Skeleton className="h-4 w-24 flex-1" />
                    <Skeleton className="h-4 w-12" />
                </div>
            ))}
        </div>
    );
}

export const FeedSkeleton = memo(FeedSkeletonComponent);
FeedSkeleton.displayName = "FeedSkeleton";

export const StampGridSkeleton = memo(StampGridSkeletonComponent);
StampGridSkeleton.displayName = "StampGridSkeleton";

export const StampPageSkeleton = memo(StampPageSkeletonComponent);
StampPageSkeleton.displayName = "StampPageSkeleton";

export const LeaderboardSkeleton = memo(LeaderboardSkeletonComponent);
LeaderboardSkeleton.displayName = "LeaderboardSkeleton";
