// 대시보드 영상 ID 추출·재조회 비교.
// 실행: bun apps/web/performance/dashboard-video-id-20260923/benchmark-dashboard-video-id.mjs
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { extractVideoIdFromYoutubeLink } from '../../lib/dashboard/helpers.ts';
import { selectDashboardRowsForVideoId } from '../../lib/dashboard/summary.ts';

const LINKS = 4000;
const REPEAT_PASSES = 6;
const SAMPLES = 11;
const WARMUP = 2;

const links = Array.from({ length: LINKS }, (_, index) => {
    const id = `vid${String(index).padStart(8, '0')}`;
    return `https://www.youtube.com/watch?v=${id}&t=10`;
});

function extractVideoIdOld(link) {
    if (typeof link !== 'string' || link.length === 0) return null;
    const patterns = [
        /[?&]v=([A-Za-z0-9_-]{6,})/,
        /youtu\.be\/([A-Za-z0-9_-]{6,})/,
        /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
        /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
        /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(link);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractVideoIdHoisted(link) {
    if (typeof link !== 'string' || link.length === 0) return null;
    for (const pattern of HOISTED_PATTERNS) {
        const match = pattern.exec(link);
        if (match?.[1]) return match[1];
    }
    return null;
}

const HOISTED_PATTERNS = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/,
];

function scanOld(rows, videoId) {
    const matches = [];
    for (const row of rows) {
        if (extractVideoIdOld(row.youtube_link) === videoId) matches.push(row);
    }
    return matches;
}

const rows = links.map((link, index) => ({
    id: `row-${index}`,
    youtube_link: link,
}));
const targetId = 'vid00002000';

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function sample(fn) {
    for (let i = 0; i < WARMUP; i += 1) fn();
    const samples = [];
    for (let i = 0; i < SAMPLES; i += 1) {
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

let mismatch = 0;
for (const link of links) {
    if (extractVideoIdOld(link) !== extractVideoIdFromYoutubeLink(link)) mismatch += 1;
}

const oldExtract = sample(() => {
    for (let pass = 0; pass < REPEAT_PASSES; pass += 1) {
        for (const link of links) extractVideoIdOld(link);
    }
});
const hoistedExtract = sample(() => {
    for (let pass = 0; pass < REPEAT_PASSES; pass += 1) {
        for (const link of links) extractVideoIdHoisted(link);
    }
});
const cachedExtract = sample(() => {
    for (let pass = 0; pass < REPEAT_PASSES; pass += 1) {
        for (const link of links) extractVideoIdFromYoutubeLink(link);
    }
});

const oldScan = sample(() => {
    for (let pass = 0; pass < REPEAT_PASSES; pass += 1) scanOld(rows, targetId);
});
const indexed = sample(() => {
    for (let pass = 0; pass < REPEAT_PASSES; pass += 1) {
        selectDashboardRowsForVideoId(rows, targetId);
    }
});
const coldScan = sample(() => {
    scanOld(rows, targetId);
});
const coldIndex = sample(() => {
    selectDashboardRowsForVideoId(rows.map((row) => ({ ...row })), targetId);
});

const oldIds = scanOld(rows, targetId).map((row) => row.id);
const newIds = selectDashboardRowsForVideoId(rows, targetId).map((row) => row.id);
const idMismatch = oldIds.length !== newIds.length
    || oldIds.some((id, index) => id !== newIds[index]);

const extractRatio = oldExtract.medianMs / cachedExtract.medianMs;
const hoistRatio = oldExtract.medianMs / hoistedExtract.medianMs;
const scanRatio = oldScan.medianMs / indexed.medianMs;
const extractNoise = (oldExtract.madMs / oldExtract.medianMs) + (cachedExtract.madMs / cachedExtract.medianMs);
const scanNoise = (oldScan.madMs / oldScan.medianMs) + (indexed.madMs / indexed.medianMs);

const report = {
    measuredAt: '2026-09-23',
    machine: 'local',
    workload: {
        links: LINKS,
        repeatPasses: REPEAT_PASSES,
        extractCalls: LINKS * REPEAT_PASSES,
        samples: SAMPLES,
        warmup: WARMUP,
    },
    budgets: {
        absoluteMs: 16,
        relativeMin: 1.3,
        noiseMadOverMedian: 0.15,
    },
    identity: {
        extractMismatches: mismatch,
        scanIdMismatch: idMismatch,
    },
    extract: {
        before: oldExtract,
        hoistedRegex: hoistedExtract,
        cached: cachedExtract,
        cachedRatio: Number(extractRatio.toFixed(2)),
        hoistedRatio: Number(hoistRatio.toFixed(2)),
        combinedMadOverMedian: Number(extractNoise.toFixed(3)),
    },
    videoLookup: {
        before: oldScan,
        after: indexed,
        ratio: Number(scanRatio.toFixed(2)),
        combinedMadOverMedian: Number(scanNoise.toFixed(3)),
        coldSinglePass: {
            before: coldScan,
            after: coldIndex,
            ratio: Number((coldScan.medianMs / coldIndex.medianMs).toFixed(2)),
        },
        note: 'Warm samples reuse one row array, so the WeakMap is built during warmup. Cold samples copy the array every call and include index construction. The warm ratio is a repeat-lookup figure and sits near the timer floor.',
    },
};

const accepted = mismatch === 0
    && !idMismatch
    && cachedExtract.medianMs < 16
    && indexed.medianMs < 16
    && extractRatio >= 1.3
    && scanRatio >= 1.3
    && extractNoise <= 0.15
    && scanNoise <= 0.15;

report.accepted = accepted;
writeFileSync(new URL('./benchmark.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!accepted) process.exitCode = 2;
