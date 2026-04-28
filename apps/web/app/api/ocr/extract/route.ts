import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import sharp from 'sharp';
import { debugLog } from '@/lib/debug-log';
import { callGeminiReceiptOcr, GeminiOcrError } from '@/lib/ocr/gemini';
import { callNvidiaNimReceiptOcr, NIM_OCR_DEFAULT_MODEL, NvidiaNimOcrError } from '@/lib/ocr/nvidia-nim';
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

// --- 설정 ---

// --- 이미지 최적화 (비용 절감) ---
async function optimizeImage(buffer: Buffer): Promise<{ optimized: Buffer; savings: string }> {
    try {
        const originalSize = buffer.length;
        const metadata = await sharp(buffer).metadata();

        // 영수증 OCR은 작은 글자/흐린 잉크가 핵심이라 과압축 시 모델이
        // 가게명·메뉴명을 오인식한다. 이미 2MB 이하이고 1800px 이하인
        // 실기기 사진은 원본을 유지해 정확도를 우선한다.
        if (originalSize <= 2 * 1024 * 1024 && (!metadata.width || metadata.width <= 1800)) {
            debugLog(`[OCR] 이미지 원본 유지: ${(originalSize / 1024).toFixed(0)}KB`);
            return { optimized: buffer, savings: '0%' };
        }

        // 큰 이미지만 완만하게 축소한다. 1024px/70%는 영수증 글자에 손실이 커서 피한다.
        let optimized: Buffer;
        if (metadata.width && metadata.width > 1600) {
            optimized = await sharp(buffer)
                .resize({ width: 1600 })
                .jpeg({ quality: 85 })
                .toBuffer();
        } else {
            optimized = await sharp(buffer)
                .jpeg({ quality: 85 })
                .toBuffer();
        }

        const newSize = optimized.length;
        const savingsPercent = ((originalSize - newSize) / originalSize * 100).toFixed(0);
        debugLog(`[OCR] 이미지 압축: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${savingsPercent}% 절감)`);

        return { optimized, savings: `${savingsPercent}%` };
    } catch (e) {
        console.warn('[OCR] 이미지 최적화 실패 (원본 사용):', e);
        return { optimized: buffer, savings: '0%' };
    }
}

const OCR_PROMPT = RECEIPT_OCR_EXTRACTION_PROMPT;

type OcrResultPayload = Record<string, unknown>;

type OcrLogMetadata = OcrCacheMetadata & {
    ocr_result?: OcrResultPayload;
    error?: string;
};

function createOcrLogsSupabaseClient(accessToken: string | null) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (accessToken && supabaseUrl && supabaseAnonKey) {
        return createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: { Authorization: `Bearer ${accessToken}` },
            },
            auth: { persistSession: false },
        });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return null;

    return createSupabaseJsClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    });
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

