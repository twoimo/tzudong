// 지도 선택 매칭: 병합 ID includes 스캔과 Set 조회의 비교.
// 실행: bun apps/web/performance/map-restaurant-lookup-20260923/benchmark-map-restaurant-lookup.mjs
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { findMatchingRestaurantInList } from '../../lib/map-restaurant-lookup.ts';

const CANDIDATES = 4000;
const MERGED_PER_TARGET = 8;
const CHILDREN = 4;
const SAMPLES = 31;
const WARMUP = 2;

function hasSameNameAndCoordinate(left, right) {
    return left.name === right.name
        && Math.abs((left.lat || 0) - (right.lat || 0)) < 0.0001
        && Math.abs((left.lng || 0) - (right.lng || 0)) < 0.0001;
}

function findOld(target, candidates) {
    const mergedIds = target.mergedRestaurants.map((restaurant) => restaurant.id);
    return candidates.find((candidate) =>
        mergedIds.includes(candidate.id)
        || candidate.mergedRestaurants?.some((mergedRestaurant) => mergedIds.includes(mergedRestaurant.id))
        || hasSameNameAndCoordinate(candidate, target)
    ) ?? null;
}

const candidates = Array.from({ length: CANDIDATES }, (_, index) => ({
    id: `restaurant-${index}`,
    name: `식당-${index}`,
    lat: 37 + index / 10000,
    lng: 127 + index / 10000,
    mergedRestaurants: Array.from({ length: CHILDREN }, (__, child) => ({
        id: `child-${index}-${child}`,
    })),
}));
const target = {
    id: 'search-target',
    name: '없는 이름',
    lat: 1,
    lng: 1,
    mergedRestaurants: [
        ...Array.from({ length: MERGED_PER_TARGET - 1 }, (_, index) => ({ id: `absent-${index}` })),
        { id: 'child-3999-3' },
    ],
};

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function sample(fn) {
    for (let index = 0; index < WARMUP; index += 1) fn();
    const samples = [];
    for (let index = 0; index < SAMPLES; index += 1) {
        const started = performance.now();
        fn();
        samples.push(performance.now() - started);
    }
    const center = median(samples);
    return {
        medianMs: Number(center.toFixed(3)),
        madMs: Number(mad(samples, center).toFixed(3)),
        samplesMs: samples.map((value) => Number(value.toFixed(3))),
    };
}

const before = sample(() => findOld(target, candidates));
const after = sample(() => findMatchingRestaurantInList(target, candidates));
const oldMatch = findOld(target, candidates)?.id ?? null;
const newMatch = findMatchingRestaurantInList(target, candidates)?.id ?? null;
const ratio = before.medianMs / after.medianMs;
const noise = (before.madMs / before.medianMs) + (after.madMs / after.medianMs);
const report = {
    measuredAt: '2026-09-23',
    machine: 'local',
    workload: {
        candidates: CANDIDATES,
        mergedIds: MERGED_PER_TARGET,
        childrenPerCandidate: CHILDREN,
        samples: SAMPLES,
        warmup: WARMUP,
    },
    budgets: { absoluteMs: 16, relativeMin: 1.3, noiseMadOverMedian: 0.15 },
    identity: { oldId: oldMatch, newId: newMatch, mismatch: oldMatch !== newMatch },
    before,
    after,
    ratio: Number(ratio.toFixed(2)),
    combinedMadOverMedian: Number(noise.toFixed(3)),
    accepted: oldMatch === newMatch && oldMatch === 'restaurant-3999' && after.medianMs < 16 && ratio >= 1.3 && noise <= 0.15,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.accepted) process.exitCode = 2;
