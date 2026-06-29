import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type {
  ThumbnailBriefPreset,
  ThumbnailChatAgentRequest,
  ThumbnailGeneratorPayload,
  ThumbnailGenerationMode,
  ThumbnailReferenceImage,
  ThumbnailReferenceRole,
  ThumbnailTextLayer,
} from './types';
import {
  ThumbnailGenerationError,
  THUMBNAIL_BRIEF_PRESETS,
  THUMBNAIL_GENERATION_MODES,
  THUMBNAIL_PROVIDER_IDS,
  THUMBNAIL_REFERENCE_ROLES,
} from './types';

export const THUMBNAIL_MAX_TOTAL_BYTES = 33_554_432;
export const THUMBNAIL_MAX_FILE_BYTES = 8_388_608;
export const THUMBNAIL_MAX_FILES = 8;
export const THUMBNAIL_REMOTE_IMAGE_TIMEOUT_MS = 10_000;
export const THUMBNAIL_CHAT_MESSAGE_MAX_LENGTH = 1_000;
export const THUMBNAIL_CHAT_CONTEXT_MAX_LENGTH = 280;
export const THUMBNAIL_CHAT_TEXT_MAX_LENGTH = 80;
export const THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD = 'thumbnailSessionOpenaiApiKey';
export const THUMBNAIL_SESSION_GEMINI_API_KEY_FIELD = 'thumbnailSessionGeminiApiKey';
export const THUMBNAIL_SESSION_API_KEY_MAX_LENGTH = 512;
const THUMBNAIL_CHAT_RUN_ID_MAX_LENGTH = 120;
const THUMBNAIL_CHAT_LAYER_ID_MAX_LENGTH = 40;
const THUMBNAIL_CHAT_ACTION_MAX_LENGTH = 80;
const THUMBNAIL_CHAT_RUN_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const THUMBNAIL_CHAT_THREAD_ID_MAX_LENGTH = 120;
const THUMBNAIL_CHAT_CONVERSATION_CONTEXT_LIMIT = 8;
const THUMBNAIL_CHAT_CONVERSATION_CONTENT_MAX_LENGTH = 280;
const THUMBNAIL_CHAT_CONVERSATION_ID_MAX_LENGTH = 120;
const THUMBNAIL_CHAT_FOCUS_LABEL_MAX_LENGTH = 80;
const THUMBNAIL_CHAT_FOCUS_DETAIL_MAX_LENGTH = 180;
const THUMBNAIL_CHAT_FOCUS_PROMPT_MAX_LENGTH = 260;
const THUMBNAIL_CHAT_ATTACHMENT_ID_MAX_LENGTH = 120;
const THUMBNAIL_CHAT_ATTACHMENT_NAME_MAX_LENGTH = 120;
const THUMBNAIL_CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const THUMBNAIL_SESSION_OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;
const THUMBNAIL_SESSION_API_KEY_FORBIDDEN_CHARS_PATTERN = /[\s\u0000-\u001F\u007F]/;

type RemoteImageFetchDeps = {
  fetch?: typeof fetch;
  lookup?: typeof lookup;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stripThumbnailControlChars(value: string) {
  return value.replace(THUMBNAIL_CONTROL_CHARS_PATTERN, '');
}

function toStringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' ? stripThumbnailControlChars(value).trim().slice(0, maxLength) : '';
}
function isThumbnailProviderId(value: unknown): value is ThumbnailGeneratorPayload['providerId'] {
  return typeof value === 'string' && (THUMBNAIL_PROVIDER_IDS as readonly string[]).includes(value);
}

export function buildThumbnailProviderRequestEnv(
  baseEnv: NodeJS.ProcessEnv,
  providerId: ThumbnailGeneratorPayload['providerId'],
  formData: FormData,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  if (providerId !== 'openai-gpt-image-2') return env;

  const openaiApiKey = normalizeThumbnailSessionOpenAIApiKey(
    formData.get(THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD),
  );
  if (openaiApiKey) {
    env.OPENAI_API_KEY = openaiApiKey;
    env.THUMBNAIL_OPENAI_IMAGE_MODEL = 'gpt-image-2';
  }
  return env;
}

