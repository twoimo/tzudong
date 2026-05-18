import { memo } from "react";

type MapSkeletonProps = {
    variant?: "embedded" | "fullscreen";
    message?: string;
};

function MapSkeletonComponent({ variant = "embedded", message = "지도 화면을 준비하고 있어요" }: MapSkeletonProps) {
    const containerClassName = variant === "fullscreen"
        ? "fixed inset-0 z-50 h-[var(--full-height,100vh)] bg-background"
        : "relative h-full min-h-[320px] w-full overflow-hidden bg-background";

    return (
        <div
            role="status"
            aria-label={message}
            aria-live="polite"
            className={containerClassName}
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(239,68,68,0.08),transparent_32%),linear-gradient(0deg,rgba(248,250,252,0.96),rgba(255,255,255,0.96))]" aria-hidden="true" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[size:44px_44px]" aria-hidden="true" />
            <div className="absolute left-[18%] top-[26%] h-3 w-3 rounded-full bg-primary/45 shadow-[0_0_0_6px_rgba(239,68,68,0.12)]" aria-hidden="true" />
            <div className="absolute right-[22%] top-[38%] h-3 w-3 rounded-full bg-primary/35 shadow-[0_0_0_6px_rgba(239,68,68,0.10)]" aria-hidden="true" />
            <div className="absolute bottom-[30%] left-[42%] h-3 w-3 rounded-full bg-primary/30 shadow-[0_0_0_6px_rgba(239,68,68,0.08)]" aria-hidden="true" />
            <span className="sr-only">{message}</span>
        </div>
    );
}

// [PERF] React.memo - 동일 props로 재렌더링될 때 지도형 스켈레톤 재생성을 방지
export const MapSkeleton = memo(MapSkeletonComponent);
MapSkeleton.displayName = "MapSkeleton";
