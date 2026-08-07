import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

import { canonicalizeReceiptImage } from '@/lib/ocr/admin-receipt-image-security';

import type {
  ThumbnailBriefPreset,
  ThumbnailChatAgentRequest,
  ThumbnailChatConversationMessage,
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

const THUMBNAIL_REMOTE_IMAGE_ALLOWED_HOSTNAMES = ['i.ytimg.com', 'img.youtube.com'] as const;
export const THUMBNAIL_MAX_TOTAL_BYTES = 33_554_432;
export const THUMBNAIL_MAX_CANONICAL_TOTAL_BYTES = 16_777_216;
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
const THUMBNAIL_CHAT_FOCUS_LABEL_MAX_LENGTH = 80;
const THUMBNAIL_CHAT_FOCUS_DETAIL_MAX_LENGTH = 180;
const THUMBNAIL_CHAT_FOCUS_PROMPT_MAX_LENGTH = 260;
const THUMBNAIL_CHAT_ATTACHMENT_ID_MAX_LENGTH = 120;
const THUMBNAIL_CHAT_ATTACHMENT_NAME_MAX_LENGTH = 120;
const THUMBNAIL_CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const THUMBNAIL_SESSION_OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;
const THUMBNAIL_SESSION_API_KEY_FORBIDDEN_CHARS_PATTERN = /[\s\u0000-\u001F\u007F]/;

export type TrustedRemoteImageFetchDeps = {
  fetch?: typeof fetch;
  lookup?: typeof lookup;
};

type RemoteImageFetchDeps = TrustedRemoteImageFetchDeps;

export type TrustedRemoteImageFetchErrorCode =
  | 'remote_image_url_invalid'
  | 'remote_image_host_not_allowed'
  | 'remote_image_dns_unavailable'
  | 'remote_image_dns_unsafe'
  | 'remote_image_redirect'
  | 'remote_image_timeout'
  | 'remote_image_response_invalid'
  | 'remote_image_request_failed'
  | 'remote_image_too_large';

export class TrustedRemoteImageFetchError extends Error {
  constructor(
    public readonly code: TrustedRemoteImageFetchErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = 'TrustedRemoteImageFetchError';
  }
}

export type TrustedRemoteImageFetchOptions = {
  allowedHostnames: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  accept: string;
};

type TrustedRemoteImageResponse = {
  bytes: Uint8Array;
  contentType: string;
};
type TrustedRemoteImageAddress = {
  address: string;
  family: 4 | 6;
};
type TrustedRemoteImageDeadline = {
  expiresAt: number;
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

function parseThumbnailChatConversationMessages(value: unknown): ThumbnailChatAgentRequest['conversationMessages'] {
  if (!Array.isArray(value)) return [];

  const messages: ThumbnailChatConversationMessage[] = [];
  for (let index = value.length - 1; index >= 0 && messages.length < THUMBNAIL_CHAT_CONVERSATION_CONTEXT_LIMIT; index -= 1) {
    const item = value[index];
    if (!isRecord(item) || item.role !== 'user') continue;
    const content = toStringValue(item.content, THUMBNAIL_CHAT_CONVERSATION_CONTENT_MAX_LENGTH);
    if (!content) continue;
    messages.push({ role: 'user', content });
  }
  return messages.reverse();
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
  if (!raw) return { status: 411, error: 'content_length_required' };
  if (!/^\d+$/.test(raw)) return { status: 400, error: 'content_length_invalid' };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return { status: 400, error: 'content_length_invalid' };
  if (parsed > THUMBNAIL_MAX_TOTAL_BYTES) return { status: 413, error: 'content_length_too_large' };
  return null;
}
export function getMultipartFieldRejection(formData: FormData) {
  const allowedFields = new Set([
    'payload',
    'referenceImages',
    THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD,
  ]);
  let entryCount = 0;
  for (const [name] of formData.entries()) {
    entryCount += 1;
    if (entryCount > THUMBNAIL_MAX_FILES + 2 || !allowedFields.has(name)) {
      return { status: 400, error: 'multipart_fields_invalid' };
    }
  }
  const keyEntries = formData.getAll(THUMBNAIL_SESSION_OPENAI_API_KEY_FIELD);
  if (keyEntries.length > 1 || keyEntries.some((entry) => typeof entry !== 'string')) {
    return { status: 400, error: 'multipart_fields_invalid' };
  }
  const referenceEntries = formData.getAll('referenceImages');
  if (
    referenceEntries.length > THUMBNAIL_MAX_FILES
    || referenceEntries.some((entry) => !(entry instanceof File))
  ) {
    return { status: 400, error: 'multipart_fields_invalid' };
  }
  return null;
}

export function getMultipartContentTypeRejection(headers: Headers) {
  const contentType = headers.get('content-type') ?? '';
  return contentType.toLowerCase().startsWith('multipart/form-data')
    ? null
    : { status: 415, error: 'multipart_form_data_required' };
}

export function detectImageMime(bytes: Uint8Array): ThumbnailReferenceImage['mime'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

function hasCompletePngPayload(bytes: Uint8Array) {
  let offset = 8;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return false;
    const length = (
      (bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!
    ) >>> 0;
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;
    const isIend = (
      bytes[offset + 4] === 0x49 &&
      bytes[offset + 5] === 0x45 &&
      bytes[offset + 6] === 0x4e &&
      bytes[offset + 7] === 0x44
    );
    if (isIend) return length === 0 && chunkEnd === bytes.length;
    offset = chunkEnd;
  }
  return false;
}

function hasCompleteJpegPayload(bytes: Uint8Array) {
  let offset = 2;
  let inScan = false;

  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const markerStart = offset;
        offset += 1;
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset];
        if (marker === undefined) return false;
        offset += 1;
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9) return offset === bytes.length;
        offset = markerStart;
        inScan = false;
        break;
      }
      if (inScan) return false;
      continue;
    }

    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) return false;
    offset += 1;
    if (marker === 0xd9) return offset === bytes.length;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;

    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    offset += segmentLength;
    if (marker === 0xda) inScan = true;
  }

  return false;
}

