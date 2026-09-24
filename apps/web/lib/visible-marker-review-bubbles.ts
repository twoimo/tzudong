import type { Restaurant } from '@/types/restaurant';
import { resolveReviewPhotoUrl } from '@/lib/review-photo-url';

export const VISIBLE_MARKER_REVIEW_BUBBLE_MOBILE_LIMIT = 3;
export const VISIBLE_MARKER_REVIEW_BUBBLE_DESKTOP_LIMIT = 5;
export const VISIBLE_MARKER_REVIEW_BUBBLE_CONTENT_MAX_LENGTH = 44;
export const VISIBLE_MARKER_REVIEW_BUBBLE_USER_MAX_LENGTH = 10;

export type VisibleMarkerReviewBubbleTarget = {
  restaurantId: string;
  relatedRestaurantIds: string[];
};

export type VisibleMarkerReviewBubble = {
  restaurantId: string;
  reviewId: string;
  userName: string;
  content: string;
  photoUrl: string | null;
};

export type VisibleMarkerReviewPhotoSource = {
  id: string;
  user_id: string | null | undefined;
  food_photos?: readonly unknown[] | null;
};

/**
 * Resolves the bubble thumbnail for one review. `food_photos` stores storage
 * object paths, so the raw value must go through the same owner/review-bound
 * resolver the review cards use; a bare key as an `img src` renders broken.
 */
export function resolveVisibleMarkerReviewBubblePhotoUrl(
  review: VisibleMarkerReviewPhotoSource,
): string | null {
  const photoPath = Array.isArray(review.food_photos)
    ? review.food_photos.find(
        (photo): photo is string => typeof photo === 'string' && photo.trim().length > 0,
      ) ?? null
    : null;
  if (!photoPath || typeof review.user_id !== 'string' || review.user_id.length === 0) {
    return null;
  }

  return resolveReviewPhotoUrl(photoPath, {
    ownerId: review.user_id,
    reviewId: review.id,
    purpose: 'food',
  });
}

type RestaurantWithVerifiedCount = Restaurant & {
  verified_review_count?: number | null;
};

function mixHash(hash: number, input: string) {
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}

function hashString(input: string): number {
  return mixHash(2166136261, input) >>> 0;
}

function getRestaurantReviewCount(restaurant: RestaurantWithVerifiedCount) {
  return restaurant.verified_review_count ?? restaurant.review_count ?? 0;
}

const relatedRestaurantIdsCache = new WeakMap<Restaurant, string[]>();

function getRelatedRestaurantIds(restaurant: Restaurant): string[] {
  const cached = relatedRestaurantIdsCache.get(restaurant);
  if (cached) return cached;

  const ids = new Set<string>();
  if (restaurant.id) ids.add(restaurant.id);
  restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
    if (mergedRestaurant.id) ids.add(mergedRestaurant.id);
  });
  const relatedIds = [...ids];
  relatedRestaurantIdsCache.set(restaurant, relatedIds);
  return relatedIds;
}

export function truncateVisibleMarkerReviewBubbleText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

type RankedReviewBubbleCandidate = {
  restaurant: Restaurant;
  rank: number;
  index: number;
};

function insertRankedReviewBubbleCandidate(
  selected: RankedReviewBubbleCandidate[],
  candidate: RankedReviewBubbleCandidate,
) {
  let index = selected.length;
  while (index > 0) {
    const previous = selected[index - 1];
    const previousComesFirst = previous.rank < candidate.rank
      || (previous.rank === candidate.rank && previous.index < candidate.index);
    if (previousComesFirst) break;
    index -= 1;
  }
  selected.splice(index, 0, candidate);
}

export function selectVisibleMarkerReviewBubbleTargets(
  restaurants: Restaurant[],
  options: { limit: number; seed: string },
): VisibleMarkerReviewBubbleTarget[] {
  if (!Array.isArray(restaurants) || !options || typeof options !== 'object') {
    console.warn('[visible-marker-review-bubbles] candidate selection rejected (invalid-input)');
    return [];
  }

  const rawLimit = options.limit;
  if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit) || rawLimit <= 0) return [];

  let missingId = false;
  const restaurantsWithKnownReviews: Restaurant[] = [];
  for (let index = 0; index < restaurants.length; index += 1) {
    const restaurant = restaurants[index];
    if (!restaurant?.id) {
      missingId = true;
      continue;
    }
    if (getRestaurantReviewCount(restaurant as RestaurantWithVerifiedCount) > 0) {
      restaurantsWithKnownReviews.push(restaurant);
    }
  }

  let sourceRestaurants = restaurantsWithKnownReviews;
  if (sourceRestaurants.length === 0) {
    if (!missingId) {
      sourceRestaurants = restaurants;
    } else {
      sourceRestaurants = [];
      for (let index = 0; index < restaurants.length; index += 1) {
        const restaurant = restaurants[index];
        if (restaurant?.id) sourceRestaurants.push(restaurant);
      }
    }
  }
  const limit = rawLimit === Number.POSITIVE_INFINITY ? sourceRestaurants.length : Math.trunc(rawLimit);
  if (limit <= 0 || sourceRestaurants.length === 0) return [];

  const seededHash = mixHash(mixHash(2166136261, options.seed), ':');
  const selected: RankedReviewBubbleCandidate[] = [];
  for (let index = 0; index < sourceRestaurants.length; index += 1) {
    const restaurant = sourceRestaurants[index];
    const rank = mixHash(seededHash, restaurant.id) >>> 0;
    if (selected.length >= limit) {
      const worst = selected[selected.length - 1];
      const replacesWorst = rank < worst.rank || (rank === worst.rank && index < worst.index);
      if (!replacesWorst) continue;
      selected.pop();
    }
    insertRankedReviewBubbleCandidate(selected, { restaurant, rank, index });
  }

  return selected.map(({ restaurant }) => ({
    restaurantId: restaurant.id,
    relatedRestaurantIds: getRelatedRestaurantIds(restaurant),
  }));
}

