type WidthEntryLike = {
    contentRect: {
        width: number;
    };
};

export function buildMapViewPanelWidthObserver({
    setPanelWidth,
}: {
    setPanelWidth: (width: number) => void;
}) {
    const observerCallback = (entries: WidthEntryLike[]) => {
        for (const entry of entries) {
            setPanelWidth(entry.contentRect.width);
        }
    };

    return {
        observerCallback,
    };
}
