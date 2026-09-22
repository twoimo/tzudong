// 리뷰 행마다 승인 맛집 목록을 처음부터 다시 훑는 비용을 색인 도입 전후로 비교하는 벤치마크.
// 실행: bun apps/web/performance/review-canonical-index-20260922/benchmark-review-canonical-index.mjs
//
// 비교 대상(둘 다 같은 맛집을 골라야 한다)
// - S0: 동결 사본(restaurant-visit-matching.pre-index.ts)의 findCanonicalVisitedRestaurant.
//       리뷰 행마다 승인 맛집 목록 전체를 선형 탐색한다.
// - S1: lib/restaurant-visit-matching.ts의 createCanonicalVisitedLookup.
//       주소/직접 ID 색인을 한 번 만들고 행마다 조회한다.
//
// 시나리오
// - unique-address: 맛집마다 주소가 다른 실제 데이터 모양(중복 주소는 병합 레코드에서만 생긴다).
// - shared-address: 승인 맛집 전부가 한 주소를 공유하는 퇴화 모양. 색인이 줄일 수 없는 최악의 경우를 남긴다.
//
// 측정 항목
// - 결과 동등성(행마다 고른 맛집 id 지문)
// - 결정적 연산 카운터(후보 검사 수, 이름 게이트 평가 수)
// - 한 번의 파이프라인 실행 시간(중앙값, p95, MAD)
import { writeFileSync } from 'node:fs';
import { findCanonicalVisitedRestaurant as findCanonicalPreIndex } from './restaurant-visit-matching.pre-index';
import { createCanonicalVisitedLookup } from '../../lib/restaurant-visit-matching';
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
} from '../../lib/restaurant-review-lookup';

const APPROVED_COUNT = 1200;
const REVIEW_ROWS = 400;
const RESOLVING_ROWS = 300;
const REPETITIONS = 21;
// 표본 하나를 짧게 재면 타이머 분해능과 GC 때문에 상대 노이즈가 커진다. 표본마다 같은 작업을
// 여러 번 돌리고 다시 실행 하나의 시간으로 나눠 보고한다.
const SAMPLE_LOOPS = 5;

export const REVIEW_CANONICAL_INDEX_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        pipelineMedianMsMax: 60,
        rule: '색인 경로의 한 번의 파이프라인 실행 중앙값이 60ms 이하여야 합니다.',
    }),
    relative: Object.freeze({
        minMedianSpeedup: 2,
        rule: '색인 이전 경로 대비 중앙값 2배 이상 빨라져야 개선으로 인정합니다.',
    }),
    noise: Object.freeze({
        madRelativeMax: 0.15,
        repetitions: REPETITIONS,
        rule: '각 경로의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    }),
});

function approvedRow(index, address) {
    return {
        id: 'approved-' + index,
        name: '쯔동분식 ' + index,
        approved_name: '쯔동분식 ' + index,
        road_address: address,
        jibun_address: address,
        mergedRestaurants: [],
    };
}

function reviewRow(index, address, name) {
    return {
        id: 'deleted-' + index,
        name,
        approved_name: name,
        road_address: address,
        jibun_address: address,
    };
}

// 실제 데이터에서 리뷰는 삭제/미승인 중복 레코드에 붙어 있고, 승인 카드와 주소는 같고 이름만
// 조금 다른 경우가 대부분이다. 나머지 행은 어떤 승인 맛집과도 겹치지 않아 결과가 없다.
function makeRows({ sharedAddress }) {
    const approved = [];
    for (let index = 0; index < APPROVED_COUNT; index += 1) {
        const address = sharedAddress ? '서울 중구 쯔동로 1' : '서울 중구 쯔동로 ' + index;
        approved.push(approvedRow(index, address));
    }

    const rows = [];
    for (let index = 0; index < REVIEW_ROWS; index += 1) {
        if (index < RESOLVING_ROWS) {
            const target = index % APPROVED_COUNT;
            const address = approved[target].road_address;
            rows.push({
                reviewedRestaurant: reviewRow(index, address, approved[target].name + ' 지점'),
                reviewedRestaurantId: 'deleted-' + index,
            });
        } else {
            const address = '서울 중구 없는로 ' + index;
            rows.push({
                reviewedRestaurant: reviewRow(index, address, '없는집 ' + index + ' 지점'),
                reviewedRestaurantId: 'deleted-' + index,
            });
        }
    }

    return { approved, rows };
}

function runPreIndex({ approved, rows }) {
    return rows.map((row) => findCanonicalPreIndex({
        reviewedRestaurant: row.reviewedRestaurant,
        reviewedRestaurantId: row.reviewedRestaurantId,
        approvedRestaurants: approved,
    }));
}

