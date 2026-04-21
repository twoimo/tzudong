type NaverPresenceEntry = {
    presence_ref?: string;
    user_id?: string;
};

export type NaverPresenceState = Record<string, unknown>;

export function getNaverPresenceIdentity({
    presence,
    presenceKey,
}: {
    presence: unknown;
    presenceKey: string;
}) {
    if (!presence || typeof presence !== 'object') {
        return presenceKey;
    }

    const typedPresence = presence as NaverPresenceEntry;
    return typedPresence.user_id || typedPresence.presence_ref || presenceKey;
}

export function countUniqueNaverPresenceUsers(state: NaverPresenceState) {
    const uniqueUserIds = new Set<string>();

    Object.entries(state).forEach(([presenceKey, presences]) => {
        if (!Array.isArray(presences)) return;

        presences.forEach((presence) => {
            uniqueUserIds.add(getNaverPresenceIdentity({ presence, presenceKey }));
        });
    });

    return uniqueUserIds.size;
}


export function resolveNaverOnlineToastDisplayPlan({
    hasExistingHideTimer,
    hideDelayMs = 4000,
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
