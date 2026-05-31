export const YOUTUBE_THUMBNAIL_QUALITY_CANDIDATES = [
  'maxresdefault',
  'sddefault',
  'hqdefault',
  'mqdefault',
  'default',
] as const;

export type YoutubeThumbnailQuality = typeof YOUTUBE_THUMBNAIL_QUALITY_CANDIDATES[number];

export function getYoutubeThumbnailUrl(
  videoId: string | null | undefined,
  quality: YoutubeThumbnailQuality = 'hqdefault',
) {
  if (!videoId) return null;

  return `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
}

export function getYoutubeThumbnailCandidates(videoId: string | null | undefined) {
  if (!videoId) return [];

  return YOUTUBE_THUMBNAIL_QUALITY_CANDIDATES.map((quality) =>
    getYoutubeThumbnailUrl(videoId, quality)
  ).filter(Boolean) as string[];
}

export function shouldTryNextYoutubeThumbnailCandidate({
  naturalWidth,
  naturalHeight,
  candidateIndex,
  totalCandidates,
}: {
  naturalWidth: number;
  naturalHeight: number;
  candidateIndex: number;
  totalCandidates: number;
}) {
  if (candidateIndex >= totalCandidates - 1) return false;

  // YouTube sometimes returns a tiny 120x90 placeholder with HTTP 200 for a
  // high-quality thumbnail that does not actually exist. Treat that as a miss
  // and continue to the next candidate instead of showing a broken-looking card.
  return naturalWidth <= 120 && naturalHeight <= 90;
}
