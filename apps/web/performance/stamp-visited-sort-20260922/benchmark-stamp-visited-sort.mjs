// 도장 페이지 정렬 비교자 안의 방문 판정 반복 호출 비용 비교 벤치마크.
// 실행: bun apps/web/performance/stamp-visited-sort-20260922/benchmark-stamp-visited-sort.mjs
//
// 비교 대상(둘 다 같은 결과를 내야 한다)
// - S0: 최적화 이전. 비교자마다 방문 판정을 다시 계산한다.
// - S1: 현재 구현. lib/stamp-restaurant-order.ts의 createVisitedLookup으로 맛집당 한 번만 계산한다.
//
// 시나리오
// - filter+sort: 미방문만 보기 필터 + 도장 우선 정렬
// - sort-only: 필터 없이 도장 우선 정렬만
//
// 측정 항목
// - 결과 동등성(정렬된 id 순서 지문)
// - 방문 판정 호출 수와 후보 스캔 수(알고리즘 연산량의 결정적 대리 지표)
// - 한 번의 파이프라인 실행 시간(중앙값, p95, MAD)
import { writeFileSync } from 'node:fs';
import { hasRelatedVerifiedUserReview } from '../../lib/restaurant-visit-matching';
import { compareStampRestaurants, createVisitedLookup } from '../../lib/stamp-restaurant-order';
import { mergeRestaurants } from '../../hooks/use-restaurants';
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
} from '../../lib/restaurant-review-lookup';

const ROW_COUNT = 1372;
const DUPLICATE_EVERY = 7;
const REVIEW_COUNT = 40;
const REPETITIONS = 21;
// 표본 하나를 짧게 재면 타이머 분해능과 GC 때문에 상대 노이즈가 커진다. 표본마다 같은 작업을
// 여러 번 돌리고 다시 실행 하나의 시간으로 나눠 보고한다.
const SAMPLE_LOOPS = 7;

export const STAMP_VISITED_SORT_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        pipelineMedianMsMax: 40,
        rule: '한 번의 파이프라인 실행 중앙값이 40ms 이하여야 합니다.',
    }),
    relative: Object.freeze({
        minMedianSpeedup: 2,
        rule: '가장 느린 변형 대비 중앙값 2배 이상 빨라져야 개선으로 인정합니다.',
    }),
    noise: Object.freeze({
        madRelativeMax: 0.15,
        repetitions: REPETITIONS,
        rule: '각 변형의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    }),
});

function makeRow(index) {
    const name = '쯔동분식 ' + index;
    const address = '서울 중구 쯔동로 ' + index;
    return {
        id: 'restaurant-' + index,
        name,
        approved_name: name,
        origin_name: null,
        naver_name: null,
        google_name: null,
        phone: null,
        categories: ['분식'],
        status: 'approved',
        source_type: 'youtube',
        youtube_link: 'https://www.youtube.com/watch?v=' + index,
        youtube_meta: null,
        evaluation_results: null,
        reasoning_basis: null,
        tzuyang_review: null,
        road_address: address,
        jibun_address: address,
        english_address: null,
        lat: 37.5 + index / 100000,
        lng: 127.0 + index / 100000,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        review_count: index % 17,
        youtube_video_id: 'video-' + index,
        tzuyang_review_short: null,
    };
}

function makeWorkload() {
    const rows = [];
    for (let index = 0; index < ROW_COUNT; index += 1) {
        rows.push(makeRow(index));
        if (index % DUPLICATE_EVERY === 0) {
            const duplicate = makeRow(index);
            duplicate.id = 'restaurant-' + index + '-dup';
            duplicate.name = duplicate.approved_name = '쯔동분식 ' + index + ' (중복)';
            rows.push(duplicate);
        }
    }

    const merged = mergeRestaurants(rows);
    const reviewedRestaurants = merged.slice(0, REVIEW_COUNT).map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        approved_name: restaurant.approved_name,
        road_address: restaurant.road_address,
        jibun_address: restaurant.jibun_address,
    }));
    const reviewedRestaurantIds = new Set(reviewedRestaurants.map((restaurant) => restaurant.id));

    return { merged, reviewedRestaurants, reviewedRestaurantIds };
}

function makeIsVisited({ reviewedRestaurants, reviewedRestaurantIds }, counter) {
    return (restaurant) => {
        counter.calls += 1;
        return hasRelatedVerifiedUserReview({
            restaurant,
            reviewedRestaurantIds,
            reviewedRestaurants,
        });
    };
}

const SORT_OPTIONS = { sortColumn: 'fanVisits', sortDirection: 'desc' };

function runPipeline(source, isVisited, onlyUnvisited) {
    let result = [...source];
    if (onlyUnvisited) result = result.filter((restaurant) => !isVisited(restaurant));
    result.sort((a, b) => compareStampRestaurants(a, b, { isVisited, ...SORT_OPTIONS }));
    return result;
}

