import { describe, expect, test } from 'bun:test';
import { ReviewMediaMutation, retryReviewMediaCleanup, reviewMutationMessage,
    type ReviewMediaDependencies, type ReviewMediaRow, type ReviewMutationInput } from '@/lib/reviews/review-media-mutation';
const owner = '11111111-1111-4111-8111-111111111111', review = '33333333-3333-4333-8333-333333333333';
const base = `${owner}/reviews/${review}`, old = `${base}/food/old.webp`, proof = `${base}/verification/proof.webp`;
const operationId = '55555555-5555-4555-8555-555555555555', fresh = `${base}/food/${operationId}_0.webp`;
const privateFailure = { code: '42501', message: 'fixture provider detail must not escape' };
const edit = (): ReviewMutationInput => ({ ownerId: owner, reviewId: review, kind: 'edit',
    edit: { content: 'Updated fixture review text.', categories: ['한식'], foodPhotos: [],
        files: [new File(['synthetic'], 'fixture.webp', { type: 'image/webp' })],
        original: { content: 'Original fixture review text.', categories: ['한식'], foodPhotos: [old] } } });
function fixture() {
    const f = { currentOwner: owner as string | undefined,
        row: { id: review, user_id: owner, updated_at: 'revision-1', content: 'Original fixture review text.', categories: ['한식'], food_photos: [old] } as ReviewMediaRow | null,
        objects: new Set([old, proof]), queue: new Set<string>(), receipts: new Set<string>(), events: [] as string[],
        mode: 'ok', confirmation: true, cleanup: true, removal: 'ok', upload: 'ok', mutations: 0, uploads: 0,
        rpcArgs: [] as Record<string, unknown>[],
    };
    const live = (path: string) => f.row !== null && (f.row.food_photos?.includes(path) || path === proof);
    const deps: ReviewMediaDependencies = {
        owner: () => f.currentOwner, id: () => operationId, prepare: async file => file,
        read: async () => ({ data: f.row, error: null }),
        upload: async path => {
            f.uploads++;
            if (f.upload === 'throw-before') throw privateFailure;
            f.objects.add(path);
            if (f.upload === 'throw-after') throw privateFailure;
            return { error: null };
        },
        exists: async path => f.objects.has(path),
        remove: async (paths, purpose = 'food') => {
            f.events.push('remove');
            if (f.removal === 'error') return { error: privateFailure };
            if (f.removal === 'partial' && purpose === 'verification') throw privateFailure;
            for (const path of f.removal === 'partial' ? paths.slice(0, 1) : paths) {
                if (live(path)) throw new Error('test attempted live deletion');
                f.objects.delete(path);
            }
            if (['throw-after', 'partial'].includes(f.removal)) throw privateFailure;
            return { error: null };
        },
        rpc: async (name, args = {}) => {
            if (name === 'mutate_review_with_media') {
                f.events.push('mutate'); f.rpcArgs.push(structuredClone(args));
                if (f.receipts.has(String(args.p_operation_id))) return { data: 'REVIEW_COMMITTED', error: null };
                if (f.mode === 'reject') return { data: 'REVIEW_CONFLICT', error: null };
                if (f.mode === 'throw-before') throw privateFailure;
                if (f.mode === 'error-before') return { data: null, error: privateFailure };
                f.mutations++;
                if (args.p_kind === 'delete') { f.queue.add(proof); f.row = null; }
                else f.row = { ...f.row!, content: String(args.p_content), food_photos: args.p_food_photos as string[] };
                f.queue.add(old); f.receipts.add(String(args.p_operation_id));
                if (f.mode === 'throw-after') throw privateFailure;
                if (f.mode === 'error-after') return { data: null, error: privateFailure };
                return { data: 'REVIEW_COMMITTED', error: null };
            }
            if (name === 'read_review_media_commit') {
                f.events.push('confirm');
                if (!f.confirmation && f.events.includes('mutate')) throw privateFailure;
                return { data: f.receipts.has(String(args.p_operation_id)) ? 'REVIEW_COMMITTED' : 'REVIEW_NOT_CONFIRMED', error: null };
            }
            if (name === 'queue_review_upload_cleanup') {
                f.events.push('compensate');
                for (const path of args.p_paths as string[]) if (!live(path)) f.queue.add(path);
                return { data: 'REVIEW_CLEANUP_QUEUED', error: null };
            }
            if (name === 'pending_review_media_cleanup') {
                f.events.push('pending');
                if (!f.cleanup) throw privateFailure;
                return { data: [...f.queue].filter(path => !live(path)).map(path => ({ path, owner_id: owner, review_id: review,
                    purpose: path.includes('/verification/') ? 'verification' : 'food' })), error: null };
            }
            if (name === 'finish_review_media_cleanup') {
                for (const path of f.queue) if (!f.objects.has(path)) f.queue.delete(path);
                return { data: f.queue.size, error: null };
            }
            throw new Error('unexpected test RPC');
        },
    };
    return { f, deps };
}
describe('review commit and media failure boundaries', () => {
    test('DB rejection before commit preserves old media and retires only unused uploads', async () => {
        const { f, deps } = fixture(); f.mode = 'reject';
        expect(await new ReviewMediaMutation(deps).run(edit())).toEqual({ committed: false, code: 'REVIEW_CONFLICT' });
        expect(f.objects.has(old)).toBe(true); expect(f.objects.has(proof)).toBe(true);
        expect(f.objects.has(fresh)).toBe(false); expect(f.mutations).toBe(0);
        expect(f.events.indexOf('compensate')).toBeGreaterThan(f.events.indexOf('confirm'));
    });
    for (const mode of ['throw-after', 'error-after']) test(`${mode}: committed upload survives; cleanup follows receipt`, async () => {
        const { f, deps } = fixture(); f.mode = mode;
        expect(await new ReviewMediaMutation(deps).run(edit())).toEqual({ committed: true, code: 'REVIEW_COMMITTED' });
        expect(f.objects.has(fresh)).toBe(true); expect(f.objects.has(old)).toBe(false);
        expect(f.events).not.toContain('compensate');
        expect(f.events.indexOf('remove')).toBeGreaterThan(f.events.indexOf('confirm'));
    });
    test('unknown result later confirmed committed does not reupload or remutate', async () => {
        const { f, deps } = fixture(); f.mode = 'throw-after'; f.confirmation = false;
        const op = new ReviewMediaMutation(deps);
        expect((await op.run(edit())).code).toBe('REVIEW_NOT_CONFIRMED');
        expect(f.objects.has(old)).toBe(true); expect(f.objects.has(fresh)).toBe(true);
        f.confirmation = true;
        const changed = edit(); changed.edit!.content = 'Different text must not be submitted.';
        expect((await op.run(changed)).committed).toBe(true);
        expect(f.mutations).toBe(1); expect(f.uploads).toBe(1); expect(f.rpcArgs.length).toBe(1);
    });
    for (const mode of ['error-before', 'throw-before']) test(`${mode}: missing receipt never authorizes compensation`, async () => {
        const { f, deps } = fixture(); f.mode = mode; const op = new ReviewMediaMutation(deps);
        expect((await op.run(edit())).code).toBe('REVIEW_NOT_CONFIRMED');
        expect(f.events).not.toContain('remove'); expect(f.events).not.toContain('compensate');
        f.mode = 'ok'; expect((await op.run(edit())).committed).toBe(true);
        expect(f.rpcArgs[0]).toEqual(f.rpcArgs[1]); expect(f.uploads).toBe(1);
    });
    test('missing row is not a successful delete', async () => {
        const { f, deps } = fixture(); f.row = null;
        expect((await new ReviewMediaMutation(deps).run({ ownerId: owner, reviewId: review, kind: 'delete' })).code).toBe('REVIEW_NOT_FOUND');
        expect(f.events).toEqual([]); expect(f.objects.size).toBe(2);
    });
    test('unauthorized owner cannot mutate or delete media', async () => {
        const { f, deps } = fixture(); f.currentOwner = 'other';
        expect((await new ReviewMediaMutation(deps).run(edit())).code).toBe('REVIEW_UNAUTHORIZED'); expect(f.events).toEqual([]);
    });
    test('partial Storage failure after commit survives page revisit for both purposes', async () => {
        const { f, deps } = fixture(); f.removal = 'partial';
        expect(await new ReviewMediaMutation(deps).run({ ownerId: owner, reviewId: review, kind: 'delete' }))
            .toEqual({ committed: true, code: 'REVIEW_CLEANUP_PENDING' });
        expect(f.queue.size).toBe(1); expect(f.objects.size).toBe(1);
        f.removal = 'ok'; expect(await retryReviewMediaCleanup({ ...deps }, owner)).toBe(true);
        expect(await retryReviewMediaCleanup({ ...deps }, owner)).toBe(true);
        expect(f.objects.size).toBe(0); expect(f.mutations).toBe(1);
    });
    test('delete transport failure after completion is resolved by metadata readback', async () => {
        const { f, deps } = fixture(); f.removal = 'throw-after';
        expect((await new ReviewMediaMutation(deps).run(edit())).code).toBe('REVIEW_COMMITTED'); expect(f.objects.has(fresh)).toBe(true);
    });
    test('cleanup RPC failure after commit does not replay the mutation', async () => {
        const { f, deps } = fixture(); f.cleanup = false;
        expect((await new ReviewMediaMutation(deps).run(edit())).code).toBe('REVIEW_CLEANUP_PENDING');
        f.cleanup = true; expect(await retryReviewMediaCleanup(deps, owner)).toBe(true); expect(f.mutations).toBe(1);
    });
    test('concurrent clicks share one operation', async () => {
        const { f, deps } = fixture(); const op = new ReviewMediaMutation(deps);
        const [a, b] = await Promise.all([op.run(edit()), op.run(edit())]);
        expect(a).toEqual(b); expect(f.mutations).toBe(1); expect(f.uploads).toBe(1);
    });
    test('upload uncertainty verifies the same key and never deletes a live upload', async () => {
        const { f, deps } = fixture(); f.upload = 'throw-after';
        expect((await new ReviewMediaMutation(deps).run(edit())).committed).toBe(true);
        expect(f.objects.has(fresh)).toBe(true); expect(f.events).not.toContain('compensate');
    });
    test('incomplete upload retries frozen paths before any DB write', async () => {
        const { f, deps } = fixture(); f.upload = 'throw-before'; const op = new ReviewMediaMutation(deps);
        expect((await op.run(edit())).code).toBe('REVIEW_UPLOAD_FAILED'); expect(f.mutations).toBe(0);
        f.upload = 'ok'; expect((await op.run(edit())).committed).toBe(true); expect(f.objects.has(fresh)).toBe(true);
    });
    test('owner change during upload blocks mutation and cleanup', async () => {
        const { f, deps } = fixture(); const upload = deps.upload;
        deps.upload = async (path, file) => { const reply = await upload(path, file); f.currentOwner = undefined; return reply; };
        expect((await new ReviewMediaMutation(deps).run(edit())).code).toBe('REVIEW_UNAUTHORIZED');
        expect(f.events).toEqual(['confirm']); expect(f.objects.has(old)).toBe(true);
    });
    test('cleanup validates owner, review and purpose on all returned paths', async () => {
        const { f, deps } = fixture();
        deps.rpc = async () => ({ data: [{ path: old, owner_id: 'other', review_id: review, purpose: 'verification' }], error: null });
        expect(await retryReviewMediaCleanup(deps, owner)).toBe(false); expect(f.events).toEqual([]);
    });
    test('stale baseline cannot replace a concurrent edit', async () => {
        const { f, deps } = fixture(); const input = edit(); input.edit!.original.content = 'Outdated fixture.';
        expect((await new ReviewMediaMutation(deps).run(input)).code).toBe('REVIEW_CONFLICT'); expect(f.uploads).toBe(0);
    });
    test('missing migration fails before uploading or mutating', async () => {
        const { f, deps } = fixture();
        deps.rpc = async () => ({ data: null, error: privateFailure });
        expect((await new ReviewMediaMutation(deps).run(edit())).code).toBe('REVIEW_NOT_CONFIRMED');
        expect(f.uploads).toBe(0); expect(f.mutations).toBe(0);
    });
    test('a different action cannot join an active edit and report its result as a deletion', async () => {
        const { f, deps } = fixture(); const op = new ReviewMediaMutation(deps);
        const saving = op.run(edit());
        expect((await op.run({ ownerId: owner, reviewId: review, kind: 'delete' })).committed).toBe(false);
        expect((await saving).committed).toBe(true); expect(f.row).not.toBeNull();
    });
    test('feedback never exposes provider diagnostics', async () => {
        const { f, deps } = fixture(); f.mode = 'error-before';
        const outcome = await new ReviewMediaMutation(deps).run(edit());
        expect(JSON.stringify(outcome)).not.toContain(privateFailure.message);
        expect(reviewMutationMessage(outcome.code)).not.toContain(privateFailure.message);
    });
});
