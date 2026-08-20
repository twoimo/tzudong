import {
    NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS,
    NAVER_MAP_TOAST_HIDE_DELAY_MS,
} from '@/lib/naver-map-overlay-timings';

type MapToast = {
    message: string;
    type: 'success' | 'error' | 'info';
    isVisible: boolean;
} | null;

export type NaverMapToastTrigger = ((
    message: string,
    type?: 'success' | 'error' | 'info',
) => void) & {
    activate: () => void;
    dismiss: () => void;
    dispose: () => void;
};

export function buildNaverMapToastTrigger(
    setMapToast: (value: MapToast | ((prev: MapToast) => MapToast)) => void,
    {
        hideDelayMs = NAVER_MAP_TOAST_HIDE_DELAY_MS,
        clearTimeoutFn = clearTimeout,
        setTimeoutFn = setTimeout,
    }: {
        hideDelayMs?: number;
        clearTimeoutFn?: typeof clearTimeout;
        setTimeoutFn?: typeof setTimeout;
    } = {},
): NaverMapToastTrigger {
    let activeTimeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let version = 0;

    const clearActiveTimeout = () => {
        if (activeTimeout === null) return;
        clearTimeoutFn(activeTimeout);
        activeTimeout = null;
    };

    const trigger = ((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        if (disposed) return;
        version += 1;
        const scheduledVersion = version;
        clearActiveTimeout();
        setMapToast({ message, type, isVisible: true });

        activeTimeout = setTimeoutFn(() => {
            if (disposed || version !== scheduledVersion) return;
            activeTimeout = null;
            setMapToast(prev => prev ? { ...prev, isVisible: false } : null);
        }, hideDelayMs);
    }) as NaverMapToastTrigger;

    trigger.activate = () => {
        disposed = false;
    };
    trigger.dismiss = () => {
        if (disposed) return;
        version += 1;
        clearActiveTimeout();
        setMapToast(prev => prev ? { ...prev, isVisible: false } : null);
    };
    trigger.dispose = () => {
        if (disposed) return;
        disposed = true;
        version += 1;
        clearActiveTimeout();
    };
    return trigger;
}

export function resolveNaverAnnouncementToastPlan<TAnnouncement extends { id: string; title: string }>({
    announcements,
    currentIndex,
    hideDelayMs = NAVER_MAP_ANNOUNCEMENT_HIDE_DELAY_MS,
}: {
    announcements: TAnnouncement[];
    currentIndex: number;
    hideDelayMs?: number;
}) {
    if (announcements.length === 0) {
        return {
            announcement: null,
            hideDelayMs,
            nextIndex: 0,
            shouldShow: false,
        } as const;
    }

    const normalizedIndex = currentIndex % announcements.length;
    const announcement = announcements[normalizedIndex] ?? null;

    return {
        announcement,
        hideDelayMs,
        nextIndex: (normalizedIndex + 1) % announcements.length,
        shouldShow: Boolean(announcement),
    } as const;
}

export function resolveNaverAnnouncementToastInactivePlan({
    hasHideTimer,
    hasInitialTimer,
}: {
    hasHideTimer: boolean;
    hasInitialTimer: boolean;
}) {
    return {
        nextTitle: '',
        shouldClearHideTimer: hasHideTimer,
        shouldClearInitialTimer: hasInitialTimer,
        shouldShowAnnouncementToast: false,
    } as const;
}

export function resolveNaverAnnouncementToastSchedulePlan({
    hasExistingInitialTimer,
    initialDelayMs = 0,
    intervalMs,
}: {
    hasExistingInitialTimer: boolean;
    initialDelayMs?: number;
    intervalMs: number;
}) {
    return {
        initialDelayMs,
        intervalMs,
        shouldClearExistingInitialTimer: hasExistingInitialTimer,
    } as const;
}

export function resolveNaverAnnouncementToastCleanupPlan({
    hasHideTimer,
    hasInitialTimer,
}: {
    hasHideTimer: boolean;
    hasInitialTimer: boolean;
}) {
    return {
        shouldClearHideTimer: hasHideTimer,
        shouldClearInitialTimer: hasInitialTimer,
        shouldClearInterval: true,
    } as const;
}

export function resolveNaverAnnouncementToastClickPlan<TAnnouncement extends { id: string }>({
    announcementToastId,
    announcements,
}: {
    announcementToastId: string | null;
    announcements: TAnnouncement[];
}) {
    if (!announcementToastId) {
        return {
            targetAnnouncement: null,
            shouldDispatch: false,
        } as const;
    }

    const targetAnnouncement = announcements.find((announcement) => announcement.id === announcementToastId) ?? null;

    return {
        targetAnnouncement,
        shouldDispatch: Boolean(targetAnnouncement),
    } as const;
}
