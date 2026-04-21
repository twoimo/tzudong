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
