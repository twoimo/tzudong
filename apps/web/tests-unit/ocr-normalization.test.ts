import { describe, expect, test } from 'bun:test';
import { scoreReceiptOcrResult } from '@/lib/ocr/evaluation';
import { buildReceiptOcrEnvelope, isReceiptMetadataItemName, RECEIPT_OCR_NORMALIZATION_VERSION } from '@/lib/ocr/receipt-normalization';
import { findOcrRestaurantMatches, scoreOcrRestaurantNameMatch } from '@/lib/ocr/restaurant-matching';
import gold from './fixtures/ocr/kakaotalk-20260425-231206797.gold.json';

describe('receipt OCR normalization', () => {
  test('filters receipt metadata items and records field-level trust', () => {
    expect(isReceiptMetadataItemName('1.인원수')).toBe(true);
    expect(isReceiptMetadataItemName('2인(린특)치즈')).toBe(false);

    const envelope = buildReceiptOcrEnvelope({
      provider: 'nvidia_nim',
      model: 'unit-model',
      attempts: [{ model: 'unit-model', ok: true, elapsedMs: 1 }],
      data: {
        store_name: '천안초쭈쭈',
        date: '2025-12-15',
        time: '12:09',
        total_amount: 48000,
        items: [
          { name: '1인원수', price: 48000 },
          { name: '2인(린특)치즈', price: 48000 },
        ],
      },
    });

    expect(envelope.normalization_version).toBe(RECEIPT_OCR_NORMALIZATION_VERSION);
    expect(envelope.normalized.items).toEqual([{ name: '2인(린특)치즈', price: 48000 }]);
    expect(envelope.applied_correction.some((entry) => entry.field === 'items')).toBe(true);
    expect(envelope.field_trust.find((field) => field.field === 'items')).toMatchObject({
      level: 'medium',
      needsReview: true,
    });
  });

  test('applies only high-trust restaurant canonical corrections', () => {
    const envelope = buildReceiptOcrEnvelope({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      attempts: [{ model: 'gemini-3-flash-preview', ok: true, elapsedMs: 1 }],
      data: { store_name: '천안초밥 시시린', date: '2025-12-15', time: '12:09', total_amount: 48000 },
      matchedRestaurantCandidates: [{
        id: 'restaurant-1',
        name: '천안초밥 스시린',
        score: 92,
        level: 'high',
        source: 'exact_name',
        reason: 'DB 승인 상호와 영수증 상호가 정확히 일치합니다.',
      }],
    });

    expect(envelope.normalized.store_name).toBe('천안초밥 스시린');
    expect(envelope.field_trust.find((field) => field.field === 'store_name')).toMatchObject({
      level: 'high',
      source: 'db_exact',
      needsReview: false,
    });
  });
});

describe('OCR restaurant matching', () => {
  test('scores close Korean OCR slips such as 시시린 versus 스시린', () => {
    expect(scoreOcrRestaurantNameMatch('천안초밥 스시린', '천안초밥 시시린')).toBeGreaterThanOrEqual(84);
  });

  test('uses Korean receipt OCR confusions only for restaurant candidate scoring', () => {
    expect(scoreOcrRestaurantNameMatch('천안초밥 스시린', '천안초쭈발')).toBeGreaterThanOrEqual(84);
    expect(scoreOcrRestaurantNameMatch('천안초밥 스시린', '취아초밥 스시린')).toBeGreaterThanOrEqual(84);
    expect(scoreOcrRestaurantNameMatch('천안초밥 스시린', '스시런')).toBeGreaterThanOrEqual(84);
  });

  test('keeps restaurant lookup under a hard cap of three with short-circuiting', async () => {
    const calls: string[] = [];
    const result = await findOcrRestaurantMatches({
      receiptStoreName: '천안초밥 시시린',
      selectedRestaurant: { id: 'selected-1' },
      lookupBySelectedId: async () => {
        calls.push('selected');
        return { id: 'selected-1', name: '다른 맛집' };
      },
      lookupExactName: async () => {
        calls.push('exact');
        return [];
      },
      lookupFuzzyToken: async (token) => {
        calls.push(`token:${token}`);
        return token ? [{ id: 'sushi-1', name: '천안초밥 스시린' }] : [];
      },
    });

    expect(result.stats.lookupCount).toBeLessThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(result.candidates[0]).toMatchObject({ id: 'sushi-1' });
  });
});

describe('receipt OCR gold scoring', () => {
  test('separates raw store score from canonical normalized score', () => {
    const score = scoreReceiptOcrResult({
      raw: { store_name: '천안초밥 시시린', date: '2025-12-15', time: '12:09', total_amount: 48000, items: [{ name: '2인(린+특)치즈', price: 48000 }] },
      normalized: { store_name: '천안초밥 스시린', date: '2025-12-15', time: '12:09', total_amount: 48000, items: [{ name: '2인(린특)치즈', price: 48000 }] },
      gold,
    });

    expect(score.storeRaw).toBeLessThan(score.storeCanonical);
    expect(score.storeCanonical).toBe(1);
    expect(score.overall).toBeGreaterThanOrEqual(90);
  });
});
