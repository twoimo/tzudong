import { afterEach, describe, expect, test } from 'bun:test';

import {
    HOME_DETAIL_HISTORY_STATE_KIND,
    HOME_LIST_HISTORY_STATE_KIND,
    HOME_RESTORE_SNAPSHOT_MAX_BYTES,
    HOME_RESTORE_SNAPSHOT_TTL_MS,
    buildHomeDetailState,
    buildHomeDetailUrl,
    buildHomeListState,
    dispatchHomeRestoreEvent,
    isHomeDetailHistoryState,
    isHomeListHistoryState,
    readHomeRestoreSnapshot,
    writeHomeRestoreSnapshot,
    type HomeRestoreSnapshotV1,
} from '../lib/home-detail-route-state';

class MemoryStorage implements Storage {
    private values = new Map<string, string>();

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    key(index: number) {
        return Array.from(this.values.keys())[index] ?? null;
    }

    removeItem(key: string) {
        this.values.delete(key);
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }
}

const installSessionStorage = () => {
    const storage = new MemoryStorage();
    const eventTarget = new EventTarget();
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            sessionStorage: storage,
            addEventListener: eventTarget.addEventListener.bind(eventTarget),
            removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
            dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
        },
    });
    return storage;
};

afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
});

const makeSnapshot = (createdAt = 1_000): HomeRestoreSnapshotV1 => ({
    version: 1,
    createdAt,
    mapMode: 'domestic',
    selectedRestaurantId: 'restaurant-1',
    panelRestaurantId: 'restaurant-1',
    searchedRestaurantId: 'restaurant-1',
    searchedRestaurant: { id: 'restaurant-1', name: '분식집', lat: 37.5, lng: 127 },
    filters: { categories: ['분식'], featuredTheme: null },
    selectedRegion: '서울특별시',
    selectedCountry: '헝가리(부다페스트)',
    activePanel: 'control',
    activeRightPanel: null,
    isPanelCollapsed: true,
    isAnnouncementSheetOpen: false,
    contextualRestaurantIds: ['restaurant-1', 'restaurant-2'],
});

describe('home detail route state contracts', () => {
    test('locks snapshot TTL and max size to the approved contract', () => {
        expect(HOME_RESTORE_SNAPSHOT_TTL_MS).toBe(30 * 60 * 1000);
        expect(HOME_RESTORE_SNAPSHOT_MAX_BYTES).toBe(8 * 1024);
    });
    test('canonical detail URL includes restaurant, mapMode, restore, optional z, and no legacy r', () => {
        const url = buildHomeDetailUrl({
            restaurantId: 'abc 123',
            mapMode: 'overseas',
            restoreKey: 'restore-1',
            focusZoom: 13,
        });
        const parsed = new URL(url, 'https://example.test');

        expect(parsed.pathname).toBe('/');
        expect(parsed.searchParams.get('restaurant')).toBe('abc 123');
        expect(parsed.searchParams.get('mapMode')).toBe('overseas');
        expect(parsed.searchParams.get('restore')).toBe('restore-1');
        expect(parsed.searchParams.get('z')).toBe('13');
        expect(parsed.searchParams.has('r')).toBe(false);
    });

    test('type guards accept only app-owned detail and list history state shapes', () => {
        const detailState = buildHomeDetailState({
            restaurantId: 'restaurant-1',
            mapMode: 'domestic',
            restoreKey: 'restore-1',
            createdAt: 1,
        });
        const listState = buildHomeListState({
            restaurantId: 'restaurant-1',
            mapMode: 'domestic',
            restoreKey: 'restore-1',
            createdAt: 1,
        });

        expect(isHomeDetailHistoryState(detailState)).toBe(true);
        expect(isHomeListHistoryState(listState)).toBe(true);
        expect(isHomeDetailHistoryState({ ...detailState, kind: HOME_LIST_HISTORY_STATE_KIND })).toBe(false);
        expect(isHomeListHistoryState({ ...listState, kind: HOME_DETAIL_HISTORY_STATE_KIND })).toBe(false);
        expect(isHomeDetailHistoryState({ ...detailState, mapMode: 'legacy' })).toBe(false);
        expect(isHomeListHistoryState({ ...listState, restoreKey: null })).toBe(false);
    });

    test('snapshot write/read enforces TTL and 8KB cap', () => {
        installSessionStorage();
        const snapshot = makeSnapshot(10_000);

        expect(writeHomeRestoreSnapshot('restore-ok', snapshot)).toBe(true);
        expect(readHomeRestoreSnapshot('restore-ok', 10_000 + HOME_RESTORE_SNAPSHOT_TTL_MS).snapshot).toEqual(snapshot);
        expect(readHomeRestoreSnapshot('restore-ok', 10_001 + HOME_RESTORE_SNAPSHOT_TTL_MS)).toMatchObject({
            snapshot: null,
            reason: 'expired',
        });

        const oversizedSnapshot = {
            ...snapshot,
            contextualRestaurantIds: ['x'.repeat(HOME_RESTORE_SNAPSHOT_MAX_BYTES)],
        };
        expect(writeHomeRestoreSnapshot('restore-big', oversizedSnapshot)).toBe(false);
        expect(readHomeRestoreSnapshot('restore-big')).toMatchObject({
            snapshot: null,
            reason: 'missing',
        });
    });

    test('dispatches failed restore instrumentation with reason metadata', () => {
        installSessionStorage();
        const events: Array<{ restoreKey: string; reason?: string }> = [];
        window.addEventListener('home.restore.failed', (event) => {
            events.push(event instanceof CustomEvent ? event.detail : {});
        });

        dispatchHomeRestoreEvent('home.restore.failed', {
            restoreKey: 'restore-expired',
            reason: 'expired',
        });

        expect(events).toEqual([{ restoreKey: 'restore-expired', reason: 'expired' }]);
    });
});
