export const NAVER_INTERACTION_LISTENER_OPTIONS: AddEventListenerOptions = {
    capture: true,
    passive: true,
};

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
