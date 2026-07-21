import { GoogleGenAI, type ThinkingLevel } from '@google/genai';
import {
  extractJsonObject,
  normalizeReceiptOcrData,
  type ReceiptOcrAttempt,
  type ReceiptOcrData,
  type ReceiptOcrResult,
} from '@/lib/ocr/types';

export const GEMINI_OCR_FALLBACK_MODEL = 'gemini-3.6-flash';
export const GEMINI_OCR_DEFAULT_THINKING_LEVEL = 'MEDIUM';
export type GeminiOcrThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export class GeminiOcrError extends Error {
  attempts: ReceiptOcrAttempt[];

  constructor(attempts: ReceiptOcrAttempt[]) {
    super('Gemini OCR 호출 실패');
    this.name = 'GeminiOcrError';
    this.attempts = attempts;
  }
}

function sanitizeCsv(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean) ?? [];
}

export function getGeminiOcrDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_OCR_DEFAULT_MODEL?.trim() || GEMINI_OCR_FALLBACK_MODEL;
}

export function getGeminiOcrModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = sanitizeCsv(env.GEMINI_OCR_MODEL);
  if (configured.length) return configured;
  return [getGeminiOcrDefaultModel(env)];
}

export function getGeminiOcrThinkingLevel(env: NodeJS.ProcessEnv = process.env): GeminiOcrThinkingLevel {
  const configured = (env.GEMINI_OCR_THINKING_LEVEL ?? env.GEMINI_THINKING_LEVEL ?? '').trim().toUpperCase();
  return configured === 'LOW' || configured === 'MEDIUM' || configured === 'HIGH'
    ? configured
    : GEMINI_OCR_DEFAULT_THINKING_LEVEL;
}
export function toGeminiThinkingLevel(thinkingLevel: GeminiOcrThinkingLevel): ThinkingLevel {
  return thinkingLevel as ThinkingLevel;
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
  thinkingLevel: GeminiOcrThinkingLevel;
  parts: ReturnType<typeof buildGeminiReceiptOcrParts>;
  signal?: AbortSignal;
}) => Promise<string>;

function parseTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.GEMINI_OCR_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 30_000) return parsed;
  return 12_000;
}

export function buildGeminiReceiptOcrRequest(input: {
  model: string;
  thinkingLevel: GeminiOcrThinkingLevel;
  parts: ReturnType<typeof buildGeminiReceiptOcrParts>;
  signal?: AbortSignal;
}) {
  return {
    model: input.model,
    contents: [{ role: 'user' as const, parts: input.parts }],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: toGeminiThinkingLevel(input.thinkingLevel) },
      abortSignal: input.signal,
    },
  };
}

async function generateWithSdk(input: {
  apiKey: string;
  model: string;
  thinkingLevel: GeminiOcrThinkingLevel;
  parts: ReturnType<typeof buildGeminiReceiptOcrParts>;
  signal?: AbortSignal;
}) {
  const genAI = new GoogleGenAI({ apiKey: input.apiKey });
  const response = await genAI.models.generateContent(buildGeminiReceiptOcrRequest(input));
  if (typeof response.text !== 'string') {
    throw new Error('Gemini OCR 응답 텍스트가 없습니다.');
  }
  return response.text;
}

export async function callGeminiReceiptOcr(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  generateContentImpl?: GeminiGenerateContentImpl;
}): Promise<ReceiptOcrResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error('Gemini OCR API 키가 설정되지 않았습니다.');

  const env = input.env ?? process.env;
  const timeoutMs = parseTimeoutMs(env);
  const thinkingLevel = getGeminiOcrThinkingLevel(env);
  const attempts: ReceiptOcrAttempt[] = [];

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
        ? input.generateContentImpl({ model, thinkingLevel, parts, signal: controller.signal })
        : generateWithSdk({ apiKey, model, thinkingLevel, parts, signal: controller.signal }));
      const data: ReceiptOcrData = normalizeReceiptOcrData(extractJsonObject(text));
      attempts.push({ model, ok: true, elapsedMs: Date.now() - startedAt });
      return { data, model, attempts };
    } catch (error) {
      attempts.push({
        model,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error && error.name === 'AbortError'
          ? `timeout ${timeoutMs}ms`
          : 'provider_request_failed',
      });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw new GeminiOcrError(attempts);
}
