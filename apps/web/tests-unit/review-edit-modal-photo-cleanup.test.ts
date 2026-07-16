import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dir, '..', 'components/reviews/ReviewEditModal.tsx'),
  'utf8',
);

describe('ReviewEditModal photo cleanup workflow', () => {
  test('stages canonical cleanup before review mutations and whole-review deletion', () => {
    const stagedCleanup = source.indexOf('const removedCleanup = await cleanupOwnedFoodPhotos(');
    const reviewUpdate = source.indexOf('.from("reviews")\n                .update(');
    const deleteCleanup = source.indexOf('const cleanup = await cleanupOwnedFoodPhotos(allPhotos, foodPhotoOwnership)');
    const reviewDelete = source.indexOf('.from("reviews")\n                .delete()');

    expect(source).toContain('const allPhotos = getOwnedFoodPhotoPaths(\n            [...existingFoodPhotos, ...removedPhotos],');
    expect(stagedCleanup).toBeGreaterThan(-1);
    expect(reviewUpdate).toBeGreaterThan(stagedCleanup);
    expect(deleteCleanup).toBeGreaterThan(-1);
    expect(reviewDelete).toBeGreaterThan(deleteCleanup);
  });

  test('fails closed on resolved remove errors and keeps retryable cleanup state visible', () => {
    expect(source).toContain('if (!removedCleanup.success)');
    expect(source).toContain('if (!cleanup.success)');
    expect(source).toContain('throw new Error("REVIEW_PHOTO_CLEANUP_FAILED")');
    expect(source).toContain('const [cleanupFailureMessage, setCleanupFailureMessage] = useState<string | null>(null);');
    expect(source).toContain('if (!force && cleanupFailureMessage)');
    expect(source).toContain('role="alert" aria-live="assertive"');
  });

  test('compensates every tracked upload after partial upload or database failures', () => {
    const uploadLoop = source.indexOf('for (const [index, photo] of newFoodPhotos.entries())');
    const uploadedPathTracking = source.indexOf('uploadedNewPhotoPaths.push(photoPath)');
    const updateFailure = source.indexOf('throw new Error("REVIEW_UPDATE_FAILED")');
    const compensation = source.indexOf('const compensationSucceeded = await compensateUploadedPhotos()');

    expect(source).not.toContain('Promise.all(uploadPromises)');
    expect(uploadLoop).toBeGreaterThan(-1);
    expect(uploadedPathTracking).toBeGreaterThan(uploadLoop);
    expect(updateFailure).toBeGreaterThan(uploadedPathTracking);
    expect(compensation).toBeGreaterThan(updateFailure);
    expect(source).toContain('setRemovedPhotos((currentPaths) => mergeOwnedFoodPhotoPaths(');
    expect(source).toContain('REVIEW_PHOTO_UPLOAD_COMPENSATION_FAILED');
  });
});
