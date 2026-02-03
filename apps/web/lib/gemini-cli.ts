import sharp from 'sharp'; // 이미지 최적화

// --- 설정 (Configuration) ---
// OCI 서버 주소 (환경변수 필수)
// 예: http://123.45.67.89:3456
const OCI_API_URL = process.env.OCI_GEMINI_API_URL;

// --- 이미지 최적화 (Sharp) ---
async function optimizeImage(buffer: Buffer): Promise<Buffer> {
    try {
        const metadata = await sharp(buffer).metadata();
        // 이미지가 너무 크면 리사이징 (폭 1024px로 제한)
        if (metadata.width && metadata.width > 1024) {
            return await sharp(buffer)
                .resize({ width: 1024 })
                .jpeg({ quality: 80 })
                .toBuffer();
        }
        // 크기가 작더라도 포맷 통일 및 용량 감소를 위해 JPEG 80% 변환
        return await sharp(buffer)
            .jpeg({ quality: 80 })
            .toBuffer();
    } catch (e) {
        console.warn('[Gemini Lib] 이미지 최적화 실패 (원본 사용):', e);
        return buffer;
    }
}

// -----------------------------------------------------------
// 메인 함수: OCI 원격 서버로 분석 요청
// -----------------------------------------------------------

export async function analyzeReceiptWithCliFallback(imageBuffer: Buffer, promptText: string): Promise<any> {
    const startTime = Date.now();

    if (!OCI_API_URL) {
        // 개발 환경 편의를 위해 하드코딩된 IP (User Provided)를 fallback으로 사용 가능
        // 하지만 배포 환경에서는 Env Var 권장
        // console.warn('OCI_GEMINI_API_URL 미설정. 기본값 사용 시도...');
        // const DEFAULT_URL = 'http://129.154.55.232:3456';
        throw new Error('OCI_GEMINI_API_URL 환경변수가 설정되지 않았습니다.');
    }

    console.log(`[Gemini Lib] OCI 분석 요청 시작: ${OCI_API_URL}`);

    // 1. 이미지 최적화
    const originalSize = imageBuffer.length;
    let optimizedBuffer = imageBuffer;
    try {
        optimizedBuffer = await optimizeImage(imageBuffer);
        const newSize = optimizedBuffer.length;
        console.log(`[Gemini Lib] 이미지 최적화: ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB (${((originalSize - newSize) / originalSize * 100).toFixed(0)}% 절감)`);
    } catch (e) {
        console.warn('[Gemini Lib] 최적화 건너뜀:', e);
    }

    // 2. Base64 변환
    const imageBase64 = optimizedBuffer.toString('base64');

    // 3. OCI 서버로 전송
    try {
        const response = await fetch(OCI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: promptText,
                imageBase64: imageBase64
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OCI Server Error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        // 결과 파싱
        const text = result.text;
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            console.log(`[Gemini Lib] OCI 분석 성공 (${Date.now() - startTime}ms)`);
            return data;
        } else {
            console.warn('[Gemini Lib] JSON 파싱 실패, Raw Text 반환');
            throw new Error('JSON match failed');
        }

    } catch (error) {
        console.error('[Gemini Lib] OCI 분석 실패:', error);
        throw error;
    }
}
