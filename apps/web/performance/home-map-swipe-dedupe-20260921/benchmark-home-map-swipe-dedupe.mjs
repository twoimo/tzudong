// 홈 지도 스와이프 목록 중복 제거 최적화 전후 비교 벤치마크.
// 실행: bun apps/web/performance/home-map-swipe-dedupe-20260921/benchmark-home-map-swipe-dedupe.mjs
//
// 측정 항목
// - 같은 입력에 대한 처리 시간(중앙값, p95)
// - 결과 동등성(유지되는 id 순서와 객체 정체성)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dedupeHomeMapRestaurants } from '../../lib/home-map-swipe-restaurants';

// ---- 최적화 이전 알고리즘(원본 코드 그대로 동결) ----
function oldHasSameSwipeCoordinates(a, b) {
    if (!(a.lat && a.lng && b.lat && b.lng)) return false;

    const aLat = Number(a.lat);
    const aLng = Number(a.lng);
    const bLat = Number(b.lat);
    const bLng = Number(b.lng);

    return (
        Number.isFinite(aLat) &&
        Number.isFinite(aLng) &&
        Number.isFinite(bLat) &&
        Number.isFinite(bLng) &&
        Math.abs(aLat - bLat) < 0.0001 &&
        Math.abs(aLng - bLng) < 0.0001
    );
}

function oldIsSameRestaurantForSwipe(a, b) {
    if (a.id === b.id) return true;

    if (a.mergedRestaurants?.some((restaurant) => restaurant.id === b.id)) return true;
    if (b.mergedRestaurants?.some((restaurant) => restaurant.id === a.id)) return true;

    return a.name === b.name && oldHasSameSwipeCoordinates(a, b);
}

function dedupeOriginal(restaurants) {
    const uniqueRestaurants = [];

    for (const restaurant of restaurants) {
        if (!restaurant) continue;
        if (uniqueRestaurants.some((existing) => oldIsSameRestaurantForSwipe(existing, restaurant))) {
            continue;
        }
        uniqueRestaurants.push(restaurant);
    }

    return uniqueRestaurants;
}

// ---- 재현 가능한 입력 데이터 ----
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const SWIPE_REGIONS = ['강남', '서초', '마포', '송파', '용산', '분당', '수영', '해운대'];

function buildFixture(size, seed) {
    const random = createRandom(seed);
    const rows = [];

    for (let index = 0; index < size; index += 1) {
        const region = SWIPE_REGIONS[index % SWIPE_REGIONS.length];
        const sameNameCluster = random() < 0.25;
        const duplicateId = index % 3 !== 0 && random() < 0.4;

        rows.push({
            id: duplicateId ? 'row-' + (index - 1) : 'row-' + index,
            name: sameNameCluster ? '쯔동맛집 ' + region + ' ' + (index % 40) : '맛집 ' + index,
            lat: sameNameCluster ? 37.5 + (index % 40) / 1000 : 37.5 + random(),
            lng: sameNameCluster ? 127.0 + (index % 40) / 1000 : 127.0 + random(),
            mergedRestaurants: index % 5 === 0
                ? [{ id: 'row-' + (index + 1) }, { id: 'row-' + (index + 3) }]
                : undefined,
        });
    }

    return rows;
}

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const madRelative = (values, med) => median(values.map((value) => Math.abs(value - med))) / med;

const percentile = (values, ratio) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
    return sorted[index];
};

// 개선 후 구현은 호출 1회가 타이머 분해능보다 짧습니다. 구현마다 반복 횟수를 따로
// 보정해 표본을 같은 측정 창(약 4ms)에 넣고, 표본을 반복 횟수로 나눠 호출 1회 시간을
// 비교합니다. 반복 횟수는 구현별로 다르지만 비교 지표는 호출 1회 시간입니다.
const MEASUREMENT_TARGET_MS = 4;
const MEASUREMENT_MAX_ITERATIONS = 512;

const measureOnce = (run, repetitions) => {
    const samples = [];
    for (let index = 0; index < repetitions; index += 1) {
        const startedAt = performance.now();
        run();
        samples.push(performance.now() - startedAt);
    }
    return samples;
};

const calibrateIterations = (run) => {
    for (let index = 0; index < 5; index += 1) run();
    const med = median(measureOnce(run, 5));
    return Math.max(1, Math.min(MEASUREMENT_MAX_ITERATIONS, Math.round(MEASUREMENT_TARGET_MS / med)));
};

const measure = (run, iterations, repetitions) => {
    for (let index = 0; index < 5; index += 1) run();
    const samples = measureOnce(() => {
        for (let inner = 0; inner < iterations; inner += 1) run();
    }, repetitions).map((value) => value / iterations);
    const med = median(samples);
    return { medianMs: med, p95Ms: percentile(samples, 0.95), madRelative: madRelative(samples, med) };
};

