import { describe, expect, test } from 'bun:test';

import {
  buildVisibleMarkerReviewBubbleMapSignature,
  type VisibleMarkerReviewBubble,
} from '../lib/visible-marker-review-bubbles';

const baseBubble: VisibleMarkerReviewBubble = {
  restaurantId: 'restaurant-1',
  reviewId: 'review-1',
  userName: '리뷰어',
  content: '국물이 진하고 만두가 푸짐해요.',
  photoUrl: 'https://example.com/review.jpg',
};

describe('visible marker review bubble signatures', () => {
  test('changes when rendered bubble content changes under the same review id', () => {
    const baseSignature = buildVisibleMarkerReviewBubbleMapSignature({
      [baseBubble.restaurantId]: baseBubble,
    });

    for (const changedBubble of [
      { ...baseBubble, userName: '다른 리뷰어' },
      { ...baseBubble, content: '새로 동기화된 리뷰 내용' },
      { ...baseBubble, photoUrl: 'https://example.com/updated-review.jpg' },
      { ...baseBubble, photoUrl: null },
    ]) {
      expect(buildVisibleMarkerReviewBubbleMapSignature({
        [changedBubble.restaurantId]: changedBubble,
      })).not.toBe(baseSignature);
    }
  });

  test('is stable regardless of record insertion order', () => {
    const secondBubble: VisibleMarkerReviewBubble = {
      ...baseBubble,
      restaurantId: 'restaurant-2',
      reviewId: 'review-2',
    };

    expect(buildVisibleMarkerReviewBubbleMapSignature({
      [baseBubble.restaurantId]: baseBubble,
      [secondBubble.restaurantId]: secondBubble,
    })).toBe(buildVisibleMarkerReviewBubbleMapSignature({
      [secondBubble.restaurantId]: secondBubble,
      [baseBubble.restaurantId]: baseBubble,
    }));
  });
});
