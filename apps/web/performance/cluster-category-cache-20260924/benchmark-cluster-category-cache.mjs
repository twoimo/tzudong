// 클러스터 카테고리: 리프 전체 순회와 인덱스 캐시 비교.
// 실행: bun apps/web/performance/cluster-category-cache-20260924/benchmark-cluster-category-cache.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createClusterIndex,
  getClusterCategories,
  restaurantsToGeoJSON,
} from '../../lib/clustering.ts';

function uncachedCategories(index, clusterId) {
  const leaves = index.getLeaves(clusterId, Infinity);
  const categoryCounts = new Map();
  leaves.forEach((leaf) => {
    const category = leaf.properties.category;
    if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });
  return Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => entry[0]);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mad(values, center) {
  return median(values.map((value) => Math.abs(value - center)));
}

const env = await Bun.file('.env.local').text();
const base = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim();
const key = env.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)$/m)[1].trim();
const response = await fetch(`${base}/rest/v1/restaurants?select=id,approved_name,lat,lng,categories&status=eq.approved&limit=2000`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const rows = await response.json();
const restaurants = rows.filter((row) => row.lat != null && row.lng != null).map((row) => ({
  id: row.id,
  name: row.approved_name,
  lat: row.lat,
  lng: row.lng,
  categories: row.categories || ['기타'],
}));
const features = restaurantsToGeoJSON(restaurants);
const index = createClusterIndex(null, { radius: 60, minPoints: 2 }, false);
index.load(features);
const clusters = index.getClusters([124, 33, 132, 39], 7).filter((feature) => feature.properties.cluster);
const ids = clusters.map((feature) => feature.properties.cluster_id);

function time(run) {
  for (let warm = 0; warm < 3; warm += 1) run();
  const samples = [];
  for (let sample = 0; sample < 21; sample += 1) samples.push(run());
  const center = median(samples);
  return { medianMs: Number(center.toFixed(4)), madMs: Number(mad(samples, center).toFixed(4)) };
}

const cold = time(() => {
  const started = performance.now();
  ids.forEach((id) => uncachedCategories(index, id));
  return performance.now() - started;
});
ids.forEach((id) => getClusterCategories(index, id));
const warm = time(() => {
  const started = performance.now();
  ids.forEach((id) => getClusterCategories(index, id));
  return performance.now() - started;
});
const absolute = cold.medianMs - warm.medianMs;
const noise = cold.madMs + warm.madMs;
const same = ids.every((id) => uncachedCategories(index, id).join() === getClusterCategories(index, id).join());
const report = {
  generatedAt: new Date().toISOString(),
  model: 'Each visible cluster used to walk every leaf. Repeat calls on the same index are O(1) after the first count.',
  restaurants: restaurants.length,
  clustersAtZoom7: ids.length,
  repetitions: 21,
  cold,
  warm,
  absoluteMedianDeltaMs: Number(absolute.toFixed(4)),
  medianSpeedup: Number((cold.medianMs / Math.max(warm.medianMs, 0.0001)).toFixed(3)),
  noiseSumMadMs: Number(noise.toFixed(4)),
  improvesBeyondNoise: absolute > noise,
  equivalent: same,
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ clusters: ids.length, cold, warm, speedup: report.medianSpeedup, improvesBeyondNoise: report.improvesBeyondNoise, equivalent: same }));
