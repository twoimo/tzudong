import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { buildReviewPhotoObjectPath, getCanonicalReviewPhotoObjectPath, getLegacyReviewPhotoObjectPath } from '@/lib/review-photo-url';

export type ReviewMutationCode = 'REVIEW_COMMITTED' | 'REVIEW_CLEANUP_PENDING' | 'REVIEW_NOT_CONFIRMED'
    | 'REVIEW_NOT_FOUND' | 'REVIEW_UNAUTHORIZED' | 'REVIEW_CONFLICT' | 'REVIEW_INVALID'
    | 'REVIEW_MEDIA_MISSING' | 'REVIEW_UPLOAD_FAILED';
export type ReviewMutationResult = { committed: boolean; code: ReviewMutationCode };
export type ReviewMediaRow = {
    id: string; user_id: string; updated_at: string; content: string;
    categories: string[] | null; food_photos: string[] | null;
};
type Reply = { data: unknown; error: unknown };
type Upload = { path: string; file: File; available: boolean };
export type ReviewMutationInput = {
    ownerId: string; reviewId: string; kind: 'edit' | 'delete';
    edit?: { content: string; categories: string[]; foodPhotos: string[]; files: File[];
        original: { content: string; categories: string[]; foodPhotos: string[] } };
};
export interface ReviewMediaDependencies {
    owner(): string | undefined;
    id(): string;
    read(reviewId: string, ownerId: string): PromiseLike<{ data: ReviewMediaRow | null; error: unknown }>;
    rpc(name: string, args?: Record<string, unknown>): PromiseLike<Reply>;
    prepare(file: File): Promise<File>;
    upload(path: string, file: File): PromiseLike<{ error: unknown }>;
    exists(path: string): Promise<boolean>;
    remove(paths: string[], purpose?: 'food' | 'verification'): PromiseLike<{ error: unknown }>;
}
const rejectedCodes = new Set<ReviewMutationCode>([
    'REVIEW_NOT_FOUND', 'REVIEW_UNAUTHORIZED', 'REVIEW_CONFLICT', 'REVIEW_INVALID', 'REVIEW_MEDIA_MISSING',
]);
const result = (code: ReviewMutationCode): ReviewMutationResult => ({
    code, committed: code === 'REVIEW_COMMITTED' || code === 'REVIEW_CLEANUP_PENDING',
});
export function reviewMutationMessage(code: ReviewMutationCode): string {
    switch (code) {
        case 'REVIEW_COMMITTED': return '리뷰 변경이 완료되었습니다.';
        case 'REVIEW_CLEANUP_PENDING': return '리뷰 변경은 완료되었지만 사진 정리가 남아 있습니다. 나의 리뷰에서 사진 정리를 다시 시도해 주세요.';
        case 'REVIEW_NOT_FOUND': return '리뷰가 없거나 수정 권한이 없습니다. 목록을 다시 불러와 주세요.';
        case 'REVIEW_UNAUTHORIZED': return '로그인 상태를 확인한 뒤 다시 시도해 주세요.';
        case 'REVIEW_CONFLICT': return '리뷰가 다른 곳에서 변경되었습니다. 창을 닫고 최신 목록을 불러와 다시 수정해 주세요.';
        case 'REVIEW_INVALID': return '리뷰 내용과 사진을 확인해 주세요.';
        case 'REVIEW_MEDIA_MISSING': return '사진 업로드를 확인하지 못했습니다. 사진을 확인하고 다시 시도해 주세요.';
        case 'REVIEW_UPLOAD_FAILED': return '사진 업로드를 확인하지 못했습니다. 다시 시도하면 같은 사진의 업로드 상태부터 확인합니다.';
        default: return '저장 결과를 확인하지 못했습니다. 사진은 삭제하지 않았습니다. 같은 요청을 다시 확인해 주세요.';
    }
}

/** Bounded drain of an owner-only durable queue. The DB retires keys under the
 * same lock as review reference writes and verifies Storage metadata absence.
 * No client path, resolved remove response or missing review is deletion proof.
 */
