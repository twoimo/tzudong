import { describe, expect, test } from 'bun:test';
import { GoogleGenAI } from '@google/genai';
import {
  buildGeminiReceiptOcrParts,
  buildGeminiReceiptOcrRequest,
  callGeminiReceiptOcr,
  GEMINI_OCR_FALLBACK_MODEL,
  getGeminiOcrDefaultModel,
  getGeminiOcrThinkingLevel,
  GeminiOcrError,
  getGeminiOcrModels,
} from '@/lib/ocr/gemini';

describe('gemini receipt ocr helper', () => {
  test('retains older explicit sampling while omitting removed controls for modern Flash models', () => {
    const parts = buildGeminiReceiptOcrParts({ prompt: 'synthetic receipt', imageBase64: 'AA==', mimeType: 'image/png' });
    for (const model of ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite-001', 'gemini-3.6-flash',
      'gemini-3.7-flash', 'gemini-3.8-flash', 'models/gemini-3.8-flash', 'gemini-4.0-flash']) {
      const request = buildGeminiReceiptOcrRequest({ model, parts, thinkingLevel: 'MEDIUM' });
      expect(request.model).toBe(model);
      expect(request.config).not.toHaveProperty('temperature');
      expect(request.config).not.toHaveProperty('topP');
      expect(request.config).not.toHaveProperty('topK');
      expect(request.config.responseMimeType).toBe('application/json');
      expect(request.config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    }
    for (const model of ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash']) {
      expect(buildGeminiReceiptOcrRequest({ model, parts, thinkingLevel: 'MEDIUM' }).config.temperature).toBe(0);
    }
  });

  test('installed SDK sends no obsolete sampling override for the configured OCR baseline and 3.8', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ model: string; config: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      expect(url.hostname).toBe('generativelanguage.googleapis.com');
      const body = await request.json();
      requests.push({ model: url.pathname.split('/').at(-1)!.replace(':generateContent', ''), config: body.generationConfig });
      return Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
    }) as typeof fetch;
    try {
      const client = new GoogleGenAI({ apiKey: 'synthetic-wire-test', httpOptions: { retryOptions: { attempts: 1 } } });
      const parts = buildGeminiReceiptOcrParts({ prompt: 'synthetic receipt', imageBase64: 'AA==', mimeType: 'image/png' });
      for (const model of ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash']) {
        await client.models.generateContent(buildGeminiReceiptOcrRequest({ model, parts, thinkingLevel: 'MEDIUM' }));
      }
    } finally { globalThis.fetch = originalFetch; }
    expect(requests.map(request => request.model)).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash']);
    expect(requests.slice(0, 2).map(request => request.config)).toEqual([
      { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'MEDIUM' } },
      { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'MEDIUM' } },
    ]);
    expect(requests[2].config.temperature).toBe(0);
  });

  test('does not spend a provider call after caller cancellation', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await expect(callGeminiReceiptOcr({ apiKey: 'test', imageBase64: '', mimeType: 'image/png', prompt: 'test',
      signal: controller.signal, generateContentImpl: async () => { calls++; return '{}'; },
    })).rejects.toBeInstanceOf(GeminiOcrError);
    expect(calls).toBe(0);
  });

  test('stops fallback after cancellation during a request and drops duplicate models', async () => {
    const controller = new AbortController(); let calls = 0;
    await expect(callGeminiReceiptOcr({ apiKey: 'test', imageBase64: '', mimeType: 'image/png', prompt: 'test',
      env: { GEMINI_OCR_MODEL: 'first,first,second' }, signal: controller.signal,
      generateContentImpl: async () => { calls++; controller.abort(); throw new DOMException('cancelled', 'AbortError'); },
    })).rejects.toBeInstanceOf(GeminiOcrError);
    expect(calls).toBe(1);
    expect(getGeminiOcrModels({ GEMINI_OCR_MODEL: 'first,first,second' })).toEqual(['first', 'second']);
  });
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
