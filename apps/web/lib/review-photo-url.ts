import { resolveConfiguredSupabaseOrigin } from '@/lib/profile-avatar-url';

const REVIEW_PHOTO_BUCKET = 'review-photos';
const REVIEW_PHOTO_PUBLIC_PATH = `/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/`;
const MAX_STORAGE_OBJECT_PATH_LENGTH = 1024;
const MAX_CACHE_BUSTER_VALUE = 9_999_999_999_999;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const SAFE_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpe?g|png|webp)$/i;
const MAX_FILENAME_LENGTH = 240;
// Object keys written by the review composer before this module enforced the
// canonical layout: "<owner>/<epoch>_food_<index>_<name>.<ext>" and
// "<owner>/<epoch>_verification_<name>.<ext>". They stay owner- and
// purpose-bound, but carry no review binding.
const LEGACY_REVIEW_PHOTO_FILENAME_PATTERN =
    /^\d{10,16}_(food_\d{1,3}|verification)_[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(?:avif|jpe?g|png|webp)$/;

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

/**
 * Resolves the historical composer layout for display only. The stored value
 * must still address the requesting owner and the requested purpose, so a
 * legacy key can never expose another user's object. Cleanup and writes keep
 * using the canonical layout exclusively.
 */
export function getLegacyReviewPhotoObjectPath(
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

    const segments = value.split('/');
    if (segments.length !== 2) return null;

    const [ownerId, filename] = segments;
    const match = LEGACY_REVIEW_PHOTO_FILENAME_PATTERN.exec(filename);
    if (!match || ownerId !== ownership.ownerId || !isCanonicalIdentifier(ownerId)) {
        return null;
    }

    const legacyPurpose = match[1].startsWith('food_') ? 'food' : 'verification';
    return legacyPurpose === ownership.purpose ? value : null;
}

/**
 * Normalizes an uploaded filename into the canonical filename grammar. Uploads
 * from browsers can carry Korean or otherwise unsafe names, so the extension is
 * replaced with a known image extension when the original cannot be admitted.
 */
export function normalizeReviewPhotoFilename(
    value: string,
    fallbackExtension = '.webp',
): string | null {
    if (typeof value !== 'string' || value !== value.trim() || !value) return null;
    if (!/^\.[A-Za-z0-9]{1,8}$/.test(fallbackExtension)) return null;

    const withSafeCharacters = value
        .normalize('NFKD')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/_{2,}/g, '_');
    const separatorIndex = withSafeCharacters.lastIndexOf('.');
    const stem = (separatorIndex > 0
        ? withSafeCharacters.slice(0, separatorIndex)
        : withSafeCharacters
    ).replace(/^[^A-Za-z0-9]+/, '').slice(0, MAX_FILENAME_LENGTH - fallbackExtension.length);
    const candidateExtension = separatorIndex > 0
        ? withSafeCharacters.slice(separatorIndex)
        : fallbackExtension;
    const extension = SAFE_IMAGE_EXTENSION_PATTERN.test(candidateExtension)
        ? candidateExtension.toLowerCase()
        : fallbackExtension;

    const filename = `${stem || 'photo'}${extension}`;
    return SAFE_FILENAME_PATTERN.test(filename) && filename.length <= MAX_FILENAME_LENGTH
        ? filename
        : null;
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

        // 경로마다 순차로 왕복하던 읽기 검증을 한 번의 왕복으로 모읍니다.
        // 판정 결과는 이전 구현과 같습니다(하나라도 실패하면 success: false).
        const readbacks = await Promise.all(paths.map(async (path) => {
            const separatorIndex = path.lastIndexOf('/');
            const directory = path.slice(0, separatorIndex);
            const filename = path.slice(separatorIndex + 1);
            const { data, error: readbackError } = await storage.list(directory, {
                limit: 1,
                search: filename,
            });

            return !readbackError && data !== null && !data.some((entry) => entry.name === filename);
        }));

        if (readbacks.some((isAbsent) => !isAbsent)) {
            return { paths, success: false };
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

function extractSameOriginPublicReviewPhotoObjectPath(
    value: string | null | undefined,
    ownership: ReviewPhotoOwnership | string | null | undefined,
    configuredOrigin: string | null,
): string | null {
    if (typeof value !== 'string' || !configuredOrigin) return null;

    try {
        const url = new URL(value);
        if (
            url.origin !== configuredOrigin
            || url.username
            || url.password
            || url.hash
            || !url.pathname.startsWith(REVIEW_PHOTO_PUBLIC_PATH)
        ) {
            return null;
        }

        const encodedKey = url.pathname.slice(REVIEW_PHOTO_PUBLIC_PATH.length);
        if (!encodedKey) return null;

        const segments: string[] = [];
        for (const segment of encodedKey.split('/')) {
            if (!segment) return null;
            try {
                const decoded = decodeURIComponent(segment);
                if (decoded !== segment && /[\/?#]/.test(decoded)) return null;
                segments.push(decoded);
            } catch {
                return null;
            }
        }

        const objectPath = segments.join('/');
        return getCanonicalReviewPhotoObjectPath(objectPath, ownership)
            ?? getLegacyReviewPhotoObjectPath(objectPath, ownership);
    } catch {
        return null;
    }
}

function getOwnedReviewPhotoObjectPath(
    value: string | null | undefined,
    ownership: ReviewPhotoOwnership | string | null | undefined,
    configuredOrigin: string | null,
): string | null {
    return getCanonicalReviewPhotoObjectPath(value, ownership)
        ?? getLegacyReviewPhotoObjectPath(value, ownership)
        ?? extractSameOriginPublicReviewPhotoObjectPath(value, ownership, configuredOrigin);
}

export function resolveReviewPhotoUrl(
    value: string | null | undefined,
    ownership: ReviewPhotoOwnership | string | null | undefined,
    cacheBuster?: string | null,
): string | null {
    const configuredOrigin = resolveConfiguredSupabaseOrigin();
    const objectPath = getOwnedReviewPhotoObjectPath(value, ownership, configuredOrigin);
    if (!objectPath || !configuredOrigin) return null;

    try {
        const expectedPath = `${REVIEW_PHOTO_PUBLIC_PATH}${objectPath
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;
        const url = new URL(expectedPath, configuredOrigin);

        // The configured origin is already constrained by
        // resolveConfiguredSupabaseOrigin (hosted https origin or an explicitly
        // enabled loopback origin), so it is the authority here instead of a
        // hard-coded scheme or port.
        if (
            url.origin !== configuredOrigin ||
            url.username ||
            url.password ||
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
