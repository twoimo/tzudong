import { describe, expect, test } from 'bun:test';
import {
  buildNvidiaNimOcrPayload,
  callNvidiaNimReceiptOcr,
  callNvidiaNimReceiptOcrStreaming,
  extractJsonObject,
  extractPartialNvidiaNimOcrData,
  getNvidiaNimOcrModels,
  parseNvidiaNimStreamChunk,
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



  test('uses sushi and sashimi receipt context to correct overly broad Korean category guesses', () => {
    const normalized = normalizeNvidiaNimOcrData({
      store_name: '스시린 불당본점',
      category: '한식',
      items: [
        { name: '특선초밥', price: '24000' },
        { name: '연어초밥', price: '12000' },
      ],
    });

    expect(normalized.category).toBe('돈까스·회');
  });

  test('builds streaming payload and parses SSE deltas for live auto-fill', async () => {
    const payload = buildNvidiaNimOcrPayload({
      model: 'stream-model',
      prompt: 'read receipt',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      stream: true,
    });
    expect(payload).toMatchObject({ stream: true });

    const deltas = parseNvidiaNimStreamChunk([
      'data: {"choices":[{"delta":{"content":"{\\\"store_name\\\":\\\"데일리"}}]}',
      'data: {"choices":[{"delta":{"content":"픽스\\\",\\\"date\\\":\\\"2026-04-25\\\"}"}}]}',
      'data: [DONE]',
    ].join('\n'));

    expect(deltas.join('')).toContain('데일리픽스');
    expect(extractPartialNvidiaNimOcrData(deltas.join(''))).toMatchObject({
      store_name: '데일리픽스',
      date: '2026-04-25',
    });
  });

  test('streams receipt OCR deltas before returning the final result', async () => {
    const encoder = new TextEncoder();
    const frames = [
      'data: {"choices":[{"delta":{"content":"{\\\"store_name\\\":\\\"데일리픽스\\\","}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"\\\"date\\\":\\\"2026-04-25\\\",\\\"time\\\":\\\"12:30\\\",\\\"category\\\":\\\"카페·디저트\\\",\\\"review_draft\\\":\\\"맛있어요\\\",\\\"confidence\\\":0.9}"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchImpl = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }), { status: 200 });
    const seen: string[] = [];

    const result = await callNvidiaNimReceiptOcrStreaming({
      apiKey: 'nvapi-test',
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      prompt: 'read',
      fetchImpl: fetchImpl as typeof fetch,
      env: { NVIDIA_NIM_OCR_MODEL: 'stream-model', NVIDIA_NIM_OCR_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv,
      onDelta: (_delta, accumulated) => seen.push(accumulated),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(result.model).toBe('stream-model');
    expect(result.data.store_name).toBe('데일리픽스');
  });

  test('uses configured model list before defaults', () => {
    expect(getNvidiaNimOcrModels({ NVIDIA_NIM_OCR_MODEL: 'a, b , ,c' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'c']);
  });

  test('defaults to accuracy-first OCR models with a fast fallback for UX budget', () => {
    expect(getNvidiaNimOcrModels({} as NodeJS.ProcessEnv)).toEqual([
      'meta/llama-4-maverick-17b-128e-instruct',
      'mistralai/mistral-small-4-119b-2603',
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
