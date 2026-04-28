import type { ReviewOcrFieldKey } from '@/lib/ocr/review-modal-ocr-ux';

export const RECEIPT_EVIDENCE_MIN_SCALE = 1;
export const RECEIPT_EVIDENCE_MAX_SCALE = 4;
export const RECEIPT_EVIDENCE_SCALE_STEP = 0.5;

export type ReceiptEvidenceSource = ReviewOcrFieldKey | 'receipt';

export type ReceiptEvidencePoint = { x: number; y: number };

export type ReceiptEvidenceBounds = {
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
};

const RECEIPT_EVIDENCE_SOURCE_LABELS: Record<ReceiptEvidenceSource, string> = {
  receipt: '영수증 사진',
  restaurant: '방문 맛집',
  date: '방문 날짜',
  time: '방문 시간',
  category: '카테고리',
  review: '리뷰 내용',
};

export function clampReceiptEvidenceScale(scale: number): number {
  if (!Number.isFinite(scale)) return RECEIPT_EVIDENCE_MIN_SCALE;
  return Math.min(RECEIPT_EVIDENCE_MAX_SCALE, Math.max(RECEIPT_EVIDENCE_MIN_SCALE, scale));
}

export function nextReceiptEvidenceScale(scale: number, direction: 'in' | 'out'): number {
  const delta = direction === 'in' ? RECEIPT_EVIDENCE_SCALE_STEP : -RECEIPT_EVIDENCE_SCALE_STEP;
  return clampReceiptEvidenceScale(Number((scale + delta).toFixed(2)));
}

export function canPanReceiptEvidence(scale: number): boolean {
  return clampReceiptEvidenceScale(scale) > RECEIPT_EVIDENCE_MIN_SCALE;
}

export function getReceiptEvidenceMaxPan(bounds: ReceiptEvidenceBounds): ReceiptEvidencePoint {
  const scale = clampReceiptEvidenceScale(bounds.scale);
  if (
    scale <= RECEIPT_EVIDENCE_MIN_SCALE ||
    !Number.isFinite(bounds.viewportWidth) ||
    !Number.isFinite(bounds.viewportHeight) ||
    bounds.viewportWidth <= 0 ||
    bounds.viewportHeight <= 0
  ) {
    return { x: 0, y: 0 };
  }

  return {
    x: bounds.viewportWidth * (scale - 1) / 2,
    y: bounds.viewportHeight * (scale - 1) / 2,
  };
}

export function clampReceiptEvidencePan(point: ReceiptEvidencePoint, bounds: ReceiptEvidenceBounds): ReceiptEvidencePoint {
  const maxPan = getReceiptEvidenceMaxPan(bounds);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { x: 0, y: 0 };
  }

  const x = Math.min(maxPan.x, Math.max(-maxPan.x, point.x));
  const y = Math.min(maxPan.y, Math.max(-maxPan.y, point.y));
  return {
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  };
}

export function getReceiptEvidenceSourceLabel(source: ReceiptEvidenceSource): string {
  return RECEIPT_EVIDENCE_SOURCE_LABELS[source];
}

export function getReceiptEvidenceTitle(source: ReceiptEvidenceSource): string {
  return source === 'receipt'
    ? '영수증 사진 크게 보기'
    : `${getReceiptEvidenceSourceLabel(source)} AI 입력 근거 확인`;
}
