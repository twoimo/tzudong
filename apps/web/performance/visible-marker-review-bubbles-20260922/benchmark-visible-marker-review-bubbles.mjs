import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectVisibleMarkerReviewBubbleTargets } from '../../lib/visible-marker-review-bubbles.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const repetitions = 101;
const warmup = 3;
const limit = 5;
const sizes = [200, 1000, 4000];

function hashString(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function relatedIds(restaurant) {
    const ids = new Set();
    if (restaurant.id) ids.add(restaurant.id);
    for (const merged of restaurant.mergedRestaurants ?? []) {
        if (merged.id) ids.add(merged.id);
    }
    return [...ids];
}

function selectOld(restaurants, options) {
    const candidates = restaurants
        .filter((restaurant) => Boolean(restaurant?.id))
        .filter((restaurant) => relatedIds(restaurant).length > 0);
    const reviewed = candidates.filter((restaurant) => (restaurant.review_count ?? 0) > 0);
    const source = reviewed.length > 0 ? reviewed : candidates;
    return source
        .map((restaurant) => ({ restaurant, rank: hashString(`${options.seed}:${restaurant.id}`) }))
        .sort((left, right) => left.rank - right.rank)
        .slice(0, options.limit)
        .map(({ restaurant }) => ({
            restaurantId: restaurant.id,
            relatedRestaurantIds: relatedIds(restaurant),
        }));
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function sample(run) {
    const samples = [];
    for (let index = 0; index < warmup + repetitions; index += 1) {
        const started = performance.now();
        run();
        const elapsed = performance.now() - started;
        if (index >= warmup) samples.push(elapsed);
    }
    const center = median(samples);
    const ordered = [...samples].sort((left, right) => left - right);
    return {
        medianMs: Number(center.toFixed(4)),
        madMs: Number(mad(samples, center).toFixed(4)),
        p95Ms: Number(ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(4)),
    };
}

const results = [];
let mismatches = 0;

for (const size of sizes) {
    const restaurants = Array.from({ length: size }, (_, index) => ({
        id: `restaurant-${index}`,
        review_count: index % 3 === 0 ? 0 : 2,
        mergedRestaurants: index % 11 === 0 ? [{ id: `merged-${index}` }] : undefined,
    }));
    const options = { limit, seed: 'zoom:14:126.9:37.5' };
    const before = selectOld(restaurants, options);
    const after = selectVisibleMarkerReviewBubbleTargets(restaurants, options);
    if (JSON.stringify(before) !== JSON.stringify(after)) mismatches += 1;

    const oldTiming = sample(() => {
        selectOld(restaurants, options);
    });
    const newTiming = sample(() => {
        selectVisibleMarkerReviewBubbleTargets(restaurants, options);
    });
    const combinedMadRelative = oldTiming.medianMs + newTiming.medianMs === 0
        ? 0
        : Number(((oldTiming.madMs + newTiming.madMs) / ((oldTiming.medianMs + newTiming.medianMs) / 2)).toFixed(4));

    results.push({
        size,
        limit,
        mismatches,
        old: oldTiming,
        new: newTiming,
        ratio: newTiming.medianMs === 0 ? null : Number((oldTiming.medianMs / newTiming.medianMs).toFixed(2)),
        combinedMadRelative,
        relatedIdSetsOld: size + limit,
        relatedIdSetsNew: limit,
    });
}

const report = {
    generatedAt: new Date().toISOString(),
    claim: 'local-microbenchmark',
    notG003: true,
    absoluteBudgetMs: 16,
    relativeNoiseBudget: 0.15,
    baseline: 'frozen copy of the previous full sort that built a related-id set for every candidate',
    mismatches,
    results,
};

mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ mismatches, results }, null, 2));