export function normalizeThumbnailSessionOpenAIApiKey(value: FormDataEntryValue | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ThumbnailGenerationError('invalid_session_api_key', 'OpenAI API 키는 문자열로만 입력할 수 있습니다.', 400);
  }

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.length > THUMBNAIL_SESSION_API_KEY_MAX_LENGTH ||
    THUMBNAIL_SESSION_API_KEY_FORBIDDEN_CHARS_PATTERN.test(trimmed) ||
    !THUMBNAIL_SESSION_OPENAI_API_KEY_PATTERN.test(trimmed)
  ) {
    throw new ThumbnailGenerationError(
      'invalid_session_api_key',
      'OpenAI API 키 형식이 올바르지 않습니다. sk-로 시작하는 키를 입력해 주세요.',
      400,
    );
  }

  return trimmed;
}

function isThumbnailBriefPreset(value: unknown): value is ThumbnailBriefPreset {
  return typeof value === 'string' && (THUMBNAIL_BRIEF_PRESETS as readonly string[]).includes(value);
}

function isThumbnailReferenceRole(value: unknown): value is ThumbnailReferenceRole {
  return typeof value === 'string' && (THUMBNAIL_REFERENCE_ROLES as readonly string[]).includes(value);
}

function isThumbnailGenerationMode(value: unknown): value is ThumbnailGenerationMode {
  return typeof value === 'string' && (THUMBNAIL_GENERATION_MODES as readonly string[]).includes(value);
}

function parseGenerationMode(value: unknown): ThumbnailGenerationMode {
  if (isThumbnailGenerationMode(value)) return value;
  throw new ThumbnailGenerationError(
    'invalid_generation_mode',
    `generationMode는 ${THUMBNAIL_GENERATION_MODES.join(', ')} 중 하나여야 합니다.`,
    400,
  );
}

function parseOptionalChatString(value: unknown, fieldName: string, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ThumbnailGenerationError('thumbnail_chat_payload_invalid', `${fieldName}는 문자열이어야 합니다.`, 400);
  }
  const trimmed = stripThumbnailControlChars(value).trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parseThumbnailChatThreadId(value: unknown) {
  const raw = parseOptionalChatString(value, 'chatThreadId', THUMBNAIL_CHAT_THREAD_ID_MAX_LENGTH);
  if (!raw) return undefined;
  const safe = raw.replace(/[^\w:.-]/g, '').slice(0, THUMBNAIL_CHAT_THREAD_ID_MAX_LENGTH);
  return safe || undefined;
}

function isThumbnailChatReadbackMessage(message: { role: 'user' | 'assistant'; content: string; id?: string }) {
  if (message.role === 'user') return false;
  const normalized = message.content.replace(/\s+/g, ' ').trim();
  return (
    message.id?.startsWith('assistant-intro') ||
    message.id?.startsWith('assistant-history-load') ||
    normalized.startsWith('원하는 썸네일을 말로 적어 주세요') ||
    normalized.startsWith('간단히 3가지만 적어 주세요') ||
    normalized.startsWith('현재 상태를 쉽게 정리했어요') ||
    normalized.startsWith('생성 히스토리를 이 페이지 안에서 열었습니다') ||
    normalized.startsWith('히스토리 결과 불러오기') ||
    normalized.startsWith('현재 캔버스를 PNG로 저장했습니다') ||
    normalized.startsWith('참고 이미지 파일 선택창을 열었습니다') ||
    normalized.startsWith('참고 이미지를 모두 비웠습니다') ||
    normalized.includes('실제 생성 결과를 캔버스에 반영했습니다') ||
    normalized.includes('공용 릴리즈') ||
    normalized.includes('릴리즈 후보')
  );
}

