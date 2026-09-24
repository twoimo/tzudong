import type { Restaurant } from '@/types/restaurant';
import { createIndividualMarkerHTML } from '@/lib/cluster-marker';
import { getPrimaryCategory } from '@/lib/naver-map-view-helpers';
import { getTzuyangVisitCount } from '@/lib/restaurant-visit-count';
import {
    RESTAURANT_MARKER_ASSET_VERSION,
    resolveRestaurantMarkerKind,
    type RestaurantMarkerKind,
    type RestaurantOverlayMarkerKind,
} from '@/lib/restaurant-marker-kind';

type NaverIndividualMarkerRestaurant = Partial<Pick<
    Restaurant,
    | 'id'
    | 'categories'
    | 'youtube_link'
    | 'youtube_links'
    | 'tzuyang_review'
    | 'tzuyang_reviews'
    | 'mergedYoutubeLinks'
    | 'mergedTzuyangReviews'
    | 'mergedRestaurants'
    | 'source_type'
>> & {
    category?: string | string[] | null;
};

const MARKER_VISUAL_CACHE_LIMIT = 2000;
const markerVisualCache = new Map<string, {
    content: string;
    anchor: { x: number; y: number };
    zIndex: number;
}>();

function readMarkerVisualCache(key: string) {
    const cached = markerVisualCache.get(key);
    if (!cached) return null;
    markerVisualCache.delete(key);
    markerVisualCache.set(key, cached);
    return cached;
}

function writeMarkerVisualCache(key: string, visual: {
    content: string;
    anchor: { x: number; y: number };
    zIndex: number;
}) {
    if (markerVisualCache.size >= MARKER_VISUAL_CACHE_LIMIT) {
        const oldest = markerVisualCache.keys().next().value;
        if (oldest) markerVisualCache.delete(oldest);
    }
    markerVisualCache.set(key, visual);
    return visual;
}

function getMarkerKindBadgeConfig(markerKind: Exclude<RestaurantMarkerKind, 'category'>) {
    if (markerKind === 'trend') {
        return {
            label: '트렌드',
            ariaLabel: '관리자 트렌드 맛집',
            background: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)',
        };
    }

    if (markerKind === 'seasonal') {
        return {
            label: '제철',
            ariaLabel: '관리자 제철 맛집',
            background: 'linear-gradient(135deg, #16a34a 0%, #0d9488 100%)',
        };
    }

    return {
        label: '제보',
        ariaLabel: '사용자 제보 맛집',
        background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
    };
}

function wrapSpecialMarkerContent(
    content: string,
    isSelected: boolean,
    markerKind: Exclude<RestaurantMarkerKind, 'category'>,
): string {
    const badgeSize = isSelected ? 24 : 22;
    const badgeFontSize = isSelected ? 10 : 9;
    const badgeOffset = isSelected ? -10 : -9;
    const badgeConfig = getMarkerKindBadgeConfig(markerKind);
    const markerProvenance =
        markerKind === 'user-submitted'
            ? 'source_type:user_submission_new'
            : `overlay:${markerKind}`;

    return `
        <div
          data-restaurant-marker-kind="${markerKind}"
          data-restaurant-marker-provenance="${markerProvenance}"
          data-restaurant-marker-asset-version="${RESTAURANT_MARKER_ASSET_VERSION}"
          style="
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            overflow: visible;
          "
        >
          ${content}
          <span
            aria-label="${badgeConfig.ariaLabel}"
            style="
              position: absolute;
              right: ${badgeOffset}px;
              bottom: ${badgeOffset}px;
              min-width: ${badgeSize}px;
              height: ${badgeSize}px;
              padding: 0 4px;
              border-radius: 9999px;
              background: ${badgeConfig.background};
              color: #ffffff;
              border: 2px solid #ffffff;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-size: ${badgeFontSize}px;
              font-weight: 900;
              line-height: 1;
              letter-spacing: -0.05em;
              pointer-events: none;
              box-sizing: border-box;
              white-space: nowrap;
            "
          >${badgeConfig.label}</span>
        </div>
    `;
}

type IndividualMarkerVisual = {
    content: string;
    anchor: { x: number; y: number };
    zIndex: number;
};

type IndividualMarkerStamp = {
    youtube: string;
    mergedYoutube: number;
    mergedReviews: number;
    mergedRestaurants: number;
    hasReview: number;
    categories0: string;
    category0: string;
    source: string;
    visual: IndividualMarkerVisual;
};

const individualVisualCache = new WeakMap<object, {
    selected?: IndividualMarkerStamp;
    plain?: IndividualMarkerStamp;
}>();

