import { NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS } from '@/lib/naver-map-overlay-timings';

export function resolveNaverOnlineToastDisplayPlan({
    hasExistingHideTimer,
    hideDelayMs = NAVER_MAP_ONLINE_USERS_HIDE_DELAY_MS,
}: {
    hasExistingHideTimer: boolean;
    hideDelayMs?: number;
}) {
    return {
        hideDelayMs,
        shouldClearExistingHideTimer: hasExistingHideTimer,
        shouldShowOnlineUsers: true,
    } as const;
}

export function resolveNaverInitialOnlineToastPlan({
    hasShownInitialToast,
    initialDelayMs = 5000,
    hasExistingInitialTimer = false,
}: {
    hasShownInitialToast: boolean;
    initialDelayMs?: number;
    hasExistingInitialTimer?: boolean;
}) {
    return {
        initialDelayMs,
        nextHasShownInitialToast: true,
        shouldClearExistingInitialTimer: !hasShownInitialToast && hasExistingInitialTimer,
        shouldScheduleInitialToast: !hasShownInitialToast,
    } as const;
}
