import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    resolveExpandedClusterRestaurant,
    retainExpandedClusterRestaurantSnapshot,
} from '../lib/expanded-cluster-restaurant-snapshot';

const restaurant = (id: string) => ({ id, name: id });

describe('expanded cluster restaurant snapshot', () => {
    test('resolves the current row before the snapshot and the merged parent', () => {
        const current = restaurant('current');
        const stale = restaurant('stale');
        const parent = restaurant('parent');
        const resolved = resolveExpandedClusterRestaurant(
            'current',
            new Map([['current', current]]),
            new Map([['current', parent]]),
            new Map([['current', stale]]),
            true,
        );

        expect(resolved).toBe(current);
    });

    test('keeps an expanded row that has left the current list', () => {
        const expanded = restaurant('expanded');
        const resolved = resolveExpandedClusterRestaurant(
            'expanded',
            new Map(),
            new Map(),
            new Map([['expanded', expanded]]),
            true,
        );

        expect(resolved).toBe(expanded);
    });

    test('does not revive a snapshot row while no cluster is expanded', () => {
        const resolved = resolveExpandedClusterRestaurant(
            'expanded',
            new Map(),
            new Map([['expanded', restaurant('merged')]]),
            new Map([['expanded', restaurant('snapshot')]]),
            false,
        );

        expect(resolved).toEqual(restaurant('merged'));
    });

    test('uses the snapshot before the merged parent while a cluster is expanded', () => {
        const snapshotRow = restaurant('snapshot');
        const resolved = resolveExpandedClusterRestaurant(
            'merged-id',
            new Map(),
            new Map([['merged-id', restaurant('merged')]]),
            new Map([['merged-id', snapshotRow]]),
            true,
        );

        expect(resolved).toBe(snapshotRow);
    });

    test('returns undefined for an empty, missing, or non-string id', () => {
        const byId = new Map([['known', restaurant('known')]]);

        expect(resolveExpandedClusterRestaurant('', byId, byId, byId, true)).toBeUndefined();
        expect(resolveExpandedClusterRestaurant(null, byId, byId, byId, true)).toBeUndefined();
        expect(resolveExpandedClusterRestaurant(12, byId, byId, byId, true)).toBeUndefined();
        expect(resolveExpandedClusterRestaurant('missing', new Map(), new Map(), new Map(), true)).toBeUndefined();
    });

    test('returns undefined when the lookup maps are missing', () => {
        expect(resolveExpandedClusterRestaurant('id', null, undefined, null, true)).toBeUndefined();
    });

    test('returns undefined when a lookup map throws', () => {
        const broken = {
            has() {
                throw new Error('secret restaurant payload');
            },
            get() {
                return restaurant('hidden');
            },
        } as unknown as Map<string, { id: string }>;
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (message?: unknown) => {
            warnings.push(String(message));
        };

        try {
            expect(resolveExpandedClusterRestaurant('id', broken, new Map(), new Map(), false)).toBeUndefined();
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings).toEqual(['[expanded-cluster-snapshot] resolve failed (Error)']);
        expect(warnings.join('\n')).not.toContain('secret restaurant payload');
    });

    test('drops rows that are no longer current, expanded, or selected', () => {
        const snapshot = new Map([
            ['current', restaurant('old-current')],
            ['expanded', restaurant('expanded')],
            ['selected', restaurant('selected')],
            ['forgotten', restaurant('forgotten')],
        ]);
        const stats = retainExpandedClusterRestaurantSnapshot(
            snapshot,
            new Map([['current', restaurant('current')]]),
            new Map([['merged', restaurant('parent')]]),
            ['expanded', '', null, 'selected'],
        );

        expect(stats).toEqual({ retained: 4, pruned: 1 });
        expect([...snapshot.keys()].sort()).toEqual(['current', 'expanded', 'merged', 'selected']);
        expect(snapshot.get('current')).toEqual(restaurant('current'));
        expect(snapshot.get('merged')).toEqual(restaurant('parent'));
        expect(snapshot.has('forgotten')).toBe(false);
    });

    test('keeps an expanded id that is absent from the current maps', () => {
        const snapshot = new Map([['expanded', restaurant('expanded')]]);
        const stats = retainExpandedClusterRestaurantSnapshot(snapshot, new Map(), new Map(), ['expanded']);

        expect(stats).toEqual({ retained: 1, pruned: 0 });
        expect(snapshot.get('expanded')).toEqual(restaurant('expanded'));
    });

    test('does not let a merged parent overwrite a current row with the same id', () => {
        const snapshot = new Map<string, { id: string }>();
        const current = restaurant('same');
        retainExpandedClusterRestaurantSnapshot(
            snapshot,
            new Map([['same', current]]),
            new Map([['same', restaurant('merged')]]),
            [],
        );

        expect(snapshot.get('same')).toBe(current);
    });

    test('accepts an empty snapshot update and a non-array retain list', () => {
        const snapshot = new Map([['gone', restaurant('gone')]]);
        const stats = retainExpandedClusterRestaurantSnapshot(snapshot, new Map(), null, 'expanded' as unknown as string[]);

        expect(stats).toEqual({ retained: 0, pruned: 1 });
        expect(snapshot.size).toBe(0);
        expect(retainExpandedClusterRestaurantSnapshot(null, new Map(), new Map(), [])).toEqual({
            retained: 0,
            pruned: 0,
        });
    });

    test('map view resolves markers through the snapshot instead of copying both lookup maps', () => {
        const source = readFileSync(join(import.meta.dir, '../components/map/NaverMapView.tsx'), 'utf8');

        expect(source).toContain('retainExpandedClusterRestaurantSnapshot(');
        expect(source).toContain('resolveExpandedClusterRestaurant(');
        expect(source).not.toContain('new Map(restaurantLookup.byId)');
        expect(source).not.toContain('new Map(restaurantLookup.mergedRestaurantById)');
        expect(source).toContain('showUserSubmittedMarkers ? restaurantLookup : buildRestaurantLookup(displayRestaurants)');
    });
});
