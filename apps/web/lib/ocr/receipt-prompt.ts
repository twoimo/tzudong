export const RECEIPT_OCR_PROMPT_VERSION = 'receipt-extraction-v2';
export const RECEIPT_OCR_PREPROCESS_VERSION = 'receipt-image-1600w-q90-original-first-v3';

export const RECEIPT_OCR_EXTRACTION_PROMPT = `당신은 한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

## 목표
영수증에서 사실 기반 OCR 필드만 추출하세요. 리뷰 초안이나 마케팅 문구를 만들지 마세요.
불확실하면 추측으로 단정하지 말고 보이는 후보를 가장 보수적으로 선택하세요.

## 추출 필드
- store_name: 가게명. 주문매장/상호/가맹점 필드를 우선합니다.
- date: YYYY-MM-DD
- time: HH:MM
- total_amount: 숫자만
- items: 실제 주문 메뉴만 포함합니다. 인원수/사업자번호/카드번호/승인번호/합계/세액/과세/면세/주문번호는 메뉴가 아닙니다. { name, price } 배열. 가격을 모르면 null.
- confidence: 0.0~1.0

## 주의
- 유명 브랜드 자동 완성 금지. 보이는 텍스트와 영수증 문맥을 우선합니다.
- 상호명이 헷갈리면 매장명 영역의 문자 형태를 우선하고, 메뉴/주소로 임의 보정하지 않습니다.
- 작은 한글 메뉴명을 최대한 보수적으로 읽고, 모르면 추측하지 않습니다.
- JSON만 반환하세요.

성공 시:
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "total_amount": 15000,
  "items": [
    { "name": "메뉴명", "price": 15000 }
  ],
  "confidence": 0.0
}

실패 시:
{
  "error": "not_receipt / unreadable",
  "confidence": 0.0
}
`;

export const RECEIPT_OCR_PROMPT = `당신은 한국 음식점 영수증/배달앱 주문서 OCR 전문가입니다.

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
- 줄바꿈 문자(\\n)를 사용하여 문단을 나누세요.
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
  "review_draft": "홍콩반점에서 짜장면이랑 탕수육 먹고 왔어요! 😋\\n양도 진짜 많고 소스도 달콤해서 너무 맛있게 먹었네요.\\n총 15,000원 나왔는데 가성비 진짜 최고인 듯! 강추합니다. 👍",
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

export type ReceiptOcrPromptFamily = 'gemini' | 'qwen' | 'llama' | 'generic';

export type ReceiptOcrPromptExperiment = {
  version: string;
  family: ReceiptOcrPromptFamily;
  prompt: string;
  purpose: string;
};

const RECEIPT_OCR_V3_COMMON_SCHEMA = `JSON만 반환하세요. 필드는 store_name, store_name_candidates, date, time, total_amount, items, uncertain_fields, raw_text_hints, confidence 입니다. 리뷰 초안은 만들지 마세요.`;

export const RECEIPT_OCR_PROMPT_EXPERIMENTS: Record<ReceiptOcrPromptFamily, ReceiptOcrPromptExperiment> = {
  gemini: {
    version: 'receipt-extraction-v3-gemini-evidence-candidates',
    family: 'gemini',
    purpose: 'Gemini baseline accuracy를 유지하면서 후보/근거를 분리해 DB 보정 전후 점수를 비교한다.',
    prompt: `${RECEIPT_OCR_EXTRACTION_PROMPT}\n\n## v3 Gemini 실험\n- 상호가 불확실하면 store_name_candidates 배열에 보이는 후보를 최대 3개까지 넣으세요.\n- raw_text_hints에는 실제로 보이는 라벨/행 텍스트만 짧게 넣으세요.\n- uncertain_fields에는 불확실한 필드명을 넣으세요.\n${RECEIPT_OCR_V3_COMMON_SCHEMA}`,
  },
  qwen: {
    version: 'receipt-extraction-v3-qwen-strict-json-candidates',
    family: 'qwen',
    purpose: 'NIM/Qwen 계열의 JSON 안정성과 상호 후보 추출 정확도를 높인다.',
    prompt: `한국 음식점 영수증 OCR을 수행합니다. 추측 금지. JSON 외 텍스트 금지.\n${RECEIPT_OCR_V3_COMMON_SCHEMA}\nitems에는 실제 메뉴만 넣고 인원수/사업자번호/카드승인/합계/세액은 제외하세요.`,
  },
  llama: {
    version: 'receipt-extraction-v3-llama-short-schema',
    family: 'llama',
    purpose: 'Llama/Nemotron 계열에서 짧은 스키마로 지연과 환각을 줄인다.',
    prompt: `Read the Korean restaurant receipt image. Return compact JSON only: store_name, date, time, total_amount, items, confidence, uncertain_fields. Do not write a review draft.`,
  },
  generic: {
    version: 'receipt-extraction-v3-generic-conservative',
    family: 'generic',
    purpose: '모델 미분류 fallback에서 보수적인 사실 추출만 수행한다.',
    prompt: `${RECEIPT_OCR_EXTRACTION_PROMPT}\n\n상호/날짜/총액/메뉴가 불확실하면 uncertain_fields에 표시하고 추측하지 마세요.`,
  },
};

export const RECEIPT_OCR_PREPROCESS_EXPERIMENTS = [
  { version: RECEIPT_OCR_PREPROCESS_VERSION, label: 'production-baseline-original-first', productionDefault: true },
  { version: 'receipt-image-original-v1', label: 'original-image-no-resize', productionDefault: false },
  { version: 'receipt-image-1600w-q85-v1', label: 'resize-1600-jpeg-q85', productionDefault: false },
  { version: 'receipt-image-grayscale-sharpen-v1', label: 'grayscale-sharpen', productionDefault: false },
] as const;

export function getReceiptOcrPromptExperiment(family: ReceiptOcrPromptFamily): ReceiptOcrPromptExperiment {
  return RECEIPT_OCR_PROMPT_EXPERIMENTS[family] ?? RECEIPT_OCR_PROMPT_EXPERIMENTS.generic;
}
