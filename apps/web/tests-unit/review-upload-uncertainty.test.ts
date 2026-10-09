import { describe, expect, spyOn, test } from 'bun:test';
import {
    ReviewSaveOperation,
    type ReviewSaveDependencies,
    type ReviewSaveDraft,
    type ReviewSaveUpload,
    type SavedReviewReadback,
} from '../lib/reviews/review-save-operation';
import { buildReviewPhotoObjectPath } from '../lib/review-photo-url';

// The fake service has two independent completion channels. Settling the client
// promise does not settle the server commit gate, even after remove/list says absent.
// Only synthetic bytes live in memory; no SDK, network, credentials or disk fixtures.
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

type UploadReply = { error: unknown };
type UploadBehavior = (upload: ReviewSaveUpload, attempt: number) => Promise<UploadReply>;
type Metadata = { size: number; mime: string };

function fixture(foodCount = 2, withMetadata = true) {
    const draft: ReviewSaveDraft = {
        ownerId: 'race-owner', restaurantId: 'race-restaurant', title: 'Synthetic review',
        content: 'Offline synthetic content.', visitedAt: '2026-10-04T12:00:00', categories: ['fixture'],
        verificationPhoto: new File([new Uint8Array(11)], 'receipt.jpg', { type: 'image/jpeg' }),
        foodPhotos: Array.from({ length: foodCount }, (_, i) => (
            new File([new Uint8Array(13 + i)], `food-${i}.jpg`, { type: 'image/jpeg' })
        )),
    };
    let owner: string | undefined = draft.ownerId;
    const objects = new Map<string, Metadata>();
    const rows = new Map<string, SavedReviewReadback>();
    const preparations: ReviewSaveUpload[][] = [];
    const ids: string[] = [];
    const uploads: { upload: ReviewSaveUpload; attempt: number }[] = [];
    const insertions: { id: string; paths: string[]; allAvailable: boolean }[] = [];
    const cleanupCalls: string[][] = [];
    const absenceChecks: boolean[] = [];
    const verifications: string[] = [];
    const reads: string[] = [];
    const behaviors = new Map<number, UploadBehavior>();
    const matches = (upload: ReviewSaveUpload) => {
        const metadata = objects.get(upload.path);
        return metadata?.size === upload.file.size && metadata?.mime === upload.file.type;
    };
    // upsert:false: a late original request cannot overwrite an already present key.
    const commit = (upload: ReviewSaveUpload) => {
        if (!objects.has(upload.path)) objects.set(upload.path, { size: upload.file.size, mime: upload.file.type });
    };
    const saveRow = (value: ReviewSaveDraft, id: string, items: ReviewSaveUpload[]) => {
        rows.set(id, {
            id, user_id: value.ownerId, restaurant_id: value.restaurantId,
            verification_photo: items.find(item => item.purpose === 'verification')!.path,
            food_photos: items.filter(item => item.purpose === 'food').map(item => item.path),
        });
    };
    const deps: ReviewSaveDependencies = {
        currentOwner: () => owner,
        newId() { const id = `race-review-${ids.length + 1}`; ids.push(id); return id; },
        async prepare(value, id) {
            const items = [value.verificationPhoto, ...value.foodPhotos].map((_file, index) => {
                const purpose = index === 0 ? 'verification' : 'food';
                // New prepared File objects make accidental recompression observable.
                const file = new File([new Uint8Array(5 + index)], `prepared-${index}.webp`, { type: 'image/webp' });
                const path = buildReviewPhotoObjectPath({ ownerId: value.ownerId, reviewId: id, purpose }, `race_${index}.webp`)!;
                return { path, purpose, file } satisfies ReviewSaveUpload;
            });
            preparations.push(items.map(item => ({ ...item })));
            return items;
        },
        async upload(upload) {
            const attempt = uploads.filter(call => call.upload.path === upload.path).length + 1;
            uploads.push({ upload: { ...upload }, attempt });
            const index = Number(/\/race_(\d+)\.webp$/.exec(upload.path)![1]);
            const behavior = behaviors.get(index);
            if (behavior) return behavior(upload, attempt);
            if (objects.has(upload.path)) return { error: { statusCode: '409' } };
            commit(upload);
            return { error: null };
        },
        async insert(value, id, items) {
            insertions.push({ id, paths: items.map(item => item.path), allAvailable: items.every(matches) });
            saveRow(value, id, items);
            return { error: null };
        },
        async read(ownerId, id) {
            reads.push(id);
            const row = rows.get(id);
            return { data: row?.user_id === ownerId ? row : null, error: null };
        },
        async cleanup(_ownerId, _id, items) {
            cleanupCalls.push(items.map(item => item.path));
            items.forEach(item => objects.delete(item.path));
            const absent = items.every(item => !objects.has(item.path));
            absenceChecks.push(absent);
            return absent;
        },
    };
    if (withMetadata) deps.verifyUpload = async upload => {
        verifications.push(upload.path);
        return matches(upload);
    };
    const operation = new ReviewSaveOperation(deps);

    function lateUpload(index: number, thrown = false, error: unknown = { status: 503 }) {
        const entered = deferred<void>();
        const client = deferred<void>();
        const server = deferred<void>();
        const committed = deferred<void>();
        let pending = false;
        behaviors.set(index, async upload => {
            pending = true;
            void server.promise.then(() => { commit(upload); pending = false; committed.resolve(); });
            entered.resolve();
            await client.promise;
            if (thrown) throw new TypeError('SYNTHETIC_TRANSPORT_FAILURE');
            return { error };
        });
        return {
            entered: entered.promise,
            failClient: () => client.resolve(),
            pending: () => pending,
            async commitServer() { server.resolve(); await committed.promise; },
        };
    }
    const orphanPaths = () => {
        const references = new Set([...rows.values()].flatMap(row => [row.verification_photo, ...(row.food_photos ?? [])]));
        return [...objects.keys()].filter(path => !references.has(path));
    };
    return {
        draft, deps, operation, objects, rows, preparations, ids, uploads, insertions, cleanupCalls,
        absenceChecks, verifications, reads, behaviors, commit, saveRow, lateUpload, orphanPaths,
        setOwner: (value: string | undefined) => { owner = value; },
    };
}

