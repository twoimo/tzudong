import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  extractJsonObject,
  normalizeNvidiaNimOcrData,
  type NvidiaNimReceiptOcrAttempt,
  type NvidiaNimReceiptOcrData,
  type NvidiaNimReceiptOcrResult,
} from '@/lib/ocr/nvidia-nim';

export const GEMINI_OCR_DEFAULT_MODEL = 'gemini-3-flash-preview';

export class GeminiOcrError extends Error {
  attempts: NvidiaNimReceiptOcrAttempt[];

  constructor(attempts: NvidiaNimReceiptOcrAttempt[]) {
    super('Gemini OCR 호출 실패');
    this.name = 'GeminiOcrError';
    this.attempts = attempts;
  }
}

export function getGeminiOcrModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.GEMINI_OCR_MODEL
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  if (configured?.length) return configured;
  return [GEMINI_OCR_DEFAULT_MODEL];
}

export function buildGeminiReceiptOcrParts(input: {
  prompt: string;
  imageBase64: string;
  mimeType: string;
}) {
  return [
    { text: input.prompt },
    { inlineData: { data: input.imageBase64, mimeType: input.mimeType } },
  ];
}

type GeminiGenerateContentImpl = (input: {
  model: string;
  parts: ReturnType<typeof buildGeminiReceiptOcrParts>;
  signal?: AbortSignal;
}) => Promise<string>;

function parseTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.GEMINI_OCR_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 30_000) return parsed;
  return 12_000;
}

async function generateWithSdk(input: {
  apiKey: string;
  model: string;
  parts: ReturnType<typeof buildGeminiReceiptOcrParts>;
}) {
  const genAI = new GoogleGenerativeAI(input.apiKey);
  const model = genAI.getGenerativeModel({
    model: input.model,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });
  const result = await model.generateContent(input.parts);
  return result.response.text();
}

export async function callGeminiReceiptOcr(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  generateContentImpl?: GeminiGenerateContentImpl;
}): Promise<NvidiaNimReceiptOcrResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error('Gemini OCR API 키가 설정되지 않았습니다.');

  const env = input.env ?? process.env;
  const timeoutMs = parseTimeoutMs(env);
  const attempts: NvidiaNimReceiptOcrAttempt[] = [];

  for (const model of getGeminiOcrModels(env)) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      if (input.signal?.aborted) controller.abort();
      const parts = buildGeminiReceiptOcrParts({
        prompt: input.prompt,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
      });
      const text = await (input.generateContentImpl
        ? input.generateContentImpl({ model, parts, signal: controller.signal })
        : generateWithSdk({ apiKey, model, parts }));
      const data: NvidiaNimReceiptOcrData = normalizeNvidiaNimOcrData(extractJsonObject(text));
      attempts.push({ model, ok: true, elapsedMs: Date.now() - startedAt });
      return { data, model, attempts };
    } catch (error) {
      attempts.push({
        model,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error && error.name === 'AbortError'
          ? `timeout ${timeoutMs}ms`
          : error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw new GeminiOcrError(attempts);
}