function parseThumbnailChatConversationMessages(value: unknown): ThumbnailChatAgentRequest['conversationMessages'] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): NonNullable<ThumbnailChatAgentRequest['conversationMessages']> => {
      if (!isRecord(item)) return [];
      const role = item.role === 'user' || item.role === 'assistant' ? item.role : null;
      const content = toStringValue(item.content, THUMBNAIL_CHAT_CONVERSATION_CONTENT_MAX_LENGTH);
      if (!role || !content) return [];
      const id = toStringValue(item.id, THUMBNAIL_CHAT_CONVERSATION_ID_MAX_LENGTH);
      const createdAt = toStringValue(item.createdAt, 80);
      const message = {
        role,
        content,
        ...(id ? { id } : {}),
        ...(createdAt ? { createdAt } : {}),
      };
      return isThumbnailChatReadbackMessage(message) ? [] : [message];
    })
    .slice(-THUMBNAIL_CHAT_CONVERSATION_CONTEXT_LIMIT);
}

function parseThumbnailChatFocusContext(value: unknown): ThumbnailChatAgentRequest['focusContext'] {
  if (!isRecord(value)) return null;
  const kind = value.kind === 'text-layer' || value.kind === 'canvas' ? value.kind : null;
  const label = toStringValue(value.label, THUMBNAIL_CHAT_FOCUS_LABEL_MAX_LENGTH);
  const promptContext = toStringValue(value.promptContext, THUMBNAIL_CHAT_FOCUS_PROMPT_MAX_LENGTH);
  if (!kind || !label || !promptContext) return null;
  const role = value.role === 'headline' || value.role === 'subHeadline' || value.role === 'custom'
    ? value.role
    : undefined;
  const layerId = toStringValue(value.layerId, THUMBNAIL_CHAT_LAYER_ID_MAX_LENGTH);
  const detail = toStringValue(value.detail, THUMBNAIL_CHAT_FOCUS_DETAIL_MAX_LENGTH);
  const createdAt = toStringValue(value.createdAt, 80);
  return {
    kind,
    label,
    promptContext,
    ...(layerId ? { layerId } : {}),
    ...(role ? { role } : {}),
    ...(detail ? { detail } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function parseThumbnailChatReferenceImageAttachments(value: unknown): ThumbnailChatAgentRequest['referenceImageAttachments'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, THUMBNAIL_MAX_FILES).flatMap((item): NonNullable<ThumbnailChatAgentRequest['referenceImageAttachments']> => {
    if (!isRecord(item)) return [];
    const name = toStringValue(item.name, THUMBNAIL_CHAT_ATTACHMENT_NAME_MAX_LENGTH);
    if (!name) return [];
    const id = toStringValue(item.id, THUMBNAIL_CHAT_ATTACHMENT_ID_MAX_LENGTH);
    const mime = item.mime === 'image/png' || item.mime === 'image/jpeg' || item.mime === 'image/webp'
      ? item.mime
      : undefined;
    const role = isThumbnailReferenceRole(item.role) ? item.role : undefined;
    const size = Number(item.size);
    const width = Number(item.width);
    const height = Number(item.height);
    return [{
      ...(id ? { id } : {}),
      name,
      ...(mime ? { mime } : {}),
      ...(Number.isFinite(size) && size >= 0 ? { size: Math.min(size, THUMBNAIL_MAX_FILE_BYTES) } : {}),
      ...(role ? { role } : {}),
      ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : {}),
    }];
  });
}

export function parseThumbnailChatAgentRequest(value: unknown): ThumbnailChatAgentRequest {
  if (!isRecord(value)) {
    throw new ThumbnailGenerationError('thumbnail_chat_payload_invalid', '채팅 요청 JSON이 필요합니다.', 400);
  }
  if (typeof value.message !== 'string') {
    throw new ThumbnailGenerationError('thumbnail_chat_message_required', '채팅 메시지를 입력하세요.', 400);
  }

  const message = stripThumbnailControlChars(value.message).trim();
  if (!message) {
    throw new ThumbnailGenerationError('thumbnail_chat_message_required', '채팅 메시지를 입력하세요.', 400);
  }
  if (message.length > THUMBNAIL_CHAT_MESSAGE_MAX_LENGTH) {
    throw new ThumbnailGenerationError(
      'thumbnail_chat_message_too_long',
      `채팅 메시지는 ${THUMBNAIL_CHAT_MESSAGE_MAX_LENGTH}자 이하여야 합니다.`,
      400,
    );
  }

  let providerId: ThumbnailChatAgentRequest['providerId'];
  if (value.providerId !== undefined && value.providerId !== null) {
    const candidate = toStringValue(value.providerId, 80);
    if (!isThumbnailProviderId(candidate)) {
      throw new ThumbnailGenerationError(
        'thumbnail_chat_payload_invalid',
        `providerId는 ${THUMBNAIL_PROVIDER_IDS.join(', ')} 중 하나여야 합니다.`,
        400,
      );
    }
    providerId = candidate;
  }

  let generationMode: ThumbnailChatAgentRequest['generationMode'];
  if (value.generationMode !== undefined && value.generationMode !== null) {
    const candidate = toStringValue(value.generationMode, 40);
    if (!isThumbnailGenerationMode(candidate)) {
      throw new ThumbnailGenerationError(
        'thumbnail_chat_payload_invalid',
        `generationMode는 ${THUMBNAIL_GENERATION_MODES.join(', ')} 중 하나여야 합니다.`,
        400,
      );
    }
    generationMode = candidate;
  }

  const chatRunId = parseOptionalChatString(value.chatRunId, 'chatRunId', THUMBNAIL_CHAT_RUN_ID_MAX_LENGTH);
  if (chatRunId && !THUMBNAIL_CHAT_RUN_ID_PATTERN.test(chatRunId)) {
    throw new ThumbnailGenerationError(
      'thumbnail_chat_payload_invalid',
      'chatRunId는 영문, 숫자, 점, 콜론, 하이픈, 밑줄만 사용할 수 있습니다.',
      400,
    );
  }

  return {
    chatRunId,
    chatThreadId: parseThumbnailChatThreadId(value.chatThreadId),
    message,
    currentTopic: parseOptionalChatString(value.currentTopic, 'currentTopic', THUMBNAIL_CHAT_CONTEXT_MAX_LENGTH),
    currentHeadline: parseOptionalChatString(value.currentHeadline, 'currentHeadline', THUMBNAIL_CHAT_TEXT_MAX_LENGTH),
    currentSubHeadline: parseOptionalChatString(value.currentSubHeadline, 'currentSubHeadline', THUMBNAIL_CHAT_TEXT_MAX_LENGTH),
    activeLayerId: parseOptionalChatString(value.activeLayerId, 'activeLayerId', THUMBNAIL_CHAT_LAYER_ID_MAX_LENGTH),
    editingLayerId: parseOptionalChatString(value.editingLayerId, 'editingLayerId', THUMBNAIL_CHAT_LAYER_ID_MAX_LENGTH),
    lastCanvasActionLabel: parseOptionalChatString(value.lastCanvasActionLabel, 'lastCanvasActionLabel', THUMBNAIL_CHAT_ACTION_MAX_LENGTH),
    currentTextLayers: parseTextLayers(value.currentTextLayers),
    conversationMessages: parseThumbnailChatConversationMessages(value.conversationMessages),
    focusContext: parseThumbnailChatFocusContext(value.focusContext),
    referenceImageAttachments: parseThumbnailChatReferenceImageAttachments(value.referenceImageAttachments),
    providerId,
    generationMode,
  };
}

function parseStylePreset(value: unknown): ThumbnailBriefPreset {
  return isThumbnailBriefPreset(value) ? value : 'tzuyang-food-travel-collage';
}

function parseReferenceImageRoles(value: unknown): ThumbnailReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, THUMBNAIL_MAX_FILES)
    .map((role) => (isThumbnailReferenceRole(role) ? role : 'other'));
}