function fingerprint(list) {
    let hash = 0;
    for (const restaurant of list) {
        for (let index = 0; index < restaurant.id.length; index += 1) {
            hash = (hash * 31 + restaurant.id.charCodeAt(index)) % 4294967296;
        }
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

const workload = makeWorkload();
const scenarios = [];

for (const scenario of [
    { id: 'filter+sort', onlyUnvisited: true, description: '미방문만 보기 필터 + 도장 우선 정렬' },
    { id: 'sort-only', onlyUnvisited: false, description: '필터 없이 도장 우선 정렬만' },
]) {
    const counterS0 = { calls: 0 };
    resetReviewLookupPerfCounters();
    const resultS0 = runPipeline(workload.merged, makeIsVisited(workload, counterS0), scenario.onlyUnvisited);
    const countersS0 = getReviewLookupPerfCounters();

    const counterS1 = { calls: 0 };
    resetReviewLookupPerfCounters();
    const resultS1 = runPipeline(workload.merged, createVisitedLookup(makeIsVisited(workload, counterS1)), scenario.onlyUnvisited);
    const countersS1 = getReviewLookupPerfCounters();

    const fingerprintS0 = fingerprint(resultS0);
    const fingerprintS1 = fingerprint(resultS1);
    const equivalent = fingerprintS0 === fingerprintS1 && resultS0.length === resultS1.length;

    const timingS0 = measure(() => runPipeline(workload.merged, makeIsVisited(workload, { calls: 0 }), scenario.onlyUnvisited));
    const timingS1 = measure(() => runPipeline(workload.merged, createVisitedLookup(makeIsVisited(workload, { calls: 0 })), scenario.onlyUnvisited));

    const relativeImprovement = timingS0.medianMs / timingS1.medianMs;
    const combinedRelativeNoise = timingS0.madRelative + timingS1.madRelative;

    scenarios.push({
        id: scenario.id,
        description: scenario.description,
        equivalence: equivalent ? 'identical' : 'mismatch',
        equivalenceDetail: [
            { id: 'S0-previous', resultCount: resultS0.length, fingerprint: fingerprintS0, visitChecks: counterS0.calls, candidateVisits: countersS0.candidateVisits },
            { id: 'S1-createVisitedLookup', resultCount: resultS1.length, fingerprint: fingerprintS1, visitChecks: counterS1.calls, candidateVisits: countersS1.candidateVisits },
        ],
        measurements: [
            { id: 'S0-previous', ...timingS0 },
            { id: 'S1-createVisitedLookup', ...timingS1 },
        ],
        acceptance: {
            absoluteBudgetMet: timingS1.medianMs <= STAMP_VISITED_SORT_BUDGETS.absolute.pipelineMedianMsMax,
            relativeBudgetMet: relativeImprovement >= STAMP_VISITED_SORT_BUDGETS.relative.minMedianSpeedup,
            noiseWithinBudget:
                timingS0.madRelative <= STAMP_VISITED_SORT_BUDGETS.noise.madRelativeMax
                && timingS1.madRelative <= STAMP_VISITED_SORT_BUDGETS.noise.madRelativeMax,
            combinedRelativeNoise,
            relativeImprovement,
            deltaExceedsNoise: Math.abs(relativeImprovement - 1) > combinedRelativeNoise,
        },
        ratio: {
            speedupByMedian: relativeImprovement,
            speedupByP95: timingS0.p95Ms / timingS1.p95Ms,
            visitCheckReduction: counterS0.calls / counterS1.calls,
            candidateVisitReduction: countersS0.candidateVisits / countersS1.candidateVisits,
        },
    });
    scenarios[scenarios.length - 1].acceptance.accepted =
        equivalent
        && scenarios[scenarios.length - 1].acceptance.absoluteBudgetMet
        && scenarios[scenarios.length - 1].acceptance.relativeBudgetMet
        && scenarios[scenarios.length - 1].acceptance.noiseWithinBudget
        && scenarios[scenarios.length - 1].acceptance.deltaExceedsNoise;
}

const report = {
    generatedAt: new Date().toISOString(),
    workload: {
        rows: ROW_COUNT,
        mergedRestaurants: workload.merged.length,
        reviews: REVIEW_COUNT,
        repetitions: REPETITIONS,
        sampleLoops: SAMPLE_LOOPS,
    },
    budgets: STAMP_VISITED_SORT_BUDGETS,
    scenarios,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.scenarios.map((scenario) => ({
    id: scenario.id,
    equivalence: scenario.equivalence,
    visitChecks: scenario.equivalenceDetail.map((detail) => detail.visitChecks),
    candidateVisits: scenario.equivalenceDetail.map((detail) => detail.candidateVisits),
    medianMs: scenario.measurements.map((measurement) => +measurement.medianMs.toFixed(3)),
    madRelative: scenario.measurements.map((measurement) => +measurement.madRelative.toFixed(4)),
    speedupByMedian: +scenario.ratio.speedupByMedian.toFixed(2),
    visitCheckReduction: +scenario.ratio.visitCheckReduction.toFixed(1),
    accepted: scenario.acceptance.accepted,
})), null, 2));
