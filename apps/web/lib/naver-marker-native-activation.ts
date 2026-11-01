const NATIVE_MARKER_BUTTON = 'button.tzudong-individual-marker[data-testid="marker"], button.cluster-marker-container';

/** Naver's pointer listener does not forward native keyboard/assistive clicks. */
export function bindNaverMarkerNativeActivation(
    map: unknown,
    resolveCurrentCallback: (button: Element) => ((event: MouseEvent) => void) | undefined,
): (() => void) | null {
    let root: HTMLElement | undefined;
    try {
        root = (map as { getElement?: () => HTMLElement } | null)?.getElement?.();
    } catch {
        return null;
    }
    if (!root || typeof root.addEventListener !== 'function' || typeof root.contains !== 'function') return null;
    const mapRoot = root;
    let active = true;
    const handle = (event: MouseEvent) => {
        // Real pointer clicks remain owned by the SDK. Native Enter/Space and
        // assistive activation produce click detail=0 without a pointer sequence.
        if (!active || event.detail !== 0) return;
        const target = event.target as Element | null;
        const button = target?.closest?.(NATIVE_MARKER_BUTTON);
        if (!button || !mapRoot.isConnected || !button.isConnected || !mapRoot.contains(button)
            || button.matches(':disabled')
            || button.closest('[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"]')) return;
        const callback = resolveCurrentCallback(button);
        if (!callback) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        callback(event);
    };
    mapRoot.addEventListener('click', handle, true);
    return () => {
        if (!active) return;
        active = false;
        try {
            mapRoot.removeEventListener('click', handle, true);
        } catch {
            // Cancellation still removes authority when provider teardown fails.
        }
    };
}
