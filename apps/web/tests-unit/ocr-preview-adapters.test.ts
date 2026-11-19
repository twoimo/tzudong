import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import {
  previewReceiptOcr,
  OCR_PREVIEW_ERROR_CODES,
  OcrPreviewError,
  createLiveGeminiPreviewRunner,
  createLiveOpenAiPreviewRunner,
  type OcrPreviewInput,
} from '../lib/ocr/preview';

/**
 * Creates a valid standalone in-memory PNG image without disk dependencies.
 */
function createSyntheticPng(width = 128, height = 128): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function crc32(buf: Buffer) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      let b = buf[i];
      for (let j = 0; j < 8; j++) {
        let bit = (b ^ crc) & 1;
        crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
        b = b >>> 1;
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function makeChunk(type: string, data: Buffer) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const raw = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
  }
  const idat = deflateSync(raw);

  return new Uint8Array(
    Buffer.concat([
      signature,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', idat),
      makeChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('OCR preview adapters and boundary tests', () => {
  const syntheticImage = createSyntheticPng();

  test('local preview succeeds with synthetic image and injected mock lines', async () => {
    const output = await previewReceiptOcr(
      {
        imageBytes: syntheticImage,
        provider: 'local',
      },
      {
        localVisionRunner: async () => [
          { text: '상호: 테스트식당', confidence: 0.95 },
          { text: '일시: 2026-11-01 12:30', confidence: 0.92 },
          { text: '합계: 18,000원', confidence: 0.96 },
        ],
      },
    );

    expect(output.engine).toBe('local-vision');
    expect(output.manualReviewRequired).toBe(true);
    expect(output.cloudCalls).toBe(0);
    expect(output.result.store_name).toBe('테스트식당');
    expect(output.result.date).toBe('2026-11-01');
    expect(output.result.time).toBe('12:30');
    expect(output.result.total_amount).toBe(18000);
  });

  test('local preview maps runner timeout to safe TIMEOUT code', async () => {
    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'local',
        },
        {
          localVisionRunner: async () => {
            throw new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT);
          },
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.TIMEOUT));
  });

  test('gemini preview rejects when cloud execution is not enabled in policy', async () => {
    let runnerCalled = false;

    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'gemini',
          costPolicy: { allowFreeCloud: false },
        },
        {
          geminiRunner: async () => {
            runnerCalled = true;
            return '{}';
          },
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.POLICY_DENIED_LOCAL_ONLY));

    expect(runnerCalled).toBe(false);
  });

  test('gemini preview rejects when free tier attestation is missing', async () => {
    let runnerCalled = false;

    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'gemini',
          costPolicy: {
            allowFreeCloud: true,
            geminiFreeTierAttested: false,
          },
        },
        {
          geminiRunner: async () => {
            runnerCalled = true;
            return '{}';
          },
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.GEMINI_FREE_TIER_NOT_ATTESTED));

    expect(runnerCalled).toBe(false);
  });

  test('gemini preview processes structured response when policy is explicitly attested', async () => {
    let receivedMimeType = '';

    const output = await previewReceiptOcr(
      {
        imageBytes: syntheticImage,
        mimeType: 'image/png',
        provider: 'gemini',
        costPolicy: {
          allowFreeCloud: true,
          geminiFreeTierAttested: true,
        },
      },
      {
        geminiRunner: async (input) => {
          receivedMimeType = input.mimeType;
          return JSON.stringify({
            store_name: '제미나이 분식',
            date: '2026-09-10',
            time: '19:15',
            total_amount: 14000,
            confidence: 0.91,
          });
        },
      },
    );

    expect(receivedMimeType).toBe('image/png');
    expect(output.engine).toBe('gemini-preview');
    expect(output.manualReviewRequired).toBe(true);
    expect(output.cloudCalls).toBe(1);
    expect(output.result.store_name).toBe('제미나이 분식');
    expect(output.result.total_amount).toBe(14000);
  });

  test('gemini preview handles malformed response with safe MALFORMED_RESPONSE code and no fallback', async () => {
    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'gemini',
          costPolicy: {
            allowFreeCloud: true,
            geminiFreeTierAttested: true,
          },
        },
        {
          geminiRunner: async () => 'not a json response at all',
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.MALFORMED_RESPONSE));
  });

  test('openai preview denies execution when paid cloud is not explicitly allowed', async () => {
    let runnerCalled = false;

    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'openai',
          costPolicy: { allowPaidCloud: false },
        },
        {
          openAiRunner: async () => {
            runnerCalled = true;
            return '{}';
          },
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.OPENAI_PAID_POLICY_DENIED));

    expect(runnerCalled).toBe(false);
  });

  test('openai preview executes structured /v1/responses format when paid cloud is allowed', async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    const output = await previewReceiptOcr(
      {
        imageBytes: syntheticImage,
        mimeType: 'image/png',
        provider: 'openai',
        costPolicy: { allowPaidCloud: true },
      },
      {
        openAiRunner: async (input) => {
          capturedPayload = input.payload;
          return JSON.stringify({
            store_name: '오픈AI 베이커리',
            date: '2026-10-01',
            time: '08:45',
            total_amount: 8500,
            confidence: 0.97,
            error: null,
          });
        },
      },
    );

    expect(capturedPayload).not.toBeNull();
    // Validate official /v1/responses request structure
    const payload = capturedPayload as any;
    expect(Array.isArray(payload.input)).toBe(true);
    expect(payload.input[0].role).toBe('user');
    expect(payload.input[0].content[0].type).toBe('input_text');
    expect(payload.input[0].content[1].type).toBe('input_image');
    expect(payload.text.format.type).toBe('json_schema');
    expect(payload.text.format.name).toBe('receipt_preview');

    expect(output.engine).toBe('openai-responses-preview');
    expect(output.manualReviewRequired).toBe(true);
    expect(output.cloudCalls).toBe(1);
    expect(output.result.store_name).toBe('오픈AI 베이커리');
    expect(output.result.total_amount).toBe(8500);
  });

  test('openai preview redacts provider error details to safe fixed error code', async () => {
    await expect(
      previewReceiptOcr(
        {
          imageBytes: syntheticImage,
          provider: 'openai',
          costPolicy: { allowPaidCloud: true },
        },
        {
          openAiRunner: async () => {
            throw new Error('Sensitive upstream API key error: sk-1234567890');
          },
        },
      ),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));
  });

  test('createLiveGeminiPreviewRunner ignores GEMINI_CREDITS_API_KEY and requires dedicated GEMINI_OCR_FREE_API_KEY', async () => {
    const runnerWithPaidOnly = createLiveGeminiPreviewRunner({
      costPolicy: { allowFreeCloud: true, geminiFreeTierAttested: true },
      env: { GEMINI_CREDITS_API_KEY: 'paid-key-not-allowed' } as any,
    });

    await expect(
      runnerWithPaidOnly({
        prompt: 'test',
        imageBase64: 'abc',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));

    let fetchCalledWithKey = '';
    const mockFetch = (async (url: string, init: RequestInit) => {
      expect(url).not.toContain('free-dedicated-key');
      fetchCalledWithKey = new Headers(init.headers).get('x-goog-api-key') ?? '';
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"store_name":"무료제미나이"}' }] } }],
      }), { status: 200 });
    }) as any;

    const runnerWithFreeKey = createLiveGeminiPreviewRunner({
      costPolicy: { allowFreeCloud: true, geminiFreeTierAttested: true },
      env: { GEMINI_OCR_FREE_API_KEY: 'free-dedicated-key' } as any,
      fetchFn: mockFetch,
    });

    const result = await runnerWithFreeKey({
      prompt: 'test',
      imageBase64: 'abc',
      mimeType: 'image/png',
    });

    expect(fetchCalledWithKey).toContain('free-dedicated-key');
    expect(result).toBe('{"store_name":"무료제미나이"}');
  });

  test('createLiveOpenAiPreviewRunner sends official /v1/responses and redacts error response', async () => {
    let capturedHeaders: Record<string, string> = {};
    const mockFetch = (async (url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response('Internal error', { status: 500 });
    }) as any;

    const runner = createLiveOpenAiPreviewRunner({
      costPolicy: { allowPaidCloud: true },
      apiKey: 'test-openai-key',
      fetchFn: mockFetch,
    });

    await expect(
      runner({
        model: 'gpt-4o-mini',
        payload: { test: true },
      }),
    ).rejects.toThrow(new OcrPreviewError(OCR_PREVIEW_ERROR_CODES.PROVIDER_ERROR));

    expect(capturedHeaders['Authorization']).toBe('Bearer test-openai-key');
  });
});
