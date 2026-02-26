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

// ========== 랭킹 스켈레톤 ==========
function LeaderboardSkeletonComponent({
    count = 8,
    showHeader = true,
    className,
}: {
    count?: number;
    showHeader?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("w-full p-4 space-y-3", className)} style={CONTAIN_STYLE}>
            {showHeader && <Skeleton className="h-6 w-32" />}
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                    <Skeleton className="h-5 w-5 rounded" />
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <Skeleton className="h-4 w-24 flex-1" />
                    <Skeleton className="h-4 w-12" />
                </div>
            ))}
        </div>
    );
}

// ========== 비용 테이블 스켈레톤 ==========
function CostsSkeletonComponent({
    count = 5,
    className,
}: {
    count?: number;
    className?: string;
}) {
    return (
        <div className={cn("w-full max-w-4xl mx-auto p-4 md:p-6 space-y-4", className)} style={CONTAIN_STYLE}>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-20 w-full rounded-lg" />
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex items-center gap-4 py-2">
                    <Skeleton className="h-4 w-28 flex-1" />
                    <Skeleton className="h-4 w-16" />
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

export const LeaderboardSkeleton = memo(LeaderboardSkeletonComponent);
LeaderboardSkeleton.displayName = "LeaderboardSkeleton";

export const CostsSkeleton = memo(CostsSkeletonComponent);
CostsSkeleton.displayName = "CostsSkeleton";
