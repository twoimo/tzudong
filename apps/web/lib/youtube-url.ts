const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function normalizeVideoId(value: string | null): string | null {
    if (!value) return null;
    const candidate = value.trim();
    return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

export function extractCanonicalYouTubeVideoId(
    value: string | null | undefined,
): string | null {
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    const directVideoId = normalizeVideoId(trimmed);
    if (directVideoId) return directVideoId;

    let url: URL;
    try {
        url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }

    if (url.username || url.password) return null;

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'youtu.be') {
        return normalizeVideoId(url.pathname.split('/').filter(Boolean)[0] ?? null);
    }

    if (
        hostname !== 'youtube.com'
        && hostname !== 'm.youtube.com'
        && hostname !== 'music.youtube.com'
        && hostname !== 'youtube-nocookie.com'
    ) {
        return null;
    }

    if (url.pathname === '/watch') {
        return normalizeVideoId(url.searchParams.get('v'));
    }

    const [route, videoId] = url.pathname.split('/').filter(Boolean);
    if (!['embed', 'live', 'shorts'].includes(route ?? '')) return null;
    return normalizeVideoId(videoId ?? null);
}

export function normalizeCanonicalYouTubeWatchUrl(
    value: string | null | undefined,
): string | null {
    const videoId = extractCanonicalYouTubeVideoId(value);
    return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
