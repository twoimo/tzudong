import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { constants, existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LOCAL_BRIDGE_ALLOWED_ORIGINS,
  LOCAL_BRIDGE_HELPER_COMMANDS,
  LOCAL_BRIDGE_HELPER_MESSAGE_VERSION,
  LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM,
  LOCAL_BRIDGE_HELPER_ROUTE,
  LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM,
  LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM,
  LOCAL_BRIDGE_MODEL,
  LOCAL_BRIDGE_MODEL_PROVENANCE,
  LOCAL_BRIDGE_PROVIDER_ID,
  redactLocalBridgeSecretText,
} from '../local-bridge/core-contract.ts';
import { getAdminSafeErrorName } from '../guarded-mutation-contract.ts';
import type {
  LocalBridgeHelperSurface,
} from '../local-bridge/core-contract.ts';
import {
  STORYBOARD_IMAGE_GENERATION_BATCH_SIZE,
  type StoryboardGeneratedImageProvenance,
  type StoryboardGenerateRequest,
  type StoryboardScene,
  type StoryboardSceneGeneratedImage,
} from './types.ts';
import type {
  ThumbnailGenerationResult,
  ThumbnailGeneratorPayload,
  ThumbnailReferenceImage,
  ThumbnailReferenceRole,
} from '../youtube-thumbnail-generator/types.ts';

const DEFAULT_PORT = 17873;
const LOCAL_CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses' as const;
const DEFAULT_LOCAL_CODEX_SCRIPT = 'scripts/codex-imagegen-storyboard-provider.py' as const;
const DEFAULT_LOCAL_CODEX_THUMBNAIL_SCRIPT = 'scripts/codex-imagegen-thumbnail-provider.py' as const;
const DEFAULT_SIZE = '1536x864' as const;
const STORYBOARD_LOCAL_BRIDGE_MAX_SCENES = STORYBOARD_IMAGE_GENERATION_BATCH_SIZE;
const STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES = 512 * 1024;
const THUMBNAIL_LOCAL_BRIDGE_MAX_BODY_BYTES = 64 * 1024 * 1024;
const STORYBOARD_LOCAL_BRIDGE_ALLOWED_ORIGINS = LOCAL_BRIDGE_ALLOWED_ORIGINS;
const STORYBOARD_GENERATED_IMAGE_TRUST_POLICY = 'storyboard-gpt-image-2-panel-v1' as const;
const STORYBOARD_IMAGE_PROVIDER_ID = LOCAL_BRIDGE_PROVIDER_ID;
const STORYBOARD_IMAGE_PROVIDER_MODEL = LOCAL_BRIDGE_MODEL;
const STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE = LOCAL_BRIDGE_MODEL_PROVENANCE;
const THUMBNAIL_TARGET_WIDTH = 1280 as const;
const THUMBNAIL_TARGET_HEIGHT = 720 as const;
const LOCAL_BRIDGE_AUTH_STATUS_PATH = '/auth-status' as const;
const STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH = '/v1/storyboard/images' as const;
const THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH = '/v1/youtube-thumbnail/images' as const;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const THUMBNAIL_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const LOCAL_BRIDGE_PROCESS_TERMINATION_GRACE_MS = 250;
const LOCAL_BRIDGE_PROVIDER_ENVIRONMENT_KEYS = [
  'CODEX_HOME',
  'CODEX_IMAGEGEN_AGENT_EFFORT',
  'CODEX_IMAGEGEN_AGENT_MODEL',
  'CODEX_IMAGEGEN_CODEX_BIN',
  'CODEX_IMAGEGEN_TIMEOUT_SECONDS',
  'ComSpec',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PATH',
  'PATHEXT',
  'Path',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'path',
] as const;
const MAX_IMAGE_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
const MAX_IMAGE_FRAMES = 1;
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RUN_BYTES = 48 * 1024 * 1024;
const LOCAL_BRIDGE_SESSION_TTL_MS = 5 * 60 * 1000;
const LOCAL_BRIDGE_MAX_ACTIVE_SESSIONS = 32;
const LOCAL_BRIDGE_MAX_USED_NONCES = 128;
const LOCAL_BRIDGE_GLOBAL_GENERATION_CONCURRENCY = 2;
const LOCAL_BRIDGE_GLOBAL_GENERATION_QUEUE_LIMIT = 8;
const STORYBOARD_LOCAL_BRIDGE_DEFAULT_CONCURRENCY = 4;

const STORYBOARD_LOCAL_BRIDGE_MIN_SCENE_NO = 1;
const STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_NO = STORYBOARD_LOCAL_BRIDGE_MAX_SCENES;
const STORYBOARD_LOCAL_BRIDGE_MAX_TITLE_LENGTH = 140;
const STORYBOARD_LOCAL_BRIDGE_MAX_LOGLINE_LENGTH = 240;
const STORYBOARD_LOCAL_BRIDGE_MAX_REQUEST_PROMPT_LENGTH = 400;
const STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TITLE_LENGTH = 512;
const STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH = 2048;
const STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_VIDEO_ID_LENGTH = 256;
const STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_URL_LENGTH = 2048;
const STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_TIME_LENGTH = 128;
const STORYBOARD_LOCAL_BRIDGE_MAX_PRODUCTION_CHECKLIST_ITEMS = 12;
const STORYBOARD_LOCAL_BRIDGE_MAX_PRODUCTION_CHECKLIST_ITEM_LENGTH = 512;
type BridgeErrorCode =
  | 'not_found'
  | 'origin_forbidden'
  | 'unpaired'
  | 'invalid_content_type'
  | 'invalid_payload'
  | 'provider_execution_failed'
  | 'auth_required'
  | 'method_not_allowed'
  | 'session_invalid';

class LocalBridgeHttpError extends Error {
  readonly code: BridgeErrorCode;
  readonly status: number;

  constructor(
    code: BridgeErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = 'LocalBridgeHttpError';
    this.code = code;
    this.status = status;
  }
}

type ProviderResult = {
  ok?: boolean;
  providerId?: string;
  authMode?: string;
  endpoint?: string;
  agentModel?: string;
  requestToolType?: string;
  requestToolModel?: string;
  model?: string;
  modelProvenance?: string;
  responseId?: string;
  imageCallId?: string;
  imageItemCount?: number;
  generatedImageItemTypes?: string[];
  rawImageItemTypes?: string[];
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  outputPath?: string;
  transientOutputPath?: string;
  durableOutputPath?: string;
  rawResponsePath?: string;
  requestHash?: string;
  responseHash?: string;
  hasOpenAIAPIKey?: boolean;
  outputHash?: string;
  generatedAt?: string;
  error?: string;
};

type StoryboardLocalBridgeImagesRequest = {
  title: string;
  logline: string;
  request: StoryboardGenerateRequest;
  scenes: StoryboardScene[];
  sourceResult?: unknown;
};

type StoryboardLocalBridgeImagesResponse = {
  ok: true;
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID;
  model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  images: Array<{
    sceneNo: number;
    image: StoryboardSceneGeneratedImage;
  }>;
};

type ThumbnailLocalBridgeReferenceImage = {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  role: ThumbnailReferenceRole;
  dataBase64: string;
};
type ValidatedThumbnailLocalBridgeReferenceImage = Omit<ThumbnailLocalBridgeReferenceImage, 'dataBase64'> & {
  bytes: Buffer;
};

type ThumbnailLocalBridgeImagesRequest = {
  payload: ThumbnailGeneratorPayload;
  referenceImages: ValidatedThumbnailLocalBridgeReferenceImage[];
};

type ThumbnailLocalBridgeImagesResponse = {
  ok: true;
  providerId: typeof STORYBOARD_IMAGE_PROVIDER_ID;
  model: typeof STORYBOARD_IMAGE_PROVIDER_MODEL;
  result: ThumbnailGenerationResult;
};

export type StoryboardLocalBridgeServerOptions = {
  host?: string;
  port?: number;
  token?: string;
  allowedOrigins?: string[];
  providerCommand?: string;
  providerArgs?: string[];
  thumbnailProviderCommand?: string;
  thumbnailProviderArgs?: string[];
  outputDir?: string;
  authFile?: string;
  fakeAuthReady?: boolean;
  commandTimeoutMs?: number;
  log?: (message: string) => void;
};

function redactStoryboardLocalBridgeSecretText(value: string, token?: string | null) {
  return redactLocalBridgeSecretText(value, token);
}

function compactText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}
function isOptionalBoundedImageDimension(value: unknown): value is number | undefined {
  return value === undefined || (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_IMAGE_DIMENSION
  );
}


function buildLocalBridgeScenePrompt(scene: StoryboardScene, context: { title: string; logline: string; request: StoryboardGenerateRequest }) {
  return [
    'Create exactly one full-bleed 16:9 single-scene storyboard cut image for a Korean food-travel / mukbang planning board.',
    'The entire image must be one coherent scene; never draw storyboard sheets, comic pages, split screens, internal borders, captions, subtitles, labels, readable text, watermarks, or UI chrome.',
    'Style: cinematic hand-drawn food-storyboard keyframe, clean black pencil lines, subtle warm food-color accents, strong single focal point.',
    'Safety: do not recreate a real person likeness; no recognizable face and no detailed eyes, nose, or mouth. Human presence may appear only through cropped hands, chopsticks, over-shoulder silhouette, or back-of-head silhouette.',
    `Storyboard title: ${compactText(context.title, 120)}`,
    `Overall logline: ${compactText(context.logline, 180)}`,
    `User brief: ${compactText(context.request.prompt, 220)}`,
    `CUT ${scene.sceneNo}: ${compactText(scene.title, 80)}`,
    `Visual direction: ${compactText(scene.visualDirection, 260)}`,
    `Operator intent: ${compactText(scene.operatorIntent, 180)}`,
    `Caption idea for mood only, do not render readable text: ${compactText(scene.captionIdea, 120)}`,
    `Heatmap evidence mood: ${scene.heatmapEvidence?.peakTime ?? 'unknown'}, replay score ${scene.heatmapEvidence?.replayScore ?? 0}.`,
    'Output only the image. Fill the whole frame with one coherent CUT.',
  ].join('\n');
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function generatedToken() {
  return randomBytes(24).toString('base64url');
}
let activeLocalBridgeGenerations = 0;
const queuedLocalBridgeGenerations: Array<() => void> = [];

async function withLocalBridgeGenerationSlot<T>(signal: AbortSignal | undefined, work: () => Promise<T>) {
  if (signal?.aborted) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Provider request was aborted.', 499);
  }
  if (activeLocalBridgeGenerations >= LOCAL_BRIDGE_GLOBAL_GENERATION_CONCURRENCY) {
    if (queuedLocalBridgeGenerations.length >= LOCAL_BRIDGE_GLOBAL_GENERATION_QUEUE_LIMIT) {
      throw new LocalBridgeHttpError('provider_execution_failed', 'Provider queue is full.', 429);
    }
    await new Promise<void>((resolveWaiter, rejectWaiter) => {
      let settled = false;
      const waiter = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abortWaiter);
        activeLocalBridgeGenerations += 1;
        resolveWaiter();
      };
      const abortWaiter = () => {
        if (settled) return;
        settled = true;
        const index = queuedLocalBridgeGenerations.indexOf(waiter);
        if (index >= 0) queuedLocalBridgeGenerations.splice(index, 1);
        rejectWaiter(new LocalBridgeHttpError('provider_execution_failed', 'Provider request was aborted.', 499));
      };
      queuedLocalBridgeGenerations.push(waiter);
      signal?.addEventListener('abort', abortWaiter, { once: true });
    });
  } else {
    activeLocalBridgeGenerations += 1;
  }
  try {
    return await work();
  } finally {
    activeLocalBridgeGenerations -= 1;
    queuedLocalBridgeGenerations.shift()?.();
  }
}