function individualMarkerStampFields(restaurant: NaverIndividualMarkerRestaurant) {
    return {
        youtube: restaurant.youtube_link ?? '',
        mergedYoutube: restaurant.mergedYoutubeLinks?.length ?? 0,
        mergedReviews: restaurant.mergedTzuyangReviews?.length ?? 0,
        mergedRestaurants: restaurant.mergedRestaurants?.length ?? 0,
        hasReview: restaurant.tzuyang_review ? 1 : 0,
        categories0: Array.isArray(restaurant.categories) ? restaurant.categories[0] ?? '' : '',
        category0: Array.isArray(restaurant.category) ? restaurant.category[0] ?? '' : restaurant.category ?? '',
        source: restaurant.source_type ?? '',
    };
}

function individualStampMatches(stamp: IndividualMarkerStamp, restaurant: NaverIndividualMarkerRestaurant) {
    return stamp.youtube === (restaurant.youtube_link ?? '')
        && stamp.mergedYoutube === (restaurant.mergedYoutubeLinks?.length ?? 0)
        && stamp.mergedReviews === (restaurant.mergedTzuyangReviews?.length ?? 0)
        && stamp.mergedRestaurants === (restaurant.mergedRestaurants?.length ?? 0)
        && stamp.hasReview === (restaurant.tzuyang_review ? 1 : 0)
        && stamp.categories0 === (Array.isArray(restaurant.categories) ? restaurant.categories[0] ?? '' : '')
        && stamp.category0 === (Array.isArray(restaurant.category) ? restaurant.category[0] ?? '' : restaurant.category ?? '')
        && stamp.source === (restaurant.source_type ?? '');
}

export function getNaverIndividualMarkerVisual(
    restaurant: NaverIndividualMarkerRestaurant,
    isSelected: boolean,
    overlayKinds: readonly RestaurantOverlayMarkerKind[] = [],
) {
    const slot = isSelected ? 'selected' : 'plain';
    const canReuseObject = overlayKinds.length === 0;
    if (canReuseObject) {
        const cachedStamp = individualVisualCache.get(restaurant)?.[slot];
        if (cachedStamp && individualStampMatches(cachedStamp, restaurant)) {
            return cachedStamp.visual;
        }
    }

    const cacheKey = [
        restaurant.id ?? '',
        isSelected ? '1' : '0',
        overlayKinds.join(','),
        restaurant.youtube_link ?? '',
        restaurant.mergedYoutubeLinks?.length ?? 0,
        restaurant.mergedTzuyangReviews?.length ?? 0,
        restaurant.mergedRestaurants?.length ?? 0,
        restaurant.tzuyang_review ? 1 : 0,
        Array.isArray(restaurant.categories) ? restaurant.categories[0] ?? '' : '',
        Array.isArray(restaurant.category) ? restaurant.category[0] ?? '' : restaurant.category ?? '',
        restaurant.source_type ?? '',
    ].join('|');
    const cached = readMarkerVisualCache(cacheKey);
    if (cached) return cached;

    const normalizedCategory = Array.isArray(restaurant.category)
        ? restaurant.category
        : (restaurant.category ? [restaurant.category] : []);
    const category = getPrimaryCategory({
        categories: restaurant.categories ?? [],
        category: normalizedCategory,
    });
    const visitCount = getTzuyangVisitCount(restaurant);
    const markerKind = resolveRestaurantMarkerKind(restaurant, overlayKinds);
    const markerCategory =
        markerKind === 'user-submitted'
            ? '사용자 제보'
            : markerKind === 'trend'
                ? '트렌드'
                : markerKind === 'seasonal'
                    ? '제철'
                    : category;
    const content = createIndividualMarkerHTML(markerCategory, isSelected, visitCount, restaurant.id);

    const visual = writeMarkerVisualCache(cacheKey, {
        content: markerKind !== 'category'
            ? wrapSpecialMarkerContent(content, isSelected, markerKind)
            : `<div data-restaurant-marker-kind="category" data-restaurant-marker-asset-version="${RESTAURANT_MARKER_ASSET_VERSION}">${content}</div>`,
        anchor: isSelected ? { x: 18, y: 18 } : { x: 14, y: 14 },
        zIndex: isSelected ? 100 : 1,
    });
    if (canReuseObject) {
        const entry = individualVisualCache.get(restaurant) ?? {};
        entry[slot] = { ...individualMarkerStampFields(restaurant), visual };
        individualVisualCache.set(restaurant, entry);
    }
    return visual;
}
