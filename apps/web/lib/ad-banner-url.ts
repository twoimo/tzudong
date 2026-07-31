import { supabase } from '@/integrations/supabase/client';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';

const AD_BANNER_MEDIA_BUCKET = 'ad-banner-images';
const AD_BANNER_PUBLIC_PATH = `/storage/v1/object/public/${AD_BANNER_MEDIA_BUCKET}/`;
const MAX_DESTINATION_URL_LENGTH = 2_048;
const MAX_MEDIA_URL_LENGTH = 4_096;
const MAX_STORAGE_OBJECT_PATH_LENGTH = 1_024;
const MAX_APPLICATION_QUERY_PARAMETERS = 16;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const APPLICATION_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=-]+$/;
const APPLICATION_QUERY_PARAMETER_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})=([A-Za-z0-9._~-]{1,256})$/;
const STORAGE_OBJECT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
export const AD_BANNER_URL_VALIDATION_ERROR = '배너 URL 또는 미디어 유형이 올바르지 않습니다.';

export type ResolvedAdBannerPersistenceUrls = {
    image_url: string | null;
    video_url: string | null;
    media_type: 'image' | 'video' | 'none';
    link_url: string | null;
};

function getConfiguredSupabaseOrigin(): string | null {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredUrl || configuredUrl !== configuredUrl.trim()) return null;

    try {
        const url = new URL(configuredUrl);
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
        ) {
            return null;
        }

        return url.origin;
    } catch {
        return null;
    }
}

function hasCanonicalApplicationQuery(query: string): boolean {
    if (!query) return true;
    if (!query.startsWith('?')) return false;

    const parameters = query.slice(1).split('&');
    if (parameters.length === 0 || parameters.length > MAX_APPLICATION_QUERY_PARAMETERS) return false;

    const names = new Set<string>();
    return parameters.every((parameter) => {
        const match = APPLICATION_QUERY_PARAMETER_PATTERN.exec(parameter);
        if (!match || names.has(match[1])) return false;
        names.add(match[1]);
        return true;
    });
}

function resolveCanonicalApplicationPath(value: string): string | null {
    if (
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.includes('\\') ||
        value.includes('%') ||
        value.includes('#') ||
        value.includes(':') ||
        value.includes('@') ||
        value.includes('//')
    ) {
        return null;
    }

    const queryIndex = value.indexOf('?');
    const path = queryIndex === -1 ? value : value.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : value.slice(queryIndex);

    if (
        !path ||
        (path !== '/' && path.endsWith('/')) ||
        !hasCanonicalApplicationQuery(query)
    ) {
        return null;
    }

    const segments = path === '/' ? [] : path.slice(1).split('/');
    if (!segments.every((segment) => (
        segment !== '.' &&
        segment !== '..' &&
        APPLICATION_PATH_SEGMENT_PATTERN.test(segment)
    ))) {
        return null;
    }

    try {
        const url = new URL(value, 'https://tzudong.invalid');
        if (
            url.origin !== 'https://tzudong.invalid' ||
            url.username ||
            url.password ||
            url.port ||
            url.hash ||
            url.pathname !== path ||
            url.search !== query
        ) {
            return null;
        }
    } catch {
        return null;
    }

    return value;
}

function isCanonicalStorageObjectPath(path: string): boolean {
    if (
        !path ||
        path.length > MAX_STORAGE_OBJECT_PATH_LENGTH ||
        path.startsWith('/') ||
        path.endsWith('/') ||
        path.includes('\\') ||
        path.includes('%') ||
        path.includes('?') ||
        path.includes('#') ||
        path.includes(':') ||
        path.includes('@') ||
        CONTROL_CHARACTER_PATTERN.test(path)
    ) {
        return false;
    }

    const segments = path.split('/');
    return segments.length <= 16 && segments.every((segment) => (
        segment !== '.' &&
        segment !== '..' &&
        STORAGE_OBJECT_SEGMENT_PATTERN.test(segment)
    ));
}

/**
 * Resolves only application-relative paths and canonical YouTube watch URLs.
 * The returned value is safe to navigate because every other origin fails closed.
 */
