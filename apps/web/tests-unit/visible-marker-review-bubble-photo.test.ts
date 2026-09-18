import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

const SUPABASE_ORIGIN = 'https://project-ref.supabase.co';
const OWNER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const REVIEW_ID = 'a1b2c3d4-0000-4000-8000-000000000002';
const CANONICAL_PATH = `${OWNER_ID}/reviews/${REVIEW_ID}/food/food-1.webp`;
const priorSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

mock.module('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE_ORIGIN}/storage/v1/object/public/${bucket}/${path
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`,
          },
        }),
      }),
    },
  },
}));

const { resolveVisibleMarkerReviewBubblePhotoUrl } = await import(
  '../lib/visible-marker-review-bubbles.ts?bubble-photo-contract'
);

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
});

afterAll(() => {
  if (priorSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = priorSupabaseUrl;
  mock.restore();
});

describe('visible marker review bubble photo resolution', () => {
  test('resolves a stored object path to the review-bound public URL', () => {
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        food_photos: [CANONICAL_PATH],
      }),
    ).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/review-photos/${CANONICAL_PATH}`,
    );
  });

  test('uses the first usable path and ignores blank entries', () => {
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        food_photos: ['   ', CANONICAL_PATH],
      }),
    ).toContain('/review-photos/');
  });

  test('refuses a path that is not bound to the review owner', () => {
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        food_photos: [`b2c3d4e5-0000-4000-8000-000000000009/reviews/${REVIEW_ID}/food/food-1.webp`],
      }),
    ).toBeNull();
  });

  test('returns null when there is no photo or no owner', () => {
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        food_photos: [],
      }),
    ).toBeNull();
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: null,
        food_photos: [CANONICAL_PATH],
      }),
    ).toBeNull();
    expect(
      resolveVisibleMarkerReviewBubblePhotoUrl({
        id: REVIEW_ID,
        user_id: OWNER_ID,
        food_photos: null,
      }),
    ).toBeNull();
  });
});
