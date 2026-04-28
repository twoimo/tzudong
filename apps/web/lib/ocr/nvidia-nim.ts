export const NIM_OCR_DEFAULT_MODEL = 'meta/llama-4-maverick-17b-128e-instruct';
export const NIM_OCR_FALLBACK_MODEL = 'mistralai/mistral-small-4-119b-2603';
export const NIM_OCR_SECOND_FALLBACK_MODEL = 'nvidia/nemotron-nano-12b-v2-vl';

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 10_000;
const DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

const VALID_CATEGORIES = new Set([
  '치킨',
  '중식',
  '돈까스·회',
  '피자',
  '패스트푸드',
  '찜·탕',
  '족발·보쌈',
  '분식',
  '카페·디저트',
  '한식',
  '고기',
  '양식',
  '아시안',
  '야식',
  '도시락',
]);

export interface NvidiaNimReceiptOcrData {
  store_name?: string;
  date?: string;
  time?: string;
  total_amount?: number;
  category?: string;
  review_draft?: string;
  items?: Array<{ name: string; price: number | null }>;
  confidence?: number;
  error?: string;
}

export interface NvidiaNimReceiptOcrAttempt {
  model: string;
  ok: boolean;
  status?: number;
  elapsedMs: number;
  error?: string;
}

export interface NvidiaNimReceiptOcrResult {
  data: NvidiaNimReceiptOcrData;
  model: string;
  attempts: NvidiaNimReceiptOcrAttempt[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: string };
  detail?: string;
}

interface ChatCompletionStreamResponse {
  choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
  error?: { message?: string };
  detail?: string;
}

export class NvidiaNimOcrError extends Error {
  attempts: NvidiaNimReceiptOcrAttempt[];

  constructor(attempts: NvidiaNimReceiptOcrAttempt[]) {
    super('NVIDIA NIM OCR 호출 실패');
    this.name = 'NvidiaNimOcrError';
    this.attempts = attempts;
  }
}

export function getNvidiaNimOcrModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.NVIDIA_NIM_OCR_MODEL
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  if (configured?.length) return configured;

  return [
    NIM_OCR_DEFAULT_MODEL,
    NIM_OCR_FALLBACK_MODEL,
  ];
}

function parseTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.NVIDIA_NIM_OCR_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 12_000) {
    return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

function parseTotalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.NVIDIA_NIM_OCR_TOTAL_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 2_000 && parsed <= 20_000) {
    return parsed;
  }
  return DEFAULT_TOTAL_TIMEOUT_MS;
}

function dataUrl(mimeType: string, imageBase64: string): string {
  return `data:${mimeType};base64,${imageBase64}`;
}

export function buildNvidiaNimOcrPayload(input: {
  model: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
  stream?: boolean;
}) {
  return {
    model: input.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'image_url', image_url: { url: dataUrl(input.mimeType, input.imageBase64) } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 900,
    ...(input.stream ? { stream: true } : {}),
  };
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) {
    throw new Error('OCR 파싱 실패: JSON 형식을 찾을 수 없습니다.');
  }

  return JSON.parse(candidate);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.replace(/[^0-9.-]/g, '');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toConfidence(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === undefined) return undefined;
  if (parsed > 1 && parsed <= 100) return Math.round(parsed) / 100;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (VALID_CATEGORIES.has(trimmed)) return trimmed;
  if (/카페|커피|디저트|빵|베이커리/.test(trimmed)) return '카페·디저트';
  if (/초밥|스시|회|돈까스|돈가스/.test(trimmed)) return '돈까스·회';
  if (/고기|삼겹|갈비|소고기|돼지/.test(trimmed)) return '고기';
  if (/중식|짜장|짬뽕|탕수육/.test(trimmed)) return '중식';
  return undefined;
}

function normalizeItems(value: unknown): Array<{ name: string; price: number | null }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) return null;
      return { name, price: toNumber(raw.price) ?? null };
    })
    .filter((item): item is { name: string; price: number | null } => Boolean(item));

  return items.length ? items : undefined;
}

