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
    expect(streamRouteSource).toContain('attempt_count: failedAttemptCount');
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
      expect(ocrRouteSource).toContain('status: 503');
      expect(ocrRouteSource).not.toContain('쿼터 확인 실패:');
    }
    expect(quotaRouteSource).toContain("'OCR_QUOTA_UNAVAILABLE'");
    expect(quotaRouteSource).toContain("'Cache-Control': 'no-store'");
    expect(quotaRouteSource).not.toContain('error.message');
    expect(quotaRouteSource).not.toContain('console.error');
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
    expect(processRouteSource).toContain("import { callGeminiReceiptOcr } from '@/lib/ocr/gemini'");
    expect(processRouteSource).toContain("import {\n    PRIVACY_UNSAFE_VALUE_REASON,\n    PrivacyUnsafeValueError,\n    assertPrivacySafe,\n} from '@/lib/privacy/sanitize';");
    expect(processRouteSource).toContain('assertOcrInputSafe(ocrData);');
    expect(processRouteSource).toContain('const receiptData = buildReceiptPersistenceData(ocrData);');
    expect(processRouteSource).toContain('buildReceiptFailureData(');
    expect(processRouteSource).toContain('failure_code: errorCode');
    expect(processRouteSource).toContain('assertPrivacySafe(update);');
    expect(processRouteSource).toContain('hasExpectedReviewReadback(readback, reviewId, update)');
    expect(processRouteSource).toContain(".select('id, receipt_hash, receipt_data, is_duplicate, ocr_processed_at')");
    expect(processRouteSource).not.toContain('uploadToStorage');
    expect(processRouteSource).not.toContain('ocr-debug/');
    expect(processRouteSource).toContain("const storage = storageAdmin.from('review-photos')");
    expect(processRouteSource).not.toContain("supabase.storage.from('review-photos')");
    expect(processRouteSource).toContain('storage.upload(newObjectPath, canonicalImage');
    expect(processRouteSource).not.toContain('raw: ocrData');
    expect(processRouteSource).not.toContain('receipt_data: { ...ocrData');
    expect(processRouteSource).toContain('errorName: getGuardedMutationErrorName(error)');
    expect(processRouteSource).not.toContain('error.message');

    const postSource = processRouteSource.slice(processRouteSource.indexOf('export async function POST'));
    const inlineAuthIndex = postSource.indexOf('const auth = await requireAdmin();');
    const inlineOriginIndex = postSource.indexOf('if (!isTrustedSameOriginMutation(request))');
    const inlineFeatureEnabledIndex = postSource.indexOf('if (!isInlineOcrProcessEnabled())');
    const inlineReaderIndex = postSource.indexOf('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    const inlineSchemaIndex = postSource.indexOf('const body = parseInlineOcrProcessBody(parsedBody.value);');
    const inlineConfirmIndex = postSource.indexOf('if (!hasGuardedMutationConfirmation(body))');
    const inlineProviderPreflightIndex = postSource.indexOf("if (!GEMINI_API_KEY?.trim())", inlineConfirmIndex);
    const inlineSupabaseIndex = postSource.indexOf('const supabase = getSupabaseAdmin()', inlineConfirmIndex);
    const inlineOcrCallIndex = postSource.indexOf('await callGeminiReceiptOcr({', inlineConfirmIndex);
    const inlineOcrResultIndex = postSource.indexOf('const ocrData = ocrResult.data;', inlineOcrCallIndex);
    const inlinePrivacyBoundaryIndex = postSource.indexOf('assertOcrInputSafe(ocrData);', inlineOcrResultIndex);
    const inlinePersistenceIndex = postSource.indexOf(
      'await persistOcrResult(supabase, body.reviewId, {',
      inlineOcrResultIndex,
    );
    expect(inlineAuthIndex).toBeGreaterThanOrEqual(0);
    expect(inlineOriginIndex).toBeGreaterThan(inlineAuthIndex);
    expect(inlineFeatureEnabledIndex).toBeGreaterThan(inlineOriginIndex);
    expect(inlineReaderIndex).toBeGreaterThan(inlineFeatureEnabledIndex);
    expect(inlineSchemaIndex).toBeGreaterThan(inlineReaderIndex);
    expect(inlineConfirmIndex).toBeGreaterThan(inlineSchemaIndex);
    expect(inlineProviderPreflightIndex).toBeGreaterThan(inlineConfirmIndex);
    expect(inlineSupabaseIndex).toBeGreaterThan(inlineProviderPreflightIndex);
    expect(inlineOcrCallIndex).toBeGreaterThan(inlineSupabaseIndex);
    expect(inlineOcrResultIndex).toBeGreaterThan(inlineOcrCallIndex);
    expect(inlinePrivacyBoundaryIndex).toBeGreaterThan(inlineOcrResultIndex);
    expect(inlinePersistenceIndex).toBeGreaterThan(inlinePrivacyBoundaryIndex);
    expect(postSource.slice(inlineFeatureEnabledIndex, inlineReaderIndex)).toContain('return noStoreJson');
    expect(postSource.slice(inlineConfirmIndex, inlineProviderPreflightIndex)).toContain('return noStoreJson');
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
    const processRouteSource = source('app/api/admin/ocr-receipts/process/route.ts');
    const receiptImageSecuritySource = source('lib/ocr/admin-receipt-image-security.ts');

    for (const value of unsafeOcrFixtures) {
      expect(() => assertPrivacySafe({ store_name: value })).toThrow(PrivacyUnsafeValueError);
    }
    expect(() => assertPrivacySafe({ raw_ocr: '영수증 원문' })).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({ error: 'provider diagnostic' })).toThrow(PrivacyUnsafeValueError);
    expect(() => assertPrivacySafe({ longitude: 127.0276 })).toThrow(PrivacyUnsafeValueError);
    expect(oversizedChunkedBody.byteLength).toBeGreaterThan(4 * 1024);
    expect(phoneLikeReceiptName).toMatch(/01[0-9]-\d{3,4}-\d{4}/);

    expect(processRouteSource).toContain('PHONE_LIKE_PATTERN');
    expect(processRouteSource).toContain('SAFE_OCR_FAILURE_CODES');
    expect(processRouteSource).toContain("return errorResponse(PRIVACY_UNSAFE_VALUE_REASON, 422);");
    expect(processRouteSource).toContain("storage.download(review.verification_photo)");
    expect(processRouteSource).not.toContain('getPublicUrl');
    expect(processRouteSource).not.toContain('publicUrl');
    expect(processRouteSource).not.toContain('fetch(');
    expect(receiptImageSecuritySource).toContain('ADMIN_RECEIPT_DOWNLOAD_DEADLINE_MS = 15_000');
    expect(receiptImageSecuritySource).toContain('totalBytes > ADMIN_RECEIPT_MAX_SOURCE_BYTES');
    expect(receiptImageSecuritySource).toContain('limitInputPixels: ADMIN_RECEIPT_MAX_INPUT_PIXELS');
    expect(receiptImageSecuritySource).toContain('metadata.pages !== undefined && metadata.pages !== 1');
    expect(processRouteSource).toContain('readbackVerified: true');
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

    const processRouteSource = source('app/api/admin/ocr-receipts/process/route.ts');
    const replacementSource = processRouteSource.slice(
      processRouteSource.indexOf('async function replaceReceiptWithCompressedObject'),
    );
    const uploadIndex = replacementSource.indexOf('storage.upload(newObjectPath, canonicalImage');
    const verifyIndex = replacementSource.indexOf(
      'const uploadedImage = await downloadPrivateReceiptObject',
    );
    const conditionalUpdateIndex = replacementSource.indexOf(".eq('verification_photo', oldObjectPath)");
    const oldDeleteIndex = replacementSource.indexOf('storage.remove([oldObjectPath])');

    expect(processRouteSource).toContain('canonicalStorageImage.bytes.byteLength < downloadedImage.bytes.byteLength');
    expect(processRouteSource).toContain('assertSafeReceiptObjectPath(review.verification_photo)');
    expect(processRouteSource).not.toContain('getPublicUrl');
    expect(processRouteSource).not.toContain('publicUrl');
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(uploadIndex);
    expect(conditionalUpdateIndex).toBeGreaterThan(verifyIndex);
    expect(oldDeleteIndex).toBeGreaterThan(conditionalUpdateIndex);
    for (const failureBoundary of [
      'uploadError',
      'uploadedImage.bytes.equals(canonicalImage)',
      'updateError',
      'currentReadbackError',
      'removeReplacementObject(storageAdmin, newObjectPath)',
      'replacementStateIndeterminate',
      'removeOldObjectError',
    ]) {
      expect(replacementSource).toContain(failureBoundary);
    }
  });
});