function runIndexed({ approved, rows }) {
    const resolve = createCanonicalVisitedLookup(approved);
    return rows.map((row) => resolve(row.reviewedRestaurant, row.reviewedRestaurantId));
}

function fingerprint(results) {
    let hash = 0;
    for (const result of results) {
        const id = result ? result.id : 'null';
        for (let index = 0; index < id.length; index += 1) {
            hash = (hash * 31 + id.charCodeAt(index)) % 4294967296;
        }
        hash = (hash * 31 + 17) % 4294967296;
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

function countPreIndex(workload) {
    resetReviewLookupPerfCounters();
    const results = runPreIndex(workload);
    return { results, counters: getReviewLookupPerfCounters() };
}

function countIndexed(workload) {
    resetReviewLookupPerfCounters();
    const results = runIndexed(workload);
    return { results, counters: getReviewLookupPerfCounters() };
}

const scenarios = [];

for (const scenario of [
    { id: 'unique-address', sharedAddress: false, description: '맛집마다 주소가 다른 실제 데이터 모양' },
    { id: 'shared-address', sharedAddress: true, description: '승인 맛집 전부가 한 주소를 공유하는 퇴화 모양' },
]) {
    const workload = makeRows({ sharedAddress: scenario.sharedAddress });

    const before = countPreIndex(workload);
    const after = countIndexed(workload);

    const beforeFingerprint = fingerprint(before.results);
    const afterFingerprint = fingerprint(after.results);
    const equivalent = beforeFingerprint === afterFingerprint;

    const timingBefore = measure(() => runPreIndex(workload));
    const timingAfter = measure(() => runIndexed(workload));

    const relativeImprovement = timingBefore.medianMs / timingAfter.medianMs;
    const combinedRelativeNoise = timingBefore.madRelative + timingAfter.madRelative;
    const acceptance = {
        absoluteBudgetMet: timingAfter.medianMs <= REVIEW_CANONICAL_INDEX_BUDGETS.absolute.pipelineMedianMsMax,
        relativeBudgetMet: relativeImprovement >= REVIEW_CANONICAL_INDEX_BUDGETS.relative.minMedianSpeedup,
        noiseWithinBudget:
            timingBefore.madRelative <= REVIEW_CANONICAL_INDEX_BUDGETS.noise.madRelativeMax
            && timingAfter.madRelative <= REVIEW_CANONICAL_INDEX_BUDGETS.noise.madRelativeMax,
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
            { id: 'S0-pre-index', resultCount: before.results.length, fingerprint: beforeFingerprint },
            { id: 'S1-indexed', resultCount: after.results.length, fingerprint: afterFingerprint },
        ],
        counters: [
            {
                id: 'S0-pre-index',
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
            { id: 'S0-pre-index', ...timingBefore },
            { id: 'S1-indexed', ...timingAfter },
        ],
        acceptance,
        ratio: {
            speedupByMedian: relativeImprovement,
            speedupByP95: timingBefore.p95Ms / timingAfter.p95Ms,
            candidateVisitReduction: before.counters.candidateVisits / after.counters.candidateVisits,
            nameGateReduction: before.counters.nameGates / after.counters.nameGates,
        },
    });
}

const report = {
    generatedAt: new Date().toISOString(),
    baselineSource: {
        file: 'apps/web/performance/review-canonical-index-20260922/restaurant-visit-matching.pre-index.ts',
        note: '이전 경로는 손으로 다시 쓴 근사가 아니라 색인 도입 직전 lib/restaurant-visit-matching.ts의 동결 사본입니다.',
    },
    workload: {
        approvedRestaurants: APPROVED_COUNT,
        reviewRows: REVIEW_ROWS,
        resolvingRows: RESOLVING_ROWS,
        repetitions: REPETITIONS,
        sampleLoops: SAMPLE_LOOPS,
    },
    budgets: REVIEW_CANONICAL_INDEX_BUDGETS,
    scenarios,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.scenarios.map((scenario) => ({
    id: scenario.id,
    equivalence: scenario.equivalence,
    candidateVisits: scenario.counters.map((counter) => counter.candidateVisits),
    nameGates: scenario.counters.map((counter) => counter.nameGates),
    medianMs: scenario.measurements.map((measurement) => +measurement.medianMs.toFixed(3)),
    p95Ms: scenario.measurements.map((measurement) => +measurement.p95Ms.toFixed(3)),
    madRelative: scenario.measurements.map((measurement) => +measurement.madRelative.toFixed(4)),
    speedupByMedian: +scenario.ratio.speedupByMedian.toFixed(2),
    candidateVisitReduction: +scenario.ratio.candidateVisitReduction.toFixed(1),
    accepted: scenario.acceptance.accepted,
})), null, 2));

