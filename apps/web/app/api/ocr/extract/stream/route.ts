import crypto from 'crypto';
import sharp from 'sharp';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import {
  callGeminiReceiptOcr,
  GEMINI_OCR_FALLBACK_MODEL,
  GeminiOcrError,
  getGeminiOcrInferenceConfigSnapshot,
  type GeminiOcrInferenceConfigSnapshot,
} from '@/lib/ocr/gemini';
import {
  RECEIPT_OCR_EXTRACTION_PROMPT,
  RECEIPT_OCR_PREPROCESS_VERSION,
  RECEIPT_OCR_PROMPT_VERSION,
} from '@/lib/ocr/receipt-prompt';
import { getOcrModelPolicy, resolveOcrAiRuntimeConfig, type OcrAiRuntimeConfigCandidate } from '@/lib/ocr/runtime-config';
import {
    buildReceiptOcrEnvelope,
    RECEIPT_OCR_NORMALIZATION_VERSION,
} from '@/lib/ocr/receipt-normalization';
import {
    DurableReceiptOcrPendingError,
    buildDurableReceiptOcrPayload,
    buildOcrInputContextHash,
    createSupabaseDurableReceiptOcrStore,
    executeDurableReceiptOcr,
    RECEIPT_OCR_DEFAULT_GENERATION,
    toPublicReceiptOcrResponse,
} from '@/lib/ocr/durable-result';
import { findOcrRestaurantMatches } from '@/lib/ocr/restaurant-matching';
import {
    buildOcrSuccessLogMetadata,
    createRestaurantLookupCallbacks,
    getRunnableCredentials,
    hasRunnableOcrCredentials,
    parseSelectedRestaurantContext,
} from '@/lib/ocr/route-helpers';
import {
  canForceRefreshOcr,
  checkOcrDailyQuota,
  isOcrForceRefreshRequested,
  OCR_DAILY_QUOTA,
} from '@/lib/ocr/quota';
import {
  authenticateOcrRequest,
  getOcrUploadRejectionForRequest,
  OCR_MAX_INPUT_PIXELS,
  readOcrImageFile,
  readBoundedOcrFormData,
} from '@/lib/ocr/request-security';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { FEATURE_DATABASE_HELD_CODE, FEATURE_DATABASE_HELD_MESSAGE } from '@/lib/runtime-feature-readiness-contract';
import { readFeatureDatabaseReadiness } from '@/lib/server/runtime-feature-readiness';

export const runtime = 'nodejs';




function createSseResponse(
  run: (send: (event: string, payload: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        await run(send);
      } catch {
        send('error', {
          code: 'OCR_STREAM_FAILED',
          message: 'OCR 처리 중 오류가 발생했습니다.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function optimizeImage(buffer: Buffer): Promise<{ optimized: Buffer; savings: string }> {
  try {
    const originalSize = buffer.length;
    const metadata = await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS }).metadata();

    // 영수증 OCR은 작은 글자 판독이 핵심이다. 실기기 영수증처럼 이미 2MB 이하이고
    // 1800px 이하인 이미지는 원본을 유지해 가게명/메뉴명 오인식을 줄인다.
    if (originalSize <= 2 * 1024 * 1024 && (!metadata.width || metadata.width <= 1800)) {
      return { optimized: buffer, savings: '0%' };
    }

    // 큰 이미지만 완만하게 축소한다. 1024px/70% 과압축은 영수증 OCR 정확도를 떨어뜨린다.
    const optimized = metadata.width && metadata.width > 1600
      ? await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS }).resize({ width: 1600 }).jpeg({ quality: 85 }).toBuffer()
      : await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS }).jpeg({ quality: 85 }).toBuffer();
    const savingsPercent = ((originalSize - optimized.length) / originalSize * 100).toFixed(0);
    return { optimized, savings: `${savingsPercent}%` };
  } catch {
    return { optimized: buffer, savings: '0%' };
  }
}

async function runStreamingOcrCandidate(input: {
  candidate: OcrAiRuntimeConfigCandidate;
  imageBase64: string;
  inferenceConfig: GeminiOcrInferenceConfigSnapshot;
  signal: AbortSignal;
  send: (event: string, payload: Record<string, unknown>) => void;
}) {
  const { candidate, imageBase64, inferenceConfig, signal, send } = input;
  if (!candidate.apiKey) throw new Error(`${candidate.provider} OCR API 키가 설정되지 않았습니다.`);
  const modelPolicy = getOcrModelPolicy(candidate);

  const geminiResult = await callGeminiReceiptOcr({
    apiKey: candidate.apiKey,
    imageBase64,
    mimeType: 'image/jpeg',
    prompt: RECEIPT_OCR_EXTRACTION_PROMPT,
    env: { ...process.env, GEMINI_OCR_MODEL: modelPolicy.join(',') },
    inferenceConfig,
    signal,
  });
  send('model_attempt', { attempt: geminiResult.attempts.at(-1) });
  return geminiResult;
}

