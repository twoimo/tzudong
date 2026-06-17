import {
  LOCAL_BRIDGE_DEFAULT_URL,
  LOCAL_BRIDGE_MODEL,
  LOCAL_BRIDGE_PROVIDER_ID,
  LOCAL_BRIDGE_ROUTE_ID,
  LOCAL_BRIDGE_TOKEN_HEADER,
  LocalBridgeContractError,
  getLocalBridgeAuthHeaders,
  hasExactLocalBridgeImageGenerationProvenance,
  normalizeLocalBridgeToken,
  normalizeLocalBridgeUrl,
  redactLocalBridgeSecretText,
  requireLocalBridgeToken,
  type LocalBridgeContractErrorCode,
  type LocalBridgeStatus,
} from '../local-bridge/core-contract';
import type {
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailReferenceRole,
} from './types';

export const THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID = LOCAL_BRIDGE_ROUTE_ID;
export const THUMBNAIL_LOCAL_BRIDGE_DEFAULT_URL = LOCAL_BRIDGE_DEFAULT_URL;
export const THUMBNAIL_LOCAL_BRIDGE_TOKEN_HEADER = LOCAL_BRIDGE_TOKEN_HEADER;
export const THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH = '/v1/youtube-thumbnail/images' as const;
export const THUMBNAIL_LOCAL_BRIDGE_MAX_BODY_BYTES = 64 * 1024 * 1024;

export type ThumbnailLocalBridgeRouteId = typeof THUMBNAIL_LOCAL_BRIDGE_ROUTE_ID;
export type ThumbnailLocalBridgeStatus = LocalBridgeStatus;

export type ThumbnailLocalBridgeHealthResponse = {
  ok: boolean;
  bridge: 'tzudong-storyboard-local-bridge';
  version: 1;
  status: 'ok';
  tokenRequired: true;
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
  endpoints?: {
    thumbnailImages?: typeof THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH;
  };
};

export type ThumbnailLocalBridgeAuthStatusResponse = {
  ok: boolean;
  bridge: 'tzudong-storyboard-local-bridge';
  status: 'ready' | 'auth_required' | 'unpaired';
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
  detail?: string;
};

export type ThumbnailLocalBridgeReferenceImage = {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  role: ThumbnailReferenceRole;
  dataBase64: string;
};

export type ThumbnailLocalBridgeImagesRequest = {
  payload: ThumbnailGeneratorPayload;
  referenceImages: ThumbnailLocalBridgeReferenceImage[];
};

export type ThumbnailLocalBridgeImagesResponse = {
  ok: true;
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
  result: ThumbnailGenerationResult;
};

export class ThumbnailLocalBridgeContractError extends LocalBridgeContractError {
  constructor(
    code: LocalBridgeContractErrorCode,
    message: string,
  ) {
    super(code, message, 'ThumbnailLocalBridgeContractError');
  }
}

const thumbnailLocalBridgeError = (code: LocalBridgeContractErrorCode, message: string) => (
  new ThumbnailLocalBridgeContractError(code, message)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function normalizeThumbnailLocalBridgeUrl(value: unknown) {
  return normalizeLocalBridgeUrl(value, thumbnailLocalBridgeError);
}

export function normalizeThumbnailLocalBridgeToken(value: unknown) {
  return normalizeLocalBridgeToken(value);
}

export function requireThumbnailLocalBridgeToken(value: unknown) {
  return requireLocalBridgeToken(value, thumbnailLocalBridgeError);
}

export function getThumbnailLocalBridgeAuthHeaders(token: string) {
  return getLocalBridgeAuthHeaders(token, {
    'X-Tzudong-Local-Bridge': 'youtube-thumbnail',
  });
}

export function redactThumbnailLocalBridgeSecretText(value: string, token?: string | null) {
  return redactLocalBridgeSecretText(value, token);
}

export function buildThumbnailLocalBridgeImagesRequest(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailLocalBridgeReferenceImage[],
): ThumbnailLocalBridgeImagesRequest {
  if (!payload || payload.providerId !== LOCAL_BRIDGE_PROVIDER_ID) {
    throw new ThumbnailLocalBridgeContractError(
      'invalid_bridge_payload',
      '로컬 브릿지는 local-codex gpt-image-2 요청만 허용합니다.',
    );
  }
  if (!Array.isArray(referenceImages)) {
    throw new ThumbnailLocalBridgeContractError(
      'invalid_bridge_payload',
      '로컬 브릿지 참고 이미지 payload가 올바르지 않습니다.',
    );
  }
  for (const image of referenceImages) {
    if (
      !image ||
      typeof image.name !== 'string' ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime) ||
      !['host', 'food', 'object', 'person', 'other'].includes(image.role) ||
      typeof image.dataBase64 !== 'string' ||
      image.dataBase64.length === 0
    ) {
      throw new ThumbnailLocalBridgeContractError(
        'invalid_bridge_payload',
        '로컬 브릿지 참고 이미지 항목이 올바르지 않습니다.',
      );
    }
  }
  return {
    payload: {
      ...payload,
      providerId: LOCAL_BRIDGE_PROVIDER_ID,
      generationMode: 'direct_provider',
    },
    referenceImages,
  };
}

export function normalizeThumbnailLocalBridgeImagesResponse(
  value: unknown,
): ThumbnailLocalBridgeImagesResponse {
  if (!isRecord(value)) {
    throw new ThumbnailLocalBridgeContractError(
      'untrusted_bridge_response',
      '로컬 브릿지가 JSON 객체를 반환하지 않았습니다.',
    );
  }
  const payload = value as Partial<ThumbnailLocalBridgeImagesResponse>;
  const result = isRecord(payload.result) ? payload.result as ThumbnailGenerationResult : null;
  const baseImage = result && isRecord(result.baseImage) ? result.baseImage : null;
  const hasExactLocalBridgeProvenance = Boolean(
    baseImage &&
    hasExactLocalBridgeImageGenerationProvenance(baseImage) &&
    baseImage.modelProvenance === 'exact'
  );
  if (
    payload.ok !== true ||
    payload.providerId !== LOCAL_BRIDGE_PROVIDER_ID ||
    payload.model !== LOCAL_BRIDGE_MODEL ||
    !result ||
    !baseImage ||
    typeof baseImage.dataUrl !== 'string' ||
    !baseImage.dataUrl.startsWith('data:image/') ||
    !hasExactLocalBridgeProvenance ||
    typeof result.prompt !== 'string' ||
    !Array.isArray(result.warnings)
  ) {
    throw new ThumbnailLocalBridgeContractError(
      'untrusted_bridge_response',
      '로컬 브릿지 응답의 provider/model provenance가 썸네일 신뢰 정책과 맞지 않습니다.',
    );
  }
  return {
    ok: true,
    providerId: LOCAL_BRIDGE_PROVIDER_ID,
    model: LOCAL_BRIDGE_MODEL,
    result,
  };
}
