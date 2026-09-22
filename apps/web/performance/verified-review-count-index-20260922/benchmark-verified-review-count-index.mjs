// 승인 리뷰 수 집계가 맛집마다 후보 전체를 다시 훑는 비용을 색인 도입 전후로 비교하는 벤치마크.
// 실행: bun apps/web/performance/verified-review-count-index-20260922/benchmark-verified-review-count-index.mjs
//
// 비교 대상(둘 다 같은 승인 리뷰 수를 내야 한다)
// - S0-linear: selectRelatedRestaurantReviewIds + 합산. 맛집 하나를 볼 때마다 후보(같은 이름으로 조회한
//       맛집 행) 전체를 순회한다. 이번 변경 이전 lib/restaurant-review-counts.ts가 쓰던 경로이며,
//       selectRelatedRestaurantReviewIds는 참조 구현으로 그대로 남아 있다(무수정).
// - S1-indexed: lib/restaurant-review-lookup.ts의 createRelatedVerifiedReviewCountLookup.
//       후보를 주소별로 한 번만 색인하고, 맛집마다 색인에 걸린 후보만 본다.
//
// 시나리오
// - unique-address: 실제 데이터 모양(맛집마다 삭제 중복 후보가 같은 주소에 하나씩).
// - shared-address: 모든 후보가 한 주소를 공유하는 퇴화 모양(색인이 줄일 수 없는 최악의 경우).
//
// 측정 항목
// - 결과 동등성(맛집 순서대로의 승인 리뷰 수 지문과 합계)
// - 결정적 연산 카운터(후보 검사 수, 이름 게이트 평가 수)
// - 목록 한 번 집계 시간(중앙값, p95, MAD)
import { writeFileSync } from 'node:fs';
import { buildRelatedVerifiedReviewCountMap } from '../../lib/restaurant-review-counts';
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
    selectRelatedRestaurantReviewIds,
} from '../../lib/restaurant-review-lookup';

const MERGED_ROWS = 1000;
const DUPLICATE_CANDIDATES = 1000;
const UNRELATED_CANDIDATES = 200;
const REPETITIONS = 21;
// 표본 하나를 짧게 재면 타이머 분해능과 GC 때문에 상대 노이즈가 커진다. 특히 색인 경로는 한 번에
// 1ms 아래로 끝나 표본 하나가 몇 ms에 불과하므로, 표본마다 같은 작업을 20번 돌리고 다시 실행
// 하나의 시간으로 나눠 보고한다. 선형 경로도 같은 표본 길이를 쓰므로 두 경로의 노이즈 조건이 같다.
const SAMPLE_LOOPS = 20;

export const VERIFIED_REVIEW_COUNT_INDEX_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        realisticMedianMsMax: 40,
        degenerateMedianMsMax: 200,
        rule: 'unique-address(실제 데이터 모양)의 목록 한 번 집계 중앙값은 40ms 이하, shared-address(퇴화 모양)는 후보 1000개가 한 주소에 몰려 색인이 줄일 여지가 없는 스트레스 모양이므로 별도로 200ms 이하를 기준으로 둡니다.',
    }),
    relative: Object.freeze({
        minMedianSpeedup: 3,
        degenerateMinMedianSpeedup: 1,
        rule: 'unique-address는 선형 경로 대비 중앙값 3배 이상, 퇴화 모양(shared-address)은 색인이 줄일 여지가 없으므로 1배 이상(느려지지 않음)이면 인정합니다.',
    }),
    noise: Object.freeze({
        madRelativeMax: 0.15,
        repetitions: REPETITIONS,
        rule: '각 경로의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    }),
});

