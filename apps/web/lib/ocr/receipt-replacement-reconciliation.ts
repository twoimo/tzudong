// A definitive CAS miss cannot be reinterpreted as a lost successful reply.
// Require an authoritative read for the exact target before compensating.
export function canDiscardReceiptReplacement(
    definitiveCasMiss: boolean,
    readFailed: boolean,
    value: unknown,
    reviewId: string,
    replacementPath: string,
): boolean {
    if (!definitiveCasMiss || readFailed) return false;
    if (value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return row.id === reviewId
        && (row.verification_photo === null || typeof row.verification_photo === 'string')
        && row.verification_photo !== replacementPath;
}