function tokenMatches(expected: string, candidate: string) {
  const expectedHash = Buffer.from(sha256(expected), 'hex');
  const candidateHash = Buffer.from(sha256(candidate), 'hex');
  return expectedHash.length === candidateHash.length && timingSafeEqual(expectedHash, candidateHash);
}

function parseAllowedOrigins(value?: string, fallback?: string[]) {
  const raw = value?.trim()
    ? value.split(',').map((origin) => origin.trim()).filter(Boolean)
    : fallback;
  return new Set(raw?.length ? raw : [...STORYBOARD_LOCAL_BRIDGE_ALLOWED_ORIGINS]);
}

function getRequestOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  return typeof origin === 'string' ? origin : null;
}

function isLoopbackHost(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function parseBoundLoopbackOrigin(value: string, expectedPort: number) {
  if (
    value.length === 0 ||
    value.length > 200 ||
    /[/?#@\\\s]/.test(value)
  ) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Local bridge host is invalid.', 403);
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new LocalBridgeHttpError('origin_forbidden', 'Local bridge host is invalid.', 403);
  }
  const port = Number(parsed.port || '80');
  if (
    parsed.protocol !== 'http:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.host !== value ||
    !isLoopbackHost(parsed.hostname) ||
    !Number.isSafeInteger(port) ||
    port !== expectedPort
  ) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Local bridge host is invalid.', 403);
  }
  return parsed.origin;
}

function getBoundLoopbackOrigin(request: IncomingMessage) {
  const port = request.socket.localPort;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Local bridge is not bound to TCP.', 403);
  }
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== 'string') {
    throw new LocalBridgeHttpError('origin_forbidden', 'Local bridge host is missing.', 403);
  }
  return parseBoundLoopbackOrigin(hostHeader.trim(), port);
}

function parseBridgeRequestUrl(request: IncomingMessage) {
  const rawPath = request.url || '';
  if (
    rawPath.length === 0 ||
    rawPath.length > 2048 ||
    !rawPath.startsWith('/') ||
    rawPath.startsWith('//') ||
    rawPath.includes('#')
  ) {
    throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
  }
  try {
    return new URL(rawPath, 'http://127.0.0.1');
  } catch {
    throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
  }
}

function requestOriginCandidates(bridgeOrigin: string) {
  const port = new URL(bridgeOrigin).port || '80';
  const suffix = port === '80' ? '' : `:${port}`;
  return new Set([
    `http://127.0.0.1${suffix}`,
    `http://localhost${suffix}`,
    `http://[::1]${suffix}`,
  ]);
}

function applyCors(response: ServerResponse, origin: string, request: IncomingMessage) {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-Tzudong-Local-Bridge-Session, X-Tzudong-Local-Bridge-Binding, X-Tzudong-Local-Bridge-Nonce',
  );
  response.setHeader('Access-Control-Max-Age', '600');
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function isAllowedOrigin(origin: string, bridgeOrigin: string, allowedOrigins: Set<string>) {
  return allowedOrigins.has(origin) || requestOriginCandidates(bridgeOrigin).has(origin);
}

function assertAllowedOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  bridgeOrigin: string,
  allowedOrigins: Set<string>,
) {
  const origin = getRequestOrigin(request);
  if (!origin || !isAllowedOrigin(origin, bridgeOrigin, allowedOrigins)) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Origin is not allowed for this local bridge.', 403);
  }
  applyCors(response, origin, request);
  return origin;
}

function bearerToken(request: IncomingMessage) {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function assertPaired(request: IncomingMessage, expectedToken: string) {
  const token = bearerToken(request);
  if (!token || token.length > 512 || !tokenMatches(expectedToken, token)) {
    throw new LocalBridgeHttpError('unpaired', 'Pairing token is missing or invalid.', token ? 403 : 401);
  }
}

function respondJson(response: ServerResponse, status: number, payload: unknown, origin?: string, request?: IncomingMessage) {
  if (origin && request) applyCors(response, origin, request);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(`${JSON.stringify(payload)}\n`);
}

function respondHtml(response: ServerResponse, status: number, html: string) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.end(html);
}

type LocalBridgeHelperRouteContext = {
  openerOrigin: string;
  sessionId: string;
  surface: LocalBridgeHelperSurface;
  bridgeOrigin: string;
  sessionBinding: string;
};

type LocalBridgeSession = {
  bridgeOrigin: string;
  expiresAt: number;
  binding: string;
  requestNonces: Set<string>;
  surface: LocalBridgeHelperSurface;
};

function pruneExpiredLocalBridgeSessions(sessions: Map<string, LocalBridgeSession>, now = Date.now()) {
  for (const [sessionId, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(sessionId);
  }
}
function requireLocalBridgeHelperSurface(value: string | null): LocalBridgeHelperSurface {
  if (value === 'storyboard' || value === 'thumbnail') return value;
  throw new LocalBridgeHttpError('invalid_payload', 'Helper surface query is invalid.', 400);
}


function createLocalBridgeHelperSession(
  url: URL,
  bridgeOrigin: string,
  allowedOrigins: Set<string>,
  sessions: Map<string, LocalBridgeSession>,
): LocalBridgeHelperRouteContext {
  const expectedQueryKeys: ReadonlySet<string> = new Set<string>([
    LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM,
    LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM,
    LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM,
  ]);
  const queryKeys = [...url.searchParams.keys()];
  if (
    queryKeys.length !== expectedQueryKeys.size ||
    queryKeys.some((key) => !expectedQueryKeys.has(key)) ||
    [...expectedQueryKeys].some((key) => url.searchParams.getAll(key).length !== 1)
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Helper query is invalid.', 400);
  }
  const openerOrigin = url.searchParams.get(LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM)?.trim() ?? '';
  if (!openerOrigin || !allowedOrigins.has(openerOrigin)) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Helper opener origin is not allowed.', 403);
  }
  const sessionId = url.searchParams.get(LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM)?.trim() ?? '';
  if (!sessionId || !/^[A-Za-z0-9._-]{1,120}$/.test(sessionId)) {
    throw new LocalBridgeHttpError('invalid_payload', 'Helper session query is invalid.', 400);
  }
  const surface = requireLocalBridgeHelperSurface(
    url.searchParams.get(LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM),
  );

  pruneExpiredLocalBridgeSessions(sessions);
  if (sessions.has(sessionId) || sessions.size >= LOCAL_BRIDGE_MAX_ACTIVE_SESSIONS) {
    throw new LocalBridgeHttpError('session_invalid', 'Helper session is unavailable.', 403);
  }
  const sessionBinding = generatedToken();
  sessions.set(sessionId, {
    binding: sessionBinding,
    bridgeOrigin,
    expiresAt: Date.now() + LOCAL_BRIDGE_SESSION_TTL_MS,
    requestNonces: new Set(),
    surface,
  });
  return {
    openerOrigin,
    sessionId,
    surface,
    bridgeOrigin,
    sessionBinding,
  };
}

function assertLocalBridgeHelperSession(
  request: IncomingMessage,
  bridgeOrigin: string,
  path: string,
  sessions: Map<string, LocalBridgeSession>,
) {
  const sessionId = request.headers['x-tzudong-local-bridge-session'];
  const sessionBinding = request.headers['x-tzudong-local-bridge-binding'];
  const requestNonce = request.headers['x-tzudong-local-bridge-nonce'];
  if (
    typeof sessionId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(sessionId) ||
    typeof sessionBinding !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(sessionBinding) ||
    typeof requestNonce !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(requestNonce)
  ) {
    throw new LocalBridgeHttpError('session_invalid', 'Local bridge helper session is invalid.', 403);
  }
  pruneExpiredLocalBridgeSessions(sessions);
  const session = sessions.get(sessionId);
  const allowsPath = path === LOCAL_BRIDGE_AUTH_STATUS_PATH
    || (session?.surface === 'storyboard' && path === STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH)
    || (session?.surface === 'thumbnail' && path === THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH);
  if (
    !session ||
    session.bridgeOrigin !== bridgeOrigin ||
    !allowsPath ||
    !tokenMatches(session.binding, sessionBinding) ||
    session.requestNonces.has(requestNonce) ||
    session.requestNonces.size >= LOCAL_BRIDGE_MAX_USED_NONCES
  ) {
    throw new LocalBridgeHttpError('session_invalid', 'Local bridge helper session is invalid.', 403);
  }
  session.requestNonces.add(requestNonce);
}