function makeRows({ sharedAddress }) {
    const restaurants = [];
    const candidates = [];

    for (let index = 0; index < MERGED_ROWS; index += 1) {
        const address = sharedAddress ? '서울 중구 쯔동로 1' : '서울 중구 쯔동로 ' + index;
        restaurants.push({
            id: 'approved-' + index,
            name: '쯔동분식 ' + index,
            approved_name: '쯔동분식 ' + index,
            road_address: address,
            jibun_address: address,
            mergedRestaurants: [],
        });
    }

    for (let index = 0; index < DUPLICATE_CANDIDATES; index += 1) {
        const address = sharedAddress ? '서울 중구 쯔동로 1' : '서울 중구 쯔동로 ' + index;
        candidates.push({
            id: 'deleted-' + index,
            name: '쯔동분식 ' + index + ' 지점',
            approved_name: '쯔동분식 ' + index + ' 지점',
            road_address: address,
            jibun_address: address,
        });
    }

    for (let index = 0; index < UNRELATED_CANDIDATES; index += 1) {
        const address = '서울 중구 없는로 ' + index;
        candidates.push({
            id: 'unrelated-' + index,
            name: '없는집 ' + index,
            approved_name: '없는집 ' + index,
            road_address: address,
            jibun_address: address,
        });
    }

    const reviewRows = candidates.map((candidate) => ({ restaurant_id: candidate.id }));
    return { restaurants, candidates, reviewRows };
}

function runLinear({ restaurants, candidates, reviewRows }) {
    const directCountMap = new Map();
    for (const reviewRow of reviewRows) {
        if (!reviewRow.restaurant_id) continue;
        directCountMap.set(reviewRow.restaurant_id, (directCountMap.get(reviewRow.restaurant_id) ?? 0) + 1);
    }

    return restaurants.map((restaurant) => {
        const relatedIds = selectRelatedRestaurantReviewIds(restaurant, candidates);
        return relatedIds.reduce((sum, id) => sum + (directCountMap.get(id) ?? 0), 0);
    });
}

function runIndexed({ restaurants, candidates, reviewRows }) {
    const countMap = buildRelatedVerifiedReviewCountMap(restaurants, candidates, reviewRows);
    return restaurants.map((restaurant) => countMap.get(restaurant.id) ?? 0);
}

function fingerprint(counts) {
    let hash = 0;
    for (const count of counts) hash = (hash * 31 + count + 1) % 4294967296;
    return hash.toString(16);
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function madRelative(values) {
    const center = median(values);
    return median(values.map((value) => Math.abs(value - center))) / center;
}

function measure(run) {
    run();
    const samples = [];
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const started = performance.now();
        for (let loop = 0; loop < SAMPLE_LOOPS; loop += 1) run();
        samples.push((performance.now() - started) / SAMPLE_LOOPS);
    }
    const ordered = [...samples].sort((left, right) => left - right);
    return {
        medianMs: median(samples),
        p95Ms: ordered[Math.floor(ordered.length * 0.95)],
        madRelative: madRelative(samples),
    };
}

function countLinear(workload) {
    resetReviewLookupPerfCounters();
    const results = runLinear(workload);
    return { results, counters: getReviewLookupPerfCounters() };
}

function countIndexed(workload) {
    resetReviewLookupPerfCounters();
    const results = runIndexed(workload);
    return { results, counters: getReviewLookupPerfCounters() };
}

const scenarios = [];