function getWebpChunkName(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function hasValidWebpVp8Chunk(bytes: Uint8Array, offset: number, length: number) {
  return (
    length >= 10 &&
    (bytes[offset]! & 0x01) === 0 &&
    bytes[offset + 3] === 0x9d &&
    bytes[offset + 4] === 0x01 &&
    bytes[offset + 5] === 0x2a
  );
}

function hasValidWebpVp8lChunk(bytes: Uint8Array, offset: number, length: number) {
  return length >= 5 && bytes[offset] === 0x2f;
}

function hasCompleteWebpPayload(bytes: Uint8Array) {
  if (
    bytes.length < 20 ||
    bytes.length % 2 !== 0 ||
    getWebpChunkName(bytes, 0) !== 'RIFF' ||
    getWebpChunkName(bytes, 8) !== 'WEBP'
  ) return false;

  const riffLength = (
    bytes[4]! |
    (bytes[5]! << 8) |
    (bytes[6]! << 16) |
    (bytes[7]! << 24)
  ) >>> 0;
  if (riffLength < 4 || riffLength + 8 !== bytes.length) return false;

  let offset = 12;
  let chunkCount = 0;
  let hasVp8X = false;
  let vp8XFlags = 0;
  let imageChunk: 'VP8 ' | 'VP8L' | null = null;
  let hasIccp = false;
  let hasAlpha = false;
  let hasExif = false;
  let hasXmp = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) return false;
    const chunkName = getWebpChunkName(bytes, offset);
    const chunkLength = (
      bytes[offset + 4]! |
      (bytes[offset + 5]! << 8) |
      (bytes[offset + 6]! << 16) |
      (bytes[offset + 7]! << 24)
    ) >>> 0;
    const payloadOffset = offset + 8;
    if (chunkLength > bytes.length - payloadOffset) return false;
    const payloadEnd = payloadOffset + chunkLength;
    const paddedEnd = payloadEnd + (chunkLength % 2);
    if (paddedEnd > bytes.length) return false;
    offset = paddedEnd;
    chunkCount += 1;

    if (chunkName === 'ANIM' || chunkName === 'ANMF') return false;

    if (chunkName === 'VP8X') {
      if (hasVp8X || chunkCount !== 1 || chunkLength !== 10) return false;
      vp8XFlags = bytes[payloadOffset]!;
      if (
        (vp8XFlags & 0xc3) !== 0 ||
        bytes[payloadOffset + 1] !== 0 ||
        bytes[payloadOffset + 2] !== 0 ||
        bytes[payloadOffset + 3] !== 0
      ) return false;
      hasVp8X = true;
      continue;
    }

    if (chunkName === 'VP8 ' || chunkName === 'VP8L') {
      if (imageChunk || (!hasVp8X && chunkCount !== 1)) return false;
      if (chunkName === 'VP8 ' && !hasValidWebpVp8Chunk(bytes, payloadOffset, chunkLength)) return false;
      if (chunkName === 'VP8L' && !hasValidWebpVp8lChunk(bytes, payloadOffset, chunkLength)) return false;
      if (hasAlpha && chunkName !== 'VP8 ') return false;
      imageChunk = chunkName;
      continue;
    }

    if (chunkName === 'ICCP') {
      if (!hasVp8X || imageChunk || hasIccp || hasAlpha || chunkLength === 0) return false;
      hasIccp = true;
      continue;
    }

    if (chunkName === 'ALPH') {
      if (!hasVp8X || imageChunk || hasAlpha || chunkLength === 0) return false;
      hasAlpha = true;
      continue;
    }

    if (chunkName === 'EXIF') {
      if (!hasVp8X || !imageChunk || hasExif) return false;
      hasExif = true;
      continue;
    }

    if (chunkName === 'XMP ') {
      if (!hasVp8X || !imageChunk || hasXmp) return false;
      hasXmp = true;
      continue;
    }

    return false;
  }

  if (offset !== bytes.length || !imageChunk) return false;
  if (!hasVp8X) return chunkCount === 1;
  if (imageChunk === 'VP8 ' && Boolean(vp8XFlags & 0x10) !== hasAlpha) return false;
  return (
    Boolean(vp8XFlags & 0x20) === hasIccp &&
    Boolean(vp8XFlags & 0x08) === hasExif &&
    Boolean(vp8XFlags & 0x04) === hasXmp
  );
}

