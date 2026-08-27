export const LOCAL_BRIDGE_ROUTE_ID = 'local-bridge' as const;
export const LOCAL_BRIDGE_DEFAULT_URL = 'http://127.0.0.1:17873' as const;
export const LOCAL_BRIDGE_TOKEN_HEADER = 'Authorization' as const;
export const LOCAL_BRIDGE_PROVIDER_ID = 'local-codex' as const;
export const LOCAL_BRIDGE_MODEL = 'gpt-image-2' as const;
export const LOCAL_BRIDGE_MODEL_PROVENANCE = 'exact' as const;
export const LOCAL_BRIDGE_HELPER_ROUTE = '/helper' as const;
export const LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM = 'origin' as const;
export const LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM = 'session' as const;
export const LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM = 'surface' as const;
export const LOCAL_BRIDGE_HELPER_MESSAGE_VERSION = 1 as const;
export const LOCAL_BRIDGE_HELPER_SURFACES = ['storyboard', 'thumbnail'] as const;
export const LOCAL_BRIDGE_HELPER_COMMANDS = [
  'checkStatus',
  'generateThumbnail',
  'generateStoryboard',
] as const;
export const LOCAL_BRIDGE_ALLOWED_ORIGINS = [
  'https://www.tzudong.app',
  'https://tzudong.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
] as const;

export type LocalBridgeRouteId = typeof LOCAL_BRIDGE_ROUTE_ID;
export type LocalBridgeProviderId = typeof LOCAL_BRIDGE_PROVIDER_ID;
export type LocalBridgeModel = typeof LOCAL_BRIDGE_MODEL;
export type LocalBridgeModelProvenance = typeof LOCAL_BRIDGE_MODEL_PROVENANCE;
export type LocalBridgeHelperRoute = typeof LOCAL_BRIDGE_HELPER_ROUTE;
export type LocalBridgeHelperMessageVersion = typeof LOCAL_BRIDGE_HELPER_MESSAGE_VERSION;
export type LocalBridgeHelperOriginQueryParam = typeof LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM;
export type LocalBridgeHelperSessionQueryParam = typeof LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM;
export type LocalBridgeHelperSurfaceQueryParam = typeof LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM;
export type LocalBridgeHelperSurface = typeof LOCAL_BRIDGE_HELPER_SURFACES[number];
export type LocalBridgeHelperCommand = typeof LOCAL_BRIDGE_HELPER_COMMANDS[number];
export type LocalBridgeStatus =
  | 'checking'
  | 'connected'
  | 'needs_reconnect'
  | 'unavailable'
  | 'auth_required'
  | 'unpaired'
  | 'popup_blocked'
  | 'helper_failed'
  | 'blocked'
  | 'error';

export type LocalBridgeContractErrorCode =
  | 'invalid_bridge_url'
  | 'invalid_bridge_token'
  | 'invalid_bridge_payload'
  | 'untrusted_bridge_response';

export type LocalBridgeHelperCheckStatusPayload = {
  healthOk: boolean;
  health: unknown;
  authOk: boolean;
  auth: unknown;
};

export type LocalBridgeHelperBridgePayload = unknown;

export type LocalBridgeHelperRequestMessage = {
  kind: 'tzudong-local-bridge-helper-request';
  sessionId: string;
  requestId: string;
  command: LocalBridgeHelperCommand;
  bridgeUrl: string;
  token: string;
  payload?: unknown;
};

export type LocalBridgeHelperErrorCode =
  | 'invalid_message'
  | 'origin_mismatch'
  | 'request_failed';

export type LocalBridgeHelperResponseMessage =
  | {
    kind: 'tzudong-local-bridge-helper-response';
    sessionId: string;
    requestId: string;
    ok: true;
    payload: LocalBridgeHelperCheckStatusPayload | LocalBridgeHelperBridgePayload;
  }
  | {
    kind: 'tzudong-local-bridge-helper-response';
    sessionId: string;
    requestId: string;
    ok: false;
    errorCode: LocalBridgeHelperErrorCode;
    message: string;
  };

export class LocalBridgeContractError extends Error {
  readonly code: LocalBridgeContractErrorCode;

  constructor(
    code: LocalBridgeContractErrorCode,
    message: string,
    name = 'LocalBridgeContractError',
  ) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

export type LocalBridgeContractErrorFactory = (
  code: LocalBridgeContractErrorCode,
  message: string,
) => LocalBridgeContractError;

const defaultErrorFactory: LocalBridgeContractErrorFactory = (code, message) => (
  new LocalBridgeContractError(code, message)
);

function failLocalBridgeContract(
  createError: LocalBridgeContractErrorFactory,
  code: LocalBridgeContractErrorCode,
  message: string,
): never {
  throw createError(code, message);
}

export function normalizeLocalBridgeUrl(
  value: unknown,
  createError: LocalBridgeContractErrorFactory = defaultErrorFactory,
) {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : LOCAL_BRIDGE_DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    failLocalBridgeContract(
      createError,
      'invalid_bridge_url',
      '로컬 브릿지 주소는 http://127.0.0.1:포트 형식이어야 합니다.',
    );
  }
  const isAllowedHost =
    url.protocol === 'http:' &&
    (
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1'
    );
  if (!isAllowedHost) {
    failLocalBridgeContract(
      createError,
      'invalid_bridge_url',
      '로컬 브릿지는 http://127.0.0.1 또는 localhost 주소만 사용할 수 있습니다.',
    );
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function normalizeLocalBridgeToken(value: unknown) {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (token.length < 16 || token.length > 512) return null;
  if (/\s/.test(token)) return null;
  return token;
}

export function requireLocalBridgeToken(
  value: unknown,
  createError: LocalBridgeContractErrorFactory = defaultErrorFactory,
) {
  const token = normalizeLocalBridgeToken(value);
  if (!token) {
    failLocalBridgeContract(
      createError,
      'invalid_bridge_token',
      '로컬 브릿지 pairing token을 입력해 주세요.',
    );
  }
  return token;
}

export function getLocalBridgeAuthHeaders(
  token: string,
  extraHeaders: Record<string, string> = {},
) {
  return {
    [LOCAL_BRIDGE_TOKEN_HEADER]: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extraHeaders,
  } as const;
}

export function redactLocalBridgeSecretText(value: string, token?: string | null) {
  let redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted_bridge_token]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted_api_key]')
    .replace(/auth\.json/gi, '[redacted_auth_file]');
  if (token) {
    redacted = redacted.split(token).join('[redacted_bridge_token]');
  }
  return redacted.slice(0, 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function hasExactLocalBridgeImageGenerationProvenance(value: unknown) {
  return Boolean(
    isRecord(value) &&
    value.providerId === LOCAL_BRIDGE_PROVIDER_ID &&
    value.model === LOCAL_BRIDGE_MODEL &&
    value.modelProvenance === LOCAL_BRIDGE_MODEL_PROVENANCE,
  );
}