function parseTextLayers(value: unknown): ThumbnailTextLayer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const align: ThumbnailTextLayer['align'] = item.align === 'left' || item.align === 'right' ? item.align : 'center';
    return [{
      id: toStringValue(item.id, 40) || `layer-${index + 1}`,
      content: toStringValue(item.content, 80),
      x: Number.isFinite(Number(item.x)) ? Number(item.x) : 96,
      y: Number.isFinite(Number(item.y)) ? Number(item.y) : 520,
      fontFamily: toStringValue(item.fontFamily, 80) || 'system-ui',
      fontSize: Math.max(18, Math.min(140, Math.round(Number(item.fontSize) || 72))),
      fontWeight: Math.max(300, Math.min(950, Math.round(Number(item.fontWeight) || 900))),
      fill: toStringValue(item.fill, 32) || '#ffffff',
      stroke: toStringValue(item.stroke, 32) || '#111111',
      strokeWidth: Math.max(0, Math.min(20, Number(item.strokeWidth) || 8)),
      shadow: toStringValue(item.shadow, 120) || '0 8px 18px rgba(0,0,0,0.6)',
      align,
      rotation: Math.max(-20, Math.min(20, Number(item.rotation) || 0)),
      zIndex: Math.max(0, Math.min(99, Math.round(Number(item.zIndex) || index))),
    }];
  }).filter((layer) => layer.content);
}

