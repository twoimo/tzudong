import {
  LOCAL_BRIDGE_ALLOWED_ORIGINS,
  LOCAL_BRIDGE_DEFAULT_URL,
  LOCAL_BRIDGE_MODEL,
  LOCAL_BRIDGE_PROVIDER_ID,
  LOCAL_BRIDGE_ROUTE_ID,
  LOCAL_BRIDGE_TOKEN_HEADER,
  LocalBridgeContractError,
  getLocalBridgeAuthHeaders,
  normalizeLocalBridgeToken,
  normalizeLocalBridgeUrl,
  redactLocalBridgeSecretText,
  requireLocalBridgeToken,
  type LocalBridgeContractErrorCode,
  type LocalBridgeStatus,
} from '../local-bridge/core-contract';
import {
  getTrustedStoryboardGeneratedImage,
} from './image-trust';
import type {
  StoryboardGenerateRequest,
  StoryboardGenerationResult,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
} from './types';

export const STORYBOARD_LOCAL_BRIDGE_ROUTE_ID = LOCAL_BRIDGE_ROUTE_ID;
export const STORYBOARD_LOCAL_BRIDGE_DEFAULT_URL = LOCAL_BRIDGE_DEFAULT_URL;
export const STORYBOARD_LOCAL_BRIDGE_MAX_SCENES = 4 as const;
export const STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES = 512 * 1024;
export const STORYBOARD_LOCAL_BRIDGE_TOKEN_HEADER = LOCAL_BRIDGE_TOKEN_HEADER;
export const STORYBOARD_LOCAL_BRIDGE_ALLOWED_ORIGINS = LOCAL_BRIDGE_ALLOWED_ORIGINS;

export type StoryboardLocalBridgeRouteId = typeof STORYBOARD_LOCAL_BRIDGE_ROUTE_ID;
export type StoryboardLocalBridgeStatus = LocalBridgeStatus;

export type StoryboardLocalBridgeHealthResponse = {
  ok: boolean;
  bridge: 'tzudong-storyboard-local-bridge';
  version: 1;
  status: 'ok';
  tokenRequired: true;
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
};

export type StoryboardLocalBridgeAuthStatusResponse = {
  ok: boolean;
  bridge: 'tzudong-storyboard-local-bridge';
  status: 'ready' | 'auth_required' | 'unpaired';
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
  detail?: string;
};

export type StoryboardLocalBridgeImagesRequest = {
  title: string;
  logline: string;
  request: StoryboardGenerateRequest;
  scenes: StoryboardScene[];
  sourceResult?: StoryboardGenerationResult | null;
};

export type StoryboardLocalBridgeImagesResponse = {
  ok: true;
  providerId: typeof LOCAL_BRIDGE_PROVIDER_ID;
  model: typeof LOCAL_BRIDGE_MODEL;
  images: Array<{
    sceneNo: number;
    image: StoryboardSceneGeneratedImage;
  }>;
};

export class StoryboardLocalBridgeContractError extends LocalBridgeContractError {
  constructor(
    code: LocalBridgeContractErrorCode,
    message: string,
  ) {
    super(code, message, 'StoryboardLocalBridgeContractError');
  }
}

const storyboardLocalBridgeError = (code: LocalBridgeContractErrorCode, message: string) => (
  new StoryboardLocalBridgeContractError(code, message)
);

export function normalizeStoryboardLocalBridgeUrl(value: unknown) {
  return normalizeLocalBridgeUrl(value, storyboardLocalBridgeError);
}

export function normalizeStoryboardLocalBridgeToken(value: unknown) {
  return normalizeLocalBridgeToken(value);
}

export function requireStoryboardLocalBridgeToken(value: unknown) {
  return requireLocalBridgeToken(value, storyboardLocalBridgeError);
}

export function getStoryboardLocalBridgeAuthHeaders(token: string) {
  return getLocalBridgeAuthHeaders(token);
}

export function redactStoryboardLocalBridgeSecretText(value: string, token?: string | null) {
  return redactLocalBridgeSecretText(value, token);
}

export function buildStoryboardLocalBridgeImagesRequest(
  result: StoryboardGenerationResult,
  scenes: StoryboardGenerationResult['storyboard']['scenes'],
): StoryboardLocalBridgeImagesRequest {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new StoryboardLocalBridgeContractError(
      'invalid_bridge_payload',
      '로컬 브릿지로 보낼 CUT이 없습니다.',
    );
  }
  if (scenes.length > STORYBOARD_LOCAL_BRIDGE_MAX_SCENES) {
    throw new StoryboardLocalBridgeContractError(
      'invalid_bridge_payload',
      `로컬 브릿지는 한 번에 최대 ${STORYBOARD_LOCAL_BRIDGE_MAX_SCENES}컷까지만 처리합니다.`,
    );
  }
  return {
    title: result.storyboard.title,
    logline: result.storyboard.logline,
    request: result.request,
    scenes,
    sourceResult: result,
  };
}

export function normalizeStoryboardLocalBridgeImagesResponse(
  value: unknown,
): StoryboardLocalBridgeImagesResponse {
  if (!value || typeof value !== 'object') {
    throw new StoryboardLocalBridgeContractError(
      'untrusted_bridge_response',
      '로컬 브릿지가 JSON 객체를 반환하지 않았습니다.',
    );
  }
  const payload = value as Partial<StoryboardLocalBridgeImagesResponse>;
  if (
    payload.ok !== true ||
    payload.providerId !== LOCAL_BRIDGE_PROVIDER_ID ||
    payload.model !== LOCAL_BRIDGE_MODEL ||
    !Array.isArray(payload.images)
  ) {
    throw new StoryboardLocalBridgeContractError(
      'untrusted_bridge_response',
      '로컬 브릿지 응답의 provider/model 형식이 신뢰 정책과 맞지 않습니다.',
    );
  }
  const images = payload.images.map((entry) => {
    const trustedImage = getTrustedStoryboardGeneratedImage(entry?.image);
    if (!entry || typeof entry.sceneNo !== 'number' || !trustedImage) {
      throw new StoryboardLocalBridgeContractError(
        'untrusted_bridge_response',
        '로컬 브릿지 이미지 provenance를 신뢰할 수 없습니다.',
      );
    }
    return {
      sceneNo: entry.sceneNo,
      image: trustedImage,
    };
  });
  return {
    ok: true,
    providerId: LOCAL_BRIDGE_PROVIDER_ID,
    model: LOCAL_BRIDGE_MODEL,
    images,
  };
}
