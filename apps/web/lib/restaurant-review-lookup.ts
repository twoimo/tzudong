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

// 후보 스캔 비용을 배포 없이 정량 확인하기 위한 진단 카운터입니다(맛집 병합 카운터와 같은 방식).
const reviewLookupPerfCounters = {
    candidateVisits: 0,
    nameGates: 0,
    addressGates: 0,
};

export function getReviewLookupPerfCounters() {
    return { ...reviewLookupPerfCounters };
}

export function resetReviewLookupPerfCounters() {
    reviewLookupPerfCounters.candidateVisits = 0;
    reviewLookupPerfCounters.nameGates = 0;
    reviewLookupPerfCounters.addressGates = 0;
}

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

// 주소 집합을 배열로 펼치지 않고 교집합 여부만 확인합니다(후보마다 배열 할당을 만들지 않는다).
function sharesLookupAddress(candidateAddresses: Set<string>, lookupAddresses: Set<string>): boolean {
    if (candidateAddresses.size === 0) return false;

    for (const address of candidateAddresses) {
        if (lookupAddresses.has(address)) return true;
    }

    return false;
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
    const hasLookupNames = lookupNames.names.length > 0;
    const requiresAddresslessCandidate = lookupAddresses.size === 0;

    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return;
        reviewLookupPerfCounters.candidateVisits += 1;
        if (ids.has(candidate.id)) return;

        reviewLookupPerfCounters.addressGates += 1;
        const candidateAddresses = prepareCandidateLookupAddresses(candidate).addresses;
        // 주소 게이트가 먼저 실패하면 비싼 이름 호환 검사를 아예 계산하지 않는다.
        const hasAddressMatch = requiresAddresslessCandidate
            ? candidateAddresses.size === 0
            : sharesLookupAddress(candidateAddresses, lookupAddresses);
        if (!hasAddressMatch) return;

        if (!hasLookupNames) {
            ids.add(candidate.id);
            return;
        }

        const candidateNames = prepareLookupNames(candidate);
        if (candidateNames.names.length === 0) {
            ids.add(candidate.id);
            return;
        }

        reviewLookupPerfCounters.nameGates += 1;
        if (hasCompatibleLookupName(lookupNames, candidateNames)) ids.add(candidate.id);
    });

    return [...ids];
}

export function getRestaurantReviewLookupName(restaurant: ReviewLookupRestaurant | null): string | null {
    const name = restaurant ? getLookupName(restaurant) : '';
    return name || null;
}
