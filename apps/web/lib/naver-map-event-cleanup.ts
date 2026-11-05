/** Provider teardown can fail after an SDK/auth failure; local cleanup must still finish. */
export function removeNaverMapListener<T>(
    events: { removeListener: (listener: T) => unknown } | null | undefined,
    listener: T | null | undefined,
): boolean {
    if (!events || listener == null) return false;
    try {
        events.removeListener(listener);
        return true;
    } catch {
        // Teardown only: do not let an invalid provider registry abort other cleanup.
        return false;
    }
}

/** A provider may retain an idle handler even when removal fails. */
export function createNaverOneShotCallback(callback: () => void) {
    let active = true;
    return {
        handle() {
            if (!active) return;
            active = false;
            callback();
        },
        cancel() { active = false; },
    };
}

export function createNaverCancellableCallback(callback: () => void) {
    let active = true;
    return {
        handle() { if (active) callback(); },
        cancel() { active = false; },
    };
}

/** Failed SDK instances must be discarded rather than returned to the marker pool. */
export function detachNaverMapMarker(marker: { setMap: (map: null) => void } | null | undefined): boolean {
    if (!marker) return false;
    try {
        marker.setMap(null);
        return true;
    } catch {
        return false;
    }
}

/** Remove the app-owned location visual immediately; retain failed SDK handles for retry. */
export function clearNaverDeviceLocationMarker<T extends { setMap: (map: null) => void }>(
    marker: T | null,
    removeVisual: () => void,
): T | null {
    const detached = detachNaverMapMarker(marker);
    removeVisual();
    return detached ? null : marker;
}