for (const scenario of [
    { id: 'unique-address', sharedAddress: false, degenerate: false, description: '맛집마다 삭제 중복 후보가 같은 주소에 하나씩 있는 실제 데이터 모양' },
    { id: 'shared-address', sharedAddress: true, degenerate: true, description: '모든 후보가 한 주소를 공유하는 퇴화 모양(색인이 줄일 수 없는 최악의 경우)' },
]) {
    const workload = makeRows({ sharedAddress: scenario.sharedAddress });

    const before = countLinear(workload);
    const after = countIndexed(workload);

    const beforeFingerprint = fingerprint(before.results);
    const afterFingerprint = fingerprint(after.results);
    const equivalent = beforeFingerprint === afterFingerprint
        && before.results.length === after.results.length;

    const timingBefore = measure(() => runLinear(workload));
    const timingAfter = measure(() => runIndexed(workload));

    const relativeImprovement = timingBefore.medianMs / timingAfter.medianMs;
    const combinedRelativeNoise = timingBefore.madRelative + timingAfter.madRelative;
    const requiredSpeedup = scenario.degenerate
        ? VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.relative.degenerateMinMedianSpeedup
        : VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.relative.minMedianSpeedup;
    const acceptance = {
        absoluteMedianMsMax: scenario.degenerate
            ? VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.absolute.degenerateMedianMsMax
            : VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.absolute.realisticMedianMsMax,
        absoluteBudgetMet: timingAfter.medianMs <= (scenario.degenerate
            ? VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.absolute.degenerateMedianMsMax
            : VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.absolute.realisticMedianMsMax),
        relativeBudgetMet: relativeImprovement >= requiredSpeedup,
        requiredSpeedup,
        noiseWithinBudget:
            timingBefore.madRelative <= VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.noise.madRelativeMax
            && timingAfter.madRelative <= VERIFIED_REVIEW_COUNT_INDEX_BUDGETS.noise.madRelativeMax,
        combinedRelativeNoise,
        relativeImprovement,
        deltaExceedsNoise: Math.abs(relativeImprovement - 1) > combinedRelativeNoise,
    };
    acceptance.accepted = equivalent
        && acceptance.absoluteBudgetMet
        && acceptance.relativeBudgetMet
        && acceptance.noiseWithinBudget
        && acceptance.deltaExceedsNoise;

    scenarios.push({
        id: scenario.id,
        description: scenario.description,
        equivalence: equivalent ? 'identical' : 'mismatch',
        equivalenceDetail: [
            { id: 'S0-linear', countTotal: before.results.reduce((sum, value) => sum + value, 0), fingerprint: beforeFingerprint },
            { id: 'S1-indexed', countTotal: after.results.reduce((sum, value) => sum + value, 0), fingerprint: afterFingerprint },
        ],
        counters: [
            {
                id: 'S0-linear',
                candidateVisits: before.counters.candidateVisits,
                nameGates: before.counters.nameGates,
                addressGates: before.counters.addressGates,
            },
            {
                id: 'S1-indexed',
                candidateVisits: after.counters.candidateVisits,
                nameGates: after.counters.nameGates,
                addressGates: after.counters.addressGates,
            },
        ],
        measurements: [
            { id: 'S0-linear', ...timingBefore },
            { id: 'S1-indexed', ...timingAfter },
        ],
        acceptance,
        ratio: {
            speedupByMedian: relativeImprovement,
            speedupByP95: timingBefore.p95Ms / timingAfter.p95Ms,
            candidateVisitReduction: before.counters.candidateVisits / Math.max(after.counters.candidateVisits, 1),
            nameGateReduction: before.counters.nameGates / Math.max(after.counters.nameGates, 1),
        },
    });
}

const report = {
    generatedAt: new Date().toISOString(),
    baselineSource: {
        file: 'apps/web/lib/restaurant-review-lookup.ts (selectRelatedRestaurantReviewIds + 합산)',
        note: '기준 경로는 손으로 다시 쓴 근사가 아니라 이번 변경에서 무수정으로 남은 참조 구현입니다. 변경은 색인 조회 함수 추가와 restaurant-review-counts.ts의 호출 교체뿐이며, 집계 값 동일성은 tests-unit/restaurant-review-counts-index.test.ts가 확인합니다.',
    },
    workload: {
        mergedRows: MERGED_ROWS,
        duplicateCandidates: DUPLICATE_CANDIDATES,
        unrelatedCandidates: UNRELATED_CANDIDATES,
        repetitions: REPETITIONS,
        sampleLoops: SAMPLE_LOOPS,
    },
    budgets: VERIFIED_REVIEW_COUNT_INDEX_BUDGETS,
    scenarios,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.scenarios.map((scenario) => ({
    id: scenario.id,
    equivalence: scenario.equivalence,
    countTotal: scenario.equivalenceDetail.map((detail) => detail.countTotal),
    candidateVisits: scenario.counters.map((counter) => counter.candidateVisits),
    nameGates: scenario.counters.map((counter) => counter.nameGates),
    medianMs: scenario.measurements.map((measurement) => +measurement.medianMs.toFixed(3)),
    p95Ms: scenario.measurements.map((measurement) => +measurement.p95Ms.toFixed(3)),
    madRelative: scenario.measurements.map((measurement) => +measurement.madRelative.toFixed(4)),
    speedupByMedian: +scenario.ratio.speedupByMedian.toFixed(2),
    candidateVisitReduction: +scenario.ratio.candidateVisitReduction.toFixed(1),
    accepted: scenario.acceptance.accepted,
})), null, 2));
