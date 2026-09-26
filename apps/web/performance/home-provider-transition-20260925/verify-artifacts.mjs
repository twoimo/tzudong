import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [label, expectedPin] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(expectedPin ?? '', /^[a-f0-9]{64}$/);
const here = new URL('./', import.meta.url);
const root = new URL(`${label}/`, here);
const digest = data => createHash('sha256').update(data).digest('hex');
const bytes = await readFile(new URL('artifact-map.json', root));
assert.equal(digest(bytes), expectedPin, 'detached artifact map pin');
const map = JSON.parse(bytes);
for (const [name, entry] of Object.entries(map.artifacts)) {
    assert.match(name, /^[a-z0-9.-]+$/);
    assert.equal(digest(await readFile(new URL(name, root))), entry.sha256, name);
    if (entry.original?.startsWith('../../')) {
        assert.equal(digest(await readFile(new URL(entry.original, here))), entry.sha256, `current source ${entry.original}`);
    }
}
const raw = JSON.parse(await readFile(new URL('raw.json', root)));
const scored = JSON.parse(await readFile(new URL('scored.json', root)));
assert.equal(raw.errors.length, 0);
assert.ok(raw.checks.length >= 29);
assert.ok(raw.checks.every(check => check.ok === true));
assert.equal(scored.checks, raw.checks.length);
assert.equal(scored.failures, 0);
if (!raw.development) {
    assert.equal(raw.pairs.length, 31);
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const mad = values => median(values.map(value => Math.abs(value - median(values))));
    const before = raw.pairs.map(pair => pair.baseline.durationMs);
    const after = raw.pairs.map(pair => pair.candidate.durationMs);
    for (const pair of raw.pairs) {
        assert.ok(Number.isFinite(pair.baseline.durationMs) && pair.baseline.durationMs >= 0);
        assert.ok(Number.isFinite(pair.candidate.durationMs) && pair.candidate.durationMs >= 0);
        assert.equal(pair.baseline.rowMounts, 200);
        assert.equal(pair.baseline.rowUnmounts, 200);
        assert.equal(pair.candidate.rowMounts, 0);
        assert.equal(pair.candidate.rowUnmounts, 0);
        assert.equal(pair.candidate.inputRetained, true);
        assert.equal(pair.candidate.draftRetained, true);
    }
    assert.equal(scored.baselineMs, median(before));
    assert.equal(scored.candidateMs, median(after));
    assert.equal(scored.absoluteReductionMs, median(before) - median(after));
    assert.equal(scored.relativeReductionPercent, 100 * scored.absoluteReductionMs / median(before));
    assert.equal(scored.noiseMs, 2 * Math.max(mad(before), mad(after)));
    assert.deepEqual(scored.budgets, { absoluteDeltaMs: 0.05, relativeDeltaFraction: 0.05, noiseMadMultiplier: 2 });
    const admitted = Math.abs(scored.absoluteReductionMs) > Math.max(0.05, 0.05 * scored.baselineMs, scored.noiseMs);
    assert.equal(scored.classification, admitted ? scored.absoluteReductionMs > 0 ? 'local_improvement' : 'local_regression' : 'below_budget_or_noise');
}
console.log(JSON.stringify({ verified: true, label, artifactMapSha256: expectedPin, checks: raw.checks.length, samples: raw.pairs.length }));
