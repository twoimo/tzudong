/**
 * 리뷰 영수증 OCR 처리 스크립트
 * 
 * GitHub Actions에서 실행
 * 1. Supabase에서 OCR 미처리 리뷰 조회
 * 2. Gemini Vision API로 영수증 OCR
 * 3. 해시 생성 및 중복 검사
 * 4. 결과 저장
 */

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

// =====================================================
// 환경 변수 검증
// =====================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
    console.error('필수 환경 변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
    process.exit(1);
}

// =====================================================
// 클라이언트 초기화
// =====================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// =====================================================
// 상수
// =====================================================
const MAX_REQUESTS_PER_RUN = 100; // API 할당량 제한
const OCR_PROMPT = `당신은 한국어 영수증 OCR 전문가입니다.
다음 이미지에서 영수증 정보를 추출하여 JSON으로 반환하세요.

반드시 아래 형식으로만 응답하세요 (JSON 외 다른 텍스트 금지):
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 금액(숫자),
  "items": ["메뉴1", "메뉴2"],
  "confidence": 0.0~1.0
}

영수증이 아니거나 읽을 수 없으면:
{
  "error": "사유 (예: not_receipt, unreadable, low_quality)",
  "confidence": 0.0
}`;

// =====================================================
// 유틸리티 함수
// =====================================================

/**
 * 이미지 URL에서 Base64 데이터 가져오기
 */
async function fetchImageAsBase64(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`이미지 다운로드 실패: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
}

/**
 * 영수증 해시 생성 (store_name|date|time|amount)
 */
function generateReceiptHash(data) {
    const hashInput = `${data.store_name}|${data.date}|${data.time}|${data.total_amount}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * OCR 응답 파싱
 */
function parseOCRResponse(responseText) {
    // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/)
        || responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        return { error: 'parse_failed', confidence: 0 };
    }

    try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
    } catch (e) {
        return { error: 'json_parse_error', confidence: 0 };
    }
}

// =====================================================
// 메인 처리 로직
// =====================================================

async function processReview(review) {
    const reviewId = review.id;
    console.log(`[처리중] 리뷰 ID: ${reviewId}`);

    try {
        // 1. 인증 사진 URL 생성
        const { data: urlData } = supabase.storage
            .from('review-photos')
            .getPublicUrl(review.verification_photo);

        if (!urlData?.publicUrl) {
            throw new Error('이미지 URL 생성 실패');
        }

        // 2. 이미지 다운로드 및 Base64 변환
        const imageBase64 = await fetchImageAsBase64(urlData.publicUrl);

        // 3. Gemini Vision API 호출
        const result = await model.generateContent([
            OCR_PROMPT,
            {
                inlineData: {
                    mimeType: 'image/webp',
                    data: imageBase64,
                },
            },
        ]);

        const responseText = result.response.text();
        const ocrData = parseOCRResponse(responseText);

        // 4. OCR 실패 처리
        if (ocrData.error || ocrData.confidence < 0.5) {
            await supabase
                .from('reviews')
                .update({
                    receipt_data: { error: ocrData.error || 'low_confidence', raw: ocrData },
                    ocr_processed_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            return { status: 'failed', reason: ocrData.error || 'low_confidence' };
        }

        // 5. 해시 생성
        const receiptHash = generateReceiptHash(ocrData);

        // 6. 중복 검사
        const { data: existingReviews } = await supabase
            .from('reviews')
            .select('id')
            .eq('receipt_hash', receiptHash)
            .neq('id', reviewId);

        const isDuplicate = existingReviews && existingReviews.length > 0;

        // 7. DB 업데이트
        await supabase
            .from('reviews')
            .update({
                receipt_hash: receiptHash,
                receipt_data: ocrData,
                is_duplicate: isDuplicate,
                ocr_processed_at: new Date().toISOString(),
            })
            .eq('id', reviewId);

        if (isDuplicate) {
            console.log(`  ⚠️ 중복 발견! 원본 리뷰: ${existingReviews[0].id}`);
        }

        return { status: isDuplicate ? 'duplicate' : 'success' };

    } catch (error) {
        console.error(`  ❌ 오류: ${error.message}`);

        // 다운로드 실패 등은 ocr_processed_at를 NULL로 유지 (재시도 대상)
        await supabase
            .from('reviews')
            .update({
                receipt_data: { error: 'processing_error', message: error.message },
            })
            .eq('id', reviewId);

        return { status: 'error', reason: error.message };
    }
}

async function main() {
    console.log('========================================');
    console.log('리뷰 영수증 OCR 처리 시작');
    console.log(`시간: ${new Date().toISOString()}`);
    console.log('========================================\n');

    // 1. OCR 미처리 리뷰 조회
    const { data: pendingReviews, error } = await supabase
        .from('reviews')
        .select('id, verification_photo')
        .is('ocr_processed_at', null)
        .not('verification_photo', 'is', null)
        .order('created_at', { ascending: true })
        .limit(MAX_REQUESTS_PER_RUN);

    if (error) {
        console.error('리뷰 조회 실패:', error.message);
        process.exit(1);
    }

    console.log(`미처리 리뷰 수: ${pendingReviews?.length || 0}개\n`);

    if (!pendingReviews || pendingReviews.length === 0) {
        console.log('처리할 리뷰가 없습니다.');
        return;
    }

    // 2. 순차 처리 (API 레이트 리밋 고려)
    const stats = { total: 0, success: 0, failed: 0, duplicate: 0, error: 0 };

    for (const review of pendingReviews) {
        stats.total++;
        const result = await processReview(review);

        stats[result.status]++;

        // API 레이트 리밋 방지 (1초 대기)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. 결과 출력
    console.log('\n========================================');
    console.log('처리 완료');
    console.log(`총: ${stats.total}, 성공: ${stats.success}, 실패: ${stats.failed}, 중복: ${stats.duplicate}, 오류: ${stats.error}`);
    console.log('========================================');
}

main().catch(console.error);
