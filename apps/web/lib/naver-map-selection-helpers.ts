export function resolveNaverSelectionChange({
    currentSelectedId,
    previousSelectedId,
}: {
    currentSelectedId: string | null;
    previousSelectedId: string | null;
}) {
    const isSelectionChanged = currentSelectedId !== previousSelectedId;

    return {
        isSelectionChanged,
        nextSelectedId: currentSelectedId,
    };
}
