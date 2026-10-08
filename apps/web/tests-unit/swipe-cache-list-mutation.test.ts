import { describe, expect, test } from 'bun:test';
import type { Restaurant } from '../types/restaurant';
import { buildPostSearchSwipeCandidates, getSwipeSelectionCacheState } from '../lib/mobile-home-search-selection';

const row = (id: string, fields: Partial<Restaurant> = {}) => ({
    id, name: id, lat: 37.5, lng: 127, category: ['한식'], ...fields,
} as Restaurant);
const order = (visible: Restaurant[], search: Restaurant | null, all = visible) =>
    buildPostSearchSwipeCandidates({ visibleRestaurants: visible, allRestaurants: all, activeSearchedRestaurant: search });
const ids = (rows: Restaurant[]) => rows.map(item => item.id);

describe('swipe cache invalidation for mutable list inputs', () => {
    test('deduplicates a duplicate appended to an already examined array', () => {
        const list = [row('a'), row('b')];
        expect(ids(order(list, null))).toEqual(['a', 'b']);
        list.push(row('a'));
        expect(ids(order(list, null))).toEqual(['a', 'b']);
    });

    test('refreshes order after a visible item changes its merged identity in place', () => {
        const a = row('a');
        const b = row('b');
        const list = [a, b];
        const searched = row('search');
        expect(ids(order(list, searched))).toEqual(['a', 'b']);
        b.mergedRestaurants = [row('search')];
        expect(ids(order(list, searched))).toEqual(['b', 'a']);
    });

    test('refreshes same-name coordinate matches after a visible row changes', () => {
        const list = [row('a'), row('b', { lat: 38 })];
        const searched = row('search', { name: 'target', lat: 38 });
        expect(ids(order(list, searched))).toEqual(['a', 'b']);
        list[1].name = 'target';
        expect(ids(order(list, searched))).toEqual(['b', 'a']);
    });

    test('returns a replaced row object rather than a cached obsolete object', () => {
        const list = [row('a'), row('b')];
        const searched = row('b');
        expect(order(list, searched)[0]).toBe(list[1]);
        list[1] = row('b', { category: ['고기'] });
        expect(order(list, searched)[0]).toBe(list[1]);
    });

    test('recomputes nearest fallback after catalog coordinates change in place', () => {
        const searched = row('search');
        const visible = [searched];
        const all = [row('near', { lng: 127.001 }), row('far', { lng: 127.01 })];
        expect(ids(order(visible, searched, all))).toEqual(['search', 'near']);
        all[0].lng = 128;
        expect(ids(order(visible, searched, all))).toEqual(['search', 'far']);
    });

    test('recomputes nearest fallback after a new catalog row is appended', () => {
        const searched = row('search');
        const visible = [searched];
        const all = [row('far', { lng: 127.01 })];
        expect(ids(order(visible, searched, all))).toEqual(['search', 'far']);
        all.push(row('near', { lng: 127.001 }));
        expect(ids(order(visible, searched, all))).toEqual(['search', 'near']);
    });

    test('revisits every query in a 128-search working set without changing results', () => {
        const all = Array.from({ length: 128 }, (_, index) => row(`r-${index}`, { lng: 127 + index * 0.001 }));
        const visible = [row('visible')];
        const first = all.map(searched => ids(order(visible, searched, all)));
        const again = all.map(searched => ids(order(visible, searched, all)));
        expect(again).toEqual(first);
    });

    test('reuses the original array when matches already form a leading group', () => {
        const list = [row('a'), row('b'), row('c')];
        expect(order(list, row('outside'))).toBe(list);
        expect(order(list, list[0])).toBe(list);
        expect(order(list, row('all', { mergedRestaurants: list }))).toBe(list);
        const cache = getSwipeSelectionCacheState(list, list);
        expect(cache.allocatedOrderArrays).toBe(0);
        expect(cache.retainedOrderReferences).toBe(0);
    });

    test('keeps both histories at 64 entries after repeated 128-query traversals', () => {
        const visible = [row('visible')];
        const all = Array.from({ length: 735 }, (_, index) => row(`r-${index}`, { lng: 127 + index * 0.001 }));
        for (let pass = 0; pass < 3; pass += 1) {
            for (let query = 0; query < 128; query += 1) order(visible, row(`q-${query}`), all);
        }
        expect(getSwipeSelectionCacheState(visible, all)).toEqual({
            orderEntries: 64, fallbackEntries: 64, allocatedOrderArrays: 0,
            retainedOrderReferences: 0, snapshotRows: 736,
        });
    });

    test('invalidates dedupe after a nested merged ID is edited and a list is emptied', () => {
        const visible = [row('a', { mergedRestaurants: [row('b')] }), row('b')];
        expect(ids(order(visible, null))).toEqual(['a']);
        visible[0].mergedRestaurants![0].id = 'c';
        expect(ids(order(visible, null))).toEqual(['a', 'b']);
        visible.length = 0;
        expect(order(visible, null)).toEqual([]);
    });
});