function serializeInlineScriptValue(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildLocalBridgeHelperHtml(context: LocalBridgeHelperRouteContext) {
  const configJson = serializeInlineScriptValue(context);
  const commandListJson = serializeInlineScriptValue([...LOCAL_BRIDGE_HELPER_COMMANDS]);
  const responsePathsJson = serializeInlineScriptValue({
    health: '/health',
    authStatus: LOCAL_BRIDGE_AUTH_STATUS_PATH,
    storyboardImages: STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH,
    thumbnailImages: THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH,
  });
  const versionJson = serializeInlineScriptValue(LOCAL_BRIDGE_HELPER_MESSAGE_VERSION);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tzudong Local Bridge Helper</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; }
      main { max-width: 28rem; padding: 2rem; text-align: center; }
      p { margin: 0.5rem 0 0; color: #cbd5e1; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>Local bridge helper ready</h1>
      <p><code>${context.surface}</code> helper session <code>${context.sessionId}</code></p>
      <p>This window only proxies requests to the loopback bridge and returns results to the opener.</p>
    </main>
    <script>
      const HELPER_CONFIG = ${configJson};
      const HELPER_COMMANDS = ${commandListJson};
      const HELPER_PATHS = ${responsePathsJson};
      const HELPER_VERSION = ${versionJson};

      const channel = new MessageChannel();
      const port = channel.port1;

      function postToOpener(message, transfer) {
        if (!window.opener || window.opener.closed) return;
        window.opener.postMessage(message, HELPER_CONFIG.openerOrigin, transfer || []);
      }

      function postToPort(message) {
        port.postMessage(message);
      }

      function asRecord(value) {
        return value && typeof value === 'object' ? value : null;
      }

      function isExpectedBridgeTarget(value) {
        try {
          const url = new URL(value);
          return url.protocol === 'http:'
            && !url.username
            && !url.password
            && url.origin === HELPER_CONFIG.bridgeOrigin
            && url.pathname === '/'
            && !url.search
            && !url.hash;
        } catch {
          return false;
        }
      }

      function createRequestNonce() {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      }

      function parseMessagePayload(payload) {
        const record = asRecord(payload);
        if (!record) return null;
        if (record.kind !== 'tzudong-local-bridge-helper-request') return null;
        if (record.sessionId !== HELPER_CONFIG.sessionId) return null;
        if (typeof record.requestId !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(record.requestId)) return null;
        if (!HELPER_COMMANDS.includes(record.command)) return null;
        if (!isExpectedBridgeTarget(record.bridgeUrl)) return null;
        if (typeof record.token !== 'string' || record.token.length === 0 || record.token.length > 512) return null;
        if (
          (record.command === 'generateStoryboard' && HELPER_CONFIG.surface !== 'storyboard') ||
          (record.command === 'generateThumbnail' && HELPER_CONFIG.surface !== 'thumbnail')
        ) return null;
        return record;
      }

      function postError(requestId, code, message) {
        postToPort({
          kind: 'tzudong-local-bridge-helper-response',
          sessionId: HELPER_CONFIG.sessionId,
          requestId,
          ok: false,
          errorCode: code,
          message,
        });
      }

      async function readResponseBody(response) {
        const text = await response.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      async function fetchBridge(path, token, body, requiresSession) {
        const url = new URL(path, HELPER_CONFIG.bridgeOrigin);
        if (
          url.origin !== HELPER_CONFIG.bridgeOrigin ||
          url.pathname !== path ||
          url.search ||
          url.hash
        ) {
          throw new Error('Helper bridge target is invalid.');
        }
        const headers = { Accept: 'application/json' };
        if (requiresSession) {
          headers['X-Tzudong-Local-Bridge-Session'] = HELPER_CONFIG.sessionId;
          headers['X-Tzudong-Local-Bridge-Binding'] = HELPER_CONFIG.sessionBinding;
          headers['X-Tzudong-Local-Bridge-Nonce'] = createRequestNonce();
        }
        if (typeof token === 'string' && token) {
          headers.Authorization = 'Bearer ' + token;
        }
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }
        return fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      }

      async function handleStatusRequest(message) {
        try {
          const [healthResponse, authResponse] = await Promise.all([
            fetchBridge(HELPER_PATHS.health, undefined, undefined, false),
            fetchBridge(HELPER_PATHS.authStatus, message.token, undefined, true),
          ]);
          postToPort({
            kind: 'tzudong-local-bridge-helper-response',
            sessionId: HELPER_CONFIG.sessionId,
            requestId: message.requestId,
            ok: true,
            payload: {
              healthOk: healthResponse.ok,
              health: await readResponseBody(healthResponse),
              authOk: authResponse.ok,
              auth: await readResponseBody(authResponse),
            },
          });
        } catch (error) {
          postError(message.requestId, 'request_failed', error instanceof Error ? error.message : 'Helper status request failed.');
        }
      }

      async function handleGenerateRequest(message, path) {
        try {
          const bridgeResponse = await fetchBridge(path, message.token, message.payload, true);
          const body = await readResponseBody(bridgeResponse);
          if (!bridgeResponse.ok) {
            postError(
              message.requestId,
              String(body?.error || 'request_failed'),
              String(body?.detail || body?.error || 'Bridge request failed.'),
            );
            return;
          }
          postToPort({
            kind: 'tzudong-local-bridge-helper-response',
            sessionId: HELPER_CONFIG.sessionId,
            requestId: message.requestId,
            ok: true,
            payload: body,
          });
        } catch (error) {
          postError(message.requestId, 'request_failed', error instanceof Error ? error.message : 'Helper bridge request failed.');
        }
      }

      port.onmessage = (event) => {
        const message = parseMessagePayload(event.data);
        if (!message) return;
        if (message.command === 'checkStatus') {
          void handleStatusRequest(message);
          return;
        }
        if (message.command === 'generateStoryboard') {
          void handleGenerateRequest(message, HELPER_PATHS.storyboardImages);
          return;
        }
        if (message.command === 'generateThumbnail') {
          void handleGenerateRequest(message, HELPER_PATHS.thumbnailImages);
        }
      };
      port.start();
      window.addEventListener('beforeunload', () => {
        try {
          postToPort({ kind: 'tzudong-local-bridge-helper-closed', sessionId: HELPER_CONFIG.sessionId });
        } catch {}
      });
      postToOpener({
        kind: 'tzudong-local-bridge-helper-ready',
        sessionId: HELPER_CONFIG.sessionId,
        surface: HELPER_CONFIG.surface,
        protocolVersion: HELPER_VERSION,
      }, [channel.port2]);
    </script>
  </body>
</html>`;
}

async function readJsonBody(request: IncomingMessage, maxBytes = STORYBOARD_LOCAL_BRIDGE_MAX_BODY_BYTES) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) {
    throw new LocalBridgeHttpError('invalid_content_type', 'Content-Type must be application/json.', 415);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new LocalBridgeHttpError('invalid_payload', 'Request body is too large.', 413);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new LocalBridgeHttpError('invalid_payload', 'Request body must be valid JSON.', 400);
  }
}

type PlainRecord = Record<string, unknown>;

function invalidStoryboardLocalBridgePayload(): never {
  throw new LocalBridgeHttpError('invalid_payload', 'Invalid storyboard local bridge payload.', 400);
}

function assertPlainRecord(value: unknown): PlainRecord {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalidStoryboardLocalBridgePayload();
  }
  return value as PlainRecord;
}

function assertExactPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys = allowedKeys,
): PlainRecord {
  const record = assertPlainRecord(value);
  const ownKeys = Object.getOwnPropertyNames(record);
  if (
    ownKeys.some((key) => !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  return record;
}

function assertPlainArray(value: unknown, maxLength: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    value.length > maxLength
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  const ownKeys = Object.getOwnPropertyNames(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    return invalidStoryboardLocalBridgePayload();
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) return invalidStoryboardLocalBridgePayload();
    return descriptor.value;
  });
}

function assertBoundedString(record: PlainRecord, key: string, maxLength: number) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return invalidStoryboardLocalBridgePayload();
  }
  return value;
}

function assertSafeIntegerInRange(record: PlainRecord, key: string, min: number, max: number): number {
  const value = record[key];
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < min
    || value > max
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  return value;
}

function assertFiniteNumberInRange(record: PlainRecord, key: string, min: number, max: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return invalidStoryboardLocalBridgePayload();
  }
  return value;
}

function assertStoryboardGenerateRequest(value: unknown): StoryboardGenerateRequest {
  const request = assertExactPlainRecord(value, [
    'prompt',
    'tone',
    'targetLengthMinutes',
    'sourceLimit',
    'segmentCount',
    'includeProductionNotes',
    'generationMode',
  ]);
  const tone = assertBoundedString(request, 'tone', 32);
  const generationMode = assertBoundedString(request, 'generationMode', 32);
  const includeProductionNotes = request.includeProductionNotes;
  if (
    (tone !== 'warm' && tone !== 'energetic' && tone !== 'documentary' && tone !== 'comfort') ||
    (generationMode !== 'local_heatmap' && generationMode !== 'backend_agent') ||
    typeof includeProductionNotes !== 'boolean'
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  return {
    prompt: assertBoundedString(request, 'prompt', STORYBOARD_LOCAL_BRIDGE_MAX_REQUEST_PROMPT_LENGTH),
    tone,
    targetLengthMinutes: assertSafeIntegerInRange(request, 'targetLengthMinutes', 6, 60),
    sourceLimit: assertSafeIntegerInRange(request, 'sourceLimit', 10, 250),
    segmentCount: assertSafeIntegerInRange(
      request,
      'segmentCount',
      STORYBOARD_LOCAL_BRIDGE_MIN_SCENE_NO,
      STORYBOARD_LOCAL_BRIDGE_MAX_SCENES,
    ),
    includeProductionNotes,
    generationMode,
  };
}

function assertStoryboardScene(value: unknown): StoryboardScene {
  const scene = assertExactPlainRecord(value, [
    'sceneNo',
    'title',
    'durationSec',
    'operatorIntent',
    'visualDirection',
    'hostBeat',
    'captionIdea',
    'heatmapEvidence',
    'productionChecklist',
  ]);
  const heatmapEvidence = assertExactPlainRecord(scene.heatmapEvidence, [
    'videoId',
    'youtubeLink',
    'peakTime',
    'replayScore',
    'reason',
  ]);
  const productionChecklist = assertPlainArray(
    scene.productionChecklist,
    STORYBOARD_LOCAL_BRIDGE_MAX_PRODUCTION_CHECKLIST_ITEMS,
  ).map((item) => {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > STORYBOARD_LOCAL_BRIDGE_MAX_PRODUCTION_CHECKLIST_ITEM_LENGTH
    ) {
      return invalidStoryboardLocalBridgePayload();
    }
    return item;
  });
  return {
    sceneNo: assertSafeIntegerInRange(
      scene,
      'sceneNo',
      STORYBOARD_LOCAL_BRIDGE_MIN_SCENE_NO,
      STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_NO,
    ),
    title: assertBoundedString(scene, 'title', STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TITLE_LENGTH),
    durationSec: assertSafeIntegerInRange(scene, 'durationSec', 1, 60 * 60),
    operatorIntent: assertBoundedString(
      scene,
      'operatorIntent',
      STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH,
    ),
    visualDirection: assertBoundedString(
      scene,
      'visualDirection',
      STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH,
    ),
    hostBeat: assertBoundedString(scene, 'hostBeat', STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH),
    captionIdea: assertBoundedString(scene, 'captionIdea', STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH),
    heatmapEvidence: {
      videoId: assertBoundedString(
        heatmapEvidence,
        'videoId',
        STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_VIDEO_ID_LENGTH,
      ),
      youtubeLink: assertBoundedString(
        heatmapEvidence,
        'youtubeLink',
        STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_URL_LENGTH,
      ),
      peakTime: assertBoundedString(
        heatmapEvidence,
        'peakTime',
        STORYBOARD_LOCAL_BRIDGE_MAX_HEATMAP_TIME_LENGTH,
      ),
      replayScore: assertFiniteNumberInRange(heatmapEvidence, 'replayScore', 0, 1),
      reason: assertBoundedString(
        heatmapEvidence,
        'reason',
        STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_TEXT_LENGTH,
      ),
    },
    productionChecklist,
  };
}

function assertImagesPayload(value: unknown): StoryboardLocalBridgeImagesRequest {
  const payload = assertExactPlainRecord(
    value,
    ['title', 'logline', 'request', 'scenes', 'sourceResult'],
    ['title', 'logline', 'request', 'scenes'],
  );
  if (
    Object.prototype.hasOwnProperty.call(payload, 'sourceResult') &&
    payload.sourceResult !== null
  ) {
    assertPlainRecord(payload.sourceResult);
  }
  const scenes = assertPlainArray(payload.scenes, STORYBOARD_LOCAL_BRIDGE_MAX_SCENES);
  if (scenes.length === 0) return invalidStoryboardLocalBridgePayload();

  const sceneNos = new Set<number>();
  const validatedScenes = scenes.map((scene) => {
    const validatedScene = assertStoryboardScene(scene);
    if (sceneNos.has(validatedScene.sceneNo)) return invalidStoryboardLocalBridgePayload();
    sceneNos.add(validatedScene.sceneNo);
    return validatedScene;
  });

  return {
    title: assertBoundedString(payload, 'title', STORYBOARD_LOCAL_BRIDGE_MAX_TITLE_LENGTH),
    logline: assertBoundedString(payload, 'logline', STORYBOARD_LOCAL_BRIDGE_MAX_LOGLINE_LENGTH),
    request: assertStoryboardGenerateRequest(payload.request),
    scenes: validatedScenes,
  };
}

function isThumbnailMime(value: unknown): value is ThumbnailReferenceImage['mime'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function isThumbnailReferenceRole(value: unknown): value is ThumbnailReferenceRole {
  return value === 'host' || value === 'food' || value === 'object' || value === 'person' || value === 'other';
}

type ImageInspection = {
  frames: number;
  height: number;
  mime: ThumbnailReferenceImage['mime'];
  width: number;
};

function inspectPng(bytes: Buffer): ImageInspection {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasIhdr = false;
  let hasIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
    }
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (!hasIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
      }
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      hasIhdr = true;
    } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new LocalBridgeHttpError('invalid_payload', 'Animated images are not allowed.', 400);
    } else if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== bytes.length) {
        throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
      }
      hasIend = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!hasIhdr || !hasIend) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
  }
  return { mime: 'image/png', frames: 1, width, height };
}

function inspectJpeg(bytes: Buffer): ImageInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 8) break;
      return {
        mime: 'image/jpeg',
        frames: 1,
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
}

function inspectWebp(bytes: Buffer): ImageInspection {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
  }
  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const paddedLength = length + (length % 2);
    if (dataOffset + paddedLength > bytes.length) {
      throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
    }
    if (type === 'ANIM' || type === 'ANMF') {
      throw new LocalBridgeHttpError('invalid_payload', 'Animated images are not allowed.', 400);
    }
    if (type === 'VP8X' && length >= 10) {
      dimensions = {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1,
      };
    } else if (type === 'VP8 ' && length >= 10 && bytes.subarray(dataOffset + 3, dataOffset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      dimensions = {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    } else if (type === 'VP8L' && length >= 5 && bytes[dataOffset] === 0x2f) {
      const bits = bytes.readUInt32LE(dataOffset + 1);
      dimensions = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    offset = dataOffset + paddedLength;
  }
  if (!dimensions || offset !== bytes.length) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
  }
  return { mime: 'image/webp', frames: 1, ...dimensions };
}

function inspectImage(bytes: Buffer): ImageInspection {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return inspectPng(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return inspectJpeg(bytes);
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return inspectWebp(bytes);
  }
  throw new LocalBridgeHttpError('invalid_payload', 'Image format is invalid.', 400);
}

function assertImageBounds(image: ImageInspection) {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    !Number.isSafeInteger(image.frames) ||
    image.width < 1 ||
    image.height < 1 ||
    image.frames < 1 ||
    image.frames > MAX_IMAGE_FRAMES ||
    image.width > MAX_IMAGE_DIMENSION ||
    image.height > MAX_IMAGE_DIMENSION ||
    image.width * image.height > MAX_IMAGE_PIXELS
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Image dimensions are invalid.', 400);
  }
}

function decodeCanonicalBase64(value: string) {
  const maxBase64Length = Math.ceil(MAX_REFERENCE_IMAGE_BYTES / 3) * 4;
  if (
    value.length === 0 ||
    value.length > maxBase64Length ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Reference image payload must be canonical base64.', 400);
  }
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length === 0 ||
    bytes.length > MAX_REFERENCE_IMAGE_BYTES ||
    bytes.toString('base64') !== value
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Reference image payload must be canonical base64.', 400);
  }
  return bytes;
}

function assertThumbnailImagesPayload(value: unknown): ThumbnailLocalBridgeImagesRequest {
  const body = assertExactPlainRecord(value, ['payload', 'referenceImages']);
  const generatorPayload = assertExactPlainRecord(
    body.payload,
    [
      'providerId',
      'generationMode',
      'topic',
      'headline',
      'subHeadline',
      'stylePreset',
      'referenceImageRoles',
      'acknowledgedSafety',
      'textLayers',
      'retrievalEvidence',
      'retrievalDiagnostics',
    ],
    ['providerId', 'generationMode', 'topic', 'headline', 'acknowledgedSafety'],
  );
  if (
    generatorPayload.providerId !== STORYBOARD_IMAGE_PROVIDER_ID ||
    generatorPayload.generationMode !== 'direct_provider' ||
    generatorPayload.acknowledgedSafety !== true ||
    Object.prototype.hasOwnProperty.call(generatorPayload, 'retrievalEvidence') ||
    Object.prototype.hasOwnProperty.call(generatorPayload, 'retrievalDiagnostics')
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  const references = assertPlainArray(body.referenceImages, 8);
  const normalizedReferences = references.map((value) => {
    const image = assertExactPlainRecord(value, ['name', 'mime', 'role', 'dataBase64']);
    const name = assertBoundedString(image, 'name', 120);
    if (!isThumbnailMime(image.mime) || !isThumbnailReferenceRole(image.role)) {
      return invalidStoryboardLocalBridgePayload();
    }
    const dataBase64 = assertBoundedString(image, 'dataBase64', Math.ceil(MAX_REFERENCE_IMAGE_BYTES / 3) * 4);
    const bytes = decodeCanonicalBase64(dataBase64);
    const inspection = inspectImage(bytes);
    assertImageBounds(inspection);
    if (inspection.mime !== image.mime) return invalidStoryboardLocalBridgePayload();
    return { name, mime: image.mime, role: image.role, bytes };
  });
  const referenceImageRoles = Object.prototype.hasOwnProperty.call(generatorPayload, 'referenceImageRoles')
    ? assertPlainArray(generatorPayload.referenceImageRoles, 8).map((role) => {
      if (!isThumbnailReferenceRole(role)) return invalidStoryboardLocalBridgePayload();
      return role;
    })
    : normalizedReferences.map((image) => image.role);
  if (
    Object.prototype.hasOwnProperty.call(generatorPayload, 'textLayers') &&
    assertPlainArray(generatorPayload.textLayers, 0).length !== 0
  ) {
    return invalidStoryboardLocalBridgePayload();
  }
  const subHeadline = Object.prototype.hasOwnProperty.call(generatorPayload, 'subHeadline')
    ? assertBoundedString(generatorPayload, 'subHeadline', 120)
    : undefined;
  const stylePreset = Object.prototype.hasOwnProperty.call(generatorPayload, 'stylePreset')
    ? assertBoundedString(generatorPayload, 'stylePreset', 120)
    : undefined;
  return {
    payload: {
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      generationMode: 'direct_provider',
      topic: assertBoundedString(generatorPayload, 'topic', 500),
      headline: assertBoundedString(generatorPayload, 'headline', 120),
      subHeadline,
      stylePreset: stylePreset as ThumbnailGeneratorPayload['stylePreset'],
      referenceImageRoles,
      acknowledgedSafety: true,
      textLayers: [],
    },
    referenceImages: normalizedReferences,
  };
}

function getPathEnvironmentValue() {
  return process.env.PATH || process.env.Path || process.env.path || '';
}

function resolveCommandFromPath(command: string) {
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return command;
  }

  const pathExts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .map((extension) => extension.trim().toLowerCase())
      .filter(Boolean)
    : [''];
  const hasKnownExtension = pathExts.some((extension) =>
    extension && command.toLowerCase().endsWith(extension),
  );
  const pathEntries = getPathEnvironmentValue()
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => isAbsolute(entry));

  for (const entry of pathEntries) {
    const candidates = hasKnownExtension
      ? [join(entry, command)]
      : pathExts.map((extension) => join(entry, `${command}${extension}`));
    const resolved = candidates.find((candidate) => existsSync(candidate));
    if (resolved) return resolve(resolved);
  }

  return command;
}

function shouldRunThroughWindowsCommandShell(command: string) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command.trim());
}

function resolveLocalBridgePythonCommand() {
  const configuredPython = process.env.PYTHON?.trim();
  if (configuredPython) return resolveCommandFromPath(configuredPython);
  return resolveCommandFromPath(process.platform === 'win32' ? 'python' : 'python3');
}

function resolveProviderCommand(options: StoryboardLocalBridgeServerOptions) {
  if (options.providerCommand) {
    return { command: options.providerCommand, args: options.providerArgs ?? [] };
  }
  const envCommand = process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_COMMAND || process.env.STORYBOARD_LOCAL_CODEX_COMMAND;
  if (envCommand) {
    const args = process.env.TZUDONG_LOCAL_BRIDGE_PROVIDER_ARGS_JSON || process.env.STORYBOARD_LOCAL_CODEX_ARGS_JSON;
    return {
      command: envCommand,
      args: args ? JSON.parse(args) as string[] : [],
    };
  }
  return {
    command: resolveLocalBridgePythonCommand(),
    args: [resolveStoryboardProviderScriptPath()],
  };
}

function resolveStoryboardProviderScriptPath() {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, 'apps/web', DEFAULT_LOCAL_CODEX_SCRIPT),
    resolve(cwd, DEFAULT_LOCAL_CODEX_SCRIPT),
    resolve(resolveLocalBridgeRepoRoot(), DEFAULT_LOCAL_CODEX_SCRIPT),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveLocalBridgeRepoRoot() {
  const configured = process.env.TZUDONG_REPO_ROOT || process.env.CODEX_IMAGEGEN_WORKDIR;
  const candidates = configured?.trim()
    ? [resolve(configured.trim()), resolve(configured.trim(), 'apps/web')]
    : [process.cwd(), resolve(process.cwd(), 'apps/web')];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, DEFAULT_LOCAL_CODEX_THUMBNAIL_SCRIPT))) return candidate;
  }
  return candidates[0];
}

function parseArgsJson(value: string | undefined) {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function replacePlaceholders(
  args: string[],
  placeholders: Record<string, string>,
) {
  return args.map((arg) => Object.entries(placeholders).reduce(
    (next, [key, value]) => next.replaceAll(`{${key}}`, value),
    arg,
  ));
}

function resolveThumbnailProviderCommand(
  options: StoryboardLocalBridgeServerOptions,
  placeholders: Record<string, string>,
) {
  const configured = options.thumbnailProviderCommand || process.env.THUMBNAIL_LOCAL_CODEX_COMMAND;
  if (configured) {
    const args = options.thumbnailProviderArgs
      ?? parseArgsJson(process.env.THUMBNAIL_LOCAL_CODEX_ARGS_JSON);
    return {
      command: configured,
      args: replacePlaceholders(args, placeholders),
    };
  }
  const repoRoot = resolveLocalBridgeRepoRoot();
  return {
    command: resolveLocalBridgePythonCommand(),
    args: [
      resolve(repoRoot, DEFAULT_LOCAL_CODEX_THUMBNAIL_SCRIPT),
      '--prompt-file', placeholders.promptFile,
      '--output', placeholders.output,
      '--json-output', placeholders.outputJsonFile,
      '--model', STORYBOARD_IMAGE_PROVIDER_MODEL,
      '--reference-manifest', placeholders.referenceManifest,
    ],
  };
}

function parseProviderStdout(stdout: string): ProviderResult {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Provider did not return JSON.', 502);
  }
  try {
    return JSON.parse(jsonLine) as ProviderResult;
  } catch {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Provider returned invalid JSON.', 502);
  }
}

type ProviderCommandTerminationReason =
  | 'aborted'
  | 'output_limit'
  | 'spawn_error'
  | 'nonzero_exit'
  | 'timed_out';

type ProviderCommandMessages = {
  aborted: string;
  outputLimit: string;
  timedOut: string;
};

type LocalBridgeProviderCommandOptions = {
  command: string;
  args: string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  input: Record<string, unknown>;
  messages: ProviderCommandMessages;
  signal?: AbortSignal;
  timeoutMs: number;
};

function providerCommandError(message: string, status = 502) {
  return new LocalBridgeHttpError('provider_execution_failed', message, status);
}

function hasValidProviderProcessPid(pid: number | undefined): pid is number {
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0;
}

async function resolveTrustedProviderPath(path: string) {
  const candidate = isAbsolute(path.trim())
    ? resolve(path.trim())
    : resolveCommandFromPath(path.trim());
  if (!isAbsolute(candidate)) {
    throw providerCommandError('Provider command could not be verified.');
  }

  let initialStat: Awaited<ReturnType<typeof fsPromises.lstat>>;
  let resolvedPath: string;
  let resolvedStat: Awaited<ReturnType<typeof fsPromises.lstat>>;
  try {
    initialStat = await fsPromises.lstat(candidate);
    resolvedPath = await fsPromises.realpath(candidate);
    resolvedStat = await fsPromises.lstat(resolvedPath);
  } catch {
    throw providerCommandError('Provider command could not be verified.');
  }
  if (
    !initialStat.isFile() ||
    initialStat.isSymbolicLink() ||
    !resolvedStat.isFile() ||
    resolvedStat.isSymbolicLink() ||
    !hasSameFileIdentity(initialStat, resolvedStat)
  ) {
    throw providerCommandError('Provider command could not be verified.');
  }
  return resolvedPath;
}

async function resolveTrustedProviderLaunch(command: string, args: string[]) {
  const executable = await resolveTrustedProviderPath(command);
  const trustedArgs = await Promise.all(args.map(async (arg) => {
    if (!['.bat', '.cmd', '.cjs', '.exe', '.js', '.mjs', '.py'].includes(extname(arg).toLowerCase())) {
      return arg;
    }
    if (!isAbsolute(arg)) {
      throw providerCommandError('Provider command could not be verified.');
    }
    return resolveTrustedProviderPath(arg);
  }));
  return { executable, args: trustedArgs };
}

function createLocalBridgeProviderEnvironment(extra?: NodeJS.ProcessEnv) {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
  };
  for (const key of LOCAL_BRIDGE_PROVIDER_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function terminateWindowsProviderProcessTree(pid: number, force: boolean): Promise<void> {
  return new Promise((resolveTermination) => {
    let observed = false;
    const finish = () => {
      if (observed) return;
      observed = true;
      resolveTermination();
    };
    try {
      const taskkill = spawn('taskkill.exe', [
        '/pid',
        String(pid),
        '/t',
        ...(force ? ['/f'] : []),
      ], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      taskkill.once('error', finish);
      taskkill.once('close', finish);
    } catch {
      finish();
    }
  });
}

function terminateProviderProcessTree(pid: number | undefined, signal: 'SIGTERM' | 'SIGKILL') {
  if (!hasValidProviderProcessPid(pid)) return Promise.resolve();
  if (process.platform === 'win32') {
    return terminateWindowsProviderProcessTree(pid, signal === 'SIGKILL');
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // A completed process group is already clean.
  }
  return Promise.resolve();
}

async function runLocalBridgeProviderCommand(
  options: LocalBridgeProviderCommandOptions,
): Promise<string> {
  if (options.signal?.aborted) {
    throw providerCommandError(options.messages.aborted, 499);
  }

  const launch = await resolveTrustedProviderLaunch(options.command, options.args);
  if (options.signal?.aborted) {
    throw providerCommandError(options.messages.aborted, 499);
  }

  const child = (() => {
    try {
      return spawn(launch.executable, launch.args, {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        env: createLocalBridgeProviderEnvironment(options.environment),
        shell: shouldRunThroughWindowsCommandShell(launch.executable),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      throw providerCommandError('Provider execution failed.');
    }
  })();

  return new Promise<string>((resolveCommand, rejectCommand) => {
    let settled = false;
    let stdout = '';
    let outputBytes = 0;
    let closeObserved = false;
    let closeExitCode: number | null = null;
    let directExitObserved = false;
    let directExitCode: number | null = null;
    let terminationReason: ProviderCommandTerminationReason | null = null;
    let terminationComplete = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (terminationTimer) clearTimeout(terminationTimer);
      options.signal?.removeEventListener('abort', abortProvider);
    };
    const finishWhenReady = () => {
      if (
        settled ||
        !closeObserved ||
        (terminationReason !== null && !terminationComplete)
      ) {
        return;
      }
      settled = true;
      cleanup();
      if (terminationReason === 'aborted') {
        rejectCommand(providerCommandError(options.messages.aborted, 499));
      } else if (terminationReason === 'timed_out') {
        rejectCommand(providerCommandError(options.messages.timedOut, 504));
      } else if (terminationReason === 'output_limit') {
        rejectCommand(providerCommandError(options.messages.outputLimit));
      } else if (terminationReason === 'spawn_error' || terminationReason === 'nonzero_exit' || closeExitCode !== 0) {
        rejectCommand(providerCommandError('Provider execution failed.'));
      } else {
        resolveCommand(stdout);
      }
    };
    const terminate = (reason: ProviderCommandTerminationReason) => {
      if (settled || terminationReason !== null) return;
      terminationReason = reason;
      if (reason === 'spawn_error') {
        terminationComplete = true;
        finishWhenReady();
        return;
      }
      void (async () => {
        await terminateProviderProcessTree(child.pid, 'SIGTERM');
        await new Promise<void>((resolveGrace) => {
          terminationTimer = setTimeout(resolveGrace, LOCAL_BRIDGE_PROCESS_TERMINATION_GRACE_MS);
        });
        await terminateProviderProcessTree(child.pid, 'SIGKILL');
      })().catch(() => undefined).finally(() => {
        terminationComplete = true;
        finishWhenReady();
      });
    };
    const abortProvider = () => terminate('aborted');
    const handleOutput = (stream: 'stdout' | 'stderr', chunk: unknown) => {
      if (terminationReason !== null) return;
      const chunkBytes = typeof chunk === 'string'
        ? Buffer.byteLength(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk.byteLength
          : null;
      if (chunkBytes === null || chunkBytes > MAX_OUTPUT_BYTES - outputBytes) {
        terminate('output_limit');
        return;
      }
      outputBytes += chunkBytes;
      if (stream === 'stdout' && typeof chunk === 'string') {
        stdout += chunk;
      }
    };

    child.on('exit', (code) => {
      directExitObserved = true;
      directExitCode = code;
    });
    child.on('close', (code) => {
      closeObserved = true;
      closeExitCode = code;
      if (code !== 0) terminate('nonzero_exit');
      finishWhenReady();
    });
    child.on('error', () => {
      closeObserved = true;
      terminate('spawn_error');
      finishWhenReady();
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      closeObserved = true;
      terminate('spawn_error');
      finishWhenReady();
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => handleOutput('stdout', chunk));
    child.stderr.on('data', (chunk) => handleOutput('stderr', chunk));
    child.stdin.on('error', () => terminate('spawn_error'));
    timeout = setTimeout(() => {
      if (
        (directExitObserved && directExitCode !== 0) ||
        (child.exitCode !== null && child.exitCode !== 0)
      ) {
        terminate('nonzero_exit');
        return;
      }
      terminate('timed_out');
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', abortProvider, { once: true });
    if (options.signal?.aborted) {
      abortProvider();
    }
    try {
      child.stdin.end(`${JSON.stringify(options.input)}\n`);
    } catch {
      terminate('spawn_error');
    }
  });
}

function runProviderCommand(
  input: Record<string, unknown>,
  options: StoryboardLocalBridgeServerOptions,
  signal?: AbortSignal,
) {
  const { command, args } = resolveProviderCommand(options);
  const configuredTimeoutMs = Number(process.env.TZUDONG_LOCAL_BRIDGE_TIMEOUT_MS);
  const timeoutMs = options.commandTimeoutMs ?? (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : COMMAND_TIMEOUT_MS);
  return runLocalBridgeProviderCommand({
    command,
    args,
    cwd: process.cwd(),
    input,
    messages: {
      aborted: 'Provider request was aborted.',
      outputLimit: 'Provider output exceeded limit.',
      timedOut: 'Provider timed out.',
    },
    signal,
    timeoutMs,
  }).then(parseProviderStdout);
}

function isProof(value: ProviderResult, outputPath: string): value is Required<Pick<ProviderResult, 'providerId' | 'authMode' | 'endpoint' | 'requestToolType' | 'requestToolModel' | 'model' | 'modelProvenance' | 'responseId' | 'imageCallId' | 'imageItemCount' | 'rawImageItemTypes' | 'requestHash' | 'responseHash' | 'hasOpenAIAPIKey' | 'generatedAt'>> & ProviderResult {
  return (
    value.ok === true &&
    value.providerId === STORYBOARD_IMAGE_PROVIDER_ID &&
    value.authMode === 'codex_oauth' &&
    value.endpoint === LOCAL_CODEX_RESPONSES_ENDPOINT &&
    value.requestToolType === 'image_generation' &&
    value.requestToolModel === STORYBOARD_IMAGE_PROVIDER_MODEL &&
    value.model === STORYBOARD_IMAGE_PROVIDER_MODEL &&
    value.modelProvenance === STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE &&
    value.hasOpenAIAPIKey === false &&
    value.outputPath === outputPath &&
    typeof value.responseId === 'string' && value.responseId.length > 0 &&
    typeof value.imageCallId === 'string' && value.imageCallId.length > 0 &&
    typeof value.imageItemCount === 'number' && value.imageItemCount > 0 &&
    Array.isArray(value.rawImageItemTypes) && value.rawImageItemTypes[0] === 'image_generation_call' &&
    value.mime === 'image/png' &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_IMAGE_OUTPUT_BYTES &&
    isOptionalBoundedImageDimension(value.width) &&
    isOptionalBoundedImageDimension(value.height) &&
    (
      value.width === undefined ||
      value.height === undefined ||
      value.width * value.height <= MAX_IMAGE_PIXELS
    ) &&
    (value.outputHash === undefined || /^[a-f0-9]{64}$/i.test(value.outputHash)) &&
    typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/i.test(value.requestHash) &&
    typeof value.responseHash === 'string' && /^[a-f0-9]{64}$/i.test(value.responseHash) &&
    typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
  );
}

function toProvenance(proof: ProviderResult): StoryboardGeneratedImageProvenance {
  return {
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    authMode: 'codex_oauth',
    endpoint: LOCAL_CODEX_RESPONSES_ENDPOINT,
    agentModel: typeof proof.agentModel === 'string' ? proof.agentModel : undefined,
    requestToolType: 'image_generation',
    requestToolModel: STORYBOARD_IMAGE_PROVIDER_MODEL,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
    responseId: proof.responseId || 'missing_response',
    imageCallId: proof.imageCallId || 'missing_call',
    imageItemCount: proof.imageItemCount || 1,
    generatedImageItemTypes: proof.generatedImageItemTypes,
    rawImageItemTypes: proof.rawImageItemTypes || ['image_generation_call'],
    requestHash: proof.requestHash || '0'.repeat(64),
    responseHash: proof.responseHash || '0'.repeat(64),
    hasOpenAIAPIKey: false,
    generatedAt: proof.generatedAt || new Date().toISOString(),
  };
}

function defaultOutputDir(options: StoryboardLocalBridgeServerOptions) {
  return resolve(options.outputDir || process.env.TZUDONG_LOCAL_BRIDGE_OUTPUT_DIR || join(tmpdir(), 'tzudong-storyboard-local-bridge'));
}
function isPathInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function hasSameFileIdentity(expected: Awaited<ReturnType<typeof fsPromises.lstat>>, actual: Awaited<ReturnType<typeof fsPromises.lstat>>) {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function rejectUntrustedProviderOutput(): never {
  throw new LocalBridgeHttpError('provider_execution_failed', 'Provider output could not be verified.', 502);
}

class LocalBridgeRunBudget {
  #usedBytes = 0;

  consume(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.#usedBytes + bytes > MAX_RUN_BYTES) {
      throw new LocalBridgeHttpError('invalid_payload', 'Local bridge run exceeds its byte limit.', 413);
    }
    this.#usedBytes += bytes;
  }
}

async function createPrivateLocalBridgeRunDirectory(options: StoryboardLocalBridgeServerOptions) {
  const outputRoot = defaultOutputDir(options);
  await fsPromises.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const rootStat = await fsPromises.lstat(outputRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) rejectUntrustedProviderOutput();
  const realRoot = await fsPromises.realpath(outputRoot);
  const resolvedRootStat = await fsPromises.lstat(realRoot);
  if (!resolvedRootStat.isDirectory() || resolvedRootStat.isSymbolicLink() || !hasSameFileIdentity(rootStat, resolvedRootStat)) {
    rejectUntrustedProviderOutput();
  }
  await fsPromises.chmod(realRoot, 0o700);
  const runDir = await fsPromises.mkdtemp(join(realRoot, 'run-'));
  await fsPromises.chmod(runDir, 0o700);
  const runStat = await fsPromises.lstat(runDir);
  if (!runStat.isDirectory() || runStat.isSymbolicLink() || !isPathInsideRoot(realRoot, runDir)) {
    rejectUntrustedProviderOutput();
  }
  return runDir;
}

async function withPrivateLocalBridgeRunDirectory<T>(
  options: StoryboardLocalBridgeServerOptions,
  work: (runDir: string, budget: LocalBridgeRunBudget) => Promise<T>,
) {
  const runDir = await createPrivateLocalBridgeRunDirectory(options);
  try {
    return await work(runDir, new LocalBridgeRunBudget());
  } finally {
    await fsPromises.rm(runDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
  }
}
async function assertPrivateRunArtifactBounds(runDir: string) {
  const initialRunStat = await fsPromises.lstat(runDir).catch(() => rejectUntrustedProviderOutput());
  const resolvedRunDir = await fsPromises.realpath(runDir).catch(() => rejectUntrustedProviderOutput());
  if (!initialRunStat.isDirectory() || initialRunStat.isSymbolicLink()) rejectUntrustedProviderOutput();
  let totalBytes = 0;
  let entriesSeen = 0;
  async function scan(directory: string, depth: number): Promise<void> {
    if (depth > 4) rejectUntrustedProviderOutput();
    const directoryStat = await fsPromises.lstat(directory).catch(() => rejectUntrustedProviderOutput());
    const resolvedDirectory = await fsPromises.realpath(directory).catch(() => rejectUntrustedProviderOutput());
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      (directory === runDir
        ? !hasSameFileIdentity(initialRunStat, directoryStat)
        : !isPathInsideRoot(resolvedRunDir, resolvedDirectory))
    ) {
      rejectUntrustedProviderOutput();
    }
    const entries = await fsPromises.readdir(directory, { withFileTypes: true });
    entriesSeen += entries.length;
    if (entriesSeen > 64) rejectUntrustedProviderOutput();
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      if (!isPathInsideRoot(runDir, candidate)) rejectUntrustedProviderOutput();
      const stat = await fsPromises.lstat(candidate);
      if (stat.isSymbolicLink()) rejectUntrustedProviderOutput();
      if (stat.isDirectory()) {
        await scan(candidate, depth + 1);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > MAX_RUN_BYTES) rejectUntrustedProviderOutput();
      } else {
        rejectUntrustedProviderOutput();
      }
    }
  }
  await scan(runDir, 0);
}

async function readTrustedProviderPngOutput(
  runDir: string,
  outputPath: string,
  proof: ProviderResult,
  budget: LocalBridgeRunBudget,
) {
  const resolvedRunDir = await fsPromises.realpath(runDir).catch(() => rejectUntrustedProviderOutput());
  const runStat = await fsPromises.lstat(resolvedRunDir).catch(() => rejectUntrustedProviderOutput());
  if (!runStat.isDirectory() || runStat.isSymbolicLink() || !isPathInsideRoot(resolvedRunDir, outputPath)) {
    return rejectUntrustedProviderOutput();
  }

  let initialStat: Awaited<ReturnType<typeof fsPromises.lstat>>;
  let resolvedOutputPath: string;
  try {
    initialStat = await fsPromises.lstat(outputPath);
    resolvedOutputPath = await fsPromises.realpath(outputPath);
  } catch {
    return rejectUntrustedProviderOutput();
  }
  if (
    !initialStat.isFile() ||
    initialStat.isSymbolicLink() ||
    initialStat.size <= 0 ||
    initialStat.size > MAX_IMAGE_OUTPUT_BYTES ||
    !isPathInsideRoot(resolvedRunDir, resolvedOutputPath)
  ) {
    return rejectUntrustedProviderOutput();
  }

  let handle: Awaited<ReturnType<typeof fsPromises.open>> | undefined;
  try {
    handle = await fsPromises.open(
      outputPath,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const openedStat = await handle.stat();
    const currentStat = await fsPromises.lstat(outputPath);
    const currentResolvedOutputPath = await fsPromises.realpath(outputPath);
    if (
      !openedStat.isFile() ||
      openedStat.size <= 0 ||
      openedStat.size > MAX_IMAGE_OUTPUT_BYTES ||
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      !hasSameFileIdentity(initialStat, openedStat) ||
      !hasSameFileIdentity(openedStat, currentStat) ||
      !isPathInsideRoot(resolvedRunDir, currentResolvedOutputPath)
    ) {
      return rejectUntrustedProviderOutput();
    }
    const bytes = await handle.readFile();
    const finalStat = await handle.stat();
    if (
      bytes.length !== openedStat.size ||
      !hasSameFileIdentity(openedStat, finalStat) ||
      proof.bytes !== bytes.length
    ) {
      return rejectUntrustedProviderOutput();
    }
    let image: ImageInspection;
    try {
      image = inspectImage(bytes);
      assertImageBounds(image);
    } catch {
      return rejectUntrustedProviderOutput();
    }
    if (
      image.mime !== 'image/png' ||
      (typeof proof.width === 'number' && proof.width !== image.width) ||
      (typeof proof.height === 'number' && proof.height !== image.height) ||
      (proof.outputHash !== undefined && (
        !/^[a-f0-9]{64}$/i.test(proof.outputHash) ||
        !tokenMatches(sha256(bytes), proof.outputHash)
      ))
    ) {
      return rejectUntrustedProviderOutput();
    }
    budget.consume(bytes.length);
    return { bytes, image };
  } catch (error) {
    if (error instanceof LocalBridgeHttpError) throw error;
    return rejectUntrustedProviderOutput();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
function resolveStoryboardSceneOutputPath(runDir: string, sceneNo: number) {
  if (
    !Number.isSafeInteger(sceneNo) ||
    sceneNo < STORYBOARD_LOCAL_BRIDGE_MIN_SCENE_NO ||
    sceneNo > STORYBOARD_LOCAL_BRIDGE_MAX_SCENE_NO
  ) {
    throw new LocalBridgeHttpError(
      'invalid_payload',
      'Invalid storyboard local bridge payload.',
      400,
    );
  }
  const outputPath = resolve(runDir, `cut-${sceneNo}.png`);
  const relativeOutputPath = relative(runDir, outputPath);
  if (
    relativeOutputPath === '' ||
    relativeOutputPath === '..' ||
    relativeOutputPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeOutputPath)
  ) {
    throw new LocalBridgeHttpError(
      'invalid_payload',
      'Invalid storyboard local bridge payload.',
      400,
    );
  }
  return outputPath;
}


async function generateImageForScene(
  scene: StoryboardScene,
  payload: StoryboardLocalBridgeImagesRequest,
  options: StoryboardLocalBridgeServerOptions,
  runDir: string,
  budget: LocalBridgeRunBudget,
  signal?: AbortSignal,
): Promise<{ sceneNo: number; image: StoryboardSceneGeneratedImage }> {
  const prompt = buildLocalBridgeScenePrompt(scene, {
    title: payload.title,
    logline: payload.logline,
    request: payload.request,
  });
  const outputPath = resolveStoryboardSceneOutputPath(runDir, scene.sceneNo);
  const result = await withLocalBridgeGenerationSlot(signal, () => runProviderCommand({
    prompt,
    sceneNo: scene.sceneNo,
    outputPath,
    size: process.env.STORYBOARD_LOCAL_CODEX_IMAGE_SIZE || DEFAULT_SIZE,
    outputFormat: 'png',
    background: 'opaque',
    agentModel: process.env.CODEX_IMAGEGEN_AGENT_MODEL || 'gpt-5.5',
    reasoningEffort: process.env.CODEX_IMAGEGEN_AGENT_EFFORT || 'low',
    timeout: 300,
  }, options, signal));
  if (!isProof(result, outputPath)) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Provider response did not satisfy exact gpt-image-2 provenance.', 502);
  }
  await assertPrivateRunArtifactBounds(runDir);
  const { bytes: imageBytes } = await readTrustedProviderPngOutput(runDir, outputPath, result, budget);
  const image: StoryboardSceneGeneratedImage = {
    dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
    mime: 'image/png',
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    trustPolicy: STORYBOARD_GENERATED_IMAGE_TRUST_POLICY,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    prompt,
    generatedAt: result.generatedAt,
    warnings: [
      'local_bridge_provider: generated on the operator machine through a paired localhost bridge.',
      'no_relay_transport: browser connected directly to 127.0.0.1; Vercel/Next did not proxy this request.',
      `exact_provenance: ${result.requestToolType}.${result.requestToolModel} response=${result.responseId} call=${result.imageCallId}`,
    ],
    provenance: toProvenance(result),
  };
  return { sceneNo: scene.sceneNo, image };
}

function shouldRequireThumbnailHostReference(payload: ThumbnailGeneratorPayload) {
  const haystack = [
    payload.topic,
    payload.headline,
    payload.subHeadline,
    payload.stylePreset,
  ].filter(Boolean).join(' ').toLowerCase();
  return /쯔양|tzuyang|tzuyang/i.test(haystack);
}

function buildLocalBridgeThumbnailPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[],
) {
  const hasHostReference = referenceImages.some((image) => image.role === 'host' || image.role === 'person');
  const referenceSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} · ${image.name} · ${image.mime}`).join('; ')
    : 'none';
  return [
    'Create one 16:9 Korean YouTube thumbnail base image for a mukbang / food-travel video.',
    `Content topic: ${compactText(payload.topic, 260)}`,
    `Style preset: ${payload.stylePreset ?? 'tzuyang-food-travel-collage'}`,
    `Editable headline placeholder: ${compactText(payload.headline, 120)}`,
    `Secondary editable caption: ${compactText(payload.subHeadline ?? '', 120)}`,
    'Composition requirements: high-contrast appetizing Korean food, clear subject separation, negative space for later text overlays, no readable baked-in final typography.',
    `Host/person guidance: ${hasHostReference ? 'ALLOW_SPECIFIC_CREATOR_HOST_WITH_REFERENCE. Use host/person references only as identity lock references; do not invent or substitute another person.' : 'FOOD_ONLY_NO_PERSON. Do not draw a human figure, face, cutout, silhouette, or creator body zone.'}`,
    `User image references: ${referenceSummary}`,
    'Output must be one image only. No logos, watermarks, UI chrome, prices, contact text, or readable real signage.',
  ].join('\n');
}

