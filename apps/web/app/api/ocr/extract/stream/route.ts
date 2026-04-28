import crypto from 'crypto';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { callGeminiReceiptOcr, GeminiOcrError } from '@/lib/ocr/gemini';
import {
  callNvidiaNimReceiptOcrStreaming,
  extractPartialNvidiaNimOcrData,
  NIM_OCR_DEFAULT_MODEL,
  NvidiaNimOcrError,
  type NvidiaNimReceiptOcrData,
} from '@/lib/ocr/nvidia-nim';
import {
  RECEIPT_OCR_EXTRACTION_PROMPT,
  RECEIPT_OCR_PREPROCESS_VERSION,
  RECEIPT_OCR_PROMPT_VERSION,
} from '@/lib/ocr/receipt-prompt';
import { resolveOcrAiRuntimeConfig, type OcrAiRuntimeConfigCandidate } from '@/lib/admin/ai-settings-store';
import {
    buildOcrCacheVersion,
    doesOcrCacheMetadataMatch,
    RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
    RECEIPT_OCR_RAW_CACHE_KIND,
    type OcrCacheMetadata,
} from '@/lib/ocr/cache-version';
import {
    buildReceiptOcrEnvelope,
    flattenReceiptOcrEnvelope,
    RECEIPT_OCR_NORMALIZATION_VERSION,
} from '@/lib/ocr/receipt-normalization';
import { findOcrRestaurantMatches } from '@/lib/ocr/restaurant-matching';
import {
    buildOcrResponseFromRawCache,
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

export const runtime = 'nodejs';


type OcrLogMetadata = OcrCacheMetadata & {
  ocr_result?: Record<string, unknown>;
  error?: string;
};

function createOcrLogsSupabaseClient(accessToken: string | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (accessToken && supabaseUrl && supabaseAnonKey) {
    return createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createSupabaseJsClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send('error', { message: 'OCR 처리 중 오류가 발생했습니다.', detail: process.env.NODE_ENV === 'production' ? undefined : message });
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
    const metadata = await sharp(buffer).metadata();

    // 영수증 OCR은 작은 글자 판독이 핵심이다. 실기기 영수증처럼 이미 2MB 이하이고
    // 1800px 이하인 이미지는 원본을 유지해 가게명/메뉴명 오인식을 줄인다.
    if (originalSize <= 2 * 1024 * 1024 && (!metadata.width || metadata.width <= 1800)) {
      return { optimized: buffer, savings: '0%' };
    }

    // 큰 이미지만 완만하게 축소한다. 1024px/70% 과압축은 영수증 OCR 정확도를 떨어뜨린다.
    const optimized = metadata.width && metadata.width > 1600
      ? await sharp(buffer).resize({ width: 1600 }).jpeg({ quality: 85 }).toBuffer()
      : await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
    const savingsPercent = ((originalSize - optimized.length) / originalSize * 100).toFixed(0);
    return { optimized, savings: `${savingsPercent}%` };
  } catch {
    return { optimized: buffer, savings: '0%' };
  }
}

function pickChangedFields(previous: NvidiaNimReceiptOcrData, next: NvidiaNimReceiptOcrData): NvidiaNimReceiptOcrData {
  const changed: NvidiaNimReceiptOcrData = {};
  for (const key of ['store_name', 'date', 'time', 'total_amount', 'category', 'review_draft', 'confidence'] as const) {
    if (next[key] !== undefined && next[key] !== previous[key]) {
      changed[key] = next[key] as never;
    }
  }
  return changed;
}

function hasFields(data: NvidiaNimReceiptOcrData): boolean {
  return Object.keys(data).length > 0;
}

async function runStreamingOcrCandidate(input: {
  candidate: OcrAiRuntimeConfigCandidate;
  imageBase64: string;
  signal: AbortSignal;
  send: (event: string, payload: Record<string, unknown>) => void;
}) {
  const { candidate, imageBase64, signal, send } = input;
  if (!candidate.apiKey) throw new Error(`${candidate.provider} OCR API 키가 설정되지 않았습니다.`);

  if (candidate.provider === 'gemini') {
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

  let lastPartial: NvidiaNimReceiptOcrData = {};
  const nimResult = await callNvidiaNimReceiptOcrStreaming({
    apiKey: candidate.apiKey,
    imageBase64,
    mimeType: 'image/jpeg',
    prompt: RECEIPT_OCR_EXTRACTION_PROMPT,
    env: { ...process.env, NVIDIA_NIM_OCR_MODEL: candidate.models.join(',') },
    signal,
    onDelta: (_delta, accumulatedText, model) => {
      const nextPartial = extractPartialNvidiaNimOcrData(accumulatedText);
      const changed = pickChangedFields(lastPartial, nextPartial);
      if (hasFields(changed)) {
        lastPartial = { ...lastPartial, ...changed };
        send('field_patch', { data: changed, model });
      }
    },
    onAttempt: (attempt) => {
      send('model_attempt', { attempt });
    },
  });
  return nimResult;
}

export async function POST(req: Request) {
  const aiRuntime = await resolveOcrAiRuntimeConfig();
  const providerCandidates = [aiRuntime, ...aiRuntime.fallbackCandidates];
  const runnableCandidates = providerCandidates.filter(candidate => hasRunnableOcrCredentials([candidate]));
  const effectiveCandidates = runnableCandidates.length ? runnableCandidates : providerCandidates;
  if (!hasRunnableOcrCredentials(runnableCandidates)) {
    return new Response(JSON.stringify({ error: 'OCR API 키가 설정되지 않았습니다. Gemini 또는 NVIDIA NIM 키를 확인해주세요.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const formData = await req.formData();
  const file = formData.get('image') as File | null;
  const forceRefreshRequested = isOcrForceRefreshRequested({ formData, headers: req.headers });
  const selectedRestaurantContext = parseSelectedRestaurantContext(formData);
  if (!file) {
    return new Response(JSON.stringify({ error: '이미지가 제공되지 않았습니다' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (!file.type.startsWith('image/')) {
    return new Response(JSON.stringify({ error: '유효하지 않은 파일 형식입니다' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const supabase = await createClient();
  const { data: { user: initialUser }, error: authError } = await supabase.auth.getUser();
  let user = initialUser;
  let accessToken: string | null = null;

  if (!authError && user) {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  }

  if (authError || !user) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user: headerUser }, error: headerError } = await supabase.auth.getUser(token);
      if (headerError || !headerUser) {
        return new Response(JSON.stringify({ error: '로그인이 필요한 서비스입니다 (Token Invalid)' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      user = headerUser;
      accessToken = token;
    } else {
      return new Response(JSON.stringify({ error: '로그인이 필요한 서비스입니다' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ocrCacheVersions = providerCandidates.map(candidate => buildOcrCacheVersion({
    cacheKind: RECEIPT_OCR_RAW_CACHE_KIND,
    provider: candidate.provider,
    model: candidate.models[0] ?? candidate.model,
    promptVersion: RECEIPT_OCR_PROMPT_VERSION,
    preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
    extractionSchemaVersion: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
    routingMode: aiRuntime.routingMode,
  }));
  const ocrSupabase = createOcrLogsSupabaseClient(accessToken) ?? supabase;
  const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
  const forceRefresh = forceRefreshRequested
    ? await canForceRefreshOcr({ userId: user.id, roleClient: supabase as never })
    : false;

  if (forceRefreshRequested && !forceRefresh) {
    return new Response(JSON.stringify({ error: 'OCR 강제 재호출은 개발 환경 또는 관리자 계정에서만 사용할 수 있습니다.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!forceRefresh) {
    const { data: cachedResultRaw } = await ocrLogsTable
      .select('metadata')
      .eq('user_id', user.id)
      .eq('image_hash', imageHash)
      .eq('success', true)
      .order('created_at', { ascending: false })
      .limit(5);

    const cachedRows = (cachedResultRaw as Array<{ metadata?: OcrLogMetadata | null }> | null) ?? [];
    const cachedMetadata = cachedRows
      .map(row => row.metadata ?? null)
      .find(metadata => ocrCacheVersions.some(version => doesOcrCacheMetadataMatch(metadata, version)))
      ?? cachedRows
        .map(row => row.metadata ?? null)
        .find(metadata => Boolean(metadata?.raw_ocr_result && metadata.provider && metadata.model))
      ?? null;
    const cachedResponse = await buildOcrResponseFromRawCache({
      metadata: cachedMetadata,
      selectedRestaurantContext,
      lookupCallbacks: createRestaurantLookupCallbacks(ocrSupabase as never),
    });
    if (cachedResponse) {
      return createSseResponse(async (send) => {
        send('progress', { message: '이전에 분석한 영수증 결과를 현재 맛집 문맥으로 다시 확인했어요.', stage: 'cache' });
        send('field_patch', { data: cachedResponse.responsePayload, cached: true });
        send('done', { data: cachedResponse.responsePayload, cached: true });
      });
    }
  }

  try {
    const quota = await checkOcrDailyQuota({
      userId: user.id,
      logsClient: ocrSupabase as never,
      roleClient: supabase as never,
    });

    if (quota.exceeded) {
      return new Response(JSON.stringify({ error: `일일 무료 분석 한도(${OCR_DAILY_QUOTA}회)를 초과했습니다. 내일 00시에 초기화됩니다.` }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (countError) {
    console.error('쿼터 확인 실패:', countError);
  }

  return createSseResponse(async (send) => {
    const failedAttempts: unknown[] = [];
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

          const { error: logError } = await ocrLogsTable.insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: result.model,
            success: true,
            metadata: buildOcrSuccessLogMetadata({
              fileSize: file.size,
              compressedSize: optimized.length,
              savings,
              provider: candidate.provider,
              model: result.model,
              promptVersion: RECEIPT_OCR_PROMPT_VERSION,
              preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
              routingMode: aiRuntime.routingMode,
              normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
              credentialSource: credential.sourceName ?? credential.source,
              fallbackUsed: candidate.provider !== aiRuntime.provider || failedAttempts.length > 0,
              forceRefresh,
              envelope,
              ocrResult: responsePayload,
              restaurantLookupStats: restaurantMatches.stats,
            }),
          } as never);
          if (logError) {
            send('progress', { message: '분석은 완료됐지만 분석 로그 저장은 실패했어요.', stage: 'log_warning' });
          }
          send('done', { data: responsePayload, model: result.model, attempts: result.attempts });
          return;
        } catch (error) {
          failedAttempts.push({
            provider: candidate.provider,
            credential_source: credential.sourceName ?? credential.source,
            error: error instanceof Error ? error.message : String(error),
            attempts: error instanceof NvidiaNimOcrError || error instanceof GeminiOcrError ? error.attempts : undefined,
          });
          if (aiRuntime.routingMode === 'manual') throw error;
          send('model_attempt', { attempt: { model: candidate.model, ok: false, elapsedMs: 0, error: 'provider fallback' } });
        }
        }
      }

      throw new Error(`모든 OCR provider 호출에 실패했습니다: ${JSON.stringify(failedAttempts)}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const lastFailedAttempt = failedAttempts.at(-1) as { provider?: string; attempts?: Array<{ model?: string }> } | undefined;
      const failedProvider = lastFailedAttempt?.provider ?? aiRuntime.provider;
      const failedModel = lastFailedAttempt?.attempts?.at(-1)?.model
        ?? (failedProvider === aiRuntime.provider ? aiRuntime.model || aiRuntime.models[0] : undefined)
        ?? NIM_OCR_DEFAULT_MODEL;
      try {
        await ocrLogsTable.insert({
          user_id: user.id,
          image_hash: imageHash,
          model_used: `${failedModel}:fail`,
          success: false,
          metadata: {
            error: errorMessage,
            provider: failedProvider,
            attempted_providers: failedAttempts,
            attempts: error instanceof NvidiaNimOcrError || error instanceof GeminiOcrError ? error.attempts : undefined,
          },
        } as never);
      } catch {
        // Ignore logging failures.
      }
      send('error', { message: 'OCR 처리 중 오류가 발생했습니다.', detail: process.env.NODE_ENV === 'production' ? undefined : errorMessage });
    }
  });
}