const BUDGETS = {
    absolute: {
        sweepP95MsMax: 250,
        rule: '한 번의 중복 제거 호출 p95는 250ms 이하여야 합니다.',
    },
    relative: {
        minMedianSpeedup: 2,
        rule: '중앙값 기준 2배 이상 빨라져야 개선으로 인정합니다.',
    },
    noise: {
        madRelativeMax: 0.15,
        repetitions: 21,
        rule: '각 구현의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    },
};

const REPETITIONS = BUDGETS.noise.repetitions;
const MEASUREMENTS = [];

let equivalence = 'identical';
let mismatches = 0;

for (const size of [300, 1000, 2000, 4000]) {
    const rows = buildFixture(size, 20260921 + size);
    const beforeIds = dedupeOriginal(rows).map((row) => row.id);
    const afterIds = dedupeHomeMapRestaurants(rows).map((row) => row.id);
    const sameLength = beforeIds.length === afterIds.length;
    const sameOrder = sameLength && beforeIds.every((id, index) => id === afterIds[index]);

    if (!sameOrder) {
        equivalence = 'divergent';
        mismatches += Math.abs(beforeIds.length - afterIds.length);
    }

    const beforeIterations = calibrateIterations(() => dedupeOriginal(rows));
    const afterIterations = calibrateIterations(() => dedupeHomeMapRestaurants(rows));
    const before = measure(() => dedupeOriginal(rows), beforeIterations, REPETITIONS);
    const after = measure(() => dedupeHomeMapRestaurants(rows), afterIterations, REPETITIONS);

    MEASUREMENTS.push({
        size,
        keptCount: afterIds.length,
        beforeIterations,
        afterIterations,
        beforeMedianMs: Number(before.medianMs.toFixed(3)),
        beforeP95Ms: Number(before.p95Ms.toFixed(3)),
        beforeMadRelative: Number(before.madRelative.toFixed(4)),
        afterMedianMs: Number(after.medianMs.toFixed(3)),
        afterP95Ms: Number(after.p95Ms.toFixed(3)),
        afterMadRelative: Number(after.madRelative.toFixed(4)),
        speedupByMedian: Number((before.medianMs / after.medianMs).toFixed(2)),
        speedupByP95: Number((before.p95Ms / after.p95Ms).toFixed(2)),
    });
}

const largest = MEASUREMENTS[MEASUREMENTS.length - 1];
const absoluteBudgetMet = MEASUREMENTS.every((entry) => entry.afterP95Ms <= BUDGETS.absolute.sweepP95MsMax);
const relativeBudgetMet = MEASUREMENTS.every((entry) => entry.speedupByMedian >= BUDGETS.relative.minMedianSpeedup);
const noiseWithinBudget = MEASUREMENTS.every(
    (entry) => entry.beforeMadRelative <= BUDGETS.noise.madRelativeMax && entry.afterMadRelative <= BUDGETS.noise.madRelativeMax,
);
const combinedRelativeNoise = Number((largest.beforeMadRelative + largest.afterMadRelative).toFixed(4));
const deltaExceedsNoise = largest.speedupByMedian - 1 > combinedRelativeNoise;

const report = {
    generatedAt: new Date().toISOString(),
    baselineSource: {
        file: 'apps/web/performance/home-map-swipe-dedupe-20260921/benchmark-home-map-swipe-dedupe.mjs',
        note: '이전 경로는 근사가 아니라 추출 직전 구현을 이 스크립트 안에 동결한 사본입니다.',
    },
    workload: {
        sizes: MEASUREMENTS.map((entry) => entry.size),
        duplicateRatio: 0.4,
        sameNameClusterRatio: 0.25,
        mergedEveryNth: 5,
        repetitions: REPETITIONS,
        measurementTargetMs: MEASUREMENT_TARGET_MS,
        iterationRule: '구현마다 반복 횟수를 보정해 표본을 약 4ms 창에 넣고, 표본을 반복 횟수로 나눠 호출 1회 시간을 비교합니다.',
    },
    equivalence,
    mismatches,
    budgets: BUDGETS,
    measurements: MEASUREMENTS,
    acceptance: {
        absoluteBudgetMet,
        relativeBudgetMet,
        noiseWithinBudget,
        combinedRelativeNoise,
        relativeImprovement: Number((largest.speedupByMedian - 1).toFixed(2)),
        deltaExceedsNoise,
        accepted: absoluteBudgetMet && relativeBudgetMet && noiseWithinBudget && deltaExceedsNoise && equivalence === 'identical',
    },
    ratio: {
        largestSize: largest.size,
        speedupByMedian: largest.speedupByMedian,
        speedupByP95: largest.speedupByP95,
    },
};

const outputPath = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
