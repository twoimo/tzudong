import { describe, expect, test } from 'bun:test';
import {
  addAiFilledField,
  getOcrProgressRank,
  shouldSuppressOcrAutoNavigation,
  type ReviewOcrFieldKey,
} from '@/lib/ocr/review-modal-ocr-ux';

describe('review modal OCR UX helpers', () => {
  test('suppresses automatic OCR navigation while the user is actively editing', () => {
    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 10_000,
      now: 12_500,
      userStepOverride: false,
    })).toBe(true);

    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 10_000,
      now: 15_001,
      userStepOverride: false,
    })).toBe(false);
  });

  test('keeps automatic OCR navigation disabled after manual step movement', () => {
    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 0,
      now: 20_000,
      userStepOverride: true,
    })).toBe(true);
  });

  test('tracks persistent AI-filled field markers without mutating previous sets', () => {
    const initial = new Set<ReviewOcrFieldKey>(['date']);
    const next = addAiFilledField(initial, 'review');

    expect([...initial]).toEqual(['date']);
    expect([...next].sort()).toEqual(['date', 'review']);
  });

  test('orders progress stages for the compact SSE timeline', () => {
    expect(getOcrProgressRank('prepare')).toBeLessThan(getOcrProgressRank('model_start'));
    expect(getOcrProgressRank('patching')).toBeLessThan(getOcrProgressRank('done'));
  });
});

describe('review modal OCR selected restaurant guard', () => {
  test('does not replace selected restaurant from fuzzy OCR-only match', async () => {
    const { canReplaceSelectedRestaurantFromOcr } = await import('@/lib/ocr/review-modal-ocr-ux');

    expect(canReplaceSelectedRestaurantFromOcr({
      hasSelectedRestaurant: true,
      manuallyEditedRestaurant: false,
      fieldTrust: [{ field: 'store_name', level: 'medium', source: 'db_fuzzy' }],
    })).toBe(false);

    expect(canReplaceSelectedRestaurantFromOcr({
      hasSelectedRestaurant: true,
      manuallyEditedRestaurant: false,
      fieldTrust: [{ field: 'store_name', level: 'high', source: 'db_exact' }],
    })).toBe(true);
  });
});
