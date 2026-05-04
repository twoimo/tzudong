export const HOME_MAP_AUTO_ACTIVATION_DELAY_MS = 8000;

export const HOME_MAP_ACTIVATION_EVENTS = [
    'pointerdown',
    'keydown',
    'wheel',
    'touchstart',
] as const;

type HomeMapActivationEvent = typeof HOME_MAP_ACTIVATION_EVENTS[number];

type HomeMapActivationInput = {
    search: string;
    hash?: string;
};

type HomeMapActivationPlan = {
    activateImmediately: boolean;
    delayMs: number;
    events: readonly HomeMapActivationEvent[];
};

const IMMEDIATE_SEARCH_PARAMS = new Set([
    'r',
    'restaurant',
    'panel',
    'announcementId',
    'reviewId',
]);

const IMMEDIATE_HASHES = new Set([
    '#map',
    '#restaurant',
    '#announcement',
]);

export function shouldActivateHomeMapImmediately({ search, hash = '' }: HomeMapActivationInput) {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

    for (const param of IMMEDIATE_SEARCH_PARAMS) {
        if (params.has(param)) return true;
    }

    return IMMEDIATE_HASHES.has(hash);
}

export function buildHomeMapActivationPlan(input: HomeMapActivationInput): HomeMapActivationPlan {
    return {
        activateImmediately: shouldActivateHomeMapImmediately(input),
        delayMs: HOME_MAP_AUTO_ACTIVATION_DELAY_MS,
        events: HOME_MAP_ACTIVATION_EVENTS,
    };
}