const visibleRestaurantIdSignatureCache = new WeakMap<readonly { id: string }[], string>();

export function buildVisibleRestaurantIdSignature(restaurants: readonly { id: string }[]) {
  const cached = visibleRestaurantIdSignatureCache.get(restaurants);
  if (cached !== undefined) return cached;
  const signature = restaurants.map((restaurant) => restaurant.id).join('|');
  visibleRestaurantIdSignatureCache.set(restaurants, signature);
  return signature;
}

export function buildVisibleMarkerReviewBubbleTargetSignature(targets: VisibleMarkerReviewBubbleTarget[]) {
  return targets
    .map((target) => `${target.restaurantId}:${target.relatedRestaurantIds.join(',')}`)
    .join('|');
}

export function buildVisibleMarkerReviewBubbleMapSignature(bubbles: Record<string, VisibleMarkerReviewBubble>) {
  return Object.values(bubbles)
    .map((bubble) => JSON.stringify([
      bubble.restaurantId,
      bubble.reviewId,
      bubble.userName,
      bubble.content,
      bubble.photoUrl,
    ]))
    .sort()
    .join('|');
}

const reviewBubbleRenderTokenCache = new WeakMap<VisibleMarkerReviewBubble, {
  restaurantId: string;
  reviewId: string;
  userName: string;
  content: string;
  photoUrl: string | null;
  mobile: boolean;
  token: string;
}>();

export function buildVisibleMarkerReviewBubbleRenderToken(
  bubble: VisibleMarkerReviewBubble,
  isMobile: boolean,
) {
  const cached = reviewBubbleRenderTokenCache.get(bubble);
  if (
    cached &&
    cached.restaurantId === bubble.restaurantId &&
    cached.reviewId === bubble.reviewId &&
    cached.userName === bubble.userName &&
    cached.content === bubble.content &&
    cached.photoUrl === bubble.photoUrl &&
    cached.mobile === isMobile
  ) {
    return cached.token;
  }

  const token = [
    'review-bubble',
    isMobile ? 'mobile' : 'desktop',
    buildVisibleMarkerReviewBubbleMapSignature({ [bubble.restaurantId]: bubble }),
  ].join(':');
  reviewBubbleRenderTokenCache.set(bubble, {
    restaurantId: bubble.restaurantId,
    reviewId: bubble.reviewId,
    userName: bubble.userName,
    content: bubble.content,
    photoUrl: bubble.photoUrl,
    mobile: isMobile,
    token,
  });
  return token;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVisibleMarkerReviewBubbleHtml(
  bubble: VisibleMarkerReviewBubble,
  options: { isMobile: boolean },
) {
  const width = options.isMobile ? 172 : 210;
  const photoSize = options.isMobile ? 34 : 40;
  const content = escapeHtml(
    truncateVisibleMarkerReviewBubbleText(
      bubble.content,
      options.isMobile ? VISIBLE_MARKER_REVIEW_BUBBLE_CONTENT_MAX_LENGTH : 58,
    ),
  );
  const userName = escapeHtml(
    truncateVisibleMarkerReviewBubbleText(bubble.userName, VISIBLE_MARKER_REVIEW_BUBBLE_USER_MAX_LENGTH),
  );
  const photo = bubble.photoUrl
    ? `<img src="${escapeHtml(bubble.photoUrl)}" alt="" loading="lazy" decoding="async" style="width:${photoSize}px;height:${photoSize}px;border-radius:10px;object-fit:cover;flex:0 0 auto;background:#f4f4f5;" />`
    : `<span aria-hidden="true" style="width:${photoSize}px;height:${photoSize}px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:#fee2e2;color:#b91c1c;font-size:15px;font-weight:900;flex:0 0 auto;">리</span>`;

  return `
    <div
      data-visible-marker-review-bubble="true"
      role="button"
      aria-label="${userName}님의 최근 리뷰 보기"
      style="
        position:absolute;
        left:50%;
        bottom:${options.isMobile ? 36 : 40}px;
        width:${width}px;
        max-width:${width}px;
        transform:translateX(-50%);
        border-radius:16px;
        background:rgba(255,255,255,0.96);
        border:1px solid rgba(190,18,60,0.18);
        padding:7px;
        display:flex;
        align-items:center;
        gap:7px;
        color:#111827;
        pointer-events:auto;
        user-select:none;
        -webkit-tap-highlight-color:transparent;
      "
    >
      ${photo}
      <span style="min-width:0;display:flex;flex-direction:column;gap:2px;line-height:1.2;">
        <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${options.isMobile ? 11 : 12}px;font-weight:800;color:#991b1b;">${userName}</strong>
        <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${options.isMobile ? 11 : 12}px;font-weight:650;color:#374151;">${content}</span>
      </span>
      <span aria-hidden="true" style="position:absolute;left:50%;bottom:-6px;width:12px;height:12px;transform:translateX(-50%) rotate(45deg);background:rgba(255,255,255,0.96);border-bottom:1px solid rgba(190,18,60,0.18);border-right:1px solid rgba(190,18,60,0.18);"></span>
    </div>
  `;
}
