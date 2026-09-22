// 도장/미방문 판정이 맛집마다 후보 전체를 다시 훑는 비용을 색인 도입 전후로 비교하는 벤치마크.
// 실행: bun apps/web/performance/visited-restaurant-matcher-20260922/benchmark-visited-restaurant-matcher.mjs
//
// 비교 대상(둘 다 같은 방문/미방문 판정을 내려야 한다)
// - S0-linear: lib/restaurant-visit-matching.ts의 hasRelatedVerifiedUserReview.
//       맛집 하나를 볼 때마다 후보(사용자 리뷰가 있는 맛집) 전체를 순회한다. 이번 변경 이전에
//       훅과 도장 화면이 쓰던 경로이며, 지금도 참조 구현으로 그대로 남아 있다(이 파일은 무수정).
// - S1-indexed: lib/restaurant-review-lookup.ts의 createVisitedRestaurantMatcher.
//       후보를 주소별로 한 번만 색인하고, 맛집마다 색인에 걸린 후보만 본다.
//
// 시나리오
// - unique-address: 맛집마다 주소가 다른 실제 데이터 모양.
// - shared-address: 모든 맛집이 한 주소를 공유하는 퇴화 모양(색인이 줄일 수 없는 최악의 경우).
//
// 측정 항목
// - 결과 동등성(맛집 순서대로의 방문 여부 지문과 방문 수)
// - 결정적 연산 카운터(후보 검사 수, 이름 게이트 평가 수)
// - 목록 한 번 판정 시간(중앙값, p95, MAD)
import { writeFileSync } from 'node:fs';
import {
    createVisitedRestaurantMatcher,
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
} from '../../lib/restaurant-review-lookup';
import { hasRelatedVerifiedUserReview } from '../../lib/restaurant-visit-matching';

const MERGED_ROWS = 1500;
const REVIEWED_CANDIDATES = 40;
// 실제 데이터에서 사용자 리뷰는 대부분 삭제/미승인 중복 레코드에 붙어 있고, 승인 카드와 주소는 같고
// 이름만 조금 다르다. 나머지는 어떤 승인 맛집과도 겹치지 않는다.
const MATCHING_CANDIDATES = 30;
const REPETITIONS = 21;
// 표본 하나를 짧게 재면 타이머 분해능과 GC 때문에 상대 노이즈가 커진다. 색인 경로는 판정 한 번이
// 0.5ms 수준이라 표본이 특히 짧아지므로, 표본마다 같은 작업을 충분히 여러 번 돌리고 다시 판정 한 번의
// 시간으로 나눠 보고한다(20회 x 0.5ms = 약 10ms, 20회 x 10ms = 약 200ms).
const SAMPLE_LOOPS = 20;

export const VISITED_RESTAURANT_MATCHER_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        pipelineMedianMsMax: 30,
        rule: '색인 경로의 목록 한 번 판정 중앙값이 30ms 이하여야 합니다.',
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

    const candidates = [];
    for (let index = 0; index < REVIEWED_CANDIDATES; index += 1) {
        const matching = index < MATCHING_CANDIDATES;
        const target = restaurants[index % MERGED_ROWS];
        const address = matching ? target.road_address : '서울 중구 없는로 ' + index;
        const name = matching ? target.name + ' 지점' : '없는집 ' + index;
        candidates.push({
            id: 'reviewed-' + index,
            name,
            approved_name: name,
            road_address: address,
            jibun_address: address,
        });
    }

    const visitedIds = new Set(candidates.map((candidate) => candidate.id));
    return { restaurants, candidates, visitedIds };
}

function runLinear({ restaurants, candidates, visitedIds }) {
    return restaurants.map((restaurant) => hasRelatedVerifiedUserReview({
        restaurant,
        reviewedRestaurantIds: visitedIds,
        reviewedRestaurants: candidates,
    }));
}

function runIndexed({ restaurants, candidates, visitedIds }) {
    const isVisited = createVisitedRestaurantMatcher(candidates, visitedIds);
    return restaurants.map((restaurant) => isVisited(restaurant));
}

function fingerprint(results) {
    let hash = 0;
    for (const visited of results) {
        hash = (hash * 31 + (visited ? 1 : 2)) % 4294967296;
    }
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
    { id: 'unique-address', sharedAddress: false, degenerate: false, description: '맛집마다 주소가 다른 실제 데이터 모양' },
    { id: 'shared-address', sharedAddress: true, degenerate: true, description: '모든 맛집이 한 주소를 공유하는 퇴화 모양(색인이 줄일 수 없는 최악의 경우)' },
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
        ? VISITED_RESTAURANT_MATCHER_BUDGETS.relative.degenerateMinMedianSpeedup
        : VISITED_RESTAURANT_MATCHER_BUDGETS.relative.minMedianSpeedup;
    const acceptance = {
        absoluteBudgetMet: timingAfter.medianMs <= VISITED_RESTAURANT_MATCHER_BUDGETS.absolute.pipelineMedianMsMax,
        relativeBudgetMet: relativeImprovement >= requiredSpeedup,
        requiredSpeedup,
        noiseWithinBudget:
            timingBefore.madRelative <= VISITED_RESTAURANT_MATCHER_BUDGETS.noise.madRelativeMax
            && timingAfter.madRelative <= VISITED_RESTAURANT_MATCHER_BUDGETS.noise.madRelativeMax,
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
            { id: 'S0-linear', visitedCount: before.results.filter(Boolean).length, fingerprint: beforeFingerprint },
            { id: 'S1-indexed', visitedCount: after.results.filter(Boolean).length, fingerprint: afterFingerprint },
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
        file: 'apps/web/lib/restaurant-visit-matching.ts (hasRelatedVerifiedUserReview)',
        note: '기준 경로는 손으로 다시 쓴 근사가 아니라 이번 변경에서 무수정으로 남은 참조 구현입니다. 변경은 restaurant-review-lookup.ts에 추가만 했고(순수 추가), 판정 결과 동일성은 tests-unit/restaurant-visit-matching-matcher.test.ts가 확인합니다.',
    },
    workload: {
        mergedRows: MERGED_ROWS,
        reviewedCandidates: REVIEWED_CANDIDATES,
        matchingCandidates: MATCHING_CANDIDATES,
        repetitions: REPETITIONS,
        sampleLoops: SAMPLE_LOOPS,
    },
    budgets: VISITED_RESTAURANT_MATCHER_BUDGETS,
    scenarios,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.scenarios.map((scenario) => ({
    id: scenario.id,
    equivalence: scenario.equivalence,
    visitedCount: scenario.equivalenceDetail.map((detail) => detail.visitedCount),
    candidateVisits: scenario.counters.map((counter) => counter.candidateVisits),
    nameGates: scenario.counters.map((counter) => counter.nameGates),
    medianMs: scenario.measurements.map((measurement) => +measurement.medianMs.toFixed(3)),
    p95Ms: scenario.measurements.map((measurement) => +measurement.p95Ms.toFixed(3)),
    madRelative: scenario.measurements.map((measurement) => +measurement.madRelative.toFixed(4)),
    speedupByMedian: +scenario.ratio.speedupByMedian.toFixed(2),
    candidateVisitReduction: +scenario.ratio.candidateVisitReduction.toFixed(1),
    accepted: scenario.acceptance.accepted,
})), null, 2));