function extensionForThumbnailMime(mime: ThumbnailReferenceImage['mime']) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

async function writeThumbnailReferenceManifest(
  runDir: string,
  referenceImages: ValidatedThumbnailLocalBridgeReferenceImage[],
  budget: LocalBridgeRunBudget,
): Promise<{ manifestPath: string; references: ThumbnailReferenceImage[] }> {
  const referencesDir = join(runDir, 'references');
  await fsPromises.mkdir(referencesDir, { mode: 0o700 });
  await fsPromises.chmod(referencesDir, 0o700);
  const manifest: Array<{ path: string; name: string; mime: string; role: string }> = [];
  const references: ThumbnailReferenceImage[] = [];
  for (const [index, image] of referenceImages.entries()) {
    const path = join(referencesDir, `reference-${index + 1}-${image.role}.${extensionForThumbnailMime(image.mime)}`);
    if (!isPathInsideRoot(runDir, path)) rejectUntrustedProviderOutput();
    budget.consume(image.bytes.length);
    await fsPromises.writeFile(path, image.bytes, { flag: 'wx', mode: 0o600 });
    manifest.push({ path, name: image.name, mime: image.mime, role: image.role });
    references.push({
      name: image.name,
      mime: image.mime,
      role: image.role,
      bytes: image.bytes,
    });
  }
  const manifestPath = join(runDir, 'references.json');
  if (!isPathInsideRoot(runDir, manifestPath)) rejectUntrustedProviderOutput();
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  budget.consume(manifestBytes.length);
  await fsPromises.writeFile(manifestPath, manifestBytes, { flag: 'wx', mode: 0o600 });
  return { manifestPath, references };
}

