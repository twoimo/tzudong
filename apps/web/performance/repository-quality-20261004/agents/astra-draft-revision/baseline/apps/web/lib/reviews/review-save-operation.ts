import { getCanonicalReviewPhotoObjectPath, type ReviewPhotoPurpose } from '@/lib/review-photo-url';

export interface ReviewSaveDraft {
    ownerId: string;
    restaurantId: string;
    title: string;
    content: string;
    visitedAt: string;
    categories: string[];
    verificationPhoto: File;
    foodPhotos: File[];
}

export interface ReviewSaveUpload {
    path: string;
    purpose: ReviewPhotoPurpose;
    file: File;
}

export interface SavedReviewReadback {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    verification_photo: string | null;
    food_photos: string[] | null;
}

export interface ReviewSaveDependencies {
    currentOwner(): string | undefined;
    newId(): string;
    captureDraftDeletion?(draft: ReviewSaveDraft): Promise<() => Promise<boolean>>;
    prepare(draft: ReviewSaveDraft, reviewId: string): Promise<ReviewSaveUpload[]>;
    upload(upload: ReviewSaveUpload): Promise<{ error: unknown }>;
    verifyUpload?(upload: ReviewSaveUpload): Promise<boolean>;
    insert(draft: ReviewSaveDraft, reviewId: string, uploads: ReviewSaveUpload[]): PromiseLike<{ error: unknown }>;
    read(ownerId: string, reviewId: string): PromiseLike<{ data: SavedReviewReadback | null; error: unknown }>;
    cleanup(ownerId: string, reviewId: string, uploads: ReviewSaveUpload[]): Promise<boolean>;
}

export type ReviewSaveResult = 'saved' | 'saved-previous' | 'failed' | 'blocked' | 'cancelled';
export type ReviewSaveCancellation = { status: 'cancelled' | 'blocked' } | { status: 'saved'; draft: ReviewSaveDraft };
type Operation = {
    id: string;
    draft: ReviewSaveDraft;
    uploads: ReviewSaveUpload[];
    touched: Set<ReviewSaveUpload>;
    availableUploads: Set<ReviewSaveUpload>;
    unansweredUploads: Set<ReviewSaveUpload>;
    write: 'none' | 'rejected' | 'unknown' | 'saved';
    draftDeletion?: () => Promise<boolean>;
};

function sameDraft(a: ReviewSaveDraft, b: ReviewSaveDraft): boolean {
    return a.ownerId === b.ownerId && a.restaurantId === b.restaurantId && a.title === b.title
        && a.content === b.content && a.visitedAt === b.visitedAt
        && a.categories.length === b.categories.length && a.categories.every((value, i) => value === b.categories[i])
        && a.verificationPhoto === b.verificationPhoto
        && a.foodPhotos.length === b.foodPhotos.length && a.foodPhotos.every((file, i) => file === b.foodPhotos[i]);
}

// Only explicit transaction rejections are definite. In particular, a duplicate
// key or transport error may follow an earlier committed, unanswered insert.
function isDefiniteRejection(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return ['42501', '23502', '23503', '23514', '22001', '22007', '22P02'].includes(String(error.code));
}

function isDefiniteUploadRejection(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    // Storage errors are HTTP outcomes, not Postgres transaction receipts.
    // A SQL-looking code cannot override an unknown HTTP result.
    const status = 'statusCode' in error ? error.statusCode : 'status' in error ? error.status : undefined;
    // Validation/auth rejection precedes a write. Duplicate, server and transport
    // failures can follow a committed or still-running upload.
    return ['400', '401', '403', '413', '415', '422'].includes(String(status));
}

/** One memory-only operation per mounted composer, O(current photo count).
 * Unresolved operations block replacement; retries cannot grow an upload log.
 * File identity is deliberate: reselecting a file is a new draft, without
 * hashing/persisting receipt contents or weakening the draft privacy contract.
 */
export class ReviewSaveOperation {
    private operation: Operation | null = null;
    private active: Promise<unknown> | null = null;
    private cancelling = false;

    constructor(private readonly deps: ReviewSaveDependencies) {}

    submit(draft: ReviewSaveDraft): Promise<ReviewSaveResult> {
        if (this.active) return Promise.resolve('blocked');
        this.cancelling = false;
        const pending = this.run(draft).catch((): ReviewSaveResult => 'blocked').finally(() => { this.active = null; });
        this.active = pending;
        return pending;
    }

