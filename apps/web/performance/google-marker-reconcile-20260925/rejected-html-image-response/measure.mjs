import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { chromium } from '@playwright/test';

assert.equal(process.versions.node.split('.')[0], '24', 'Use the project Node 24 runtime');
const root = new URL('./', import.meta.url);
const app = fileURLToPath(new URL('../../', root));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const baselineSource = await readFile(new URL('baseline-MapView.tsx.txt', root), 'utf8');
const start = baselineSource.indexOf('  // [마커 관리]');
const bodyStart = baselineSource.indexOf('useEffect(() => {', start) + 'useEffect(() => {'.length;
const bodyEnd = baselineSource.indexOf('  // Selection IDs are applied', bodyStart);
assert.ok(start >= 0 && bodyEnd > bodyStart);
const baselineModule = `
import { getRestaurantLatLng } from '../../lib/map-view-google-helpers';
import { getMapViewMarkerIcon } from '../../lib/map-view-helpers';
import { buildMapViewMarkerHtml, getMapViewMarkerSize, isMapViewMarkerSelected } from '../../lib/map-view-marker-helpers';
export function baselineUpdate({ previous, restaurants, Marker, map, onActivate }) {
 const markersRef = {current: previous}, restaurantsToShow = restaurants;
 const googleMapRef = {current: map}, isLoaded = true;
 const google = {maps: {marker: {AdvancedMarkerElement: Marker}}};
 const searchedRestaurant = null, selectedRestaurant = null;
 const onMarkerClick = onActivate, onRestaurantSelect = undefined;
 const moveToRestaurant = () => {}, setHasGoogleRuntimeError = () => {};
 ${baselineSource.slice(bodyStart, bodyEnd)}
 return markersRef.current;
}
`;
await writeFile(new URL('baseline-effect.mjs', root), ts.transpileModule(baselineModule, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
await writeFile(new URL('browser-entry.mjs', root), `
export { baselineUpdate } from './baseline-effect.mjs';
export { reconcileMapViewMarkers } from '../../lib/map-view-marker-reconciliation';
`);
execFileSync('bun', ['build', fileURLToPath(new URL('browser-entry.mjs', root)), '--target=browser', '--format=esm',
    `--outfile=${fileURLToPath(new URL('browser-bundle.mjs', root))}`], { cwd: app, stdio: 'pipe' });
const bundle = await readFile(new URL('browser-bundle.mjs', root), 'utf8');
const browser = await chromium.launch({ headless: true });
const samples = [];
const scenarios = ['same-list-new-array', 'ten-percent-turnover', 'coordinate-updates', 'full-turnover'];
const pairs = 31, iterations = 10, size = 200;
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('http://127.0.0.1/**', (route) => route.fulfill({
        headers: { 'Content-Type': 'text/html', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
        body: '<!doctype html><meta charset="utf-8"><title>Google marker DOM reconciliation laboratory</title><style>.custom-marker{position:absolute}.custom-marker img{width:32px;height:32px}</style>',
    }));
    await page.goto('http://127.0.0.1/');
    await page.evaluate(async (code) => {
        const { baselineUpdate, reconcileMapViewMarkers } = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(code))));
        const makeRestaurant = (id, index) => ({ id, name: `Restaurant ${id}`, lat: 35 + index / 10000, lng: 126 + index / 10000, categories: ['한식'] });
        const fixture = (variant, count) => {
            const container = document.createElement('div');
            document.body.append(container);
            const stats = { created: 0, detached: 0, moved: 0 };
            const map = { container };
            class Marker {
                constructor({ map, content, position, title }) {
                    this.content = content; this.title = title; this._map = map;
                    this.position = position; map.container.append(content); stats.created++;
                }
                set map(value) { this._map = value; if (!value) { this.content.remove(); stats.detached++; } }
                get map() { return this._map; }
                set position(value) { this._position = value; this.content.style.transform = `translate(${(value.lng - 126) * 10000 % 1300}px,${(value.lat - 35) * 10000 % 800}px)`; stats.moved++; }
                get position() { return this._position; }
            }
            let entries = [], fail = false;
            const update = (restaurants, onActivate = () => {}) => {
                if (variant === 0) entries = baselineUpdate({ previous: entries, restaurants, Marker, map, onActivate });
                else entries = reconcileMapViewMarkers({ previous: entries, restaurants, onActivate,
                    createMarker: (options) => fail ? null : new Marker({ ...options, map }),
                });
                return entries;
            };
            const restaurants = Array.from({ length: count }, (_, index) => makeRestaurant(`r${index}`, index));
            update(restaurants);
            const reset = () => { stats.created = 0; stats.detached = 0; stats.moved = 0; };
            reset();
            return { container, stats, update, restaurants, reset, setFail: (value) => { fail = value; }, dispose: () => container.remove() };
        };
        globalThis.checkMarkers = () => {
            let checks = 0;
            const check = (condition, label) => { if (!condition) throw new Error(label); checks++; };
            const f = fixture(1, 3);
            let entries = f.update(f.restaurants);
            const first = entries[0], image = first.marker.content.querySelector('img');
            entries = f.update(f.restaurants.map((r) => ({ ...r })));
            check(entries[0] === first, 'retained entry identity');
            check(entries[0].marker.content.querySelector('img') === image, 'retained image identity');
            check(f.stats.created === 0 && f.stats.detached === 0 && f.stats.moved === 0, 'no unchanged provider mutation');
            const replacement = { ...f.restaurants[0], name: 'Refreshed <name>', lat: 36 };
            let clicked;
            f.update([replacement, ...f.restaurants.slice(1)], (r) => { clicked = r; });
            first.marker.content.click();
            check(clicked === replacement, 'click uses newest object and callback');
            check(first.marker.title === replacement.name && image.alt === replacement.name, 'safe in-place name update');
            check(first.marker.position.lat === 36 && f.stats.moved === 1, 'coordinate-only mutation');
            replacement.lat = 37;
            f.update([replacement, ...f.restaurants.slice(1)]);
            check(first.marker.position.lat === 37 && f.stats.moved === 2, 'in-place coordinate mutation');
            f.reset();
            entries = f.update([f.restaurants[1], makeRestaurant('new', 4)]);
            check(entries.length === 2 && f.stats.created === 1 && f.stats.detached === 2, 'bounded membership reconciliation');
            f.reset();
            entries = f.update([{ ...f.restaurants[1], lat: NaN }, makeRestaurant('new', 4), makeRestaurant('new', 4)]);
            check(entries.length === 1 && f.stats.detached === 1, 'invalid coordinates and duplicate IDs');
            entries = f.update([]);
            check(entries.length === 0 && f.container.childElementCount === 0, 'empty list cleanup');
            f.setFail(true); entries = f.update(f.restaurants);
            check(entries.length === 0, 'creation failure not cached');
            f.setFail(false); entries = f.update(f.restaurants);
            check(entries.length === 3, 'creation retry recovery');
            f.dispose();
            const b = fixture(0, 3); b.update(b.restaurants.slice());
            check(b.stats.created === 3 && b.stats.detached === 3, 'baseline reproduces rebuild churn');
            b.dispose();
            return { checks, failures: 0 };
        };
        globalThis.measureMarkers = ({ scenario, variant, size, iterations }) => {
            const f = fixture(variant, size);
            const inputs = Array.from({ length: iterations }, (_, round) => Array.from({ length: size }, (_, index) => {
                if (scenario === 'full-turnover' || (scenario === 'ten-percent-turnover' && index < size / 10)) return makeRestaurant(`new-${round}-${index}`, index);
                const restaurant = { ...f.restaurants[index] };
                if (scenario === 'coordinate-updates') restaurant.lat += (round + 1) / 10000;
                return restaurant;
            }));
            const start = performance.now();
            for (const input of inputs) f.update(input);
            // Include the DOM update's synchronous layout, not only JS dispatch.
            f.container.getBoundingClientRect();
            const totalMs = performance.now() - start;
            const result = { totalMs, ...f.stats, markerCount: f.container.childElementCount };
            f.dispose();
            return result;
        };
    }, bundle);
    const verification = await page.evaluate(() => globalThis.checkMarkers());
    console.log(JSON.stringify({ verification }));
    for (const scenario of scenarios) {
        for (let warmup = 0; warmup < 3; warmup++) for (const variant of [0, 1]) await page.evaluate((input) => globalThis.measureMarkers(input), { scenario, variant, size, iterations });
        for (let sample = 0; sample < pairs; sample++) {
            const order = sample % 2 ? [1, 0] : [0, 1], results = {};
            for (const variant of order) results[variant ? 'candidate' : 'baseline'] = await page.evaluate((input) => globalThis.measureMarkers(input), { scenario, variant, size, iterations });
            assert.equal(results.baseline.markerCount, size); assert.equal(results.candidate.markerCount, size);
            samples.push({ scenario, sample, order, ...results });
        }
        console.log(JSON.stringify({ measured: scenario, pairedSamples: pairs }));
    }
    const raw = {
        scope: 'Chromium DOM laboratory using the real old effect and new helper with a simulated Google marker adapter. Not the live Google SDK, app-page LCP/INP, or production evidence.',
        frozenAt: new Date().toISOString(), environment: { node: process.version, chromium: browser.version(), cpu: cpus()[0]?.model, crossOriginIsolated: await page.evaluate(() => crossOriginIsolated) },
        gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: app, encoding: 'utf8' }).trim(),
        budgets: { absoluteDeltaMs: 0.05, relativeDeltaFraction: 0.05, noiseMadMultiplier: 2 },
        scenarios, size, iterations, pairs, verification, samples,
    };
    await writeFile(new URL('raw.json', root), JSON.stringify(raw, null, 2) + '\n');
    for (const [name, path] of Object.entries({ 'candidate-MapView.tsx.txt': '../../components/map/MapView.tsx', 'candidate-helper.ts.txt': '../../lib/map-view-marker-reconciliation.ts' })) {
        await writeFile(new URL(name, root), await readFile(new URL(path, root)));
    }
    await writeFile(new URL('frozen-tree.patch', root), execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: app }));
    const files = ['baseline-MapView.tsx.txt', 'baseline-effect.mjs', 'browser-entry.mjs', 'browser-bundle.mjs', 'candidate-MapView.tsx.txt', 'candidate-helper.ts.txt', 'frozen-tree.patch', 'raw.json', 'measure.mjs', 'score-and-verify.mjs'];
    const artifacts = {};
    for (const file of files) artifacts[file] = hash(await readFile(new URL(file, root)));
    const map = JSON.stringify({ artifacts }, null, 2) + '\n';
    await writeFile(new URL('artifact-map.json', root), map);
    console.log(JSON.stringify({ artifactMapSha256: hash(map) }));
} finally { await browser.close(); }
