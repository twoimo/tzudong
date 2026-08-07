import { resolveConfiguredSupabaseOrigin } from '@/lib/profile-avatar-url';
import { supabase } from '@/integrations/supabase/client';

const REVIEW_PHOTO_BUCKET = 'review-photos';
const REVIEW_PHOTO_PUBLIC_PATH = `/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/`;
const MAX_STORAGE_OBJECT_PATH_LENGTH = 1024;
const MAX_CACHE_BUSTER_VALUE = 9_999_999_999_999;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const SAFE_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/i;

export type ReviewPhotoPurpose = 'food' | 'verification';

export interface ReviewPhotoOwnership {
    ownerId: string;
    reviewId: string;
    purpose: ReviewPhotoPurpose;
}


function isCanonicalIdentifier(value: string): boolean {
    return SAFE_IDENTIFIER_PATTERN.test(value);
}

function isCanonicalReviewPhotoOwnership(
    ownership: ReviewPhotoOwnership | string | null | undefined,
): ownership is ReviewPhotoOwnership {
    return Boolean(
        ownership &&
        typeof ownership === 'object' &&
        isCanonicalIdentifier(ownership.ownerId) &&
        isCanonicalIdentifier(ownership.reviewId) &&
        (ownership.purpose === 'food' || ownership.purpose === 'verification'),
    );
}

function isSafeObjectKey(value: string): boolean {
    return Boolean(
        value &&
        value.length <= MAX_STORAGE_OBJECT_PATH_LENGTH &&
        value === value.trim() &&
        !value.startsWith('/') &&
        !value.includes('\\') &&
        !value.includes('%') &&
        !value.includes('?') &&
        !value.includes('#') &&
        !value.includes(':') &&
        !CONTROL_CHARACTER_PATTERN.test(value),
    );
}

function getBoundedCacheBuster(value: string | null | undefined): string | null {
    if (!value || value.length > 64 || CONTROL_CHARACTER_PATTERN.test(value)) return null;

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_CACHE_BUSTER_VALUE) return null;

    return String(Math.trunc(timestamp));
}

export function getCanonicalReviewPhotoObjectPath(
    value: string | null | undefined,
    ownership: ReviewPhotoOwnership | string | null | undefined,
): string | null {
    if (
        typeof value !== 'string' ||
        !isSafeObjectKey(value) ||
        !isCanonicalReviewPhotoOwnership(ownership)
    ) {
        return null;
    }

    const [ownerId, reviewDirectory, reviewId, purpose, filename, ...extraSegments] = value.split('/');
    if (
        extraSegments.length > 0 ||
        ownerId !== ownership.ownerId ||
        reviewDirectory !== 'reviews' ||
        reviewId !== ownership.reviewId ||
        purpose !== ownership.purpose ||
        !isCanonicalIdentifier(ownerId) ||
        !isCanonicalIdentifier(reviewId) ||
        !SAFE_FILENAME_PATTERN.test(filename) ||
        !SAFE_IMAGE_EXTENSION_PATTERN.test(filename)
    ) {
        return null;
    }

    return value;
}
export function getCanonicalReviewPhotoObjectPaths(
    values: unknown,
    ownership: ReviewPhotoOwnership | string | null | undefined,
): string[] {
    if (!Array.isArray(values)) return [];

    const paths = new Set<string>();
    for (const value of values) {
        const path = getCanonicalReviewPhotoObjectPath(
            typeof value === 'string' ? value : null,
            ownership,
        );
        if (path) paths.add(path);
    }

    return [...paths];
}

export interface ReviewPhotoStorage {
    remove(paths: string[]): Promise<{ error: unknown | null }>;
    list(
        path: string,
        options: { limit: number; search: string },
    ): Promise<{ data: Array<{ name: string }> | null; error: unknown | null }>;
}

export interface ReviewPhotoCleanupResult {
    paths: string[];
    success: boolean;
}

/**
 * Deletes only canonical, owner- and review-bound objects. A successful remove
 * is not committed until a storage list readback proves each object is absent.
 * `paths` is always the exact canonical retry set when `success` is false.
 */
export async function cleanupCanonicalReviewPhotoObjects(
    values: unknown,
    ownership: ReviewPhotoOwnership | string | null | undefined,
    storage: ReviewPhotoStorage,
): Promise<ReviewPhotoCleanupResult> {
    const paths = getCanonicalReviewPhotoObjectPaths(values, ownership);
    if (paths.length === 0) return { paths, success: true };

    try {
        const { error: removeError } = await storage.remove(paths);
        if (removeError) return { paths, success: false };

        for (const path of paths) {
            const separatorIndex = path.lastIndexOf('/');
            const directory = path.slice(0, separatorIndex);
            const filename = path.slice(separatorIndex + 1);
            const { data, error: readbackError } = await storage.list(directory, {
                limit: 1,
                search: filename,
            });

            if (
                readbackError ||
                !data ||
                data.some((entry) => entry.name === filename)
            ) {
                return { paths, success: false };
            }
        }

        return { paths, success: true };
    } catch {
        return { paths, success: false };
    }
}

export function buildReviewPhotoObjectPath(
    ownership: ReviewPhotoOwnership,
    filename: string,
): string | null {
    if (!isCanonicalReviewPhotoOwnership(ownership)) return null;

    return getCanonicalReviewPhotoObjectPath(
        `${ownership.ownerId}/reviews/${ownership.reviewId}/${ownership.purpose}/${filename}`,
        ownership,
    );
}

export function resolveReviewPhotoUrl(
    value: string | null | undefined,
    ownership: ReviewPhotoOwnership | string | null | undefined,
    cacheBuster?: string | null,
): string | null {
    const objectPath = getCanonicalReviewPhotoObjectPath(value, ownership);
    const configuredOrigin = resolveConfiguredSupabaseOrigin();
    if (!objectPath || !configuredOrigin) return null;

    try {
        const publicUrl = supabase.storage
            .from(REVIEW_PHOTO_BUCKET)
            .getPublicUrl(objectPath)
            .data.publicUrl;
        const url = new URL(publicUrl);
        const expectedPath = `${REVIEW_PHOTO_PUBLIC_PATH}${objectPath
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;

        if (
            url.protocol !== 'https:' ||
            url.origin !== configuredOrigin ||
            url.username ||
            url.password ||
            url.port ||
            url.pathname !== expectedPath ||
            url.search ||
            url.hash
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
