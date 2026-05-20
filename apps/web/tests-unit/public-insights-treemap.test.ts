import { describe, expect, test } from 'bun:test';

import {
  parseTreemapMetricMode,
  parseTreemapPeriod,
  type InsightTreemapPeriod,
} from '@/lib/public-insights/treemap';

describe('public insights treemap route support', () => {
  test('normalizes period values for the public treemap API', () => {
    expect(parseTreemapPeriod('1D')).toBe('1D');
    expect(parseTreemapPeriod('6M')).toBe('6M');
    expect(parseTreemapPeriod('invalid')).toBe('ALL');
    expect(parseTreemapPeriod(null)).toBe('ALL');
  });

  test('keeps the public period union independent of admin insight UI', () => {
    const period: InsightTreemapPeriod = 'ALL';
    expect(period).toBe('ALL');
  });

  test('normalizes metric mode values for the public treemap API', () => {
    expect(parseTreemapMetricMode('views')).toBe('views');
    expect(parseTreemapMetricMode('likes')).toBe('likes');
    expect(parseTreemapMetricMode('comments')).toBe('comments');
    expect(parseTreemapMetricMode('duration')).toBe('duration');
    expect(parseTreemapMetricMode('other')).toBe('views');
  });
});
