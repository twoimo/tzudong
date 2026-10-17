import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOcrSuccessLogMetadata } from '@/lib/ocr/route-helpers';
import { buildReceiptOcrEnvelope } from '@/lib/ocr/receipt-normalization';
import { PrivacyUnsafeValueError, assertPrivacySafe } from '@/lib/privacy/sanitize';
import { checkOcrDailyQuota, getOcrQuotaStatus } from '@/lib/ocr/quota';
import {
  OCR_MAX_MULTIPART_BYTES,
  readBoundedOcrFormData,
} from '@/lib/ocr/request-security';
import {
  ADMIN_RECEIPT_MAX_SOURCE_BYTES,
  AdminReceiptImageSecurityError,
  canonicalizeReceiptImage,
  cleanupAdminReceiptTempRun,
  createAdminReceiptTempRun,
  readBoundedReceiptBlob,
  resolveAdminReceiptRunPath,
} from '@/lib/ocr/admin-receipt-image-security';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('OCR extract route privacy and normalization contract', () => {
  test('durable status readback is bounded, provider-free, and returns fixed failures', () => {
    const statusRoute = source('app/api/ocr/results/status/route.ts');
    expect(statusRoute.indexOf('authenticateOcrRequest(request)')).toBeLessThan(
      statusRoute.indexOf('readBoundedOcrFormData(request)'),
    );
    expect(statusRoute.indexOf('readFeatureDatabaseReadiness')).toBeLessThan(
      statusRoute.indexOf('readBoundedOcrFormData(request)'),
    );
    expect(statusRoute).toContain('pollDurableReceiptOcrResult({');
    expect(statusRoute).toContain('const READ_ATTEMPTS = 4;');
    expect(statusRoute).toContain("code: aborted ? 'OCR_STATUS_CANCELLED' : 'OCR_STATUS_UNAVAILABLE'");
    expect(statusRoute).toContain("{ status: aborted ? 408 : 503, headers }");
    expect(statusRoute).not.toContain('callGeminiReceiptOcr');
    expect(statusRoute).not.toContain('executeDurableReceiptOcr');
    expect(statusRoute).not.toContain("rpc('claim_receipt_ocr_result'");
  });

  test('public, streaming, status, and admin callers bind one inference snapshot to cache and provider execution', () => {
    const publicRoute = source('app/api/ocr/extract/route.ts');
    const streamRoute = source('app/api/ocr/extract/stream/route.ts');
    const statusRoute = source('app/api/ocr/results/status/route.ts');
    const adminProcessor = source('lib/ocr/admin-receipt-processor.ts');

    for (const routeSource of [publicRoute, streamRoute, statusRoute]) {
      expect(routeSource).toContain('const inferenceConfig = getGeminiOcrInferenceConfigSnapshot();');
      expect(routeSource).toContain('inferenceConfig');
    }
    expect(adminProcessor).toContain('getGeminiOcrInferenceConfigSnapshot()');
    expect(adminProcessor).toContain('inferenceConfig');
    expect(publicRoute).toContain(
      'buildOcrInputContextHash(imageHash, selectedRestaurantContext, inferenceConfig)',
    );
    expect(streamRoute).toContain(
      'buildOcrInputContextHash(imageHash, selectedRestaurantContext, inferenceConfig)',
    );
    expect(statusRoute).toContain('parseSelectedRestaurantContext(multipart.formData),\n        inferenceConfig,');
    expect(adminProcessor).toContain('buildOcrInputContextHash(imageHash, null, inferenceConfig)');
    for (const providerRoute of [publicRoute, streamRoute, adminProcessor]) {
      expect(providerRoute).toContain('inferenceConfig,');
    }
    expect(statusRoute).not.toContain('callGeminiReceiptOcr');
  });

  test('stores only bounded count/status metadata and excludes raw receipt/provider/credential payloads', () => {
    const envelope = buildReceiptOcrEnvelope({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      attempts: [
        { model: 'bad-gemini', ok: false, elapsedMs: 10, error: 'provider_request_failed' },
        { model: 'gemini-3.6-flash', ok: true, elapsedMs: 50 },
      ],
      data: {
        store_name: '천안초밥 시시린',
        date: '2025-12-15',
        time: '12:09',
        total_amount: 48000,
        items: [{ name: '1인원수', price: 48000 }],
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

    const metadata = buildOcrSuccessLogMetadata({
      fileSize: 1000,
      compressedSize: 900,
      savings: '10%',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      promptVersion: 'receipt-extraction-v2',
      preprocessVersion: 'receipt-image-1600w-q90-original-first-v3',
      routingMode: 'automatic',
      normalizationVersion: envelope.normalization_version,
      fallbackUsed: true,
      forceRefresh: false,
      envelope,
      restaurantLookupStats: { lookupCount: 1, lookupLimit: 3, stoppedByBudget: false },
    });

    expect(metadata.normalization_version).toBe('receipt-normalization-v1');
    expect(metadata.fallback_used).toBe(true);
    expect(metadata.attempt_count).toBe(2);
    expect(metadata.store_found).toBe(true);
    expect(metadata.restaurant_lookup).toEqual({ lookupCount: 1, lookupLimit: 3, stoppedByBudget: false });
    expect(() => assertPrivacySafe(metadata)).not.toThrow();

    const rendered = JSON.stringify(metadata);
    for (const forbidden of [
      '천안초밥',
      '2025-12-15',
      '48000',
      'raw_ocr_result',
      'normalized_ocr_result',
      'ocr_result',
      'field_trust',
      'model_attempts',
      'credential_source',
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  test('disables raw OCR log caching and persists fixed failure codes only', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const helperSource = source('lib/ocr/route-helpers.ts');
    const geminiSource = source('lib/ocr/gemini.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource, helperSource]) {
      expect(ocrRouteSource).not.toContain('buildOcrResponseFromRawCache');
      expect(ocrRouteSource).not.toContain('raw_ocr_result');
      expect(ocrRouteSource).not.toContain('normalized_ocr_result');
      expect(ocrRouteSource).not.toContain('credential_source');
      expect(ocrRouteSource).not.toContain('attempted_providers');
      expect(ocrRouteSource).not.toContain('JSON.stringify(failedAttempts)');
      expect(ocrRouteSource).not.toContain('error.attempts');
    }
    expect(routeSource).toContain("const failureMetadata = { error_code: failureCode, provider: failureProvider }");
    expect(streamRouteSource).toContain('error_code: failureCode');
    expect(streamRouteSource).toContain('attempt_count: providerStarted ? 1 : 0');
    expect(geminiSource).toContain("'provider_request_failed'");
    expect(geminiSource).not.toContain('error.message : String(error)');
  });

  test('rejects unauthenticated and oversized OCR requests before reading image bytes', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const securitySource = source('lib/ocr/request-security.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('getOcrUploadRejectionForRequest(req.headers)');
      expect(ocrRouteSource).toContain('await authenticateOcrRequest(req)');
      expect(ocrRouteSource).toContain('await readBoundedOcrFormData(req)');
      expect(ocrRouteSource).not.toContain('await req.formData()');
      expect(ocrRouteSource).toContain('await readOcrImageFile(file)');
      expect(ocrRouteSource.indexOf('await authenticateOcrRequest(req)')).toBeLessThan(ocrRouteSource.indexOf('await readBoundedOcrFormData(req)'));
      expect(ocrRouteSource.indexOf('await readOcrImageFile(file)')).toBeLessThan(ocrRouteSource.indexOf("crypto.createHash('sha256')"));
    }

    expect(securitySource).toContain('OCR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024');
    expect(securitySource).toContain('OCR_MAX_INPUT_PIXELS = 24_000_000');
    expect(securitySource).toContain('content-length');
    expect(securitySource).toContain('file.size > OCR_MAX_UPLOAD_BYTES');
    expect(securitySource).toContain('hasSupportedImageSignature(buffer)');
    expect(securitySource).toContain('OCR_MAX_MULTIPART_BYTES = OCR_MAX_UPLOAD_BYTES + 64 * 1024');
    expect(securitySource).toContain('req.body.getReader()');
    expect(securitySource).toContain('await reader.cancel()');
    expect(securitySource).toContain("key !== 'image' && !OCR_FORM_STRING_LIMITS.has(key)");
    expect(securitySource).toContain('seen.has(key)');
    expect(routeSource).toContain('limitInputPixels: OCR_MAX_INPUT_PIXELS');
    expect(streamRouteSource).toContain('limitInputPixels: OCR_MAX_INPUT_PIXELS');
    expect(streamRouteSource).toContain("terminal: true");
    expect(streamRouteSource).toContain("status: 422");
  });
  test('rejects cross-site OCR mutations before authentication or paid work', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const env = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://app.example.com',
    } as NodeJS.ProcessEnv;
    const url = 'https://app.example.com/api/ocr/extract';

    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
    }), env)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: { cookie: 'session=browser-session', 'sec-fetch-site': 'same-origin' },
    }), env)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
      },
    }), env)).toBe(true);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer external-api-token',
        'sec-fetch-site': 'cross-site',
      },
    }), env)).toBe(true);

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      const postSource = ocrRouteSource.slice(ocrRouteSource.indexOf('export async function POST'));
      const trustBoundaryIndex = postSource.indexOf('if (!isTrustedSameOriginMutation(req))');
      const firstPostAuthBoundaryIndex = postSource.indexOf('getOcrUploadRejectionForRequest(req.headers)');

      expect(ocrRouteSource).toContain("import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation'");
      expect(trustBoundaryIndex).toBeGreaterThanOrEqual(0);
      expect(firstPostAuthBoundaryIndex).toBeGreaterThan(trustBoundaryIndex);

      const rejectionSource = postSource.slice(trustBoundaryIndex, firstPostAuthBoundaryIndex);
      expect(rejectionSource).toContain("{ error: '허용되지 않은 요청입니다.' }");
      expect(rejectionSource).toContain('status: 403');
      expect(rejectionSource).toContain("'Cache-Control': 'no-store'");

      for (const paidWorkBoundary of [
        'await authenticateOcrRequest(req)',
        'await readBoundedOcrFormData(req)',
        'await resolveOcrAiRuntimeConfig()',
        'await readOcrImageFile(file)',
        'await checkOcrDailyQuota({',
        ocrRouteSource === streamRouteSource
          ? 'await runStreamingOcrCandidate({'
          : 'await callGeminiReceiptOcr({',
      ]) {
        expect(trustBoundaryIndex).toBeLessThan(postSource.indexOf(paidWorkBoundary));
      }
    }
  });

  test('parses only bounded, unique OCR multipart fields', async () => {
    const valid = new FormData();
    valid.append('image', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'receipt.png', { type: 'image/png' }));
    valid.append('force', 'false');
    const validResult = await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      body: valid,
    }));
    expect(validResult.ok).toBe(true);

    const duplicate = new FormData();
    duplicate.append('image', new File(['first'], 'first.png', { type: 'image/png' }));
    duplicate.append('image', new File(['second'], 'second.png', { type: 'image/png' }));
    expect((await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      body: duplicate,
    }))).ok).toBe(false);

    const unknown = new FormData();
    unknown.append('image', new File(['image'], 'receipt.png', { type: 'image/png' }));
    unknown.append('debug', 'raw-provider-output');
    expect((await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      body: unknown,
    }))).ok).toBe(false);

    const oversizedField = new FormData();
    oversizedField.append('image', new File(['image'], 'receipt.png', { type: 'image/png' }));
    oversizedField.append('selectedRestaurantId', 'x'.repeat(65));
    expect((await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      body: oversizedField,
    }))).ok).toBe(false);
  });

  test('rejects malformed and chunked oversized OCR multipart bodies', async () => {
    const malformed = await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not-multipart',
    }));
    expect(malformed).toEqual({
      ok: false,
      status: 400,
      error: '유효하지 않은 multipart 요청입니다.',
    });

    const oversized = await readBoundedOcrFormData(new Request('http://localhost/ocr', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=bounded-test' },
      body: new Uint8Array(OCR_MAX_MULTIPART_BYTES + 1),
    }));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.status).toBe(413);
    }
  });
  test('keeps authenticated OCR reads and writes on the user-scoped client', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('const ocrSupabase = supabase;');
      expect(ocrRouteSource).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(ocrRouteSource).not.toContain('createSupabaseJsClient');
      expect(ocrRouteSource).not.toContain('createOcrLogsSupabaseClient');
    }
  });

  test('force refresh rejection copy does not expose dev/admin internals', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('OCR 다시 분석 권한이 없습니다.');
      expect(ocrRouteSource).not.toContain('OCR 강제 재호출은 개발 환경 또는 관리자 계정에서만 사용할 수 있습니다.');
    }
  });
  test('fails closed without exposing diagnostics when quota state is unavailable', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const quotaRouteSource = source('app/api/ocr/quota/route.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('OCR 사용 한도를 확인할 수 없습니다.');
      expect(ocrRouteSource).toMatch(/OCR_QUOTA_UNAVAILABLE|OcrHttpError\(503/);
      expect(ocrRouteSource).not.toContain('쿼터 확인 실패:');
    }
    expect(quotaRouteSource).toContain("'OCR_QUOTA_UNAVAILABLE'");
    expect(quotaRouteSource).toContain("'Cache-Control': 'no-store'");
    expect(quotaRouteSource).not.toContain('error.message');
    expect(quotaRouteSource).not.toContain('console.error');
  });

  test('passes the complete ordered model policy to both OCR provider entrypoints', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('const modelPolicy = candidate ? getOcrModelPolicy(candidate)');
      expect(ocrRouteSource).toContain("GEMINI_OCR_MODEL: modelPolicy.join(',')");
      expect(ocrRouteSource).toContain('modelPolicy,');
    }
  });

  test('uses an authenticated atomic OCR quota reservation instead of count-then-act', () => {
    const routeSource = source('app/api/ocr/extract/route.ts');
    const streamRouteSource = source('app/api/ocr/extract/stream/route.ts');
    const quotaSource = source('lib/ocr/quota.ts');
    const typeSource = source('integrations/supabase/types.ts');
    const migrationSource = source('../../backend/supabase/migrations/20260713000200_g013_ocr_quota_security.sql');

    for (const ocrRouteSource of [routeSource, streamRouteSource]) {
      expect(ocrRouteSource).toContain('operationId: crypto.randomUUID()');
      expect(ocrRouteSource).toContain('quotaClient: ocrSupabase as never');
      expect(ocrRouteSource).not.toContain('logsClient: ocrSupabase');
    }
    expect(quotaSource).toContain(".rpc('reserve_ocr_daily_quota'");
    expect(quotaSource).toContain(".rpc('get_ocr_daily_quota_status')");
    expect(quotaSource).not.toContain('createSupabaseServiceRoleClient');
    expect(quotaSource).not.toContain("from('ocr_logs')");
    expect(migrationSource).toContain('CREATE SCHEMA ocr_private;');
    expect(migrationSource).toContain('pg_advisory_xact_lock');
    expect(migrationSource).toContain("'ocr-operation:' || p_operation_id::text");
    expect(migrationSource).toContain("auth.role() <> 'authenticated'");
    expect(migrationSource).toContain("account_status.account_status = 'active'");
    expect(migrationSource).toContain('v_used < 5');
    expect(migrationSource).toContain('REVOKE ALL ON TABLE ocr_private.ocr_daily_quota_reservations');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.reserve_ocr_daily_quota(uuid) TO authenticated');
    expect(typeSource).toContain('reserve_ocr_daily_quota: {');
    expect(typeSource).toContain('get_ocr_daily_quota_status: {');
  });

  test('parses bounded OCR quota receipts and fails closed on malformed RPC data', async () => {
    const calls: Array<{ name: string; args?: { p_operation_id: string } }> = [];
    const quotaClient = {
      from: () => {
        throw new Error('unexpected table read');
      },
      rpc: async (name: string, args?: { p_operation_id: string }) => {
        calls.push({ name, args });
        return {
          data: [{
            allowed: true,
            used_count: 3,
            quota_limit: 5,
            remaining_count: 2,
            unlimited: false,
            reset_at: '2026-07-13T15:00:00.000Z',
          }],
          error: null,
        };
      },
    } as never;

    const status = await getOcrQuotaStatus({ quotaClient });
    expect(status).toEqual({
      used: 3,
      max: 5,
      remaining: 2,
      unlimited: false,
      resetAt: '2026-07-13T15:00:00.000Z',
    });

    const operationId = '99999999-9999-4999-8999-000000000001';
    const reservation = await checkOcrDailyQuota({ quotaClient, operationId });
    expect(reservation.exceeded).toBe(false);
    expect(calls).toEqual([
      { name: 'get_ocr_daily_quota_status', args: undefined },
      { name: 'reserve_ocr_daily_quota', args: { p_operation_id: operationId } },
    ]);

    const malformedClient = {
      from: () => {
        throw new Error('unexpected table read');
      },
      rpc: async () => ({ data: [{ allowed: true, used_count: -1 }], error: null }),
    } as never;
    expect(getOcrQuotaStatus({ quotaClient: malformedClient })).rejects.toThrow('OCR_QUOTA_RESPONSE_INVALID');

    const failedClient = {
      from: () => {
        throw new Error('unexpected table read');
      },
      rpc: async () => ({ data: null, error: { code: 'provider-detail-must-not-propagate' } }),
    } as never;
    expect(checkOcrDailyQuota({ quotaClient: failedClient, operationId })).rejects.toThrow('OCR_QUOTA_UNAVAILABLE');
  });

  test('admin OCR preflights bounded resets and preserves generations when dispatch is indeterminate', () => {
    const rerunRouteSource = source('app/api/admin/ocr-receipts/rerun/route.ts');
    const dispatchRouteSource = source('app/api/admin/ocr-receipts/route.ts');
    const resetAllRouteSource = source('app/api/admin/ocr-receipts/reset-all/route.ts');
    const processRouteSource = source('app/api/admin/ocr-receipts/process/route.ts');
    const processCoreSource = source('lib/ocr/admin-receipt-processor.ts');
    const resetCoreSource = source('lib/ocr/admin-receipt-reset.ts');
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
      rerunRouteSource.indexOf('resetReceiptOcrRowWithCas('),
    );
    expect(rerunRouteSource).toContain('resetAlreadyPending = isResetReceiptOcrState({ id: reviewId, ...previousOcrState })');
    expect(rerunRouteSource).toContain('resetPreserved: true');
    expect(rerunRouteSource).not.toContain('rollbackReadback');
    expect(rerunRouteSource).toContain('resetReceiptOcrRowWithCas(');
    expect(resetCoreSource).toContain("query.eq('receipt_data', JSON.stringify(snapshot.receipt_data))");
    expect(resetCoreSource).toContain('resetReceiptOcrRowsWithCas(');
    expect(rerunRouteSource).toContain("step: 'workflow-dispatch'");

    expect(dispatchRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'dispatch_workflow')");
    expect(dispatchRouteSource).toContain("guardedMutationConfirmation");
    expect(dispatchRouteSource).toContain("GUARDED_MUTATION_CONFIRMATION");
    expect(dispatchRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      dispatchRouteSource.indexOf('if (!GITHUB_TOKEN'),
    );
    expect(dispatchRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      dispatchRouteSource.indexOf('dispatchReceiptOcrWorkflow({'),
    );

    expect(rerunRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'rerun')");
    expect(rerunRouteSource).toContain("guardedMutation");
    expect(rerunRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      rerunRouteSource.indexOf("const supabase = createSupabaseServiceRoleClient()"),
    );

    expect(resetAllRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'reset_all')");
    expect(resetAllRouteSource).toContain("readbackRequired: true");
    expect(resetAllRouteSource).toContain('resetReadbackVerified: true');
    expect(resetAllRouteSource).toContain('MAX_OCR_RESET_BATCH = 50');
    expect(resetAllRouteSource).toContain('resetReceiptOcrRowsWithCas(');
    expect(resetAllRouteSource).toContain('buildReceiptOcrWorkflowInputs(targetReviewIds)');
    expect(resetAllRouteSource).toContain('resetPreserved: true');
    expect(resetAllRouteSource).toContain("guardedMutation");
    expect(resetAllRouteSource.indexOf('if (!hasGuardedMutationConfirmation')).toBeLessThan(
      resetAllRouteSource.indexOf('if (body.confirmation !== OCR_RESET_ALL_CONFIRMATION)'),
    );


    expect(processRouteSource).toContain("buildGuardedMutationRequiredResponse('ocr_receipt', 'inline_process')");
    expect(processRouteSource).toContain('const auth = await requireAdmin();');
    expect(processRouteSource).toContain('const MAX_REQUEST_BYTES = 4 * 1024;');
    expect(processRouteSource).toContain("import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request'");
    expect(processRouteSource).toContain("import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation'");
    expect(processRouteSource).toContain('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    expect(processRouteSource).not.toContain('readBoundedJsonBody');
    expect(processRouteSource).not.toMatch(/request\.(?:json|text|arrayBuffer)\s*\(/);
    expect(processRouteSource).not.toContain('request.body');
    expect(processRouteSource).toContain('keys.length !== 2');
    expect(processRouteSource).toContain("key !== 'reviewId' && key !== 'guardedMutationConfirmation'");
    expect(processRouteSource).toContain("typeof value.reviewId !== 'string'");
    expect(processRouteSource).toContain("typeof value.guardedMutationConfirmation !== 'string'");
    expect(processRouteSource).toContain('hasGuardedMutationConfirmation(body)');
    expect(processRouteSource).not.toContain('x-admin-guarded-mutation-confirmation');
    expect(processRouteSource).toContain('function noStoreJson');
    expect(processRouteSource).toContain("response.headers.set('Cache-Control', 'no-store')");
    expect(processCoreSource).toContain(
      "import { callGeminiReceiptOcr, getGeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini'",
    );
    expect(processCoreSource).toContain("import {\n    PRIVACY_UNSAFE_VALUE_REASON,\n    PrivacyUnsafeValueError,\n    assertPrivacySafe,\n} from '@/lib/privacy/sanitize';");
    expect(processCoreSource).toContain('assertOcrInputSafe(ocrData);');
    expect(processCoreSource).toContain('const receiptData = buildReceiptPersistenceData(ocrData);');
    expect(processCoreSource).toContain('buildReceiptFailureData(');
    expect(processCoreSource).toContain('failure_code: errorCode');
    expect(processCoreSource).toContain('assertPrivacySafe(update);');
    expect(processCoreSource).toContain('publishReviewReceiptOcrResult(supabase as never');
    expect(processCoreSource).toContain('hasExpectedReviewReadback(readback, reviewId, update)');
    expect(processCoreSource).not.toContain(".update(update)");
    expect(processCoreSource).not.toContain('uploadToStorage');
    expect(processCoreSource).not.toContain('ocr-debug/');
    expect(processCoreSource).toContain('const storage = storageAdmin.from(REVIEW_VERIFICATION_BUCKET)');
    expect(processCoreSource).not.toContain("supabase.storage.from('review-photos')");
    expect(processCoreSource).toContain('storage.upload(newObjectPath, canonicalImage');
    expect(processCoreSource).not.toContain('raw: ocrData');
    expect(processCoreSource).not.toContain('receipt_data: { ...ocrData');
    expect(processCoreSource).toContain('errorName: getGuardedMutationErrorName(error)');
    expect(processCoreSource).not.toContain('error.message');
    expect(processRouteSource).not.toContain('callGeminiReceiptOcr');
    expect(processRouteSource).not.toContain('createSupabaseServiceRoleClient');
    expect(processCoreSource).not.toContain('requireAdmin');
    expect(processCoreSource).not.toContain('isTrustedSameOriginMutation');
    expect(processCoreSource).not.toContain('readBoundedJsonRequest');

    const postSource = processRouteSource.slice(processRouteSource.indexOf('export async function POST'));
    const inlineAuthIndex = postSource.indexOf('const auth = await requireAdmin();');
    const inlineReadinessIndex = postSource.indexOf('readFeatureDatabaseReadiness({ ownerId: auth.userId })');
    const inlineOriginIndex = postSource.indexOf('if (!isTrustedSameOriginMutation(request))');
    const inlineFeatureEnabledIndex = postSource.indexOf('if (!isInlineOcrProcessEnabled())');
    const inlineReaderIndex = postSource.indexOf('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    const inlineSchemaIndex = postSource.indexOf('const body = parseInlineOcrProcessBody(parsedBody.value);');
    const inlineConfirmIndex = postSource.indexOf('if (!hasGuardedMutationConfirmation(body))');
    const inlineDelegateIndex = postSource.indexOf('return processAdminReceiptOcr({ reviewId: body.reviewId, signal: request.signal });');
    const coreFunctionSource = processCoreSource.slice(processCoreSource.indexOf('export async function processAdminReceiptOcr'));
    const coreReviewFetchIndex = coreFunctionSource.indexOf(".from('reviews')");
    const coreOwnerReadinessIndex = coreFunctionSource.indexOf('readFeatureDatabaseReadiness({ ownerId: review.user_id })');
    const coreStorageReadIndex = coreFunctionSource.indexOf('downloadReviewVerification(storageAdmin, receiptObjectPath)');
    const coreDurableClaimIndex = coreFunctionSource.indexOf('await executeDurableReceiptOcr({');
    const coreProviderPreflightIndex = coreFunctionSource.indexOf('if (!credentials[0])', coreDurableClaimIndex);
    const coreOcrCallIndex = coreFunctionSource.indexOf('await callGeminiReceiptOcr({', coreProviderPreflightIndex);
    const coreOcrResultIndex = coreFunctionSource.indexOf('const ocrData: ReceiptOcrData = {', coreOcrCallIndex);
    const corePrivacyBoundaryIndex = coreFunctionSource.indexOf('assertOcrInputSafe(ocrData);', coreOcrResultIndex);
    const corePersistenceIndex = coreFunctionSource.indexOf(
      'await persistOcrResult(\n                supabase,\n                body.reviewId,',
      coreOcrResultIndex,
    );
    expect(inlineAuthIndex).toBeGreaterThanOrEqual(0);
    expect(inlineReadinessIndex).toBeGreaterThan(inlineAuthIndex);
    expect(inlineOriginIndex).toBeGreaterThan(inlineReadinessIndex);
    expect(inlineFeatureEnabledIndex).toBeGreaterThan(inlineOriginIndex);
    expect(inlineReaderIndex).toBeGreaterThan(inlineFeatureEnabledIndex);
    expect(inlineSchemaIndex).toBeGreaterThan(inlineReaderIndex);
    expect(inlineConfirmIndex).toBeGreaterThan(inlineSchemaIndex);
    expect(inlineDelegateIndex).toBeGreaterThan(inlineConfirmIndex);
    expect(postSource.slice(inlineFeatureEnabledIndex, inlineReaderIndex)).toContain('return noStoreJson');
    expect(coreReviewFetchIndex).toBeGreaterThanOrEqual(0);
    expect(coreOwnerReadinessIndex).toBeGreaterThan(coreReviewFetchIndex);
    expect(coreStorageReadIndex).toBeGreaterThan(coreOwnerReadinessIndex);
    expect(coreDurableClaimIndex).toBeGreaterThan(coreStorageReadIndex);
    expect(coreProviderPreflightIndex).toBeGreaterThan(coreDurableClaimIndex);
    expect(coreOcrCallIndex).toBeGreaterThan(coreProviderPreflightIndex);
    expect(coreOcrResultIndex).toBeGreaterThan(coreOcrCallIndex);
    expect(corePrivacyBoundaryIndex).toBeGreaterThan(coreOcrResultIndex);
    expect(corePersistenceIndex).toBeGreaterThan(corePrivacyBoundaryIndex);
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
  test('inline OCR rejects foreign, originless, and cross-site browser mutations', () => {
    const env = {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://app.example.com',
    } as NodeJS.ProcessEnv;
    const url = 'https://app.example.com/api/admin/ocr-receipts/process';

    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
    }), env)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        'sec-fetch-site': 'same-origin',
      },
    }), env)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        origin: 'https://app.example.com',
        'sec-fetch-site': 'cross-site',
      },
    }), env)).toBe(false);
    expect(isTrustedSameOriginMutation(new Request(url, {
      method: 'POST',
      headers: {
        cookie: 'session=browser-session',
        origin: 'https://app.example.com',
        'sec-fetch-site': 'same-origin',
      },
    }), env)).toBe(true);
  });
  test('inline OCR blocks secret-bearing fixtures before persistence and never retains debug receipt artifacts', () => {
    const unsafeOcrFixtures = [
      'person@example.com',
      '900101-5234567',
      'Bearer ocr-provider-secret',
      'Cookie: sid=opaque-session',
      'password=receipt-secret',
    ];
    const phoneLikeReceiptName = '010-1234-5678';
    const oversizedChunkedBody = new Uint8Array(4 * 1024 + 1);
    const processCoreSource = source('lib/ocr/admin-receipt-processor.ts');
    const receiptImageSecuritySource = source('lib/ocr/admin-receipt-image-security.ts');

    for (const value of unsafeOcrFixtures) {
      expect(() => assertPrivacySafe({ store_name: value })).toThrow(PrivacyUnsafeValueError);
    }
    expect(() => assertPrivacySafe({ raw_ocr: '영수증 원문' })).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({ error: 'provider diagnostic' })).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({ longitude: 127.0276 })).toThrow(PrivacyUnsafeValueError);
    expect(oversizedChunkedBody.byteLength).toBeGreaterThan(4 * 1024);
    expect(phoneLikeReceiptName).toMatch(/01[0-9]-\d{3,4}-\d{4}/);

    expect(processCoreSource).toContain('PHONE_LIKE_PATTERN');
    expect(processCoreSource).toContain('SAFE_OCR_FAILURE_CODES');
    expect(processCoreSource).toContain("return errorResponse(PRIVACY_UNSAFE_VALUE_REASON, 422);");
    expect(processCoreSource).toContain('downloadReviewVerification(storageAdmin, receiptObjectPath)');
    expect(processCoreSource).toContain(".eq('verification_photo', oldStoredValue)");
    expect(processCoreSource).toContain('the authoritative review-media UPDATE');
    expect(processCoreSource).not.toContain('removeOriginalReceiptObject');
    expect(processCoreSource).not.toContain('getPublicUrl');
    expect(processCoreSource).not.toContain('publicUrl');
    expect(processCoreSource).not.toContain('fetch(');
    expect(receiptImageSecuritySource).toContain('ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS = 15_000');
    expect(receiptImageSecuritySource).toContain('totalBytes > ADMIN_RECEIPT_MAX_SOURCE_BYTES');
    expect(receiptImageSecuritySource).toContain('limitInputPixels: ADMIN_RECEIPT_MAX_INPUT_PIXELS');
    expect(receiptImageSecuritySource).toContain('metadata.pages !== undefined && metadata.pages !== 1');
    expect(processCoreSource).toContain('readbackVerified: true');
  });
  test('admin receipt image retrieval remains private, bounded, contained, and non-destructive', async () => {
    const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff]);
    const blobWithChunks = (type: string, size: number, chunks: Uint8Array[]): Blob => ({
      type,
      size,
      stream: () => new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }) as unknown as Blob;

    const chunkedOversize = blobWithChunks(
      'image/jpeg',
      jpegSignature.byteLength,
      [jpegSignature, new Uint8Array(ADMIN_RECEIPT_MAX_SOURCE_BYTES)],
    );
    await expect(readBoundedReceiptBlob(chunkedOversize)).rejects.toThrow(AdminReceiptImageSecurityError);

    const stalledBody = {
      type: 'image/jpeg',
      size: jpegSignature.byteLength,
      stream: () => new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
      }),
    } as unknown as Blob;
    await expect(readBoundedReceiptBlob(stalledBody, 5)).rejects.toThrow(AdminReceiptImageSecurityError);

    const absentBody = { type: 'image/jpeg', size: jpegSignature.byteLength } as unknown as Blob;
    await expect(readBoundedReceiptBlob(absentBody)).rejects.toThrow(AdminReceiptImageSecurityError);
    await expect(
      readBoundedReceiptBlob(blobWithChunks('image/png', jpegSignature.byteLength, [jpegSignature])),
    ).rejects.toThrow(AdminReceiptImageSecurityError);

    const pixelBomb = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlN7B8AAAAASUVORK5CYII=',
      'base64',
    );
    pixelBomb.writeUInt32BE(8_192, 16);
    pixelBomb.writeUInt32BE(8_192, 20);
    await expect(canonicalizeReceiptImage(pixelBomb, 'image/png')).rejects.toThrow(
      AdminReceiptImageSecurityError,
    );

    const tempRun = createAdminReceiptTempRun();
    try {
      expect(() => resolveAdminReceiptRunPath(tempRun, '../escaped.jpg')).toThrow(
        AdminReceiptImageSecurityError,
      );
      expect(() => resolveAdminReceiptRunPath(tempRun, 'stages/../../escaped.jpg')).toThrow(
        AdminReceiptImageSecurityError,
      );
    } finally {
      cleanupAdminReceiptTempRun(tempRun);
    }

    const processCoreSource = source('lib/ocr/admin-receipt-processor.ts');
    const replacementSource = processCoreSource.slice(
      processCoreSource.indexOf('async function replaceReceiptWithCompressedObject'),
    );
    const uploadIndex = replacementSource.indexOf('storage.upload(newObjectPath, canonicalImage');
    const verifyIndex = replacementSource.indexOf(
      'const uploadedImage = await downloadPrivateReceiptObject',
    );
    const conditionalUpdateIndex = replacementSource.indexOf(".eq('verification_photo', oldStoredValue)");

    expect(processCoreSource).toContain('canonicalStorageImage.bytes.byteLength < downloadedImage.bytes.byteLength');
    expect(processCoreSource).toContain('receiptDownload.bucket === LEGACY_REVIEW_VERIFICATION_BUCKET');
    expect(replacementSource.indexOf('uploadStagedAdminVerificationImage(')).toBeLessThan(uploadIndex);
    expect(processCoreSource).toContain('assertSafeReceiptObjectPath(receiptObjectPath)');
    expect(processCoreSource).not.toContain('getPublicUrl');
    expect(processCoreSource).not.toContain('publicUrl');
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(uploadIndex);
    expect(conditionalUpdateIndex).toBeGreaterThan(verifyIndex);
    expect(replacementSource).not.toContain('removeOriginalReceiptObject');
    expect(replacementSource).toContain('durable retirement fence');
    for (const failureBoundary of [
      'if (!accepted)',
      'uploadedImage.bytes.equals(canonicalImage)',
      'updateError',
      'currentReadbackError',
      'drainAdminVerificationCleanup(cleanup, reviewId, oldObjectPath.split',
      'replacementStateIndeterminate',
      'canDiscardReceiptReplacement(',
    ]) {
      expect(replacementSource).toContain(failureBoundary);
    }
    expect(replacementSource).not.toContain('storage.remove(');
  });
});
