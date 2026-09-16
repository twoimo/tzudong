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

// Placeholder sizes observed from img.youtube.com when a quality variant does
// not exist: 120x90 grey placeholder. Real ladder files are >= 320px wide
// (mqdefault), so an ORIGINAL image smaller than this is a placeholder.
// IMPORTANT: only feed this the decoded ORIGINAL bytes (naturalWidth of a
// freshly created Image() for the raw URL), never the naturalWidth of an
// <img> rendered through Next/Image, which is density/srcset-corrected and
// would misjudge perfectly good small renderings (6 Pro P1, 2026-09-17).
export const YOUTUBE_THUMBNAIL_PLACEHOLDER_MAX_WIDTH = 120;
export const YOUTUBE_THUMBNAIL_PLACEHOLDER_MAX_HEIGHT = 90;

export function isYoutubeThumbnailPlaceholderOriginal({
  naturalWidth,
  naturalHeight,
}: {
  naturalWidth: number;
  naturalHeight: number;
}) {
  return (
    naturalWidth > 0 &&
    naturalHeight > 0 &&
    naturalWidth <= YOUTUBE_THUMBNAIL_PLACEHOLDER_MAX_WIDTH &&
    naturalHeight <= YOUTUBE_THUMBNAIL_PLACEHOLDER_MAX_HEIGHT
  );
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

  return isYoutubeThumbnailPlaceholderOriginal({ naturalWidth, naturalHeight });
}

/**
 * Probe the RAW youtube image (bypassing Next/Image optimization) and resolve
 * the first candidate that is neither a 404 nor a 200-with-placeholder.
 * Returns the candidate index, or -1 when every candidate failed.
 */
export async function resolveYoutubeThumbnailCandidateIndex(
  candidates: string[],
  probe: (url: string) => Promise<boolean> = defaultProbe,
): Promise<number> {
  for (let i = 0; i < candidates.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential ladder probe is intentional (stop at first good)
    if (await probe(candidates[i])) return i;
  }
  return -1;
}

function loadImageOriginal(url: string): Promise<{ ok: boolean; placeholder: boolean }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ ok: false, placeholder: false });
      return;
    }
    const img = new Image();
    const timer = setTimeout(() => resolve({ ok: false, placeholder: false }), 6000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ ok: true, placeholder: isYoutubeThumbnailPlaceholderOriginal({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }) });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({ ok: false, placeholder: false });
    };
    img.src = url;
  });
}

async function defaultProbe(url: string): Promise<boolean> {
  const res = await loadImageOriginal(url);
  return res.ok && !res.placeholder;
}
