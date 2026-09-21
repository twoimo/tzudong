// 관련 리뷰 조회의 후보 스캔 순서(주소 게이트 우선) 전후 비교 벤치마크.
// 실행: bun apps/web/performance/review-lookup-address-gate-20260921/benchmark-review-lookup-address-gate.mjs
//
// 비교 대상
// - before: 주소 게이트 적용 직전 커밋(63c0dd1a)의 실제 구현 동결 사본(restaurant-review-lookup.pre-address-gate.ts)
// - after: 현재 apps/web/lib/restaurant-review-lookup.ts
//
// 측정 규칙
// - 결과 동등성(400개 조회 전수 비교)을 먼저 확인한 뒤에만 시간을 측정합니다.
// - 콜드 측정은 반복마다 새 객체 정체성의 워크로드를 만들어 모듈 WeakMap 캐시가 빈 상태를 보장합니다.
// - 웜 측정은 같은 객체로 한 번 예열한 뒤 같은 워크로드를 다시 측정합니다.
// - 보고서는 절대/상대/노이즈 예산을 함께 기록하고, 노이즈(MAD 상대값)가 예산을 넘으면 개선으로 인정하지 않습니다.
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
    selectRelatedRestaurantReviewIds as selectAfter,
} from '../../lib/restaurant-review-lookup';
import { selectRelatedRestaurantReviewIds as selectBefore } from './restaurant-review-lookup.pre-address-gate';

const SOURCES = 400;
const CANDIDATES = 1200;
const REPETITIONS = 21;
const SEED = 20260921;

export const REVIEW_LOOKUP_ADDRESS_GATE_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        sweepP95MsMax: 250,
        rule: '한 스윕(400개 조회 x 1,200 후보)의 p95는 250ms 이하여야 합니다.',
    }),
    relative: Object.freeze({
        minMedianSpeedup: 2,
        rule: '중앙값 기준 2배 이상 빨라져야 개선으로 인정합니다.',
    }),
    noise: Object.freeze({
        madRelativeMax: 0.15,
        repetitions: REPETITIONS,
        rule: '각 구현의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    }),
});

function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const NAME_STEMS = ['정원분식', '스시린', '1500회전초밥', '귀일만두', '명동 얼큰수제비', '북창동순두부', '을지면옥', '하동관', '오다리집', '대성집'];
const BRANCHES = ['', ' 강남본점', ' 불당본점', ' 용산점', ' 서면점', ' 판교점'];
const ROAD_POOL = Array.from({ length: 40 }, (_, index) => `서울특별시 강남구 테스트로${index + 1}길 ${10 + index}`);
const JIBUN_POOL = Array.from({ length: 40 }, (_, index) => `서울특별시 강남구 테스트동 ${index + 1}-${index % 9 + 1}`);

function buildWorkload({ sources, candidates, seed }) {
    const random = createRandom(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];

    const candidateRows = Array.from({ length: candidates }, (_, index) => {
        const addressIndex = Math.floor(random() * ROAD_POOL.length);
        const name = `${pick(NAME_STEMS)}${pick(BRANCHES)}`;
        return {
            id: `cand-${index}`,
            name,
            approved_name: random() < 0.7 ? name : null,
            naver_name: random() < 0.3 ? `${name} 네이버` : null,
            origin_name: null,
            google_name: null,
            road_address: ROAD_POOL[addressIndex],
            jibun_address: random() < 0.8 ? JIBUN_POOL[addressIndex] : null,
        };
    });

    const sourceRows = Array.from({ length: sources }, (_, index) => {
        // 70%는 같은 주소를 쓰는 후보에서 파생(중복 리뷰 병합 대상), 30%는 주소가 겹치지 않는다.
        const derived = random() < 0.7;
        const addressIndex = derived
            ? ROAD_POOL.indexOf(candidateRows[Math.floor(random() * candidateRows.length)].road_address)
            : 39;
        const baseName = derived ? pick(NAME_STEMS) : `신규가게${index}`;
        const merged = random() < 0.25
            ? [{ id: `merged-${index}`, road_address: ROAD_POOL[addressIndex], jibun_address: JIBUN_POOL[addressIndex] }]
            : [];
        return {
            id: `source-${index}`,
            name: `${baseName}${pick(BRANCHES)}`,
            approved_name: `${baseName}${pick(BRANCHES)}`,
            naver_name: null,
            origin_name: null,
            google_name: null,
            road_address: ROAD_POOL[addressIndex],
            jibun_address: random() < 0.9 ? JIBUN_POOL[addressIndex] : null,
            mergedRestaurants: merged,
        };
    });

    return { sourceRows, candidateRows };
}

