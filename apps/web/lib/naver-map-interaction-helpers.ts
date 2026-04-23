export const NAVER_INTERACTION_LISTENER_OPTIONS: AddEventListenerOptions = {
    capture: true,
    passive: true,
};

export const NAVER_INTERACTION_REMOVE_OPTIONS: EventListenerOptions = {
    capture: true,
};

type NaverInteractionHandlerKey = 'searchRelease' | 'userInteraction';

export function buildNaverMapInteractionListenerPlan() {
    return {
        domListeners: [
            { eventName: 'wheel', handlerKey: 'searchRelease' },
            { eventName: 'dblclick', handlerKey: 'searchRelease' },
            { eventName: 'mousedown', handlerKey: 'userInteraction' },
            { eventName: 'touchstart', handlerKey: 'userInteraction' },
        ] as Array<{ eventName: keyof HTMLElementEventMap; handlerKey: NaverInteractionHandlerKey }>,
        mapEventNames: ['dragstart', 'pinchstart'] as const,
    };
}

export function buildNaverMapInteractionHandlers({
    hasUserMovedMapRef,
    releaseSearchSelectionOnUserInteraction,
}: {
    hasUserMovedMapRef: { current: boolean };
    releaseSearchSelectionOnUserInteraction: () => void;
}) {
    const handleUserInteraction = () => {
        hasUserMovedMapRef.current = true;
    };

    const handleSearchReleaseInteraction = () => {
        handleUserInteraction();
        releaseSearchSelectionOnUserInteraction();
    };

    return {
        handleSearchReleaseInteraction,
        handleUserInteraction,
    };
}
