import { describe, expect, test } from 'bun:test';
import {
  buildNvidiaNimOcrPayload,
  callNvidiaNimReceiptOcr,
  extractJsonObject,
  getNvidiaNimOcrModels,
  NvidiaNimOcrError,
  normalizeNvidiaNimOcrData,
} from '@/lib/ocr/nvidia-nim';

describe('nvidia nim receipt ocr helper', () => {
  test('builds OpenAI-compatible multimodal payload with data URL image', () => {
    const payload = buildNvidiaNimOcrPayload({
      model: 'nvidia/nemotron-nano-12b-v2-vl',
      prompt: 'read receipt',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
    });

    expect(payload.model).toBe('nvidia/nemotron-nano-12b-v2-vl');
    expect(payload.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,abc123' },
    });
  });

  test('parses fenced JSON and normalizes receipt fields', () => {
    const raw = extractJsonObject('```json\n{"store_name":"데일리픽스 강남본점","total_amount":"11,500원","category":"카페","items":[{"name":"아메리카노","price":"4,500"}],"confidence":95}\n```');
    const normalized = normalizeNvidiaNimOcrData(raw);

    expect(normalized).toEqual({
      store_name: '데일리픽스 강남본점',
      total_amount: 11500,
      category: '카페·디저트',
      items: [{ name: '아메리카노', price: 4500 }],
      confidence: 0.95,
    });
  });

  test('uses configured model list before defaults', () => {
    expect(getNvidiaNimOcrModels({ NVIDIA_NIM_OCR_MODEL: 'a, b , ,c' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'c']);
  });

  test('defaults to one fast OCR model plus one fallback for UX budget', () => {
    expect(getNvidiaNimOcrModels({} as NodeJS.ProcessEnv)).toEqual([
      'nvidia/nemotron-nano-12b-v2-vl',
      'meta/llama-4-maverick-17b-128e-instruct',
    ]);
  });

  test('falls back to the next model after an endpoint error', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.model);
      if (body.model === 'bad-model') {
        return new Response(JSON.stringify({ error: { message: 'not multimodal' } }), { status: 400 });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '{"store_name":"데일리픽스 강남본점","date":"2026-04-24","time":"18:42","total_amount":11500,"category":"카페·디저트","items":[{"name":"소금빵","price":7000}],"confidence":0.91}',
          },
        }],
      }), { status: 200 });
    };

    const result = await callNvidiaNimReceiptOcr({
      apiKey: 'nvapi-test',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
      fetchImpl: fetchImpl as typeof fetch,
      env: { NVIDIA_NIM_OCR_MODEL: 'bad-model,good-model', NVIDIA_NIM_OCR_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv,
    });

    expect(calls).toEqual(['bad-model', 'good-model']);
    expect(result.model).toBe('good-model');
    expect(result.data.store_name).toBe('데일리픽스 강남본점');
    expect(result.attempts).toHaveLength(2);
  });


  test('uses a bounded total timeout that keeps the review form responsive', async () => {
    const started = Date.now();
    try {
      await callNvidiaNimReceiptOcr({
        apiKey: 'nvapi-test',
        imageBase64: 'abc123',
        mimeType: 'image/jpeg',
        prompt: 'read',
        fetchImpl: ((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as typeof fetch,
        env: {
          NVIDIA_NIM_OCR_MODEL: 'slow-model,never-called-model',
          NVIDIA_NIM_OCR_TIMEOUT_MS: '1000',
          NVIDIA_NIM_OCR_TOTAL_TIMEOUT_MS: '2000',
        } as NodeJS.ProcessEnv,
      });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(NvidiaNimOcrError);
      expect((error as NvidiaNimOcrError).message).toBe('NVIDIA NIM OCR 호출 실패');
      expect((error as NvidiaNimOcrError).attempts.length).toBeLessThanOrEqual(2);
    }
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  test('does not include the API key in missing-key errors', async () => {
    await expect(callNvidiaNimReceiptOcr({
      apiKey: '',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
    })).rejects.toThrow('NVIDIA_NIM_API_KEY 환경변수가 설정되지 않았습니다.');
  });
});