function hasCompleteImagePayload(bytes: Uint8Array, mime: ThumbnailReferenceImage['mime']) {
  switch (mime) {
    case 'image/png':
      return hasCompletePngPayload(bytes);
    case 'image/jpeg':
      return hasCompleteJpegPayload(bytes);
    case 'image/webp':
      return hasCompleteWebpPayload(bytes);
  }
}

function invalidThumbnailReferenceImageError() {
  return new ThumbnailGenerationError(
    'invalid_text',
    'PNG/JPEG/WebP 형식의 완전한 정지 이미지만 사용할 수 있습니다.',
    415,
  );
}

async function canonicalizeThumbnailReferenceImage(
  source: Uint8Array,
  mime: ThumbnailReferenceImage['mime'],
): Promise<Pick<ThumbnailReferenceImage, 'bytes' | 'mime'>> {
  if (
    source.byteLength === 0 ||
    source.byteLength > THUMBNAIL_MAX_FILE_BYTES ||
    !hasCompleteImagePayload(source, mime)
  ) {
    throw invalidThumbnailReferenceImageError();
  }

  try {
    const canonical = await canonicalizeReceiptImage(Buffer.from(source), mime);
    if (canonical.bytes.byteLength === 0 || canonical.bytes.byteLength > THUMBNAIL_MAX_FILE_BYTES) {
      throw invalidThumbnailReferenceImageError();
    }
    return { bytes: canonical.bytes, mime: canonical.mimeType };
  } catch (error) {
    if (error instanceof ThumbnailGenerationError) throw error;
    throw invalidThumbnailReferenceImageError();
  }
}

