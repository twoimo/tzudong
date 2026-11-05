import { expect, test } from 'bun:test';
import { hyperbolicHalfLifeDays, visitsMultiplier, compareCohortShadow } from '../lib/evidence-engineering/scoring';
import { planFrameSamplingWindow } from '../lib/evidence-engineering/frames';

test('finite inputs cannot leak infinity from half-life or visit multiplier arithmetic', () => {
  expect(() => hyperbolicHalfLifeDays(Number.MIN_VALUE)).toThrow('non_finite');
  expect(() => visitsMultiplier(['abc123DEF45', 'def456GHI78', 'ghi789JKL01', 'jkl012MNO34'], Number.MAX_VALUE)).toThrow('non_finite');
  expect(hyperbolicHalfLifeDays(0.0015)).toBeCloseTo(2000 / 3, 9);
  expect(visitsMultiplier(['abc123DEF45', 'def456GHI78'], 0.25)).toBeCloseTo(1 + 0.25 * Math.log(2), 12);
});

test('sampling-window arithmetic cannot produce an unsafe timestamp from a safe input', () => {
  expect(() => planFrameSamplingWindow('abc123DEF45', Number.MAX_SAFE_INTEGER)).toThrow('invalid_timestamp_ms');
  const plan = planFrameSamplingWindow('abc123DEF45', 1000);
  expect(plan.window_start_ms).toBe(0);
  expect(Number.isSafeInteger(plan.window_end_ms)).toBe(true);
});

test('an unscored signal vector cannot establish a scalar difference or permit a live write', () => {
  const result = compareCohortShadow([{ identity: 'shop:a', operational_score: 1,
    candidate_signals: { freshness: 1, visit_multiplier: 1 } }]);
  expect(result.records[0].comparison_present).toBe(false);
  expect(result.records[0].differs).toBeNull();
  expect(result.summary.differ_count).toBeNull();
  expect(result.summary.live_write_allowed).toBe(false);
});
