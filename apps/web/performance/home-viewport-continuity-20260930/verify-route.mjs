import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [label, pin, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === '--frozen-only');
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
const here = new URL('./', import.meta.url), root = new URL(`${label}/`, here);
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = await readFile(new URL('artifact-map.json', root));
assert.equal(hash(bytes), pin);
const map = JSON.parse(bytes);
for (const [name, entry] of Object.entries(map.artifacts)) {
    assert.match(name, /^[a-z0-9.-]+$/);
    assert.equal(hash(await readFile(new URL(name, root))), entry.sha256, name);
    if (entry.original && mode !== '--frozen-only') assert.equal(hash(await readFile(new URL(entry.original, here))), entry.sha256, `current ${entry.original}`);
}
const raw = JSON.parse(await readFile(new URL('raw.json', root)));
const scored = JSON.parse(await readFile(new URL('scored.json', root)));
assert.equal(raw.pairs.length, 31);
assert.equal(raw.regressionExit, 0);
assert.equal(raw.touch.selectionChanged, true);
assert.equal(raw.touch.nativeChromiumTouch, true);
assert.ok(raw.touch.trustedTouchStarts > 0);
assert.deepEqual(scored.touch, raw.touch);
assert.equal(scored.retainedMapSamples, 31);
for (const pair of raw.pairs) {
    assert.equal(pair.baseline.resize.mapRetained, false);
    assert.equal(pair.baseline.resize.providerRetained, false);
    assert.equal(pair.baseline.resize.newMaps, 1);
    assert.equal(pair.candidate.resize.mapRetained, true);
    assert.equal(pair.candidate.resize.providerRetained, true);
    assert.equal(pair.candidate.resize.newMaps, 0);
    for (const kind of ['baseline', 'candidate']) {
        assert.equal(pair[kind].errors.page, 0, `${kind} page runtime errors`);
        assert.equal(pair[kind].resize.horizontalOverflowPx, 0);
        assert.equal(pair[kind].resize.mainCount, 1);
        assert.ok(pair[kind].resize.observedFrames > 0);
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mad = values => median(values.map(value => Math.abs(value - median(values))));
for (const [metric, result] of Object.entries(scored.scores)) {
    const before = raw.pairs.map(pair => pair.baseline.resize[metric]), after = raw.pairs.map(pair => pair.candidate.resize[metric]);
    assert.ok(before.concat(after).every(value => Number.isFinite(value) && value >= 0));
    const baseline = median(before), candidate = median(after), delta = candidate - baseline;
    const noise = 2 * Math.max(mad(before), mad(after));
    assert.equal(result.baseline, baseline);
    assert.equal(result.candidate, candidate);
    assert.equal(result.absoluteDelta, delta);
    assert.equal(result.relativeDeltaPercent, baseline ? 100 * delta / baseline : null);
    assert.equal(result.noise, noise);
    assert.equal(result.relativeBudget, 0.05);
    assert.equal(result.absoluteBudget, metric.endsWith('Frames') ? 0 : 1);
    assert.equal(result.classification, Math.abs(delta) > Math.max(result.absoluteBudget, baseline * 0.05, noise)
        ? delta < 0 ? 'local_improvement' : 'local_regression' : 'below_budget_or_noise');
}
let fullTreeReceipts = 0;
for (const [kind, receipt] of Object.entries(raw.builds)) {
    const entry = Object.entries(map.artifacts).find(([, artifact]) =>
        new RegExp(`^build-${kind}(?:-[a-z0-9-]+)?/receipt\\.json$`).test(artifact.original ?? ''));
    assert.ok(entry, `retained ${kind} receipt`);
    assert.deepEqual(receipt, JSON.parse(await readFile(new URL(entry[0], root))), `${kind} raw receipt`);
    if (receipt.sourceCommit && receipt.sourceTree) {
        assert.match(receipt.sourceCommit, /^[a-f0-9]{40}$/);
        assert.match(receipt.sourceTree, /^[a-f0-9]{40}$/);
        const repository = process.env.TZUDONG_EVIDENCE_GIT_REPOSITORY ?? fileURLToPath(new URL('../../../../', here));
        const git = args => execFileSync('git', ['-C', repository, ...args]);
        assert.equal(git(['rev-parse', `${receipt.sourceCommit}^{tree}`]).toString().trim(), receipt.sourceTree, `${kind} Git tree`);
        for (const input of receipt.inputs) {
            assert.match(input.original, /^[a-zA-Z0-9/_.-]+$/);
            assert.ok(!input.original.split('/').includes('..'));
            assert.equal(hash(git(['show', `${receipt.sourceCommit}:apps/web/${input.original}`])), input.sha256, `${kind} committed input`);
        }
        fullTreeReceipts++;
    }
    assert.match(receipt.buildId, /^[a-zA-Z0-9_-]+$/);
    assert.match(receipt.sourceSha256, /^[a-f0-9]{64}$/);
    if (receipt.retainedBuildId) {
        assert.equal(receipt.buildId, (await readFile(new URL(receipt.retainedBuildId, here), 'utf8')).trim());
        assert.equal(hash(await readFile(new URL(entry[1].original.replace('receipt.json', 'build.log'), here))), receipt.logSha256, `${kind} build log`);
        for (const input of receipt.inputs) {
            assert.equal(hash(await readFile(new URL(input.retained, here))), input.sha256, input.original);
        }
    }
    // The immutable receipt is pinned by the run's artifact map. Transient
    // untracked .next output is not a prerequisite for a clean-checkout audit.
    if (mode !== '--frozen-only') {
        const source = kind === 'baseline' ? new URL('baseline-home-runtime-shell.tsx.txt', here) : new URL('../../app/home-runtime-shell.tsx', here);
        assert.equal(receipt.sourceSha256, hash(await readFile(source)));
    }
}
console.log(JSON.stringify({ verified: true, samples: raw.pairs.length, retainedMapSamples: 31,
    nativeTouch: raw.touch, fullTreeReceipts, artifactMapSha256: pin }));
