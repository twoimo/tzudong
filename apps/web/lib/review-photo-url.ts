import { supabase } from '@/integrations/supabase/client';

const REVIEW_PHOTO_BUCKET = 'review-photos';
const REVIEW_PHOTO_PUBLIC_PATH = `/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/`;
const MAX_STORAGE_OBJECT_PATH_LENGTH = 1024;
const MAX_CACHE_BUSTER_LENGTH = 13;
const MAX_CACHE_BUSTER_VALUE = 9_999_999_999_999;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

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

function decodeStoragePathSegment(segment: string): string | null {
    let decoded = segment;

    for (let index = 0; index < 3; index += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) return next;
            decoded = next;
        } catch {
            return null;
        }
    }

    return decoded.includes('%') ? null : decoded;
}

function isCanonicalStorageObjectPath(path: string): boolean {
    if (
        !path ||
        path.length > MAX_STORAGE_OBJECT_PATH_LENGTH ||
        path !== path.trim() ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.includes('?') ||
        path.includes('#') ||
        path.includes(':') ||
        CONTROL_CHARACTER_PATTERN.test(path)
    ) {
        return false;
    }

    const segments = path.split('/');
    return segments.every((segment) => {
        if (!segment || segment === '.' || segment === '..') return false;

        const decoded = decodeStoragePathSegment(segment);
        return Boolean(
            decoded &&
            decoded !== '.' &&
            decoded !== '..' &&
            !decoded.includes('/') &&
            !decoded.includes('\\') &&
            !CONTROL_CHARACTER_PATTERN.test(decoded),
        );
    });
}

function getBoundedCacheBuster(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length > 64 || CONTROL_CHARACTER_PATTERN.test(value)) return null;

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_CACHE_BUSTER_VALUE) return null;

    return String(Math.trunc(timestamp));
}

function hasOnlyBoundedCacheBuster(url: URL): boolean {
    if (!url.search) return true;
    if (!/^\?t=(?:0|[1-9]\d{0,12})$/.test(url.search)) return false;

    const value = Number(url.searchParams.get('t'));
    return Number.isSafeInteger(value) && value <= MAX_CACHE_BUSTER_VALUE;
}

function resolveAbsoluteReviewPhotoUrl(
    value: string,
    cacheBuster?: string | null,
): string | null {
    const origin = getConfiguredSupabaseOrigin();
    if (!origin || value.length > origin.length + REVIEW_PHOTO_PUBLIC_PATH.length + MAX_STORAGE_OBJECT_PATH_LENGTH + MAX_CACHE_BUSTER_LENGTH + 3) {
        return null;
    }

    const expectedPrefix = `${origin}${REVIEW_PHOTO_PUBLIC_PATH}`;
    if (!value.startsWith(expectedPrefix)) return null;

    const objectPathAndQuery = value.slice(expectedPrefix.length);
    const queryIndex = objectPathAndQuery.indexOf('?');
    const objectPath = queryIndex === -1 ? objectPathAndQuery : objectPathAndQuery.slice(0, queryIndex);
    if (!isCanonicalStorageObjectPath(objectPath)) return null;

    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.origin !== origin ||
            url.username ||
            url.password ||
            url.port ||
            url.hash ||
            !hasOnlyBoundedCacheBuster(url)
        ) {
            return null;
        }

        const normalizedCacheBuster = getBoundedCacheBuster(cacheBuster);
        if (normalizedCacheBuster) {
            url.search = `?t=${normalizedCacheBuster}`;
        }

        return url.toString();
    } catch {
        return null;
    }
}

export function resolveReviewPhotoUrl(
    value: string | null | undefined,
    cacheBuster?: string | null,
): string | null {
    if (
        typeof value !== 'string' ||
        !value ||
        value.length > MAX_STORAGE_OBJECT_PATH_LENGTH + 2048 ||
        value !== value.trim() ||
        value.includes('\\') ||
        CONTROL_CHARACTER_PATTERN.test(value)
    ) {
        return null;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
        return resolveAbsoluteReviewPhotoUrl(value, cacheBuster);
    }

    if (!isCanonicalStorageObjectPath(value)) return null;

    try {
        const publicUrl = supabase.storage.from(REVIEW_PHOTO_BUCKET).getPublicUrl(value).data.publicUrl;
        return resolveAbsoluteReviewPhotoUrl(publicUrl, cacheBuster);
    } catch {
        return null;
    }
}
