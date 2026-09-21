// 주소 게이트 적용 직전 커밋(63c0dd1a)의 원본을 그대로 복제한 동결 사본입니다.
// 재현 벤치마크에서 이전 경로를 손으로 흉내내지 않고 실제 구현으로 측정하기 위한 것이며,
// 프로덕션 코드 경로에서는 사용하지 않습니다. 원본: apps/web/lib/restaurant-review-lookup.ts
// 유지 규칙: 원본이 바뀌어도 이 사본은 이 벤치마크의 기준선 근거로만 남깁니다.

import type { Restaurant } from '@/types/restaurant';

type ReviewLookupNameFields = Pick<Restaurant, 'name' | 'approved_name'> &
    Partial<Pick<Restaurant, 'origin_name' | 'naver_name' | 'google_name'>>;

type LookupAddressFields = {
    road_address?: string | null;
    jibun_address?: string | null;
};

type ReviewLookupRestaurant = Pick<
    Restaurant,
    'id' | 'road_address' | 'jibun_address' | 'mergedRestaurants'
> & ReviewLookupNameFields;

type ReviewLookupCandidate = Pick<
    Restaurant,
    'id' | 'road_address' | 'jibun_address'
> & ReviewLookupNameFields;

type PreparedLookupName = {
    raw: string;
    normalized: string;
};

type PreparedLookupNames = {
    signature: string;
    names: PreparedLookupName[];
};

type PreparedLookupAddresses = {
    signature: string;
    addresses: Set<string>;
};

// 같은 레코드를 반복 조회할 때(카드 렌더, 목록 필터, 카운트 집계) 이름/주소 정규화를 다시 하지 않도록 보관합니다.
// 필드 값이 바뀌면 시그니처가 달라져 캐시를 버리고 다시 계산합니다.
const preparedNameCache = new WeakMap<object, PreparedLookupNames>();
const preparedRestaurantAddressCache = new WeakMap<object, PreparedLookupAddresses>();
const preparedCandidateAddressCache = new WeakMap<object, PreparedLookupAddresses>();

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

function buildLookupNameSignature(restaurant: ReviewLookupNameFields): string {
    return [
        restaurant.name,
        restaurant.approved_name,
        restaurant.naver_name,
        restaurant.origin_name,
        restaurant.google_name,
    ].map((name) => (typeof name === 'string' ? name : '')).join('\u0000');
}

function buildLookupAddressSignature(restaurant: LookupAddressFields | null | undefined): string {
    const roadAddress = typeof restaurant?.road_address === 'string' ? restaurant.road_address : '';
    const jibunAddress = typeof restaurant?.jibun_address === 'string' ? restaurant.jibun_address : '';
    return roadAddress + '\u0000' + jibunAddress;
}

function prepareLookupNames(restaurant: ReviewLookupNameFields): PreparedLookupNames {
    const cacheKey = restaurant as object;
    const signature = buildLookupNameSignature(restaurant);
    const cached = preparedNameCache.get(cacheKey);
    if (cached && cached.signature === signature) return cached;

    const prepared: PreparedLookupNames = {
        signature,
        names: collectLookupNames(restaurant).map((raw) => ({ raw, normalized: normalizeReviewLookupName(raw) })),
    };
    preparedNameCache.set(cacheKey, prepared);
    return prepared;
}

function prepareRestaurantLookupAddresses(restaurant: ReviewLookupRestaurant): PreparedLookupAddresses {
    const cacheKey = restaurant as object;
    const mergedRestaurants = Array.isArray(restaurant.mergedRestaurants) ? restaurant.mergedRestaurants : [];
    const signature = [
        buildLookupAddressSignature(restaurant),
        ...mergedRestaurants.map((mergedRestaurant) => (
            (mergedRestaurant?.id ?? '') + '\u0001' + buildLookupAddressSignature(mergedRestaurant)
        )),
    ].join('\u0002');

    const cached = preparedRestaurantAddressCache.get(cacheKey);
    if (cached && cached.signature === signature) return cached;

    const addresses = collectNormalizedAddresses([
        restaurant,
        ...mergedRestaurants,
    ] as ReviewLookupCandidate[]);
    const prepared: PreparedLookupAddresses = { signature, addresses };
    preparedRestaurantAddressCache.set(cacheKey, prepared);
    return prepared;
}

function prepareCandidateLookupAddresses(candidate: ReviewLookupCandidate): PreparedLookupAddresses {
    const cacheKey = candidate as object;
    const signature = buildLookupAddressSignature(candidate);
    const cached = preparedCandidateAddressCache.get(cacheKey);
    if (cached && cached.signature === signature) return cached;

    const addresses = collectNormalizedAddresses([candidate]);
    const prepared: PreparedLookupAddresses = { signature, addresses };
    preparedCandidateAddressCache.set(cacheKey, prepared);
    return prepared;
}

function arePreparedReviewLookupNamesCompatible(source: PreparedLookupName, candidate: PreparedLookupName): boolean {
    if (source.raw === candidate.raw) return true;
    if (!source.normalized || !candidate.normalized) return false;
    if (source.normalized === candidate.normalized) return true;

    const sourceIsShorter = source.normalized.length <= candidate.normalized.length;
    const shorter = sourceIsShorter ? source.normalized : candidate.normalized;
    const longer = sourceIsShorter ? candidate.normalized : source.normalized;

    return shorter.length >= 3 && longer.includes(shorter);
}

function hasCompatibleLookupName(source: PreparedLookupNames, candidate: PreparedLookupNames): boolean {
    return source.names.some((sourceName) => candidate.names.some((candidateName) => (
        arePreparedReviewLookupNamesCompatible(sourceName, candidateName)
    )));
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
    if (!Array.isArray(candidates) || candidates.length === 0) return [...ids];

    const lookupNames = prepareLookupNames(restaurant);
    const lookupAddresses = prepareRestaurantLookupAddresses(restaurant).addresses;

    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return;

        const candidateNames = prepareLookupNames(candidate);
        if (
            lookupNames.names.length > 0 &&
            candidateNames.names.length > 0 &&
            !hasCompatibleLookupName(lookupNames, candidateNames)
        ) {
            return;
        }

        const candidateAddresses = prepareCandidateLookupAddresses(candidate).addresses;
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
