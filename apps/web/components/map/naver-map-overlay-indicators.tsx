import { memo } from 'react';
import type { CSSProperties } from 'react';

import { MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME, MAP_OVERLAY_TOAST_CLASS_NAME, MapOverlayNotice, MapOverlayNoticeButton } from '@/components/map/map-overlay-notice';

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
    <MapOverlayNotice
        style={style}
        className={className}
        ariaBusy={isBusy}
        icon={<span className="h-2 w-2 rounded-full bg-primary/80" />}
    >
        {!isLoaded ? '지도 준비 중…' : '맛집 핀 배치 중…'}
    </MapOverlayNotice>
));
MapLoadingIndicator.displayName = 'MapLoadingIndicator';

export const RestaurantCountBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <MapOverlayNotice
        style={style}
        className={`animate-[fadeInOut_3s_ease-in-out_forwards] motion-reduce:animate-none ${className || ''}`}
        icon="🔥"
    >
        {count}개의 맛집 발견
    </MapOverlayNotice>
));
RestaurantCountBadge.displayName = 'RestaurantCountBadge';

export const OnlineUsersBadge = memo(({ count, style, className }: { count: number, style?: CSSProperties, className?: string }) => (
    <MapOverlayNotice
        style={style}
        className={`animate-[fadeInOut_4s_ease-in-out_forwards] motion-reduce:animate-none ${className || ''}`}
        icon="🔥"
    >
        {count}명이 함께 보는 중
    </MapOverlayNotice>
));
OnlineUsersBadge.displayName = 'OnlineUsersBadge';

export const AnnouncementToastBadge = memo(({ title, style, className, onClick }: { title: string; style?: CSSProperties; className?: string; onClick?: () => void }) => (
    <MapOverlayNoticeButton
        onClick={onClick}
        style={style}
        className={`mobile-map-announcement-toast animate-[fadeInOut_4s_ease-in-out_forwards] motion-reduce:animate-none ${className || ''}`}
        ariaLabel={`공지사항 열기: ${title}`}
        icon="📢"
        contentClassName={MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME}
    >
        {title}
    </MapOverlayNoticeButton>
));
AnnouncementToastBadge.displayName = 'AnnouncementToastBadge';

export const EmptyStateIndicator = memo(({ message = '이 지역에 등록된 맛집이 없습니다' }: { message?: string }) => (
    <MapOverlayNotice className={`${MAP_OVERLAY_TOAST_CLASS_NAME} animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none`}>
        {message}
    </MapOverlayNotice>
));
EmptyStateIndicator.displayName = 'EmptyStateIndicator';
