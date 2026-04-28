import { describe, expect, test } from 'bun:test';
import {
  canPromoteReceiptOcrCandidate,
  summarizeReceiptOcrEvaluations,
  validateReceiptOcrFixture,
  type ReceiptOcrFixtureManifest,
} from '@/lib/ocr/evaluation';
import manifestJson from './fixtures/ocr/manifest.json';
import gold from './fixtures/ocr/kakaotalk-20260425-231206797.gold.json';

describe('receipt OCR manifest/evaluation harness', () => {
  test('validates fixture source license and redaction metadata before commit-safe evaluation', () => {
    const manifest = manifestJson as ReceiptOcrFixtureManifest;
    const result = validateReceiptOcrFixture({ manifestEntry: manifest.fixtures[0], gold });

    expect(result).toEqual({ ok: true, reasons: [] });
  });

  test('aggregates field scores, errors, and latency percentiles across fixtures', () => {
    const summary = summarizeReceiptOcrEvaluations([
      {
        fixtureId: 'fixture-1',
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        latencyMs: 1200,
        raw: gold,
        normalized: gold,
        gold,
      },
      {
        fixtureId: 'fixture-2',
        provider: 'nvidia_nim',
        model: 'qwen/qwen3.5-122b-a10b',
        latencyMs: 3000,
        error: 'timeout',
        gold,
      },
    ]);

    expect(summary.count).toBe(2);
    expect(summary.successfulCount).toBe(1);
    expect(summary.errorRate).toBe(0.5);
    expect(summary.overallAvg).toBeGreaterThanOrEqual(95);
    expect(summary.p95LatencyMs).toBe(3000);
  });

  test('blocks production promotion when gold-set and critical-field thresholds are not met', () => {
    const baseline = summarizeReceiptOcrEvaluations([
      { fixtureId: 'base', provider: 'gemini', model: 'gemini-3-flash-preview', latencyMs: 1500, raw: gold, normalized: gold, gold },
    ]);
    const candidate = { ...baseline, overallAvg: baseline.overallAvg + 4, totalAmountAvg: baseline.totalAmountAvg - 3 };

    const gate = canPromoteReceiptOcrCandidate({
      candidate,
      baseline,
      fixtureCount: 1,
      koreanRestaurantFixtureCount: 1,
    });

    expect(gate.ok).toBe(false);
    expect(gate.reasons).toContain('requires at least 10 validated gold fixtures');
    expect(gate.reasons).toContain('requires at least 5 Korean restaurant/order fixtures');
    expect(gate.reasons).toContain('total amount score regresses by more than 2 points');
  });
});
