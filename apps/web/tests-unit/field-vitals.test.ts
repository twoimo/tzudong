import { describe, expect, test } from 'bun:test';
import { fieldQuantileInterval, fieldVitalBucket, parseFieldVitalSample, shouldCollectFieldVitals } from '../lib/performance/field-vitals';

describe('anonymous field distributions', () => {
  test('keeps zero, boundaries and overflow without false exact quantiles', () => {
    expect(fieldVitalBucket('INP', 0)).toBe(0);
    expect(fieldVitalBucket('INP', 15.99)).toBe(0);
    expect(fieldVitalBucket('INP', 16)).toBe(1);
    expect(fieldVitalBucket('INP', 1e8)).toBe(200);
    expect(fieldVitalBucket('LCP', 2500)).toBe(25);
    expect(fieldVitalBucket('CLS', 0.1)).toBe(10);
    for (const bad of [-1, NaN, Infinity]) expect(fieldVitalBucket('INP', bad)).toBeNull();
    expect(fieldQuantileInterval('INP', [{ bucket: 200, count: 1 }], .75)).toEqual({ n: 1, lower: 3200, upper: null });
    expect(fieldQuantileInterval('LCP', [{ bucket: 10, count: 2 }, { bucket: 20, count: 6 }], .75)).toEqual({ n: 8, lower: 2000, upper: 2100 });
    expect(fieldQuantileInterval('CLS', [{ bucket: 0, count: 0 }], .75)).toBeNull();
  });

  test('rejects identifiers, URLs, raw values and invalid dimensions', () => {
    const sample = { version: 1, device: 'mobile', metric: 'INP', navigation: 'navigate', bucket: 12, release: 'a'.repeat(40) };
    expect(parseFieldVitalSample(sample)).toEqual(sample);
    for (const key of ['url', 'id', 'userId', 'session', 'entries', 'value', 'coordinates']) {
      expect(parseFieldVitalSample({ ...sample, [key]: 'unallowed' })).toBeNull();
    }
    for (const bucket of [-1, 201, 2.5, NaN]) expect(parseFieldVitalSample({ ...sample, bucket })).toBeNull();
    expect(parseFieldVitalSample({ ...sample, device: 'unknown' })).toBeNull();
    expect(parseFieldVitalSample({ ...sample, device: { toString: null } })).toBeNull();
    expect(parseFieldVitalSample({ ...sample, metric: 'FCP' })).toBeNull();
    expect(parseFieldVitalSample({ ...sample, navigation: 'unknown' })).toBeNull();
    expect(parseFieldVitalSample({ ...sample, navigation: 'back-forward-cache' })).toBeNull();
  });

  test('excludes QA, automation, preview/local and private surfaces', () => {
    const base = { production: true, hostname: 'www.tzudong.app', pathname: '/', search: '', webdriver: false };
    expect(shouldCollectFieldVitals(base)).toBe(true);
    for (const patch of [{ webdriver: true }, { pathname: '/admin' }, { pathname: '/privacy' },
      { hostname: 'localhost' }, { hostname: 'preview.vercel.app' }, { production: false },
      { search: '?__qa=render-flow' }, { search: '?__perf_mobile=owned' }]) {
      expect(shouldCollectFieldVitals({ ...base, ...patch })).toBe(false);
    }
    expect(shouldCollectFieldVitals({ ...base, search: '?ordinary=1' })).toBe(true);
  });
});
