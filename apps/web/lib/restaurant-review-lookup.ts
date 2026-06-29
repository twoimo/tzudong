import type { Restaurant } from '@/types/restaurant';

type ReviewLookupNameFields = Pick<Restaurant, 'name' | 'approved_name'> &
    Partial<Pick<Restaurant, 'origin_name' | 'naver_name' | 'google_name'>>;

type ReviewLookupRestaurant = Pick<
    Restaurant,
    'id' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
> & ReviewLookupNameFields;

type ReviewLookupCandidate = Pick<
    Restaurant,
    'id' | 'road_address' | 'jibun_address'
> & ReviewLookupNameFields;

function getLookupName(restaurant: ReviewLookupNameFields): string {
    return (restaurant.name || restaurant.approved_name || restaurant.naver_name || restaurant.origin_name || restaurant.google_name || '').trim();
}

function collectLookupNames(restaurant: ReviewLookupNameFields): string[] {
    return [...new Set([
        restaurant.name,
        restaurant.approved_name,
        restaurant.naver_name,
        restaurant.origin_name,
        restaurant.google_name,
    ].map((name) => name?.trim()).filter((name): name is string => Boolean(name)))];
}

function normalizeReviewLookupName(name: string | null | undefined): string {
    return (name || '')
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

function areReviewLookupNamesCompatible(sourceName: string, candidateName: string): boolean {
    if (sourceName === candidateName) return true;

    const normalizedSource = normalizeReviewLookupName(sourceName);
    const normalizedCandidate = normalizeReviewLookupName(candidateName);
    if (!normalizedSource || !normalizedCandidate) return false;
    if (normalizedSource === normalizedCandidate) return true;

    const shorter = normalizedSource.length <= normalizedCandidate.length
        ? normalizedSource
        : normalizedCandidate;
    const longer = normalizedSource.length > normalizedCandidate.length
        ? normalizedSource
        : normalizedCandidate;

    return shorter.length >= 3 && longer.includes(shorter);
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
    const lookupNames = collectLookupNames(restaurant);
    const lookupAddresses = collectNormalizedAddresses([
        restaurant,
        ...(restaurant.mergedRestaurants || []),
    ] as ReviewLookupCandidate[]);

    candidates.forEach((candidate) => {
        if (!candidate.id) return;

        const candidateNames = collectLookupNames(candidate);
        if (
            lookupNames.length > 0 &&
            candidateNames.length > 0 &&
            !lookupNames.some((lookupName) =>
                candidateNames.some((candidateName) =>
                    areReviewLookupNamesCompatible(lookupName, candidateName)
                )
            )
        ) {
            return;
        }

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
