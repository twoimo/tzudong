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
  quality: YoutubeThumbnailQuality = 'maxresdefault',
) {
  if (!videoId) return null;

  return `https://img.youtube.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
}

const THUMBNAIL_VIEWPORT_CAP_PX = 1280; // vw without a max-width uses this viewport

function thumbnailSlotCssPx(sizes: string): number {
  let maxCssPx = 0;

  for (const part of sizes.split(',')) {
    const mediaMax = part.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
    const slot = part.replace(/\([^)]*\)/g, '');
    const vw = slot.match(/(\d+(?:\.\d+)?)vw/);
    const px = slot.match(/(\d+(?:\.\d+)?)px/);
    if (vw) {
      const viewport = mediaMax ? Number(mediaMax[1]) : THUMBNAIL_VIEWPORT_CAP_PX;
      maxCssPx = Math.max(maxCssPx, (Number(vw[1]) / 100) * viewport);
    } else if (px) {
      maxCssPx = Math.max(maxCssPx, Number(px[1]));
    }
  }

  return maxCssPx || THUMBNAIL_VIEWPORT_CAP_PX;
}

export function resolveYoutubeThumbnailCeiling(sizes: string): YoutubeThumbnailQuality {
  const cssPx = thumbnailSlotCssPx(sizes);

  // Two device pixels per CSS pixel. hqdefault is 480px wide, sddefault is 640px.
  if (cssPx * 2 <= 480) return 'hqdefault';
  if (cssPx * 2 <= 960) return 'sddefault';
  return 'maxresdefault';
}

export function getYoutubeThumbnailCandidates(
  videoId: string | null | undefined,
  ceiling: YoutubeThumbnailQuality = 'maxresdefault',
) {
  if (!videoId) return [];

  const start = Math.max(0, YOUTUBE_THUMBNAIL_QUALITY_CANDIDATES.indexOf(ceiling));
  return YOUTUBE_THUMBNAIL_QUALITY_CANDIDATES.slice(start).map((quality) =>
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
