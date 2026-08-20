import { memo } from 'react';

import { MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME, MapOverlayNotice, MapOverlayNoticeButton } from '@/components/map/map-overlay-notice';
import { NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES } from '@/lib/naver-map-overlay-timings';

export const MapLoadingIndicator = memo(({
    isLoaded,
    isBusy = !isLoaded,
}: {
    isLoaded: boolean;
    isBusy?: boolean;
}) => (
    <MapOverlayNotice ariaBusy={isBusy}>
        {!isLoaded ? '지도 준비 중…' : '맛집 핀 배치 중…'}
    </MapOverlayNotice>
));
MapLoadingIndicator.displayName = 'MapLoadingIndicator';

export const RestaurantCountBadge = memo(({ count }: { count: number }) => (
    <MapOverlayNotice className={NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.restaurantCount}>
        {count}개의 맛집 발견
    </MapOverlayNotice>
));
RestaurantCountBadge.displayName = 'RestaurantCountBadge';

export const OnlineUsersBadge = memo(({ count }: { count: number }) => (
    <MapOverlayNotice className={NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.onlineUsers}>
        {count}명이 함께 보는 중
    </MapOverlayNotice>
));
OnlineUsersBadge.displayName = 'OnlineUsersBadge';

export const AnnouncementToastBadge = memo(({ title, onClick }: { title: string; onClick?: () => void }) => (
    <MapOverlayNoticeButton
        onClick={onClick}
        className={`pointer-events-auto mobile-map-announcement-toast ${NAVER_MAP_OVERLAY_ANIMATION_CLASS_NAMES.announcement}`}
        ariaLabel={`공지사항 열기: ${title}`}
        contentClassName={MAP_OVERLAY_NOTICE_SINGLE_LINE_CLASS_NAME}
    >
        {title}
    </MapOverlayNoticeButton>
));
AnnouncementToastBadge.displayName = 'AnnouncementToastBadge';

export const EmptyStateIndicator = memo(({ message = '이 지역에 등록된 맛집이 없습니다' }: { message?: string }) => (
    <MapOverlayNotice>
        {message}
    </MapOverlayNotice>
));
EmptyStateIndicator.displayName = 'EmptyStateIndicator';