function sweep(workload, select) {
    let resultCount = 0;
    for (const source of workload.sourceRows) {
        resultCount += select(source, workload.candidateRows).length;
    }
    return resultCount;
}

// 반복마다 새 객체 정체성의 워크로드를 써서 콜드 캐시를 보장한다.
// 두 구현을 같은 반복 안에서 번갈아 측정해 시간에 따른 기계 상태 변화를 상쇄한다.
function measureColdPair() {
    const beforeSamples = [];
    const afterSamples = [];
    let beforeResults = 0;
    let afterResults = 0;
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const beforeWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED + repetition });
        const beforeStartedAt = performance.now();
        beforeResults += sweep(beforeWorkload, selectBefore);
        beforeSamples.push(performance.now() - beforeStartedAt);

        const afterWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED + repetition });
        const afterStartedAt = performance.now();
        afterResults += sweep(afterWorkload, selectAfter);
        afterSamples.push(performance.now() - afterStartedAt);
    }
    return { beforeSamples, afterSamples, beforeResults, afterResults };
}

// 같은 객체로 한 번 예열한 뒤 같은 워크로드를 다시 측정한다.
function measureWarmPair() {
    const beforeWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED });
    const afterWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED });
    sweep(beforeWorkload, selectBefore);
    sweep(afterWorkload, selectAfter);

    const beforeSamples = [];
    const afterSamples = [];
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const beforeStartedAt = performance.now();
        sweep(beforeWorkload, selectBefore);
        beforeSamples.push(performance.now() - beforeStartedAt);

        const afterStartedAt = performance.now();
        sweep(afterWorkload, selectAfter);
        afterSamples.push(performance.now() - afterStartedAt);
    }
    return { beforeSamples, afterSamples };
}

function medianOf(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function p95Of(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function madRelativeOf(values) {
    const median = medianOf(values);
    if (median === 0) return 0;
    const deviations = values.map((value) => Math.abs(value - median));
    return medianOf(deviations) / median;
}

function summarize(samples) {
    return {
        medianMs: Number(medianOf(samples).toFixed(2)),
        p95Ms: Number(p95Of(samples).toFixed(2)),
        madRelative: Number(madRelativeOf(samples).toFixed(4)),
    };
}

const equivalenceWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED });
let mismatches = 0;
for (const source of equivalenceWorkload.sourceRows) {
    const before = selectBefore(source, equivalenceWorkload.candidateRows);
    const after = selectAfter(source, equivalenceWorkload.candidateRows);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        mismatches += 1;
        if (mismatches <= 3) console.error('[mismatch]', source.id, before, after);
    }
}

const coldPair = measureColdPair();
const warmPair = measureWarmPair();

// 현재 구현의 후보 스캔 카운터는 한 번 계측 스윕으로 측정한다.
const counterWorkload = buildWorkload({ sources: SOURCES, candidates: CANDIDATES, seed: SEED });
resetReviewLookupPerfCounters();
let counterResultCount = 0;
for (const source of counterWorkload.sourceRows) {
    counterResultCount += selectAfter(source, counterWorkload.candidateRows).length;
}
const counters = getReviewLookupPerfCounters();

