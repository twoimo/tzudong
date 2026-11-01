let pending: Promise<typeof import('@/components/map/NaverMapView')> | undefined;

export function loadNaverMap() {
    if (!pending) {
        pending = import('@/components/map/NaverMapView').catch((error: unknown) => {
            pending = undefined;
            throw error;
        });
    }
    return pending;
}

// Fetch the code alongside the home container. The existing loader still owns
// the SDK and the rendered component owns the single map instance.
export function preloadNaverMap() {
    void loadNaverMap().catch(() => undefined);
}
