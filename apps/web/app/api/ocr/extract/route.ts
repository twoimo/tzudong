import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { debugLog } from '@/lib/debug-log';
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

// --- 설정 ---

// --- 이미지 최적화 (비용 절감) ---
async function optimizeImage(buffer: Buffer): Promise<{ optimized: Buffer; savings: string }> {
    try {
        const originalSize = buffer.length;
        const metadata = await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS }).metadata();

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
            optimized = await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS })
                .resize({ width: 1600 })
                .jpeg({ quality: 85 })
                .toBuffer();
        } else {
            optimized = await sharp(buffer, { limitInputPixels: OCR_MAX_INPUT_PIXELS })
                .jpeg({ quality: 85 })
                .toBuffer();
        }

        const newSize = optimized.length;
        const savingsPercent = ((originalSize - newSize) / originalSize * 100).toFixed(0);
        debugLog(`[OCR] 이미지 압축: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${savingsPercent}% 절감)`);

        return { optimized, savings: `${savingsPercent}%` };
    } catch {
        console.warn('[OCR] 이미지 최적화 실패 (원본 사용)');
        return { optimized: buffer, savings: '0%' };
    }
}

const OCR_PROMPT = RECEIPT_OCR_EXTRACTION_PROMPT;




export async function POST(req: Request) {
    if (!isTrustedSameOriginMutation(req)) {
        return NextResponse.json(
            { error: '허용되지 않은 요청입니다.' },
            { status: 403, headers: { 'Cache-Control': 'no-store' } },
        );
    }
    let buffer: Buffer | null = null;
    let authenticatedUserId: string | null = null;
    let failureModel = `${GEMINI_OCR_FALLBACK_MODEL}:fail`;
    let failureProvider = 'unknown';

    try {
        const uploadRejection = getOcrUploadRejectionForRequest(req.headers);
        if (uploadRejection) {
            return NextResponse.json({ error: uploadRejection.error }, { status: uploadRejection.status });
        }

        const auth = await authenticateOcrRequest(req);
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status });
        }
        const { supabase, user } = auth;
        authenticatedUserId = user.id;

        const multipart = await readBoundedOcrFormData(req);
        if (!multipart.ok) {
            return NextResponse.json(
                { error: multipart.error },
                { status: multipart.status, headers: { 'Cache-Control': 'no-store' } },
            );
        }
        const formData = multipart.formData;
        const file = formData.get('image') as File;
        const forceRefreshRequested = isOcrForceRefreshRequested({ formData, headers: req.headers });
        const selectedRestaurantContext = parseSelectedRestaurantContext(formData);

        const aiRuntime = await resolveOcrAiRuntimeConfig();
        const providerCandidates = [aiRuntime, ...aiRuntime.fallbackCandidates];
        const runnableCandidates = providerCandidates.filter(candidate => hasRunnableOcrCredentials([candidate]));
        const effectiveCandidates = runnableCandidates.length ? runnableCandidates : providerCandidates;
        failureModel = `${effectiveCandidates[0]?.model || effectiveCandidates[0]?.models[0] || GEMINI_OCR_FALLBACK_MODEL}:fail`;
        failureProvider = effectiveCandidates[0]?.provider ?? 'unknown';
        if (!hasRunnableOcrCredentials(runnableCandidates)) {
            return NextResponse.json(
                { error: 'Gemini OCR API 키가 설정되지 않았습니다.' },
                { status: 500 }
            );
        }

        if (!file) {
            return NextResponse.json({ error: '이미지가 제공되지 않았습니다' }, { status: 400 });
        }

        const imageReadResult = await readOcrImageFile(file);
        if (!imageReadResult.ok) {
            return NextResponse.json({ error: imageReadResult.error }, { status: imageReadResult.status });
        }
        buffer = imageReadResult.buffer;

        // 개인정보 최소화를 위해 원본 이미지는 저장하지 않고 단방향 해시만 감사·쿼터 키로 사용합니다.
        const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
        const ocrSupabase = supabase;
        const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
        const forceRefresh = forceRefreshRequested
            ? await canForceRefreshOcr({ userId: user.id, roleClient: supabase as never })
            : false;

        if (forceRefreshRequested && !forceRefresh) {
            return NextResponse.json(
                { error: 'OCR 다시 분석 권한이 없습니다.' },
                { status: 403 }
            );
        }

        // 공급자 호출 전에 DB 원자 예약으로 동시 요청도 일일 한도를 넘지 못하게 한다.
        try {
            const quota = await checkOcrDailyQuota({
                quotaClient: ocrSupabase as never,
                operationId: crypto.randomUUID(),
            });

            if (quota.exceeded) {
                return NextResponse.json(
                    { error: `일일 무료 분석 한도(${OCR_DAILY_QUOTA}회)를 초과했습니다. 내일 00시에 초기화됩니다.` },
                    { status: 429 }
                );
            }
        } catch {
            return NextResponse.json(
                { error: 'OCR 사용 한도를 확인할 수 없습니다.' },
                { status: 503, headers: { 'Cache-Control': 'no-store' } },
            );
        }

        // [비용 절감] 5. 이미지 압축
        const { optimized, savings } = await optimizeImage(buffer);
        const base64Image = optimized.toString('base64');

        let ocrResult: Awaited<ReturnType<typeof callGeminiReceiptOcr>> | null = null;
        let usedCandidate: OcrAiRuntimeConfigCandidate | null = null;
        let failedAttemptCount = 0;
        for (const candidate of effectiveCandidates) {
            const credentials = getRunnableCredentials({ candidate, routingMode: aiRuntime.routingMode });
            for (const credential of credentials) {
                try {
                    ocrResult = await callGeminiReceiptOcr({
                        apiKey: credential.apiKey,
                        imageBase64: base64Image,
                        mimeType: 'image/jpeg',
                        prompt: OCR_PROMPT,
                        env: { ...process.env, GEMINI_OCR_MODEL: candidate.models.join(',') },
                    });
                    usedCandidate = candidate;
                    break;
                } catch {
                    failedAttemptCount += 1;
                    if (aiRuntime.routingMode === 'manual') {
                        throw new Error('OCR_MANUAL_PROVIDER_FAILED');
                    }
                }
            }
            if (ocrResult) break;
        }
        if (!ocrResult || !usedCandidate) {
            throw new Error('OCR_PROVIDERS_FAILED');
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

        // 성공 감사 로그에는 원본 OCR, 보정 결과, 자격 증명 출처를 저장하지 않습니다.
        const successLogMetadata = buildOcrSuccessLogMetadata({
            fileSize: file.size,
            compressedSize: optimized.length,
            savings,
            provider: usedCandidate.provider,
            model: ocrResult.model,
            promptVersion: RECEIPT_OCR_PROMPT_VERSION,
            preprocessVersion: RECEIPT_OCR_PREPROCESS_VERSION,
            routingMode: aiRuntime.routingMode,
            normalizationVersion: RECEIPT_OCR_NORMALIZATION_VERSION,
            fallbackUsed: usedCandidate.provider !== aiRuntime.provider || failedAttemptCount > 0,
            forceRefresh,
            envelope,
            restaurantLookupStats: restaurantMatches.stats,
        });
        assertPrivacySafe(successLogMetadata);
        const { error: logError } = await ocrLogsTable.insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: ocrResult.model,
            success: true,
            metadata: successLogMetadata,
        } as never);
        if (logError) console.error('OCR Log Insert Error:');

        return NextResponse.json(responsePayload);

    } catch (error: unknown) {
        const failureCode = error instanceof GeminiOcrError
            ? 'GEMINI_OCR_FAILED'
            : 'OCR_PROCESSING_FAILED';
        console.error('OCR 처리 오류:', { code: failureCode });

        // 실패 로그 기록
        try {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            const userId = authenticatedUserId ?? user?.id;
            if (userId && buffer) {
                const hashBuffer = crypto.createHash('sha256').update(buffer).digest();
                const imageHash = hashBuffer.toString('hex');
                const ocrSupabase = supabase;
                const ocrLogsTable = ocrSupabase.from('ocr_logs' as never);
                const failureMetadata = { error_code: failureCode, provider: failureProvider };
                assertPrivacySafe(failureMetadata);
                await ocrLogsTable.insert({
                    user_id: userId,
                    image_hash: imageHash,
                    model_used: failureModel,
                    success: false,
                    metadata: failureMetadata,
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