export async function POST(req: Request) {
    let buffer: Buffer | null = null;
    let accessToken: string | null = null;
    let authenticatedUserId: string | null = null;
    let failureModel = `${NIM_OCR_DEFAULT_MODEL}:fail`;
    let failureProvider = 'unknown';

    try {
        const aiRuntime = await resolveOcrAiRuntimeConfig();
        const providerCandidates = [aiRuntime, ...aiRuntime.fallbackCandidates];
        const runnableCandidates = providerCandidates.filter(candidate => hasRunnableOcrCredentials([candidate]));
        const effectiveCandidates = runnableCandidates.length ? runnableCandidates : providerCandidates;
        failureModel = `${effectiveCandidates[0]?.model || effectiveCandidates[0]?.models[0] || NIM_OCR_DEFAULT_MODEL}:fail`;
        failureProvider = effectiveCandidates[0]?.provider ?? 'unknown';
        if (!hasRunnableOcrCredentials(runnableCandidates)) {
            return NextResponse.json(
                { error: 'OCR API 키가 설정되지 않았습니다. Gemini 또는 NVIDIA NIM 키를 확인해주세요.' },
                { status: 500 }
            );
        }

        const formData = await req.formData();
        const file = formData.get('image') as File;
        const forceRefreshRequested = isOcrForceRefreshRequested({ formData, headers: req.headers });
        const selectedRestaurantContext = parseSelectedRestaurantContext(formData);

        if (!file) {
            return NextResponse.json({ error: '이미지가 제공되지 않았습니다' }, { status: 400 });
        }

        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: '유효하지 않은 파일 형식입니다' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);

        // [보안] 1. 사용자 인증 확인
        const supabase = await createClient();
        const {
            data: { user: initialUser },
            error: authError
        } = await supabase.auth.getUser();
        let user = initialUser;

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
                    return NextResponse.json({ error: '로그인이 필요한 서비스입니다 (Token Invalid)' }, { status: 401 });
                }
                user = headerUser;
                accessToken = token;
            } else {
                return NextResponse.json({ error: '로그인이 필요한 서비스입니다' }, { status: 401 });
            }
        }
        authenticatedUserId = user.id;

        // [비용 절감] 2. 이미지 해시 계산 (캐싱용)
        const hashBuffer = crypto.createHash('sha256').update(buffer).digest();
        const imageHash = hashBuffer.toString('hex');

        const ocrCacheVersions = providerCandidates.map(candidate => buildOcrCacheVersion({
            cacheKind: RECEIPT_OCR_RAW_CACHE_KIND,
            provider: candidate.provider,
            model: candidate.models[0] ?? candidate.model,
            promptVersion: RECEIPT_OCR_PROMPT_VERSION,
            preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
            extractionSchemaVersion: RECEIPT_OCR_EXTRACTION_SCHEMA_VERSION,
            routingMode: aiRuntime.routingMode,
        }));

        // [비용 절감] 3. 캐시 확인 - 동일 이미지+provider/model/prompt/preprocess 재사용
        const ocrSupabase = createOcrLogsSupabaseClient(accessToken) ?? supabase;
        const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
        const forceRefresh = forceRefreshRequested
            ? await canForceRefreshOcr({ userId: user.id, roleClient: supabase as never })
            : false;

        if (forceRefreshRequested && !forceRefresh) {
            return NextResponse.json(
                { error: 'OCR 강제 재호출은 개발 환경 또는 관리자 계정에서만 사용할 수 있습니다.' },
                { status: 403 }
            );
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
                debugLog('[OCR] raw 캐시 히트! 현재 맛집 문맥으로 보정 재계산');
                return NextResponse.json({
                    ...cachedResponse.responsePayload,
                    cached: true
                });
            }
        }

        // [보안] 4. 일일 쿼터 확인 (일반 사용자 하루 5회, 관리자 무제한)
        try {
            const quota = await checkOcrDailyQuota({
                userId: user.id,
                logsClient: ocrSupabase as never,
                roleClient: supabase as never,
            });

            if (quota.exceeded) {
                return NextResponse.json(
                    { error: `일일 무료 분석 한도(${OCR_DAILY_QUOTA}회)를 초과했습니다. 내일 00시에 초기화됩니다.` },
                    { status: 429 }
                );
            }
        } catch (countError) {
            console.error("쿼터 확인 실패:", countError);
        }

        // [비용 절감] 5. 이미지 압축
        const { optimized, savings } = await optimizeImage(buffer);
        const base64Image = optimized.toString('base64');

        let ocrResult: Awaited<ReturnType<typeof callGeminiReceiptOcr>> | null = null;
        let usedCandidate: OcrAiRuntimeConfigCandidate | null = null;
        let usedCredentialSource = 'none';
        const failedAttempts: unknown[] = [];
        for (const candidate of effectiveCandidates) {
            const credentials = getRunnableCredentials({ candidate, routingMode: aiRuntime.routingMode });
            for (const credential of credentials) {
                try {
                    ocrResult = candidate.provider === 'gemini'
                        ? await callGeminiReceiptOcr({
                            apiKey: credential.apiKey,
                            imageBase64: base64Image,
                            mimeType: 'image/jpeg',
                            prompt: OCR_PROMPT,
                            env: { ...process.env, GEMINI_OCR_MODEL: candidate.models.join(',') },
                        })
                        : await callNvidiaNimReceiptOcr({
                            apiKey: credential.apiKey,
                            imageBase64: base64Image,
                            mimeType: 'image/jpeg',
                            prompt: OCR_PROMPT,
                            env: { ...process.env, NVIDIA_NIM_OCR_MODEL: candidate.models.join(',') },
                        });
                    usedCandidate = candidate;
                    usedCredentialSource = credential.sourceName ?? credential.source;
                    break;
                } catch (error) {
                    failedAttempts.push({
                        provider: candidate.provider,
                        credential_source: credential.sourceName ?? credential.source,
                        error: error instanceof Error ? error.message : String(error),
                        attempts: error instanceof NvidiaNimOcrError || error instanceof GeminiOcrError ? error.attempts : undefined,
                    });
                    if (aiRuntime.routingMode === 'manual') throw error;
                }
            }
            if (ocrResult) break;
        }
        if (!ocrResult || !usedCandidate) {
            throw new Error(`모든 OCR provider 호출에 실패했습니다: ${JSON.stringify(failedAttempts)}`);
        }
        const restaurantMatches = await findOcrRestaurantMatches({
            receiptStoreName: ocrResult.data.store_name,
            selectedRestaurant: selectedRestaurantContext,
            ...createRestaurantLookupCallbacks(ocrSupabase as never),
        });
        const envelope = buildReceiptOcrEnvelope({
            provider: usedCandidate.provider,
            model: ocrResult.model,
            attempts: ocrResult.attempts,
            data: ocrResult.data,
            matchedRestaurantCandidates: restaurantMatches.candidates,
        });
        const responsePayload = flattenReceiptOcrEnvelope(envelope);

        // 성공 로그 (캐싱용 결과 포함)
        const { error: logError } = await ocrLogsTable.insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: ocrResult.model,
            success: true,
            metadata: buildOcrSuccessLogMetadata({
                fileSize: file.size,
                compressedSize: optimized.length,
                savings,
                provider: usedCandidate.provider,
                model: ocrResult.model,
                promptVersion: RECEIPT_OCR_PROMPT_VERSION,
                preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
                routingMode: aiRuntime.routingMode,
                normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
                credentialSource: usedCredentialSource,
                fallbackUsed: usedCandidate.provider !== aiRuntime.provider || failedAttempts.length > 0,
                forceRefresh,
                envelope,
                ocrResult: responsePayload,
                restaurantLookupStats: restaurantMatches.stats,
            })
        } as never);
        if (logError) console.error('OCR Log Insert Error:', logError);

        return NextResponse.json(responsePayload);

    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        console.error('OCR 처리 오류:', errorMessage);
        if (error instanceof NvidiaNimOcrError || error instanceof GeminiOcrError) {
            console.error('OCR provider attempts:', error.attempts);
        }

        // 실패 로그 기록
        try {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            const userId = authenticatedUserId ?? user?.id;
            if (userId && buffer) {
                const hashBuffer = crypto.createHash('sha256').update(buffer).digest();
                const imageHash = hashBuffer.toString('hex');
                const ocrSupabase = createOcrLogsSupabaseClient(accessToken) ?? supabase;
                const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
                await ocrLogsTable.insert({
                    user_id: userId,
                    image_hash: imageHash,
                    model_used: failureModel,
                    success: false,
                    metadata: { error: errorMessage, provider: failureProvider }
                } as never);
            }
        } catch {
            // 무시
        }

        return NextResponse.json({
            error: 'OCR 처리 중 오류가 발생했습니다.',
            details: process.env.NODE_ENV === 'production' ? undefined : 'AI 분석에 실패했습니다. 잠시 후 다시 시도하거나 직접 입력해주세요.'
        }, { status: 500 });
    }
}
