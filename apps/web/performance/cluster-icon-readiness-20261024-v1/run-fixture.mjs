import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appRoot, baseline, baselineSource, bundleFixture, serveFixture } from './fixture.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = ['lib/cluster-marker.ts', 'lib/category-marker-image-primer.ts', 'components/map/NaverMapView.tsx',
    'performance/cluster-icon-readiness-20261024-v1/fixture.mjs', 'performance/cluster-icon-readiness-20261024-v1/run-fixture.mjs'];
const sourceHashes = Object.fromEntries(files.map(file => [file, hash(readFileSync(resolve(appRoot, file)))]));
const bundles = [await bundleFixture(false), await bundleFixture(true)];
const trials = [];
for (const [width, height] of [[1440, 1000], [390, 844], [820, 1180]]) {
    for (let pair = 0; pair < 6; pair++)
        for (const candidate of (pair % 2 ? [true, false] : [false, true])) {
            // Each trial gets a new browser process/profile, not a user cache clear.
            const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
            try {
                const page = await browser.newPage({ viewport: { width, height } });
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                const network = await serveFixture(page, bundles[Number(candidate)]);
                await page.waitForFunction(() => {
                    const image = document.querySelector('#map img');
                    return image?.complete && image.naturalWidth > 0;
                });
                const initialReadyMs = await page.evaluate(() => performance.now());
                // No candidate-only wait. Both arms expand when the initial image is ready.
                await page.evaluate(() => {
                    const state = { samples: [], done: false };
                    window.measurement = state;
                    function sample() {
                        const start = window.expandedAt;
                        if (start !== undefined) {
                            const images = [...document.querySelectorAll('#map img')].filter(image => { const b = image.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth && b.top < innerHeight && b.bottom > 0; });
                            state.samples.push({ at: performance.now() - start, notReady: images.filter(image => !image.complete || !image.naturalWidth).length, visible: images.length });
                            if (performance.now() - start >= 350) {
                                state.done = true;
                                return;
                            }
                        }
                        requestAnimationFrame(sample);
                    }
                    requestAnimationFrame(sample);
                });
                await page.locator('#expand').click();
                await page.waitForFunction(() => window.measurement.done);
                const result = await page.evaluate(async () => {
                    const state = window.measurement;
                    const start = window.expandedAt;
                    const images = [...document.querySelectorAll('#map img')];
                    const sources = [...new Set(images.map(image => image.currentSrc))];
                    const decodeAfterReady = [];
                    for (const source of sources) {
                        const image = images.find(image => image.currentSrc === source);
                        const t = performance.now();
                        await image.decode();
                        decodeAfterReady.push({ path: new URL(source).pathname, decodePromiseMs: performance.now() - t });
                    }
                    const resources = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/images/maker-images/')).map(entry => { const r = entry; return { path: new URL(r.name).pathname, start: r.startTime, responseEnd: r.responseEnd, relativeResponseEnd: r.responseEnd - start, duration: r.duration, transferSize: r.transferSize }; });
                    const primerPictures = document.querySelectorAll('[data-category-marker-primer] picture').length;
                    window.fixture.dispose();
                    return { ...state, resources, decodeAfterReady, primerPictures, primerAfterDispose: document.querySelectorAll('[data-category-marker-primer]').length, selectedSources: sources.map(source => new URL(source).pathname) };
                });
                trials.push({ width, height, pair, candidate, initialReadyMs, ...result, requests: network.requests, unexpected: network.unexpected, errors, browserVersion: browser.version() });
            }
            finally {
                await browser.close();
            }
        }
    console.log(`Measured ${width}px: 6 baseline/candidate pairs`);
}
writeFileSync(resolve(import.meta.dir, 'baseline-cluster-marker.ts.txt'), baselineSource);
writeFileSync(resolve(import.meta.dir, 'raw.json'), JSON.stringify({ schemaVersion: 'cluster-icon-readiness.local.v1',
    scope: 'Isolated real Chromium picture fixture, controlled 80ms transfer delay. Not SDK, preview, production, field or physical-device evidence.',
    baseline, baselineSourceSha256: hash(baselineSource), sourceHashes, bundleHashes: bundles.map(hash), recordedAt: new Date().toISOString(), trials }, null, 2) + '\n');