function inferReceiptCategoryFromText(input: {
  storeName?: string;
  category?: string;
  items?: Array<{ name: string; price: number | null }>;
}): string | undefined {
  const text = [
    input.storeName,
    input.category,
    ...(input.items?.map((item) => item.name) ?? []),
  ].filter(Boolean).join(' ');

  if (/초밥|스시|사시미|회덮밥|참치회|연어회|광어회/.test(text)) return '돈까스·회';
  return input.category;
}

export function normalizeNvidiaNimOcrData(raw: Record<string, unknown>): NvidiaNimReceiptOcrData {
  const error = typeof raw.error === 'string' ? raw.error : undefined;
  if (error) {
    return { error, confidence: toConfidence(raw.confidence) ?? 0 };
  }

  const storeName = typeof raw.store_name === 'string' ? raw.store_name.trim() : undefined;
  const items = normalizeItems(raw.items);
  const normalizedCategory = normalizeCategory(raw.category);
  const normalized: NvidiaNimReceiptOcrData = {
    store_name: storeName,
    date: typeof raw.date === 'string' ? raw.date.trim() : undefined,
    time: typeof raw.time === 'string' ? raw.time.trim() : undefined,
    total_amount: toNumber(raw.total_amount),
    category: inferReceiptCategoryFromText({ storeName, category: normalizedCategory, items }),
    review_draft: typeof raw.review_draft === 'string' ? raw.review_draft.trim() : undefined,
    items,
    confidence: toConfidence(raw.confidence),
  };

  Object.keys(normalized).forEach((key) => {
    if (normalized[key as keyof NvidiaNimReceiptOcrData] === undefined) {
      delete normalized[key as keyof NvidiaNimReceiptOcrData];
    }
  });

  return normalized;
}

function formatNimError(body: ChatCompletionResponse | null, fallback: string): string {
  return body?.error?.message || body?.detail || fallback;
}


export function parseNvidiaNimStreamChunk(chunk: string): string[] {
  const deltas: string[] = [];

  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;

    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(payload) as ChatCompletionStreamResponse;
      const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content) {
        deltas.push(content);
      }
    } catch {
      // Ignore non-JSON frames.
    }
  }

  return deltas;
}

