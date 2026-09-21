// 관련 리뷰 조회(이름/주소 정규화) 최적화 전후 비교 벤치마크.
// 실행: bun apps/web/performance/review-lookup-memoization-20260921/benchmark-review-lookup.mjs
//
// 측정 항목
// - 같은 입력에 대한 처리 시간(중앙값)
// - String.prototype.replace 호출 수(정규화 연산량의 결정적 대리 지표)
import { selectRelatedRestaurantReviewIds } from '../../lib/restaurant-review-lookup';

// ---- 최적화 이전 알고리즘(원본 코드 그대로) ----
function oldNormalizeReviewLookupName(name) {
    return (name || '').replace(/\s+/g, '').replace(/[^\w가-힣]/g, '').toLowerCase();
}

function oldCollectLookupNames(restaurant) {
    return [...new Set([
        restaurant.name,
        restaurant.approved_name,
        restaurant.naver_name,
        restaurant.origin_name,
        restaurant.google_name,
    ].map((name) => name?.trim()).filter((name) => Boolean(name)))];
}

function oldNormalizeAddress(address) {
    return (address || '')
        .replace(/지하\s*\d+\s*층/g, '')
        .replace(/지상\s*\d+\s*층/g, '')
        .replace(/\d+\s*층/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

function oldCollectAddresses(restaurants) {
    const addresses = new Set();
    restaurants.forEach((restaurant) => {
        const road = oldNormalizeAddress(restaurant.road_address);
        const jibun = oldNormalizeAddress(restaurant.jibun_address);
        if (road) addresses.add(road);
        if (jibun) addresses.add(jibun);
    });
    return addresses;
}

function oldAreNamesCompatible(sourceName, candidateName) {
    if (sourceName === candidateName) return true;
    const normalizedSource = oldNormalizeReviewLookupName(sourceName);
    const normalizedCandidate = oldNormalizeReviewLookupName(candidateName);
    if (!normalizedSource || !normalizedCandidate) return false;
    if (normalizedSource === normalizedCandidate) return true;
    const shorter = normalizedSource.length <= normalizedCandidate.length ? normalizedSource : normalizedCandidate;
    const longer = normalizedSource.length > normalizedCandidate.length ? normalizedSource : normalizedCandidate;
    return shorter.length >= 3 && longer.includes(shorter);
}

function oldCollectDirectIds(restaurant) {
    const ids = new Set([restaurant.id]);
    restaurant.mergedRestaurants?.forEach((merged) => { if (merged.id) ids.add(merged.id); });
    return [...ids];
}

function selectRelatedRestaurantReviewIdsOld(restaurant, candidates) {
    if (!restaurant) return [];
    const ids = new Set(oldCollectDirectIds(restaurant));
    const lookupNames = oldCollectLookupNames(restaurant);
    const lookupAddresses = oldCollectAddresses([restaurant, ...(restaurant.mergedRestaurants || [])]);

    candidates.forEach((candidate) => {
        if (!candidate.id) return;
        const candidateNames = oldCollectLookupNames(candidate);
        if (lookupNames.length > 0 && candidateNames.length > 0 &&
            !lookupNames.some((lookupName) => candidateNames.some((candidateName) => oldAreNamesCompatible(lookupName, candidateName)))) {
            return;
        }
        const candidateAddresses = oldCollectAddresses([candidate]);
        const hasAddressMatch = lookupAddresses.size === 0
            ? candidateAddresses.size === 0
            : [...candidateAddresses].some((address) => lookupAddresses.has(address));
        if (hasAddressMatch) ids.add(candidate.id);
    });

    return [...ids];
}

// ---- 재현 가능한 입력 데이터 ----
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const REGIONS = ['강남구', '서초구', '마포구', '송파구', '용산구', '분당구', '수영구', '해운대구'];

function buildFixture(restaurantCount, variantsPerRestaurant) {
    const random = createRandom(20260921);
    const restaurants = [];
    const candidates = [];

    for (let index = 0; index < restaurantCount; index += 1) {
        const region = REGIONS[index % REGIONS.length];
        const name = '쯔동맛집' + index + ' ' + region + '본점';
        const roadAddress = '서울특별시 ' + region + ' 테스트로' + index + '길 ' + (index + 1);
        const jibunAddress = '서울특별시 ' + region + ' 테스트동 ' + (index + 1) + '-' + (index % 90 + 1);
        const restaurant = {
            id: 'restaurant-' + index,
            name,
            approved_name: name,
            road_address: roadAddress,
            jibun_address: jibunAddress,
            status: 'approved',
        };
        restaurants.push(restaurant);

        for (let variant = 0; variant < variantsPerRestaurant; variant += 1) {
            const isDuplicate = variant % 2 === 0;
            const keepAddress = random() < 0.5;
            candidates.push({
                id: 'candidate-' + index + '-' + variant,
                name: isDuplicate ? name : name + ' 별관',
                approved_name: null,
                road_address: keepAddress ? roadAddress : '서울특별시 ' + region + ' 다른로' + index + '길 ' + (index + 1),
                jibun_address: keepAddress ? jibunAddress : null,
                status: 'deleted',
            });
        }
    }

    return { restaurants, candidates };
}

function countReplaceCalls(run) {
    const originalReplace = String.prototype.replace;
    let replaceCalls = 0;
    String.prototype.replace = function patchedReplace(...args) {
        replaceCalls += 1;
        return originalReplace.apply(this, args);
    };
    try {
        const result = run();
        return { replaceCalls, result };
    } finally {
        String.prototype.replace = originalReplace;
    }
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function timeSweep(run) {
    const startedAt = process.hrtime.bigint();
    const result = run();
    return { ms: Number(process.hrtime.bigint() - startedAt) / 1e6, result };
}

const RESTAURANT_COUNT = 400;
const VARIANTS_PER_RESTAURANT = 3;
const REPETITIONS = 5;

function sweepOld(fixture) {
    return fixture.restaurants.map((restaurant) => selectRelatedRestaurantReviewIdsOld(restaurant, fixture.candidates));
}

function sweepNew(fixture) {
    return fixture.restaurants.map((restaurant) => selectRelatedRestaurantReviewIds(restaurant, fixture.candidates));
}

// 콜드 측정: 매 반복마다 한 번도 쓰지 않은 객체를 만들어 캐시 효과를 배제합니다.
const coldFixtures = Array.from({ length: REPETITIONS }, () => buildFixture(RESTAURANT_COUNT, VARIANTS_PER_RESTAURANT));
const oldFixture = coldFixtures[0];

const oldReplaceCalls = countReplaceCalls(() => sweepOld(oldFixture)).replaceCalls;
const oldTimings = [];
for (let index = 0; index < REPETITIONS; index += 1) oldTimings.push(timeSweep(() => sweepOld(oldFixture)).ms);

const newColdReplaceCalls = countReplaceCalls(() => sweepNew(coldFixtures[1])).replaceCalls;
const newColdTimings = [];
for (let index = 2; index < 2 + REPETITIONS; index += 1) {
    const fixture = coldFixtures[index % coldFixtures.length];
    newColdTimings.push(timeSweep(() => sweepNew(fixture)).ms);
}

const warmFixture = coldFixtures[1];
sweepNew(warmFixture);
const newWarmReplaceCalls = countReplaceCalls(() => sweepNew(warmFixture)).replaceCalls;
const newWarmTimings = [];
for (let index = 0; index < REPETITIONS; index += 1) newWarmTimings.push(timeSweep(() => sweepNew(warmFixture)).ms);

const resultCount = sweepOld(oldFixture).reduce((sum, ids) => sum + ids.length, 0);

const oldPass = {
    label: 'before',
    replaceCallsPerSweep: oldReplaceCalls,
    medianMs: Number(median(oldTimings).toFixed(2)),
};
const newCold = {
    label: 'after-cold-cache',
    replaceCallsPerSweep: newColdReplaceCalls,
    medianMs: Number(median(newColdTimings).toFixed(2)),
};
const newWarm = {
    label: 'after-warm-cache',
    replaceCallsPerSweep: newWarmReplaceCalls,
    medianMs: Number(median(newWarmTimings).toFixed(2)),
};

const equivalence = (() => {
    for (let index = 0; index < oldFixture.restaurants.length; index += 1) {
        const before = selectRelatedRestaurantReviewIdsOld(oldFixture.restaurants[index], oldFixture.candidates);
        const after = selectRelatedRestaurantReviewIds(oldFixture.restaurants[index], oldFixture.candidates);
        if (JSON.stringify(before) !== JSON.stringify(after)) return 'mismatch-restaurant-' + index;
    }
    return 'identical';
})();

const report = {
    generatedAt: new Date().toISOString(),
    workload: {
        restaurantLookups: RESTAURANT_COUNT,
        candidatesPerLookup: oldFixture.candidates.length,
        candidateVisits: RESTAURANT_COUNT * oldFixture.candidates.length,
        repetitions: REPETITIONS,
    },
    equivalence,
    resultCount,
    old: oldPass,
    new: newCold,
    newWarm,
    ratio: {
        replaceCallsReducedBy: Number((oldPass.replaceCallsPerSweep / Math.max(newCold.replaceCallsPerSweep, 1)).toFixed(1)),
        coldSpeedupByMedian: Number((oldPass.medianMs / newCold.medianMs).toFixed(2)),
        warmSpeedupByMedian: Number((oldPass.medianMs / newWarm.medianMs).toFixed(2)),
    },
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
