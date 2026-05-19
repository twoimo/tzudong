export const HOME_MAP_AUTO_ACTIVATION_DELAY_MS = 0;

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
    isEmbeddedHomeRuntime?: boolean;
};

type HomeMapActivationPlan = {
    activateImmediately: boolean;
    delayMs: number;
    events: readonly HomeMapActivationEvent[];
};

const IMMEDIATE_SEARCH_PARAMS = new Set([
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

export function isEmbeddedHomeRuntimeWindow() {
    if (typeof window === 'undefined') return false;

    try {
        return window.self !== window.top;
    } catch (_) {
        return true;
    }
}

export function buildHomeMapActivationPlan(_input: HomeMapActivationInput): HomeMapActivationPlan {
    return {
        activateImmediately: true,
        delayMs: HOME_MAP_AUTO_ACTIVATION_DELAY_MS,
        events: [],
    };
}
