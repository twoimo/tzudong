import { describe, expect, test } from 'bun:test';
import { buildOcrResponseFromRawCache, buildOcrSuccessLogMetadata } from '@/lib/ocr/route-helpers';
import { buildReceiptOcrEnvelope, flattenReceiptOcrEnvelope } from '@/lib/ocr/receipt-normalization';
import { RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION, RECEIPT_OCR_RAW_CACHE_KIND } from '@/lib/ocr/cache-version';


describe('OCR extract route normalization/cache contract', () => {
  test('builds cacheable success metadata with raw and normalized OCR envelopes after provider fallback', () => {
    const envelope = buildReceiptOcrEnvelope({
      provider: 'nvidia_nim',
      model: 'nim-model',
      attempts: [{ model: 'bad-gemini', ok: false, elapsedMs: 10, error: 'invalid key' }, { model: 'nim-model', ok: true, elapsedMs: 50 }],
      data: {
        store_name: '천안초밥 시시린',
        date: '2025-12-15',
        time: '12:09',
        total_amount: 48000,
        items: [{ name: '1인원수', price: 48000 }, { name: '2인(린특)치즈', price: 48000 }],
      },
      matchedRestaurantCandidates: [{
        id: 'restaurant-1',
        name: '천안초밥 스시린',
        road_address: null,
        jibun_address: null,
        score: 86,
        level: 'high',
        source: 'selected_restaurant',
        reason: '선택된 맛집과 영수증 상호가 강하게 일치합니다.',
      }],
    });
    const responsePayload = flattenReceiptOcrEnvelope(envelope);

    const metadata = buildOcrSuccessLogMetadata({
      fileSize: 1000,
      compressedSize: 900,
      savings: '10%',
      provider: 'nvidia_nim',
      model: 'nim-model',
      promptVersion: 'receipt-extraction-v2',
      preprocessVersion: 'receipt-image-1600w-q90-original-first-v3',
      routingMode: 'automatic',
      normalizationVersion: envelope.normalization_version,
      credentialSource: 'NVIDIA_NIM_API_KEY',
      fallbackUsed: true,
      forceRefresh: false,
      envelope,
      ocrResult: responsePayload,
      restaurantLookupStats: { lookupCount: 1, lookupLimit: 3, stoppedByBudget: false },
    });

    expect(metadata.normalization_version).toBe('receipt-normalization-v1');
    expect(metadata.fallback_used).toBe(true);
    expect(metadata.raw_ocr_result).toEqual(expect.objectContaining({ store_name: '천안초밥 시시린' }));
    expect(metadata.normalized_ocr_result).toEqual(expect.objectContaining({ store_name: '천안초밥 스시린' }));
    expect(metadata.ocr_result).toEqual(expect.objectContaining({
      store_name: '천안초밥 스시린',
      normalization_version: 'receipt-normalization-v1',
    }));
    expect(metadata.field_trust.some((field) => field.field === 'store_name' && field.level === 'high')).toBe(true);
    expect(metadata.restaurant_lookup).toEqual({ lookupCount: 1, lookupLimit: 3, stoppedByBudget: false });
  });

  test('recomputes current restaurant correction from raw cache instead of serving stale corrected payload', async () => {
    const rawCache = {
      cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      prompt_version: 'receipt-extraction-v2',
      preprocess_version: 'receipt-image-1600w-q90-original-first-v3',
      extraction_schema_version: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
      routing_mode: 'automatic',
      model_attempts: [{ model: 'gemini-3-flash-preview', ok: true, elapsedMs: 12 }],
      raw_ocr_result: { store_name: '데일리픽스', date: '2026-04-25', time: '19:10', total_amount: 11500 },
      ocr_result: { store_name: '스테일 과거 보정값' },
    } as const;

    const responseA = await buildOcrResponseFromRawCache({
      metadata: rawCache,
      selectedRestaurantContext: { id: 'restaurant-a' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'restaurant-a', name: '데일리픽스 강남본점' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });
    const responseB = await buildOcrResponseFromRawCache({
      metadata: rawCache,
      selectedRestaurantContext: { id: 'restaurant-b' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'restaurant-b', name: '데일리픽스 판교점' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });

    expect(responseA?.responsePayload.store_name).toBe('데일리픽스 강남본점');
    expect(responseB?.responsePayload.store_name).toBe('데일리픽스 판교점');
    expect(responseA?.responsePayload.store_name).not.toBe('스테일 과거 보정값');
    expect(responseA?.restaurantLookupStats.lookupCount).toBeLessThanOrEqual(3);
    expect(responseB?.restaurantLookupStats.lookupCount).toBeLessThanOrEqual(3);
  });



  test('reuses legacy cache rows only when raw OCR fields are present and still recomputes envelope', async () => {
    const response = await buildOcrResponseFromRawCache({
      metadata: {
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        prompt_version: 'legacy-prompt',
        preprocess_version: 'legacy-preprocess',
        routing_mode: 'automatic',
        model_attempts: [{ model: 'gemini-3-flash-preview', ok: true, elapsedMs: 10 }],
        raw_ocr_result: { store_name: '스시런', date: '2025-12-15', time: '12:09', total_amount: 48000 },
        ocr_result: { store_name: '과거 보정값' },
      },
      selectedRestaurantContext: { id: 'sushi-1' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'sushi-1', name: '천안초밥 스시린' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });

    expect(response?.responsePayload.store_name).toBe('천안초밥 스시린');
    expect(response?.responsePayload.store_name).not.toBe('과거 보정값');
  });
  test('ignores legacy corrected-only cache rows without raw OCR fields', async () => {
    const response = await buildOcrResponseFromRawCache({
      metadata: {
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        prompt_version: 'receipt-extraction-v2',
        preprocess_version: 'receipt-image-1600w-q90-original-first-v3',
        routing_mode: 'automatic',
        normalization_version: 'receipt-normalization-v1',
        ocr_result: { store_name: '과거 보정값' },
      },
      selectedRestaurantContext: { id: 'restaurant-a' },
    });

    expect(response).toBeNull();
  });

});
