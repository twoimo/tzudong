import { NextResponse } from 'next/server';
import { analyzeReceiptWithCliFallback } from '../../../../lib/gemini-cli';
import { createClient } from '@/integrations/supabase/server';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- 설정 (Configuration) ---
// OCI 서버 주소 (환경변수 필수)
const OCI_API_URL = process.env.OCI_GEMINI_API_URL;
const GEMINI_API_KEY = process.env.GEMINI_OCR_YEON;

const OCR_PROMPT = `당신은 한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

## 핵심 지침
  - 하단의 "주문매장: 스시로이" 같은 명확한 텍스트를 우선 참조하세요.
- **일반 영수증**: 상단 로고/상호명 영역에서 추출
- **유명 브랜드 자동 완성 금지**: "초특가마R"라고 적혀있으면 "초록마을"로 고치지 말고 보이는 그대로(또는 문맥상 "초특가마트"가 확실하면 그렇게) 추출하세요.
- **알 수 없는 문자열이 가게명으로 보이면**: 영수증 전체를 다시 살펴보고 "주문매장", "상호", "가맹점" 필드를 찾으세요.

### 2. 한글 음식명 정확 인식 (필수!)
- 흐릿하거나 작은 글씨도 문맥상 추론하세요.
- 자주 등장하는 메뉴 예시:
  - 우동, 라멘, 소바, 덮밥, 카레
  - 육회, 초밥, 스시, 사시미, 롤
  - 콜라, 사이다, 음료, 맥주
- "ㅜ"와 "ㅁ"을 혼동하지 마세요.

### 3. 메뉴 항목 완전 추출 (하나도 빠뜨리지 말 것!)
- 모든 주문 항목을 items 배열에 포함
- **각 항목은 이름과 가격을 함께 추출**: { "name": "메뉴명", "price": 가격 }
- 옵션/변경사항도 포함: "육회초밥 소고기불초밥으로 변경"
- 수량이 있으면 이름에 포함: "우동 x2"
- 가격을 읽을 수 없으면 price를 null로 설정

### 4. 금액 및 날짜 추출
- "총결제금액", "합계" 필드 우선 (쉼표 제거)
- "거래일시", "주문일시" 필드 (YYYY-MM-DD, HH:MM)

### 5. 카테고리 분류 (다음 목록 중 하나 선택)
- 선택지: "치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕", "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식", "아시안", "야식", "도시락"
- 메뉴를 보고 가장 적절한 카테고리 1개를 선택 (예: 짜장면 -> "중식", 삼겹살 -> "고기")
- 없으면 "한식"으로 설정

### 6. 리뷰 초안 작성 (3줄 정도, 풍성하게)
- 영수증 내용을 바탕으로 **자연스러운 3줄 정도의 후기**를 작성하세요.
- 포함 내용: 가게 분위기 추론(메뉴 기반), 맛 표현, 가성비 언급.
- 줄바꿈 문자(\n)를 사용하여 문단을 나누세요.
- 이모지 2~3개 포함.
- 예시:
  "오늘 [가게명]에서 [메뉴1]랑 [메뉴2] 먹고 왔어요! 😋
  양도 진짜 푸짐하고 맛도 있어서 완전 배부르게 잘 먹었네요.
  가격도 [금액]원이라 가성비 최고! 다음에 또 올게요. 👍"

## 응답 형식 (JSON만 반환)

성공 시:
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 15000,
  "category": "중식",
  "review_draft": "홍콩반점에서 짜장면이랑 탕수육 먹고 왔어요! 😋\n양도 진짜 많고 소스도 달콤해서 너무 맛있게 먹었네요.\n총 15,000원 나왔는데 가성비 진짜 최고인 듯! 강추합니다. 👍",
  "items": [
    { "name": "메뉴명", "price": 15000 }
  ],
  "confidence": 0.0~1.0
}

실패 시:
{
  "error": "not_receipt / unreadable",
  "confidence": 0.0
}
`;

