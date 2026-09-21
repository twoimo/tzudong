import { describe, expect, test } from 'bun:test';
import { pruneTimedCache, type ExpiringCacheEntry } from '../lib/public-insights/timed-cache';

const entry = (expiresAt: number, value: unknown = expiresAt): ExpiringCacheEntry => ({ expiresAt, value });

describe('pruneTimedCache', () => {
  test('deletes entries whose deadline has already passed', () => {
    const cache = new Map<string, ExpiringCacheEntry>([
      ['expired', entry(999)],
      ['live', entry(1001)],
    ]);

    pruneTimedCache(cache, 1000, 64);

    expect([...cache.keys()]).toEqual(['live']);
  });

  test('deletes an entry exactly at its deadline and keeps the one after it', () => {
    const cache = new Map<string, ExpiringCacheEntry>([
      ['at-deadline', entry(1000)],
      ['after-deadline', entry(1001)],
    ]);

    pruneTimedCache(cache, 1000, 64);

    expect([...cache.keys()]).toEqual(['after-deadline']);
  });

  test('drops null entries even when the deadline cannot be read', () => {
    const cache = new Map<string, ExpiringCacheEntry>([
      ['null-entry', null],
      ['live', entry(5000)],
    ]);

    pruneTimedCache(cache, 1000, 64);

    expect([...cache.keys()]).toEqual(['live']);
  });

  test('keeps every entry while the cache is within its cap', () => {
    const cache = new Map<string, ExpiringCacheEntry>([
      ['a', entry(5000)],
      ['b', entry(5001)],
    ]);

    pruneTimedCache(cache, 1000, 2);

    expect([...cache.keys()]).toEqual(['a', 'b']);
  });

  test('drops the oldest inserted entries once the cap is exceeded', () => {
    const cache = new Map<string, ExpiringCacheEntry>([
      ['a', entry(5000)],
      ['b', entry(5001)],
      ['c', entry(5002)],
      ['d', entry(5003)],
    ]);

    pruneTimedCache(cache, 1000, 2);

    expect([...cache.keys()]).toEqual(['c', 'd']);
  });

  test('bounds a growing cache to the cap across repeated writes', () => {
    const cache = new Map<string, ExpiringCacheEntry>();

    for (let index = 0; index < 500; index += 1) {
      cache.set(`key-${index}`, entry(1_000_000 + index));
      pruneTimedCache(cache, 1000, 32);
    }

    expect(cache.size).toBe(32);
    expect([...cache.keys()][0]).toBe('key-468');
  });
});

