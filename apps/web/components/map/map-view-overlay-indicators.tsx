import { Loader2 } from 'lucide-react';

export function MapViewLoadingIndicator() {
    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-2 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm font-medium">맛집 로딩 중...</span>
        </div>
    );
}

export function MapViewRestaurantCountBadge({ count }: { count: number }) {
    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300">
            <span className="text-sm font-medium">
                🔥 {count}개의 맛집 발견
            </span>
        </div>
    );
}
