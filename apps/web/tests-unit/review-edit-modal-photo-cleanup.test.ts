import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const source = readFileSync(join(import.meta.dir, '../components/reviews/ReviewEditModal.tsx'), 'utf8');
const mypage = readFileSync(join(import.meta.dir, '../app/mypage/reviews/page.tsx'), 'utf8');
describe('shared review mutation UI boundary', () => {
  test('both UIs use commit-aware mutations and cannot directly remove photos or rows', () => {
    for (const ui of [source, mypage]) {
      expect(ui).toContain('ReviewMediaMutation');
      expect(ui).not.toContain('.delete()');
      expect(ui).not.toContain('cleanupCanonicalReviewPhotoObjects');
      expect(ui).not.toContain('error.message');
    }
    expect(source).toContain('if (!outcome.committed) return;');
    expect(mypage).toContain('if (!outcome.committed) return;');
  });
  test('uncertain requests keep their retry action and cleanup can resume without a review card', () => {
    expect(source.match(/같은 요청 다시 확인/g)?.length).toBe(2);
    expect(source.match(/실패한 업로드 취소/g)?.length).toBe(3);
    expect(source).toContain('setRetryKind(mutationRef.current!.pendingKind)');
    expect(source.match(/disabled=\{isSubmitting \|\| isDeleting \|\| retryKind !== null\}/g)?.length).toBe(4);
    expect(source).toContain('mutationRef.current?.pending');
    expect(mypage.indexOf('사진 정리 다시 시도')).toBeLessThan(mypage.indexOf('{filteredReviews.length === 0'));
    expect(mypage).toContain('void retryCleanup();');
  });
  test('edit keeps authoritative historical photo values separate from Storage object paths', () => {
    expect(source).toContain('foodPhotos: getEditableFoodPhotoValues(existingFoodPhotos, review.foodPhotos, foodPhotoOwnership)');
    expect(source).toContain('resolveReviewPhotoUrl(storedValue, foodPhotoOwnership)');
    expect(source).toContain('removeExistingFoodPhoto(storedValue, storedIndex)');
    expect(source).not.toContain('foodPhotos: getOwnedFoodPhotoPaths(existingFoodPhotos');
  });
});
