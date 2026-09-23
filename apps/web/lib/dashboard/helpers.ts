import type { Json } from '@/integrations/supabase/types';

const YOUTUBE_VIDEO_ID_PATTERNS = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/,
] as const;

const DASHBOARD_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const VIDEO_ID_CACHE_LIMIT = 4096;
const videoIdByLink = new Map<string, string | null>();

function rememberVideoId(link: string, videoId: string | null): string | null {
    if (videoIdByLink.size >= VIDEO_ID_CACHE_LIMIT) {
        videoIdByLink.clear();
    }
    videoIdByLink.set(link, videoId);
    return videoId;
}

export function extractVideoIdFromYoutubeLink(link: string | null | undefined): string | null {
    if (typeof link !== 'string' || link.length === 0) return null;

    const cached = videoIdByLink.get(link);
    if (cached !== undefined) return cached;

    let videoId: string | null = null;
    for (const pattern of YOUTUBE_VIDEO_ID_PATTERNS) {
        const match = pattern.exec(link);
        if (match?.[1]) {
            videoId = match[1];
            break;
        }
    }

    return rememberVideoId(link, videoId);
}

export function classifyDashboardVideoId(videoId: string | null | undefined):
    | { status: 'required' }
    | { status: 'invalid'; length: number }
    | { status: 'ok'; videoId: string } {
    if (typeof videoId !== 'string') return { status: 'required' };

    const trimmed = videoId.trim();
    if (trimmed.length === 0) return { status: 'required' };
    if (!DASHBOARD_VIDEO_ID_PATTERN.test(trimmed)) {
        return { status: 'invalid', length: trimmed.length };
    }

    return { status: 'ok', videoId: trimmed };
}

export function canonicalizeYoutubeLink(link: string | null | undefined): string | null {
    const videoId = extractVideoIdFromYoutubeLink(link);
    if (!videoId) {
        if (typeof link !== 'string') return null;
        const trimmed = link.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
}

export function toDisplayAddress(
    roadAddress: string | null,
    jibunAddress: string | null,
    originAddress: Json | null,
): string | null {
    if (roadAddress) return roadAddress;
    if (jibunAddress) return jibunAddress;

    if (originAddress && typeof originAddress === 'object' && !Array.isArray(originAddress)) {
        const address = (originAddress as Record<string, unknown>).address;
        if (typeof address === 'string' && address.trim().length > 0) return address;
    }

    return null;
}

export function toFirstCategory(categories: string[] | null | undefined): string | null {
    if (!Array.isArray(categories) || categories.length === 0) return null;
    return categories[0] ?? null;
}

export function parseYoutubeMeta(youtubeMeta: Json | null): {
    title: string | null;
    publishedAt: string | null;
} {
    if (!youtubeMeta || typeof youtubeMeta !== 'object' || Array.isArray(youtubeMeta)) {
        return { title: null, publishedAt: null };
    }

    const raw = youtubeMeta as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title : null;

    const publishedAtValue = typeof raw.publishedAt === 'string'
        ? raw.publishedAt
        : typeof raw.published_at === 'string'
            ? raw.published_at
            : null;

    return {
        title,
        publishedAt: publishedAtValue,
    };
}

export function toPercent(numerator: number, denominator: number): number | null {
    if (!denominator) return null;
    return Number(((numerator / denominator) * 100).toFixed(2));
}
