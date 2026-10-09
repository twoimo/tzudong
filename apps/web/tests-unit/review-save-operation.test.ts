import { describe, expect, test } from 'bun:test';
import { ReviewSaveOperation, type ReviewSaveDependencies, type ReviewSaveDraft, type SavedReviewReadback } from '../lib/reviews/review-save-operation';
import { buildReviewPhotoObjectPath, cleanupCanonicalReviewPhotoObjects } from '../lib/review-photo-url';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    const draft: ReviewSaveDraft = {
        ownerId: 'fixture-owner', restaurantId: 'fixture-restaurant', title: 'Fixture review',
        content: 'Synthetic review content for offline tests only.', visitedAt: '2026-10-04T12:00:00', categories: ['한식'],
        verificationPhoto: new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }),
        foodPhotos: [new File(['food'], 'food.jpg', { type: 'image/jpeg' })],
    };
    const rows = new Map<string, SavedReviewReadback>();
    const objects = new Set<string>();
    const counts = { ids: 0, prepares: 0, uploads: 0, writes: 0, reads: 0, removes: 0, lists: 0 };
    const ids: string[] = [];
    const removed: string[] = [];
    let owner: string | undefined = draft.ownerId;
    const storage = {
        async remove(paths: string[]): Promise<{error: unknown}> {
            counts.removes++; paths.forEach(path => { objects.delete(path); removed.push(path); }); return { error: null };
        },
        async list(directory: string, { search }: { search: string }): Promise<{data: {name: string}[] | null; error: unknown}> {
            counts.lists++; return { data: objects.has(`${directory}/${search}`) ? [{ name: search }] : [], error: null };
        },
    };
    const deps: ReviewSaveDependencies = {
        currentOwner: () => owner,
        newId: () => `fixture-review-${++counts.ids}`,
        async prepare(value, reviewId) {
            counts.prepares++;
            return [value.verificationPhoto, ...value.foodPhotos].map((file, i) => {
                const purpose = i === 0 ? 'verification' : 'food';
                return { path: buildReviewPhotoObjectPath({ ownerId: value.ownerId, reviewId, purpose }, `fixture_${i}.jpg`)!, purpose, file };
            });
        },
        async upload(upload) { counts.uploads++; objects.add(upload.path); return { error: null }; },
        async insert(value, id, uploads) {
            counts.writes++; ids.push(id);
            if (rows.has(id)) return { error: { code: '23505' } };
            rows.set(id, { id, user_id: value.ownerId, restaurant_id: value.restaurantId,
                verification_photo: uploads[0].path, food_photos: uploads.slice(1).map(item => item.path) });
            return { error: null };
        },
        async read(ownerId, id) {
            counts.reads++; const row = rows.get(id);
            return { data: row?.user_id === ownerId ? row : null, error: null };
        },
        async cleanup(ownerId, reviewId, uploads) {
            const results = await Promise.all((['verification', 'food'] as const).map(purpose => cleanupCanonicalReviewPhotoObjects(
                uploads.filter(upload => upload.purpose === purpose).map(upload => upload.path), { ownerId, reviewId, purpose }, storage,
            )));
            return results.every(result => result.success);
        },
    };
    const operation = new ReviewSaveOperation(deps);
    const orphanCount = () => {
        const refs = new Set([...rows.values()].flatMap(row => [row.verification_photo, ...(row.food_photos ?? [])]));
        return [...objects].filter(path => !refs.has(path)).length;
    };
    return { draft, deps, operation, rows, objects, counts, ids, removed, storage, orphanCount,
        setOwner: (value: string | undefined) => { owner = value; } };
}

