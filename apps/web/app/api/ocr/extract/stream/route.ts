import crypto from 'crypto';
import sharp from 'sharp';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';
import { callGeminiReceiptOcr, GEMINI_OCR_FALLBACK_MODEL, GeminiOcrError } from '@/lib/ocr/gemini';
import {
  RECEIPT_OCR_EXTRACTION_PROMPT,
  RECEIPT_OCR_PREPROCESS_VERSION,
  RECEIPT_OCR_PROMPT_VERSION,
} from '@/lib/ocr/receipt-prompt';
import { resolveOcrAiRuntimeConfig, type OcrAiRuntimeConfigCandidate } from '@/lib/ocr/runtime-config';
import {
    buildReceiptOcrEnvelope,
    flattenReceiptOcrEnvelope,
    RECEIPT_OCR_NORMALIZATION_VERSION,
} from '@/lib/ocr/receipt-normalization';
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
  signal: AbortSignal;
  send: (event: string, payload: Record<string, unknown>) => void;
}) {
  const { candidate, imageBase64, signal, send } = input;
  if (!candidate.apiKey) throw new Error(`${candidate.provider} OCR API 키가 설정되지 않았습니다.`);

  const geminiResult = await callGeminiReceiptOcr({
    apiKey: candidate.apiKey,
    imageBase64,
    mimeType: 'image/jpeg',
    prompt: RECEIPT_OCR_EXTRACTION_PROMPT,
    env: { ...process.env, GEMINI_OCR_MODEL: candidate.models.join(',') },
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
  if (!hasRunnableOcrCredentials(runnableCandidates)) {
    return new Response(JSON.stringify({ error: 'Gemini OCR API 키가 설정되지 않았습니다.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
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

  try {
    const quota = await checkOcrDailyQuota({
      quotaClient: ocrSupabase as never,
      operationId: crypto.randomUUID(),
    });

    if (quota.exceeded) {
      return new Response(JSON.stringify({ error: `일일 무료 분석 한도(${OCR_DAILY_QUOTA}회)를 초과했습니다. 내일 00시에 초기화됩니다.` }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'OCR 사용 한도를 확인할 수 없습니다.' }), {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    });
  }

  return createSseResponse(async (send) => {
    let failedAttemptCount = 0;
    let lastFailedProvider = aiRuntime.provider;
    let lastFailedModel = aiRuntime.model || aiRuntime.models[0] || GEMINI_OCR_FALLBACK_MODEL;
    try {
      send('progress', { message: '영수증 이미지를 읽기 좋게 압축하고 있어요.', stage: 'preprocess' });
      const { optimized, savings } = await optimizeImage(buffer);
      send('progress', { message: 'AI 모델이 영수증을 분석하기 시작했어요.', stage: 'model_start', savings });

      for (const candidate of effectiveCandidates) {
        const credentials = getRunnableCredentials({ candidate, routingMode: aiRuntime.routingMode });
        for (const credential of credentials) {
        try {
          const result = await runStreamingOcrCandidate({
            candidate: { ...candidate, apiKey: credential.apiKey },
            imageBase64: optimized.toString('base64'),
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
          const responsePayload = flattenReceiptOcrEnvelope(envelope);
          send('field_patch', { data: responsePayload, model: result.model, final: true });

          const successLogMetadata = buildOcrSuccessLogMetadata({
            fileSize: file.size,
            compressedSize: optimized.length,
            savings,
            provider: candidate.provider,
            model: result.model,
            promptVersion: RECEIPT_OCR_PROMPT_VERSION,
            preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
            routingMode: aiRuntime.routingMode,
            normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
            fallbackUsed: candidate.provider !== aiRuntime.provider || failedAttemptCount > 0,
            forceRefresh,
            envelope,
            restaurantLookupStats: restaurantMatches.stats,
          });
          assertPrivacySafe(successLogMetadata);
          const { error: logError } = await ocrLogsTable.insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: result.model,
            success: true,
            metadata: successLogMetadata,
          } as never);
          if (logError) {
            send('progress', { message: '분석은 완료됐지만 분석 로그 저장은 실패했어요.', stage: 'log_warning' });
          }
          send('done', { data: responsePayload, model: result.model, attempts: result.attempts });
          return;
        } catch {
          failedAttemptCount += 1;
          lastFailedProvider = candidate.provider;
          lastFailedModel = candidate.models[0] ?? candidate.model ?? GEMINI_OCR_FALLBACK_MODEL;
          if (aiRuntime.routingMode === 'manual') {
            throw new Error('OCR_MANUAL_PROVIDER_FAILED');
          }
          send('model_attempt', { attempt: { model: candidate.model, ok: false, elapsedMs: 0, error: 'provider fallback' } });
        }
        }
      }

      throw new Error('OCR_PROVIDERS_FAILED');
    } catch (error) {
      const failureCode = error instanceof GeminiOcrError
        ? 'GEMINI_OCR_FAILED'
        : 'OCR_PROCESSING_FAILED';
      try {
        const failureMetadata = {
          error_code: failureCode,
          provider: lastFailedProvider,
          attempt_count: failedAttemptCount,
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
