import { memo } from "react";

function MapSkeletonComponent() {
    return (
        <div
            role="status"
            aria-label="쯔동여지도 로딩 중"
            aria-live="polite"
            className="fixed inset-0 z-50 h-[var(--full-height,100vh)] bg-background"
        >
            <div className="h-full w-full animate-pulse bg-muted/40" aria-hidden="true" />
            <span className="sr-only">쯔동여지도 로딩 중...</span>
        </div>
    );
}

// [PERF] React.memo - props 없는 컴포넌트이지만 부모 리렌더링 시 불필요한 재생성 방지
export const MapSkeleton = memo(MapSkeletonComponent);
MapSkeleton.displayName = "MapSkeleton";