    requestCancel(): void { this.cancelling = true; }

    async clearSavedDraft(): Promise<boolean> {
        const op = this.operation;
        if (op?.write !== 'saved' || !op.draftDeletion) return false;
        try { return await op.draftDeletion(); }
        catch { return false; }
    }

    releaseSaved(): void {
        if (!this.active && this.operation?.write === 'saved') this.operation = null;
    }

    async cancel(): Promise<ReviewSaveCancellation> {
        this.requestCancel();
        // Wait for every started upload/write before considering compensation.
        // Hold the same lock during cleanup so a concurrent submit cannot race it.
        if (this.active) await this.active;
        if (this.active) return { status: 'blocked' };
        const pending = this.finishCancellation();
        this.active = pending;
        try { return await pending; }
        finally { this.active = null; }
    }

    private owns(op: Operation): boolean { return this.deps.currentOwner() === op.draft.ownerId; }

    private savedResult(op: Operation, draft: ReviewSaveDraft): ReviewSaveResult | null {
        return op.write === 'saved' ? (sameDraft(op.draft, draft) ? 'saved' : 'saved-previous') : null;
    }

    private async read(op: Operation): Promise<'saved' | 'absent' | 'blocked'> {
        if (!this.owns(op)) return 'blocked';
        try {
            const { data, error } = await this.deps.read(op.draft.ownerId, op.id);
            if (error || !this.owns(op)) return 'blocked';
            if (!data) return 'absent';
            const verification = op.uploads.find(upload => upload.purpose === 'verification')?.path;
            const food = op.uploads.filter(upload => upload.purpose === 'food').map(upload => upload.path);
            if (data.id !== op.id || data.user_id !== op.draft.ownerId
                || data.restaurant_id !== op.draft.restaurantId || data.verification_photo !== verification
                || !data.food_photos || data.food_photos.length !== food.length
                || !data.food_photos.every((path, i) => path === food[i])) return 'blocked';
            op.write = 'saved';
            return 'saved';
        } catch { return 'blocked'; }
    }

    private async cleanup(op: Operation): Promise<boolean> {
        if (!this.owns(op)) return false;
        if (op.write === 'saved') return true;
        if (op.touched.size === 0) return true;
        const readback = await this.read(op);
        if (readback === 'saved') return true;
        // An empty row/object read does NOT prove an unanswered request ended.
        // Even a later successful retry/metadata read cannot authorize deletion:
        // the earlier upload could still recreate its key after that deletion.
        if (readback !== 'absent' || op.write === 'unknown' || op.unansweredUploads.size > 0 || !this.owns(op)) return false;
        try {
            if (!await this.deps.cleanup(op.draft.ownerId, op.id, [...op.touched])) return false;
            op.touched.clear();
            op.availableUploads.clear();
            return true;
        } catch { return false; }
    }

    private async finishCancellation(): Promise<ReviewSaveCancellation> {
        const op = this.operation;
        if (op && !await this.cleanup(op)) return { status: 'blocked' };
        // Keep idempotency until the composer has finished local draft cleanup.
        if (op?.write === 'saved') return { status: 'saved', draft: op.draft };
        this.operation = null;
        return { status: 'cancelled' };
    }