export async function POST(req: Request) {
  if (!isTrustedSameOriginMutation(req)) {
    return new Response(JSON.stringify({ error: '허용되지 않은 요청입니다.' }), {
      status: 403,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    });
  }
  const uploadRejection = getOcrUploadRejectionForRequest(req.headers);
  if (uploadRejection) {
    return new Response(JSON.stringify({ error: uploadRejection.error }), {
      status: uploadRejection.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = await authenticateOcrRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { supabase, user } = auth;
  if ((await readFeatureDatabaseReadiness({ ownerId: user.id })).status !== 'ready') {
    return new Response(JSON.stringify({ code: FEATURE_DATABASE_HELD_CODE, error: FEATURE_DATABASE_HELD_MESSAGE }), {
      status: 409,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    });
  }

  const multipart = await readBoundedOcrFormData(req);
  if (!multipart.ok) {
    return new Response(JSON.stringify({ error: multipart.error }), {
      status: multipart.status,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    });
  }
  const formData = multipart.formData;
  const file = formData.get('image') as File;
  const forceRefreshRequested = isOcrForceRefreshRequested({ formData, headers: req.headers });
  const selectedRestaurantContext = parseSelectedRestaurantContext(formData);

  const aiRuntime = await resolveOcrAiRuntimeConfig();
  const providerCandidates = [aiRuntime, ...aiRuntime.fallbackCandidates];
  const runnableCandidates = providerCandidates.filter(candidate => hasRunnableOcrCredentials([candidate]));
  const effectiveCandidates = runnableCandidates.length ? runnableCandidates : providerCandidates;
  const candidate = effectiveCandidates[0];
  const modelPolicy = candidate ? getOcrModelPolicy(candidate) : [GEMINI_OCR_FALLBACK_MODEL];
  const inferenceConfig = getGeminiOcrInferenceConfigSnapshot();
  const model = modelPolicy[0];
  if (!file) {
    return new Response(JSON.stringify({ error: '이미지가 제공되지 않았습니다' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const imageReadResult = await readOcrImageFile(file);
  if (!imageReadResult.ok) {
    return new Response(JSON.stringify({ error: imageReadResult.error }), {
      status: imageReadResult.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const buffer = imageReadResult.buffer;
  // 개인정보 최소화를 위해 원본 이미지는 저장하지 않고 단방향 해시만 감사·쿼터 키로 사용합니다.
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ocrSupabase = supabase;
  const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
  const forceRefresh = forceRefreshRequested
    ? await canForceRefreshOcr({ userId: user.id, roleClient: supabase as never })
    : false;

  if (forceRefreshRequested && !forceRefresh) {
    return new Response(JSON.stringify({ error: 'OCR 다시 분석 권한이 없습니다.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return createSseResponse(async (send) => {
    let providerStarted = false;
    let lastFailedProvider = aiRuntime.provider;
    let lastFailedModel = model;
    try {
      if (!candidate) throw new Error('OCR_CONFIG_UNAVAILABLE');
      const credentials = getRunnableCredentials({ candidate, routingMode: aiRuntime.routingMode });
      const freshArtifacts: { current: {
        optimized: Buffer;
        savings: string;
        result: Awaited<ReturnType<typeof callGeminiReceiptOcr>>;
        envelope: ReturnType<typeof buildReceiptOcrEnvelope>;
        restaurantMatches: Awaited<ReturnType<typeof findOcrRestaurantMatches>>;
      } | null } = { current: null };
      const durable = await executeDurableReceiptOcr({
        store: createSupabaseDurableReceiptOcrStore(createSupabaseServiceRoleClient() as never),
        binding: {
          userId: user.id,
          imageHash,
          inputContextHash: buildOcrInputContextHash(imageHash, selectedRestaurantContext, inferenceConfig),
          provider: candidate.provider,
          modelPolicy,
          generation: RECEIPT_OCR_DEFAULT_GENERATION,
          promptVersion: RECEIPT_OCR_PROMPT_VERSION,
          preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
          normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
        },
        operationId: crypto.randomUUID(),
        forceRefresh,
        beforeProvider: async () => {
          if (!credentials[0]) throw new Error('OCR_CREDENTIAL_UNAVAILABLE');
          let quota: Awaited<ReturnType<typeof checkOcrDailyQuota>>;
          try {
            quota = await checkOcrDailyQuota({
              quotaClient: ocrSupabase as never,
              operationId: crypto.randomUUID(),
            });
          } catch {
            throw new Error('OCR_QUOTA_UNAVAILABLE');
          }
          if (quota.exceeded) throw new Error('OCR_QUOTA_EXCEEDED');
        },
        runProvider: async () => {
          if (req.signal.aborted) throw new DOMException('aborted', 'AbortError');
          send('progress', { message: '영수증 이미지를 읽기 좋게 압축하고 있어요.', stage: 'preprocess' });
          const { optimized, savings } = await optimizeImage(buffer);
          send('progress', { message: 'AI 모델이 영수증을 분석하기 시작했어요.', stage: 'model_start', savings });
          providerStarted = true;
          const result = await runStreamingOcrCandidate({
            candidate: { ...candidate, apiKey: credentials[0]!.apiKey },
            imageBase64: optimized.toString('base64'),
            inferenceConfig,
            signal: req.signal,
            send,
          });
          const restaurantMatches = await findOcrRestaurantMatches({
            receiptStoreName: result.data.store_name,
            selectedRestaurant: selectedRestaurantContext,
            ...createRestaurantLookupCallbacks(ocrSupabase as never),
          });
          const envelope = buildReceiptOcrEnvelope({
            provider: candidate.provider,
            model: result.model,
            attempts: result.attempts,
            data: result.data,
            matchedRestaurantCandidates: restaurantMatches.candidates,
          });
          freshArtifacts.current = { optimized, savings, result, envelope, restaurantMatches };
          const payload = buildDurableReceiptOcrPayload({ provider: candidate.provider, model: result.model, envelope });
          assertPrivacySafe(payload);
          return payload;
        },
      });
      const responsePayload = toPublicReceiptOcrResponse(durable);
      send('field_patch', { data: responsePayload, model: durable.payload.model, final: true });

      if (freshArtifacts.current) {
          const fresh = freshArtifacts.current;
          const successLogMetadata = buildOcrSuccessLogMetadata({
            fileSize: file.size,
            compressedSize: fresh.optimized.length,
            savings: fresh.savings,
            provider: candidate.provider,
            model: fresh.result.model,
            promptVersion: RECEIPT_OCR_PROMPT_VERSION,
            preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
            routingMode: aiRuntime.routingMode,
            normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
            fallbackUsed: candidate.provider !== aiRuntime.provider,
            forceRefresh,
            envelope: fresh.envelope,
            restaurantLookupStats: fresh.restaurantMatches.stats,
          });
          assertPrivacySafe(successLogMetadata);
          const { error: logError } = await ocrLogsTable.insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: fresh.result.model,
            success: true,
            metadata: successLogMetadata,
          } as never);
          if (logError) {
            send('progress', { message: '분석은 완료됐지만 분석 로그 저장은 실패했어요.', stage: 'log_warning' });
          }
      }
      send('done', { data: responsePayload, model: durable.payload.model, attempts: freshArtifacts.current?.result.attempts ?? [] });
    } catch (error) {
      if (error instanceof DurableReceiptOcrPendingError) {
        send('error', {
          code: error.state === 'processing' ? 'OCR_RESULT_PROCESSING' : 'OCR_RESULT_INDETERMINATE',
          message: error.state === 'processing'
            ? '같은 영수증 분석이 진행 중입니다. 잠시 후 다시 확인해주세요.'
            : '이전 분석 결과를 확인할 수 없어 자동 재호출하지 않았습니다. 관리자에게 다시 분석을 요청해주세요.',
          terminal: true,
          status: 409,
        });
        return;
      }
      if (error instanceof Error && ['OCR_CREDENTIAL_UNAVAILABLE', 'OCR_QUOTA_UNAVAILABLE', 'OCR_QUOTA_EXCEEDED'].includes(error.message)) {
        const status = error.message === 'OCR_QUOTA_EXCEEDED' ? 429 : error.message === 'OCR_QUOTA_UNAVAILABLE' ? 503 : 500;
        const message = error.message === 'OCR_QUOTA_EXCEEDED'
          ? `일일 무료 분석 한도(${OCR_DAILY_QUOTA}회)를 초과했습니다. 내일 00시에 초기화됩니다.`
          : error.message === 'OCR_QUOTA_UNAVAILABLE' ? 'OCR 사용 한도를 확인할 수 없습니다.' : 'Gemini OCR API 키가 설정되지 않았습니다.';
        send('error', { message, terminal: true, status });
        return;
      }
      const failureCode = error instanceof GeminiOcrError
        ? 'GEMINI_OCR_FAILED'
        : 'OCR_PROCESSING_FAILED';
      try {
        const failureMetadata = {
          error_code: failureCode,
          provider: lastFailedProvider,
          attempt_count: providerStarted ? 1 : 0,
        };
        assertPrivacySafe(failureMetadata);
        await ocrLogsTable.insert({
          user_id: user.id,
          image_hash: imageHash,
          model_used: `${lastFailedModel}:fail`,
          success: false,
          metadata: failureMetadata,
        } as never);
      } catch {
        // Ignore logging failures.
      }
      send('error', {
        message: 'OCR 처리 중 오류가 발생했습니다.',
        detail: process.env.NODE_ENV === 'production' ? undefined : failureCode,
        terminal: true,
        status: 422,
      });
    }
  });
}
