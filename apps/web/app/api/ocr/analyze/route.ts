import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 환경 변수 검증
const GEMINI_API_KEY = process.env.GEMINI_OCR_YEON;

if (!GEMINI_API_KEY) {
    console.error("GEMINI_OCR_YEON 환경변수가 설정되지 않았습니다.");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');

const OCR_PROMPT = `당신은 한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

## 핵심 지침

### 1. 가게명 추출 (가장 중요!)
- **배달앱(쿠팡이츠, 배달의민족, 요기요 등) 영수증**:
  - 가게명은 앱 로고 바로 아래가 아닌, "주문매장:", "가맹점:", "상호:" 필드에서 확인하세요.
  - 상단에 보이는 이상한 문자열(예: OUVPZE, XKPQE 등)은 OCR 오류일 가능성이 높습니다.
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

### 6. 리뷰 초안 작성 (자연스러운 한국어 3줄 이상)
- 형식: 자연스러운 구어체로 작성해주세요.
- 내용: 
  1. 방문 목적이나 분위기 (예: "친구들이랑 오랜만에 모임이 있어서 다녀왔어요.")
  2. 주문한 메뉴와 맛 평가 (예: "[메뉴1]은 정말 부드러웠고, [메뉴2]는 매콤해서 딱 좋았어요.")
  3. 총평 및 추천 (예: "가격도 [금액]원이라 합리적이고, 사장님도 친절하셔서 다시 오고 싶네요! 강추합니다! 👍")
- **제약사항**: 반드시 공백 포함 50자 이상, 3문장 이상으로 작성하세요.
- 이모지 2~3개 적절히 포함.

## 응답 형식 (JSON만 반환)

성공 시:
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 15000,
  "category": "중식",
  "review_draft": "홍콩반점에서 짜장면, 탕수육을 먹었어요. 총 15,000원 나왔는데 가성비 좋네요! 😋",
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
    try {
        if (!GEMINI_API_KEY) {
            return NextResponse.json({ error: '서버 설정 오류: API 키 누락' }, { status: 500 });
        }

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
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        // Gemini 모델 초기화
        // 사용자가 요청한 최신 모델 gemini-3-flash-preview 사용
        const generativeModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

        const result = await generativeModel.generateContent([
            OCR_PROMPT,
            {
                inlineData: {
                    mimeType: file.type,
                    data: base64Image,
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();

        // JSON 파싱 (마크다운 코드 블록 제거)
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.error("OCR 파싱 실패:", text);
            return NextResponse.json({ error: 'OCR 처리 실패', raw: text }, { status: 500 });
        }

        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const data = JSON.parse(jsonStr);

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('OCR 처리 오류:', {
            message: error.message,
            stack: error.stack,
            details: error.response?.data || error
        });

        const errorMessage = error.message.includes('API key')
            ? '유효하지 않은 API 키'
            : '내부 서버 오류';

        return NextResponse.json({
            error: errorMessage,
            details: error.message
        }, { status: 500 });
    }
}