function parseThumbnailProviderStdout(stdout: string): ProviderResult {
  return parseProviderStdout(stdout);
}

function runThumbnailProviderCommand(
  placeholders: Record<string, string>,
  options: StoryboardLocalBridgeServerOptions,
  signal?: AbortSignal,
) {
  const { command, args } = resolveThumbnailProviderCommand(options, placeholders);
  const configuredTimeoutMs = Number(process.env.TZUDONG_LOCAL_BRIDGE_THUMBNAIL_TIMEOUT_MS);
  const timeoutMs = options.commandTimeoutMs ?? (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : THUMBNAIL_COMMAND_TIMEOUT_MS);
  const repoRoot = resolveLocalBridgeRepoRoot();
  const providerEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    CODEX_IMAGEGEN_WORKDIR: repoRoot,
  };
  return runLocalBridgeProviderCommand({
    command,
    args,
    cwd: repoRoot,
    environment: providerEnvironment,
    input: placeholders,
    messages: {
      aborted: 'Thumbnail provider request was aborted.',
      outputLimit: 'Thumbnail provider output exceeded limit.',
      timedOut: 'Thumbnail provider timed out.',
    },
    signal,
    timeoutMs,
  }).then(parseThumbnailProviderStdout);
}

function isThumbnailProof(value: ProviderResult, outputPath: string): value is ProviderResult & {
  outputPath: string;
  responseId: string;
  imageCallId: string;
  imageItemCount: number;
  generatedAt: string;
} {
  return (
    value.ok === true &&
    value.providerId === STORYBOARD_IMAGE_PROVIDER_ID &&
    value.authMode === 'codex_oauth' &&
    value.requestToolType === 'image_generation' &&
    value.requestToolModel === STORYBOARD_IMAGE_PROVIDER_MODEL &&
    value.model === STORYBOARD_IMAGE_PROVIDER_MODEL &&
    value.modelProvenance === STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE &&
    value.hasOpenAIAPIKey === false &&
    value.outputPath === outputPath &&
    (!value.durableOutputPath || value.durableOutputPath === outputPath) &&
    typeof value.responseId === 'string' && value.responseId.length > 0 &&
    typeof value.imageCallId === 'string' && value.imageCallId.length > 0 &&
    typeof value.imageItemCount === 'number' && value.imageItemCount > 0 &&
    Array.isArray(value.rawImageItemTypes) && value.rawImageItemTypes.some((type) => type === 'image_generation_call' || type === 'image_generation_end') &&
    value.mime === 'image/png' &&
    typeof value.bytes === 'number' &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_IMAGE_OUTPUT_BYTES &&
    isOptionalBoundedImageDimension(value.width) &&
    isOptionalBoundedImageDimension(value.height) &&
    (
      value.width === undefined ||
      value.height === undefined ||
      value.width * value.height <= MAX_IMAGE_PIXELS
    ) &&
    (value.outputHash === undefined || /^[a-f0-9]{64}$/i.test(value.outputHash)) &&
    typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
  );
}

