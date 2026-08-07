import { describe, expect, test } from 'bun:test';
import {
  buildGeminiReceiptOcrParts,
  callGeminiReceiptOcr,
  GEMINI_OCR_FALLBACK_MODEL,
  getGeminiOcrDefaultModel,
  getGeminiOcrThinkingLevel,
  GeminiOcrError,
  getGeminiOcrModels,
} from '@/lib/ocr/gemini';

describe('gemini receipt ocr helper', () => {
  test('defaults to gemini-3.6-flash as the authoritative OCR baseline', () => {
    expect(GEMINI_OCR_FALLBACK_MODEL).toBe('gemini-3.6-flash');
    expect(getGeminiOcrDefaultModel({} as NodeJS.ProcessEnv)).toBe('gemini-3.6-flash');
    expect(getGeminiOcrDefaultModel({ GEMINI_OCR_DEFAULT_MODEL: 'gemini-env-default' } as NodeJS.ProcessEnv)).toBe('gemini-env-default');
    expect(getGeminiOcrModels({} as NodeJS.ProcessEnv)).toEqual(['gemini-3.6-flash']);
    expect(getGeminiOcrModels({ GEMINI_OCR_DEFAULT_MODEL: 'gemini-env-default' } as NodeJS.ProcessEnv)).toEqual(['gemini-env-default']);
    expect(getGeminiOcrModels({ GEMINI_OCR_MODEL: ' a, b ,, c ' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'c']);
  });



  test('defaults OCR thinking to medium and allows env override', () => {
    expect(getGeminiOcrThinkingLevel({} as NodeJS.ProcessEnv)).toBe('MEDIUM');
    expect(getGeminiOcrThinkingLevel({ GEMINI_THINKING_LEVEL: 'high' } as NodeJS.ProcessEnv)).toBe('HIGH');
    expect(getGeminiOcrThinkingLevel({ GEMINI_THINKING_LEVEL: 'high', GEMINI_OCR_THINKING_LEVEL: 'medium' } as NodeJS.ProcessEnv)).toBe('MEDIUM');
    expect(getGeminiOcrThinkingLevel({ GEMINI_OCR_THINKING_LEVEL: 'invalid' } as NodeJS.ProcessEnv)).toBe('MEDIUM');
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
      env: { GEMINI_OCR_MODEL: 'gemini-3.6-flash' } as NodeJS.ProcessEnv,
      generateContentImpl: async ({ model, thinkingLevel }) => {
        seenModels.push(`${model}:${thinkingLevel}`);
        return '{"store_name":"데일리픽스 강남본점","date":"2026-04-25","time":"12:30","total_amount":"11,500원","items":[{"name":"아메리카노","price":"4,500"}],"confidence":0.94}';
      },
    });

    expect(seenModels).toEqual(['gemini-3.6-flash:MEDIUM']);
    expect(result.model).toBe('gemini-3.6-flash');
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
      generateContentImpl: async ({ model, thinkingLevel }) => {
        seenModels.push(`${model}:${thinkingLevel}`);
        if (model === 'bad-model') throw new Error('model unavailable');
        return '{"store_name":"스시린 불당본점","confidence":0.9}';
      },
    });

    expect(seenModels).toEqual(['bad-model:MEDIUM', 'good-model:MEDIUM']);
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
