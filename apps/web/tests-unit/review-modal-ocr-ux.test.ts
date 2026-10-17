import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  addAiFilledField,
  getOcrProgressRank,
  INTERRUPTED_OCR_READBACK_ATTEMPTS,
  reconcileInterruptedOcrReadback,
  shouldSuppressOcrAutoNavigation,
  type ReviewOcrFieldKey,
} from '@/lib/ocr/review-modal-ocr-ux';

const reviewModalSource = readFileSync(new URL('../components/reviews/ReviewModal.tsx', import.meta.url), 'utf8');

describe('review modal OCR UX helpers', () => {
  test('suppresses automatic OCR navigation while the user is actively editing', () => {
    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 10_000,
      now: 12_500,
      userStepOverride: false,
    })).toBe(true);

    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 10_000,
      now: 15_001,
      userStepOverride: false,
    })).toBe(false);
  });

  test('keeps automatic OCR navigation disabled after manual step movement', () => {
    expect(shouldSuppressOcrAutoNavigation({
      lastManualInteractionAt: 0,
      now: 20_000,
      userStepOverride: true,
    })).toBe(true);
  });

  test('tracks persistent AI-filled field markers without mutating previous sets', () => {
    const initial = new Set<ReviewOcrFieldKey>(['date']);
    const next = addAiFilledField(initial, 'review');

    expect([...initial]).toEqual(['date']);
    expect([...next].sort()).toEqual(['date', 'review']);
  });

  test('orders progress stages for the compact SSE timeline', () => {
    expect(getOcrProgressRank('prepare')).toBeLessThan(getOcrProgressRank('model_start'));
    expect(getOcrProgressRank('patching')).toBeLessThan(getOcrProgressRank('done'));
  });

  test('recovers an interrupted stream by bounded status reads without starting another model request', async () => {
    const controller = new AbortController();
    const processing = Object.assign(new Error('still processing'), { code: 'OCR_RESULT_PROCESSING' });
    const expected = { ocr_result_ref: '11111111-1111-4111-8111-111111111111' };
    let statusReads = 0;
    let waits = 0;
    let modelRequests = 0;

    const result = await reconcileInterruptedOcrReadback({
      signal: controller.signal,
      readStatus: async () => {
        statusReads += 1;
        if (statusReads < 3) throw processing;
        return expected;
      },
      isProcessingError: error => (error as { code?: string }).code === 'OCR_RESULT_PROCESSING',
      wait: async () => { waits += 1; },
    });

    expect(result).toBe(expected);
    expect({ statusReads, waits, modelRequests }).toEqual({ statusReads: 3, waits: 2, modelRequests: 0 });
  });

  test('keeps indeterminate interrupted streams fail-closed without retrying or resending', async () => {
    const indeterminate = Object.assign(new Error('dispatch outcome unknown'), { code: 'OCR_RESULT_INDETERMINATE' });
    let statusReads = 0;
    let waits = 0;

    await expect(reconcileInterruptedOcrReadback({
      signal: new AbortController().signal,
      readStatus: async () => { statusReads += 1; throw indeterminate; },
      isProcessingError: error => (error as { code?: string }).code === 'OCR_RESULT_PROCESSING',
      wait: async () => { waits += 1; },
    })).rejects.toBe(indeterminate);
    expect({ statusReads, waits }).toEqual({ statusReads: 1, waits: 0 });
  });

  test('caps interrupted-stream processing reconciliation at four status reads', async () => {
    const processing = Object.assign(new Error('still processing'), { code: 'OCR_RESULT_PROCESSING' });
    let statusReads = 0;
    let waits = 0;

    await expect(reconcileInterruptedOcrReadback({
      signal: new AbortController().signal,
      attempts: 99,
      delayMs: 0,
      readStatus: async () => { statusReads += 1; throw processing; },
      isProcessingError: error => (error as { code?: string }).code === 'OCR_RESULT_PROCESSING',
      wait: async () => { waits += 1; },
    })).rejects.toBe(processing);
    expect(statusReads).toBe(INTERRUPTED_OCR_READBACK_ATTEMPTS);
    expect(waits).toBe(INTERRUPTED_OCR_READBACK_ATTEMPTS - 1);
  });

  test('stops interrupted-stream reconciliation when the current receipt is cancelled', async () => {
    const controller = new AbortController();
    const processing = Object.assign(new Error('still processing'), { code: 'OCR_RESULT_PROCESSING' });
    let statusReads = 0;

    await expect(reconcileInterruptedOcrReadback({
      signal: controller.signal,
      readStatus: async () => { statusReads += 1; throw processing; },
      isProcessingError: error => (error as { code?: string }).code === 'OCR_RESULT_PROCESSING',
      wait: async () => { controller.abort(); controller.signal.throwIfAborted(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(statusReads).toBe(1);
  });
});

describe('review modal OCR selected restaurant guard', () => {
  test('does not replace selected restaurant from fuzzy OCR-only match', async () => {
    const { canReplaceSelectedRestaurantFromOcr } = await import('@/lib/ocr/review-modal-ocr-ux');

    expect(canReplaceSelectedRestaurantFromOcr({
      hasSelectedRestaurant: true,
      manuallyEditedRestaurant: false,
      fieldTrust: [{ field: 'store_name', level: 'medium', source: 'db_fuzzy' }],
    })).toBe(false);

    expect(canReplaceSelectedRestaurantFromOcr({
      hasSelectedRestaurant: true,
      manuallyEditedRestaurant: false,
      fieldTrust: [{ field: 'store_name', level: 'high', source: 'db_exact' }],
    })).toBe(true);
  });
});

describe('review modal OCR terminal recovery contract', () => {
  test('keeps the receipt photo attached and reuses one terminal notice helper', () => {
    expect(reviewModalSource).toContain('사진만 첨부하고 직접 입력');
    expect(reviewModalSource).toContain('다시 분석');
    expect(reviewModalSource).toContain('void analyzeReceipt(verificationPhoto)');
    expect(reviewModalSource).toContain('disabled={!verificationPhoto || isAnalyzing || ocrLimitReached}');

    expect(reviewModalSource.match(/const renderOcrFallbackNotice = \(\) =>/g)).toHaveLength(1);
    expect(reviewModalSource.match(/\{renderOcrFallbackNotice\(\)\}/g)).toHaveLength(3);
    expect(reviewModalSource).toContain("const isTerminalError = ocrFallbackNotice.type === 'error'");
    expect(reviewModalSource).toContain('terminal?: boolean');
    expect(reviewModalSource).toContain('status?: number');
    expect(reviewModalSource).toContain('if (parsed.payload.terminal)');
    expect(reviewModalSource).toContain('new OcrStreamHttpError(streamErrorMessage, parsed.payload.status ?? 422, parsed.payload.code)');
  });

  test('never resends a receipt after a dropped stream or a durable pending result', () => {
    expect(reviewModalSource).toContain("['FEATURE_DATABASE_HELD', 'OCR_RESULT_PROCESSING', 'OCR_RESULT_INDETERMINATE']");
    expect(reviewModalSource).toContain("type: 'pending'");
    expect(reviewModalSource).toContain('분석 연결이 끊겨 저장된 결과를 확인하고 있어요.');
    expect(reviewModalSource).toContain("fetch('/api/ocr/results/status'");
    expect(reviewModalSource).toContain('reconcileInterruptedOcrReadback({');
    expect(reviewModalSource).toContain('void analyzeReceipt(verificationPhoto, undefined, true)');
    expect(reviewModalSource).toContain('결과 확인');
    expect(reviewModalSource).toContain('statusOnly\n                    ? await readReceiptOcrStatus');
    expect(reviewModalSource).not.toContain("fetch('/api/ocr/extract',");
  });

  test('routes every photo-only choice through the current OCR intent cancellation boundary', () => {
    expect(reviewModalSource).toContain('const verificationInputModeRef = useRef<VerificationInputMode>("ai")');
    expect(reviewModalSource).toContain('receiptOcrPreparationRef.current.invalidate()');
    expect(reviewModalSource).toContain('userStepOverrideDuringOcrRef.current = true');
    expect(reviewModalSource).toContain('setOcrResultRef(null)');
    expect(reviewModalSource).toContain('setOcrResultRevision(null)');
    expect(reviewModalSource).toContain('ocrResultRef: null');
    expect(reviewModalSource).toContain('ocrResultRevision: null');
    expect(reviewModalSource).toContain('ocrAbortControllerRef.current?.abort()');
    expect(reviewModalSource.match(/onClick=\{\(\) => setReceiptVerificationInputMode\("manual"\)\}/g)).toHaveLength(3);
    expect(reviewModalSource).not.toContain('onClick={() => setVerificationInputMode("manual")}');
  });

  test('rejects late photo preparation after a newer selection', () => {
    expect(reviewModalSource).toContain('const selection = verificationSelectionRef.current.begin()');
    expect(reviewModalSource).toContain('const selectionGeneration = selection.generation');
    expect(reviewModalSource).toContain('signal: selection.signal');
    expect(reviewModalSource).toContain('!replaceVerificationPhoto(preparedFile, selectionGeneration)');
    expect(reviewModalSource).toContain('verificationSelectionRef.current.isCurrent(selectionGeneration)');
    const directInvalidations = reviewModalSource.match(/verificationSelectionRef\.current\.invalidate\(\)/g)?.length ?? 0;
    const capturedInvalidations = reviewModalSource.match(/verificationSelection\.invalidate\(\)/g)?.length ?? 0;
    expect(directInvalidations + capturedInvalidations).toBeGreaterThanOrEqual(4);
  });

  test('uses safe user-facing copy for force OCR refresh toggle', () => {
    expect(reviewModalSource).toContain('OCR 다시 분석');
    expect(reviewModalSource).toContain('이번 분석은 캐시 없이 재호출');
    expect(reviewModalSource).not.toContain('dev/admin: OCR 강제 재호출');
  });
});
