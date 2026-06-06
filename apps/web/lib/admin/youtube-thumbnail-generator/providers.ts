import type {
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailProviderId,
  ThumbnailReferenceImage,
} from './types';
import { ThumbnailGenerationError } from './types';
import { buildYoutubeThumbnailPrompt } from './prompt';

const LOCAL_CODEX_DEFAULT_MODEL = 'requested:gpt-image-2';
const LOCAL_CODEX_EXACT_IMAGE_MODEL = 'gpt-image-2';

type ThumbnailProviderExecutionOptions = {
  signal?: AbortSignal;
  runId?: string;
};

export function isThumbnailProviderId(value: unknown): value is ThumbnailProviderId {
  return value === 'local-codex';
}

export function resolveLocalCodexThumbnailModel(env: NodeJS.ProcessEnv = process.env) {
  return env.THUMBNAIL_LOCAL_CODEX_IMAGE_MODEL?.trim() || LOCAL_CODEX_DEFAULT_MODEL;
}

function getLocalCodexStrictBlock(env: NodeJS.ProcessEnv) {
  const model = resolveLocalCodexThumbnailModel(env);
  if (model !== LOCAL_CODEX_EXACT_IMAGE_MODEL) {
    return {
      code: 'unsupported_model',
      status: 400,
      reason: 'local_codex_model_not_allowed',
      message: `Local Codex built-in image_generation은 exact ${LOCAL_CODEX_EXACT_IMAGE_MODEL}만 허용합니다. 요청 라벨 또는 다른 모델은 실행하지 않습니다: ${model}`,
      model,
    } as const;
  }

  return {
    code: 'provider_unavailable',
    status: 503,
    reason: 'local_codex_model_provenance_unverified',
    message: 'Local Codex built-in image_generation은 현재 실제 backend 이미지 모델이 gpt-image-2인지 확정 증거를 제공하지 않아 생성을 중단합니다.',
    model,
  } as const;
}

function getLocalCodexCommand(env: NodeJS.ProcessEnv) {
  return env.THUMBNAIL_LOCAL_CODEX_COMMAND?.trim() || null;
}

function throwIfProviderAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ThumbnailGenerationError('thumbnail_generation_aborted', '썸네일 이미지 생성 작업이 취소되었습니다.', 499);
  }
}

export async function probeLocalCodex(env: NodeJS.ProcessEnv = process.env) {
  const strictBlock = getLocalCodexStrictBlock(env);
  return {
    available: false,
    reason: strictBlock.reason,
    model: strictBlock.model,
    strictExactModelRequired: true,
    command: getLocalCodexCommand(env) ?? undefined,
  } as const;
}

async function generateLocalCodexThumbnail(
  env: NodeJS.ProcessEnv,
  options: ThumbnailProviderExecutionOptions,
): Promise<ThumbnailGenerationResult> {
  throwIfProviderAborted(options.signal);
  const strictBlock = getLocalCodexStrictBlock(env);
  throw new ThumbnailGenerationError(strictBlock.code, strictBlock.message, strictBlock.status);
}

export async function generateYoutubeThumbnailWithPrompt(
  payload: ThumbnailGeneratorPayload,
  _referenceImages: ThumbnailReferenceImage[],
  _prompt: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailProviderExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  switch (payload.providerId) {
    case 'local-codex':
      return generateLocalCodexThumbnail(env, options);
    default: {
      throw new ThumbnailGenerationError('provider_unavailable', '지원하지 않는 provider입니다.', 400);
    }
  }
}

export async function generateYoutubeThumbnail(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
  env: NodeJS.ProcessEnv = process.env,
  options: ThumbnailProviderExecutionOptions = {},
): Promise<ThumbnailGenerationResult> {
  const prompt = buildYoutubeThumbnailPrompt(payload, referenceImages);
  return generateYoutubeThumbnailWithPrompt(payload, referenceImages, prompt, env, options);
}

export function getThumbnailProviderAvailability(env: NodeJS.ProcessEnv = process.env) {
  const strictBlock = getLocalCodexStrictBlock(env);
  return {
    localCodex: {
      available: false,
      reason: strictBlock.reason,
      model: strictBlock.model,
      strictExactModelRequired: true,
      command: getLocalCodexCommand(env) ?? undefined,
    },
  };
}