// 이전 구현은 이름 목록이 비어 있지 않은 워크로드에서 방문한 모든 후보에 이름 호환 검사를 평가한다.
const workloadHasNamesEverywhere = counterWorkload.sourceRows.every((source) => Boolean(source.name || source.approved_name))
    && counterWorkload.candidateRows.every((candidate) => Boolean(candidate.name || candidate.approved_name));

const beforeSummary = summarize(coldPair.beforeSamples);
const afterSummary = summarize(coldPair.afterSamples);
const budgets = REVIEW_LOOKUP_ADDRESS_GATE_BUDGETS;
const medianSpeedup = Number((beforeSummary.medianMs / afterSummary.medianMs).toFixed(2));
const p95Speedup = Number((beforeSummary.p95Ms / afterSummary.p95Ms).toFixed(2));
const combinedRelativeNoise = Number((beforeSummary.madRelative + afterSummary.madRelative).toFixed(4));
const relativeImprovement = Number((medianSpeedup - 1).toFixed(4));
const noiseWithinBudget = beforeSummary.madRelative <= budgets.noise.madRelativeMax
    && afterSummary.madRelative <= budgets.noise.madRelativeMax;
const deltaExceedsNoise = relativeImprovement > combinedRelativeNoise;

const report = {
    generatedAt: new Date().toISOString(),
    baselineSource: {
        commit: '63c0dd1a',
        file: 'apps/web/performance/review-lookup-address-gate-20260921/restaurant-review-lookup.pre-address-gate.ts',
        note: '이전 경로는 손으로 다시 쓴 근사가 아니라 주소 게이트 적용 직전 구현의 동결 사본입니다.',
    },
    workload: {
        sourceRestaurants: SOURCES,
        candidates: CANDIDATES,
        candidateVisitsPerSweep: counters.candidateVisits,
        repetitions: REPETITIONS,
    },
    equivalence: mismatches === 0 ? 'identical' : 'mismatch',
    mismatches,
    resultCount: counterResultCount,
    budgets,
    measurements: {
        beforeCold: beforeSummary,
        afterCold: afterSummary,
        beforeWarm: summarize(warmPair.beforeSamples),
        afterWarm: summarize(warmPair.afterSamples),
    },
    gates: {
        candidateVisitsPerSweep: counters.candidateVisits,
        beforeNameGateEvaluationsPerSweep: workloadHasNamesEverywhere ? counters.candidateVisits : null,
        afterNameGateEvaluationsPerSweep: counters.nameGates,
        afterAddressGateEvaluationsPerSweep: counters.addressGates,
        beforeRule: '이전 구현은 방문한 모든 후보에서 이름 호환 검사를 평가합니다(이름 목록이 비어 있지 않은 워크로드).',
        afterRule: '현재 구현은 주소 게이트를 통과한 후보에서만 이름 호환 검사를 평가합니다(모듈 카운터로 측정).',
        nameGateEvaluationsReducedBy: Number((counters.candidateVisits / counters.nameGates).toFixed(2)),
    },
    acceptance: {
        absoluteBudgetMet: afterSummary.p95Ms <= budgets.absolute.sweepP95MsMax,
        relativeBudgetMet: medianSpeedup >= budgets.relative.minMedianSpeedup,
        noiseWithinBudget,
        combinedRelativeNoise,
        relativeImprovement,
        deltaExceedsNoise,
        accepted: mismatches === 0
            && noiseWithinBudget
            && deltaExceedsNoise
            && afterSummary.p95Ms <= budgets.absolute.sweepP95MsMax
            && medianSpeedup >= budgets.relative.minMedianSpeedup,
    },
    ratio: {
        speedupByMedian: medianSpeedup,
        speedupByP95: p95Speedup,
        warmSpeedupByMedian: Number((summarize(warmPair.beforeSamples).medianMs / summarize(warmPair.afterSamples).medianMs).toFixed(2)),
    },
};

console.log(JSON.stringify(report, null, 2));
