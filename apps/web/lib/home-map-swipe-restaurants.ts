import type { Restaurant } from '@/types/restaurant';

/**
 * 스와이프 목록에서 같은 식당으로 취급할 좌표인지 판정합니다.
 * 스와이프 중복 판정은 이름이 같을 때만 좌표를 보므로, 호출부는 이름이 같은
 * 항목끼리만 비교합니다.
 */
export const hasSameSwipeCoordinates = (a: Restaurant, b: Restaurant) => {
    if (!(a.lat && a.lng && b.lat && b.lng)) return false;

    const aLat = Number(a.lat);
    const aLng = Number(a.lng);
    const bLat = Number(b.lat);
    const bLng = Number(b.lng);

    return (
        Number.isFinite(aLat) &&
        Number.isFinite(aLng) &&
        Number.isFinite(bLat) &&
        Number.isFinite(bLng) &&
        Math.abs(aLat - bLat) < 0.0001 &&
        Math.abs(aLng - bLng) < 0.0001
    );
};

export const isSameRestaurantForSwipe = (a: Restaurant, b: Restaurant) => {
    if (a.id === b.id) return true;

    if (a.mergedRestaurants?.some((restaurant) => restaurant.id === b.id)) return true;
    if (b.mergedRestaurants?.some((restaurant) => restaurant.id === a.id)) return true;

    return a.name === b.name && hasSameSwipeCoordinates(a, b);
};

/**
 * 스와이프 목록의 중복을 제거합니다. 이전 구현은 항목마다 유지된 목록 전체와
 * pairwise 비교해 O(n^2)였고, 지도가 보여주는 식당 수가 많을수록 지도 이동마다
 * 그 비용이 그대로 발생했습니다.
 *
 * 유지된 항목이 주장하는 id 집합(자기 id + 병합 id), 유지된 자기 id 집합,
 * 이름별 유지 목록만 조회하면 pairwise 비교와 같은 결과를 O(n)에 얻습니다.
 * 반환 순서와 유지되는 객체 정체성은 이전 구현과 동일합니다.
 */
export const dedupeHomeMapRestaurants = (restaurants: Restaurant[]) => {
    const uniqueRestaurants: Restaurant[] = [];
    const claimedIds = new Set<string>();
    const keptIds = new Set<string>();
    const keptByName = new Map<string, Restaurant[]>();

    for (const restaurant of restaurants) {
        if (!restaurant) continue;

        const isDuplicate =
            claimedIds.has(restaurant.id) ||
            Boolean(restaurant.mergedRestaurants?.some((merged) => keptIds.has(merged.id))) ||
            Boolean(keptByName.get(restaurant.name)?.some((existing) => hasSameSwipeCoordinates(existing, restaurant)));

        if (isDuplicate) continue;

        uniqueRestaurants.push(restaurant);
        keptIds.add(restaurant.id);
        claimedIds.add(restaurant.id);

        for (const merged of restaurant.mergedRestaurants ?? []) {
            claimedIds.add(merged.id);
        }

        const sameNamePeers = keptByName.get(restaurant.name);
        if (sameNamePeers) sameNamePeers.push(restaurant);
        else keptByName.set(restaurant.name, [restaurant]);
    }

    return uniqueRestaurants;
};

