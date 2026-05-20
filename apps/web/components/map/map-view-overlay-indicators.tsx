import { MapOverlayNotice } from '@/components/map/map-overlay-notice';

export function MapViewLoadingIndicator() {
    return (
        <MapOverlayNotice
            className="absolute top-4 left-1/2 -translate-x-1/2"
            ariaBusy
            icon={<span className="h-2 w-2 rounded-full bg-primary/80" />}
        >
            맛집 핀 배치 중…
        </MapOverlayNotice>
    );
}

export function MapViewRestaurantCountBadge({ count }: { count: number }) {
    return (
        <MapOverlayNotice
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-lg border border-border/60 animate-in fade-in zoom-in duration-300 motion-reduce:animate-none"
            icon="🔥"
        >
            {count}개의 맛집 발견
        </MapOverlayNotice>
    );
}
