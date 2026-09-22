import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveExpandedClusterRestaurant,
    retainExpandedClusterRestaurantSnapshot,
} from '../../lib/expanded-cluster-restaurant-snapshot.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const repetitions = 31;
const warmup = 3;
const sizes = [4000];
const historicalExtras = [0, 4000, 12000];
const expandedCount = 12;

const row = (id) => ({ id, name: id });

function buildFixture(currentCount, historicalExtra) {
    const byId = new Map();
    const merged = new Map();
    for (let index = 0; index < currentCount; index += 1) {
        const id = `current-${index}`;
        byId.set(id, row(id));
        if (index % 5 === 0) merged.set(`merged-${index}`, row(`parent-${index}`));
    }

    const snapshot = new Map(byId);
    for (const [id, restaurant] of merged) {
        if (!snapshot.has(id)) snapshot.set(id, restaurant);
    }
    for (let index = 0; index < historicalExtra; index += 1) {
        const id = `history-${index}`;
        snapshot.set(id, row(id));
    }

    const expandedIds = [];
    for (let index = 0; index < expandedCount; index += 1) {
        expandedIds.push(historicalExtra > 0 ? `history-${index}` : `current-${index}`);
    }
    const selectedId = historicalExtra > 0 ? `history-${expandedCount}` : `current-${expandedCount}`;
    const forgottenId = historicalExtra > 0 ? `history-${historicalExtra - 1}` : null;
    const probes = [
        `current-0`,
        `merged-0`,
        ...expandedIds,
        selectedId,
    ];

    return { byId, merged, snapshot, expandedIds, selectedId, forgottenId, probes };
}

function projectOld(byId, mergedById, snapshot, expansionActive) {
    const nextById = new Map(byId);
    const nextMerged = new Map(mergedById);
    if (expansionActive) {
        for (const [id, restaurant] of snapshot) {
            if (!nextById.has(id)) nextById.set(id, restaurant);
        }
        for (const [id, restaurant] of snapshot) {
            if (!nextMerged.has(id)) nextMerged.set(id, restaurant);
        }
    }
    return { nextById, nextMerged, entries: nextById.size + nextMerged.size };
}

function lookupOld(projected, id) {
    return projected.nextById.get(id) ?? projected.nextMerged.get(id);
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function sample(run, setup = () => {}) {
    const samples = [];
    for (let index = 0; index < warmup + repetitions; index += 1) {
        setup();
        const started = performance.now();
        run();
        const elapsed = performance.now() - started;
        if (index >= warmup) samples.push(elapsed);
    }
    const center = median(samples);
    return {
        medianMs: Number(center.toFixed(4)),
        madMs: Number(mad(samples, center).toFixed(4)),
        p95Ms: Number(samples.sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1].toFixed(4)),
    };
}

const results = [];
let retainedMismatches = 0;
let forgottenStillResolved = 0;

for (const currentCount of sizes) {
    for (const historicalExtra of historicalExtras) {
        const fixture = buildFixture(currentCount, historicalExtra);
        const oldSnapshot = new Map(fixture.snapshot);
        const oldProjected = projectOld(fixture.byId, fixture.merged, oldSnapshot, true);
        const nextSnapshot = new Map(fixture.snapshot);
        const stats = retainExpandedClusterRestaurantSnapshot(
            nextSnapshot,
            fixture.byId,
            fixture.merged,
            [...fixture.expandedIds, fixture.selectedId],
        );

        for (const id of fixture.probes) {
            const before = lookupOld(oldProjected, id);
            const after = resolveExpandedClusterRestaurant(id, fixture.byId, fixture.merged, nextSnapshot, true);
            if (before !== after) retainedMismatches += 1;
        }
        if (fixture.forgottenId && resolveExpandedClusterRestaurant(fixture.forgottenId, fixture.byId, fixture.merged, nextSnapshot, true)) {
            forgottenStillResolved += 1;
        }

        const retainIds = [...fixture.expandedIds, fixture.selectedId];
        const coldSnapshot = new Map();
        const warmSnapshot = new Map(nextSnapshot);
        const restoreColdSnapshot = () => {
            coldSnapshot.clear();
            for (const [id, restaurant] of fixture.snapshot) coldSnapshot.set(id, restaurant);
        };
        const oldTiming = sample(() => {
            projectOld(fixture.byId, fixture.merged, oldSnapshot, true);
        });
        const coldTiming = sample(() => {
            retainExpandedClusterRestaurantSnapshot(coldSnapshot, fixture.byId, fixture.merged, retainIds);
            for (const id of fixture.probes) {
                resolveExpandedClusterRestaurant(id, fixture.byId, fixture.merged, coldSnapshot, true);
            }
        }, restoreColdSnapshot);
        const warmTiming = sample(() => {
            retainExpandedClusterRestaurantSnapshot(warmSnapshot, fixture.byId, fixture.merged, retainIds);
            for (const id of fixture.probes) {
                resolveExpandedClusterRestaurant(id, fixture.byId, fixture.merged, warmSnapshot, true);
            }
        });
        const ratio = (after) => after.medianMs === 0 ? null : Number((oldTiming.medianMs / after.medianMs).toFixed(2));
        const combinedMad = (after) => oldTiming.medianMs + after.medianMs === 0
            ? 0
            : Number(((oldTiming.madMs + after.madMs) / ((oldTiming.medianMs + after.medianMs) / 2)).toFixed(4));

        results.push({
            currentCount,
            historicalExtra,
            snapshotBefore: fixture.snapshot.size,
            snapshotAfter: stats.retained,
            pruned: stats.pruned,
            oldEntries: oldProjected.entries,
            newEntries: stats.retained,
            probes: fixture.probes.length,
            old: oldTiming,
            cold: coldTiming,
            warm: warmTiming,
            coldRatio: ratio(coldTiming),
            warmRatio: ratio(warmTiming),
            coldCombinedMadRelative: combinedMad(coldTiming),
            warmCombinedMadRelative: combinedMad(warmTiming),
        });
    }
}

const report = {
    generatedAt: new Date().toISOString(),
    claim: 'local-microbenchmark',
    notG003: true,
    absoluteBudgetMs: 16,
    relativeNoiseBudget: 0.15,
    baseline: 'frozen copy of the previous Map clone that inserted every snapshot row into both render maps',
    workload: {
        currentCount: sizes[0],
        historicalExtras,
        expandedCount,
        repetitions,
        warmup,
    },
    retainedMismatches,
    forgottenStillResolved,
    results,
};

mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ retainedMismatches, forgottenStillResolved, results }, null, 2));
