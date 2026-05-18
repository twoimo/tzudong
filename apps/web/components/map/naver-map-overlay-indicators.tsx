import { memo } from 'react';
import type { CSSProperties } from 'react';

export const MapLoadingIndicator = memo(({
    isLoaded,
    isBusy = !isLoaded,
    style,
    className,
}: {
    isLoaded: boolean;
    isBusy?: boolean;
    style?: CSSProperties;
    className?: string;
}) => (
    <div
        style={style}
        className={`bg-card/90 rounded-full px-3 py-2 shadow-sm z-10 flex items-center gap-2 backdrop-blur-sm ${className || ''}`}
        role="status"
        aria-live="polite"
        aria-busy={isBusy}
    >
        <span className="h-2 w-2 rounded-full bg-primary/80" aria-hidden="true" />
        <span className="text-sm font-medium">
            {!isLoaded ? '지도 준비 중…' : '맛집 핀 배치 중…'}
        </span>
    </div>
));
MapLoadingIndicator.displayName = 'MapLoadingIndicator';

export const RestaurantCountBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <div
        style={style}
        className={`bg-card/90 rounded-full px-3 py-2 shadow-sm z-10 flex items-center gap-2 backdrop-blur-sm animate-[fadeInOut_3s_ease-in-out_forwards] motion-reduce:animate-none ${className || ''}`}
        role="status"
        aria-live="polite"
    >
        <span className="text-sm font-medium">
            🔥 {count}개의 맛집 발견
        </span>
    </div>
));
RestaurantCountBadge.displayName = 'RestaurantCountBadge';

export const OnlineUsersBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <div
        style={style}
        className={`bg-card/90 rounded-full px-3 py-2 shadow-sm z-10 flex items-center gap-2 backdrop-blur-sm animate-[fadeInOut_4s_ease-in-out_forwards] motion-reduce:animate-none ${className || ''}`}
        role="status"
        aria-live="polite"
    >
        <span className="text-sm font-medium">
            🔥 {count}명이 함께 보는 중
        </span>
    </div>
));
OnlineUsersBadge.displayName = 'OnlineUsersBadge';

export const AnnouncementToastBadge = memo(({ title, style, className, onClick }: { title: string; style?: CSSProperties; className?: string; onClick?: () => void }) => (
    <button
        type="button"
        onClick={onClick}
        style={style}
        className={`bg-card/90 rounded-full px-3 py-2 shadow-sm z-10 flex items-center gap-2 backdrop-blur-sm animate-[fadeInOut_4s_ease-in-out_forwards] motion-reduce:animate-none ${onClick ? 'cursor-pointer hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : ''} ${className || ''}`}
        aria-label={`공지사항 열기: ${title}`}
    >
        <span className="text-sm font-medium truncate max-w-[min(80vw,28rem)]">
            📢 {title}
        </span>
    </button>
));
AnnouncementToastBadge.displayName = 'AnnouncementToastBadge';

export const EmptyStateIndicator = memo(() => (
    <div className="bg-card/95 backdrop-blur border border-border/60 rounded-lg px-5 py-3 shadow-sm z-10 flex items-center gap-3" role="status" aria-live="polite">
        <span className="text-sm font-medium text-muted-foreground">
            이 지역에 등록된 맛집이 없습니다
        </span>
    </div>
));
EmptyStateIndicator.displayName = 'EmptyStateIndicator';