function isBlockedIPv4(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (
      b === 0 ||
      b === 2 ||
      b === 168
    )) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIPv6Bytes(address: string) {
  if (address.includes('%')) return null;

  const [head, tail, ...extra] = address.toLowerCase().split('::');
  if (extra.length) return null;

  const normalizeParts = (value: string) => {
    const parts = value ? value.split(':') : [];
    const last = parts.at(-1);
    if (!last || isIP(last) !== 4) return parts;

    const ipv4 = last.split('.').map((part) => Number(part));
    return [
      ...parts.slice(0, -1),
      `${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}`,
      `${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`,
    ];
  };

  const headParts = normalizeParts(head);
  const tailParts = normalizeParts(tail ?? '');
  let expanded: string[];
  if (tail === undefined) {
    if (headParts.length !== 8) return null;
    expanded = headParts;
  } else {
    if (headParts.length + tailParts.length >= 8) return null;
    expanded = [
      ...headParts,
      ...Array.from({ length: 8 - headParts.length - tailParts.length }, () => '0'),
      ...tailParts,
    ];
  }

  if (expanded.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const bytes = new Uint8Array(16);
  for (const [index, part] of expanded.entries()) {
    const value = Number.parseInt(part, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function isBlockedIPv6(address: string) {
  const bytes = parseIPv6Bytes(address);
  if (!bytes) return true;

  const isUnspecified = bytes.every((value) => value === 0);
  const isLoopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  const isIpv4Mapped = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isIpv4Compatible = bytes.slice(0, 12).every((value) => value === 0);
  const embeddedIpv4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;

  return (
    isUnspecified ||
    isLoopback ||
    (bytes[0]! & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) ||
    (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) ||
    bytes[0] === 0xff ||
    (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) ||
    ((isIpv4Mapped || isIpv4Compatible) && isBlockedIPv4(embeddedIpv4))
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
  const stem = baseName.replace(/\.(png|jpe?g|webp)$/i, '') || 'reference-image';
  return `${stem}.${extension}`;
}

function getTrustedRemoteImageUrl(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : value instanceof URL ? value.toString() : '';
  if (!raw || raw.length > 2_048) {
    throw new TrustedRemoteImageFetchError('remote_image_url_invalid', 400);
  }

  try {
    return new URL(raw);
  } catch {
    throw new TrustedRemoteImageFetchError('remote_image_url_invalid', 400);
  }
}

function assertTrustedRemoteImageUrl(url: URL, options: TrustedRemoteImageFetchOptions) {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !options.allowedHostnames.includes(url.hostname)
  ) {
    throw new TrustedRemoteImageFetchError(
      options.allowedHostnames.includes(url.hostname)
        ? 'remote_image_url_invalid'
        : 'remote_image_host_not_allowed',
      400,
    );
  }
}

function remoteImageTimeoutError() {
  return new TrustedRemoteImageFetchError('remote_image_timeout', 408);
}

function createTrustedRemoteImageDeadline(timeoutMs: number): TrustedRemoteImageDeadline {
  return {
    expiresAt: performance.now() + (Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0),
  };
}

function hasTrustedRemoteImageDeadlineExpired(deadline: TrustedRemoteImageDeadline) {
  return performance.now() >= deadline.expiresAt;
}

function getTrustedRemoteImageRemainingTimeoutMs(deadline: TrustedRemoteImageDeadline) {
  const remainingMs = deadline.expiresAt - performance.now();
  if (remainingMs <= 0) throw remoteImageTimeoutError();
  return Math.max(1, Math.ceil(remainingMs));
}

function awaitTrustedRemoteImageBeforeDeadline<T>(
  operation: () => Promise<T> | T,
  deadline: TrustedRemoteImageDeadline,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutMs: number;
  try {
    timeoutMs = getTrustedRemoteImageRemainingTimeoutMs(deadline);
  } catch (error) {
    try {
      onTimeout?.();
    } catch {
      // The deadline error remains authoritative even when cancellation fails.
    }
    return Promise.reject(error);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const rejectForDeadline = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        onTimeout?.();
      } catch {
        // The deadline error remains authoritative even when cancellation fails.
      }
      reject(remoteImageTimeoutError());
    };
    timeout = setTimeout(rejectForDeadline, timeoutMs);

    let operationPromise: Promise<T>;
    try {
      if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
        rejectForDeadline();
        return;
      }
      operationPromise = Promise.resolve(operation());
    } catch (error) {
      if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
        rejectForDeadline();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
      return;
    }

    operationPromise.then(
      (value) => {
        if (settled) return;
        if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
          rejectForDeadline();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
          rejectForDeadline();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function resolveTrustedRemoteImageHost(
  url: URL,
  deps: TrustedRemoteImageFetchDeps,
  deadline: TrustedRemoteImageDeadline,
) {
  const lookupFn = deps.lookup ?? lookup;
  let addresses: TrustedRemoteImageAddress[];
  try {
    addresses = await awaitTrustedRemoteImageBeforeDeadline(
      () => lookupFn(url.hostname, { all: true, verbatim: true }),
      deadline,
    ) as TrustedRemoteImageAddress[];
  } catch (error) {
    if (error instanceof TrustedRemoteImageFetchError) throw error;
    throw new TrustedRemoteImageFetchError('remote_image_dns_unavailable', 502);
  }

  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new TrustedRemoteImageFetchError('remote_image_dns_unsafe', 400);
  }
  return addresses;
}

function getTrustedRemoteImageContentType(headers: Headers) {
  return (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function assertTrustedRemoteImageContentLength(contentLength: string | null | undefined, maxBytes: number) {
  if (!contentLength) return;
  if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes) {
    throw new TrustedRemoteImageFetchError(
      /^\d+$/.test(contentLength) ? 'remote_image_too_large' : 'remote_image_response_invalid',
      /^\d+$/.test(contentLength) ? 413 : 502,
    );
  }
}

async function readLimitedTrustedRemoteImageBytes(
  response: Response,
  maxBytes: number,
  deadline: TrustedRemoteImageDeadline,
  onTimeout?: () => void,
) {
  if (!response.body) {
    throw new TrustedRemoteImageFetchError('remote_image_response_invalid', 502);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await awaitTrustedRemoteImageBeforeDeadline(
      () => reader.read(),
      deadline,
      () => {
        void reader.cancel().catch(() => undefined);
        onTimeout?.();
      },
    );
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new TrustedRemoteImageFetchError('remote_image_too_large', 413);
    }
    chunks.push(value);
  }

  getTrustedRemoteImageRemainingTimeoutMs(deadline);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchTrustedRemoteImageWithFetch(
  url: URL,
  options: TrustedRemoteImageFetchOptions,
  deps: TrustedRemoteImageFetchDeps,
  deadline: TrustedRemoteImageDeadline,
): Promise<TrustedRemoteImageResponse> {
  const controller = new AbortController();

  try {
    const response = await awaitTrustedRemoteImageBeforeDeadline(
      () => (deps.fetch ?? fetch)(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: options.accept },
      }),
      deadline,
      () => controller.abort(),
    );

    if (response.status >= 300 && response.status < 400) {
      throw new TrustedRemoteImageFetchError('remote_image_redirect', 400);
    }
    if (!response.ok) {
      throw new TrustedRemoteImageFetchError('remote_image_request_failed', 502);
    }

    assertTrustedRemoteImageContentLength(response.headers.get('content-length'), options.maxBytes);
    return {
      bytes: await readLimitedTrustedRemoteImageBytes(
        response,
        options.maxBytes,
        deadline,
        () => controller.abort(),
      ),
      contentType: getTrustedRemoteImageContentType(response.headers),
    };
  } catch (error) {
    if (error instanceof TrustedRemoteImageFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw remoteImageTimeoutError();
    }
    throw new TrustedRemoteImageFetchError('remote_image_request_failed', 502);
  }
}

async function fetchTrustedRemoteImageWithPinnedDns(
  url: URL,
  addresses: readonly TrustedRemoteImageAddress[],
  options: TrustedRemoteImageFetchOptions,
  deadline: TrustedRemoteImageDeadline,
): Promise<TrustedRemoteImageResponse> {
  const selectedAddress = addresses[0];
  if (!selectedAddress) throw new TrustedRemoteImageFetchError('remote_image_dns_unavailable', 502);
  const timeoutMs = getTrustedRemoteImageRemainingTimeoutMs(deadline);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: TrustedRemoteImageResponse | TrustedRemoteImageFetchError, isError: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (isError) reject(result);
      else resolve(result as TrustedRemoteImageResponse);
    };
    if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
      reject(remoteImageTimeoutError());
      return;
    }
    const request = httpsRequest(url, {
      headers: { Accept: options.accept, Host: url.hostname },
      agent: false,
      servername: url.hostname,
      rejectUnauthorized: true,
      lookup: (_hostname, _options, callback) => {
        callback(null, selectedAddress.address, selectedAddress.family);
      },
    });

    request.once('error', () => {
      settle(
        hasTrustedRemoteImageDeadlineExpired(deadline)
          ? remoteImageTimeoutError()
          : new TrustedRemoteImageFetchError('remote_image_request_failed', 502),
        true,
      );
    });
    request.once('response', (response) => {
      if (settled) {
        response.resume();
        return;
      }
      if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
        response.resume();
        request.destroy();
        settle(remoteImageTimeoutError(), true);
        return;
      }

      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        request.destroy();
        settle(new TrustedRemoteImageFetchError('remote_image_redirect', 400), true);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        request.destroy();
        settle(new TrustedRemoteImageFetchError('remote_image_request_failed', 502), true);
        return;
      }

      const contentLength = response.headers['content-length'];
      const contentLengthValue = Array.isArray(contentLength) ? contentLength[0] : contentLength;
      try {
        assertTrustedRemoteImageContentLength(contentLengthValue, options.maxBytes);
      } catch (error) {
        response.resume();
        request.destroy();
        settle(
          error instanceof TrustedRemoteImageFetchError
            ? error
            : new TrustedRemoteImageFetchError('remote_image_response_invalid', 502),
          true,
        );
        return;
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
          response.destroy();
          request.destroy();
          settle(remoteImageTimeoutError(), true);
          return;
        }
        total += chunk.byteLength;
        if (total > options.maxBytes) {
          response.destroy();
          request.destroy();
          settle(new TrustedRemoteImageFetchError('remote_image_too_large', 413), true);
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', () => {
        settle(
          hasTrustedRemoteImageDeadlineExpired(deadline)
            ? remoteImageTimeoutError()
            : new TrustedRemoteImageFetchError('remote_image_request_failed', 502),
          true,
        );
      });
      response.once('end', () => {
        if (hasTrustedRemoteImageDeadlineExpired(deadline)) {
          request.destroy();
          settle(remoteImageTimeoutError(), true);
          return;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const contentType = Array.isArray(response.headers['content-type'])
          ? response.headers['content-type'][0] ?? ''
          : response.headers['content-type'] ?? '';
        settle({
          bytes,
          contentType: contentType.split(';')[0]?.trim().toLowerCase() ?? '',
        }, false);
      });
    });

    timeout = setTimeout(() => {
      request.destroy();
      settle(remoteImageTimeoutError(), true);
    }, timeoutMs);
    request.end();
  });
}

