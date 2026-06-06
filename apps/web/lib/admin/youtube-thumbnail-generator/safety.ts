import type { ThumbnailGeneratorPayload } from './types';
import { ThumbnailGenerationError } from './types';

const COPIED_REFERENCE_PHRASES = [
  '동남아 야시장 또는 푸드코트 분위기의 길거리 음식 탐방 썸네일',
  '홍콩 야시장 분위기의 붐비는 밤거리에서',
  '일본 편의점 앞과 매장 내부를 배경으로',
  '붐비는 실내 길거리 음식점에서 거대한 양의 구운 고기',
  '넓은 식당 테이블 위에 윤기 나는 주황색 생선 초밥',
];

const URL_OR_EMAIL_PATTERN = /(https?:\/\/|www\.|@[^\s]+\.[a-z]{2,}|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i;
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\d{2,4}[\s.-]?){2,}\d{3,4}/;
const ADDRESS_PATTERN = /(로\s?\d+|길\s?\d+|번길|동\s?\d+|구\s?\d+|시\s?\d+|주소|전화|연락처)/;
const PRICE_PATTERN = /(?:₩|원|달러|엔|위안|만원|천원|\$)\s?\d|\d[\d,\.]*\s?(?:원|달러|엔|위안|만원|천원|\$)/;
const IDENTITY_PATTERN = /(쯔양|tzuyang|youtube\s*channel|유튜브\s*채널|계정|@[\w_.-]+)/i;
const BRAND_PATTERN = /(로고|브랜드|상표|맥도날드|스타벅스|코카콜라|나이키|애플|삼성|cu|gs25|세븐일레븐)/i;
const CROWD_PATTERN = /(식별 가능|얼굴이 선명|군중 얼굴|배경 인물.*선명|특정 인물처럼)/;
const PROMPT_INJECTION_PATTERN = /(ignore\s+(all\s+)?(previous|prior|above)\s+instructions|system\s+prompt|developer\s+message|process\.env|api[_-]?key|secret|token|비밀|시스템\s*프롬프트|이전\s*지시.*무시|지시.*무시|환경\s*변수|키를?\s*출력|토큰을?\s*출력)/i;

function payloadText(payload: ThumbnailGeneratorPayload) {
  return [
    payload.topic,
    payload.headline,
    payload.subHeadline,
    ...(payload.textLayers ?? []).map((layer) => layer.content),
  ]
    .filter(Boolean)
    .join('\n');
}

function renderableText(payload: ThumbnailGeneratorPayload) {
  return [
    payload.headline,
    payload.subHeadline,
    ...(payload.textLayers ?? []).map((layer) => layer.content),
  ]
    .filter(Boolean)
    .join('\n');
}

export function validateThumbnailSafety(payload: ThumbnailGeneratorPayload) {
  if (payload.acknowledgedSafety !== true) {
    throw new ThumbnailGenerationError('required_ack', '이미지 권리와 안전 사용 확인이 필요합니다.', 400);
  }

  const text = payloadText(payload).trim();
  if (!text || text.length > 1_200 || /[<>`{}]/.test(text)) {
    throw new ThumbnailGenerationError('invalid_text', '입력 텍스트가 비어 있거나 허용 길이/문자를 벗어났습니다.', 400);
  }

  if (URL_OR_EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text) || ADDRESS_PATTERN.test(text)) {
    throw new ThumbnailGenerationError('unsafe_contact', 'URL, 이메일, 전화번호, 주소처럼 보이는 텍스트는 썸네일에 넣을 수 없습니다.', 400);
  }
  if (PRICE_PATTERN.test(text)) {
    throw new ThumbnailGenerationError('unsafe_price', '정확한 가격/금액 표현은 썸네일 생성 입력에서 제한합니다.', 400);
  }
  const textForRendering = renderableText(payload);
  if (IDENTITY_PATTERN.test(textForRendering)) {
    throw new ThumbnailGenerationError('unsafe_identity', '실제 채널명, 계정명, 개인 식별 텍스트는 렌더링 텍스트로 사용할 수 없습니다.', 400);
  }
  if (BRAND_PATTERN.test(text)) {
    throw new ThumbnailGenerationError('unsafe_brand', '브랜드/로고/상표를 요청하는 텍스트는 제한합니다.', 400);
  }
  if (CROWD_PATTERN.test(text)) {
    throw new ThumbnailGenerationError('unsafe_crowd', '배경 인물의 식별 가능성을 높이는 지시는 제한합니다.', 400);
  }
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    throw new ThumbnailGenerationError('unsafe_instruction', '시스템 지시 무시, 비밀/환경변수/키 출력처럼 보이는 문구는 썸네일 생성 입력에서 제한합니다.', 400);
  }

  const normalizedText = text.replace(/\s+/g, ' ');
  const copiedPhrase = COPIED_REFERENCE_PHRASES.find(
    (phrase) => normalizedText.includes(phrase),
  );
  if (copiedPhrase) {
    throw new ThumbnailGenerationError('unsafe_copy', '참고 프롬프트의 긴 문장을 그대로 복사하지 말고 새 소재에 맞게 요약하세요.', 400);
  }
}
