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
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

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
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

// =====================================================
// 상수
// =====================================================
const MAX_REQUESTS_PER_RUN = 100; // API 할당량 제한
const OCR_PROMPT = `당신은 한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

## 핵심 지침

### 1. 가게명 추출 (가장 중요!)
- **배달앱(쿠팡이츠, 배달의민족, 요기요 등) 영수증**:
  - 가게명은 앱 로고 바로 아래가 아닌, "주문매장:", "가맹점:", "상호:" 필드에서 확인하세요.
  - 상단에 보이는 이상한 문자열(예: OUVPZE, XKPQE 등)은 OCR 오류일 가능성이 높습니다.
  - 하단의 "주문매장: 스시로이" 같은 명확한 텍스트를 우선 참조하세요.
- **일반 영수증**: 상단 로고/상호명 영역에서 추출
- **알 수 없는 문자열이 가게명으로 보이면**: 영수증 전체를 다시 살펴보고 "주문매장", "상호", "가맹점" 필드를 찾으세요.

### 2. 한글 음식명 정확 인식 (필수!)
- 흐릿하거나 작은 글씨도 문맥상 추론하세요.
- 자주 등장하는 메뉴 예시:
  - 우동 (절대 "무동"이 아님), 라멘, 소바
  - 육회, 육회초밥, 육사시미
  - 초밥, 스시, 사시미, 롤
  - 불초밥, 소고기불초밥, 연어초밥
  - 콜라, 사이다, 음료, 맥주
  - 우동/소바 세트, 덮밥, 카레
- "ㅜ"와 "ㅁ"을 혼동하지 마세요: "우동"이 "무동"으로 보여도 "우동"입니다.

### 3. 메뉴 항목 완전 추출 (하나도 빠뜨리지 말 것!)
- 모든 주문 항목을 items 배열에 포함
- **각 항목은 이름과 가격을 함께 추출**: { "name": "메뉴명", "price": 가격 }
- 옵션/변경사항도 포함: "육회초밥 소고기불초밥으로 변경"
- 이벤트/서비스 항목도 포함: "리뷰이벤트 참여", "서비스 음료"
- 0원이어도 기록: { "name": "콜라", "price": 0 }
- 수량이 있으면 이름에 포함: "우동 x2" 또는 "우동(2)"
- 가격을 읽을 수 없으면 price를 null로 설정

### 4. 금액 추출
- "총결제금액", "합계", "결제금액" 필드 우선
- 쉼표 제거하여 숫자만: "27,500원" → 27500

### 5. 날짜/시간 추출
- "거래일시", "주문일시" 필드에서 추출
- 형식: date="YYYY-MM-DD", time="HH:MM"

### 6. 저품질/멀리 찍힌 이미지 처리
- 글씨가 작거나 흐려도 최대한 추론하세요.
- 확신이 낮으면 confidence를 낮게 설정하되, 가능한 모든 정보를 추출하세요.
- 완전히 읽을 수 없는 경우에만 error를 반환하세요.

## 응답 형식 (JSON만 반환, 추가 텍스트 금지)

성공 시:
{
  "store_name": "가게명 (무의미한 문자열 금지)",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 금액(숫자만),
  "items": [
    { "name": "메뉴명1", "price": 15000 },
    { "name": "메뉴명2 (옵션)", "price": 8000 },
    { "name": "서비스 음료", "price": 0 }
  ],
  "confidence": 0.0~1.0
}

실패 시:
{
  "error": "not_receipt / unreadable / low_quality",
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

/**
 * Python 전처리 스크립트 실행
 */
function runPythonPreprocess(inputPath, outputDir) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'preprocess_receipt.py');
        const python = process.platform === 'win32' ? 'python' : 'python3';

        const proc = spawn(python, [scriptPath, inputPath, outputDir]);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Python 스크립트 실패 (code ${code}): ${stderr}`));
                return;
            }
            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch (e) {
                reject(new Error(`Python 출력 파싱 실패: ${stdout}`));
            }
        });
    });
}

/**
 * 임시 디렉토리 정리
 */
function cleanupTempDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    } catch (e) {
        console.error(`  ⚠️ 임시 디렉토리 정리 실패: ${e.message}`);
    }
}

