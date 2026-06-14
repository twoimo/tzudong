export const STORYBOARD_PUBLIC_SAFETY_REPLACEMENT = '[안전상 제거된 운영 지시]';

const SECRET_VALUE_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9_-]{12,}/g,
  /eyJ[A-Za-z0-9_.-]{20,}/g,
  /https:\/\/[^\s]+(?:token|key|secret)[^\s]*/gi,
];

const SECRET_REFERENCE_PATTERNS = [
  /\b(?:OPENAI|SUPABASE|ANTHROPIC|GEMINI|GOOGLE|VERCEL|DATABASE|SERVICE)[_\s-]*(?:API[_\s-]*KEY|SERVICE[_\s-]*ROLE[_\s-]*KEY|ANON[_\s-]*KEY|SECRET|TOKEN|PRIVATE[_\s-]*KEY|PASSWORD)\b/gi,
  /\b(?:API[_\s-]*KEY|SERVICE[_\s-]*ROLE[_\s-]*KEY|SECRET|TOKEN|PRIVATE[_\s-]*KEY|PASSWORD)\b/gi,
  /\bprocess\.env\b/gi,
];

const HOSTILE_INSTRUCTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous\s+instructions?[^.!?\n\r]*/gi,
  /(?:reveal|show|print|expose|leak)\s+(?:[^.!?\n\r]{0,80})?(?:api[_\s-]*key|service[_\s-]*role|secret|token|process\.env|env)[^.!?\n\r]*/gi,
  /(?:delete|remove|wipe)\s+(?:[^.!?\n\r]{0,80})?(?:\.omx|database|db|admin|state|file|env)[^.!?\n\r]*/gi,
  /(?:skip|bypass)\s+(?:[^.!?\n\r]{0,80})?(?:review|approval|verification|validation|guard|safety)[^.!?\n\r]*/gi,
  /\.omx(?:[\/\\][^\s,.;!?)]*)?/gi,
  /rm\s+-rf[^.!?\n\r]*/gi,
  /이전\s*지시(?:를)?[^.!?\n\r]{0,24}무시[^.!?\n\r]*/g,
  /시스템\s*지시(?:를)?[^.!?\n\r]{0,24}무시[^.!?\n\r]*/g,
  /(?:비밀|시크릿|토큰|키|환경\s*변수|서비스\s*롤|service\s*role)[^.!?\n\r]{0,40}(?:보여|출력|노출|공개|알려)[^.!?\n\r]*/gi,
  /(?:검증|평가|승인|안전장치)[^.!?\n\r]{0,24}(?:건너뛰|우회|무시)[^.!?\n\r]*/g,
  /(?:관리자\s*)?(?:승인\s*)?(?:없이\s*)?(?:DB|데이터베이스|데이터|파일|환경\s*변수|비밀키)[^.!?\n\r]{0,32}(?:삭제(?:해|하라|하세요)?|지워|노출|출력)[^.!?\n\r]*/gi,
];

function collapseSafetyReplacements(value: string) {
  const escapedReplacement = STORYBOARD_PUBLIC_SAFETY_REPLACEMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(`(?:${escapedReplacement}\\s*){2,}`, 'g'), `${STORYBOARD_PUBLIC_SAFETY_REPLACEMENT} `)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

export function sanitizeStoryboardPublicText(value: string) {
  const withoutSecretValues = SECRET_VALUE_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, STORYBOARD_PUBLIC_SAFETY_REPLACEMENT),
    value,
  );
  const withoutSecretReferences = SECRET_REFERENCE_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, STORYBOARD_PUBLIC_SAFETY_REPLACEMENT),
    withoutSecretValues,
  );
  const withoutHostileInstructions = HOSTILE_INSTRUCTION_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, STORYBOARD_PUBLIC_SAFETY_REPLACEMENT),
    withoutSecretReferences,
  );

  return collapseSafetyReplacements(withoutHostileInstructions);
}

export function sanitizeStoryboardPrompt(value: string) {
  return sanitizeStoryboardPublicText(value);
}