async function generateThumbnailForLocalBridge(
  payload: ThumbnailLocalBridgeImagesRequest,
  options: StoryboardLocalBridgeServerOptions,
  runDir: string,
  budget: LocalBridgeRunBudget,
  signal?: AbortSignal,
): Promise<ThumbnailGenerationResult> {
  const { manifestPath, references } = await writeThumbnailReferenceManifest(runDir, payload.referenceImages, budget);
  if (shouldRequireThumbnailHostReference(payload.payload) && !references.some((image) => image.role === 'host' || image.role === 'person')) {
    throw new LocalBridgeHttpError(
      'invalid_payload',
      '이 로컬 브릿지 경로는 서버 검색을 사용하지 않습니다. 쯔양/특정 호스트 생성에는 host 또는 person 참고 이미지를 먼저 첨부해 주세요.',
      400,
    );
  }
  const prompt = buildLocalBridgeThumbnailPrompt(payload.payload, references);
  const promptFile = join(runDir, 'prompt.txt');
  const outputPath = join(runDir, 'thumbnail.png');
  const outputJsonFile = join(runDir, 'provider-result.json');
  if (
    !isPathInsideRoot(runDir, promptFile) ||
    !isPathInsideRoot(runDir, outputPath) ||
    !isPathInsideRoot(runDir, outputJsonFile)
  ) {
    return rejectUntrustedProviderOutput();
  }
  const promptBytes = Buffer.from(prompt, 'utf8');
  budget.consume(promptBytes.length);
  await fsPromises.writeFile(promptFile, promptBytes, { flag: 'wx', mode: 0o600 });
  const result = await withLocalBridgeGenerationSlot(
    signal,
    () => runThumbnailProviderCommand({
      promptFile,
      output: outputPath,
      outputJsonFile,
      referenceManifest: manifestPath,
      model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    }, options, signal),
  );
  if (!isThumbnailProof(result, outputPath)) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Thumbnail provider response did not satisfy exact gpt-image-2 provenance.', 502);
  }
  await assertPrivateRunArtifactBounds(runDir);
  const { bytes: imageBytes, image } = await readTrustedProviderPngOutput(runDir, outputPath, result, budget);
  return {
    baseImage: {
      dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
      mime: 'image/png',
      width: image.width,
      height: image.height,
      targetWidth: THUMBNAIL_TARGET_WIDTH,
      targetHeight: THUMBNAIL_TARGET_HEIGHT,
      providerId: STORYBOARD_IMAGE_PROVIDER_ID,
      model: STORYBOARD_IMAGE_PROVIDER_MODEL,
      modelProvenance: STORYBOARD_IMAGE_PROVIDER_EXACT_PROVENANCE,
      hostPresence: references.some((image) => image.role === 'host' || image.role === 'person')
        ? { source: 'local_bridge_manual_reference', status: 'manual_reference_used' }
        : { source: 'local_bridge_manual_reference', status: 'food_only' },
    },
    prompt,
    warnings: [
      'local_bridge_provider: generated on the operator machine through a paired localhost bridge.',
      'no_relay_transport: browser connected directly to 127.0.0.1; Vercel/Next did not proxy this request.',
      'server_history_persistence: skipped for advanced local bridge result.',
      `exact_provenance: ${result.requestToolType}.${result.requestToolModel} response=${result.responseId} call=${result.imageCallId}`,
    ],
    retrieval: {
      evidence: [],
      diagnostics: {
        status: 'disabled',
        candidateCount: 0,
        selectedReferenceIds: [],
        fallbackReason: 'disabled',
        commandRuntime: 'none',
      },
    },
  };
}

