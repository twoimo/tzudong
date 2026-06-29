const THUMBNAIL_CHAT_GENERATION_QUESTION_PATTERN = /(?:얼마나|언제|어떻게|왜|무엇|뭐|필요(?:해|한|하|할|인가|인가요|해요|한가요|하나요)|되나|되나요|돼|돼요|될까|걸려|걸리|알려|설명|방법)/i;
const THUMBNAIL_CHAT_GUIDANCE_QUESTION_PATTERN = /(?:얼마나|언제|어떻게|왜|무엇|뭐|가능|필요|되나|되나요|돼|돼요|될까|걸려|걸리|알려|설명|방법|하려면|하면\s*돼|상태|저장|다운로드|내보내기|참고\s*이미지|레퍼런스|브릿지|프로바이더|모델|키|비용|시간)/i;
const THUMBNAIL_CHAT_EXPLICIT_GENERATION_COMMAND_PATTERN = /(?:생성|만들|제작|그려|실행|뽑아|렌더|render|generate|create)\s*(?:해\s*)?(?:줘|주세요|줘요|주라|줘라|하자|진행|시작)|(?:좋아|오케이|ㅇㅋ|그걸로|이걸로|그\s*방향으로).{0,24}(?:생성|만들|진행|실행)|(?:썸네일|이미지).{0,24}(?:생성해|만들어|뽑아)/i;

export function normalizeThumbnailChatIntentText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasExplicitThumbnailGenerationCommand(value: string) {
  const normalized = normalizeThumbnailChatIntentText(value);
  if (!normalized) return false;
  return THUMBNAIL_CHAT_EXPLICIT_GENERATION_COMMAND_PATTERN.test(normalized) &&
    !THUMBNAIL_CHAT_GENERATION_QUESTION_PATTERN.test(normalized);
}

export function isThumbnailChatGuidanceQuestion(value: string) {
  const normalized = normalizeThumbnailChatIntentText(value);
  if (!normalized) return false;
  return /[?？]/.test(normalized) || THUMBNAIL_CHAT_GUIDANCE_QUESTION_PATTERN.test(normalized);
}
