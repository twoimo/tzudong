import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { isBoundedIdentifier, readNonNegativeSafeInteger } from '@/lib/drafts/draft-fields';
import {
    assertBrowserDraftWrite,
    beginBrowserDraftCleanup,
    captureBrowserDraftEpoch,
    isBrowserDraftEpochCurrent,
    type BrowserDraftEpoch,
} from '@/lib/privacy/browser-draft-lifecycle';
import { draftStorageOwnerKey, legacyDraftStorageOwnerKeys } from '@/lib/privacy/draft-storage-owner';

type DraftKey = [owner: string, slot: string];
type DraftObjectStore = IDBPTransaction<unknown, [string], 'readwrite'>['store'];
type StoredDraft<SlotField extends string, Slot extends string> = { userId: string } & Record<SlotField, Slot>;

export type DraftStoreFailure = 'save' | 'delete' | 'list' | 'cleanup';

export interface BoundedDraftStoreConfig<
    SlotField extends string,
    Slot extends string,
    Input extends { userId: string },
    Stored extends StoredDraft<SlotField, Slot>,
    Public,
> {
    dbName: string;
    // Opening with a higher version deletes the store and every draft in it.
    dbVersion: number;
    storeName: string;
    slotField: SlotField;
    isSlot(value: unknown): value is Slot;
    maxDraftsPerUser: number;
    sweepBatchSize: number;
    parseInput(input: Input, now: number): Stored | null;
    parseStored(value: unknown, now: number): Stored | null;
    toPublic(stored: Stored): Public;
    invalidInputError: string;
    invalidRowSweep: 'resume-after-last-key' | 'restart-from-first-key';
    legacyRecovery: 'resume-after-last-key' | 'rescan-owner-index';
    pruneOnRead: boolean;
    extraSweepOnSave: boolean;
    onFailure?(operation: DraftStoreFailure): void;
}

export function createBoundedDraftStore<
    SlotField extends string,
    Slot extends string,
    Input extends { userId: string },
    Stored extends StoredDraft<SlotField, Slot>,
    Public,
