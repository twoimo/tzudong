export type OcrProgressStage =
  | 'prepare'
  | 'cache'
  | 'preprocess'
  | 'model_start'
  | 'model_retry'
  | 'patching'
  | 'fallback'
  | 'finalize'
  | 'done'
  | 'error';

export type ReviewOcrFieldKey = 'restaurant' | 'date' | 'time' | 'category' | 'review';

export const OCR_PROGRESS_STEPS: Array<{ stage: OcrProgressStage; label: string }> = [
  { stage: 'prepare', label: '준비' },
  { stage: 'preprocess', label: '이미지' },
  { stage: 'model_start', label: 'AI 분석' },
  { stage: 'patching', label: '자동 입력' },
  { stage: 'finalize', label: '확인' },
];

const STAGE_RANK: Record<OcrProgressStage, number> = {
  prepare: 0,
  cache: 1,
  preprocess: 1,
  model_start: 2,
  model_retry: 2,
  patching: 3,
  fallback: 3,
  finalize: 4,
  done: 5,
  error: -1,
};

export function getOcrProgressRank(stage: OcrProgressStage | undefined): number {
  return stage ? STAGE_RANK[stage] ?? 0 : 0;
}

export function shouldSuppressOcrAutoNavigation(input: {
  lastManualInteractionAt: number;
  userStepOverride: boolean;
  now?: number;
  editingWindowMs?: number;
}): boolean {
  if (input.userStepOverride) return true;
  if (!input.lastManualInteractionAt) return false;

  const now = input.now ?? Date.now();
  const editingWindowMs = input.editingWindowMs ?? 4_000;
  return now - input.lastManualInteractionAt < editingWindowMs;
}

export function addAiFilledField(
  fields: ReadonlySet<ReviewOcrFieldKey>,
  field: ReviewOcrFieldKey,
): Set<ReviewOcrFieldKey> {
  if (fields.has(field)) return new Set(fields);
  return new Set([...fields, field]);
}

export type ReviewOcrFieldTrustLike = {
  field?: string;
  level?: 'high' | 'medium' | 'low';
  source?: string;
};

export function canReplaceSelectedRestaurantFromOcr(input: {
  hasSelectedRestaurant: boolean;
  manuallyEditedRestaurant: boolean;
  fieldTrust?: ReviewOcrFieldTrustLike[];
}): boolean {
  if (input.manuallyEditedRestaurant) return false;
  if (!input.hasSelectedRestaurant) return true;
  return Boolean(input.fieldTrust?.some((field) => (
    (field.field === 'restaurant_id' || field.field === 'store_name')
    && field.level === 'high'
    && field.source !== 'db_fuzzy'
    && field.source !== 'model_raw'
  )));
}
