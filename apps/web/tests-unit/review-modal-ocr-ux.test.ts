import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  addAiFilledField,
  getOcrProgressRank,
  shouldSuppressOcrAutoNavigation,
  type ReviewOcrFieldKey,
} from '@/lib/ocr/review-modal-ocr-ux';

const reviewModalSource = readFileSync(new URL('../components/reviews/ReviewModal.tsx', import.meta.url), 'utf8');

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

describe('review modal OCR terminal recovery contract', () => {
  test('keeps the receipt photo attached and reuses one terminal notice helper', () => {
    expect(reviewModalSource).toContain('사진만 첨부하고 직접 입력');
    expect(reviewModalSource).toContain('다시 분석');
    expect(reviewModalSource).toContain('void analyzeReceipt(verificationPhoto)');
    expect(reviewModalSource).toContain('disabled={!verificationPhoto || isAnalyzing || ocrLimitReached}');

    expect(reviewModalSource.match(/const renderOcrFallbackNotice = \(\) =>/g)).toHaveLength(1);
    expect(reviewModalSource.match(/\{renderOcrFallbackNotice\(\)\}/g)).toHaveLength(3);
    expect(reviewModalSource).toContain("const isTerminalError = ocrFallbackNotice.type === 'error'");
    expect(reviewModalSource).toContain('terminal?: boolean');
    expect(reviewModalSource).toContain('status?: number');
    expect(reviewModalSource).toContain('if (parsed.payload.terminal)');
    expect(reviewModalSource).toContain('new OcrStreamHttpError(streamErrorMessage, parsed.payload.status ?? 422)');
  });
});