export async function POST(req: Request) {
    let buffer: Buffer | null = null;
    let base64Image: string | null = null;

    try {
        const formData = await req.formData();
        const file = formData.get('image') as File;

        if (!file) {
            return NextResponse.json({ error: '이미지가 제공되지 않았습니다' }, { status: 400 });
        }

        // 파일 형식이 이미지가 아닌 경우 처리
        if (!file.type.startsWith('image/')) {
            return NextResponse.json({ error: '유효하지 않은 파일 형식입니다' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        base64Image = buffer.toString('base64');

        // [보안] 1. 사용자 인증 확인
        const supabase = await createClient();
        let { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            // [폴백] 쿠키 인증 실패 시, 헤더 인증 시도 (Bearer Token)
            const authHeader = req.headers.get('Authorization');
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.split(' ')[1];
                const { data: { user: headerUser }, error: headerError } = await supabase.auth.getUser(token);

                if (headerError || !headerUser) {
                    return NextResponse.json({ error: '로그인이 필요한 서비스입니다 (Token Invalid)' }, { status: 401 });
                }
                // 헤더 인증 성공 시 user 객체 덮어쓰기
                user = headerUser;
            } else {
                return NextResponse.json({ error: '로그인이 필요한 서비스입니다' }, { status: 401 });
            }
        }

        // [보안] 2. 이미지 해시 계산 (중복 처리 확인용 - 현재는 로깅만)
        const hashBuffer = crypto.createHash('sha256').update(buffer).digest();
        const imageHash = hashBuffer.toString('hex');

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

        // [보안] 3. 일일 쿼터 확인 (Hybrid 전략)
        // 전략: 하루 20회까지는 Vercel(Google API) 사용 -> 초과 시 OCI 서버로 전환
        const MAX_DAILY_QUOTA = 20;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { count, error: countError } = await (supabase
            .from('ocr_logs') as any)
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', today.toISOString());

        let useOciDirectly = false;

        if (countError) {
            console.error("쿼터 확인 실패 (OCI로 진행):", countError);
            useOciDirectly = true;
        } else if (count !== null && count >= MAX_DAILY_QUOTA) {
            console.log(`일일 쿼터(${MAX_DAILY_QUOTA}) 초과. OCI 서버로 전환합니다.`);
            useOciDirectly = true;
        }

        // 1. Google API 시도 (쿼터 내 && API 키 존재)
        if (!useOciDirectly && GEMINI_API_KEY) {
            try {
                const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
                const generativeModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
                const result = await generativeModel.generateContent([
                    OCR_PROMPT,
                    { inlineData: { mimeType: file.type, data: base64Image } },
                ]);
                const response = await result.response;
                const text = response.text();
                const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

                if (!jsonMatch) throw new Error('OCR 파싱 실패');

                const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);

                // 성공 로그
                await (supabase.from('ocr_logs') as any).insert({
                    user_id: user.id,
                    image_hash: imageHash,
                    model_used: 'gemini-3-flash-preview', // Vercel API
                    success: true,
                    metadata: { file_size: file.size, store_found: !!data.store_name }
                });

                return NextResponse.json(data);

            } catch (apiError: any) {
                console.warn('Google API 실패, OCI 서버로 폴백 시도:', apiError.message);
                // 에러 발생 시 아래 OCI 로직으로 진행
            }
        }

        // 2. OCI 서버 폴백 (쿼터 초과 OR API 실패 시)
        console.log('OCI OCR 요청 시작...');
        const data = await analyzeReceiptWithCliFallback(buffer, OCR_PROMPT);

        // 성공 로그 (OCI)
        await (supabase.from('ocr_logs') as any).insert({
            user_id: user.id,
            image_hash: imageHash,
            model_used: 'oci-gemini-server',
            success: true,
            metadata: {
                file_size: file.size,
                fallback: true,
                quota_exceeded: count !== null && count >= MAX_DAILY_QUOTA
            }
        });

        return NextResponse.json(data);


    } catch (error: any) {
        console.error('OCR 처리 오류 (OCI):', error.message);

        // [보안] 실패 로그 기록
        try {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user && buffer) {
                const hashBuffer = crypto.createHash('sha256').update(buffer).digest();
                const imageHash = hashBuffer.toString('hex');
                await (supabase.from('ocr_logs') as any).insert({
                    user_id: user.id,
                    image_hash: imageHash,
                    model_used: 'fail',
                    success: false,
                    metadata: { error: error.message }
                });
            }
        } catch (logError) {
            // 무시
        }

        return NextResponse.json({
            error: 'OCR 처리 중 오류가 발생했습니다.',
            details: error.message
        }, { status: 500 });
    }
}
