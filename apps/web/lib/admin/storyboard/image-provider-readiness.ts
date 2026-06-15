export const STORYBOARD_IMAGE_PROVIDER_ID = 'local-codex' as const;
export const STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID = 'browser-openai-api-key' as const;
export const STORYBOARD_IMAGE_PROVIDER_MODEL = 'gpt-image-2' as const;
export const STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE = 'exact' as const;
export const STORYBOARD_IMAGE_PROVIDER_MODEL_ENV = 'STORYBOARD_LOCAL_CODEX_IMAGE_MODEL' as const;
export const STORYBOARD_IMAGE_PROVIDER_COMMAND_ENV = 'STORYBOARD_LOCAL_CODEX_COMMAND' as const;
export const STORYBOARD_IMAGE_PROVIDER_COMMAND_PLACEHOLDER = '<verified bridge>' as const;
export const STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER = 'x-storyboard-openai-api-key' as const;
export const STORYBOARD_BROWSER_MODEL_KEYS_STORAGE_KEY =
  'tzudong.admin.storyboard.modelKeys.v1' as const;

export type StoryboardImageProviderReason =
  | 'local_codex_model_not_allowed'
  | 'local_codex_bridge_unavailable'
  | 'local_codex_model_provenance_unverified'
  | 'browser_openai_api_key_present'
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
  authMode?: string;
  browserKeyStorage?: 'browser_local_storage_only';
  target?: StoryboardImageProviderTarget;
};

export type StoryboardImageProviderStatusResponse = {
  provider?: StoryboardImageProviderAvailabilityPayload;
  configuration?: {
    localCodexCommand?: string;
    localCodexModel?: string;
    localCodexProof?: string;
    browserOpenAIApiKey?: string;
    browserKeyStorage?: 'browser_local_storage_only';
    browserApiKeyHeader?: typeof STORYBOARD_BROWSER_OPENAI_API_KEY_HEADER;
    browserImageTransport?: 'data_url_response_no_server_file_write';
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
    summary: '이미지 생성 준비 여부를 확인하고 있습니다.',
    detail:
      '확인이 끝나기 전에는 새 이미지 만들기 버튼을 잠시 비활성화합니다.',
    reason: 'checking',
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
  };

export function isExactStoryboardGptImage2ProviderPayload(
  provider?: StoryboardImageProviderAvailabilityPayload,
): provider is StoryboardImageProviderAvailabilityPayload & {
  available: true;
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID | typeof STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID;
  model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  modelProvenance: typeof STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE;
} {
  return (
    provider?.available === true &&
    (
      provider.providerId === STORYBOARD_IMAGE_PROVIDER_ID ||
      provider.providerId === STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID
    ) &&
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
    const isBrowserKeyProvider =
      provider.providerId === STORYBOARD_BROWSER_OPENAI_IMAGE_PROVIDER_ID;
    return {
      status: 'ready',
      label: '이미지 생성 준비됨',
      summary: isBrowserKeyProvider
        ? '브라우저에 저장한 API 키로 이미지 생성 준비가 끝났습니다.'
        : '이미지 만들기 준비가 끝났습니다.',
      detail:
        isBrowserKeyProvider
          ? '키는 이 브라우저 캐시에만 보관되고, 이미지는 서버 파일로 저장하지 않고 현재 응답으로만 전달됩니다.'
          : '현재 페이지의 스토리보드 컷을 새 이미지로 만들 수 있습니다.',
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
      label: '이미지 생성 설정 확인 필요',
      summary: '현재 이미지 생성 설정을 사용할 수 없습니다.',
      detail:
        '안전 확인이 끝날 때까지 새 이미지 생성을 멈춥니다.',
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
      summary: '이미지 생성 연결 확인이 아직 끝나지 않았습니다.',
      detail:
        '확인이 끝나면 현재 페이지의 컷 이미지를 만들 수 있습니다.',
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
      label: '이미지 생성 설정 확인 필요',
      summary: '현재 이미지 생성 설정을 사용할 수 없습니다.',
      detail:
        '안전 확인이 끝날 때까지 새 이미지 생성을 멈춥니다.',
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
    summary: '스토리보드 이미지 상태를 읽지 못했습니다.',
    detail:
      '페이지는 계속 사용할 수 있지만 새 이미지 생성 전 다시 확인해 주세요.',
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
  const nextAction =
    readiness.status === 'ready'
      ? '이미지 만들기 버튼을 누르면 현재 페이지 컷을 새 이미지로 채울 수 있습니다.'
      : '설정 확인이 끝난 뒤 이미지 만들기 버튼을 다시 눌러 주세요.';

  return [
    `이미지 생성 상태 · ${readiness.label}`,
    `대상 크기: ${formatStoryboardImageProviderTarget(readiness.target)}`,
    `상태: ${readiness.summary}`,
    readiness.detail,
    nextAction,
  ].join('\n');
}
