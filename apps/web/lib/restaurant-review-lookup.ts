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

// 승인 맛집 목록을 주소/직접 ID 기준으로 한 번만 색인해 두고, 리뷰 행마다 전체 목록을 다시 훑지
// 않고 관련 맛집을 찾습니다. 선정 결과는 선형 탐색(selectRelatedRestaurantReviewIds + find)과 같아야 하며,
// apps/web/tests-unit/restaurant-visit-matching-index.test.ts에서 두 경로의 동일성을 확인합니다.
//
// 선형 탐색에서 결과가 될 수 있는 맛집은 두 종류뿐입니다.
// 1) 직접 ID(맛집 자신 또는 병합된 레코드의 id)에 찾는 리뷰 ID가 들어 있는 맛집
// 2) 후보의 주소 게이트와 이름 게이트를 모두 통과하고, 후보 id가 찾는 리뷰 ID와 같은 맛집
// 그래서 주소별 버킷과 직접 ID 버킷만 만들어 두면 나머지 맛집은 주소 게이트에서 이미 탈락한 것과 같습니다.
export function createRelatedRestaurantReviewIndex(
    restaurants: ReviewLookupRestaurant[]
): (candidate: ReviewLookupCandidate | null, relatedReviewId: string | null | undefined) => ReviewLookupRestaurant | null {
    const entries = (Array.isArray(restaurants) ? restaurants : []).filter(Boolean);
    const addressBuckets = new Map<string, number[]>();
    const addresslessIndices: number[] = [];
    const directIdIndices = new Map<string, number[]>();

    entries.forEach((restaurant, index) => {
        const addresses = prepareRestaurantLookupAddresses(restaurant).addresses;
        if (addresses.size === 0) {
            addresslessIndices.push(index);
        } else {
            addresses.forEach((address) => {
                const bucket = addressBuckets.get(address);
                if (bucket) bucket.push(index);
                else addressBuckets.set(address, [index]);
            });
        }

        collectDirectRestaurantReviewIds(restaurant).forEach((id) => {
            if (!id) return;
            const bucket = directIdIndices.get(id);
            if (bucket) bucket.push(index);
            else directIdIndices.set(id, [index]);
        });
    });

    return (candidate, relatedReviewId) => {
        if (!relatedReviewId) return null;

        const directIndices = directIdIndices.get(relatedReviewId);
        // 직접 ID 버킷은 색인 순서대로 쌓이므로 첫 항목이 가장 앞선 맛집입니다.
        let bestIndex = directIndices ? directIndices[0] : undefined;

        // 후보 id가 찾는 리뷰 ID와 다르면 후보 경로는 결과에 아무것도 더하지 않습니다(선형 탐색과 동일).
        if (candidate && candidate.id && candidate.id === relatedReviewId) {
            const candidateAddresses = prepareCandidateLookupAddresses(candidate).addresses;
            let candidateNames: PreparedLookupNames | null = null;

            // 주소 버킷을 전부 펼쳐 정렬하지 않고, 버킷 커서를 옮겨 가장 앞선 항목만 순서대로 봅니다.
            // 가장 앞선 통과 항목을 찾는 즉시 멈추므로 버킷이 커도 검사 수가 늘지 않습니다.
            forEachCandidateIndex(candidateAddresses, addressBuckets, addresslessIndices, (index) => {
                // 직접 ID로 이미 앞선 맛집을 찾았다면 그 뒤 색인은 결과를 바꿀 수 없습니다.
                // 선형 탐색도 그 지점에서 멈추므로, 색인 경로가 더 많이 검사하지 않도록 여기서 끝냅니다.
                if (bestIndex !== undefined && index >= bestIndex) return true;

                reviewLookupPerfCounters.candidateVisits += 1;

                const lookupNames = prepareLookupNames(entries[index]);
                if (lookupNames.names.length > 0) {
                    if (!candidateNames) candidateNames = prepareLookupNames(candidate);
                    if (candidateNames.names.length > 0) {
                        reviewLookupPerfCounters.nameGates += 1;
                        if (!hasCompatibleLookupName(lookupNames, candidateNames)) return false;
                    }
                }

                if (bestIndex === undefined || index < bestIndex) bestIndex = index;
                return true;
            });
        }

        return bestIndex === undefined ? null : entries[bestIndex] ?? null;
    };
}

