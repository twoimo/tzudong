import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { NextResponse } from 'next/server';

import {
  RECEIPT_OCR_DEFAULT_GENERATION,
  buildOcrInputContextHash,
  createSupabaseDurableReceiptOcrStore,
  pollDurableReceiptOcrResult,
  toPublicReceiptOcrResponse,
} from '@/lib/ocr/durable-result';
import { GEMINI_OCR_FALLBACK_MODEL, getGeminiOcrInferenceConfigSnapshot } from '@/lib/ocr/gemini';
import { RECEIPT_OCR_PREPROCESS_VERSION, RECEIPT_OCR_PROMPT_VERSION } from '@/lib/ocr/receipt-prompt';
import { RECEIPT_OCR_NORMALIZATION_VERSION } from '@/lib/ocr/receipt-normalization';
import { hasRunnableOcrCredentials, parseSelectedRestaurantContext } from '@/lib/ocr/route-helpers';
import { getOcrModelPolicy, resolveOcrAiRuntimeConfig } from '@/lib/ocr/runtime-config';
import {
  authenticateOcrRequest,
  getOcrUploadRejectionForRequest,
  readBoundedOcrFormData,
  readOcrImageFile,
} from '@/lib/ocr/request-security';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' };
const READ_ATTEMPTS = 4;
const READ_INTERVAL_MS = 500;

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutation(request)) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403, headers });
  }
  const uploadRejection = getOcrUploadRejectionForRequest(request.headers);
  if (uploadRejection) {
    return NextResponse.json({ error: uploadRejection.error }, { status: uploadRejection.status, headers });
  }
  const auth = await authenticateOcrRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  if ((await readFeatureDatabaseReadiness({ ownerId: auth.user.id })).status !== 'ready') {
    return NextResponse.json(
      { code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE },
      { status: 409, headers },
    );
  }

  try {
    const multipart = await readBoundedOcrFormData(request);
    if (!multipart.ok) return NextResponse.json({ error: multipart.error }, { status: multipart.status, headers });
    const file = multipart.formData.get('image');
    if (!(file instanceof File)) return NextResponse.json({ error: '이미지가 제공되지 않았습니다' }, { status: 400, headers });
    const image = await readOcrImageFile(file);
    if (!image.ok) return NextResponse.json({ error: image.error }, { status: image.status, headers });

    const aiRuntime = await resolveOcrAiRuntimeConfig();
    const providerCandidates = [aiRuntime, ...aiRuntime.fallbackCandidates];
    const runnableCandidates = providerCandidates.filter((candidate) => hasRunnableOcrCredentials([candidate]));
    const candidate = (runnableCandidates.length ? runnableCandidates : providerCandidates)[0];
    const modelPolicy = candidate ? getOcrModelPolicy(candidate) : [GEMINI_OCR_FALLBACK_MODEL];
    const inferenceConfig = getGeminiOcrInferenceConfigSnapshot();
    const imageHash = crypto.createHash('sha256').update(image.buffer).digest('hex');
    const binding = {
      userId: auth.user.id,
      imageHash,
      inputContextHash: buildOcrInputContextHash(
        imageHash,
        parseSelectedRestaurantContext(multipart.formData),
        inferenceConfig,
      ),
      provider: candidate?.provider ?? 'gemini' as const,
      modelPolicy,
      generation: RECEIPT_OCR_DEFAULT_GENERATION,
      promptVersion: RECEIPT_OCR_PROMPT_VERSION,
      preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
      normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
    };
    const store = createSupabaseDurableReceiptOcrStore(createSupabaseServiceRoleClient() as never);

    const result = await pollDurableReceiptOcrResult({
      store,
      binding,
      attempts: READ_ATTEMPTS,
      wait: () => delay(READ_INTERVAL_MS, undefined, { signal: request.signal }),
    });
    if (result.status === 'succeeded') {
      return NextResponse.json(toPublicReceiptOcrResponse({ ...result, cacheReused: true }), { status: 200, headers });
    }
    if (result.status === 'indeterminate') {
      return NextResponse.json(
        { code: 'OCR_RESULT_INDETERMINATE', error: '이전 분석 결과를 확인할 수 없습니다.' },
        { status: 409, headers },
      );
    }
    if (result.status === 'processing') {
      return NextResponse.json(
        { code: 'OCR_RESULT_PROCESSING', error: '같은 영수증 분석이 진행 중입니다.' },
        { status: 202, headers },
      );
    }

    return NextResponse.json(
      { code: 'OCR_RESULT_NOT_FOUND', error: '분석 결과를 찾지 못했습니다.' },
      { status: 404, headers },
    );
  } catch (error) {
    const aborted = request.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    return NextResponse.json(
      {
        code: aborted ? 'OCR_STATUS_CANCELLED' : 'OCR_STATUS_UNAVAILABLE',
        error: aborted ? '결과 확인을 중단했습니다.' : '저장된 분석 결과를 확인하지 못했습니다.',
      },
      { status: aborted ? 408 : 503, headers },
    );
  }
}