function expectRetained(f: ReturnType<typeof fixture>) {
    expect(f.ids).toHaveLength(1);
    expect(f.preparations).toHaveLength(1);
    expect(f.cleanupCalls).toHaveLength(0);
    expect(f.absenceChecks).toHaveLength(0);
}

function expectSamePreparedUploads(f: ReturnType<typeof fixture>) {
    for (const { upload } of f.uploads) {
        const prepared = f.preparations[0].find(item => item.path === upload.path);
        expect(prepared).toBeDefined();
        expect(upload.file).toBe(prepared!.file);
        expect(upload.purpose).toBe(prepared!.purpose);
    }
}

async function withoutApplicationTimers(run: () => Promise<void>) {
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(() => { throw new Error('UNEXPECTED_APPLICATION_TIMER'); });
    const interval = spyOn(globalThis, 'setInterval').mockImplementation(() => { throw new Error('UNEXPECTED_APPLICATION_TIMER'); });
    try {
        await run();
        expect(timeout).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
    } finally {
        timeout.mockRestore();
        interval.mockRestore();
    }
}

describe('independent late Storage upload uncertainty (offline)', () => {
    test('known success and unchanged retry allocate, prepare and insert exactly once', async () => {
        const f = fixture();
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(await f.operation.submit({ ...f.draft, categories: [...f.draft.categories], foodPhotos: [...f.draft.foodPhotos] })).toBe('saved');
        expectRetained(f);
        expect(f.uploads).toHaveLength(3);
        expect(f.insertions).toEqual([{ id: f.ids[0], paths: f.preparations[0].map(item => item.path), allAvailable: true }]);
        expect(f.orphanPaths()).toEqual([]);
    });

    for (const thrown of [false, true]) for (const cancelInFlight of [false, true]) {
        test(`receipt late commit after ${thrown ? 'thrown' : 'returned'} failure and ${cancelInFlight ? 'in-flight' : 'settled'} cancellation stays retained`, async () => {
            const f = fixture();
            const late = f.lateUpload(0, thrown);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            const inFlightCancel = cancelInFlight ? f.operation.cancel() : null;
            late.failClient();
            const result = await submit;
            const cancelled = await (inFlightCancel ?? f.operation.cancel());
            // Explicitly observe empty review AND Storage metadata before the server gate opens.
            const emptyRow = await f.deps.read(f.draft.ownerId, f.ids[0]);
            const emptyObject = await f.deps.verifyUpload!(f.preparations[0][0]);
            f.operation.releaseSaved();
            const replacement = await f.operation.submit({ ...f.draft, content: 'Changed synthetic draft' });
            const pendingBeforeCommit = late.pending();
            await late.commitServer();

            expect(result).toBe('blocked');
            expect(cancelled.status).toBe('blocked');
            expect(emptyRow).toEqual({ data: null, error: null });
            expect(emptyObject).toBe(false);
            expect(replacement).toBe('blocked');
            expect(pendingBeforeCommit).toBe(true);
            expectRetained(f);
            expect(f.uploads).toHaveLength(1);
            expect(f.insertions).toHaveLength(0);
            // The late object exists but remains tied to the retained operation; never claim cleanup.
            expect(f.orphanPaths()).toEqual([f.preparations[0][0].path]);
            expect((await f.operation.cancel()).status).toBe('blocked');
            expectRetained(f);
        });
    }

    for (const thrown of [false, true]) {
        test(`parallel food ${thrown ? 'thrown' : 'returned'} failure keeps late sibling and original server commit owned`, async () => {
            const f = fixture(3);
            const unknown = f.lateUpload(1, thrown);
            const siblingEntered = deferred<void>();
            const siblingClient = deferred<void>();
            f.behaviors.set(2, async () => ({ error: { status: 413 } }));
            f.behaviors.set(3, async upload => {
                siblingEntered.resolve();
                await siblingClient.promise;
                f.commit(upload);
                return { error: null };
            });
            const submit = f.operation.submit(f.draft);
            await Promise.all([unknown.entered, siblingEntered.promise]);
            unknown.failClient();
            let cancelSettled = false;
            const cancellation = f.operation.cancel().then(result => { cancelSettled = true; return result; });
            const concurrent = await f.operation.submit(f.draft);
            const cleanupBeforeSibling = f.cleanupCalls.length;
            const cancellationBeforeSibling = cancelSettled;
            siblingClient.resolve();
            const result = await submit;
            const cancelled = await cancellation;
            const emptyUnknownKey = !f.objects.has(f.preparations[0][1].path);
            const replacement = await f.operation.submit({ ...f.draft, title: 'Replacement' });
            await unknown.commitServer();

            expect(concurrent).toBe('blocked');
            expect(cleanupBeforeSibling).toBe(0);
            expect(cancellationBeforeSibling).toBe(false);
            expect(result).toBe('blocked');
            expect(cancelled.status).toBe('blocked');
            expect(emptyUnknownKey).toBe(true);
            expect(replacement).toBe('blocked');
            expectRetained(f);
            expect(f.uploads).toHaveLength(4);
            expect(f.insertions).toHaveLength(0);
            expect([...f.objects.keys()].sort()).toEqual([0, 1, 3].map(index => f.preparations[0][index].path).sort());
        });
    }

    for (const status of [400, 401, 403, 413, 415, 422]) for (const shape of ['status', 'statusCode'] as const) {
        test(`explicit ${shape}=${status} with no earlier uncertainty permits cleanup and replacement`, async () => {
            const f = fixture(1);
            f.behaviors.set(1, async () => ({ error: { [shape]: shape === 'status' ? status : String(status) } }));
            expect(await f.operation.submit(f.draft)).toBe('failed');
            expect(f.objects.size).toBe(0);
            expect(f.cleanupCalls.length).toBeGreaterThan(0);
            expect(f.absenceChecks.every(Boolean)).toBe(true);
            f.behaviors.clear();
            expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('saved');
            expect(f.ids).toHaveLength(2);
            expect(f.orphanPaths()).toEqual([]);
        });
    }

    for (const error of [
        { status: 409 }, { statusCode: '409' }, { status: 500 }, { statusCode: '503' },
        { code: 'transport' }, {},
    ]) {
        test(`non-definite upload error ${JSON.stringify(error)} never authorizes cleanup`, async () => {
            const f = fixture(1);
            f.behaviors.set(1, async () => ({ error }));
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect((await f.operation.cancel()).status).toBe('blocked');
            expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
            expectRetained(f);
            expect(f.objects.has(f.preparations[0][0].path)).toBe(true);
            expect(f.insertions).toHaveLength(0);
        });
    }

    test('SQL-looking code without a Storage HTTP outcome cannot prove rollback', async () => {
        const f = fixture(1);
        f.behaviors.set(1, async () => ({ error: { code: '42501' } }));
        expect(await f.operation.submit(f.draft)).toBe('blocked');
        expect(f.objects.size).toBe(1); // The earlier acknowledged receipt is held with this operation.
        expect(f.cleanupCalls).toHaveLength(0);
        f.behaviors.clear();
        expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
        expect(f.ids).toHaveLength(1);
        expect(f.orphanPaths().length).toBe(1); // Unreferenced while held; no cleanup/abandonment is asserted.
    });

    for (const error of [
        ...[400, 401, 403, 413, 415, 422].map(status => ({ statusCode: String(status) })),
        { code: '42501' }, { status: 503, code: '42501' }, { statusCode: '409', code: '23514' },
    ]) {
        test(`upload rejection ${JSON.stringify(error)} on retry cannot erase an earlier unanswered receipt`, async () => {
            const f = fixture(1);
            const late = f.lateUpload(0);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            late.failClient();
            expect(await submit).toBe('blocked');
            f.behaviors.set(0, async () => ({ error }));
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect((await f.operation.cancel()).status).toBe('blocked');
            expect(await f.operation.submit({ ...f.draft, content: 'Replacement' })).toBe('blocked');
            await late.commitServer();
            expectRetained(f);
            expectSamePreparedUploads(f);
            expect(f.insertions).toHaveLength(0);
            expect(f.objects.has(f.preparations[0][0].path)).toBe(true);
        });
    }

    for (const index of [0, 1]) {
        test(`affirmative metadata recovers late ${index === 0 ? 'receipt' : 'food'} on original ID without reupload`, async () => {
            const f = fixture();
            const late = f.lateUpload(index);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            late.failClient();
            expect(await submit).toBe('blocked');
            await late.commitServer();
            f.behaviors.clear();
            expect(await f.operation.submit(f.draft)).toBe('saved');
            expectRetained(f);
            expectSamePreparedUploads(f);
            expect(f.uploads).toHaveLength(3);
            expect(f.verifications).toContain(f.preparations[0][index].path);
            expect(f.insertions).toHaveLength(1);
            expect(f.insertions[0].allAvailable).toBe(true);
            expect(f.orphanPaths()).toEqual([]);
            expect((await f.operation.cancel()).status).toBe('saved');
        });
    }

    test('success on same-path retry before original commit may finalize one matching review', async () => {
        const f = fixture();
        const late = f.lateUpload(1);
        const submit = f.operation.submit(f.draft);
        await late.entered;
        late.failClient();
        expect(await submit).toBe('blocked');
        f.behaviors.clear();
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(late.pending()).toBe(true);
        await late.commitServer();
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expectRetained(f);
        expectSamePreparedUploads(f);
        expect(f.uploads.map(call => call.upload.path)).toEqual([
            ...f.preparations[0].map(item => item.path), f.preparations[0][1].path,
        ]);
        expect(f.insertions).toHaveLength(1);
        expect(f.insertions[0].allAvailable).toBe(true);
        expect(f.orphanPaths()).toEqual([]);
    });

    for (const recovery of ['metadata', 'retry-success'] as const) {
        test(`${recovery} plus definite insert rejection must retain earlier upload uncertainty`, async () => {
            const f = fixture();
            const insert = f.deps.insert;
            const late = f.lateUpload(1);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            late.failClient();
            expect(await submit).toBe('blocked');
            if (recovery === 'metadata') {
                // A second same-path request commits but loses its reply. Metadata
                // can now confirm availability while the FIRST write is still pending.
                f.behaviors.set(1, async upload => {
                    f.commit(upload);
                    return { error: { status: 503 } };
                });
                expect(await f.operation.submit(f.draft)).toBe('blocked');
                expect(late.pending()).toBe(true);
            }
            f.behaviors.clear();
            let deniedInsertions = 0;
            let code = '42501';
            f.deps.insert = async () => { deniedInsertions++; return { error: { code } }; };
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect(deniedInsertions).toBe(1);
            expect(late.pending()).toBe(true);
            const uploadsAfterAvailability = f.uploads.length;
            // A later SQL rejection cannot turn availability into deletion permission.
            code = '23514';
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect(deniedInsertions).toBe(2);
            expect(f.uploads).toHaveLength(uploadsAfterAvailability);
            expect((await f.operation.cancel()).status).toBe('blocked');
            expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
            expectRetained(f);
            expectSamePreparedUploads(f);
            expect(f.objects.size).toBe(3);
            expect(f.rows.size).toBe(0);
            expect(late.pending()).toBe(true);
            f.deps.insert = insert;
            expect(await f.operation.submit(f.draft)).toBe('saved');
            await late.commitServer();
            expectRetained(f);
            expect(f.insertions).toHaveLength(1);
            expect(f.insertions[0].allAvailable).toBe(true);
            expect(f.orphanPaths()).toEqual([]);
        });
    }

    test('ordinary insert rejection with complete compensation retries on fresh paths', async () => {
        const f = fixture();
        const insert = f.deps.insert;
        f.deps.insert = async () => ({ error: { code: '42501' } });
        expect(await f.operation.submit(f.draft)).toBe('failed');
        expect(f.objects.size).toBe(0);
        f.deps.insert = insert;
        expect(await f.operation.submit(f.draft)).toBe('saved');
        expect(f.ids).toHaveLength(2);
        expect(f.preparations).toHaveLength(2);
        expect(f.ids[1]).not.toBe(f.ids[0]);
        const retired = new Set(f.preparations[0].map(item => item.path));
        expect(f.preparations[1].every(item => !retired.has(item.path))).toBe(true);
        expect([...retired].every(path => !f.objects.has(path))).toBe(true);
        expect(f.insertions[0].id).toBe(f.ids[1]);
        expect(f.insertions[0].allAvailable).toBe(true);
        expect(f.uploads).toHaveLength(6);
        expect(f.orphanPaths()).toEqual([]);
    });

    for (const metadata of ['missing', 'size-mismatch', 'mime-mismatch', 'size-missing', 'mime-missing', 'denied', 'throws'] as const) {
        test(`metadata ${metadata} cannot certify availability or release upload uncertainty`, async () => {
            const f = fixture(0);
            const late = f.lateUpload(0);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            late.failClient();
            expect(await submit).toBe('blocked');
            const receipt = f.preparations[0][0];
            if (metadata === 'size-mismatch') f.objects.set(receipt.path, { size: receipt.file.size + 1, mime: receipt.file.type });
            if (metadata === 'mime-mismatch') f.objects.set(receipt.path, { size: receipt.file.size, mime: 'image/jpeg' });
            if (metadata === 'size-missing') f.objects.set(receipt.path, { mime: receipt.file.type } as Metadata);
            if (metadata === 'mime-missing') f.objects.set(receipt.path, { size: receipt.file.size } as Metadata);
            if (metadata === 'denied') f.deps.verifyUpload = async () => false;
            if (metadata === 'throws') f.deps.verifyUpload = async () => { throw new Error('SYNTHETIC_METADATA_UNAVAILABLE'); };
            f.behaviors.set(0, async () => ({ error: { status: 409 } }));
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect((await f.operation.cancel()).status).toBe('blocked');
            expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
            await late.commitServer();
            expectRetained(f);
            expectSamePreparedUploads(f);
            expect(f.insertions).toHaveLength(0);
        });
    }

    test('optional metadata verifier may be absent without making transport failure definite', async () => {
        const f = fixture(0, false);
        const late = f.lateUpload(0, true);
        const submit = f.operation.submit(f.draft);
        await late.entered;
        late.failClient();
        expect(await submit).toBe('blocked');
        expect((await f.operation.cancel()).status).toBe('blocked');
        f.behaviors.clear();
        expect(await f.operation.submit(f.draft)).toBe('saved');
        await late.commitServer();
        expectRetained(f);
        expectSamePreparedUploads(f);
        expect(f.orphanPaths()).toEqual([]);
    });

    for (const nextOwner of [undefined, 'other-owner']) for (const index of [0, 1]) {
        test(`owner transition during ${index === 0 ? 'receipt' : 'food'} to ${nextOwner ?? 'signed-out'} blocks retry, replacement and cleanup`, async () => {
            const f = fixture();
            const late = f.lateUpload(index);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            f.setOwner(nextOwner);
            late.failClient();
            expect(await submit).toBe('blocked');
            const uploadCount = f.uploads.length;
            const verificationCount = f.verifications.length;
            expect((await f.operation.cancel()).status).toBe('blocked');
            expect(await f.operation.submit({ ...f.draft, ownerId: nextOwner ?? f.draft.ownerId })).toBe('blocked');
            await late.commitServer();
            expect(f.uploads).toHaveLength(uploadCount);
            expect(f.verifications).toHaveLength(verificationCount);
            expect(f.insertions).toHaveLength(0);
            expectRetained(f);
            f.setOwner(f.draft.ownerId);
            f.behaviors.clear();
            expect(await f.operation.submit(f.draft)).toBe('saved');
            expect(f.orphanPaths()).toEqual([]);
        });
    }

    test('owner transition while affirmative metadata is pending prevents the next upload or insert', async () => {
        const f = fixture();
        const late = f.lateUpload(0);
        const first = f.operation.submit(f.draft);
        await late.entered;
        late.failClient();
        expect(await first).toBe('blocked');
        await late.commitServer();
        const entered = deferred<void>();
        const metadata = deferred<boolean>();
        f.deps.verifyUpload = async () => { entered.resolve(); return metadata.promise; };
        const retry = f.operation.submit(f.draft);
        await entered.promise;
        f.setOwner('other-owner');
        metadata.resolve(true);
        expect(['blocked', 'cancelled']).toContain(await retry);
        expect(f.uploads).toHaveLength(1);
        expect(f.insertions).toHaveLength(0);
        expect((await f.operation.cancel()).status).toBe('blocked');
        expectRetained(f);
    });

    test('matching saved review resolves uncertainty without cleanup and release permits a new operation', async () => {
        const f = fixture();
        const late = f.lateUpload(1);
        const submit = f.operation.submit(f.draft);
        await late.entered;
        late.failClient();
        expect(await submit).toBe('blocked');
        f.behaviors.clear();
        f.deps.insert = async (value, id, items) => {
            f.saveRow(value, id, items);
            return { error: { code: 'transport' } };
        };
        expect(await f.operation.submit(f.draft)).toBe('saved');
        await late.commitServer();
        expect((await f.operation.cancel()).status).toBe('saved');
        expect(await f.operation.submit({ ...f.draft, title: 'Changed after saved' })).toBe('saved-previous');
        expectRetained(f);
        f.operation.releaseSaved();
        expect(await f.operation.submit({ ...f.draft, title: 'Explicit next review' })).toBe('saved');
        expect(f.ids).toHaveLength(2);
        expect(f.rows.size).toBe(2);
        expect(f.cleanupCalls).toHaveLength(0);
        expect(f.orphanPaths()).toEqual([]);
    });

    for (const mismatch of ['id', 'owner', 'restaurant', 'receipt', 'food', 'food-order'] as const) {
        test(`mismatched saved row ${mismatch} cannot release unanswered uploads`, async () => {
            const f = fixture();
            const late = f.lateUpload(1);
            const submit = f.operation.submit(f.draft);
            await late.entered;
            late.failClient();
            expect(await submit).toBe('blocked');
            f.behaviors.clear();
            if (mismatch === 'owner') f.deps.read = async (_ownerId, id) => ({ data: f.rows.get(id) ?? null, error: null });
            f.deps.insert = async (value, id, items) => {
                f.saveRow(value, id, items);
                const row = f.rows.get(id)!;
                if (mismatch === 'id') row.id = 'other-review';
                if (mismatch === 'owner') row.user_id = 'other-owner';
                if (mismatch === 'restaurant') row.restaurant_id = 'other-restaurant';
                if (mismatch === 'receipt') row.verification_photo = 'other-receipt';
                if (mismatch === 'food') row.food_photos = [];
                if (mismatch === 'food-order') row.food_photos!.reverse();
                return { error: { code: 'transport' } };
            };
            expect(await f.operation.submit(f.draft)).toBe('blocked');
            expect((await f.operation.cancel()).status).toBe('blocked');
            f.operation.releaseSaved();
            expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
            await late.commitServer();
            expectRetained(f);
        });
    }

    test('owner transition during matching review readback never releases the old owner operation', async () => {
        const f = fixture();
        const late = f.lateUpload(1);
        const first = f.operation.submit(f.draft);
        await late.entered;
        late.failClient();
        expect(await first).toBe('blocked');
        f.behaviors.clear();
        const read = f.deps.read;
        const entered = deferred<void>();
        const release = deferred<void>();
        f.deps.insert = async (value, id, items) => {
            f.saveRow(value, id, items);
            return { error: { code: 'transport' } };
        };
        f.deps.read = async (...args) => {
            const response = await read(...args);
            entered.resolve();
            await release.promise;
            return response;
        };
        const retry = f.operation.submit(f.draft);
        await entered.promise;
        f.setOwner('other-owner');
        release.resolve();
        expect(await retry).toBe('blocked');
        expect((await f.operation.cancel()).status).toBe('blocked');
        expect(await f.operation.submit({ ...f.draft, ownerId: 'other-owner' })).toBe('blocked');
        await late.commitServer();
        expectRetained(f);
        f.setOwner(f.draft.ownerId);
        f.deps.read = read;
        expect((await f.operation.cancel()).status).toBe('saved');
        expect(f.orphanPaths()).toEqual([]);
    });

    test('repeated absent metadata and rejected retries do not expire or cap the retained operation', async () => {
        await withoutApplicationTimers(async () => {
            const now = spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 4));
            try {
                const f = fixture(0);
                const late = f.lateUpload(0);
                const first = f.operation.submit(f.draft);
                await late.entered;
                late.failClient();
                expect(await first).toBe('blocked');
                f.behaviors.set(0, async () => ({ error: { status: 403 } }));
                for (let attempt = 0; attempt < 64; attempt++) {
                    // No actual waiting: even years of observed age cannot prove settlement.
                    now.mockReturnValue(Date.UTC(2027 + attempt, 9, 4));
                    expect(await f.operation.submit(f.draft)).toBe('blocked');
                    expect((await f.operation.cancel()).status).toBe('blocked');
                }
                expect(await f.operation.submit({ ...f.draft, title: 'Replacement' })).toBe('blocked');
                expectRetained(f);
                expectSamePreparedUploads(f);
                expect(f.insertions).toHaveLength(0);
                await late.commitServer();
                f.behaviors.clear();
                expect(await f.operation.submit(f.draft)).toBe('saved');
                expectRetained(f);
                expect(f.orphanPaths()).toEqual([]);
            } finally { now.mockRestore(); }
        });
    });

    test('forty-eight food uploads start in parallel after receipt and complete without application timers', async () => {
        const f = fixture(48);
        const allEntered = deferred<void>();
        const release = deferred<void>();
        let enteredCount = 0;
        for (let index = 1; index <= 48; index++) f.behaviors.set(index, async upload => {
            enteredCount++;
            if (enteredCount === 48) allEntered.resolve();
            await release.promise;
            f.commit(upload);
            return { error: null };
        });
        try {
            await withoutApplicationTimers(async () => {
                const submit = f.operation.submit(f.draft);
                await allEntered.promise;
                expect(f.objects.has(f.preparations[0][0].path)).toBe(true);
                expect(f.insertions).toHaveLength(0);
                expect(f.uploads).toHaveLength(49);
                release.resolve();
                expect(await submit).toBe('saved');
                expectRetained(f);
                expect(f.insertions[0].allAvailable).toBe(true);
                expect(f.orphanPaths()).toEqual([]);
            });
        } finally {
            release.resolve();
        }
    });
});
