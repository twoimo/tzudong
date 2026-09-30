import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const expectedHash = process.argv[2];
assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/, 'Pass the artifact-map SHA-256 from the measurement tool output.');
const verifyOnly = process.argv[3] === '--verify';
const root = new URL('./', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapBytes = await readFile(new URL('artifact-map.json', root));
assert.equal(hash(mapBytes), expectedHash, 'Artifact map does not match the external pin');
const map = JSON.parse(mapBytes);
for (const [name, expected] of Object.entries(map.artifacts)) {
    assert.match(name, /^[a-z0-9.-]+$/);
    assert.equal(hash(await readFile(new URL(name, root))), expected, `Artifact changed: ${name}`);
}
const raw = JSON.parse(await readFile(new URL('raw.json', root), 'utf8'));
assert.equal(hash(await readFile(new URL('../../lib/mobile-home-search-selection.ts', root))), raw.source.candidateSha256, 'Current source differs from measured candidate');
assert.equal(map.artifacts['baseline-source.txt'], raw.source.baselineSha256);
assert.equal(map.artifacts['candidate-source.txt'], raw.source.candidateSha256);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mad = (values) => { const center = median(values); return median(values.map((value) => Math.abs(value - center))); };
const results = raw.scenarios.map((scenario) => {
    const pairs = raw.samples.filter((sample) => sample.scenario === scenario.name);
    assert.equal(pairs.length, raw.pairsPerScenario);
    pairs.forEach((pair, index) => {
        assert.equal(pair.sample, index);
        assert.deepEqual(pair.order, index % 2 === 0 ? [0, 1] : [1, 0]);
        assert.equal(pair.baseline.checksum, pair.candidate.checksum);
        for (const variant of ['baseline', 'candidate']) assert.ok(Number.isFinite(pair[variant].totalMs) && pair[variant].totalMs > 0);
    });
    const before = pairs.map((pair) => pair.baseline.totalMs / scenario.iterations);
    const after = pairs.map((pair) => pair.candidate.totalMs / scenario.iterations);
    const baselineMs = median(before), candidateMs = median(after);
    const absoluteReductionMs = baselineMs - candidateMs;
    const relativeReduction = absoluteReductionMs / baselineMs;
    const noiseMs = raw.budgets.noiseMadMultiplier * Math.max(mad(before), mad(after));
    const exceedsBudgets = Math.abs(absoluteReductionMs) > Math.max(raw.budgets.absoluteDeltaMs, noiseMs)
        && Math.abs(relativeReduction) > raw.budgets.relativeDeltaFraction;
    return {
        scenario: scenario.name, pairedSamples: pairs.length, baselineMs, candidateMs,
        absoluteReductionMs, relativeReductionPercent: relativeReduction * 100,
        baselineMadMs: mad(before), candidateMadMs: mad(after), noiseMs,
        classification: exceedsBudgets ? (absoluteReductionMs > 0 ? 'local_improvement' : 'local_regression') : 'below_budget_or_noise',
    };
});
const score = { scope: raw.scope, artifactMapSha256: expectedHash, budgets: raw.budgets, equivalenceCases: raw.equivalenceCases, results };
if (verifyOnly) assert.deepEqual(JSON.parse(await readFile(new URL('scored.json', root), 'utf8')), score);
else await writeFile(new URL('scored.json', root), JSON.stringify(score, null, 2) + '\n');
console.log(JSON.stringify({ verified: true, ...score }, null, 2));