>(config: BoundedDraftStoreConfig<SlotField, Slot, Input, Stored, Public>) {
    const { storeName, maxDraftsPerUser, sweepBatchSize } = config;
    const resumeRecovery = config.legacyRecovery === 'resume-after-last-key';
    const legacyRecoveryPositions = new WeakMap<BrowserDraftEpoch, { namespace: number; after?: DraftKey }>();
    let invalidSweepAfter: IDBValidKey | undefined;

    const keyOf = (draft: Stored): DraftKey => [draft.userId, draft[config.slotField]];
    const userDraftRange = (userId: string) =>
        IDBKeyRange.bound([draftStorageOwnerKey(userId), ''], [draftStorageOwnerKey(userId), '\uffff']);

    async function openDatabase(): Promise<IDBPDatabase> {
        const db = await openDB(config.dbName, config.dbVersion, {
            upgrade(database, oldVersion) {
                if (oldVersion < config.dbVersion && database.objectStoreNames.contains(storeName)) {
                    database.deleteObjectStore(storeName);
                }
                if (!database.objectStoreNames.contains(storeName)) {
                    const store = database.createObjectStore(storeName, { keyPath: ['userId', config.slotField] });
                    store.createIndex('by-user', 'userId');
                    store.createIndex('by-user-saved-at', ['userId', 'savedAt']);
                    store.createIndex('by-expires-at', 'expiresAt');
                }
            },
        });

        await sweepExpiredOrInvalidDrafts(db);
        return db;
    }

    async function sweepExpiredOrInvalidDrafts(db: IDBPDatabase): Promise<void> {
        const now = Date.now();

        const expiredTransaction = db.transaction(storeName, 'readwrite');
        let expiredCursor = await expiredTransaction.store.index('by-expires-at').openCursor(IDBKeyRange.upperBound(now));
        let expiredRows = 0;
        while (expiredCursor && expiredRows < sweepBatchSize) {
            await expiredCursor.delete();
            expiredRows += 1;
            expiredCursor = await expiredCursor.continue();
        }
        await expiredTransaction.done;

        const invalidTransaction = db.transaction(storeName, 'readwrite');
        let invalidCursor = await invalidTransaction.store.openCursor(
            invalidSweepAfter === undefined ? undefined : IDBKeyRange.lowerBound(invalidSweepAfter, true),
        );
        let scannedRows = 0;
        let lastKey: IDBValidKey | undefined;
        while (invalidCursor && scannedRows < sweepBatchSize) {
            lastKey = invalidCursor.primaryKey;
            if (!config.parseStored(invalidCursor.value, now)) {
                await invalidCursor.delete();
            }
            scannedRows += 1;
            invalidCursor = await invalidCursor.continue();
        }
        if (config.invalidRowSweep === 'resume-after-last-key') invalidSweepAfter = invalidCursor ? lastKey : undefined;
        await invalidTransaction.done;
    }

    async function enforceUserDraftLimit(store: DraftObjectStore, userId: string, epoch: BrowserDraftEpoch): Promise<void> {
        const index = store.index('by-user-saved-at');
        const range = userDraftRange(userId);
        const countedDrafts = readNonNegativeSafeInteger(await index.count(range));
        if (countedDrafts === null) throw new Error('임시 저장 데이터 수를 확인할 수 없습니다.');

        let draftCount = countedDrafts;
        let cursor = await index.openCursor(range);

        while (cursor && draftCount > maxDraftsPerUser) {
            assertBrowserDraftWrite(userId, epoch);
            await cursor.delete();
            draftCount -= 1;
            cursor = await cursor.continue();
        }
    }

    async function saveDraft(draft: Input): Promise<Public | null> {
        const persistedDraft = config.parseInput(draft, Date.now());
        if (!persistedDraft) throw new Error(config.invalidInputError);

        const epoch = captureBrowserDraftEpoch(draft.userId);
        assertBrowserDraftWrite(draft.userId, epoch);

        try {
            const db = await openDatabase();
            if (config.extraSweepOnSave) await sweepExpiredOrInvalidDrafts(db);
            assertBrowserDraftWrite(draft.userId, epoch);
            const transaction = db.transaction(storeName, 'readwrite');
            const key = keyOf(persistedDraft);
            // Wait for this readwrite transaction to acquire its store before
            // admitting the write. A pre-transaction localStorage check alone
            // leaves a gap while another tab can finish a cleanup transaction.
            await transaction.store.get(key);
            assertBrowserDraftWrite(draft.userId, epoch);
            await transaction.store.put(persistedDraft);
            await enforceUserDraftLimit(transaction.store, draft.userId, epoch);
            const committed: Stored | undefined = await transaction.store.get(key);
            await transaction.done;
            return committed && isBrowserDraftEpochCurrent(draft.userId, epoch, true) ? config.toPublic(committed) : null;
        } catch {
            config.onFailure?.('save');
            throw new Error('임시 저장에 실패했습니다.');
        }
    }

    async function getDraft(userId: string, slot: Slot): Promise<Public | null> {
        if (!isBoundedIdentifier(userId) || !config.isSlot(slot)) return null;

        const epoch = captureBrowserDraftEpoch(userId);
        if (!isBrowserDraftEpochCurrent(userId, epoch, true)) throw new Error('DRAFT_READ_UNAVAILABLE');

        let transactionDone: Promise<unknown> | undefined;
        try {
            const db = await openDatabase();
            const key: DraftKey = [draftStorageOwnerKey(userId), slot];
            assertBrowserDraftWrite(userId, epoch);
            const transaction = db.transaction(storeName, 'readwrite');
            transactionDone = transaction.done;
            if (config.pruneOnRead) await enforceUserDraftLimit(transaction.store, userId, epoch);

            const stored: unknown = await transaction.store.get(key);
            const draft = config.parseStored(stored, Date.now());
            if (!draft || draft.userId !== key[0] || draft[config.slotField] !== slot) {
                if (stored) { assertBrowserDraftWrite(userId, epoch); await transaction.store.delete(key); }
                await transaction.done;
                return null;
            }
            await transaction.done;
            return isBrowserDraftEpochCurrent(userId, epoch, true) ? config.toPublic(draft) : null;
        } catch {
            await transactionDone?.catch(() => {});
            if (!isBrowserDraftEpochCurrent(userId, epoch, true)) return null;
            throw new Error('DRAFT_READ_UNAVAILABLE');
        }
    }

    async function hasDraft(userId: string, slot: Slot): Promise<boolean> {
        return (await getDraft(userId, slot)) !== null;
    }

    async function deleteDraft(userId: string, slot: Slot): Promise<void> {
        if (!isBoundedIdentifier(userId) || !config.isSlot(slot)) return;

        const epoch = captureBrowserDraftEpoch(userId);
        let db: IDBPDatabase | undefined;
        try {
            db = await openDatabase();
            if (!isBrowserDraftEpochCurrent(userId, epoch)) return;
            const transaction = db.transaction(storeName, 'readwrite');
            const deletions: Promise<void>[] = [];
            try {
                // Acquire the transaction before checking the session, then remove both
                // versions of this explicit discard atomically. Otherwise a later import
                // could resurrect the old text.
                await transaction.store.get([draftStorageOwnerKey(userId), slot]);
                if (isBrowserDraftEpochCurrent(userId, epoch)) {
                    deletions.push(transaction.store.delete([draftStorageOwnerKey(userId), slot]));
                    for (const legacyOwner of legacyDraftStorageOwnerKeys(userId)) {
                        deletions.push(transaction.store.delete([legacyOwner, slot]));
                    }
                    await Promise.all(deletions);
                }
                await transaction.done;
            } catch {
                try { transaction.abort(); } catch { /* It may already have completed. */ }
                await Promise.allSettled(deletions);
                await transaction.done.catch(() => {});
                throw new Error('DRAFT_DELETE_FAILED');
            }
        } catch {
            config.onFailure?.('delete');
            throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
        } finally { db?.close(); }
    }

    // Delete every scoped row and read back from the same transaction before reporting success.
    async function deleteAllDraftsByUser(userId: string, cleanupEpoch?: BrowserDraftEpoch): Promise<boolean> {
        if (!isBoundedIdentifier(userId)) return false;
        const epoch = cleanupEpoch ?? beginBrowserDraftCleanup(userId);
        try {
            const db = await openDatabase();
            if (!isBrowserDraftEpochCurrent(userId, epoch)) return false;
            const transaction = db.transaction(storeName, 'readwrite');
            const index = transaction.store.index('by-user');
            let remaining = 0;
            for (const ownerKey of [draftStorageOwnerKey(userId), ...legacyDraftStorageOwnerKeys(userId)]) {
                let cursor = await index.openCursor(ownerKey);
                let deleted = 0;
                while (cursor && deleted < 100) {
                    if (!isBrowserDraftEpochCurrent(userId, epoch)) { await transaction.done; return false; }
                    await cursor.delete();
                    deleted++;
                    cursor = await cursor.continue();
                }
                const count = readNonNegativeSafeInteger(await index.count(ownerKey));
                if (count === null) { await transaction.done; return false; }
                remaining += count;
            }
            await transaction.done;
            return remaining === 0 && isBrowserDraftEpochCurrent(userId, epoch);
        } catch { return false; }
    }

    async function getAllDraftsByUser(userId: string): Promise<Public[]> {
        if (!isBoundedIdentifier(userId)) return [];

        const epoch = captureBrowserDraftEpoch(userId);
        if (!isBrowserDraftEpochCurrent(userId, epoch, true)) return [];

        try {
            const db = await openDatabase();
            assertBrowserDraftWrite(userId, epoch);
            const transaction = db.transaction(storeName, 'readwrite');
            if (config.pruneOnRead) await enforceUserDraftLimit(transaction.store, userId, epoch);

            const drafts: Public[] = [];
            let cursor = await transaction.store.index('by-user-saved-at').openCursor(userDraftRange(userId));
            let scannedRows = 0;
            const now = Date.now();
            while (cursor && scannedRows < maxDraftsPerUser) {
                const draft = config.parseStored(cursor.value, now);
                if (draft && draft.userId === draftStorageOwnerKey(userId)) {
                    drafts.push(config.toPublic(draft));
                } else {
                    assertBrowserDraftWrite(userId, epoch);
                    await cursor.delete();
                }
                scannedRows += 1;
                cursor = await cursor.continue();
            }

            await transaction.done;
            return isBrowserDraftEpochCurrent(userId, epoch, true) ? drafts : [];
        } catch {
            config.onFailure?.('list');
            return [];
        }
    }

    async function cleanupOldDrafts(): Promise<void> {
        try {
            const db = await openDatabase();
            await sweepExpiredOrInvalidDrafts(db);
        } catch {
            config.onFailure?.('cleanup');
        }
    }

    // Explicit, owner-scoped recovery preserves timestamps/expiry and never replaces
    // an existing current draft. Old clients may still write legacy rows afterward;
    // those rows never become an automatic restore source.
    async function recoverLegacyDrafts(userId: string): Promise<number> {
        if (!isBoundedIdentifier(userId)) return 0;
        const epoch = captureBrowserDraftEpoch(userId);
        assertBrowserDraftWrite(userId, epoch);
        const db = await openDatabase();
        const transaction = db.transaction(storeName, 'readwrite');
        try {
            const ownerKey = draftStorageOwnerKey(userId);
            const index = transaction.store.index('by-user');
            const existingCount = readNonNegativeSafeInteger(await index.count(ownerKey));
            if (existingCount === null) throw new Error('DRAFT_RECOVERY_FAILED');
            let count = existingCount;
            let imported = 0;
            let scanned = 0;
            const legacyOwners = legacyDraftStorageOwnerKeys(userId);
            const progress = legacyRecoveryPositions.get(epoch);
            let namespace = progress?.namespace ?? 0;
            let after = progress?.after;
            for (; namespace < legacyOwners.length && scanned < maxDraftsPerUser && count < maxDraftsPerUser; namespace++) {
                const legacyOwner = legacyOwners[namespace];
                // A closed upper endpoint cannot become an exclusive lower bound.
                if (after && after[1] >= '\uffff') { after = undefined; continue; }
                let cursor = resumeRecovery
                    ? await transaction.store.openCursor(IDBKeyRange.bound(
                        after ?? [legacyOwner, ''], [legacyOwner, '\uffff'], after !== undefined,
                    ))
                    : await index.openCursor(legacyOwner);
                after = undefined;
                while (cursor && scanned < maxDraftsPerUser && count < maxDraftsPerUser) {
                    const row = config.parseStored(cursor.value, Date.now());
                    const candidate = row && config.parseStored({ ...row, userId: ownerKey }, Date.now());
                    if (candidate && row && row.userId === legacyOwner) {
                        const key = keyOf(candidate);
                        const existing: unknown = await transaction.store.get(key);
                        assertBrowserDraftWrite(userId, epoch);
                        if (existing === undefined) {
                            await transaction.store.put(candidate);
                            // Move only after the validated copy is admitted. Both operations
                            // share this transaction; failure preserves the original.
                            assertBrowserDraftWrite(userId, epoch);
                            await cursor.delete();
                            imported++;
                            count++;
                        }
                    }
                    scanned++;
                    after = cursor.primaryKey as DraftKey;
                    if (scanned >= maxDraftsPerUser || count >= maxDraftsPerUser) break;
                    cursor = await cursor.continue();
                }
                if (cursor) break;
                after = undefined;
            }
            await transaction.done;
            assertBrowserDraftWrite(userId, epoch);
            // Commit progress with the copy, never with an aborted or stale session.
            if (resumeRecovery) {
                if (namespace < legacyOwners.length) legacyRecoveryPositions.set(epoch, { namespace, after });
                else legacyRecoveryPositions.delete(epoch);
            }
            return imported;
        } catch {
            try { transaction.abort(); } catch { /* It may already have completed. */ }
            await transaction.done.catch(() => {});
            throw new Error('DRAFT_RECOVERY_FAILED');
        } finally { db.close(); }
    }

    return {
        openDatabase,
        saveDraft,
        getDraft,
        hasDraft,
        deleteDraft,
        deleteAllDraftsByUser,
        getAllDraftsByUser,
        cleanupOldDrafts,
        recoverLegacyDrafts,
    };
}
