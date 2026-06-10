export const STORYBOARD_IMAGE_PROVIDER_ID = 'local-codex' as const;
export const STORYBOARD_IMAGE_PROVIDER_MODEL = 'gpt-image-2' as const;
export const STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE = 'exact' as const;
export const STORYBOARD_IMAGE_PROVIDER_MODEL_ENV = 'STORYBOARD_LOCAL_CODEX_IMAGE_MODEL' as const;
export const STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV = 'STORYBOARD_LOCAL_CODEX_COMMAND' as const;
export const STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER = '<verified bridge>' as const;

export type StoryboardImageProviderReason =
  | 'local_codex_model_not_allowed'
  | 'local_codex_bridge_unavailable'
  | 'local_codex_model_provenance_unverified'
  | 'ready'
  | 'unknown';

export type StoryboardImageProviderStatus =
  | 'checking'
  | 'ready'
  | 'blocked_model'
  | 'blocked_provenance'
  | 'error';

export type StoryboardImageProviderTarget = {
  width: number;
  height: number;
  aspectRatio: string;
};

export type StoryboardImageProviderReadiness = {
  status: StoryboardImageProviderStatus;
  label: string;
  summary: string;
  detail: string;
  reason: StoryboardImageProviderReason | 'checking' | 'ready' | 'error';
  model: string;
  providerId?: string;
  modelProvenance?: string;
  command?: string;
  target?: StoryboardImageProviderTarget;
  checkedAt?: string;
};

export type StoryboardImageProviderAvailabilityPayload = {
  available?: boolean;
  reason?: StoryboardImageProviderReason;
  command?: string;
  model?: string;
  providerId?: string;
  modelProvenance?: string;
  target?: StoryboardImageProviderTarget;
};

export type StoryboardImageProviderStatusResponse = {
  provider?: StoryboardImageProviderAvailabilityPayload;
  configuration?: {
    localCodexCommand?: string;
    localCodexModel?: string;
    localCodexProof?: string;
  };
  limits?: {
    maxScenesPerRequest?: number;
    target?: StoryboardImageProviderTarget;
  };
};

export const INITIAL_STORYBOARD_IMAGE_PROVIDER_READINESS: StoryboardImageProviderReadiness =
  {
    status: 'checking',
    label: '이미지 상태 확인 중',
    summary: 'GPT Image 2 provider 설정을 확인하고 있습니다.',
    detail:
      '스토리보드 컷 이미지를 생성하기 전에 exact gpt-image-2 provenance를 확인합니다.',
    reason: 'checking',
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
  };

export function isExactStoryboardGptImage2ProviderPayload(
  provider?: StoryboardImageProviderAvailabilityPayload,
): provider is StoryboardImageProviderAvailabilityPayload & {
  available: true;
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID;
  model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  modelProvenance: typeof STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE;
} {
  return (
    provider?.available === true &&
    provider.providerId === STORYBOARD_IMAGE_PROVIDER_ID &&
    provider.model === STORYBOARD_IMAGE_PROVIDER_MODEL &&
    provider.modelProvenance === STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE
  );
}

export function mapStoryboardImageProviderReadiness(
  payload?: StoryboardImageProviderStatusResponse,
): StoryboardImageProviderReadiness {
  const provider = payload?.provider;
  const model = provider?.model ?? STORYBOARD_IMAGE_PROVIDER_MODEL;
  const target = provider?.target ?? payload?.limits?.target;
  const checkedAt = new Date().toISOString();

  if (isExactStoryboardGptImage2ProviderPayload(provider)) {
    return {
      status: 'ready',
      label: '이미지 생성 준비됨',
      summary: `exact ${model} provider가 준비되었습니다.`,
      detail:
        '현재 페이지의 스토리보드 컷을 실제 GPT Image 2 이미지로 재생성할 수 있습니다.',
      reason: 'ready',
      model,
      providerId: provider.providerId,
      modelProvenance: provider.modelProvenance,
      command: provider.command,
      target,
      checkedAt,
    };
  }

  if (model !== STORYBOARD_IMAGE_PROVIDER_MODEL) {
    return {
      status: 'blocked_model',
      label: '이미지 모델 차단됨',
      summary: `${model}은 허용된 스토리보드 이미지 모델이 아닙니다.`,
      detail:
        '스토리보드 이미지는 gpt-image-2만 허용합니다. 다른 이미지 모델이나 fallback은 실행하지 않습니다.',
      reason: 'local_codex_model_not_allowed',
      model,
      providerId: provider?.providerId,
      modelProvenance: provider?.modelProvenance,
      command: provider?.command,
      target,
      checkedAt,
    };
  }

  if (
    provider?.reason === 'local_codex_bridge_unavailable' ||
    provider?.reason === 'local_codex_model_provenance_unverified' ||
    provider?.available === true
  ) {
    return {
      status: 'blocked_provenance',
      label: '이미지 생성 설정 필요',
      summary: `exact ${model} provenance가 아직 검증되지 않았습니다.`,
      detail:
        '검증된 로컬 Codex/OAuth gpt-image-2 bridge가 연결되기 전까지 fresh 이미지 생성은 중단됩니다.',
      reason: 'local_codex_model_provenance_unverified',
      model,
      providerId: provider?.providerId,
      modelProvenance: provider?.modelProvenance,
      command: provider?.command,
      target,
      checkedAt,
    };
  }

  if (provider?.reason === 'local_codex_model_not_allowed') {
    return {
      status: 'blocked_model',
      label: '이미지 모델 차단됨',
      summary: `${model}은 허용된 스토리보드 이미지 모델이 아닙니다.`,
      detail:
        '스토리보드 이미지는 gpt-image-2만 허용합니다. 다른 이미지 모델이나 fallback은 실행하지 않습니다.',
      reason: 'local_codex_model_not_allowed',
      model,
      providerId: provider.providerId,
      modelProvenance: provider.modelProvenance,
      command: provider.command,
      target,
      checkedAt,
    };
  }

  return {
    status: 'error',
    label: '이미지 상태 확인 실패',
    summary: '스토리보드 이미지 provider 상태를 읽지 못했습니다.',
    detail:
      '페이지는 계속 사용할 수 있지만 fresh 이미지 생성 전 provider 상태를 다시 확인해야 합니다.',
    reason: provider?.reason ?? 'unknown',
    model,
    providerId: provider?.providerId,
    modelProvenance: provider?.modelProvenance,
    command: provider?.command,
    target,
    checkedAt,
  };
}

export function formatStoryboardImageProviderTarget(
  target?: StoryboardImageProviderTarget,
) {
  if (!target) return '1280×720 · 16:9';
  return `${target.width}×${target.height} · ${target.aspectRatio}`;
}

export function isStoryboardImageProviderReady(
  readiness: StoryboardImageProviderReadiness,
) {
  return readiness.status === 'ready';
}

export function formatStoryboardImageProviderGuidanceMessage(
  readiness: StoryboardImageProviderReadiness,
) {
  return [
    `이미지 생성 상태 · ${readiness.label}`,
    `모델: ${readiness.model} · 타깃 ${formatStoryboardImageProviderTarget(readiness.target)}`,
    `상태: ${readiness.summary}`,
    readiness.detail,
    `필요 설정: ${STORYBOARD_IMAGE_PROVIDER_MODEL_ENV}=gpt-image-2 · ${STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV}=${STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER} · exact provenance 확인`,
    '정책: 다른 이미지 모델, mock 이미지, fallback 생성은 실행하지 않습니다.',
  ].join('\n');
}
