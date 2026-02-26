import type { Json } from '@/integrations/supabase/types';

export function extractVideoIdFromYoutubeLink(link: string | null | undefined): string | null {
    if (!link) return null;

    const patterns = [
        /[?&]v=([A-Za-z0-9_-]{6,})/,
        /youtu\.be\/([A-Za-z0-9_-]{6,})/,
        /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
        /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    ];

    for (const pattern of patterns) {
        const match = link.match(pattern);
        if (match?.[1]) return match[1];
    }

    return null;
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