    private async run(draft: ReviewSaveDraft): Promise<ReviewSaveResult> {
        if (this.deps.currentOwner() !== draft.ownerId) return 'blocked';
        let op = this.operation;
        if (op) {
            if (!this.owns(op)) return 'blocked';
            if (op.write === 'unknown') {
                const readback = await this.read(op);
                if (readback === 'blocked') return 'blocked';
                if (readback === 'absent' && !sameDraft(op.draft, draft)) return 'blocked';
            }
            const saved = this.savedResult(op, draft);
            if (saved) return saved;
            if (op.unansweredUploads.size > 0 && !sameDraft(op.draft, draft)) return 'blocked';
            if (op.unansweredUploads.size === 0 && op.write !== 'unknown' && op.touched.size && !await this.cleanup(op)) return 'blocked';
            const recovered = this.savedResult(op, draft);
            if (recovered) return recovered;
            if (!sameDraft(op.draft, draft)) { this.operation = null; op = null; }
        }
        if (this.cancelling) return 'cancelled';
        if (!op) {
            op = {
                id: this.deps.newId(),
                draft: { ...draft, categories: [...draft.categories], foodPhotos: [...draft.foodPhotos] },
                uploads: [], touched: new Set(), availableUploads: new Set(), unansweredUploads: new Set(), write: 'none',
            };
            this.operation = op;
        }
        const current = op;
        // Snapshot belongs to this exact review ID, including cleanup retries.
        // Never recapture a replacement draft after a committed/unknown write.
        if (this.deps.captureDraftDeletion && !current.draftDeletion) {
            try { current.draftDeletion = await this.deps.captureDraftDeletion(current.draft); }
            catch { return 'blocked'; }
            if (this.cancelling || !this.owns(current)) return 'cancelled';
        }
        if (current.write !== 'unknown') {
            try {
                if (!current.uploads.length) {
                    const uploads = await this.deps.prepare(current.draft, current.id);
                    // Only operation-owned, unique canonical paths enter the ledger.
                    if (uploads.length !== current.draft.foodPhotos.length + 1
                        || uploads.filter(upload => upload.purpose === 'verification').length !== 1
                        || new Set(uploads.map(upload => upload.path)).size !== uploads.length
                        || uploads.some(upload => !getCanonicalReviewPhotoObjectPath(upload.path, {
                            ownerId: current.draft.ownerId, reviewId: current.id, purpose: upload.purpose,
                        }))) return 'failed';
                    current.uploads = uploads;
                }
                if (this.cancelling || !this.owns(current)) return 'cancelled';
                const uploadOne = async (upload: ReviewSaveUpload) => {
                    if (!this.owns(current) || this.cancelling) throw new Error('REVIEW_UPLOAD_CANCELLED');
                    if (current.availableUploads.has(upload)) return;
                    if (current.unansweredUploads.has(upload) && this.deps.verifyUpload) {
                        let available = false;
                        try { available = await this.deps.verifyUpload(upload); } catch { /* Unverified remains uncertain. */ }
                        if (!this.owns(current) || this.cancelling) throw new Error('REVIEW_UPLOAD_CANCELLED');
                        if (available) { current.availableUploads.add(upload); return; }
                    }
                    current.touched.add(upload); // includes lost upload replies
                    try {
                        // Retry the same prepared bytes/path with upsert:false.
                        // Never infer rollback from an absent object or row.
                        const { error } = await this.deps.upload(upload);
                        if (!error) { current.availableUploads.add(upload); return; }
                        if (!isDefiniteUploadRejection(error)) current.unansweredUploads.add(upload);
                    } catch { current.unansweredUploads.add(upload); }
                    throw new Error('REVIEW_PHOTO_UPLOAD_FAILED');
                };
                // Keep receipt-first / parallel-food upload behavior. Wait for
                // late successful siblings before compensating partial failure.
                await uploadOne(current.uploads.find(upload => upload.purpose === 'verification')!);
                if (this.cancelling || !this.owns(current)) {
                    return await this.cleanup(current) ? 'cancelled' : 'blocked';
                }
                const results = await Promise.allSettled(current.uploads.filter(upload => upload.purpose === 'food').map(uploadOne));
                if (results.some(result => result.status === 'rejected')) {
                    return await this.cleanup(current) ? 'failed' : 'blocked';
                }
            } catch {
                return await this.cleanup(current) ? 'failed' : 'blocked';
            }
        }
        if (this.cancelling || !this.owns(current)) {
            return await this.cleanup(current) ? 'cancelled' : 'blocked';
        }
        const wasUnknown = current.write === 'unknown';
        current.write = 'unknown'; // set before dispatch, including thrown failures
        try {
            const { error } = await this.deps.insert(current.draft, current.id, current.uploads);
            if (!error) { current.write = 'saved'; return 'saved'; }
            if (!wasUnknown && isDefiniteRejection(error)) current.write = 'rejected';
        } catch { /* Never retain provider diagnostics. */ }
        const readback = await this.read(current);
        if (readback === 'saved') return 'saved';
        if (readback === 'blocked' || current.write === 'unknown') return 'blocked';
        return await this.cleanup(current) ? 'failed' : 'blocked';
    }
}
