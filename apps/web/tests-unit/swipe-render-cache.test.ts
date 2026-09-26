import { describe, expect, test } from 'bun:test';
import type { Restaurant } from '../types/restaurant';
import {
    buildPostSearchSwipeCandidates,
    getLastSwipeOrderBuildCount,
    getNearestFallbackScanCount,
    isSameRestaurantSelection,
} from '../lib/mobile-home-search-selection';

const restaurant = (id: string, overrides: Partial<Restaurant> = {}): Restaurant => ({
    id, name: id, lat: 37.5, lng: 127, category: ['한식'], ...overrides,
} as Restaurant);
const merged = (...ids: string[]) => ids.map((id) => restaurant(id));
const ids = (items: Restaurant[]) => items.map((item) => item.id);
const order = (visible: Restaurant[], searched: Restaurant, all = visible) =>
    buildPostSearchSwipeCandidates({ visibleRestaurants: visible, allRestaurants: all, activeSearchedRestaurant: searched });

describe('swipe render cache correctness and capacity', () => {
    test('invalidates search ordering when the same search id gets different merged ids', () => {
        const visible = [restaurant('a'), restaurant('b')];
        expect(ids(order(visible, restaurant('search', { mergedRestaurants: merged('a') })))).toEqual(['a', 'b']);
        expect(ids(order(visible, restaurant('search', { mergedRestaurants: merged('b') })))).toEqual(['b', 'a']);
    });

    test('invalidates ordering when the same search id gets a new name or coordinates', () => {
        const visible = [restaurant('a'), restaurant('b', { lat: 38 })];
        expect(ids(order(visible, restaurant('search', { name: 'b', lat: 38 })))).toEqual(['b', 'a']);
        expect(ids(order(visible, restaurant('search', { name: 'a', lat: 37.5 })))).toEqual(['a', 'b']);
    });

    test('detects an in-place edit of the active search merged ids', () => {
        const visible = [restaurant('a'), restaurant('b')];
        const searched = restaurant('search', { mergedRestaurants: merged('a') });
        expect(ids(order(visible, searched))).toEqual(['a', 'b']);
        searched.mergedRestaurants![0].id = 'b';
        expect(ids(order(visible, searched))).toEqual(['b', 'a']);
    });

    test('recomputes the nearest fallback when search coordinates change with the same id', () => {
        const visible = [restaurant('visible')];
        const all = [restaurant('west', { lng: 126 }), restaurant('east', { lng: 128 })];
        expect(ids(order(visible, restaurant('search', { lng: 126 }), all))).toEqual(['visible', 'west']);
        expect(ids(order(visible, restaurant('search', { lng: 128 }), all))).toEqual(['visible', 'east']);
    });

    test('recomputes fallback exclusion when the visible selection changes with the same id', () => {
        const all = [restaurant('near', { lng: 127.001 }), restaurant('far', { lng: 127.01 })];
        const searched = restaurant('search');
        expect(ids(order([restaurant('visible')], searched, all))).toEqual(['visible', 'near']);
        expect(ids(order([restaurant('visible', { mergedRestaurants: merged('near') })], searched, all))).toEqual(['visible', 'far']);
    });

    test('bounds ordering history to 64 searches per visible list', () => {
        const visible = [restaurant('a'), restaurant('b')];
        const first = restaurant('first');
        order(visible, first);
        for (let index = 0; index < 64; index += 1) order(visible, restaurant(`query-${index}`));
        const builds = getLastSwipeOrderBuildCount();
        order(visible, first);
        expect(getLastSwipeOrderBuildCount()).toBe(builds + 1);
        const repeated = order(visible, first);
        expect(order(visible, first)).toBe(repeated);
        expect(getLastSwipeOrderBuildCount()).toBe(builds + 1);
    });

    test('bounds fallback history to 64 searches per catalog', () => {
        const visible = [restaurant('visible')];
        const all = [restaurant('near', { lng: 127.001 })];
        const first = restaurant('first');
        order(visible, first, all);
        for (let index = 0; index < 64; index += 1) order(visible, restaurant(`query-${index}`), all);
        const scans = getNearestFallbackScanCount();
        order(visible, first, all);
        expect(getNearestFallbackScanCount()).toBe(scans + 1);
        order(visible, first, all);
        expect(getNearestFallbackScanCount()).toBe(scans + 1);
    });

    test('preserves the order within both matched and unmatched groups', () => {
        const visible = ['a', 'b', 'c', 'd', 'e'].map((id) => restaurant(id));
        const searched = restaurant('search', { mergedRestaurants: merged('b', 'd') });
        expect(ids(order(visible, searched))).toEqual(['b', 'd', 'a', 'c', 'e']);
        expect(ids(order(visible, restaurant('none')))).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(ids(order(visible, restaurant('all', { mergedRestaurants: merged('a', 'b', 'c', 'd', 'e') })))).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    test('preserves empty, unavailable, invalid-coordinate and tie behavior', () => {
        const searched = restaurant('search');
        expect(order([], searched, [])).toEqual([]);
        expect(order([searched], searched, [])).toEqual([searched]);
        expect(order([searched], searched, [restaurant('bad', { lat: NaN })])).toEqual([searched]);
        const first = restaurant('first', { lng: 127.1 });
        const second = restaurant('second', { lng: 127.1 });
        expect(ids(order([searched], searched, [first, second]))).toEqual(['search', 'first']);
        expect(buildPostSearchSwipeCandidates({ visibleRestaurants: [first, second], allRestaurants: [], activeSearchedRestaurant: null })).toEqual([first, second]);
    });

    test('matches an uncached reference across 2,000 deterministic selection changes', () => {
        let seed = 20260925;
        const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
        const unique = (items: Restaurant[]) => items.reduce<Restaurant[]>((result, item) => {
            if (!result.some((prior) => isSameRestaurantSelection(prior, item))) result.push(item);
            return result;
        }, []);
        const all = Array.from({ length: 40 }, (_, index) => restaurant(`r-${index}`, {
            name: `name-${index % 7}`, lat: 37 + index / 100, lng: 126 + index / 100,
            mergedRestaurants: index % 3 === 0 ? merged(`alias-${index}`) : [],
        }));
        const lists = [[], [all[0]], all.slice(0, 12), all.slice(10), [all[1], all[1], all[5]], all];
        for (let iteration = 0; iteration < 2000; iteration += 1) {
            const visible = lists[random(lists.length)];
            const target = all[random(all.length)];
            const searched = restaurant(`search-${random(4)}`, {
                name: random(2) ? target.name : 'unmatched', lat: target.lat, lng: target.lng,
                mergedRestaurants: random(2) ? merged(target.id) : [],
            });
            const deduped = unique(visible);
            const expected = deduped.filter((item) => isSameRestaurantSelection(item, searched))
                .concat(deduped.filter((item) => !isSameRestaurantSelection(item, searched)));
            if (expected.length === 1) {
                let nearest: Restaurant | undefined;
                let distance = Infinity;
                for (const candidate of unique(all)) {
                    if (isSameRestaurantSelection(candidate, expected[0])) continue;
                    const d = ((Number(searched.lat) - Number(candidate.lat)) * 111) ** 2
                        + ((Number(searched.lng) - Number(candidate.lng)) * 88) ** 2;
                    if (Number.isFinite(d) && d < distance) { nearest = candidate; distance = d; }
                }
                if (nearest) expected.push(nearest);
            }
            expect(ids(order(visible, searched, all))).toEqual(ids(expected));
        }
    });
});