export function resolveAdBannerDestinationUrl(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        !value ||
        value.length > MAX_DESTINATION_URL_LENGTH ||
        value !== value.trim() ||
        CONTROL_CHARACTER_PATTERN.test(value)
    ) {
        return null;
    }

    const applicationPath = resolveCanonicalApplicationPath(value);
    if (applicationPath) return applicationPath;

    if (!value.startsWith('https://')) return null;
    return normalizeCanonicalYouTubeWatchUrl(value);
}

/**
 * Resolves only the configured Supabase public-object URL for banner media.
 * Comparing with the client-generated public URL prevents lookalike hosts and buckets.
 */
export function resolveAdBannerMediaUrl(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        !value ||
        value.length > MAX_MEDIA_URL_LENGTH ||
        value !== value.trim() ||
        value.includes('\\') ||
        CONTROL_CHARACTER_PATTERN.test(value)
    ) {
        return null;
    }

    const configuredOrigin = getConfiguredSupabaseOrigin();
    if (!configuredOrigin) return null;

    const expectedPrefix = `${configuredOrigin}${AD_BANNER_PUBLIC_PATH}`;
    if (!value.startsWith(expectedPrefix)) return null;

    const objectPath = value.slice(expectedPrefix.length);
    if (!isCanonicalStorageObjectPath(objectPath)) return null;

    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.origin !== configuredOrigin ||
            url.username ||
            url.password ||
            url.port ||
            url.search ||
            url.hash ||
            url.pathname !== `${AD_BANNER_PUBLIC_PATH}${objectPath}`
        ) {
            return null;
        }

        const expectedPublicUrl = supabase.storage
            .from(AD_BANNER_MEDIA_BUCKET)
            .getPublicUrl(objectPath)
            .data.publicUrl;
        const expectedUrl = new URL(expectedPublicUrl);
        if (
            expectedPublicUrl !== value ||
            expectedUrl.protocol !== 'https:' ||
            expectedUrl.origin !== configuredOrigin ||
            expectedUrl.username ||
            expectedUrl.password ||
            expectedUrl.port ||
            expectedUrl.search ||
            expectedUrl.hash ||
            expectedUrl.pathname !== url.pathname
        ) {
            return null;
        }

        return expectedPublicUrl;
    } catch {
        return null;
    }
}
/**
 * Resolves a complete persisted banner URL tuple. A banner may contain exactly
 * one trusted media URL whose type matches media_type, or no media at all.
 */
export function resolveAdBannerPersistenceUrls(value: {
    image_url: unknown;
    video_url: unknown;
    media_type: unknown;
    link_url: unknown;
}): ResolvedAdBannerPersistenceUrls | null {
    const linkUrl = value.link_url == null || value.link_url === ''
        ? null
        : resolveAdBannerDestinationUrl(value.link_url);
    if (value.link_url != null && value.link_url !== '' && !linkUrl) return null;

    const imageUrl = value.image_url == null
        ? null
        : resolveAdBannerMediaUrl(value.image_url);
    if (value.image_url != null && !imageUrl) return null;

    const videoUrl = value.video_url == null
        ? null
        : resolveAdBannerMediaUrl(value.video_url);
    if (value.video_url != null && !videoUrl) return null;

    if (value.media_type === 'image' && imageUrl && !videoUrl) {
        return {
            image_url: imageUrl,
            video_url: null,
            media_type: 'image',
            link_url: linkUrl,
        };
    }

    if (value.media_type === 'video' && videoUrl && !imageUrl) {
        return {
            image_url: null,
            video_url: videoUrl,
            media_type: 'video',
            link_url: linkUrl,
        };
    }

    if (value.media_type === 'none' && !imageUrl && !videoUrl) {
        return {
            image_url: null,
            video_url: null,
            media_type: 'none',
            link_url: linkUrl,
        };
    }

    return null;
}

/**
 * Returns a storage object path only after the complete public media URL was
 * verified for the configured banner bucket.
 */
export function resolveAdBannerMediaStoragePath(value: unknown): string | null {
    const mediaUrl = resolveAdBannerMediaUrl(value);
    if (!mediaUrl) return null;

    try {
        const path = new URL(mediaUrl).pathname;
        const objectPath = path.slice(AD_BANNER_PUBLIC_PATH.length);
        return isCanonicalStorageObjectPath(objectPath) ? objectPath : null;
    } catch {
        return null;
    }
}