export function parseThumbnailPayload(value: unknown): ThumbnailGeneratorPayload {
  if (!isRecord(value)) throw new ThumbnailGenerationError('invalid_text', 'payload JSON이 필요합니다.', 400);
  const providerId = toStringValue(value.providerId, 80);
  if (!isThumbnailProviderId(providerId)) {
    throw new ThumbnailGenerationError('provider_unavailable', `providerId는 ${THUMBNAIL_PROVIDER_IDS.join(', ')} 중 하나여야 합니다.`, 400);
  }
  const topic = toStringValue(value.topic, 280);
  const headline = toStringValue(value.headline, 80);
  if (!topic || !headline) throw new ThumbnailGenerationError('invalid_text', '주제와 헤드라인을 입력하세요.', 400);
  return {
    providerId,
    generationMode: parseGenerationMode(value.generationMode),
    topic,
    headline,
    subHeadline: toStringValue(value.subHeadline, 80) || undefined,
    stylePreset: parseStylePreset(value.stylePreset),
    referenceImageRoles: parseReferenceImageRoles(value.referenceImageRoles),
    acknowledgedSafety: value.acknowledgedSafety === true,
    textLayers: parseTextLayers(value.textLayers),
  };
}

export function getContentLengthRejection(headers: Headers) {
  const raw = headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return { status: 400, error: 'content_length_invalid' };
  if (parsed > THUMBNAIL_MAX_TOTAL_BYTES) return { status: 413, error: 'content_length_too_large' };
  return null;
}

export function getMultipartContentTypeRejection(headers: Headers) {
  const contentType = headers.get('content-type') ?? '';
  return contentType.toLowerCase().startsWith('multipart/form-data')
    ? null
    : { status: 415, error: 'multipart_form_data_required' };
}

export function detectImageMime(bytes: Uint8Array): ThumbnailReferenceImage['mime'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

function isBlockedIPv4(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIPv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mappedIPv4 = normalized.slice('::ffff:'.length);
    if (isIP(mappedIPv4) === 4) return isBlockedIPv4(mappedIPv4);
  }

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;
}

function getSafeRemoteFileName(url: URL, mime: ThumbnailReferenceImage['mime']) {
  const rawName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'reference-image')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '');
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const baseName = rawName || 'reference-image';
  return /\.(png|jpe?g|webp)$/i.test(baseName) ? baseName : `${baseName}.${extension}`;
}

