import { preconnect } from 'react-dom';
import { OVERSEAS_MAP_RESOURCE_ORIGIN } from '@/lib/overseas-map-provider';

let pending: Promise<typeof import('@/components/map/OverseasMap')> | undefined;

export function loadOverseasMap() {
    if (!pending) {
        pending = import('@/components/map/OverseasMap').catch((error: unknown) => {
            pending = undefined;
            throw error;
        });
    }
    return pending;
}

// Only prepare code and a connection on user intent; do not prefetch map areas
// or mount a second map/WebGL context behind the domestic map.
export function preloadOverseasMap() {
    preconnect(OVERSEAS_MAP_RESOURCE_ORIGIN, { crossOrigin: 'anonymous' });
    void loadOverseasMap().catch(() => undefined);
}
