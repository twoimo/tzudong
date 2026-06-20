import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
import type {
  LocalBridgeHelperSurface,
} from '../local-bridge/core-contract.ts';
import type {
  StoryboardGeneratedImageProvenance,
  StoryboardGenerateRequest,
  StoryboardScene,
  StoryboardSceneGeneratedImage,
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
const STORYBOARD_LOCAL_BRIDGE_MAX_SCENES = 4 as const;
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

type BridgeErrorCode =
  | 'not_found'
  | 'origin_forbidden'
  | 'unpaired'
  | 'invalid_content_type'
  | 'invalid_payload'
  | 'provider_execution_failed'
  | 'auth_required'
  | 'method_not_allowed';

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

type ThumbnailLocalBridgeImagesRequest = {
  payload: ThumbnailGeneratorPayload;
  referenceImages: ThumbnailLocalBridgeReferenceImage[];
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

function requestOriginCandidates(request: IncomingMessage) {
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return new Set<string>();
  let url: URL;
  try {
    url = new URL(`http://${hostHeader}`);
  } catch {
    return new Set<string>();
  }
  const port = url.port || '80';
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
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Tzudong-Local-Bridge');
  response.setHeader('Access-Control-Max-Age', '600');
  if (request.headers['access-control-request-private-network'] === 'true') {
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function isAllowedOrigin(origin: string, request: IncomingMessage, allowedOrigins: Set<string>) {
  return allowedOrigins.has(origin) || requestOriginCandidates(request).has(origin);
}

function assertAllowedOrigin(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>) {
  const origin = getRequestOrigin(request);
  if (!origin || !isAllowedOrigin(origin, request, allowedOrigins)) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Origin is not allowed for this local bridge.', 403);
  }
  applyCors(response, origin, request);
  return origin;
}

function bearerToken(request: IncomingMessage) {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
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
  response.end(html);
}

type LocalBridgeHelperRouteContext = {
  openerOrigin: string;
  sessionId: string;
  surface: LocalBridgeHelperSurface;
};

function serializeInlineScriptValue(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function parseHelperRouteContext(url: URL, allowedOrigins: Set<string>): LocalBridgeHelperRouteContext {
  const openerOrigin = url.searchParams.get(LOCAL_BRIDGE_HELPER_ORIGIN_QUERY_PARAM)?.trim();
  if (!openerOrigin || !allowedOrigins.has(openerOrigin)) {
    throw new LocalBridgeHttpError('origin_forbidden', 'Helper opener origin is not allowed.', 403);
  }
  const sessionId = url.searchParams.get(LOCAL_BRIDGE_HELPER_SESSION_QUERY_PARAM)?.trim();
  if (!sessionId || !/^[A-Za-z0-9._-]{1,120}$/.test(sessionId)) {
    throw new LocalBridgeHttpError('invalid_payload', 'Helper session query is invalid.', 400);
  }
  const surfaceValue = url.searchParams.get(LOCAL_BRIDGE_HELPER_SURFACE_QUERY_PARAM);
  if (surfaceValue !== 'storyboard' && surfaceValue !== 'thumbnail') {
    throw new LocalBridgeHttpError('invalid_payload', 'Helper surface query is invalid.', 400);
  }
  return {
    openerOrigin,
    sessionId,
    surface: surfaceValue,
  };
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

      function parseMessagePayload(payload) {
        const record = asRecord(payload);
        if (!record) return null;
        if (record.kind !== 'tzudong-local-bridge-helper-request') return null;
        if (record.sessionId !== HELPER_CONFIG.sessionId) return null;
        if (typeof record.requestId !== 'string' || !record.requestId) return null;
        if (!HELPER_COMMANDS.includes(record.command)) return null;
        if (typeof record.bridgeUrl !== 'string' || !record.bridgeUrl) return null;
        if (typeof record.token !== 'string' || !record.token.trim()) return null;
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

      async function fetchBridge(url, token, body) {
        const headers = { Accept: 'application/json' };
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
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      }

      async function handleStatusRequest(message) {
        try {
          const [healthResponse, authResponse] = await Promise.all([
            fetchBridge(message.bridgeUrl + HELPER_PATHS.health),
            fetchBridge(message.bridgeUrl + HELPER_PATHS.authStatus, message.token),
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
          const bridgeResponse = await fetchBridge(message.bridgeUrl + path, message.token, message.payload);
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

function assertImagesPayload(value: unknown): StoryboardLocalBridgeImagesRequest {
  if (!value || typeof value !== 'object') {
    throw new LocalBridgeHttpError('invalid_payload', 'Request body must be an object.', 400);
  }
  const payload = value as Partial<StoryboardLocalBridgeImagesRequest>;
  if (
    typeof payload.title !== 'string' ||
    typeof payload.logline !== 'string' ||
    !payload.request ||
    typeof payload.request !== 'object' ||
    !Array.isArray(payload.scenes) ||
    payload.scenes.length === 0 ||
    payload.scenes.length > STORYBOARD_LOCAL_BRIDGE_MAX_SCENES
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Invalid storyboard local bridge payload.', 400);
  }
  return {
    title: payload.title.slice(0, 140),
    logline: payload.logline.slice(0, 240),
    request: payload.request,
    scenes: payload.scenes,
    sourceResult: payload.sourceResult ?? null,
  } as StoryboardLocalBridgeImagesRequest;
}

function isThumbnailMime(value: unknown): value is ThumbnailReferenceImage['mime'] {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function isThumbnailReferenceRole(value: unknown): value is ThumbnailReferenceRole {
  return value === 'host' || value === 'food' || value === 'object' || value === 'person' || value === 'other';
}

function assertThumbnailImagesPayload(value: unknown): ThumbnailLocalBridgeImagesRequest {
  if (!value || typeof value !== 'object') {
    throw new LocalBridgeHttpError('invalid_payload', 'Request body must be an object.', 400);
  }
  const payload = value as Partial<ThumbnailLocalBridgeImagesRequest>;
  const generatorPayload = payload.payload as Partial<ThumbnailGeneratorPayload> | undefined;
  if (
    !generatorPayload ||
    typeof generatorPayload !== 'object' ||
    generatorPayload.providerId !== STORYBOARD_IMAGE_PROVIDER_ID ||
    typeof generatorPayload.topic !== 'string' ||
    typeof generatorPayload.headline !== 'string' ||
    generatorPayload.acknowledgedSafety !== true
  ) {
    throw new LocalBridgeHttpError('invalid_payload', 'Invalid thumbnail local bridge payload.', 400);
  }
  const referenceImages = Array.isArray(payload.referenceImages) ? payload.referenceImages : [];
  const normalizedReferences = referenceImages.slice(0, 8).map((image) => {
    if (
      !image ||
      typeof image.name !== 'string' ||
      !isThumbnailMime(image.mime) ||
      !isThumbnailReferenceRole(image.role) ||
      typeof image.dataBase64 !== 'string' ||
      image.dataBase64.length === 0
    ) {
      throw new LocalBridgeHttpError('invalid_payload', 'Invalid thumbnail reference image payload.', 400);
    }
    return {
      name: image.name.slice(0, 120),
      mime: image.mime,
      role: image.role,
      dataBase64: image.dataBase64,
    };
  });
  const normalizedPayload: ThumbnailGeneratorPayload = {
    ...generatorPayload,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    generationMode: 'direct_provider',
    topic: generatorPayload.topic.slice(0, 500),
    headline: generatorPayload.headline.slice(0, 120),
    subHeadline: typeof generatorPayload.subHeadline === 'string'
      ? generatorPayload.subHeadline.slice(0, 120)
      : undefined,
    referenceImageRoles: Array.isArray(generatorPayload.referenceImageRoles)
      ? generatorPayload.referenceImageRoles.filter(isThumbnailReferenceRole).slice(0, 8)
      : normalizedReferences.map((image) => image.role),
    acknowledgedSafety: true,
  };
  return {
    payload: normalizedPayload,
    referenceImages: normalizedReferences,
  };
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
    command: process.env.PYTHON || 'python3',
    args: [resolve(process.cwd(), DEFAULT_LOCAL_CODEX_SCRIPT)],
  };
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
    command: process.env.PYTHON || 'python3',
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

function runProviderCommand(input: Record<string, unknown>, options: StoryboardLocalBridgeServerOptions) {
  const { command, args } = resolveProviderCommand(options);
  const configuredTimeoutMs = Number(process.env.TZUDONG_LOCAL_BRIDGE_TIMEOUT_MS);
  const timeoutMs = options.commandTimeoutMs ?? (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : COMMAND_TIMEOUT_MS);
  return new Promise<ProviderResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENAI_API_KEY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectCommand(error);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new LocalBridgeHttpError('provider_execution_failed', 'Provider timed out.', 504));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new LocalBridgeHttpError('provider_execution_failed', 'Provider stdout exceeded limit.', 502));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new LocalBridgeHttpError('provider_execution_failed', 'Provider stderr exceeded limit.', 502));
      }
    });
    child.on('error', (error) => {
      fail(new LocalBridgeHttpError('provider_execution_failed', error.message, 502));
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);
      if (code !== 0) {
        let parsed: ProviderResult | null = null;
        try { parsed = stdout.trim() ? parseProviderStdout(stdout) : null; } catch { parsed = null; }
        fail(new LocalBridgeHttpError(
          'provider_execution_failed',
          parsed?.error || `Provider failed with exit ${code}: ${stderr.slice(0, 600)}`,
          502,
        ));
        return;
      }
      try {
        settled = true;
        resolveCommand(parseProviderStdout(stdout));
      } catch (error) {
        rejectCommand(error);
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
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

async function generateImageForScene(
  scene: StoryboardScene,
  payload: StoryboardLocalBridgeImagesRequest,
  options: StoryboardLocalBridgeServerOptions,
  runId: string,
): Promise<{ sceneNo: number; image: StoryboardSceneGeneratedImage }> {
  const prompt = buildLocalBridgeScenePrompt(scene, {
    title: payload.title,
    logline: payload.logline,
    request: payload.request,
  });
  const outputDir = defaultOutputDir(options);
  const outputPath = join(outputDir, runId, `cut-${String(scene.sceneNo).padStart(2, '0')}.png`);
  await fsPromises.mkdir(dirname(outputPath), { recursive: true });
  const result = await runProviderCommand({
    prompt,
    sceneNo: scene.sceneNo,
    outputPath,
    size: process.env.STORYBOARD_LOCAL_CODEX_IMAGE_SIZE || DEFAULT_SIZE,
    outputFormat: 'png',
    background: 'opaque',
    agentModel: process.env.CODEX_IMAGEGEN_AGENT_MODEL || 'gpt-5.5',
    reasoningEffort: process.env.CODEX_IMAGEGEN_AGENT_EFFORT || 'high',
    timeout: 300,
  }, options);
  if (!isProof(result, outputPath)) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Provider response did not satisfy exact gpt-image-2 provenance.', 502);
  }
  const imageBytes = await fsPromises.readFile(outputPath);
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
  referenceImages: ThumbnailLocalBridgeReferenceImage[],
): Promise<{ manifestPath: string; references: ThumbnailReferenceImage[] }> {
  const referencesDir = join(runDir, 'references');
  await fsPromises.mkdir(referencesDir, { recursive: true });
  const manifest: Array<{ path: string; name: string; mime: string; role: string }> = [];
  const references: ThumbnailReferenceImage[] = [];
  for (const [index, image] of referenceImages.entries()) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(image.dataBase64, 'base64');
    } catch {
      throw new LocalBridgeHttpError('invalid_payload', 'Reference image payload must be valid base64.', 400);
    }
    if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
      throw new LocalBridgeHttpError('invalid_payload', 'Reference image is empty or too large.', 400);
    }
    const path = join(referencesDir, `reference-${index + 1}-${image.role}.${extensionForThumbnailMime(image.mime)}`);
    await fsPromises.writeFile(path, bytes);
    manifest.push({ path, name: image.name, mime: image.mime, role: image.role });
    references.push({
      name: image.name,
      mime: image.mime,
      role: image.role,
      bytes,
    });
  }
  const manifestPath = join(runDir, 'references.json');
  await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifestPath, references };
}

function parseThumbnailProviderStdout(stdout: string): ProviderResult {
  return parseProviderStdout(stdout);
}

function runThumbnailProviderCommand(
  placeholders: Record<string, string>,
  options: StoryboardLocalBridgeServerOptions,
) {
  const { command, args } = resolveThumbnailProviderCommand(options, placeholders);
  const configuredTimeoutMs = Number(process.env.TZUDONG_LOCAL_BRIDGE_THUMBNAIL_TIMEOUT_MS);
  const timeoutMs = options.commandTimeoutMs ?? (Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : THUMBNAIL_COMMAND_TIMEOUT_MS);
  const repoRoot = resolveLocalBridgeRepoRoot();
  return new Promise<ProviderResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_IMAGEGEN_WORKDIR: repoRoot,
        OPENAI_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectCommand(error);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new LocalBridgeHttpError('provider_execution_failed', 'Thumbnail provider timed out.', 504));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new LocalBridgeHttpError('provider_execution_failed', 'Thumbnail provider stdout exceeded limit.', 502));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        fail(new LocalBridgeHttpError('provider_execution_failed', 'Thumbnail provider stderr exceeded limit.', 502));
      }
    });
    child.on('error', (error) => {
      fail(new LocalBridgeHttpError('provider_execution_failed', error.message, 502));
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);
      if (code !== 0) {
        let parsed: ProviderResult | null = null;
        try { parsed = stdout.trim() ? parseThumbnailProviderStdout(stdout) : null; } catch { parsed = null; }
        fail(new LocalBridgeHttpError(
          'provider_execution_failed',
          parsed?.error || `Thumbnail provider failed with exit ${code}: ${stderr.slice(0, 600)}`,
          502,
        ));
        return;
      }
      try {
        settled = true;
        resolveCommand(parseThumbnailProviderStdout(stdout));
      } catch (error) {
        rejectCommand(error);
      }
    });
  });
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
    typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt))
  );
}

