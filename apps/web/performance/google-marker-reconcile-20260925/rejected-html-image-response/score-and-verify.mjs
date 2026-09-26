import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('./', import.meta.url);
const pin = process.argv[2];
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapBytes = await readFile(new URL('artifact-map.json', root));
assert.equal(hash(mapBytes), pin);
const map = JSON.parse(mapBytes);
for (const [name, expected] of Object.entries(map.artifacts)) {
    assert.match(name, /^[a-zA-Z0-9.-]+$/);
    assert.equal(hash(await readFile(new URL(name, root))), expected, name);
}
for (const [name, live] of Object.entries({ 'candidate-MapView.tsx.txt': '../../components/map/MapView.tsx', 'candidate-helper.ts.txt': '../../lib/map-view-marker-reconciliation.ts' })) {
    assert.equal(hash(await readFile(new URL(live, root))), map.artifacts[name], 'Measured source drift: ' + live);
}
const raw = JSON.parse(await readFile(new URL('raw.json', root), 'utf8'));
assert.equal(raw.verification.failures, 0); assert.ok(raw.verification.checks >= 13);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mad = (values) => { const m = median(values); return median(values.map((value) => Math.abs(value - m))); };
const results = raw.scenarios.map((scenario) => {
    const samples = raw.samples.filter((sample) => sample.scenario === scenario);
    assert.equal(samples.length, raw.pairs);
    samples.forEach((sample, index) => {
        assert.equal(sample.sample, index); assert.deepEqual(sample.order, index % 2 ? [1, 0] : [0, 1]);
        for (const variant of ['baseline', 'candidate']) {
            assert.ok(sample[variant].totalMs > 0 && Number.isFinite(sample[variant].totalMs));
            assert.equal(sample[variant].markerCount, raw.size);
        }
    });
    const b = samples.map((sample) => sample.baseline.totalMs / raw.iterations);
    const c = samples.map((sample) => sample.candidate.totalMs / raw.iterations);
    const baselineMs = median(b), candidateMs = median(c);
    const absoluteReductionMs = baselineMs - candidateMs, relativeReductionPercent = 100 * absoluteReductionMs / baselineMs;
    const noiseMs = raw.budgets.noiseMadMultiplier * Math.max(mad(b), mad(c));
    const admitted = Math.abs(absoluteReductionMs) > Math.max(raw.budgets.absoluteDeltaMs, noiseMs)
        && Math.abs(relativeReductionPercent) > raw.budgets.relativeDeltaFraction * 100;
    const expectedChanged = scenario === 'full-turnover' ? raw.size : scenario === 'ten-percent-turnover' ? raw.size / 10 : 0;
    for (const sample of samples) {
        assert.equal(sample.baseline.created, raw.size * raw.iterations);
        assert.equal(sample.baseline.detached, raw.size * raw.iterations);
        assert.equal(sample.candidate.created, expectedChanged * raw.iterations);
        assert.equal(sample.candidate.detached, expectedChanged * raw.iterations);
    }
    return { scenario, baselineMs, candidateMs, absoluteReductionMs, relativeReductionPercent,
        baselineMadMs: mad(b), candidateMadMs: mad(c), noiseMs,
        baselineCreatesPerUpdate: raw.size, candidateCreatesPerUpdate: expectedChanged,
        baselineDetachesPerUpdate: raw.size, candidateDetachesPerUpdate: expectedChanged,
        classification: admitted ? (absoluteReductionMs > 0 ? 'local_improvement' : 'local_regression') : 'below_budget_or_noise' };
});
const score = { scope: raw.scope, artifactMapSha256: pin, budgets: raw.budgets, verification: raw.verification, results };
if (process.argv[3] === '--verify') assert.deepEqual(JSON.parse(await readFile(new URL('scored.json', root), 'utf8')), score);
else await writeFile(new URL('scored.json', root), JSON.stringify(score, null, 2) + '\n');
console.log(JSON.stringify({ verified: true, ...score }, null, 2));