export function parseThumbnailReferenceImageUrl(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2_048) {
    throw new ThumbnailGenerationError('invalid_text', '참고 이미지 URL을 입력하세요.', 400);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ThumbnailGenerationError('invalid_text', '참고 이미지 URL 형식이 올바르지 않습니다.', 400);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ThumbnailGenerationError('invalid_text', 'HTTP/HTTPS 이미지 URL만 사용할 수 있습니다.', 400);
  }
  if (url.username || url.password) {
    throw new ThumbnailGenerationError('invalid_text', '인증 정보가 포함된 URL은 사용할 수 없습니다.', 400);
  }
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new ThumbnailGenerationError('invalid_text', '로컬 주소는 참고 이미지 URL로 사용할 수 없습니다.', 400);
  }

  return url;
}

async function assertPublicRemoteImageHost(url: URL, deps: RemoteImageFetchDeps = {}) {
  if (isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) {
      throw new ThumbnailGenerationError('invalid_text', '사설망/로컬 주소는 참고 이미지 URL로 사용할 수 없습니다.', 400);
    }
    return;
  }

  const lookupFn = deps.lookup ?? lookup;
  const addresses = await lookupFn(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new ThumbnailGenerationError('invalid_text', '사설망/로컬 주소는 참고 이미지 URL로 사용할 수 없습니다.', 400);
  }
}

async function readLimitedRemoteImageBytes(response: Response) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > THUMBNAIL_MAX_FILE_BYTES) {
      throw new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', 413);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > THUMBNAIL_MAX_FILE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchThumbnailReferenceImageFromUrl(value: unknown, deps: RemoteImageFetchDeps = {}) {
  const url = parseThumbnailReferenceImageUrl(value);
  await assertPublicRemoteImageHost(url, deps);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THUMBNAIL_REMOTE_IMAGE_TIMEOUT_MS);
  try {
    const fetchFn = deps.fetch ?? fetch;
    const response = await fetchFn(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'image/png,image/jpeg,image/webp' },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new ThumbnailGenerationError('invalid_text', '리다이렉트되는 이미지 URL은 사용할 수 없습니다.', 400);
    }
    if (!response.ok) {
      throw new ThumbnailGenerationError('invalid_text', `참고 이미지를 가져오지 못했습니다. HTTP ${response.status}`, 400);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > THUMBNAIL_MAX_FILE_BYTES) {
      throw new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', 413);
    }
    const declaredType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (declaredType && !['image/png', 'image/jpeg', 'image/webp'].includes(declaredType)) {
      throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지 URL만 사용할 수 있습니다.', 415);
    }

    const bytes = await readLimitedRemoteImageBytes(response);
    const mime = detectImageMime(bytes);
    if (!mime) throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지 URL만 사용할 수 있습니다.', 415);

    return {
      bytes,
      mime,
      fileName: getSafeRemoteFileName(url, mime),
    };
  } catch (error) {
    if (error instanceof ThumbnailGenerationError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ThumbnailGenerationError('invalid_text', '참고 이미지 URL 응답 시간이 초과되었습니다.', 408);
    }
    throw new ThumbnailGenerationError('invalid_text', '참고 이미지 URL을 가져오지 못했습니다.', 400);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readThumbnailReferenceImages(
  files: File[],
  roles: readonly ThumbnailReferenceRole[] = [],
): Promise<ThumbnailReferenceImage[]> {
  if (files.length > THUMBNAIL_MAX_FILES) throw new ThumbnailGenerationError('invalid_text', '참고 이미지는 최대 8개까지 업로드할 수 있습니다.', 400);
  let totalBytes = 0;
  const images: ThumbnailReferenceImage[] = [];
  for (const [index, file] of files.entries()) {
    if (file.size > THUMBNAIL_MAX_FILE_BYTES) throw new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', 413);
    totalBytes += file.size;
    if (totalBytes > THUMBNAIL_MAX_TOTAL_BYTES) throw new ThumbnailGenerationError('invalid_text', '이미지 총 용량은 32MiB를 넘을 수 없습니다.', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지만 업로드할 수 있습니다.', 415);
    images.push({ name: `reference-${index + 1}`, mime, bytes, role: roles[index] ?? 'other' });
  }
  return images;
}
