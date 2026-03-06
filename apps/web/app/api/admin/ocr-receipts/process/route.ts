/**
 * 단일 리뷰 OCR 직접 처리 API (전처리 포함)
 * 
 * POST /api/admin/ocr-receipts/process
 * - Python 전처리 → Supabase 업로드 → Gemini OCR → DB 저장
 * 
 * Note: Python 및 opencv-python이 서버에 설치되어 있어야 합니다.
 * 서버리스 환경에서는 GitHub Actions 사용을 권장합니다.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { requireAdmin } from '@/lib/auth/require-admin';

export const runtime = 'nodejs';

// 환경 변수
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const routeDirname = path.dirname(fileURLToPath(import.meta.url));
const preprocessScriptPath = path.resolve(
    routeDirname,
    '../../../../../../../backend/geminiCLI-ocr-receipts/preprocess_receipt.py'
);

const OCR_PROMPT = `한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

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

/**
 * Python 전처리 스크립트 실행
 */
function runPythonPreprocess(inputPath: string, outputDir: string): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
        const python = process.platform === 'win32' ? 'python' : 'python3';

        const proc = spawn(python, [preprocessScriptPath, inputPath, outputDir]);
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
            } catch {
                reject(new Error(`Python 출력 파싱 실패: ${stdout}`));
            }
        });
    });
}

/**
 * 로컬 파일을 Supabase Storage에 업로드
 */
async function uploadToStorage(localPath: string, storagePath: string): Promise<string | null> {
    if (!localPath || !fs.existsSync(localPath)) {
        return null;
    }

    const fileBuffer = fs.readFileSync(localPath);
    const { error } = await supabase.storage
        .from('review-photos')
        .upload(storagePath, fileBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
        });

    if (error) {
        console.error(`업로드 실패 (${storagePath}):`, error.message);
        return null;
    }

    const { data: urlData } = supabase.storage
        .from('review-photos')
        .getPublicUrl(storagePath);

    return urlData?.publicUrl || null;
}

/**
 * 영수증 해시 생성
 */