export async function fetchTrustedRemoteImage(
  value: unknown,
  options: TrustedRemoteImageFetchOptions,
  deps: TrustedRemoteImageFetchDeps = {},
) {
  const deadline = createTrustedRemoteImageDeadline(options.timeoutMs);
  const url = getTrustedRemoteImageUrl(value);
  assertTrustedRemoteImageUrl(url, options);
  const addresses = await resolveTrustedRemoteImageHost(url, deps, deadline);
  return deps.fetch
    ? fetchTrustedRemoteImageWithFetch(url, options, deps, deadline)
    : fetchTrustedRemoteImageWithPinnedDns(url, addresses, options, deadline);
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

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new ThumbnailGenerationError('invalid_text', 'HTTPS 참고 이미지 URL만 사용할 수 있습니다.', 400);
  }
  if (!THUMBNAIL_REMOTE_IMAGE_ALLOWED_HOSTNAMES.includes(url.hostname as typeof THUMBNAIL_REMOTE_IMAGE_ALLOWED_HOSTNAMES[number])) {
    throw new ThumbnailGenerationError('invalid_text', '허용된 제공자 참고 이미지 URL만 사용할 수 있습니다.', 400);
  }

  return url;
}

function toThumbnailRemoteImageError(error: unknown) {
  if (error instanceof TrustedRemoteImageFetchError) {
    if (error.code === 'remote_image_timeout') {
      return new ThumbnailGenerationError('invalid_text', '참고 이미지 URL 응답 시간이 초과되었습니다.', error.status);
    }
    if (error.code === 'remote_image_too_large') {
      return new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', error.status);
    }
  }
  return new ThumbnailGenerationError('invalid_text', '참고 이미지를 가져오지 못했습니다.', 400);
}

