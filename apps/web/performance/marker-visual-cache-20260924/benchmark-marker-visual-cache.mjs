// 개별 마커 HTML: 매번 생성과 동일 입력 캐시 재사용 비교.
// 실행: bun apps/web/performance/marker-visual-cache-20260924/benchmark-marker-visual-cache.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNaverIndividualMarkerVisual } from '../../lib/naver-map-marker-visuals.ts';

const COUNT = 1500;
const REPETITIONS = 21;

function makeRestaurant(index, generation) {
    return {
        id: `marker-${generation}-${index}`,
        categories: [index % 3 === 0 ? '한식' : '카페·디저트'],
        category: [],
        youtube_link: `https://www.youtube.com/watch?v=${String(index).padStart(11, 'a')}`,
        tzuyang_review: index % 2 === 0 ? '리뷰' : null,
        mergedYoutubeLinks: index % 4 === 0 ? ['https://www.youtube.com/watch?v=bbbbbbbbbbb'] : undefined,
        mergedTzuyangReviews: index % 4 === 0 ? ['다른 리뷰'] : undefined,
        mergedRestaurants: index % 4 === 0 ? [{ id: `child-${index}`, youtube_link: 'https://youtu.be/ccccccccccc' }] : undefined,
        source_type: 'geminiCLI',
    };
}

const stable = Array.from({ length: COUNT }, (_, index) => makeRestaurant(index, 'stable'));

function render(restaurants) {
    for (let index = 0; index < restaurants.length; index += 1) {
        getNaverIndividualMarkerVisual(restaurants[index], index === 0);
    }
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mad(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
}

function measure(makeInputs) {
    for (let warm = 0; warm < 2; warm += 1) render(makeInputs(warm));
    const samples = [];
    for (let index = 0; index < REPETITIONS; index += 1) {
        const restaurants = makeInputs(index + 10);
        const started = performance.now();
        render(restaurants);
        samples.push(performance.now() - started);
    }
    const center = median(samples);
    return {
        medianMs: Number(center.toFixed(4)),
        madMs: Number(mad(samples, center).toFixed(4)),
    };
}

const cold = measure((generation) => Array.from({ length: COUNT }, (_, index) => makeRestaurant(index, `cold-${generation}`)));
const warm = measure(() => stable);
const absolute = cold.medianMs - warm.medianMs;
const noise = cold.madMs + warm.madMs;
const first = getNaverIndividualMarkerVisual(stable[0], false);
const second = getNaverIndividualMarkerVisual(stable[0], false);

const report = {
    generatedAt: new Date().toISOString(),
    model: 'Uncached cost is O(n) HTML builds. Cached cost is O(n) map lookups when id, selection, links, and visit inputs are unchanged. Rebuilds happen on every map idle.',
    count: COUNT,
    repetitions: REPETITIONS,
    identity: first === second && first.content.length > 0,
    cold,
    warm,
    absoluteMedianDeltaMs: Number(absolute.toFixed(4)),
    medianSpeedup: Number((cold.medianMs / Math.max(warm.medianMs, 0.0001)).toFixed(3)),
    noiseSumMadMs: Number(noise.toFixed(4)),
    improvesBeyondNoise: absolute > noise,
    budgets: {
        absolute: { frameMs: 16, rule: '1500 marker visuals should rebuild inside one 16ms frame when cached.' },
        relative: { minMedianSpeedup: 2 },
        noise: { rule: 'Median improvement must exceed the sum of both MADs.' },
    },
};

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
    cold,
    warm,
    absoluteMedianDeltaMs: report.absoluteMedianDeltaMs,
    medianSpeedup: report.medianSpeedup,
    improvesBeyondNoise: report.improvesBeyondNoise,
    identity: report.identity,
}, null, 2));
