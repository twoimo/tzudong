import { type Page } from '@playwright/test';
import { installMobileHomeMapTestMocks, waitForMockMapReady } from './mobile-home-map-helpers';
import { hidePopupOverlay } from './helpers';

type Outcome = 'success' | 'hold' | 'denied' | 'timeout';
type Probe = {
    getCalls: number;
    watchCalls: number;
    clearCalls: number;
    resolve: (index: number) => void;
    reject: (index: number, code: number) => void;
};
export type DeviceLocationTestWindow = Window & { __deviceLocationProbe: Probe };

export async function installDeviceLocationMocks(page: Page, outcome: Outcome = 'success') {
    await installMobileHomeMapTestMocks(page, { countMapCreations: true });
    await page.route('**/__local/naver-maps.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    // A mode-change cancellation test needs no external map/tile traffic.
    await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) }));
    let readinessCalls = 0;
    await page.route('**/api/privacy/location-readiness', route => {
        readinessCalls++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'available', reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' }) });
    });
    await page.addInitScript((mode: Outcome) => {
        const pending: Array<{ success: PositionCallback; failure?: PositionErrorCallback | null }> = [];
        // Public city-centre fixture coordinates, never the user's GPS.
        const position = () => ({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 10, heading: null, altitude: null, altitudeAccuracy: null, speed: null }, timestamp: Date.now() }) as GeolocationPosition;
        const probe: Probe = {
            getCalls: 0, watchCalls: 0, clearCalls: 0,
            resolve: index => pending[index]?.success(position()),
            reject: (index, code) => pending[index]?.failure?.({ code } as GeolocationPositionError),
        };
        (window as unknown as DeviceLocationTestWindow).__deviceLocationProbe = probe;
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
            getCurrentPosition(success: PositionCallback, failure?: PositionErrorCallback) {
                const index = pending.push({ success, failure }) - 1;
                probe.getCalls++;
                if (mode === 'hold') return;
                queueMicrotask(() => {
                    if (index === 0 && mode === 'denied') probe.reject(index, 1);
                    else if (index === 0 && mode === 'timeout') probe.reject(index, 3);
                    else probe.resolve(index);
                });
            },
            watchPosition() { return ++probe.watchCalls; },
            clearWatch() { probe.clearCalls++; },
        } });
    }, outcome);
    return { readinessCalls: () => readinessCalls };
}

export async function openDeviceLocationPage(page: Page) {
    await page.goto('/');
    await hidePopupOverlay(page);
    await waitForMockMapReady(page);
}

export function readDeviceLocationCounts(page: Page) {
    return page.evaluate(() => {
        const { getCalls, watchCalls, clearCalls } = (window as unknown as DeviceLocationTestWindow).__deviceLocationProbe;
        return { getCalls, watchCalls, clearCalls };
    });
}
