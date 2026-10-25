// A distinct persisted owner key isolates current drafts from already loaded
// legacy clients. Public owner IDs and draft schemas stay unchanged. Legacy
// sweep validators accept this bounded identifier, but their owner-specific
// save/delete/list operations cannot address it.
const CURRENT_OWNER_PREFIX = 'v3-';
export function draftStorageOwnerKey(userId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(userId) || userId.length > 125) {
        throw new Error('DRAFT_OWNER_INVALID');
    }
    return CURRENT_OWNER_PREFIX + userId;
}
export function draftPublicOwnerId(storedOwner: string): string {
    if (!storedOwner.startsWith(CURRENT_OWNER_PREFIX)) throw new Error('DRAFT_OWNER_INVALID');
    return storedOwner.slice(CURRENT_OWNER_PREFIX.length);
}

export function legacyDraftStorageOwnerKeys(userId: string): string[] {
    draftStorageOwnerKey(userId);
    return ['v2-' + userId, userId];
}
