import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [label, pin, expectedSha, kind, mode] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
assert.ok(['baseline', 'candidate'].includes(kind));
assert.ok(mode === undefined || mode === '--score');
const root = new URL(`${label}/`, import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(new URL('artifact-map.json', root));
assert.equal(hash(bytes), pin, 'detached map pin');
const map = JSON.parse(bytes);
assert.equal(map.expectedSha, expectedSha);
const allowed = new Set(['raw.json', 'desktop.png', 'mobile.png', '../live-readback.mjs', '../webkit-readback.mjs']);
for (const [name, expected] of Object.entries(map.artifacts)) {
    assert.ok(allowed.has(name), 'bounded artifact path');
    assert.equal(hash(await readFile(new URL(name, root))), expected, name);
}
for (const name of ['raw.json', 'desktop.png', 'mobile.png']) assert.ok(map.artifacts[name]);
assert.equal(Object.keys(map.artifacts).length, 4);
const raw = JSON.parse(await readFile(new URL('raw.json', root)));
assert.equal(raw.expectedSha, expectedSha);
assert.equal(raw.environment.authenticated, false);
assert.match(raw.environment.node, /^v24\./);
assert.equal(raw.results.length, 5);
for (const [index, result] of raw.results.entries()) {
    assert.equal(result.sample, index);
    assert.equal(result.health.ok, true);
    assert.equal(result.health.gitSha, expectedSha);
    assert.equal(result.health.projectId, 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl');
    assert.match(result.health.deploymentId, /^dpl_[a-zA-Z0-9]+$/);
    assert.equal(result.errors.page, 0);
    const o = result.observation;
    for (const metric of ['newMaps', 'firstReadyMs', 'observedFrames', 'markerlessFrames', 'tilelessFrames',
        'missingMapFrames', 'maxGapMs', 'loadedMapImages', 'markerCount', 'mainCount', 'horizontalOverflowPx']) {
        assert.ok(Number.isFinite(o[metric]) && o[metric] >= 0, metric);
    }
    assert.ok(o.observedFrames > 0 && o.loadedMapImages > 0 && o.markerCount > 0);
    assert.equal(o.mainCount, 1);
    assert.equal(o.horizontalOverflowPx, 0);
    assert.equal(o.newMaps, kind === 'baseline' ? 1 : 0);
    assert.equal(o.mapRetained, kind === 'candidate');
    // Desktop detail lives in the control panel; mobile detail lives in the
    // map sheet. Their DOM nodes intentionally differ, even when map state survives.
    assert.equal(o.detailPanelRetained, false, 'layout-specific detail DOM is replaced');
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summaries = {};
for (const metric of ['firstReadyMs', 'markerlessFrames', 'tilelessFrames', 'maxGapMs']) {
    const values = raw.results.map(result => result.observation[metric]);
    const center = median(values);
    summaries[metric] = { median: center, mad: median(values.map(value => Math.abs(value - center))),
        min: Math.min(...values), max: Math.max(...values), classification: 'sequential_observation_only' };
}
const scored = { scope: raw.scope, expectedSha, kind, artifactMapSha256: pin, samples: 5,
    admission: 'Map identity verified; layout-specific detail DOM replacement verified. Selection persistence is covered separately by browser regression. No paired speedup or pixel-level flicker admission.',
    timingBudgets: { absoluteMs: 1, relativeFraction: 0.05, noiseMadMultiplier: 2 }, summaries };
if (mode === '--score') await writeFile(new URL('scored-v2.json', root), JSON.stringify(scored, null, 2) + '\n', { flag: 'wx' });
else assert.deepEqual(JSON.parse(await readFile(new URL('scored-v2.json', root))), scored);
console.log(JSON.stringify({ verified: true, samples: 5, kind, expectedSha, artifactMapSha256: pin,
    scoreSha256: hash(JSON.stringify(scored, null, 2) + '\n') }));
