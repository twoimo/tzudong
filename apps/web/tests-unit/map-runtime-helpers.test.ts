import { describe, expect, test } from 'bun:test';

import { LruCache } from '../lib/map-runtime-helpers';

describe('map runtime helpers', () => {
    test('evicts oldest entry when lru cache exceeds max size', () => {
        const cache = new LruCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);

        expect(cache.has('a')).toBe(false);
        expect(cache.has('b')).toBe(true);
        expect(cache.has('c')).toBe(true);
    });

    test('get refreshes recency in lru cache', () => {
        const cache = new LruCache<string, number>(2);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.get('a')).toBe(1);
        cache.set('c', 3);

        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });
});
