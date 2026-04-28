import { describe, expect, test } from 'bun:test';
import {
  buildGeminiReceiptOcrParts,
  callGeminiReceiptOcr,
  GEMINI_OCR_DEFAULT_MODEL,
  GeminiOcrError,
  getGeminiOcrModels,
} from '@/lib/ocr/gemini';
import {
  buildOcrCacheVersion,
  doesOcrCacheMetadataMatch,
  RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
  RECEIPT_OCR_RAW_CACHE_KIND,
  serializeOcrCacheVersion,
} from '@/lib/ocr/cache-version';

describe('gemini receipt ocr helper', () => {
  test('defaults to gemini-3-flash-preview as the authoritative OCR baseline', () => {
    expect(GEMINI_OCR_DEFAULT_MODEL).toBe('gemini-3-flash-preview');
    expect(getGeminiOcrModels({} as NodeJS.ProcessEnv)).toEqual(['gemini-3-flash-preview']);
    expect(getGeminiOcrModels({ GEMINI_OCR_MODEL: ' a, b ,, c ' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'c']);
  });

  test('builds Gemini multimodal parts without exposing secrets', () => {
    const parts = buildGeminiReceiptOcrParts({
      prompt: 'read receipt',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
    });

    expect(parts).toEqual([
      { text: 'read receipt' },
      { inlineData: { data: 'abc123', mimeType: 'image/jpeg' } },
    ]);
    expect(JSON.stringify(parts)).not.toContain('gemini-secret');
  });

  test('calls configured Gemini model and normalizes receipt JSON', async () => {
    const seenModels: string[] = [];
    const result = await callGeminiReceiptOcr({
      apiKey: 'gemini-test-key',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
      env: { GEMINI_OCR_MODEL: 'gemini-3-flash-preview' } as NodeJS.ProcessEnv,
      generateContentImpl: async ({ model }) => {
        seenModels.push(model);
        return '{"store_name":"데일리픽스 강남본점","date":"2026-04-25","time":"12:30","total_amount":"11,500원","items":[{"name":"아메리카노","price":"4,500"}],"confidence":0.94}';
      },
    });

    expect(seenModels).toEqual(['gemini-3-flash-preview']);
    expect(result.model).toBe('gemini-3-flash-preview');
    expect(result.data).toMatchObject({
      store_name: '데일리픽스 강남본점',
      date: '2026-04-25',
      time: '12:30',
      total_amount: 11500,
      confidence: 0.94,
    });
    expect(result.data.items).toEqual([{ name: '아메리카노', price: 4500 }]);
  });

  test('falls through Gemini model list before failing', async () => {
    const seenModels: string[] = [];
    const result = await callGeminiReceiptOcr({
      apiKey: 'gemini-test-key',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
      env: { GEMINI_OCR_MODEL: 'bad-model,good-model' } as NodeJS.ProcessEnv,
      generateContentImpl: async ({ model }) => {
        seenModels.push(model);
        if (model === 'bad-model') throw new Error('model unavailable');
        return '{"store_name":"스시린 불당본점","confidence":0.9}';
      },
    });

    expect(seenModels).toEqual(['bad-model', 'good-model']);
    expect(result.model).toBe('good-model');
    expect(result.attempts).toHaveLength(2);
    expect(result.data.store_name).toBe('스시린 불당본점');
  });

  test('does not include the API key in missing-key errors', async () => {
    await expect(callGeminiReceiptOcr({
      apiKey: '',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
    })).rejects.toThrow('Gemini OCR API 키가 설정되지 않았습니다.');
  });

  test('throws provider error with attempts when all Gemini candidates fail', async () => {
    await expect(callGeminiReceiptOcr({
      apiKey: 'gemini-test-key',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
      env: { GEMINI_OCR_MODEL: 'bad-a,bad-b' } as NodeJS.ProcessEnv,
      generateContentImpl: async () => { throw new Error('boom'); },
    })).rejects.toBeInstanceOf(GeminiOcrError);
  });
});

describe('ocr cache versioning', () => {
  test('requires raw cache kind schema provider model prompt preprocess and routing mode to match', () => {
    const version = buildOcrCacheVersion({
      cacheKind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      promptVersion: 'receipt-extraction-v1',
      preprocessVersion: 'receipt-image-1600w-q85-v2',
      extractionSchemaVersion: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
      routingMode: 'manual',
    });

    expect(serializeOcrCacheVersion(version)).toBe('receipt_ocr_raw_v1|gemini|gemini-3-flash-preview|receipt-extraction-v1|receipt-image-1600w-q85-v2|receipt-ocr-schema-v1|manual');
    expect(doesOcrCacheMetadataMatch({
      cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      prompt_version: 'receipt-extraction-v1',
      preprocess_version: 'receipt-image-1600w-q85-v2',
      extraction_schema_version: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
      routing_mode: 'manual',
      raw_ocr_result: { store_name: '데일리픽스' },
      ocr_result: { store_name: '과거 보정값' },
    }, version)).toBe(true);

    expect(doesOcrCacheMetadataMatch({
      cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      prompt_version: 'receipt-extraction-v1',
      preprocess_version: 'receipt-image-1600w-q85-v2',
      extraction_schema_version: 'stale-schema',
      routing_mode: 'manual',
      raw_ocr_result: { store_name: '데일리픽스' },
    }, version)).toBe(false);

    expect(doesOcrCacheMetadataMatch({
      cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'nvidia_nim',
      model: 'gemini-3-flash-preview',
      prompt_version: 'receipt-extraction-v1',
      preprocess_version: 'receipt-image-1600w-q85-v2',
      extraction_schema_version: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
      routing_mode: 'manual',
      raw_ocr_result: { store_name: '데일리픽스' },
    }, version)).toBe(false);
  });
});
