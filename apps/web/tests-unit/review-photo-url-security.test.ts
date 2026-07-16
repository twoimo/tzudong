import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

const SUPABASE_ORIGIN = 'https://project-ref.supabase.co';
const OWNER = {
  ownerId: 'owner-123',
  reviewId: 'review-456',
  purpose: 'food' as const,
};
const VALID_PATH = 'owner-123/reviews/review-456/food/food-1.webp';
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

mock.module('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_ORIGIN}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
          },
        }),
      }),
    },
  },
}));

const {
  buildReviewPhotoObjectPath,
  cleanupCanonicalReviewPhotoObjects,
  getCanonicalReviewPhotoObjectPath,
  resolveReviewPhotoUrl,
} = await import('../lib/review-photo-url.ts?security-contract');

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
});

afterAll(() => {
  if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
  mock.restore();
});

describe('review photo URL trust boundary', () => {
  test('builds and resolves a canonical key bound to its owner and review', () => {
    expect(buildReviewPhotoObjectPath(OWNER, 'food-1.webp')).toBe(VALID_PATH);
    expect(getCanonicalReviewPhotoObjectPath(VALID_PATH, OWNER)).toBe(VALID_PATH);
    expect(resolveReviewPhotoUrl(VALID_PATH, OWNER)).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/review-photos/${VALID_PATH}`,
    );
    expect(resolveReviewPhotoUrl(VALID_PATH, OWNER, '2026-07-13T00:00:00.000Z')).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/review-photos/${VALID_PATH}?t=1783900800000`,
    );
  });

  test('rejects another owner, review, or purpose', () => {
    expect(getCanonicalReviewPhotoObjectPath(
      'other-owner/reviews/review-456/food/food-1.webp',
      OWNER,
    )).toBeNull();
    expect(getCanonicalReviewPhotoObjectPath(
      'owner-123/reviews/other-review/food/food-1.webp',
      OWNER,
    )).toBeNull();
    expect(getCanonicalReviewPhotoObjectPath(
      'owner-123/reviews/review-456/verification/food-1.webp',
      OWNER,
    )).toBeNull();
  });

  test('rejects absolute URLs, buckets, traversal, encoded separators, queries, and fragments', () => {
    const publicUrl = `${SUPABASE_ORIGIN}/storage/v1/object/public/review-photos/${VALID_PATH}`;
    for (const value of [
      publicUrl,
      `${SUPABASE_ORIGIN}/storage/v1/object/public/other-bucket/${VALID_PATH}`,
      'https://evil.example/storage/v1/object/public/review-photos/owner-123/reviews/review-456/food/food-1.webp',
      'owner-123/reviews/review-456/food/../food-1.webp',
      'owner-123/reviews/review-456/food/%2e%2e/food-1.webp',
      'owner-123/reviews/review-456/food/%2e%2e.webp',
      'owner-123/reviews/review-456/food/food%2f1.webp',
      'owner-123/reviews/review-456/food/food%zz.webp',
      `${VALID_PATH}?token=secret`,
      `${VALID_PATH}#fragment`,
    ]) {
      expect(resolveReviewPhotoUrl(value, OWNER)).toBeNull();
    }
  });

  test('rejects controls, malformed key shapes, and unsupported image extensions', () => {
    for (const value of [
      'owner-123/reviews/review-456/food/food-1.svg',
      'owner-123/reviews/review-456/food/food-1.txt',
      'owner-123/reviews/review-456/food/.webp',
      'owner-123/reviews/review-456/food/food-1.webp\n',
      'owner-123//reviews/review-456/food/food-1.webp',
      'javascript:alert(1)',
      '',
    ]) {
      expect(resolveReviewPhotoUrl(value, OWNER)).toBeNull();
    }
  });

  test('fails closed without owner binding and for invalid cache-buster values', () => {
    expect(resolveReviewPhotoUrl(VALID_PATH, null)).toBeNull();
    expect(resolveReviewPhotoUrl(VALID_PATH, '2026-07-13T00:00:00.000Z')).toBeNull();
    expect(resolveReviewPhotoUrl(VALID_PATH, OWNER, 'not-a-date')).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/review-photos/${VALID_PATH}`,
    );
  });
  test('rejects an arbitrary tracker origin even when the storage client generates that origin', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tracker.example';

    try {
      expect(resolveReviewPhotoUrl(VALID_PATH, OWNER)).toBeNull();
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
    }
  });

  test('deduplicates cleanup keys and verifies removal through storage readback', async () => {
    const removeCalls: string[][] = [];
    const listCalls: Array<{ directory: string; filename: string }> = [];
    const storage = {
      remove: async (paths: string[]) => {
        removeCalls.push(paths);
        return { error: null };
      },
      list: async (directory: string, options: { limit: number; search: string }) => {
        listCalls.push({ directory, filename: options.search });
        return { data: [], error: null };
      },
    };

    const first = await cleanupCanonicalReviewPhotoObjects(
      [VALID_PATH, VALID_PATH, 'other/reviews/review-456/food/food-2.webp'],
      OWNER,
      storage,
    );
    const retry = await cleanupCanonicalReviewPhotoObjects([VALID_PATH], OWNER, storage);

    expect(first).toEqual({ paths: [VALID_PATH], success: true });
    expect(retry).toEqual({ paths: [VALID_PATH], success: true });
    expect(removeCalls).toEqual([[VALID_PATH], [VALID_PATH]]);
    expect(listCalls).toEqual([
      { directory: 'owner-123/reviews/review-456/food', filename: 'food-1.webp' },
      { directory: 'owner-123/reviews/review-456/food', filename: 'food-1.webp' },
    ]);
  });

  test('retains the exact canonical retry set when remove resolves an error or readback finds an object', async () => {
    const removeError = await cleanupCanonicalReviewPhotoObjects(
      [VALID_PATH, VALID_PATH],
      OWNER,
      {
        remove: async () => ({ error: { message: 'remove failed' } }),
        list: async () => ({ data: [], error: null }),
      },
    );
    const readbackFailure = await cleanupCanonicalReviewPhotoObjects(
      [VALID_PATH],
      OWNER,
      {
        remove: async () => ({ error: null }),
        list: async () => ({ data: [{ name: 'food-1.webp' }], error: null }),
      },
    );

    expect(removeError).toEqual({ paths: [VALID_PATH], success: false });
    expect(readbackFailure).toEqual({ paths: [VALID_PATH], success: false });
  });
});
