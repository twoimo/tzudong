type WidthEntryLike = {
    contentRect: {
        width: number;
    };
};

export function buildNaverPanelWidthObserver({
    cancelAnimationFrameFn = cancelAnimationFrame,
    requestAnimationFrameFn = requestAnimationFrame,
    setPanelWidth,
}: {
    cancelAnimationFrameFn?: (handle: number) => void;
    requestAnimationFrameFn?: (callback: FrameRequestCallback) => number;
    setPanelWidth: (width: number) => void;
}) {
    let rafId: number | null = null;

    const observerCallback = (entries: WidthEntryLike[]) => {
        if (rafId !== null) {
            cancelAnimationFrameFn(rafId);
        }

        rafId = requestAnimationFrameFn(() => {
            for (const entry of entries) {
                setPanelWidth(entry.contentRect.width);
            }
            rafId = null;
        });
    };

    const cancelPending = () => {
        if (rafId !== null) {
            cancelAnimationFrameFn(rafId);
            rafId = null;
        }
    };

    return {
        cancelPending,
        observerCallback,
    };
}
