export function buildResetUserMapMovementHandler(hasUserMovedMapRef: { current: boolean }) {
    return () => {
        hasUserMovedMapRef.current = false;
    };
}