function generateReceiptHash(data: { store_name?: string; date?: string; time?: string; total_amount?: number }): string {
    const hashInput = `${data.store_name}|${data.date}|${data.time}|${data.total_amount}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * OCR 응답 파싱
 */
function parseOCRResponse(responseText: string): Record<string, unknown> {
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/)
        || responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
        return { error: 'parse_failed', confidence: 0 };
    }

    try {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
    } catch {
        return { error: 'json_parse_error', confidence: 0 };
    }
}

/**
 * 임시 디렉토리 정리
 */
function cleanupTempDir(dirPath: string) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    } catch (e) {
        console.error(`임시 디렉토리 정리 실패: ${e}`);
    }
}

export async function POST(request: Request) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const tempDir = path.join(os.tmpdir(), `ocr-${Date.now()}`);

    try {
        const { reviewId } = await request.json();

        if (!reviewId) {
            return NextResponse.json(
                { error: '리뷰 ID가 필요합니다.' },
                { status: 400 }
            );
        }

        // 1. 리뷰 조회
        const { data: review, error: fetchError } = await supabase
            .from('reviews')
            .select('id, verification_photo')
            .eq('id', reviewId)
            .single();

        if (fetchError || !review) {
            return NextResponse.json(
                { error: '리뷰를 찾을 수 없습니다.' },
                { status: 404 }
            );
        }

        if (!review.verification_photo) {
            return NextResponse.json(
                { error: '영수증 사진이 없는 리뷰입니다.' },
                { status: 400 }
            );
        }

        // 2. 이미지 다운로드
        const { data: urlData } = supabase.storage
            .from('review-photos')
            .getPublicUrl(review.verification_photo);

        if (!urlData?.publicUrl) {
            throw new Error('이미지 URL 생성 실패');
        }

        fs.mkdirSync(tempDir, { recursive: true });
        const tempInputPath = path.join(tempDir, 'input.jpg');
        const preprocessOutputDir = path.join(tempDir, 'stages');

        const imageResponse = await fetch(urlData.publicUrl);
        if (!imageResponse.ok) {
            throw new Error(`이미지 다운로드 실패: ${imageResponse.status}`);
        }
        const arrayBuffer = await imageResponse.arrayBuffer();
        fs.writeFileSync(tempInputPath, Buffer.from(arrayBuffer));

        // 3. Python 전처리 실행
        let preprocessResult: Record<string, string>;
        try {
            preprocessResult = await runPythonPreprocess(tempInputPath, preprocessOutputDir);
        } catch (preprocessError) {
            console.warn('전처리 실패, 원본 사용:', preprocessError);
            preprocessResult = { warped: tempInputPath };
        }

        // 4. 중간 단계 이미지 업로드
        const stages: Record<string, string> = {};
        const stageNames = ['warped'];  // 최종 이미지만 저장 (스토리지 최적화)

        for (const stageName of stageNames) {
            const localPath = preprocessResult[stageName];
            if (localPath) {
                const storagePath = `ocr-debug/${reviewId}/${stageName}.jpg`;
                const publicUrl = await uploadToStorage(localPath, storagePath);
                if (publicUrl) {
                    stages[stageName] = publicUrl;
                }
            }
        }

        // 5. Gemini OCR 실행
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

        const finalImagePath = preprocessResult.warped || tempInputPath;
        const finalImageBuffer = fs.readFileSync(finalImagePath);
        const imageBase64 = finalImageBuffer.toString('base64');

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
        const ocrData = parseOCRResponse(responseText) as Record<string, unknown>;

        // 6. OCR 실패 처리
        if (ocrData.error || (ocrData.confidence as number) < 0.5) {
            await supabase
                .from('reviews')
                .update({
                    receipt_data: {
                        error: ocrData.error || 'low_confidence',
                        raw: ocrData,
                        stages: Object.keys(stages).length > 0 ? stages : undefined
                    },
                    ocr_processed_at: new Date().toISOString(),
                })
                .eq('id', reviewId);

            return NextResponse.json({
                success: false,
                message: 'OCR 처리 실패',
                error: ocrData.error || 'low_confidence',
                stages,
            });
        }

        // 7. 해시 및 중복 검사
        const receiptHash = generateReceiptHash(ocrData as { store_name?: string; date?: string; time?: string; total_amount?: number });

        const { data: existingReviews } = await supabase
            .from('reviews')
            .select('id')
            .eq('receipt_hash', receiptHash)
            .neq('id', reviewId);

        const isDuplicate = existingReviews && existingReviews.length > 0;
        const duplicateOfId = isDuplicate ? existingReviews[0].id : null;

        // 8. DB 업데이트
        const updateData = {
            receipt_hash: isDuplicate ? null : receiptHash,
            receipt_data: isDuplicate
                ? { ...ocrData, duplicate_of: duplicateOfId, stages }
                : { ...ocrData, stages },
            is_duplicate: isDuplicate,
            ocr_processed_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
            .from('reviews')
            .update(updateData)
            .eq('id', reviewId);

        if (updateError) {
            throw new Error(`DB 업데이트 실패: ${updateError.message}`);
        }

        // 9. OCR 성공 후: 이미지를 WebP로 압축하여 스토리지 용량 절약
        let compressionResult = '원본 유지';
        try {
            const originalStoragePath = review.verification_photo;
            const warpedPath = preprocessResult.warped || tempInputPath;

            // sharp로 WebP 변환 (품질 85%, 최대 1200px)
            const compressedBuffer = await sharp(warpedPath)
                .resize(1200, undefined, { withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();

            // 새 파일명 생성 (확장자 변경: .jpg -> .webp)
            const webpStoragePath = originalStoragePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');

            // 기존 파일 삭제
            await supabase.storage
                .from('review-photos')
                .remove([originalStoragePath]);

            // WebP 이미지 업로드
            const { error: webpUploadError } = await supabase.storage
                .from('review-photos')
                .upload(webpStoragePath, compressedBuffer, {
                    contentType: 'image/webp',
                    upsert: true,
                });

            if (!webpUploadError) {
                // DB에 새 파일 경로 업데이트
                await supabase
                    .from('reviews')
                    .update({ verification_photo: webpStoragePath })
                    .eq('id', reviewId);

                const originalSize = fs.statSync(warpedPath).size;
                const compressedSize = compressedBuffer.length;
                const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
                compressionResult = `WebP 압축 완료 (${savings}% 절약, ${Math.round(compressedSize / 1024)}KB)`;
            }
        } catch (compressError) {
            console.warn('WebP 압축 실패 (원본 유지):', compressError);
        }

        return NextResponse.json({
            success: true,
            message: isDuplicate ? 'OCR 처리 완료 (중복 의심)' : 'OCR 처리 완료',
            data: ocrData,
            stages,
            isDuplicate,
            compression: compressionResult,
        });

    } catch (err) {
        console.error('OCR 처리 오류:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    } finally {
        cleanupTempDir(tempDir);
    }
}
