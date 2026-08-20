import { MapOverlayNotice } from '@/components/map/map-overlay-notice';

export function MapViewLoadingIndicator() {
    return (
        <MapOverlayNotice className="absolute top-4 left-1/2 -translate-x-1/2" ariaBusy>
            맛집 핀 배치 중…
        </MapOverlayNotice>
    );
}

export function MapViewRestaurantCountBadge({ count }: { count: number }) {
    return (
        <MapOverlayNotice className="absolute top-4 left-1/2 -translate-x-1/2 animate-in fade-in zoom-in duration-300 motion-reduce:animate-none">
            {count}개의 맛집 발견
        </MapOverlayNotice>
    );
}