describe('bounded review save operation (offline)', () => {
    test('known success and unchanged retry write one row and photo set', async () => {
        const f = fixture();
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(await f.operation.submit({ ...f.draft, categories: [...f.draft.categories], foodPhotos: [...f.draft.foodPhotos] })).toBe('saved');
        expect(f.counts).toEqual({ ids: 1, prepares: 1, uploads: 2, writes: 1, reads: 0, removes: 0, lists: 0 });
        expect(f.rows.size).toBe(1); expect(f.orphanCount()).toBe(0);
    });
    test('definite denial fully compensates and regenerates retired IDs and paths', async () => {
        const f = fixture(); const insert = f.deps.insert;
        f.deps.insert = async (_draft, id) => { f.ids.push(id); return { error: { code: '42501' } }; };
        for (let i = 0; i < 5; i++) expect(await f.operation.submit(f.draft)).toBe('failed');
        expect(f.objects.size).toBe(0); expect(new Set(f.ids).size).toBe(5);
        expect(new Set(f.removed).size).toBe(10); expect(f.counts.prepares).toBe(5);
        f.deps.insert = insert;
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(f.counts.ids).toBe(6); expect(f.orphanCount()).toBe(0);
    });
    for (const thrown of [false, true]) test(`lost commit reply (${thrown ? 'thrown' : 'returned'}) recovers without reupload or second insert`, async () => {
        const f = fixture(); const insert = f.deps.insert;
        f.deps.insert = async (...args) => { await insert(...args); if (thrown) throw new Error('synthetic'); return { error: { code: 'transport' } }; };
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(f.counts.writes).toBe(1); expect(f.counts.uploads).toBe(2);
        expect(f.counts.removes).toBe(0); expect(f.rows.size).toBe(1); expect(f.orphanCount()).toBe(0);
    });
    test('failed readback blocks retry, replacement and cancellation without deleting committed photos', async () => {
        const f = fixture(); const insert = f.deps.insert; const read = f.deps.read;
        f.deps.insert = async (...args) => { await insert(...args); throw new Error('synthetic'); };
        f.deps.read = async () => ({ data: null, error: { code: 'synthetic' } });
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        expect(await f.operation.submit({ ...f.draft, content: 'changed' })).toBe('blocked');
        expect((await f.operation.cancel()).status).toBe('blocked');
        expect(f.counts.writes).toBe(1); expect(f.counts.uploads).toBe(2); expect(f.counts.removes).toBe(0);
        f.deps.read = read;
        expect(await f.operation.submit(f.draft)).toBe('saved'); expect(f.rows.size).toBe(1);
    });
    test('thrown readback failure and subsequent empty read never prove rollback', async () => {
        const f = fixture(); const read = f.deps.read;
        f.deps.insert = async () => { throw new Error('synthetic'); };
        f.deps.read = async () => { throw new Error('synthetic'); };
        expect(await f.operation.submit(f.draft)).toBe('blocked'); expect((await f.operation.cancel()).status).toBe('blocked');
        f.deps.read = read;
        expect((await f.operation.cancel()).status).toBe('blocked'); expect(f.objects.size).toBe(2);
    });
    test('empty ambiguous read allows same-ID insert retry without reupload, but never cleanup/new ID', async () => {
        const f = fixture(); const insert = f.deps.insert;
        f.deps.insert = async () => ({ error: { code: 'transport' } });
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        expect(await f.operation.submit({ ...f.draft, content: 'changed' })).toBe('blocked');
        expect((await f.operation.cancel()).status).toBe('blocked');
        f.deps.insert = insert;
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(f.counts.ids).toBe(1); expect(f.counts.uploads).toBe(2); expect(f.counts.removes).toBe(0);
    });
    test('a rejection on retry cannot erase an earlier unknown write', async () => {
        const f = fixture(); f.deps.insert = async () => ({ error: { code: 'transport' } });
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        f.deps.insert = async () => ({ error: { code: '42501' } });
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        expect((await f.operation.cancel()).status).toBe('blocked'); expect(f.objects.size).toBe(2);
    });
    for (const changeFile of [false, true]) test(`changed draft (${changeFile ? 'file' : 'content'}) gets new ID after definite rejection cleanup`, async () => {
        const f = fixture(); const insert = f.deps.insert;
        f.deps.insert = async () => ({ error: { code: '23514' } });
        expect(await f.operation.submit(f.draft)).toBe('failed'); f.deps.insert = insert;
        const draft = changeFile ? { ...f.draft, verificationPhoto: new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }) }
            : { ...f.draft, content: 'Edited synthetic content' };
        expect(await f.operation.submit(draft)).toBe('saved');
        expect(f.counts.ids).toBe(2); expect(f.counts.prepares).toBe(2); expect(f.orphanCount()).toBe(0);
    });
    test('changed draft after recovered commit never silently creates another review', async () => {
        const f = fixture(); const insert = f.deps.insert; const read = f.deps.read;
        f.deps.insert = async (...args) => { await insert(...args); throw new Error('synthetic'); };
        f.deps.read = async () => ({ data: null, error: {} });
        expect(await f.operation.submit(f.draft)).toBe('blocked'); f.deps.read = read;
        expect(await f.operation.submit({ ...f.draft, content: 'Changed' })).toBe('saved-previous');
        expect(f.rows.size).toBe(1); expect(f.counts.removes).toBe(0);
    });
    test('explicit partial rejection waits for late sibling upload before exact owned cleanup', async () => {
        const f = fixture(); const gate = deferred(); const entered = deferred();
        f.draft.foodPhotos.push(new File(['second'], 'second.jpg'));
        f.deps.upload = async upload => {
            f.counts.uploads++;
            if (upload.path.endsWith('fixture_1.jpg')) return { error: { statusCode: '403' } };
            if (upload.path.endsWith('fixture_2.jpg')) { entered.resolve(); await gate.promise; }
            f.objects.add(upload.path); return { error: null };
        };
        const pending = f.operation.submit(f.draft); await entered.promise;
        expect(f.counts.removes).toBe(0); expect(await f.operation.submit(f.draft)).toBe('blocked');
        gate.resolve(); expect(await pending).toBe('failed');
        expect(f.objects.size).toBe(0); expect(f.counts.writes).toBe(0); expect(new Set(f.removed).size).toBe(3);
    });
    test('receipt upload denial does not start food uploads or insert', async () => {
        const f = fixture();
        f.deps.upload = async () => { f.counts.uploads++; return { error: { statusCode: '403' } }; };
        expect(await f.operation.submit(f.draft)).toBe('failed');
        expect(f.counts.uploads).toBe(1); expect(f.counts.writes).toBe(0); expect(f.objects.size).toBe(0);
    });
    test('cleanup failure blocks replacement and retains only the exact operation set', async () => {
        const f = fixture(); const remove = f.storage.remove;
        f.deps.insert = async () => ({ error: { code: '42501' } });
        f.storage.remove = async () => ({ error: {} });
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        for (let i = 0; i < 5; i++) expect(await f.operation.submit({ ...f.draft, content: `Changed ${i}` })).toBe('blocked');
        expect(f.counts.ids).toBe(1); expect(f.counts.uploads).toBe(2);
        f.storage.remove = remove;
        expect((await f.operation.cancel()).status).toBe('cancelled'); expect(f.objects.size).toBe(0);
    });
    test('remove success with failed storage readback retains cleanup obligation', async () => {
        const f = fixture(); const list = f.storage.list;
        f.deps.insert = async () => ({ error: { code: '42501' } });
        f.storage.list = async () => ({ data: null, error: {} });
        expect(await f.operation.submit(f.draft)).toBe('blocked'); expect((await f.operation.cancel()).status).toBe('blocked');
        f.storage.list = list; expect((await f.operation.cancel()).status).toBe('cancelled');
    });
    test('cancel during compression prevents storage and insert', async () => {
        const f = fixture(); const gate = deferred(); const prepare = f.deps.prepare;
        f.deps.prepare = async (...args) => { await gate.promise; return prepare(...args); };
        const pending = f.operation.submit(f.draft); const cancel = f.operation.cancel(); gate.resolve();
        expect(await pending).toBe('cancelled'); expect((await cancel).status).toBe('cancelled');
        expect(f.counts.uploads).toBe(0); expect(f.counts.writes).toBe(0);
    });
    test('cancel during uploads waits for completion and cleans without insert', async () => {
        const f = fixture(); const gate = deferred(); const entered = deferred(); const upload = f.deps.upload;
        f.deps.upload = async item => { entered.resolve(); await gate.promise; return upload(item); };
        const pending = f.operation.submit(f.draft); await entered.promise;
        const cancel = f.operation.cancel(); expect(f.counts.removes).toBe(0); gate.resolve();
        expect(await pending).toBe('cancelled'); expect((await cancel).status).toBe('cancelled');
        expect(f.counts.writes).toBe(0); expect(f.objects.size).toBe(0);
    });
    test('cancel after insert dispatch preserves committed references', async () => {
        const f = fixture(); const entered = deferred(); const gate = deferred(); const insert = f.deps.insert;
        f.deps.insert = async (...args) => { entered.resolve(); await gate.promise; await insert(...args); return { error: { code: 'transport' } }; };
        const pending = f.operation.submit(f.draft); await entered.promise;
        const cancel = f.operation.cancel(); gate.resolve();
        expect(await pending).toBe('saved'); expect((await cancel).status).toBe('saved');
        expect(f.rows.size).toBe(1); expect(f.objects.size).toBe(2); expect(f.counts.removes).toBe(0);
    });
    test('owner transition prevents uploads, insert and cross-owner cleanup/retry', async () => {
        const f = fixture(); const prepare = f.deps.prepare;
        f.deps.prepare = async (...args) => { const files = await prepare(...args); f.setOwner('different-owner'); return files; };
        expect(await f.operation.submit(f.draft)).toBe('cancelled'); expect((await f.operation.cancel()).status).toBe('blocked');
        expect(f.counts.writes).toBe(0); expect(f.counts.uploads).toBe(0);
        expect(await f.operation.submit({ ...f.draft, ownerId: 'different-owner' })).toBe('blocked');
    });
    test('mismatched row never authorizes success or cleanup', async () => {
        const f = fixture(); f.deps.insert = async () => ({ error: { code: '23505' } });
        f.deps.read = async (_owner, id) => ({ data: { id, user_id: 'another-owner', restaurant_id: null, verification_photo: null, food_photos: [] }, error: null });
        expect(await f.operation.submit(f.draft)).toBe('blocked'); expect((await f.operation.cancel()).status).toBe('blocked');
        expect(f.counts.removes).toBe(0);
    });
    test('no arbitrary photo cap is introduced', async () => {
        const f = fixture(); f.draft.foodPhotos = Array.from({ length: 32 }, (_, i) => new File([String(i)], `${i}.jpg`));
        expect(await f.operation.submit(f.draft)).toBe('saved'); expect(f.counts.uploads).toBe(33); expect(f.orphanCount()).toBe(0);
    });
    test('invalid ownership is rejected before any storage mutation', async () => {
        const f = fixture(); const prepare = f.deps.prepare;
        f.deps.prepare = async (...args) => { const files = await prepare(...args); files[0].path = 'another-owner/receipt.jpg'; return files; };
        expect(await f.operation.submit(f.draft)).toBe('failed'); expect(f.counts.uploads).toBe(0); expect(f.counts.removes).toBe(0);
    });
});
