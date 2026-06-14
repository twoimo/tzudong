import {
  fetchThumbnailReferenceImageFromUrl,
  THUMBNAIL_MAX_FILES,
} from './request';
import { getYoutubeThumbnailCandidates } from '@/lib/youtube-thumbnail';
import type {
  ThumbnailReferenceEvidence,
  ThumbnailReferenceImage,
} from './types';

export const THUMBNAIL_AUTOMATIC_RETRIEVAL_REFERENCE_LIMIT = 4;
export const THUMBNAIL_AUTOMATIC_RETRIEVAL_HOST_REFERENCE_LIMIT = 8;
export const THUMBNAIL_AUTOMATIC_RETRIEVAL_STYLE_REFERENCE_LIMIT = 2;

export type ThumbnailRetrievalReferenceImageDeps = Parameters<typeof fetchThumbnailReferenceImageFromUrl>[1];

export type ThumbnailRetrievalReferenceImageResult = {
  images: ThumbnailReferenceImage[];
  selectedReferenceIds: string[];
  warnings: string[];
};

type ThumbnailRetrievalReferenceImageOptions = {
  /**
   * When the operator explicitly requests Tzuyang in the thumbnail, the locally
   * held Tzuyang video thumbnails may be attached as host references instead of
   * style-only references. Without this opt-in, automatic retrieval remains
   * food/style/composition only and cannot satisfy likeness generation.
   */
  allowHostPersonFromRetrievedThumbnails?: boolean;
  automaticReferenceLimit?: number;
};

export function getThumbnailAutomaticRetrievalReferenceLimit(
  options: Pick<ThumbnailRetrievalReferenceImageOptions, 'allowHostPersonFromRetrievedThumbnails' | 'automaticReferenceLimit'> = {},
) {
  if (typeof options.automaticReferenceLimit === 'number' && Number.isFinite(options.automaticReferenceLimit)) {
    return Math.max(0, Math.min(THUMBNAIL_AUTOMATIC_RETRIEVAL_REFERENCE_LIMIT, Math.floor(options.automaticReferenceLimit)));
  }
  return options.allowHostPersonFromRetrievedThumbnails
    ? THUMBNAIL_AUTOMATIC_RETRIEVAL_HOST_REFERENCE_LIMIT
    : THUMBNAIL_AUTOMATIC_RETRIEVAL_STYLE_REFERENCE_LIMIT;
}

function isAutomaticVisualReference(
  evidence: ThumbnailReferenceEvidence,
  options: ThumbnailRetrievalReferenceImageOptions,
) {
  if (evidence.source !== 'youtube_thumbnail'
    || typeof evidence.thumbnailUrl !== 'string'
    || evidence.thumbnailUrl.length <= 0
  ) {
    return false;
  }
  if (options.allowHostPersonFromRetrievedThumbnails) return true;
  return evidence.intent !== 'host'
    && evidence.intent !== 'person'
    && evidence.uploadRole !== 'host'
    && evidence.uploadRole !== 'person';
}

function safeReferenceName(evidence: ThumbnailReferenceEvidence, index: number) {
  const raw = [evidence.videoId, evidence.id]
    .filter(Boolean)
    .join('-') || `reference-${index + 1}`;
  return `auto-tzuyang-thumbnail-${raw}`
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function referenceRoleForEvidence(
  evidence: ThumbnailReferenceEvidence,
  options: ThumbnailRetrievalReferenceImageOptions,
): ThumbnailReferenceImage['role'] {
  if (options.allowHostPersonFromRetrievedThumbnails) {
    if (evidence.uploadRole === 'person' || evidence.intent === 'person') return 'person';
    return 'host';
  }
  return evidence.uploadRole === 'food' || evidence.intent === 'food'
    ? 'food'
    : 'other';
}

function candidateUrlsForEvidence(evidence: ThumbnailReferenceEvidence) {
  const urls = [
    evidence.thumbnailUrl,
    ...getYoutubeThumbnailCandidates(evidence.videoId),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  return Array.from(new Set(urls)).slice(0, 5);
}

async function fetchFirstAvailableReferenceImage(
  evidence: ThumbnailReferenceEvidence,
  deps: ThumbnailRetrievalReferenceImageDeps,
) {
  let lastError: unknown = null;
  for (const url of candidateUrlsForEvidence(evidence)) {
    try {
      return await fetchThumbnailReferenceImageFromUrl(url, deps);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('thumbnail_retrieval_reference_url_missing');
}

export async function readThumbnailRetrievalReferenceImages(
  evidence: readonly ThumbnailReferenceEvidence[],
  existingReferenceCount = 0,
  deps: ThumbnailRetrievalReferenceImageDeps = {},
  options: ThumbnailRetrievalReferenceImageOptions = {},
): Promise<ThumbnailRetrievalReferenceImageResult> {
  const remainingSlots = Math.max(0, THUMBNAIL_MAX_FILES - existingReferenceCount);
  const limit = Math.min(getThumbnailAutomaticRetrievalReferenceLimit(options), remainingSlots);
  if (limit <= 0) return { images: [], selectedReferenceIds: [], warnings: [] };

  const images: ThumbnailReferenceImage[] = [];
  const selectedReferenceIds: string[] = [];
  const warnings: string[] = [];

  for (const [index, item] of evidence
    .filter((candidate) => isAutomaticVisualReference(candidate, options))
    .slice(0, limit)
    .entries()) {
    try {
      const remote = await fetchFirstAvailableReferenceImage(item, deps);
      images.push({
        name: safeReferenceName(item, index),
        mime: remote.mime,
        bytes: remote.bytes,
        role: referenceRoleForEvidence(item, options),
      });
      selectedReferenceIds.push(item.id);
    } catch {
      warnings.push(`thumbnail_retrieval_reference_fetch_skipped:${item.id}`);
    }
  }

  return { images, selectedReferenceIds, warnings };
}
