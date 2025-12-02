import { GlobalLoader } from "@/components/ui/global-loader";

export function MapSkeleton() {
    return (
        <GlobalLoader
            message="쯔동여지도 로딩 중..."
            subMessage="맛있는 발견을 준비하고 있습니다"
        />
    );
}
