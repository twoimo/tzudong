import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const reviewDraftSource = readFileSync(
  join(import.meta.dir, "..", "lib", "reviewDraftDB.ts"),
  "utf8",
);
const draftStoreSource = readFileSync(
  join(import.meta.dir, "..", "lib", "drafts", "bounded-draft-store.ts"),
  "utf8",
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("review draft privacy persistence", () => {
  test("uses a v3 compound scope key with bounded expiry metadata", () => {
    expect(reviewDraftSource).toContain("dbVersion: 3,");
    expect(reviewDraftSource).toContain("slotField: 'restaurantId',");
    expect(draftStoreSource).toContain("keyPath: ['userId', config.slotField]");
    expect(draftStoreSource).toContain("store.createIndex('by-expires-at', 'expiresAt')");
    expect(draftStoreSource).toContain("store.createIndex('by-user-saved-at', ['userId', 'savedAt'])");
    expect(reviewDraftSource).toContain("maxDraftsPerUser: 20,");
    expect(reviewDraftSource).toContain("const MAX_RECORD_BYTES = 16 * 1024");
    expect(draftStoreSource).toContain("oldVersion < config.dbVersion");
  });

  test("constructs persisted and returned rows field-by-field without media", () => {
    const writeSection = section(reviewDraftSource, "function createPersistedDraft", "function toPublicDraft");
    const readSection = section(reviewDraftSource, "function toPublicDraft", "const FAILURE_LOG_LABELS");

    expect(writeSection).toContain("const persistedDraft: PersistedReviewDraft = {");
    expect(writeSection).toContain("expiresAt: now + REVIEW_DRAFT_TTL_MS");
    expect(writeSection).not.toContain("...draft,");
    expect(writeSection).not.toContain("verificationPhoto");
    expect(writeSection).not.toContain("foodPhotos");
    expect(writeSection).not.toContain("existingFoodPhotos");
    expect(writeSection).not.toContain("removedPhotos");
    expect(readSection).toContain("const publicDraft: ReviewDraft = {");
    expect(reviewDraftSource).toContain("type NeverRestoredReviewDraftMedia = {");
    expect(readSection).not.toContain("...draft,");
    expect(readSection).not.toContain("verificationPhoto");
    expect(readSection).not.toContain("foodPhotos");
    expect(readSection).not.toContain("existingFoodPhotos");
    expect(readSection).not.toContain("removedPhotos");
  });

  test("uses bounded cursors for cleanup, user lists, and deletion readback", () => {
    const cleanupSection = section(
      draftStoreSource,
      "async function sweepExpiredOrInvalidDrafts",
      "async function enforceUserDraftLimit",
    );
    const listSection = section(
      draftStoreSource,
      "async function getAllDraftsByUser",
      "async function cleanupOldDrafts",
    );
    const deleteSection = section(
      draftStoreSource,
      "async function deleteAllDraftsByUser",
      "async function getAllDraftsByUser",
    );

    for (const source of [reviewDraftSource, draftStoreSource]) {
      expect(source).not.toContain("getAll(");
      expect(source).not.toContain("getAllKeys(");
    }
    expect(reviewDraftSource).toContain("sweepBatchSize: 100,");
    expect(cleanupSection).toContain("expiredRows < sweepBatchSize");
    expect(cleanupSection).toContain("scannedRows < sweepBatchSize");
    expect(listSection).toContain("scannedRows < maxDraftsPerUser");
    expect(deleteSection).toContain("for (const ownerKey of [draftStorageOwnerKey(userId), ...legacyDraftStorageOwnerKeys(userId)])");
    expect(deleteSection).toContain("deleted < 100");
    expect(deleteSection).toContain("let cursor = await index.openCursor(ownerKey)");
    expect(deleteSection).toContain("readNonNegativeSafeInteger(await index.count(ownerKey))");
  });
});
