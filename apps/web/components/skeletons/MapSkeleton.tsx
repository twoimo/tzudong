import { memo } from "react";

type MapSkeletonProps = {
    variant?: "embedded" | "fullscreen";
    message?: string;
    decorative?: boolean;
};

function MapSkeletonComponent({
    variant = "embedded",
    message = "지도 화면을 준비하고 있어요",
    decorative = false,
}: MapSkeletonProps) {
    const containerClassName = variant === "fullscreen"
        ? "fixed inset-0 z-50 h-[var(--full-height,100vh)] bg-background"
        : "relative h-full min-h-[320px] w-full overflow-hidden bg-background";

    return (
        <div
            role={decorative ? undefined : "status"}
            aria-label={decorative ? undefined : message}
            aria-live={decorative ? undefined : "polite"}
            aria-hidden={decorative ? true : undefined}
            className={containerClassName}
        >
            {!decorative && <span className="sr-only">{message}</span>}
        </div>
    );
}

// [PERF] React.memo - 동일 props로 재렌더링될 때 지도형 스켈레톤 재생성을 방지
export const MapSkeleton = memo(MapSkeletonComponent);
MapSkeleton.displayName = "MapSkeleton";
