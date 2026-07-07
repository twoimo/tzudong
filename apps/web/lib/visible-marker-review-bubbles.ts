import type { Restaurant } from '@/types/restaurant';

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

type RestaurantWithVerifiedCount = Restaurant & {
  verified_review_count?: number | null;
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getRestaurantReviewCount(restaurant: RestaurantWithVerifiedCount) {
  return restaurant.verified_review_count ?? restaurant.review_count ?? 0;
}

function getRelatedRestaurantIds(restaurant: Restaurant): string[] {
  const ids = new Set<string>();
  if (restaurant.id) ids.add(restaurant.id);
  restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
    if (mergedRestaurant.id) ids.add(mergedRestaurant.id);
  });
  return [...ids];
}

export function truncateVisibleMarkerReviewBubbleText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function selectVisibleMarkerReviewBubbleTargets(
  restaurants: Restaurant[],
  options: { limit: number; seed: string },
): VisibleMarkerReviewBubbleTarget[] {
  if (options.limit <= 0) return [];

  const candidates = restaurants
    .filter((restaurant): restaurant is Restaurant => Boolean(restaurant?.id))
    .filter((restaurant) => getRelatedRestaurantIds(restaurant).length > 0);
  const restaurantsWithKnownReviews = candidates.filter(
    (restaurant) => getRestaurantReviewCount(restaurant as RestaurantWithVerifiedCount) > 0,
  );
  const sourceRestaurants = restaurantsWithKnownReviews.length > 0
    ? restaurantsWithKnownReviews
    : candidates;

  return sourceRestaurants
    .map((restaurant) => ({
      restaurant,
      rank: hashString(`${options.seed}:${restaurant.id}`),
    }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, options.limit)
    .map(({ restaurant }) => ({
      restaurantId: restaurant.id,
      relatedRestaurantIds: getRelatedRestaurantIds(restaurant),
    }));
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
        box-shadow:0 10px 24px rgba(15,23,42,0.18);
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
