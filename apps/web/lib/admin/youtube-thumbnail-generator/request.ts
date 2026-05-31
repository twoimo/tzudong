import type {
  ThumbnailBriefPreset,
  ThumbnailGeneratorPayload,
  ThumbnailReferenceImage,
  ThumbnailReferenceRole,
  ThumbnailTextLayer,
} from './types';
import {
  ThumbnailGenerationError,
  THUMBNAIL_BRIEF_PRESETS,
  THUMBNAIL_PROVIDER_IDS,
  THUMBNAIL_REFERENCE_ROLES,
} from './types';
import { isThumbnailProviderId } from './providers';

export const THUMBNAIL_MAX_TOTAL_BYTES = 33_554_432;
export const THUMBNAIL_MAX_FILE_BYTES = 8_388_608;
export const THUMBNAIL_MAX_FILES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toStringValue(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isThumbnailBriefPreset(value: unknown): value is ThumbnailBriefPreset {
  return typeof value === 'string' && (THUMBNAIL_BRIEF_PRESETS as readonly string[]).includes(value);
}

function isThumbnailReferenceRole(value: unknown): value is ThumbnailReferenceRole {
  return typeof value === 'string' && (THUMBNAIL_REFERENCE_ROLES as readonly string[]).includes(value);
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