function extractJsonStringField(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function extractJsonNumberField(text: string, key: string): number | undefined {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*(-?[0-9][0-9,.]*)`));
  if (!match) return undefined;
  return toNumber(match[1]);
}

export function extractPartialNvidiaNimOcrData(text: string): NvidiaNimReceiptOcrData {
  try {
    return normalizeNvidiaNimOcrData(extractJsonObject(text));
  } catch {
    const partial: NvidiaNimReceiptOcrData = {
      store_name: extractJsonStringField(text, 'store_name'),
      date: extractJsonStringField(text, 'date'),
      time: extractJsonStringField(text, 'time'),
      total_amount: extractJsonNumberField(text, 'total_amount'),
      category: normalizeCategory(extractJsonStringField(text, 'category')),
      review_draft: extractJsonStringField(text, 'review_draft'),
      confidence: extractJsonNumberField(text, 'confidence'),
    };

    Object.keys(partial).forEach((key) => {
      if (partial[key as keyof NvidiaNimReceiptOcrData] === undefined) {
        delete partial[key as keyof NvidiaNimReceiptOcrData];
      }
    });

    return partial;
  }
}

export async function callNvidiaNimReceiptOcrStreaming(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onDelta?: (delta: string, accumulatedText: string, model: string) => void;
  onAttempt?: (attempt: NvidiaNimReceiptOcrAttempt) => void;
}): Promise<NvidiaNimReceiptOcrResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error('NVIDIA_NIM_API_KEY 환경변수가 설정되지 않았습니다.');

  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  const endpoint = env.NVIDIA_NIM_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const models = getNvidiaNimOcrModels(env);
  const timeoutMs = parseTimeoutMs(env);
  const totalTimeoutMs = parseTotalTimeoutMs(env);
  const overallStartedAt = Date.now();
  const attempts: NvidiaNimReceiptOcrAttempt[] = [];

  for (const model of models) {
    const remainingMs = totalTimeoutMs - (Date.now() - overallStartedAt);
    if (remainingMs <= 0) {
      const attempt = { model, ok: false, elapsedMs: 0, error: `total timeout ${totalTimeoutMs}ms` };
      attempts.push(attempt);
      input.onAttempt?.(attempt);
      break;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const modelTimeoutMs = Math.min(timeoutMs, remainingMs);
    const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      if (input.signal?.aborted) {
        controller.abort();
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildNvidiaNimOcrPayload({
          model,
          prompt: input.prompt,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
          stream: true,
        })),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        let body: ChatCompletionResponse | null = null;
        try {
          body = JSON.parse(text) as ChatCompletionResponse;
        } catch {
          body = null;
        }
        const attempt = {
          model,
          ok: false,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          error: formatNimError(body, text.slice(0, 240) || `HTTP ${response.status}`),
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt);
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const parts = buffered.split(/\r?\n\r?\n/);
        buffered = parts.pop() ?? '';

        for (const part of parts) {
          for (const delta of parseNvidiaNimStreamChunk(part)) {
            accumulated += delta;
            input.onDelta?.(delta, accumulated, model);
          }
        }
      }

      for (const delta of parseNvidiaNimStreamChunk(buffered + decoder.decode())) {
        accumulated += delta;
        input.onDelta?.(delta, accumulated, model);
      }

      if (!accumulated.trim()) {
        const attempt = {
          model,
          ok: false,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          error: 'NVIDIA NIM 스트림 응답에 OCR 텍스트가 없습니다.',
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt);
        continue;
      }

      const data = normalizeNvidiaNimOcrData(extractJsonObject(accumulated));
      const attempt = { model, ok: true, status: response.status, elapsedMs: Date.now() - startedAt };
      attempts.push(attempt);
      input.onAttempt?.(attempt);
      return { data, model, attempts };
    } catch (error) {
      const attempt = {
        model,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error && error.name === 'AbortError'
          ? `timeout ${modelTimeoutMs}ms`
          : error instanceof Error ? error.message : String(error),
      };
      attempts.push(attempt);
      input.onAttempt?.(attempt);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw new NvidiaNimOcrError(attempts);
}

export async function callNvidiaNimReceiptOcr(input: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<NvidiaNimReceiptOcrResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error('NVIDIA_NIM_API_KEY 환경변수가 설정되지 않았습니다.');

  const fetchImpl = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  const endpoint = env.NVIDIA_NIM_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const models = getNvidiaNimOcrModels(env);
  const timeoutMs = parseTimeoutMs(env);
  const totalTimeoutMs = parseTotalTimeoutMs(env);
  const overallStartedAt = Date.now();
  const attempts: NvidiaNimReceiptOcrAttempt[] = [];

  for (const model of models) {
    const remainingMs = totalTimeoutMs - (Date.now() - overallStartedAt);
    if (remainingMs <= 0) {
      attempts.push({ model, ok: false, elapsedMs: 0, error: `total timeout ${totalTimeoutMs}ms` });
      break;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const modelTimeoutMs = Math.min(timeoutMs, remainingMs);
    const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildNvidiaNimOcrPayload({
          model,
          prompt: input.prompt,
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        })),
      });

      const text = await response.text();
      let body: ChatCompletionResponse | null = null;
      try {
        body = JSON.parse(text) as ChatCompletionResponse;
      } catch {
        body = null;
      }

      if (!response.ok) {
        attempts.push({
          model,
          ok: false,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          error: formatNimError(body, text.slice(0, 240) || `HTTP ${response.status}`),
        });
        continue;
      }

      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        attempts.push({
          model,
          ok: false,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          error: 'NVIDIA NIM 응답에 OCR 텍스트가 없습니다.',
        });
        continue;
      }

      const data = normalizeNvidiaNimOcrData(extractJsonObject(content));
      attempts.push({ model, ok: true, status: response.status, elapsedMs: Date.now() - startedAt });
      return { data, model, attempts };
    } catch (error) {
      attempts.push({
        model,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error && error.name === 'AbortError'
          ? `timeout ${modelTimeoutMs}ms`
          : error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new NvidiaNimOcrError(attempts);
}