async function generateThumbnailForLocalBridge(
  payload: ThumbnailLocalBridgeImagesRequest,
  options: StoryboardLocalBridgeServerOptions,
  runId: string,
): Promise<ThumbnailGenerationResult> {
  const outputRoot = defaultOutputDir(options);
  const runDir = join(outputRoot, runId, 'youtube-thumbnail');
  await fsPromises.mkdir(runDir, { recursive: true });
  const { manifestPath, references } = await writeThumbnailReferenceManifest(runDir, payload.referenceImages);
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
  await fsPromises.writeFile(promptFile, prompt, 'utf8');
  const result = await runThumbnailProviderCommand({
    promptFile,
    output: outputPath,
    outputJsonFile,
    referenceManifest: manifestPath,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
  }, options);
  if (!isThumbnailProof(result, outputPath)) {
    throw new LocalBridgeHttpError('provider_execution_failed', 'Thumbnail provider response did not satisfy exact gpt-image-2 provenance.', 502);
  }
  const imageBytes = await fsPromises.readFile(outputPath);
  return {
    baseImage: {
      dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
      mime: 'image/png',
      width: typeof result.width === 'number' ? result.width : undefined,
      height: typeof result.height === 'number' ? result.height : undefined,
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

async function handleImages(payloadValue: unknown, options: StoryboardLocalBridgeServerOptions): Promise<StoryboardLocalBridgeImagesResponse> {
  const payload = assertImagesPayload(payloadValue);
  const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const images = [];
  for (const scene of payload.scenes) {
    images.push(await generateImageForScene(scene, payload, options, runId));
  }
  return {
    ok: true,
    providerId: STORYBOARD_IMAGE_PROVIDER_ID,
    model: STORYBOARD_IMAGE_PROVIDER_MODEL,
    images,
  };
}

async function handleThumbnailImages(payloadValue: unknown, options: StoryboardLocalBridgeServerOptions): Promise<ThumbnailLocalBridgeImagesResponse> {
  const payload = assertThumbnailImagesPayload(payloadValue);
  const runId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const result = await generateThumbnailForLocalBridge(payload, options, runId);
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
  const server = createServer(async (request, response) => {
    let origin: string | undefined;
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === LOCAL_BRIDGE_HELPER_ROUTE) {
        const context = parseHelperRouteContext(url, allowedOrigins);
        respondHtml(response, 200, buildLocalBridgeHelperHtml(context));
        return;
      }
      const allowsMissingOriginGet =
        request.method === 'GET' &&
        !getRequestOrigin(request) &&
        (url.pathname === '/health' || url.pathname === LOCAL_BRIDGE_AUTH_STATUS_PATH);
      if (request.method === 'OPTIONS') {
        origin = assertAllowedOrigin(request, response, allowedOrigins);
        response.statusCode = 204;
        response.end();
        return;
      }
      if (!allowsMissingOriginGet) {
        origin = assertAllowedOrigin(request, response, allowedOrigins);
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
        const body = await readJsonBody(request);
        const payload = await handleImages(body, options);
        respondJson(response, 200, payload, origin, request);
        return;
      }
      if (request.method === 'POST' && url.pathname === THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH) {
        assertPaired(request, token);
        const body = await readJsonBody(request, THUMBNAIL_LOCAL_BRIDGE_MAX_BODY_BYTES);
        const payload = await handleThumbnailImages(body, options);
        respondJson(response, 200, payload, origin, request);
        return;
      }
      if (
        url.pathname === LOCAL_BRIDGE_HELPER_ROUTE ||
        url.pathname === '/health' ||
        url.pathname === LOCAL_BRIDGE_AUTH_STATUS_PATH ||
        url.pathname === STORYBOARD_LOCAL_BRIDGE_IMAGES_PATH ||
        url.pathname === THUMBNAIL_LOCAL_BRIDGE_IMAGES_PATH
      ) {
        throw new LocalBridgeHttpError('method_not_allowed', 'Method is not allowed.', 405);
      }
      throw new LocalBridgeHttpError('not_found', 'Route not found.', 404);
    } catch (error) {
      const status = error instanceof LocalBridgeHttpError ? error.status : 500;
      const code = error instanceof LocalBridgeHttpError ? error.code : 'provider_execution_failed';
      const message = redactStoryboardLocalBridgeSecretText(error instanceof Error ? error.message : 'Unknown bridge error', token);
      respondJson(response, status, { ok: false, error: code, detail: message }, origin, request);
    }
  });
  return { server, token, allowedOrigins };
}

export async function startStoryboardLocalBridgeServer(options: StoryboardLocalBridgeServerOptions = {}) {
  const host = options.host || process.env.TZUDONG_LOCAL_BRIDGE_HOST || '127.0.0.1';
  const port = options.port || Number(process.env.TZUDONG_LOCAL_BRIDGE_PORT) || DEFAULT_PORT;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.TZUDONG_LOCAL_BRIDGE_UNSAFE_HOST !== '1') {
    throw new Error('Refusing to bind local bridge to a non-loopback host. Set TZUDONG_LOCAL_BRIDGE_UNSAFE_HOST=1 only for controlled tests.');
  }
  const bridge = createStoryboardLocalBridgeServer(options);
  await new Promise<void>((resolveListen, rejectListen) => {
    bridge.server.once('error', rejectListen);
    bridge.server.listen(port, host, () => resolveListen());
  });
  const log = options.log || console.log;
  log('tzudong storyboard local bridge ready');
  log(`bridge_url=http://${host}:${port}`);
  log(`pairing_token=${bridge.token}`);
  log('copy the pairing token into the advanced storyboard settings; it is not returned by HTTP APIs.');
  return bridge;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startStoryboardLocalBridgeServer().catch((error) => {
    console.error(redactStoryboardLocalBridgeSecretText(error instanceof Error ? error.message : 'local bridge failed'));
    process.exitCode = 1;
  });
}
