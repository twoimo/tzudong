// 클러스터 카테고리 순환: 매 프레임 rAF와 주기 타이머 비교.
// 실행: bun apps/web/performance/cluster-animation-scheduler-20260924/benchmark-cluster-animation-scheduler.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAME_MS = 1000 / 60;
const INTERVAL_MS = 5000;
const WINDOW_MS = 5000;
const FRAMES = Math.round(WINDOW_MS / FRAME_MS);
const REPETITIONS = 200;

function runFrameLoop(clusterCount) {
    const indices = new Map();
    for (let id = 0; id < clusterCount; id += 1) indices.set(id, 0);
    const listeners = [() => undefined];
    let lastUpdate = 0;
    let updates = 0;
    let wakes = 0;
    for (let frame = 0; frame < FRAMES; frame += 1) {
        wakes += 1;
        const currentTime = frame * FRAME_MS;
        if (currentTime - lastUpdate >= INTERVAL_MS) {
            indices.forEach((index, clusterId) => {
                indices.set(clusterId, index + 1);
            });
            listeners.forEach((listener) => listener());
            lastUpdate = currentTime;
            updates += 1;
        }
    }
    return { wakes, updates };
}

function runIntervalLoop(clusterCount) {
    const indices = new Map();
    for (let id = 0; id < clusterCount; id += 1) indices.set(id, 0);
    const listeners = [() => undefined];
    let updates = 0;
    const ticks = Math.floor(WINDOW_MS / INTERVAL_MS);
    for (let tick = 0; tick < ticks; tick += 1) {
        indices.forEach((index, clusterId) => {
            indices.set(clusterId, index + 1);
        });
        listeners.forEach((listener) => listener());
        updates += 1;
    }
    return { wakes: ticks, updates };
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function measure(run, clusterCount) {
    for (let warm = 0; warm < 5; warm += 1) run(clusterCount);
    const samples = [];
    for (let index = 0; index < REPETITIONS; index += 1) {
        const started = performance.now();
        run(clusterCount);
        samples.push(performance.now() - started);
    }
    const center = median(samples);
    return {
        medianMs: Number(center.toFixed(4)),
        madMs: Number(mad(samples, center).toFixed(4)),
    };
}

const clusterCount = 40;
const frameResult = runFrameLoop(clusterCount);
const intervalResult = runIntervalLoop(clusterCount);
const frameTime = measure(runFrameLoop, clusterCount);
const intervalTime = measure(runIntervalLoop, clusterCount);
const absolute = frameTime.medianMs - intervalTime.medianMs;
const noise = frameTime.madMs + intervalTime.madMs;

const report = {
    generatedAt: new Date().toISOString(),
    model: 'Wake rate falls from 60/s to 1000/intervalMs. At 5000ms that is 300 callbacks per 5s versus 1. Work per wake stays the category-index increment.',
    windowMs: WINDOW_MS,
    intervalMs: INTERVAL_MS,
    frames: FRAMES,
    clusterCount,
    repetitions: REPETITIONS,
    wakes: {
        frameLoop: frameResult.wakes,
        intervalLoop: intervalResult.wakes,
        reduction: frameResult.wakes / Math.max(intervalResult.wakes, 1),
    },
    updates: {
        frameLoop: frameResult.updates,
        intervalLoop: intervalResult.updates,
    },
    time: {
        frameLoop: frameTime,
        intervalLoop: intervalTime,
        absoluteMedianDeltaMs: Number(absolute.toFixed(4)),
        medianSpeedup: Number((frameTime.medianMs / Math.max(intervalTime.medianMs, 0.0001)).toFixed(3)),
        noiseSumMadMs: Number(noise.toFixed(4)),
        improvesBeyondNoise: absolute > noise,
    },
    budgets: {
        absolute: { rule: 'Five seconds of scheduler work should cost less than 1ms of JS.' },
        relative: { minWakeReduction: 60 },
        noise: { rule: 'Median JS improvement must exceed the sum of both MADs.' },
    },
};

const outputPath = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json');
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.time, null, 2));
console.log(JSON.stringify(report.wakes));