export async function retryReviewMediaCleanup(deps: ReviewMediaDependencies, ownerId: string): Promise<boolean> {
    if (deps.owner() !== ownerId) return false;
    try {
        const pending = await deps.rpc('pending_review_media_cleanup');
        if (pending.error || !Array.isArray(pending.data) || deps.owner() !== ownerId) return false;
        const paths: string[] = [];
        const verificationPaths: string[] = [];
        for (const item of pending.data) {
            if (!item || typeof item !== 'object') return false;
            const { path, owner_id, review_id, purpose } = item as Record<string, unknown>;
            if (owner_id !== ownerId || typeof review_id !== 'string' || typeof path !== 'string'
                || (purpose !== 'food' && purpose !== 'verification')
                || !(getCanonicalReviewPhotoObjectPath(path, { ownerId, reviewId: review_id, purpose })
                    || getLegacyReviewPhotoObjectPath(path, { ownerId, reviewId: review_id, purpose }))) return false;
            if (purpose === 'verification') verificationPaths.push(path);
            else paths.push(path);
        }
        if (paths.length + verificationPaths.length > 20) return false;
        if (paths.length || verificationPaths.length) {
            // Even an error may follow a partial or complete delete. Read back
            // through the DB; unremoved objects remain queued across revisits.
            await Promise.all(([[paths, 'food'], [verificationPaths, 'verification']] as const).map(async ([keys, purpose]) => {
                if (!keys.length) return;
                try { await deps.remove(keys, purpose); } catch { /* fixed-code readback below */ }
            }));
        }
        if (deps.owner() !== ownerId) return false;
        const finished = await deps.rpc('finish_review_media_cleanup');
        return !finished.error && finished.data === 0 && deps.owner() === ownerId;
    } catch { return false; }
}

type Operation = { input: ReviewMutationInput; args: Record<string, unknown>; uploads: Upload[]; sent: boolean; rejection?: ReviewMutationCode };
/** One frozen request per editor/delete confirmation. Retries reuse the exact
 * operation ID and payload; the atomic receipt proves this commit even if a
 * later moderation/edit changed the row. Never compensate an unanswered write.
 * Only IDs and hashes are stored in commit receipts, never request bodies.
 */