function authFileExists(options: StoryboardLocalBridgeServerOptions) {
  if (options.fakeAuthReady || process.env.TZUDONG_LOCAL_BRIDGE_FAKE_AUTH_READY === '1') return true;
  const configured = options.authFile || process.env.CODEX_AUTH_FILE;
  const path = configured
    ? resolve(configured.replace(/^~/, homedir()))
    : resolve(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  return existsSync(path);
}

function getStoryboardLocalBridgeConcurrency(sceneCount: number) {
  const parsed = Number(process.env.TZUDONG_LOCAL_BRIDGE_STORYBOARD_CONCURRENCY);
  const configured = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : STORYBOARD_LOCAL_BRIDGE_DEFAULT_CONCURRENCY;
  return Math.max(
    1,
    Math.min(sceneCount, STORYBOARD_LOCAL_BRIDGE_MAX_SCENES, configured),
  );
}

async function mapLocalBridgeItemsWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let failure: unknown;
  async function runWorker() {
    while (nextIndex < items.length && !failure) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      try {
        results[index] = await mapper(item, index);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker(),
    ),
  );
  if (failure) throw failure;
  return results;
}

async function handleImages(
  payloadValue: unknown,
  options: StoryboardLocalBridgeServerOptions,
  signal?: AbortSignal,
): Promise<StoryboardLocalBridgeImagesResponse> {
  const payload = assertImagesPayload(payloadValue);
  const images = await withPrivateLocalBridgeRunDirectory(options, (runDir, budget) => (
    mapLocalBridgeItemsWithConcurrency(
      payload.scenes,
      getStoryboardLocalBridgeConcurrency(payload.scenes.length),
      (scene) => generateImageForScene(scene, payload, options, runDir, budget, signal),
    )
  ));
  return {
    ok: true,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    images,
  };
}

