import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const source = path.resolve(process.argv[2]);
const runId = process.argv[3];
const api = await import(pathToFileURL(source).href);
const rows = () => Array.from({ length: 735 }, (_, index) => ({
  id: `fixture-${index}`, name: `fixture-${index}`, lat: 37 + index * 0.0003,
  lng: 126 + index * 0.0004, category: ['한식'],
}));
const same = (a, b) => a.id === b.id
  || [a.id, ...(a.mergedRestaurants ?? []).map(x => x.id)].some(id => [b.id, ...(b.mergedRestaurants ?? []).map(x => x.id)].includes(id))
  || (a.name === b.name && Math.abs((a.lat || 0) - (b.lat || 0)) < 0.0001 && Math.abs((a.lng || 0) - (b.lng || 0)) < 0.0001);
const reference = (visible, all, search) => {
  const unique = items => items.filter((row, index) => !items.slice(0, index).some(prior => same(prior, row)));
  const list = unique(visible);
  const ordered = [...list.filter(x => same(x, search)), ...list.filter(x => !same(x, search))];
  if (ordered.length !== 1) return ordered;
  let nearest = null;
  let distance = Infinity;
  for (const row of unique(all)) {
    if (same(row, ordered[0])) continue;
    const d = ((search.lat - row.lat) * 111) ** 2 + ((search.lng - row.lng) * 88) ** 2;
    if (Number.isFinite(d) && d < distance) { nearest = row; distance = d; }
  }
  return nearest ? [...ordered, nearest] : ordered;
};
const median = values => { const sorted = [...values].sort((a, b) => a - b); const m = sorted.length >> 1; return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; };
let resolution = Infinity;
for (let i = 0; i < 10000; i += 1) { const a = performance.now(); const b = performance.now(); if (b > a) resolution = Math.min(resolution, b - a); }
const results = [];
for (const spec of [{ name: 'order8', queries: 8 }, { name: 'order128', queries: 128 }, { name: 'unchanged-order128', queries: 128, external: true }, { name: 'fallback8', queries: 8, fallback: true }, { name: 'fallback128', queries: 128, fallback: true }]) {
  const all = rows();
  const visible = spec.fallback ? [all[0]] : all;
  const searches = Array.from({ length: spec.queries }, (_, index) => spec.external
    ? { id: `external-${index}`, name: `external-${index}`, lat: 40, lng: 130 }
    : { ...all[(index * 37 + 1) % all.length], id: `search-${index}` });
  const call = search => api.buildPostSearchSwipeCandidates({ visibleRestaurants: visible, allRestaurants: all, activeSearchedRestaurant: search });
  const firstStart = performance.now();
  for (const search of searches) call(search);
  const firstTraversalMs = performance.now() - firstStart;
  for (let warm = 0; warm < 2; warm += 1) for (const search of searches) call(search);
  let mismatches = 0;
  for (const search of searches) {
    if (call(search).map(x => x.id).join(',') !== reference(visible, all, search).map(x => x.id).join(',')) mismatches += 1;
  }
  const builds = api.getLastSwipeOrderBuildCount();
  const scans = api.getNearestFallbackScanCount();
  const samples = [];
  let checksum = 0;
  for (let sample = 0; sample < 32; sample += 1) {
    const start = performance.now();
    for (let sweep = 0; sweep < 32; sweep += 1) for (const search of searches) checksum += call(search).length;
    samples.push(performance.now() - start);
  }
  const calls = 32 * 32 * searches.length;
  const orderMisses = api.getLastSwipeOrderBuildCount() - builds;
  const fallbackMisses = api.getNearestFallbackScanCount() - scans;
  results.push({ ...spec, firstTraversalMs, samplesBatchMs: samples, medianEstimatedCallMs: median(samples) / (32 * searches.length), timerResolutionMs: resolution, batchCalls: 32 * searches.length, totalCalls: calls, orderMisses, orderHits: calls - orderMisses, fallbackMisses, fallbackHits: spec.fallback ? calls - fallbackMisses : null, state: api.getSwipeSelectionCacheState?.(visible, all) ?? null, checksum, mismatches });
}
if (results.some(x => x.mismatches)) throw new Error('fixture_equivalence_failed');
console.log(JSON.stringify({ runId, runtime: { bun: Bun.version, engine: 'JavaScriptCore', platform: process.platform, arch: process.arch }, sourceSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'), results }));
