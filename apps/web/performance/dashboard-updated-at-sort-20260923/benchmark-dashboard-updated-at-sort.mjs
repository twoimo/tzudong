// 대시보드 갱신시각 정렬: 비교마다 Date를 파싱하는 방식과 행당 한 번 파싱하는 방식.
// 실행: bun apps/web/performance/dashboard-updated-at-sort-20260923/benchmark-dashboard-updated-at-sort.mjs
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const ROWS = 4000;
const SAMPLES = 21;
const WARMUP = 3;
const rows = Array.from({ length: ROWS }, (_, index) => ({
    id: `row-${index}`,
    updated_at: new Date(1_700_000_000_000 + ((index * 17) % ROWS) * 1000).toISOString(),
}));

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
    };
}

const sortInComparator = () => [...rows].sort((a, b) => {
    const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bMs - aMs;
});
const sortOnce = () => rows
    .map((row) => ({ row, ms: row.updated_at ? new Date(row.updated_at).getTime() : 0 }))
    .sort((left, right) => right.ms - left.ms)
    .map((entry) => entry.row);

const before = sample(sortInComparator);
const after = sample(sortOnce);
const oldOrder = sortInComparator().map((row) => row.id);
const newOrder = sortOnce().map((row) => row.id);
const mismatch = oldOrder.some((id, index) => id !== newOrder[index]);
const ratio = before.medianMs / after.medianMs;
const noise = (before.madMs / before.medianMs) + (after.madMs / after.medianMs);
const report = {
    measuredAt: '2026-09-23',
    machine: 'local',
    workload: { rows: ROWS, samples: SAMPLES, warmup: WARMUP },
    budgets: { absoluteMs: 16, relativeMin: 1.3, noiseMadOverMedian: 0.15 },
    identity: { mismatch },
    before,
    after,
    ratio: Number(ratio.toFixed(2)),
    combinedMadOverMedian: Number(noise.toFixed(3)),
    accepted: !mismatch && after.medianMs < 16 && ratio >= 1.3 && noise <= 0.15,
};
writeFileSync(new URL('./benchmark.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.accepted) process.exitCode = 2;