// 사용자 리뷰가 있는 후보 맛집을 주소별로 한 번만 색인해 두고, 맛집마다 후보 전체를 다시 훑지 않고
// 방문 여부만 판정합니다.
//
// hasRelatedVerifiedUserReview는 맛집 하나를 볼 때마다 후보 전체를 순회하므로 비용이 맛집 수 x 후보 수입니다
// (승인 맛집 1,568개 x 후보 40개 = 62,720회). 후보를 주소로 색인해 두면 주소가 겹치지 않는 후보는 주소
// 게이트에서 이미 탈락한 것과 같아, 실제로 검사하는 후보가 크게 줄어듭니다. 이름 게이트도 색인을 통과한
// 후보에만 적용합니다.
//
// 판정 결과는 hasRelatedVerifiedUserReview와 같아야 하며, 두 경로의 동일성은
// apps/web/tests-unit/restaurant-visit-matching-matcher.test.ts에서 확인합니다.
export function createVisitedRestaurantMatcher(
    candidates: ReviewLookupCandidate[],
    visitedRestaurantIds: Set<string>
): (restaurant: ReviewLookupRestaurant | null) => boolean {
    const entries = (Array.isArray(candidates) ? candidates : []).filter(
        (candidate): candidate is ReviewLookupCandidate => Boolean(candidate && candidate.id)
    );
    const addressBuckets = new Map<string, number[]>();
    const addresslessIndices: number[] = [];

    entries.forEach((candidate, index) => {
        const addresses = prepareCandidateLookupAddresses(candidate).addresses;
        if (addresses.size === 0) {
            addresslessIndices.push(index);
            return;
        }

        addresses.forEach((address) => {
            const bucket = addressBuckets.get(address);
            if (bucket) bucket.push(index);
            else addressBuckets.set(address, [index]);
        });
    });

    return (restaurant) => {
        if (!restaurant || visitedRestaurantIds.size === 0) return false;

        // 직접 ID(맛집 자신과 병합 레코드)가 방문 집합에 있으면 후보를 볼 필요가 없습니다.
        if (visitedRestaurantIds.has(restaurant.id)) return true;
        if (Array.isArray(restaurant.mergedRestaurants)) {
            for (const mergedRestaurant of restaurant.mergedRestaurants) {
                if (mergedRestaurant?.id && visitedRestaurantIds.has(mergedRestaurant.id)) return true;
            }
        }

        if (entries.length === 0) return false;

        const lookupAddresses = prepareRestaurantLookupAddresses(restaurant).addresses;
        const lookupNames = prepareLookupNames(restaurant);
        const hasLookupNames = lookupNames.names.length > 0;

        const matchesCandidate = (index: number) => {
            const candidate = entries[index];
            reviewLookupPerfCounters.candidateVisits += 1;
            // 선형 경로도 후보 id가 방문 집합에 있어야 방문으로 인정합니다.
            if (!visitedRestaurantIds.has(candidate.id)) return false;
            if (!hasLookupNames) return true;

            // 후보마다 이름 집합이 다르므로 후보별로 준비합니다(준비 결과 자체는 후보 객체 단위로 캐시됩니다).
            const candidateNames = prepareLookupNames(candidate);
            if (candidateNames.names.length === 0) return true;

            reviewLookupPerfCounters.nameGates += 1;
            return hasCompatibleLookupName(lookupNames, candidateNames);
        };

        // 맛집 주소가 없으면 선형 경로와 같게 주소 없는 후보만 통과시킵니다.
        if (lookupAddresses.size === 0) {
            for (const index of addresslessIndices) {
                if (matchesCandidate(index)) return true;
            }
            return false;
        }

        for (const address of lookupAddresses) {
            const bucket = addressBuckets.get(address);
            if (!bucket) continue;
            for (const index of bucket) {
                if (matchesCandidate(index)) return true;
            }
        }

        return false;
    };
}