// =====================================================
// 메인 처리 로직
// =====================================================

async function processReview(review) {
    const reviewId = review.id;
    console.log(`[처리중] 리뷰 ID: ${reviewId}`);

    // 임시 디렉토리 생성
    const tempDir = path.join(os.tmpdir(), `ocr-${reviewId}`);
    const tempInputPath = path.join(tempDir, 'input.jpg');
    const preprocessOutputDir = path.join(tempDir, 'stages');

    try {
        // 1. 인증 사진 URL 생성
        const { data: urlData } = supabase.storage
            .from('review-photos')
            .getPublicUrl(review.verification_photo);

        if (!urlData?.publicUrl) {
            throw new Error('이미지 URL 생성 실패');
        }

        // 2. 이미지 다운로드 및 임시 파일로 저장
        fs.mkdirSync(tempDir, { recursive: true });
        const response = await fetch(urlData.publicUrl);
        if (!response.ok) {
            throw new Error(`이미지 다운로드 실패: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(tempInputPath, Buffer.from(arrayBuffer));

        // 3. Python 전처리 실행
        console.log('  🔄 Python 전처리 실행 중...');
        let preprocessResult;
        try {
            preprocessResult = await runPythonPreprocess(tempInputPath, preprocessOutputDir);
            console.log('  ✅ 전처리 완료');
        } catch (preprocessError) {
            console.warn('  ⚠️ 전처리 실패, 원본 사용:', preprocessError.message);
            preprocessResult = { warped: tempInputPath };
        }

        // 4. warped 이미지를 원본 verification_photo 위치에 덮어쓰기
        const warpedLocalPath = preprocessResult.warped;
        if (warpedLocalPath && warpedLocalPath !== tempInputPath) {
            // 원본과 다른 경우에만 덮어쓰기 (전처리가 성공한 경우)
            const originalStoragePath = review.verification_photo;
            console.log('  🔄 원본 영수증을 전처리 이미지로 교체 중...');

            const fileBuffer = fs.readFileSync(warpedLocalPath);
            const { error: uploadError } = await supabase.storage
                .from('review-photos')
                .upload(originalStoragePath, fileBuffer, {
                    contentType: 'image/jpeg',
                    upsert: true,  // 기존 파일 덮어쓰기
                });

            if (uploadError) {
                console.error(`  ⚠️ 이미지 교체 실패: ${uploadError.message}`);
            } else {
                console.log('  ✅ 원본 영수증을 전처리 이미지로 교체 완료');
            }
        }

        // 5. 최종 이미지(warped 또는 원본) Base64 변환
        const finalImagePath = preprocessResult.warped || tempInputPath;
        const finalImageBuffer = fs.readFileSync(finalImagePath);
        const imageBase64 = finalImageBuffer.toString('base64');

        // 6. Gemini Vision API 호출
        const result = await model.generateContent([
            OCR_PROMPT,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64,
                },
            },
        ]);

        const responseText = result.response.text();
        const ocrData = parseOCRResponse(responseText);

        // 7. OCR 실패 처리
        if (ocrData.error || ocrData.confidence < 0.5) {
            await supabase
                .from('reviews')
                .update({
                    receipt_data: {
                        error: ocrData.error || 'low_confidence',
                        raw: ocrData,
                    },
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
        const duplicateOfId = isDuplicate ? existingReviews[0].id : null;

        // 10. DB 업데이트
        // 중복인 경우 receipt_hash를 저장하지 않음 (UNIQUE INDEX 제약 회피)
        const updateData = {
            receipt_hash: isDuplicate ? null : receiptHash,
            receipt_data: isDuplicate
                ? { ...ocrData, duplicate_of: duplicateOfId }
                : ocrData,
            is_duplicate: isDuplicate,
            ocr_processed_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
            .from('reviews')
            .update(updateData)
            .eq('id', reviewId);

        if (updateError) {
            console.error(`  ❌ DB 업데이트 실패: ${updateError.message}`);
            console.error(`  업데이트 데이터:`, JSON.stringify(updateData, null, 2));
            throw new Error(`DB 업데이트 실패: ${updateError.message}`);
        }

        if (isDuplicate) {
            console.log(`  ⚠️ 중복 발견! 원본 리뷰: ${duplicateOfId}`);
            console.log(`  ✅ 중복 정보 저장 완료`);
        } else {
            console.log(`  ✅ OCR 성공`);
        }

        // OCR 성공 후: 이미지를 WebP로 압축하여 스토리지 용량 절약
        try {
            const originalStoragePath = review.verification_photo;
            const warpedPath = preprocessResult.warped || tempInputPath;

            console.log('  🗜️ 스토리지 최적화: WebP 압축 중...');

            // sharp로 WebP 변환 (품질 85%, 최대 1200px)
            const compressedBuffer = await sharp(warpedPath)
                .resize(1200, null, { withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();

            // 새 파일명 생성 (확장자 변경: .jpg -> .webp)
            const webpStoragePath = originalStoragePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');

            // WebP 이미지 업로드 (먼저 업로드, 성공 후 기존 파일 삭제)
            const { error: webpUploadError } = await supabase.storage
                .from('review-photos')
                .upload(webpStoragePath, compressedBuffer, {
                    contentType: 'image/webp',
                    upsert: true,
                });

            if (webpUploadError) {
                console.warn(`  ⚠️ WebP 업로드 실패 (원본 유지): ${webpUploadError.message}`);
            } else {
                // 업로드 성공 후 기존 파일 삭제 (이미지 손실 방지)
                if (originalStoragePath !== webpStoragePath) {
                    await supabase.storage
                        .from('review-photos')
                        .remove([originalStoragePath]);
                }

                // DB에 새 파일 경로 업데이트
                await supabase
                    .from('reviews')
                    .update({ verification_photo: webpStoragePath })
                    .eq('id', reviewId);

                const originalSize = fs.statSync(warpedPath).size;
                const compressedSize = compressedBuffer.length;
                const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
                console.log(`  ✅ WebP 압축 완료 (${savings}% 절약, ${Math.round(compressedSize / 1024)}KB)`);
            }
        } catch (compressError) {
            console.warn(`  ⚠️ WebP 압축 실패 (원본 유지): ${compressError.message}`);
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
    } finally {
        // 임시 디렉토리 정리
        cleanupTempDir(tempDir);
    }
}

async function main() {
    console.log('========================================');
    console.log('리뷰 영수증 OCR 처리 시작');
    console.log(`시간: ${new Date().toISOString()}`);
    console.log('========================================\n');

    // 특정 리뷰 ID가 지정된 경우 (단일 리뷰 재처리)
    const singleReviewId = process.env.REVIEW_ID?.trim();

    let reviews;

    if (singleReviewId) {
        console.log(`🎯 단일 리뷰 재처리 모드: ${singleReviewId}\n`);

        // 특정 리뷰만 조회
        const { data, error } = await supabase
            .from('reviews')
            .select('id, verification_photo')
            .eq('id', singleReviewId)
            .not('verification_photo', 'is', null)
            .single();

        if (error) {
            console.error('리뷰 조회 실패:', error.message);
            process.exit(1);
        }

        if (!data) {
            console.log('해당 리뷰를 찾을 수 없거나 영수증 사진이 없습니다.');
            return;
        }

        reviews = [data];
    } else {
        // 전체 미처리 리뷰 조회
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

        reviews = pendingReviews || [];
    }

    console.log(`처리 대상 리뷰 수: ${reviews.length}개\n`);

    if (reviews.length === 0) {
        console.log('처리할 리뷰가 없습니다.');
        return;
    }

    // 순차 처리 (API 레이트 리밋 고려)
    const stats = { total: 0, success: 0, failed: 0, duplicate: 0, error: 0 };

    for (const review of reviews) {
        stats.total++;
        const result = await processReview(review);

        stats[result.status]++;

        // API 레이트 리밋 방지 (1초 대기)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 결과 출력
    console.log('\n========================================');
    console.log('처리 완료');
    console.log(`총: ${stats.total}, 성공: ${stats.success}, 실패: ${stats.failed}, 중복: ${stats.duplicate}, 오류: ${stats.error}`);
    console.log('========================================');
}

main().catch(console.error);
