import { memo } from 'react';
import type { CSSProperties } from 'react';

export const MapLoadingIndicator = memo(({ isLoaded, style, className }: { isLoaded: boolean, style?: CSSProperties, className?: string }) => (
    <div
        style={style}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 ${className || ''}`}
    >
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
        <span className="text-sm font-medium">
            {!isLoaded ? '지도 로딩 중...' : '맛집 검색 중...'}
        </span>
    </div>
));
MapLoadingIndicator.displayName = 'MapLoadingIndicator';

export const RestaurantCountBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <div
        style={{ ...style, animation: 'fadeInOut 3s ease-in-out forwards' }}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 ${className || ''}`}
    >
        <span className="text-sm font-medium">
            🔥 {count}개의 맛집 발견
        </span>
    </div>
));
RestaurantCountBadge.displayName = 'RestaurantCountBadge';

export const OnlineUsersBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <div
        style={{ ...style, animation: 'fadeInOut 4s ease-in-out forwards' }}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 ${className || ''}`}
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
        style={{ ...style, animation: 'fadeInOut 4s ease-in-out forwards' }}
        className={`bg-card border border-border rounded-lg px-4 py-2 shadow-lg z-10 flex items-center gap-2 animate-in fade-in zoom-in duration-300 ${onClick ? 'cursor-pointer hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2' : ''} ${className || ''}`}
        aria-label={`공지사항 열기: ${title}`}
    >
        <span className="text-sm font-medium truncate max-w-[min(80vw,28rem)]">
            📢 {title}
        </span>
    </button>
));
AnnouncementToastBadge.displayName = 'AnnouncementToastBadge';

export const EmptyStateIndicator = memo(() => (
    <div className="bg-card/95 backdrop-blur border border-border rounded-lg px-5 py-3 shadow-lg z-10 flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">
            이 지역에 등록된 맛집이 없습니다
        </span>
    </div>
));
EmptyStateIndicator.displayName = 'EmptyStateIndicator';
