import type {
  NvidiaNimReceiptOcrAttempt,
  NvidiaNimReceiptOcrData,
} from '@/lib/ocr/nvidia-nim';
import type { OcrRoutingProvider } from '@/lib/admin/ai-settings-store';
import type { OcrRestaurantMatchCandidate } from '@/lib/ocr/restaurant-matching';

export const RECEIPT_OCR_NORMALIZATION_VERSION = 'receipt-normalization-v1';

export type OcrFieldTrustLevel = 'high' | 'medium' | 'low';
export type OcrFieldTrustSource =
  | 'model_raw'
  | 'model_candidate'
  | 'selected_restaurant'
  | 'db_exact'
  | 'db_fuzzy'
  | 'rule_validation'
  | 'user_required';

export type OcrFieldTrustField =
  | 'store_name'
  | 'restaurant_id'
  | 'date'
  | 'time'
  | 'total_amount'
  | 'items'
  | 'category'
  | 'review_draft';

export type OcrFieldTrust = {
  field: OcrFieldTrustField;
  rawValue: unknown;
  normalizedValue: unknown;
  confidence: number;
  level: OcrFieldTrustLevel;
  source: OcrFieldTrustSource;
  reason: string;
  needsReview: boolean;
};

export type OcrAppliedCorrection = {
  field: OcrFieldTrustField;
  from: unknown;
  to: unknown;
  reason: string;
};

