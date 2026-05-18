export function MapViewLoadingIndicator() {
    return (
        <div
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/90 rounded-full px-3 py-2 shadow-sm flex items-center gap-2 z-10 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-busy="true"
        >
            <span className="h-2 w-2 rounded-full bg-primary/80" aria-hidden="true" />
            <span className="text-sm font-medium">맛집 핀 배치 중…</span>
        </div>
    );
}

export function MapViewRestaurantCountBadge({ count }: { count: number }) {
    return (
        <div
            className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/90 border border-border/60 rounded-lg px-4 py-2 shadow-sm z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 motion-reduce:animate-none"
            role="status"
            aria-live="polite"
        >
            <span className="text-sm font-medium">
                🔥 {count}개의 맛집 발견
            </span>
        </div>
    );
}