// 리뷰 수 집계는 관련 리뷰 id 집합 전체가 필요하므로, 방문 판정과 달리 색인을 통과한 후보를 모두 모아
// 합산합니다.
//
// selectRelatedRestaurantReviewIds는 맛집마다 후보 전체를 순회하므로 비용이 맛집 수 x 후보 수입니다
// (병합 맛집 1,372개 x 같은 이름 후보 1,300여 개 = 180만 회 수준). 후보를 주소로 색인해 두면 주소가
// 겹치지 않는 후보는 주소 게이트에서 이미 탈락한 것과 같아 검사 수가 크게 줄어듭니다.
//
// 집계 결과는 selectRelatedRestaurantReviewIds + 합산과 같아야 하며, 두 경로의 동일성은
// apps/web/tests-unit/restaurant-review-counts-index.test.ts에서 확인합니다.
export function createRelatedVerifiedReviewCountLookup(
    candidates: ReviewLookupCandidate[]
): (restaurant: ReviewLookupRestaurant | null, directCountMap: Map<string, number>) => number {
    const entries = (Array.isArray(candidates) ? candidates : []).filter(
        (candidate): candidate is ReviewLookupCandidate => Boolean(candidate && candidate.id)
    );
    const addressBuckets = new Map<string, number[]>();
    const addresslessIndices: number[] = [];

    entries.forEach((candidate, index) => {
        const addresses = prepareCandidateLookupAddresses(candidate).addresses;
        if (addresses.size === 0) {
            addresslessIndices.push(index);
            return;
        }

        addresses.forEach((address) => {
            const bucket = addressBuckets.get(address);
            if (bucket) bucket.push(index);
            else addressBuckets.set(address, [index]);
        });
    });

    // 맛집마다 합산한 id를 새로 만들지 않도록 집합 하나를 돌려 씁니다(맛집 수만큼 할당하지 않는다).
    const countedIds = new Set<string>();
    // 주소가 여러 개인 후보는 여러 버킷에 들어 있으므로, 맛집마다 한 번만 보도록 표시합니다.
    const seenStamps = new Int32Array(entries.length);
    let stamp = 0;

    return (restaurant, directCountMap) => {
        if (!restaurant) return 0;

        countedIds.clear();
        stamp += 1;
        let total = 0;

        const addId = (id: string | null | undefined) => {
            if (!id || countedIds.has(id)) return;
            countedIds.add(id);
            total += directCountMap.get(id) ?? 0;
        };

        // 직접 ID(맛집 자신과 병합 레코드)는 후보 조회 없이도 항상 관련 id입니다.
        addId(restaurant.id);
        if (Array.isArray(restaurant.mergedRestaurants)) {
            for (const mergedRestaurant of restaurant.mergedRestaurants) addId(mergedRestaurant?.id);
        }

        if (entries.length === 0) return total;

        const lookupAddresses = prepareRestaurantLookupAddresses(restaurant).addresses;
        const lookupNames = prepareLookupNames(restaurant);
        const hasLookupNames = lookupNames.names.length > 0;

        const considerCandidate = (index: number) => {
            if (seenStamps[index] === stamp) return;
            seenStamps[index] = stamp;

            const candidate = entries[index];
            reviewLookupPerfCounters.candidateVisits += 1;
            if (countedIds.has(candidate.id)) return;
            if (!hasLookupNames) {
                addId(candidate.id);
                return;
            }

            const candidateNames = prepareLookupNames(candidate);
            if (candidateNames.names.length === 0) {
                addId(candidate.id);
                return;
            }

            reviewLookupPerfCounters.nameGates += 1;
            if (hasCompatibleLookupName(lookupNames, candidateNames)) addId(candidate.id);
        };

        // 맛집 주소가 없으면 선형 경로와 같게 주소 없는 후보만 통과시킵니다.
        if (lookupAddresses.size === 0) {
            for (const index of addresslessIndices) considerCandidate(index);
            return total;
        }

        for (const address of lookupAddresses) {
            const bucket = addressBuckets.get(address);
            if (!bucket) continue;
            for (const index of bucket) considerCandidate(index);
        }

        return total;
    };
}

// 후보의 주소 집합에 해당하는 승인 맛집 색인을 오름차순으로 하나씩 넘겨줍니다.
// visit가 true를 돌려주면 순회를 멈춥니다. 각 주소 버킷은 색인 순서대로 쌓여 있어 정렬이 필요 없습니다.
function forEachCandidateIndex(
    candidateAddresses: Set<string>,
    addressBuckets: Map<string, number[]>,
    addresslessIndices: number[],
    visit: (index: number) => boolean
): void {
    if (candidateAddresses.size === 0) {
        for (const index of addresslessIndices) {
            if (visit(index)) return;
        }
        return;
    }

    const buckets: number[][] = [];
    candidateAddresses.forEach((address) => {
        const bucket = addressBuckets.get(address);
        if (bucket && bucket.length > 0) buckets.push(bucket);
    });

    if (buckets.length === 0) return;
    if (buckets.length === 1) {
        for (const index of buckets[0]) {
            if (visit(index)) return;
        }
        return;
    }

    const cursors = new Array<number>(buckets.length).fill(0);
    let lastVisited = -1;
    for (;;) {
        let chosen = -1;
        let chosenIndex = Number.POSITIVE_INFINITY;
        for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
            const cursor = cursors[bucketIndex];
            if (cursor >= buckets[bucketIndex].length) continue;
            const candidateIndex = buckets[bucketIndex][cursor];
            if (candidateIndex < chosenIndex) {
                chosenIndex = candidateIndex;
                chosen = bucketIndex;
            }
        }
        if (chosen === -1) return;

        cursors[chosen] += 1;
        // 주소가 여러 개면 같은 맛집이 두 버킷에 들어 있을 수 있어 한 번만 봅니다.
        if (chosenIndex === lastVisited) continue;
        lastVisited = chosenIndex;
        if (visit(chosenIndex)) return;
    }
}