export type ReceiptOcrEnvelope = {
  raw: {
    provider: OcrRoutingProvider;
    model: string;
    fields: NvidiaNimReceiptOcrData;
    attempts: NvidiaNimReceiptOcrAttempt[];
  };
  normalized: NvidiaNimReceiptOcrData;
  matched_restaurant_candidates: OcrRestaurantMatchCandidate[];
  applied_correction: OcrAppliedCorrection[];
  field_trust: OcrFieldTrust[];
  confidence: number;
  needs_review: OcrFieldTrustField[];
  normalization_version: typeof RECEIPT_OCR_NORMALIZATION_VERSION;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const NON_MENU_PATTERNS = [
  /인\s*원\s*수/,
  /사업자|등록번호|주문번호|승인번호|카드|현금|거스름|받을\s*금액/,
  /합\s*계|세\s*액|과\s*세|면\s*세|부가세/,
  /cashier|pos|table/i,
];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function trustConfidence(level: OcrFieldTrustLevel): number {
  if (level === 'high') return 0.95;
  if (level === 'medium') return 0.72;
  return 0.35;
}

export function isReceiptMetadataItemName(name: string): boolean {
  const normalized = name.replace(/\s+/g, '').trim();
  return !normalized || NON_MENU_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeReceiptItems(
  items: NvidiaNimReceiptOcrData['items'],
): { items?: NonNullable<NvidiaNimReceiptOcrData['items']>; removed: NonNullable<NvidiaNimReceiptOcrData['items']> } {
  const removed: NonNullable<NvidiaNimReceiptOcrData['items']> = [];
  const kept: NonNullable<NvidiaNimReceiptOcrData['items']> = [];

  for (const item of items ?? []) {
    if (isReceiptMetadataItemName(item.name)) {
      removed.push(item);
    } else {
      kept.push(item);
    }
  }

  return { items: kept.length ? kept : undefined, removed };
}

function makeTrust(input: Omit<OcrFieldTrust, 'confidence' | 'needsReview'> & { confidence?: number; needsReview?: boolean }): OcrFieldTrust {
  return {
    ...input,
    confidence: clampConfidence(input.confidence ?? trustConfidence(input.level)),
    needsReview: input.needsReview ?? input.level !== 'high',
  };
}

function pickStoreTrust(input: {
  rawStoreName?: string;
  normalizedStoreName?: string;
  candidate?: OcrRestaurantMatchCandidate;
}): OcrFieldTrust | null {
  if (!input.rawStoreName && !input.normalizedStoreName) return null;

  if (input.candidate?.level === 'high') {
    const source: OcrFieldTrustSource = input.candidate.source === 'selected_restaurant' ? 'selected_restaurant' : 'db_exact';
    return makeTrust({
      field: 'store_name',
      rawValue: input.rawStoreName,
      normalizedValue: input.normalizedStoreName ?? input.candidate.name,
      level: 'high',
      source,
      reason: input.candidate.reason,
    });
  }

  if (input.candidate?.level === 'medium') {
    return makeTrust({
      field: 'store_name',
      rawValue: input.rawStoreName,
      normalizedValue: input.rawStoreName,
      level: 'medium',
      source: 'db_fuzzy',
      reason: input.candidate.reason,
    });
  }

  return makeTrust({
    field: 'store_name',
    rawValue: input.rawStoreName,
    normalizedValue: input.rawStoreName,
    level: 'low',
    source: 'model_raw',
    reason: 'OCR 매장명만 있고 DB canonical 후보가 없어 사용자가 확인해야 합니다.',
  });
}

export function buildReceiptOcrEnvelope(input: {
  provider: OcrRoutingProvider;
  model: string;
  attempts: NvidiaNimReceiptOcrAttempt[];
  data: NvidiaNimReceiptOcrData;
  matchedRestaurantCandidates?: OcrRestaurantMatchCandidate[];
}): ReceiptOcrEnvelope {
  const matchedCandidates = [...(input.matchedRestaurantCandidates ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const topCandidate = matchedCandidates[0];
  const normalized: NvidiaNimReceiptOcrData = { ...input.data };
  const applied: OcrAppliedCorrection[] = [];
  const fieldTrust: OcrFieldTrust[] = [];

  if (topCandidate?.level === 'high' && topCandidate.name && topCandidate.name !== input.data.store_name) {
    applied.push({
      field: 'store_name',
      from: input.data.store_name,
      to: topCandidate.name,
      reason: topCandidate.reason,
    });
    normalized.store_name = topCandidate.name;
  }

  const { items, removed } = normalizeReceiptItems(input.data.items);
  if (removed.length > 0) {
    applied.push({
      field: 'items',
      from: input.data.items,
      to: items ?? [],
      reason: '영수증 메타데이터로 보이는 항목은 메뉴 자동 입력에서 제외했습니다.',
    });
    normalized.items = items;
  }

  const storeTrust = pickStoreTrust({
    rawStoreName: input.data.store_name,
    normalizedStoreName: normalized.store_name,
    candidate: topCandidate,
  });
  if (storeTrust) fieldTrust.push(storeTrust);

  if (topCandidate?.level === 'high') {
    fieldTrust.push(makeTrust({
      field: 'restaurant_id',
      rawValue: null,
      normalizedValue: topCandidate.id,
      level: 'high',
      source: topCandidate.source === 'selected_restaurant' ? 'selected_restaurant' : 'db_exact',
      reason: topCandidate.reason,
    }));
  } else if (topCandidate) {
    fieldTrust.push(makeTrust({
      field: 'restaurant_id',
      rawValue: null,
      normalizedValue: topCandidate.id,
      level: 'medium',
      source: 'db_fuzzy',
      reason: topCandidate.reason,
    }));
  }

  if (input.data.date) {
    fieldTrust.push(makeTrust({
      field: 'date',
      rawValue: input.data.date,
      normalizedValue: input.data.date,
      level: DATE_RE.test(input.data.date) ? 'high' : 'low',
      source: 'rule_validation',
      reason: DATE_RE.test(input.data.date) ? 'YYYY-MM-DD 형식의 방문일입니다.' : '방문일 형식 확인이 필요합니다.',
    }));
  }

  if (input.data.time) {
    fieldTrust.push(makeTrust({
      field: 'time',
      rawValue: input.data.time,
      normalizedValue: input.data.time,
      level: TIME_RE.test(input.data.time) ? 'high' : 'low',
      source: 'rule_validation',
      reason: TIME_RE.test(input.data.time) ? 'HH:MM 형식의 방문 시간입니다.' : '방문 시간 형식 확인이 필요합니다.',
    }));
  }

  if (typeof input.data.total_amount === 'number') {
    fieldTrust.push(makeTrust({
      field: 'total_amount',
      rawValue: input.data.total_amount,
      normalizedValue: input.data.total_amount,
      level: input.data.total_amount > 0 ? 'high' : 'low',
      source: 'rule_validation',
      reason: input.data.total_amount > 0 ? '영수증 총액으로 사용할 수 있는 양수 금액입니다.' : '총액 확인이 필요합니다.',
    }));
  }

  if (input.data.items?.length || removed.length) {
    fieldTrust.push(makeTrust({
      field: 'items',
      rawValue: input.data.items ?? [],
      normalizedValue: normalized.items ?? [],
      level: removed.length ? 'medium' : 'high',
      source: removed.length ? 'rule_validation' : 'model_raw',
      reason: removed.length
        ? '비메뉴 항목을 제외했으므로 메뉴 확인이 필요합니다.'
        : '모델이 추출한 메뉴 항목입니다.',
      needsReview: removed.length > 0,
    }));
  }

  if (input.data.category) {
    fieldTrust.push(makeTrust({
      field: 'category',
      rawValue: input.data.category,
      normalizedValue: normalized.category,
      level: 'medium',
      source: 'model_candidate',
      reason: '카테고리는 메뉴/상호 기반 추론이므로 확인 가능성이 있습니다.',
    }));
  }

  if (input.data.review_draft) {
    fieldTrust.push(makeTrust({
      field: 'review_draft',
      rawValue: input.data.review_draft,
      normalizedValue: input.data.review_draft,
      level: 'medium',
      source: 'model_candidate',
      reason: '리뷰 초안은 생성 문장이라 사용자 확인이 필요합니다.',
    }));
  }

  const needsReview = Array.from(new Set(fieldTrust.filter((field) => field.needsReview).map((field) => field.field)));
  const confidence = fieldTrust.length
    ? clampConfidence(fieldTrust.reduce((sum, field) => sum + field.confidence, 0) / fieldTrust.length)
    : clampConfidence(input.data.confidence ?? 0);

  return {
    raw: {
      provider: input.provider,
      model: input.model,
      fields: input.data,
      attempts: input.attempts,
    },
    normalized,
    matched_restaurant_candidates: matchedCandidates,
    applied_correction: applied,
    field_trust: fieldTrust,
    confidence,
    needs_review: needsReview,
    normalization_version: RECEIPT_OCR_NORMALIZATION_VERSION,
  };
}

export function flattenReceiptOcrEnvelope(envelope: ReceiptOcrEnvelope): NvidiaNimReceiptOcrData & ReceiptOcrEnvelope {
  return {
    ...envelope.normalized,
    ...envelope,
  };
}
