import type { Restaurant } from '@/types/restaurant';

type ReviewLookupRestaurant = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
>;

type ReviewLookupCandidate = Pick<
    Restaurant,
    'id' | 'name' | 'approved_name' | 'road_address' | 'jibun_address'
>;

function getLookupName(restaurant: Pick<Restaurant, 'name' | 'approved_name'>): string {
    return (restaurant.name || restaurant.approved_name || '').trim();
}

export function normalizeReviewLookupAddress(address: string | null | undefined): string {
    return (address || '')
        .replace(/지하\s*\d+\s*층/g, '')
        .replace(/지상\s*\d+\s*층/g, '')
        .replace(/\d+\s*층/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

function collectNormalizedAddresses(restaurants: ReviewLookupCandidate[]): Set<string> {
    const addresses = new Set<string>();

    restaurants.forEach((restaurant) => {
        const roadAddress = normalizeReviewLookupAddress(restaurant.road_address);
        const jibunAddress = normalizeReviewLookupAddress(restaurant.jibun_address);

        if (roadAddress) addresses.add(roadAddress);
        if (jibunAddress) addresses.add(jibunAddress);
    });

    return addresses;
}

export function collectDirectRestaurantReviewIds(restaurant: ReviewLookupRestaurant | null): string[] {
    if (!restaurant) return [];

    const ids = new Set<string>();
    ids.add(restaurant.id);
    restaurant.mergedRestaurants?.forEach((mergedRestaurant) => {
        if (mergedRestaurant.id) ids.add(mergedRestaurant.id);
    });

    return [...ids];
}

export function selectRelatedRestaurantReviewIds(
    restaurant: ReviewLookupRestaurant | null,
    candidates: ReviewLookupCandidate[]
): string[] {
    if (!restaurant) return [];

    const ids = new Set(collectDirectRestaurantReviewIds(restaurant));
    const lookupName = getLookupName(restaurant);
    const lookupAddresses = collectNormalizedAddresses([
        restaurant,
        ...(restaurant.mergedRestaurants || []),
    ] as ReviewLookupCandidate[]);

    candidates.forEach((candidate) => {
        if (!candidate.id) return;

        const candidateName = getLookupName(candidate);
        if (lookupName && candidateName && candidateName !== lookupName) return;

        const candidateAddresses = collectNormalizedAddresses([candidate]);
        const hasAddressMatch =
            lookupAddresses.size === 0
                ? candidateAddresses.size === 0
                : [...candidateAddresses].some((address) => lookupAddresses.has(address));

        if (hasAddressMatch) {
            ids.add(candidate.id);
        }
    });

    return [...ids];
}

export function getRestaurantReviewLookupName(restaurant: ReviewLookupRestaurant | null): string | null {
    const name = restaurant ? getLookupName(restaurant) : '';
    return name || null;
}
