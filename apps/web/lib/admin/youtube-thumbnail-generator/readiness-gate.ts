import {
  probeAnyCapGptImageReadiness,
  type AnyCapGptImageReadiness,
} from '../anycap-gpt-image-readiness';
import {
  hasExplicitThumbnailGenerationCommand,
  isThumbnailChatGuidanceQuestion,
} from './chat-intent';
import type { ThumbnailProviderReadinessBlocker } from './types';

type NonReadyAnyCapGptImageReadiness = AnyCapGptImageReadiness & {
  status: Exclude<AnyCapGptImageReadiness['status'], 'ready'>;
};

const NO_PROVIDER_UTILITY_PATTERNS = [
  /^(?:ㅎㅇ|하이|안녕|안녕하세요|고마워|감사|ㄱㅅ|도움말|help|사용법)$/i,
  /(?:뭐\s*할\s*수|무엇을\s*할\s*수|어떻게\s*쓰|사용법|도움말|help|가이드|guidance)/i,
  /(?:검토|리뷰|평가|어때|괜찮|초보자도\s*이해|왜\s*이렇게|분석|클릭률.*어떻게|가독성.*어때)/i,
  /(?:초기화|리셋|reset)/i,
] as const;

const GENERATION_OR_CANVAS_EDIT_PATTERNS = [
  /(?:이미지|썸네일|thumbnail)[^.!?。]{0,48}(?:만들|생성|재생성|실행|그려|바꿔|수정|편집|키워|줄여|옮겨|적용)/i,
  /(?:생성|재생성|만들어|그려|편집|수정|바꿔|적용|크게|작게|옮겨|지워|추가|삭제)\s*(?:해|해줘|해주세요|줘|주세요)?/i,
  /(?:generate|create|render|edit|update|apply|resize|move|delete|add)/i,
] as const;

function sanitizeReadiness(readiness: NonReadyAnyCapGptImageReadiness): ThumbnailProviderReadinessBlocker['readiness'] {
  return {
    providerId: readiness.providerId,
    model: readiness.model,
    strictExactModelRequired: readiness.strictExactModelRequired,
    fallbackAllowed: readiness.fallbackAllowed,
    status: readiness.status,
    reason: readiness.reason,
    remediation: readiness.remediation,
    diagnostics: {
      checkedAt: readiness.trace.checkedAt,
      requestedModel: readiness.trace.requestedModel,
      statusCommand: readiness.trace.statusCommand,
      statusExitCode: readiness.trace.statusExitCode,
      modelsCommand: readiness.trace.modelsCommand,
      modelsExitCode: readiness.trace.modelsExitCode,
      snippets: readiness.trace.snippets,
    },
  };
}

export function buildThumbnailProviderReadinessBlocker(
  readiness: AnyCapGptImageReadiness,
): ThumbnailProviderReadinessBlocker | null {
  if (readiness.status === 'ready') return null;
  return {
    error: 'provider_unavailable',
    code: 'thumbnail_anycap_gpt_image_2_not_ready',
    detail: 'AnyCap gpt-image-2 이미지 생성 준비가 끝나지 않았습니다. 설정을 확인한 뒤 다시 시도하세요.',
    readiness: sanitizeReadiness(readiness as NonReadyAnyCapGptImageReadiness),
  };
}

export async function getThumbnailProviderReadinessBlocker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ThumbnailProviderReadinessBlocker | null> {
  return buildThumbnailProviderReadinessBlocker(await probeAnyCapGptImageReadiness(env));
}

export function isNoProviderThumbnailChatUtility(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (hasExplicitThumbnailGenerationCommand(normalized)) return false;
  if (isThumbnailChatGuidanceQuestion(normalized)) return true;
  if (GENERATION_OR_CANVAS_EDIT_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return NO_PROVIDER_UTILITY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shouldCheckThumbnailProviderReadinessForChat(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (isNoProviderThumbnailChatUtility(normalized)) return false;
  return true;
}
