import { memo } from "react";
import { GlobalLoader } from "@/components/ui/global-loader";

function MapSkeletonComponent() {
    return (
        <GlobalLoader
            message="쯔동여지도 로딩 중..."
            subMessage="맛있는 발견을 준비하고 있습니다"
        />
    );
}

// [PERF] React.memo - props 없는 컴포넌트이지만 부모 리렌더링 시 불필요한 재생성 방지
export const MapSkeleton = memo(MapSkeletonComponent);
MapSkeleton.displayName = "MapSkeleton";
