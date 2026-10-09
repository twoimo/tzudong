import { getCanonicalReviewPhotoObjectPath, type ReviewPhotoOwnership } from '../review-photo-url';

function stringValues(values: unknown): string[] {
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

/** Existing DB values stay exact, including opaque and foreign historical
 * values. Only new owner/review-bound canonical keys can enter through drafts. */
export function getEditableFoodPhotoValues(
    values: unknown,
    originalValues: unknown,
    ownership: ReviewPhotoOwnership | null,
): string[] {
    const remaining = new Map<string, number>();
    for (const value of stringValues(originalValues)) {
        remaining.set(value, (remaining.get(value) ?? 0) + 1);
    }
    return stringValues(values).filter((value) => {
        const count = remaining.get(value) ?? 0;
        if (count > 0) {
            remaining.set(value, count - 1);
            return true;
        }
        return Boolean(getCanonicalReviewPhotoObjectPath(value, ownership));
    });
}

/** A draft omission is not a deletion instruction. Restore every original
 * value unless an explicit removal names it; admit new canonical keys only. */
export function restoreEditableFoodPhotoValues(
    originalValues: unknown,
    draftValues: unknown,
    removedValues: unknown,
    ownership: ReviewPhotoOwnership | null,
): string[] {
    const originals = stringValues(originalValues);
    const removed = new Map<string, number>();
    for (const value of getEditableFoodPhotoValues(removedValues, originals, ownership)) {
        removed.set(value, (removed.get(value) ?? 0) + 1);
    }
    const retained = originals.filter((value) => {
        const count = removed.get(value) ?? 0;
        if (count === 0) return true;
        removed.set(value, count - 1);
        return false;
    });
    const originalSet = new Set(originals);
    const additions = getEditableFoodPhotoValues(draftValues, originals, ownership)
        .filter((value) => !originalSet.has(value));
    return [...retained, ...new Set(additions)];
}
