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

export interface ReceiptOcrData {
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

export interface ReceiptOcrAttempt {
  model: string;
  ok: boolean;
  status?: number;
  elapsedMs: number;
  error?: string;
}

export interface ReceiptOcrResult {
  data: ReceiptOcrData;
  model: string;
  attempts: ReceiptOcrAttempt[];
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

export function normalizeReceiptOcrData(raw: Record<string, unknown>): ReceiptOcrData {
  const error = typeof raw.error === 'string' ? raw.error : undefined;
  if (error) {
    return { error, confidence: toConfidence(raw.confidence) ?? 0 };
  }

  const storeName = typeof raw.store_name === 'string' ? raw.store_name.trim() : undefined;
  const items = normalizeItems(raw.items);
  const normalizedCategory = normalizeCategory(raw.category);
  const normalized: ReceiptOcrData = {
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
    if (normalized[key as keyof ReceiptOcrData] === undefined) {
      delete normalized[key as keyof ReceiptOcrData];
    }
  });

  return normalized;
}
