import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOcrResponseFromRawCache, buildOcrSuccessLogMetadata } from '@/lib/ocr/route-helpers';
import { buildReceiptOcrEnvelope, flattenReceiptOcrEnvelope } from '@/lib/ocr/receipt-normalization';
import { RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION, RECEIPT_OCR_RAW_CACHE_KIND } from '@/lib/ocr/cache-version';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('OCR extract route normalization/cache contract', () => {
  test('builds cacheable success metadata with raw and normalized OCR envelopes after provider fallback', () => {
    const envelope = buildReceiptOcrEnvelope({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      attempts: [{ model: 'bad-gemini', ok: false, elapsedMs: 10, error: 'invalid key' }, { model: 'gemini-3.5-flash', ok: true, elapsedMs: 50 }],
      data: {
        store_name: '천안초밥 시시린',
        date: '2025-12-15',
        time: '12:09',
        total_amount: 48000,
        items: [{ name: '1인원수', price: 48000 }, { name: '2인(린특)치즈', price: 48000 }],
      },
      matchedRestaurantCandidates: [{
        id: 'restaurant-1',
        name: '천안초밥 스시린',
        road_address: null,
        jibun_address: null,
        score: 86,
        level: 'high',
        source: 'selected_restaurant',
        reason: '선택된 맛집과 영수증 상호가 강하게 일치합니다.',
      }],
    });
    const responsePayload = flattenReceiptOcrEnvelope(envelope);

    const metadata = buildOcrSuccessLogMetadata({
      fileSize: 1000,
      compressedSize: 900,
      savings: '10%',
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      promptVersion: 'receipt-extraction-v2',
      preprocessVersion: 'receipt-image-1600w-q90-original-first-v3',
      routingMode: 'automatic',
      normalizationVersion: envelope.normalization_version,
      credentialSource: 'GEMINI_API_KEY',
      fallbackUsed: true,
      forceRefresh: false,
      envelope,
      ocrResult: responsePayload,
      restaurantLookupStats: { lookupCount: 1, lookupLimit: 3, stoppedByBudget: false },
    });

    expect(metadata.normalization_version).toBe('receipt-normalization-v1');
    expect(metadata.fallback_used).toBe(true);
    expect(metadata.raw_ocr_result).toEqual(expect.objectContaining({ store_name: '천안초밥 시시린' }));
    expect(metadata.normalized_ocr_result).toEqual(expect.objectContaining({ store_name: '천안초밥 스시린' }));
    expect(metadata.ocr_result).toEqual(expect.objectContaining({
      store_name: '천안초밥 스시린',
      normalization_version: 'receipt-normalization-v1',
    }));
    expect(metadata.field_trust.some((field) => field.field === 'store_name' && field.level === 'high')).toBe(true);
    expect(metadata.restaurant_lookup).toEqual({ lookupCount: 1, lookupLimit: 3, stoppedByBudget: false });
  });

  test('recomputes current restaurant correction from raw cache instead of serving stale corrected payload', async () => {
    const rawCache = {
      cache_kind: RECEIPT_OCR_RAW_CACHE_KIND,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      prompt_version: 'receipt-extraction-v2',
      preprocess_version: 'receipt-image-1600w-q90-original-first-v3',
      extraction_schema_version: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
      routing_mode: 'automatic',
      model_attempts: [{ model: 'gemini-3.5-flash', ok: true, elapsedMs: 12 }],
      raw_ocr_result: { store_name: '데일리픽스', date: '2026-04-25', time: '19:10', total_amount: 11500 },
      ocr_result: { store_name: '스테일 과거 보정값' },
    } as const;

    const responseA = await buildOcrResponseFromRawCache({
      metadata: rawCache,
      selectedRestaurantContext: { id: 'restaurant-a' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'restaurant-a', name: '데일리픽스 강남본점' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });
    const responseB = await buildOcrResponseFromRawCache({
      metadata: rawCache,
      selectedRestaurantContext: { id: 'restaurant-b' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'restaurant-b', name: '데일리픽스 판교점' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });

    expect(responseA?.responsePayload.store_name).toBe('데일리픽스 강남본점');
    expect(responseB?.responsePayload.store_name).toBe('데일리픽스 판교점');
    expect(responseA?.responsePayload.store_name).not.toBe('스테일 과거 보정값');
    expect(responseA?.restaurantLookupStats.lookupCount).toBeLessThanOrEqual(3);
    expect(responseB?.restaurantLookupStats.lookupCount).toBeLessThanOrEqual(3);
  });



  test('reuses legacy cache rows only when raw OCR fields are present and still recomputes envelope', async () => {
    const response = await buildOcrResponseFromRawCache({
      metadata: {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        prompt_version: 'legacy-prompt',
        preprocess_version: 'legacy-preprocess',
        routing_mode: 'automatic',
        model_attempts: [{ model: 'gemini-3.5-flash', ok: true, elapsedMs: 10 }],
        raw_ocr_result: { store_name: '스시런', date: '2025-12-15', time: '12:09', total_amount: 48000 },
        ocr_result: { store_name: '과거 보정값' },
      },
      selectedRestaurantContext: { id: 'sushi-1' },
      lookupCallbacks: {
        lookupBySelectedId: async () => ({ id: 'sushi-1', name: '천안초밥 스시린' }),
        lookupExactName: async () => [],
        lookupFuzzyToken: async () => [],
      },
    });

    expect(response?.responsePayload.store_name).toBe('천안초밥 스시린');
    expect(response?.responsePayload.store_name).not.toBe('과거 보정값');
  });
  test('ignores legacy corrected-only cache rows without raw OCR fields', async () => {
    const response = await buildOcrResponseFromRawCache({
      metadata: {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        prompt_version: 'receipt-extraction-v2',
        preprocess_version: 'receipt-image-1600w-q90-original-first-v3',
        routing_mode: 'automatic',
        normalization_version: 'receipt-normalization-v1',
        ocr_result: { store_name: '과거 보정값' },
      },
      selectedRestaurantContext: { id: 'restaurant-a' },
    });

    expect(response).toBeNull();
  });

  test('rejects unauthenticated and oversized OCR requests before reading image bytes', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const securitySource = source('lib/ocr/request-security.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('getOcrUploadRejectionForRequest(req.headers)');
      expect(ocrRouteSource).toContain('await authenticateOcrRequest(req)');
      expect(ocrRouteSource).toContain('await req.formData()');
      expect(ocrRouteSource).toContain('await readOcrImageFile(file)');
      expect(ocrRouteSource.indexOf('await authenticateOcrRequest(req)')).toBeLessThan(ocrRouteSource.indexOf('await req.formData()'));
      expect(ocrRouteSource.indexOf('await readOcrImageFile(file)')).toBeLessThan(ocrRouteSource.indexOf("crypto.createHash('sha256')"));
    }

    expect(securitySource).toContain('OCR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024');
    expect(securitySource).toContain('OCR_MAX_INPUT_PIXELS = 24_000_000');
    expect(securitySource).toContain('content-length');
    expect(securitySource).toContain('file.size > OCR_MAX_UPLOAD_BYTES');
    expect(securitySource).toContain('hasSupportedImageSignature(buffer)');
    expect(routeSource).toContain('limitInputPixels: OCR_MAX_INPUT_PIXELS');
    expect(streamRouteSource).toContain('limitInputPixels: OCR_MAX_INPUT_PIXELS');
    expect(streamRouteSource).toContain("terminal: true");
    expect(streamRouteSource).toContain("status: 422");
  });

  test('force refresh rejection copy does not expose dev/admin internals', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('OCR 다시 분석 권한이 없습니다.');
      expect(ocrRouteSource).not.toContain('OCR 강제 재호출은 개발 환경 또는 관리자 계정에서만 사용할 수 있습니다.');
    }
  });

  test('admin OCR rerun preflights workflow before destructive reset and rolls back dispatch failures', () => {
    const rerunRouteSource = source('app/api/admin/ocr-receipts/rerun/route.ts');
    const dispatchRouteSource = source('app/api/admin/ocr-receipts/route.ts');
    const resetAllRouteSource = source('app/api/admin/ocr-receipts/reset-all/route.ts');
    const processRouteSource = source('app/api/admin/ocr-receipts/process/route.ts');
    const submissionListViewSource = source('components/admin/SubmissionListView.tsx');

    expect(rerunRouteSource).toContain('workflowPreflightResponse');
    expect(rerunRouteSource).toContain('resetSkipped: true');
    expect(rerunRouteSource).toContain('previousOcrState');
    expect(rerunRouteSource).toContain("ocr_processed_at: review.ocr_processed_at");
    expect(rerunRouteSource).toContain("receipt_data: review.receipt_data");
    expect(rerunRouteSource.indexOf('workflowPreflightResponse')).toBeLessThan(
      rerunRouteSource.indexOf("const previousOcrState"),
    );
    expect(rerunRouteSource.indexOf("const previousOcrState")).toBeLessThan(
      rerunRouteSource.indexOf(".update({"),
    );
    expect(rerunRouteSource).toContain('resetRolledBack: !rollbackError');
    expect(rerunRouteSource).toContain("step: 'workflow-dispatch'");

    expect(dispatchRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'dispatch_workflow')");
    expect(dispatchRouteSource).toContain("guardedMutationConfirmation");
    expect(dispatchRouteSource).toContain("GUARDED_MUTATION_CONFIRMATION");
    expect(dispatchRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      dispatchRouteSource.indexOf('if (!GITHUB_TOKEN'),
    );
    expect(dispatchRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      dispatchRouteSource.indexOf("method: 'POST'"),
    );

    expect(rerunRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'rerun')");
    expect(rerunRouteSource).toContain("guardedMutation");
    expect(rerunRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      rerunRouteSource.indexOf("const supabase = createSupabaseServiceRoleClient()"),
    );

    expect(resetAllRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'reset_all')");
    expect(resetAllRouteSource).toContain("readbackRequired: true");
    expect(resetAllRouteSource).toContain("guardedMutation");
    expect(resetAllRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      resetAllRouteSource.indexOf('if (body.confirmation !== OCR_RESET_ALL_CONFIRMATION)'),
    );


    expect(processRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'inline_process')");
    expect(processRouteSource).toContain('hasGuardedMutationConfirmation(request, body ?? {})');
    expect(processRouteSource).toContain('buildInlineOcrGuardedMutation');
    expect(processRouteSource).toContain('stageKeys');
    expect(processRouteSource).not.toContain('data: ocrData');
    expect(processRouteSource).not.toContain('stages,');
    const inlineConfirmIndex = processRouteSource.indexOf('if (!hasGuardedMutationConfirmation(request, body ?? {}))');
    const inlineSupabaseIndex = processRouteSource.indexOf("const supabase = getSupabaseAdmin()", inlineConfirmIndex);
    const inlineProviderModelIndex = processRouteSource.indexOf('const model = genAI.getGenerativeModel', inlineConfirmIndex);
    const inlineStorageUploadIndex = processRouteSource.indexOf('await uploadToStorage(localPath, storagePath)', inlineConfirmIndex);
    expect(inlineConfirmIndex).toBeGreaterThanOrEqual(0);
    expect(inlineSupabaseIndex).toBeGreaterThan(inlineConfirmIndex);
    expect(processRouteSource.indexOf("if (!GEMINI_API_KEY?.trim())")).toBeLessThan(inlineSupabaseIndex);
    expect(inlineProviderModelIndex).toBeGreaterThan(inlineConfirmIndex);
    expect(inlineStorageUploadIndex).toBeGreaterThan(inlineProviderModelIndex);
    expect(submissionListViewSource).toContain("GUARDED_MUTATION_CONFIRMATION");
    expect(submissionListViewSource).toContain("confirmGuardedOcrMutation");
    expect(submissionListViewSource).toContain("guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION");
    const runOcrConfirmIndex = submissionListViewSource.indexOf(
      "confirmGuardedOcrMutation('미처리 리뷰 OCR 처리를 시작합니다.'",
    );
    const rerunOcrConfirmIndex = submissionListViewSource.indexOf(
      "confirmGuardedOcrMutation('선택한 리뷰 OCR 데이터를 초기화하고 재실행합니다.'",
    );
    expect(runOcrConfirmIndex).toBeGreaterThanOrEqual(0);
    expect(rerunOcrConfirmIndex).toBeGreaterThanOrEqual(0);
    expect(
      submissionListViewSource.indexOf(
        "body: JSON.stringify({ guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION })",
        runOcrConfirmIndex,
      ),
    ).toBeGreaterThan(runOcrConfirmIndex);
    expect(
      submissionListViewSource.indexOf(
        "guardedMutationConfirmation: GUARDED_MUTATION_CONFIRMATION",
        rerunOcrConfirmIndex,
      ),
    ).toBeGreaterThan(rerunOcrConfirmIndex);
  });
});