export class ReviewMediaMutation {
    private operation: Operation | null = null;
    private active: Promise<ReviewMutationResult> | null = null;
    private activeInput: ReviewMutationInput | null = null;
    constructor(private readonly deps: ReviewMediaDependencies) {}
    get pending(): boolean { return this.operation !== null; }
    run(input: ReviewMutationInput): Promise<ReviewMutationResult> {
        if (this.active) {
            return this.activeInput?.ownerId === input.ownerId && this.activeInput.reviewId === input.reviewId && this.activeInput.kind === input.kind
                ? this.active : Promise.resolve(result('REVIEW_NOT_CONFIRMED'));
        }
        this.activeInput = input;
        this.active = this.perform(input).catch(() => result('REVIEW_NOT_CONFIRMED')).finally(() => {
            this.active = null;
            this.activeInput = null;
        });
        return this.active;
    }
    private async perform(input: ReviewMutationInput): Promise<ReviewMutationResult> {
        if (this.deps.owner() !== input.ownerId) return result('REVIEW_UNAUTHORIZED');
        if (this.operation && (this.operation.input.ownerId !== input.ownerId
            || this.operation.input.reviewId !== input.reviewId || this.operation.input.kind !== input.kind)) {
            return result('REVIEW_NOT_CONFIRMED');
        }
        if (!this.operation) {
            const row = await this.deps.read(input.reviewId, input.ownerId);
            if (row.error) return result('REVIEW_NOT_CONFIRMED');
            if (!row.data || row.data.id !== input.reviewId || row.data.user_id !== input.ownerId) return result('REVIEW_NOT_FOUND');
            const edit = input.edit;
            if (input.kind === 'edit' && (!edit || row.data.content !== edit.original.content
                || JSON.stringify(row.data.categories ?? []) !== JSON.stringify(edit.original.categories)
                || JSON.stringify(row.data.food_photos ?? []) !== JSON.stringify(edit.original.foodPhotos))) {
                return result('REVIEW_CONFLICT');
            }
            const operationId = this.deps.id();
            // A client deployed ahead of its migration must fail before upload.
            const capability = await this.deps.rpc('read_review_media_commit', {
                p_operation_id: operationId, p_review_id: input.reviewId, p_kind: input.kind,
            });
            if (capability.error || capability.data !== 'REVIEW_NOT_CONFIRMED') return result('REVIEW_NOT_CONFIRMED');
            if (this.deps.owner() !== input.ownerId) return result('REVIEW_UNAUTHORIZED');
            const uploads: Upload[] = [];
            for (const [index, file] of (edit?.files ?? []).entries()) {
                const prepared = await this.deps.prepare(file);
                const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif', 'image/webp': 'webp' }[prepared.type];
                const path = extension && buildReviewPhotoObjectPath({ ownerId: input.ownerId, reviewId: input.reviewId, purpose: 'food' }, `${operationId}_${index}.${extension}`);
                if (!path) return result('REVIEW_INVALID');
                uploads.push({ path, file: prepared, available: false });
            }
            this.operation = { input, uploads, sent: false, args: {
                p_operation_id: operationId, p_review_id: input.reviewId, p_kind: input.kind,
                p_expected_updated_at: row.data.updated_at,
                p_content: edit?.content.trim() ?? null, p_categories: edit ? [...edit.categories] : null,
                p_food_photos: edit ? [...edit.foodPhotos, ...uploads.map(upload => upload.path)] : null,
            } };
        }
        const op = this.operation;
        if (op.rejection) return this.discardRejected(op);
        // Always query this operation's receipt before any retransmission once a
        // write may have reached the DB (including a resolved PostgREST error).
        if (op.sent && await this.confirm(op)) return this.finish(input.ownerId);
        for (const upload of op.uploads) {
            if (this.deps.owner() !== input.ownerId) return result('REVIEW_UNAUTHORIZED');
            if (upload.available) continue;
            if (await this.deps.exists(upload.path)) { upload.available = true; continue; }
            try {
                const reply = await this.deps.upload(upload.path, upload.file);
                if (!reply.error) { upload.available = true; continue; }
            } catch { /* The upload may have completed. */ }
            if (!await this.deps.exists(upload.path)) return result('REVIEW_UPLOAD_FAILED');
            upload.available = true;
        }
        if (this.deps.owner() !== input.ownerId) return result('REVIEW_UNAUTHORIZED');
        op.sent = true;
        let reply: Reply | undefined;
        try { reply = await this.deps.rpc('mutate_review_with_media', op.args); } catch { /* exact readback below */ }
        if (await this.confirm(op)) return this.finish(input.ownerId);
        // Only a fixed, transactional RPC rejection is definitive. An SDK
        // error object, including a SQL code, never authorizes compensation.
        if (reply && !reply.error && rejectedCodes.has(reply.data as ReviewMutationCode)) {
            op.rejection = reply.data as ReviewMutationCode;
            return this.discardRejected(op);
        }
        return result('REVIEW_NOT_CONFIRMED');
    }
    private async discardRejected(op: Operation): Promise<ReviewMutationResult> {
        if (this.deps.owner() !== op.input.ownerId) return result('REVIEW_UNAUTHORIZED');
        if (op.uploads.length) {
            try {
                const queued = await this.deps.rpc('queue_review_upload_cleanup', {
                    p_review_id: op.input.reviewId, p_paths: op.uploads.map(upload => upload.path),
                });
                if (queued.error || queued.data !== 'REVIEW_CLEANUP_QUEUED') return result('REVIEW_NOT_CONFIRMED');
            } catch { return result('REVIEW_NOT_CONFIRMED'); }
            // Durable queue owns retries now; live uploads are excluded by DB.
            await retryReviewMediaCleanup(this.deps, op.input.ownerId);
        }
        this.operation = null;
        return result(op.rejection!);
    }
    private async confirm(op: Operation): Promise<boolean> {
        if (this.deps.owner() !== op.input.ownerId) return false;
        try {
            const reply = await this.deps.rpc('read_review_media_commit', {
                p_operation_id: op.args.p_operation_id, p_review_id: op.input.reviewId, p_kind: op.input.kind,
            });
            return !reply.error && reply.data === 'REVIEW_COMMITTED' && this.deps.owner() === op.input.ownerId;
        } catch { return false; }
    }
    private async finish(ownerId: string): Promise<ReviewMutationResult> {
        this.operation = null;
        return result(await retryReviewMediaCleanup(this.deps, ownerId) ? 'REVIEW_COMMITTED' : 'REVIEW_CLEANUP_PENDING');
    }
}

export function createReviewMediaDependencies(
    client: SupabaseClient<Database>, owner: () => string | undefined,
    prepare: (file: File) => Promise<File> = async file => file,
): ReviewMediaDependencies {
    // New migration RPCs are isolated here until the hosted type snapshot is
    // regenerated. No remote schema introspection is needed for this sidecar.
    const rpc = client.rpc.bind(client) as unknown as ReviewMediaDependencies['rpc'];
    const bucket = client.storage.from('review-photos');
    return {
        owner, id: () => crypto.randomUUID(), prepare, rpc,
        read: (reviewId, ownerId) => client.from('reviews')
            .select('id,user_id,updated_at,content,categories,food_photos')
            .eq('id', reviewId).eq('user_id', ownerId).maybeSingle(),
        upload: (path, file) => bucket.upload(path, file, { cacheControl: '3600', upsert: false }),
        exists: async path => {
            const separator = path.lastIndexOf('/');
            try {
                const reply = await bucket.list(path.slice(0, separator), { search: path.slice(separator + 1), limit: 100 });
                return !reply.error && !!reply.data?.some(item => item.name === path.slice(separator + 1));
            } catch { return false; }
        },
        remove: (paths, purpose = 'food') => client.storage.from(purpose === 'verification' ? 'review-verifications' : 'review-photos').remove(paths),
    };
}
