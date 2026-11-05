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

export const INTERRUPTED_OCR_READBACK_ATTEMPTS = 4;
export const INTERRUPTED_OCR_READBACK_DELAY_MS = 750;

type InterruptedOcrReadbackInput<T> = {
  signal: AbortSignal;
  readStatus: () => Promise<T>;
  isProcessingError: (error: unknown) => boolean;
  attempts?: number;
  delayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

function waitForOcrReadbackRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('OCR result readback cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function reconcileInterruptedOcrReadback<T>(
  input: InterruptedOcrReadbackInput<T>,
): Promise<T> {
  const attempts = Math.max(1, Math.min(
    input.attempts ?? INTERRUPTED_OCR_READBACK_ATTEMPTS,
    INTERRUPTED_OCR_READBACK_ATTEMPTS,
  ));
  const delayMs = Math.max(0, Math.min(
    input.delayMs ?? INTERRUPTED_OCR_READBACK_DELAY_MS,
    INTERRUPTED_OCR_READBACK_DELAY_MS,
  ));
  const wait = input.wait ?? waitForOcrReadbackRetry;
  let lastProcessingError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    input.signal.throwIfAborted();
    try {
      const result = await input.readStatus();
      input.signal.throwIfAborted();
      return result;
    } catch (error) {
      input.signal.throwIfAborted();
      if (!input.isProcessingError(error)) throw error;
      lastProcessingError = error;
      if (attempt + 1 < attempts) await wait(delayMs, input.signal);
    }
  }

  throw lastProcessingError;
}

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
