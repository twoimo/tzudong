import { describe, expect, test } from 'bun:test';
import manifestJson from './fixtures/ocr/manifest.json';
import gold from './fixtures/ocr/kakaotalk-20260425-231206797.gold.json';
import { summarizeReceiptOcrEvaluations } from '@/lib/ocr/evaluation';
import { getCurrentReceiptOcrProductionPromotionGate } from '@/lib/ocr/current-promotion-gate';
import { assertReceiptOcrProductionPromotionAllowed, evaluateReceiptOcrProductionPromotionGate } from '@/lib/ocr/promotion-gate';

describe('receipt OCR production promotion gate', () => {
  test('blocks production prompt/preprocess promotion while validated fixture coverage is insufficient', () => {
    const baseline = summarizeReceiptOcrEvaluations([
      { fixtureId: 'kakaotalk-20260425-231206797', provider: 'gemini', model: 'gemini-3-flash-preview', latencyMs: 1500, raw: gold, normalized: gold, gold },
    ]);
    const candidate = { ...baseline, overallAvg: baseline.overallAvg + 3 };

    const gate = evaluateReceiptOcrProductionPromotionGate({
      manifest: manifestJson,
      goldLabelsByFixtureId: { 'kakaotalk-20260425-231206797': gold },
      baseline,
      candidate,
    });

    expect(gate.ok).toBe(false);
    expect(gate.fixtureCount).toBe(1);
    expect(gate.koreanRestaurantFixtureCount).toBe(1);
    expect(gate.reasons).toContain('requires at least 10 validated gold fixtures');
    expect(() => assertReceiptOcrProductionPromotionAllowed({
      manifest: manifestJson,
      goldLabelsByFixtureId: { 'kakaotalk-20260425-231206797': gold },
      baseline,
      candidate,
    })).toThrow('Receipt OCR production promotion blocked');
  });

  test('current production admin gate remains blocked until fixture coverage threshold is met', () => {
    const gate = getCurrentReceiptOcrProductionPromotionGate();

    expect(gate.ok).toBe(false);
    expect(gate.reasons).toContain('requires at least 10 validated gold fixtures');
    expect(gate.koreanRestaurantFixtureCount).toBe(1);
  });
});
