type MapToast = {
    message: string;
    type: 'success' | 'error' | 'info';
    isVisible: boolean;
} | null;

export function buildNaverMapToastTrigger(
    setMapToast: (value: MapToast | ((prev: MapToast) => MapToast)) => void,
) {
    return (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setMapToast({ message, type, isVisible: true });

        setTimeout(() => {
            setMapToast(prev => prev ? { ...prev, isVisible: false } : null);
        }, 3000);
    };
}

export function resolveNaverAnnouncementToastPlan<TAnnouncement extends { id: string; title: string }>({
    announcements,
    currentIndex,
    hideDelayMs = 4200,
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
    initialDelayMs = 9000,
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
