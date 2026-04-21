export function buildNaverWindowResizeHandler<TMap>({
    clearTimeoutFn = clearTimeout,
    delayMs = 100,
    getMap,
    setTimeoutFn = setTimeout,
    triggerResize,
}: {
    clearTimeoutFn?: (timeoutId: ReturnType<typeof setTimeout>) => void;
    delayMs?: number;
    getMap: () => TMap | null;
    setTimeoutFn?: typeof setTimeout;
    triggerResize: (map: TMap) => void;
}) {
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWindowResize = () => {
        if (resizeTimer) {
            clearTimeoutFn(resizeTimer);
        }

        resizeTimer = setTimeoutFn(() => {
            const map = getMap();
            if (map) {
                triggerResize(map);
            }
            resizeTimer = null;
        }, delayMs);
    };

    const cancel = () => {
        if (resizeTimer) {
            clearTimeoutFn(resizeTimer);
            resizeTimer = null;
        }
    };

    return {
        cancel,
        handleWindowResize,
    };
}

export function buildNaverWindowResizeCleanup({
    cancel,
    handleWindowResize,
    removeWindowResizeListener,
}: {
    cancel: () => void;
    handleWindowResize: () => void;
    removeWindowResizeListener: (handler: () => void) => void;
}) {
    return () => {
        removeWindowResizeListener(handleWindowResize);
        cancel();
    };
}
