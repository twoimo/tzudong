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
