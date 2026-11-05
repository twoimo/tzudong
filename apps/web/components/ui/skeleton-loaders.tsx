"use client";

import { memo } from "react";
import { useFilledSkeletonCount } from "@/lib/use-filled-skeleton-count";
import { LoadingPreview, LoadingSurface } from "@/components/ui/loading-surface";
import { cn } from "@/lib/utils";

// Compatibility exports retain route/query ownership; Skullet measures static
// content instead of a separate collection of manually sized placeholder bars.
function FeedSkeletonComponent({ count = 3, className }: { count?: number; className?: string }) {
    const { ref, count: filledCount } = useFilledSkeletonCount(280, count);
    return <div ref={ref} data-testid="feed-skeleton" className={cn("w-full max-w-2xl mx-auto", className)}>
        <LoadingSurface label="리뷰 피드를 불러오는 중" className="space-y-4 p-4">
            {Array.from({ length: filledCount }, (_, index) => <article key={index} className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">맛집 방문 이야기</p>
                <p className="text-sm leading-6">영상 속 음식을 찾아 떠나는 맛있는 여행을 함께해요.</p>
                <svg viewBox="0 0 320 160" role="img" aria-label="방문 사진" className="h-40 w-full rounded-lg bg-muted"><rect width="320" height="160" fill="currentColor" opacity="0.08" /></svg>
            </article>)}
        </LoadingSurface>
    </div>;
}

function StampGridSkeletonComponent({ count = 8, columns = "grid-cols-1 md:grid-cols-3 lg:grid-cols-4", showHeader = true, className }: {
    count?: number; columns?: string; showHeader?: boolean; className?: string;
}) {
    return <LoadingSurface label="도장 목록을 불러오는 중" className={cn("w-full space-y-4 p-4", className)}>
        {showHeader && <h2 className="text-lg font-semibold">맛집 도장 모으기</h2>}
        <div className={cn("grid gap-3", columns)}>{Array.from({ length: count }, (_, index) => <article key={index} className="min-w-0 space-y-2">
            <svg viewBox="0 0 320 180" role="img" aria-label="맛집 사진" className="aspect-video w-full rounded-lg bg-muted"><rect width="320" height="180" fill="currentColor" opacity="0.08" /></svg>
            <p className="text-sm font-medium">영상 속 맛집</p>
        </article>)}</div>
    </LoadingSurface>;
}

function StampPageSkeletonComponent() {
    return <div className="h-full overflow-hidden bg-background" data-testid="stamp-page-skeleton">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto">
            <LoadingSurface label="도장 페이지를 불러오는 중" className="shrink-0 border-b px-3 py-3 sm:px-5 sm:py-4">
                <div className="space-y-4"><h1 className="text-xl font-semibold">맛집 도장</h1><p className="text-sm">새로운 맛집을 방문하고 도장을 모아보세요</p><div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">{["맛집 검색", "지역", "카테고리", "방문", "정렬"].map(text => <p key={text} className="rounded-md border px-3 py-3 text-sm">{text}</p>)}</div></div>
            </LoadingSurface>
            <div className="min-h-0 flex-1 px-4 pt-6 pb-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+1.5rem)] sm:px-6 md:pb-6"><StampGridSkeleton count={16} showHeader={false} className="p-0" /></div>
        </div>
    </div>;
}

function LeaderboardSkeletonComponent({ count = 8, showHeader = true, className, compactLeftPanel = false }: {
    count?: number; showHeader?: boolean; className?: string; compactLeftPanel?: boolean;
}) {
    const { ref, count: filledCount } = useFilledSkeletonCount(compactLeftPanel ? 52 : 56, count);
    return <div ref={ref} className={cn("w-full", className)}><LoadingPreview label="랭킹을 불러오는 중" kind="list" rows={filledCount} showHeader={showHeader} compact={compactLeftPanel} /></div>;
}

export const FeedSkeleton = memo(FeedSkeletonComponent);
export const StampGridSkeleton = memo(StampGridSkeletonComponent);
export const StampPageSkeleton = memo(StampPageSkeletonComponent);
export const LeaderboardSkeleton = memo(LeaderboardSkeletonComponent);