export async function fetchThumbnailReferenceImageFromUrl(value: unknown, deps: RemoteImageFetchDeps = {}) {
  const url = parseThumbnailReferenceImageUrl(value);
  try {
    const remote = await fetchTrustedRemoteImage(url, {
      allowedHostnames: THUMBNAIL_REMOTE_IMAGE_ALLOWED_HOSTNAMES,
      maxBytes: THUMBNAIL_MAX_FILE_BYTES,
      timeoutMs: THUMBNAIL_REMOTE_IMAGE_TIMEOUT_MS,
      accept: 'image/png,image/jpeg,image/webp',
    }, deps);
    const declaredType = remote.contentType;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(declaredType)) {
      throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지 URL만 사용할 수 있습니다.', 415);
    }

    const mime = detectImageMime(remote.bytes);
    if (!mime || mime !== declaredType) {
      throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지 URL만 사용할 수 있습니다.', 415);
    }
    const canonical = await canonicalizeThumbnailReferenceImage(remote.bytes, mime);

    return {
      bytes: canonical.bytes,
      mime: canonical.mime,
      fileName: getSafeRemoteFileName(url, canonical.mime),
    };
  } catch (error) {
    if (error instanceof ThumbnailGenerationError) throw error;
    throw toThumbnailRemoteImageError(error);
  }
}

