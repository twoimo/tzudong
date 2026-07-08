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

function getMarkerKindBadgeConfig(markerKind: Exclude<RestaurantMarkerKind, 'category'>) {
    if (markerKind === 'trend') {
        return {
            label: '트렌드',
            ariaLabel: '관리자 트렌드 맛집',
            background: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)',
            shadow: 'rgba(249, 115, 22, 0.35)',
        };
    }

    if (markerKind === 'seasonal') {
        return {
            label: '제철',
            ariaLabel: '관리자 제철 맛집',
            background: 'linear-gradient(135deg, #16a34a 0%, #0d9488 100%)',
            shadow: 'rgba(22, 163, 74, 0.35)',
        };
    }

    return {
        label: '제보',
        ariaLabel: '사용자 제보 맛집',
        background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
        shadow: 'rgba(37, 99, 235, 0.35)',
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
              box-shadow: 0 2px 8px ${badgeConfig.shadow};
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

export function getNaverIndividualMarkerVisual(
    restaurant: NaverIndividualMarkerRestaurant,
    isSelected: boolean,
    overlayKinds: readonly RestaurantOverlayMarkerKind[] = [],
) {
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

    return {
        content: markerKind !== 'category'
            ? wrapSpecialMarkerContent(content, isSelected, markerKind)
            : content,
        anchor: isSelected ? { x: 18, y: 18 } : { x: 14, y: 14 },
        zIndex: isSelected ? 100 : 1,
    };
}
