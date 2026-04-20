export function buildNaverResizeObserverHandler<TMap>({
    clearTimeoutFn = clearTimeout,
    delayMs = 320,
    requestAnimationFrameFn = globalThis.requestAnimationFrame
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : ((callback: FrameRequestCallback) => {
            return setTimeout(() => callback(0), 0) as unknown as number;
        }),
    runAfterTransition,
    setTimeoutFn = setTimeout,
    triggerResize,
}: {
    clearTimeoutFn?: (timeoutId: ReturnType<typeof setTimeout>) => void;
    delayMs?: number;
    requestAnimationFrameFn?: (callback: FrameRequestCallback) => number;
    runAfterTransition: () => void;
    setTimeoutFn?: typeof setTimeout;
    triggerResize: () => void;
}) {
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observerCallback = () => {
        if (resizeDebounceTimer) {
            clearTimeoutFn(resizeDebounceTimer);
        }

        triggerResize();

        resizeDebounceTimer = setTimeoutFn(() => {
            requestAnimationFrameFn(() => {
                runAfterTransition();
            });
            resizeDebounceTimer = null;
        }, delayMs);
    };

    const cancel = () => {
        if (resizeDebounceTimer) {
            clearTimeoutFn(resizeDebounceTimer);
            resizeDebounceTimer = null;
        }
    };

    return {
        cancel,
        observerCallback,
    };
}
