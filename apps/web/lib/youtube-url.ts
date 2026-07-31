const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_YOUTUBE_URL_LENGTH = 2_048;

const WATCH_QUERY_PARAMETERS = new Set(['v', 't', 'start', 'end', 'feature', 'si']);
const SHORT_QUERY_PARAMETERS = new Set(['t', 'start', 'end', 'feature', 'si']);

function isCanonicalVideoId(value: string): boolean {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

function isSafeInput(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_YOUTUBE_URL_LENGTH &&
    /^[\x21-\x7E]+$/.test(value) &&
    !value.includes('%') &&
    !value.includes('\\')
  );
}

function hasAllowedQueryParameters(
  search: string,
  allowedParameters: ReadonlySet<string>,
  requiredVideoId: string | null,
): boolean {
  if (!search) return requiredVideoId === null;

  const seenParameters = new Set<string>();
  const queryParts = search.slice(1).split('&');

  for (const queryPart of queryParts) {
    const separatorIndex = queryPart.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex !== queryPart.lastIndexOf('=')) return false;

    const key = queryPart.slice(0, separatorIndex);
    const value = queryPart.slice(separatorIndex + 1);

    if (!allowedParameters.has(key) || seenParameters.has(key) || !value) return false;
    seenParameters.add(key);

    if (key === 'v') {
      if (!isCanonicalVideoId(value)) return false;
      continue;
    }

    if (key === 't' && !/^[0-9hms]+$/i.test(value)) return false;
    if ((key === 'start' || key === 'end') && !/^\d{1,10}$/.test(value)) return false;
    if ((key === 'feature' || key === 'si') && !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return false;
  }

  return requiredVideoId === null || (seenParameters.has('v') && queryParts.some((part) => part === `v=${requiredVideoId}`));
}

function extractVideoIdFromCanonicalUrl(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;

  const rawUrl = /^https:\/\/([^/?#]*)(\/[^?#]*)?(?:\?[^#]*)?$/i.exec(value);
  const authority = rawUrl?.[1]?.toLowerCase();
  const rawPath = rawUrl?.[2] ?? '';
  if (authority !== 'www.youtube.com' && authority !== 'youtu.be') return null;

  if (url.hostname === 'www.youtube.com') {
    if (rawPath !== '/watch' || url.pathname !== '/watch') return null;

    const videoId = url.searchParams.get('v');
    if (!videoId || !isCanonicalVideoId(videoId)) return null;
    if (!hasAllowedQueryParameters(url.search, WATCH_QUERY_PARAMETERS, videoId)) return null;

    return videoId;
  }

  if (url.hostname !== 'youtu.be') return null;

  const videoId = url.pathname.slice(1);
  if (rawPath !== `/${videoId}` || !isCanonicalVideoId(videoId) || url.pathname !== `/${videoId}`) return null;
  if (!hasAllowedQueryParameters(url.search, SHORT_QUERY_PARAMETERS, null)) return null;

  return videoId;
}

export function extractCanonicalYouTubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F-\u009F]/.test(value)) return null;

  const candidate = value.trim();
  if (!isSafeInput(candidate)) return null;
  if (isCanonicalVideoId(candidate)) return candidate;

  return extractVideoIdFromCanonicalUrl(candidate);
}

export function buildCanonicalYouTubeWatchUrl(videoId: unknown): string | null {
  if (typeof videoId !== 'string' || !isCanonicalVideoId(videoId)) return null;

  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function normalizeCanonicalYouTubeWatchUrl(value: unknown): string | null {
  return buildCanonicalYouTubeWatchUrl(extractCanonicalYouTubeVideoId(value));
}