async function handleThumbnailImages(
  payloadValue: unknown,
  options: StoryboardLocalBridgeServerOptions,
  signal?: AbortSignal,
): Promise<ThumbnailLocalBridgeImagesResponse> {
  const payload = assertThumbnailImagesPayload(payloadValue);
  const result = await withPrivateLocalBridgeRunDirectory(
    options,
    (runDir, budget) => generateThumbnailForLocalBridge(payload, options, runDir, budget, signal),
  );
  return {
    ok: true,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    result,
  };
}

export function createStoryboardLocalBridgeServer(options: StoryboardLocalBridgeServerOptions = {}) {
  const token = options.token || process.env.TZUDONG_LOCAL_BRIDGE_TOKEN || generatedToken();
  const allowedOrigins = parseAllowedOrigins(process.env.TZUDONG_LOCAL_BRIDGE_ALLOWED_ORIGINS, options.allowedOrigins);
  const sessions = new Map<string, LocalBridgeSession>();
  const server = createServer(async (request, response) => {
    let origin: string | undefined;
    const abortController = new AbortController();
    const abortRequest = () => abortController.abort();
    const abortDisconnectedResponse = () => {
      if (!response.writableEnded) abortController.abort();
    };
    request.once('aborted', abortRequest);
    request.socket.once('close', abortRequest);
    request.socket.once('end', abortRequest);
    response.once('close', abortDisconnectedResponse);
    const disconnectMonitor = setInterval(() => {
      if (!response.writableEnded && (request.socket.destroyed || response.destroyed)) {
        abortController.abort();
      }
    }, 50);
    disconnectMonitor.unref();
    try {
      const bridgeOrigin = getBoundLoopbackOrigin(request);
      const url = parseBridgeRequestUrl(request);
      if (request.method === 'GET' && url.pathname === LOCAL_BRIDGE_HELPER_ROUTE) {
        const context = createLocalBridgeHelperSession(url, bridgeOrigin, allowedOrigins, sessions);
        respondHtml(response, 200, buildLocalBridgeHelperHtml(context));
        return;
      }
      if (url.search) {
        throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
      }
      const knownRoute = (
        url.pathname === '/health' ||
        url.pathname === LOCAL_BRIDGE_AUTH_STATUS_PATH ||
        url.pathname === STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH ||
        url.pathname === THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH
      );
      if (request.method === 'OPTIONS') {
        if (!knownRoute) throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
        origin = assertAllowedOrigin(request, response, bridgeOrigin, allowedOrigins);
        response.statusCode = 204;
        response.end();
        return;
      }
      const allowsMissingOriginGet = (
        request.method === 'GET' &&
        !getRequestOrigin(request) &&
        url.pathname === '/health'
      );
      if (!allowsMissingOriginGet) {
        origin = assertAllowedOrigin(request, response, bridgeOrigin, allowedOrigins);
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        respondJson(response, 200, {
          ok: true,
          bridge: 'tzudong-storyboard-local-bridge',
          version: 1,
          status: 'ok',
          tokenRequired: true,
          providerId: STORYBOARD_IMAGE_PROVIDER_ID,
          model: STORYBOARD_IMAGE_PROVIDER_MODEL,
          endpoints: {
            helper: LOCAL_BRIDGE_HELPER_ROUTE,
            storyboardImages: STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH,
            thumbnailImages: THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH,
          },
        }, origin, request);
        return;
      }
      if (request.method === 'GET' && url.pathname === LOCAL_BRIDGE_AUTH_STATUS_PATH) {
        try {
          assertPaired(request, token);
        } catch {
          respondJson(response, 401, {
            ok: false,
            bridge: 'tzudong-storyboard-local-bridge',
            status: 'unpaired',
            providerId: STORYBOARD_IMAGE_PROVIDER_ID,
            model: STORYBOARD_IMAGE_PROVIDER_MODEL,
          }, origin, request);
          return;
        }
        assertLocalBridgeHelperSession(request, bridgeOrigin, url.pathname, sessions);
        const ready = authFileExists(options);
        respondJson(response, ready ? 200 : 401, {
          ok: ready,
          bridge: 'tzudong-storyboard-local-bridge',
          status: ready ? 'ready' : 'auth_required',
          providerId: STORYBOARD_IMAGE_PROVIDER_ID,
          model: STORYBOARD_IMAGE_PROVIDER_MODEL,
          detail: ready ? undefined : 'Run codex login locally, then restart the bridge.',
        }, origin, request);
        return;
      }
      if (request.method === 'POST' && url.pathname === STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH) {
        assertPaired(request, token);
        assertLocalBridgeHelperSession(request, bridgeOrigin, url.pathname, sessions);
        const body = await readJsonBody(request);
        const payload = await handleImages(body, options, abortController.signal);
        respondJson(response, 200, payload, origin, request);
        return;
      }
      if (request.method === 'POST' && url.pathname === THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH) {
        assertPaired(request, token);
        assertLocalBridgeHelperSession(request, bridgeOrigin, url.pathname, sessions);
        const body = await readJsonBody(request, THUMBNAIL_LOCAL_BRIDGE_MAX_BODY_BYTES);
        const payload = await handleThumbnailImages(body, options, abortController.signal);
        respondJson(response, 200, payload, origin, request);
        return;
      }
      if (knownRoute || url.pathname === LOCAL_BRIDGE_HELPER_ROUTE) {
        throw new LocalBridgeHttpError('method_not_allowed', 'Method is not allowed.', 405);
      }
      throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
    } catch (error) {
      if (!response.destroyed) {
        const status = error instanceof LocalBridgeHttpError ? error.status : 500;
        const code = error instanceof LocalBridgeHttpError ? error.code : 'provider_execution_failed';
        const message = error instanceof LocalBridgeHttpError
          ? redactStoryboardLocalBridgeSecretText(error.message, token)
          : 'Local bridge request failed.';
        respondJson(response, status, { ok: false, error: code, detail: message }, origin, request);
      }
    } finally {
      clearInterval(disconnectMonitor);
      request.removeListener('aborted', abortRequest);
      request.socket.removeListener('close', abortRequest);
      request.socket.removeListener('end', abortRequest);
      response.removeListener('close', abortDisconnectedResponse);
    }
  });
  return { server, token, allowedOrigins };
}

export async function startStoryboardLocalBridgeServer(options: StoryboardLocalBridgeServerOptions = {}) {
  const host = options.host || process.env.TZUDONG_LOCAL_BRIDGE_HOST || '127.0.0.1';
  const port = options.port ?? (Number(process.env.TZUDONG_LOCAL_BRIDGE_PORT) || DEFAULT_PORT);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Refusing to bind local bridge to a non-loopback host.');
  }
  const bridge = createStoryboardLocalBridgeServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    bridge.server.once('error', rejectListen);
    bridge.server.listen(port, host, () => resolveListen());
  });
  const log = options.log || console.log;
  log('code=storyboard_local_bridge_ready');
  return bridge;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startStoryboardLocalBridgeServer().catch((error) => {
    console.error(`storyboard_local_bridge_failed error=${getAdminSafeErrorName(error)} code=local_bridge_start_failed`);
    process.exitCode = 1;
  });
}
