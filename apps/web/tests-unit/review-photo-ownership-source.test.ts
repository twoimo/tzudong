import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('review photo ownership source contracts', () => {
  test('ReviewCard resolves only owner- and review-bound public URLs', () => {
    const reviewCardSource = source('components/reviews/ReviewCard.tsx');

    expect(reviewCardSource).toContain("import { resolveReviewPhotoUrl } from '@/lib/review-photo-url'");
    expect(reviewCardSource).toContain('resolveReviewPhotoUrl(photo.url, ownership)');
    expect(reviewCardSource).toContain("purpose: 'food' as const");
    expect(reviewCardSource).not.toContain("from('review-photos').getPublicUrl");
  });

  test('ReviewEditModal validates ownership before rendering, persisting, or deleting object keys', () => {
    const modalSource = source('components/reviews/ReviewEditModal.tsx');

    expect(modalSource).toContain('getCanonicalReviewPhotoObjectPath');
    expect(modalSource).toContain('getCanonicalReviewPhotoObjectPaths');
    expect(modalSource).toContain('getOwnedFoodPhotoPaths');
    expect(modalSource).toContain('buildReviewPhotoObjectPath');
    expect(modalSource).toContain('cleanupCanonicalReviewPhotoObjects');
    expect(modalSource).toContain('resolveReviewPhotoUrl(path, foodPhotoOwnership)');
    expect(modalSource).toContain('.eq("user_id", user.id)');
    expect(modalSource).toContain('const removedCleanup = await cleanupOwnedFoodPhotos(');
    expect(modalSource).toContain('[...existingFoodPhotos, ...removedPhotos]');
    expect(modalSource).toContain('const cleanup = await cleanupOwnedFoodPhotos(allPhotos, foodPhotoOwnership)');
    expect(modalSource).not.toContain('.remove(removedPhotos)');
    expect(modalSource).not.toContain("from('review-photos').getPublicUrl");
  });

  test('local File previews are restricted and revoked', () => {
    const modalSource = source('components/reviews/ReviewEditModal.tsx');

    expect(modalSource).toContain('const MAX_FOOD_PHOTOS = 10;');
    expect(modalSource).toContain('MAX_FOOD_PHOTOS - existingFoodPhotos.length - previousPhotos.length');
    expect(modalSource).toContain('URL.createObjectURL(photo)');
    expect(modalSource).toContain('URL.revokeObjectURL(url)');
    expect(modalSource).toContain('image/avif,image/jpeg,image/png,image/webp');
    expect(modalSource).not.toContain('accept="image/*"');
  });
});
