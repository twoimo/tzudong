import { describe, expect, test } from 'bun:test';
import {
  getCachedPerformanceLevel,
  getDevicePerformanceLevel,
  getPerformanceBasedClusterOptions,
  resetPerformanceCache,
} from '@/lib/device-performance';

describe('device performance level', () => {
  test('maps every level to its cluster options', () => {
    expect(getPerformanceBasedClusterOptions('LOW')).toEqual({ maxZoom: 14, radius: 60, minPoints: 3 });
    expect(getPerformanceBasedClusterOptions('MEDIUM')).toEqual({ maxZoom: 13, radius: 50, minPoints: 2 });
    expect(getPerformanceBasedClusterOptions('HIGH')).toEqual({ maxZoom: 12, radius: 40, minPoints: 2 });
  });

  test('falls back to the detected level when no level is given', () => {
    const detected = getDevicePerformanceLevel();

    expect(getPerformanceBasedClusterOptions()).toEqual(getPerformanceBasedClusterOptions(detected));
  });

  test('reports a finite level without a browser window', () => {
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(getDevicePerformanceLevel());
  });

  test('caches the detected level until the cache is reset', () => {
    resetPerformanceCache();
    const first = getCachedPerformanceLevel();

    expect(first).toBe(getDevicePerformanceLevel());
    expect(getCachedPerformanceLevel()).toBe(first);
    expect(resetPerformanceCache()).toBeUndefined();
    expect(getCachedPerformanceLevel()).toBe(first);
  });
});
