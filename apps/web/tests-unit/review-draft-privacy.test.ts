import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const reviewDraftSource = readFileSync(
  join(import.meta.dir, "..", "lib", "reviewDraftDB.ts"),
  "utf8",
);

function section(start: string, end: string): string {
  const startIndex = reviewDraftSource.indexOf(start);
  const endIndex = reviewDraftSource.indexOf(end, startIndex);
  return reviewDraftSource.slice(startIndex, endIndex);
}

describe("review draft privacy persistence", () => {
  test("uses a v3 compound scope key with bounded expiry metadata", () => {
    expect(reviewDraftSource).toContain("const DB_VERSION = 3");
    expect(reviewDraftSource).toContain("keyPath: ['userId', 'restaurantId']");
    expect(reviewDraftSource).toContain("store.createIndex('by-expires-at', 'expiresAt')");
    expect(reviewDraftSource).toContain("store.createIndex('by-user-saved-at', ['userId', 'savedAt'])");
    expect(reviewDraftSource).toContain("const MAX_DRAFTS_PER_USER = 20");
    expect(reviewDraftSource).toContain("const MAX_RECORD_BYTES = 16 * 1024");
    expect(reviewDraftSource).toContain("oldVersion < DB_VERSION");
  });

  test("constructs persisted and returned rows field-by-field without media", () => {
    const writeSection = section("function createPersistedDraft", "function toPublicDraft");
    const readSection = section("function toPublicDraft", "function userDraftRange");

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
      "async function sweepExpiredOrInvalidDrafts",
      "async function enforceUserDraftLimit",
    );
    const listSection = section(
      "export async function getAllDraftsByUser",
      "export async function cleanupOldDrafts",
    );
    const deleteSection = section(
      "export async function deleteAllDraftsByUser",
      "export async function getAllDraftsByUser",
    );

    expect(reviewDraftSource).not.toContain("getAll(");
    expect(reviewDraftSource).not.toContain("getAllKeys(");
    expect(cleanupSection).toContain("expiredRows < MAX_SWEEP_ROWS");
    expect(cleanupSection).toContain("scannedRows < MAX_SWEEP_ROWS");
    expect(listSection).toContain("scannedRows < MAX_DRAFTS_PER_USER");
    expect(deleteSection).toContain("let cursor = await index.openCursor(userId)");
    expect(deleteSection).toContain("const remainingDrafts = await index.count(userId)");
  });
});
