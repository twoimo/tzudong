import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [label, expectedPin] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(expectedPin ?? '', /^[a-f0-9]{64}$/);
const here = new URL('./', import.meta.url), root = new URL(`${label}/`, here);
const hash = value => createHash('sha256').update(value).digest('hex');
const mapBytes = await readFile(new URL('artifact-map.json', root));
assert.equal(hash(mapBytes), expectedPin);
const map = JSON.parse(mapBytes);
for (const [name, entry] of Object.entries(map.artifacts)) {
    assert.match(name, /^[a-z0-9.-]+$/);
    assert.equal(hash(await readFile(new URL(name, root))), entry.sha256, name);
    if (entry.original) assert.equal(hash(await readFile(new URL(entry.original, here))), entry.sha256, `source ${entry.original}`);
}
const raw = JSON.parse(await readFile(new URL('raw.json', root)));
const score = JSON.parse(await readFile(new URL('scored.json', root)));
assert.deepEqual(raw.errors, []);
assert.equal(raw.isolatedTimer, true);
assert.equal(raw.checks.length, 14);
for (const { kind, from, to, result } of raw.checks) {
    const shouldRetain = kind === 'candidate' || from === to || (from === 'pending' && to === 'desktop');
    assert.equal(result.mounts, shouldRetain ? 0 : 200);
    assert.equal(result.unmounts, shouldRetain ? 0 : 200);
    for (const property of ['mapRetained', 'mainRetained', 'selectionRetained', 'focusRetained']) {
        assert.equal(result[property], shouldRetain, `${kind} ${from}->${to} ${property}`);
    }
    assert.equal(result.mainCount, 1);
    assert.equal(result.skeletonCount, 1);
    assert.equal(result.chrome, to === 'mobileOrTablet' ? 'mobile' : to === 'desktop' ? 'desktop' : null);
}
assert.equal(raw.pairs.length, 31);
for (const pair of raw.pairs) {
    assert.equal(pair.baseline.mounts, 200);
    assert.equal(pair.baseline.unmounts, 200);
    assert.equal(pair.candidate.mounts, 0);
    assert.equal(pair.candidate.unmounts, 0);
    for (const property of ['mapRetained', 'mainRetained', 'selectionRetained', 'focusRetained']) {
        assert.equal(pair.candidate[property], true);
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mad = values => median(values.map(value => Math.abs(value - median(values))));
const before = raw.pairs.map(pair => pair.baseline.durationMs), after = raw.pairs.map(pair => pair.candidate.durationMs);
const baselineMs = median(before), candidateMs = median(after), deltaMs = candidateMs - baselineMs;
const noiseMs = 2 * Math.max(mad(before), mad(after));
assert.ok(before.concat(after).every(value => Number.isFinite(value) && value > 0));
assert.deepEqual(score.budgets, { absoluteDeltaMs: 0.05, relativeDeltaFraction: 0.05, noiseMadMultiplier: 2 });
assert.equal(score.baselineMs, baselineMs);
assert.equal(score.candidateMs, candidateMs);
assert.equal(score.absoluteDeltaMs, deltaMs);
assert.equal(score.relativeDeltaPercent, 100 * deltaMs / baselineMs);
assert.equal(score.noiseMs, noiseMs);
assert.equal(score.classification, Math.abs(deltaMs) > Math.max(0.05, baselineMs * 0.05, noiseMs)
    ? deltaMs < 0 ? 'local_improvement' : 'local_regression' : 'below_budget_or_noise');
console.log(JSON.stringify({ verified: true, checks: raw.checks.length, samples: raw.pairs.length, artifactMapSha256: expectedPin }));