export async function readThumbnailReferenceImages(
  files: File[],
  roles: readonly ThumbnailReferenceRole[] = [],
): Promise<ThumbnailReferenceImage[]> {
  if (files.length > THUMBNAIL_MAX_FILES) throw new ThumbnailGenerationError('invalid_text', '참고 이미지는 최대 8개까지 업로드할 수 있습니다.', 400);
  let sourceTotalBytes = 0;
  let canonicalTotalBytes = 0;
  const images: ThumbnailReferenceImage[] = [];
  for (const [index, file] of files.entries()) {
    if (file.size > THUMBNAIL_MAX_FILE_BYTES) throw new ThumbnailGenerationError('invalid_text', '이미지 1개는 8MiB를 넘을 수 없습니다.', 413);
    sourceTotalBytes += file.size;
    if (sourceTotalBytes > THUMBNAIL_MAX_TOTAL_BYTES) throw new ThumbnailGenerationError('invalid_text', '이미지 총 용량은 32MiB를 넘을 수 없습니다.', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (!mime) throw new ThumbnailGenerationError('invalid_text', 'PNG/JPEG/WebP 이미지만 업로드할 수 있습니다.', 415);
    const canonical = await canonicalizeThumbnailReferenceImage(bytes, mime);
    if (canonicalTotalBytes + canonical.bytes.byteLength > THUMBNAIL_MAX_CANONICAL_TOTAL_BYTES) {
      throw new ThumbnailGenerationError('invalid_text', '처리된 이미지 총 용량은 16MiB를 넘을 수 없습니다.', 413);
    }
    canonicalTotalBytes += canonical.bytes.byteLength;
    images.push({
      name: `reference-${index + 1}`,
      mime: canonical.mime,
      bytes: canonical.bytes,
      role: roles[index] ?? 'other',
    });
  }
  return images;
}
