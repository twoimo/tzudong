import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const [label, expectedSha] = process.argv.slice(2);
assert.match(label ?? '', /^[a-z0-9-]+$/);
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/);
assert.equal(Number(process.versions.node.split('.')[0]), 24);
const root = new URL('./', import.meta.url);
const output = new URL(`${label}/`, root);
await mkdir(output);
const origin = 'https://www.tzudong.app';
const browser = await chromium.launch({ headless: true });
const results = [], files = ['raw.json'];
const scope = 'Five isolated anonymous Chromium production visits with the real Naver SDK and catalog. Before/after groups are sequential, not alternating paired performance evidence. Image and DOM predicates are observations, not field INP/LCP or physical-device evidence.';
const classifyConsole = text => text.includes('Failed to load resource') ? 'resource_load_failure'
    : /hydration|Hydration/.test(text) ? 'hydration_error' : 'other_console_error';
try {
    for (let sample = 0; sample < 5; sample++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true, locale: 'ko-KR' });
        const page = await context.newPage();
        const errors = { page: 0, console: {} }, failedResources = {};
        page.on('pageerror', () => errors.page++);
        page.on('console', message => {
            if (message.type() !== 'error') return;
            const code = classifyConsole(message.text());
            errors.console[code] = (errors.console[code] ?? 0) + 1;
        });
        page.on('requestfailed', request => {
            const url = new URL(request.url());
            const group = url.origin === origin ? 'application' : /naver|pstatic/.test(url.hostname) ? 'map_provider'
                : /supabase/.test(url.hostname) ? 'persistence' : 'external';
            const key = `${group}:${request.resourceType()}`;
            failedResources[key] = (failedResources[key] ?? 0) + 1;
        });
        try {
            const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
            assert.equal(response.status(), 200);
            const health = await page.evaluate(async () => {
                const d = await (await fetch('/api/health')).json();
                return { ok: d.ok, gitSha: d.gitSha, deploymentId: d.deploymentId, projectId: d.projectId };
            });
            assert.equal(health.gitSha, expectedSha);
            assert.equal(health.projectId, 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl');
            await page.waitForFunction(() => {
                const map = document.querySelector('[data-testid="map-container"]');
                return window.naver?.maps?.Map && map && Array.from(map.querySelectorAll('img')).some(i => i.complete && i.naturalWidth > 0)
                    && document.querySelector('.cluster-marker-container,[data-testid="marker"]');
            }, null, { timeout: 45000 });
            const popular = page.getByRole('button', { name: /인기 맛집 상세 보기/ }).first();
            await expect(popular).toBeVisible({ timeout: 30000 });
            await popular.click();
            await expect(page.getByTestId('restaurant-detail-panel')).toBeVisible();
            // Let the selected restaurant's map animation finish before this observation.
            await page.waitForTimeout(600);
            if (sample === 0) {
                await page.screenshot({ path: new URL('desktop.png', output).pathname });
                files.push('desktop.png');
            }
            await page.evaluate(() => {
                const map = document.querySelector('[data-testid="map-container"]');
                const panel = document.querySelector('[data-testid="restaurant-detail-panel"]');
                const state = { map, panel, newMaps: 0, firstReadyMs: null, frames: 0, markerlessFrames: 0,
                    tilelessFrames: 0, missingMapFrames: 0, maxGapMs: 0, done: false };
                window.__liveReadback = state;
                const Original = window.naver.maps.Map;
                window.naver.maps.Map = new Proxy(Original, { construct(target, args) {
                    state.newMaps++;
                    return Reflect.construct(target, args);
                } });
                const frame = time => {
                    if (innerWidth < 1280) {
                        state.firstFrame ??= time;
                        state.frames++;
                        const current = document.querySelector('[data-testid="map-container"]');
                        const marker = !!document.querySelector('.cluster-marker-container,[data-testid="marker"]');
                        const tile = current && Array.from(current.querySelectorAll('img')).some(i => i.complete && i.naturalWidth > 0);
                        if (!current) state.missingMapFrames++;
                        if (!marker) state.markerlessFrames++;
                        if (!tile) state.tilelessFrames++;
                        if (marker && tile && document.querySelector('[data-testid="bottom-nav"]') && state.firstReadyMs === null) {
                            state.firstReadyMs = performance.now() - state.started;
                        }
                        if (state.previous !== undefined) state.maxGapMs = Math.max(state.maxGapMs, time - state.previous);
                        state.previous = time;
                        if (time - state.firstFrame >= 1000) state.done = true;
                    }
                    if (!state.done) requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
                state.started = performance.now();
            });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForFunction(() => window.__liveReadback.done, null, { timeout: 15000 });
            const observation = await page.evaluate(() => {
                const s = window.__liveReadback;
                const map = document.querySelector('[data-testid="map-container"]');
                return { newMaps: s.newMaps, firstReadyMs: s.firstReadyMs, observedFrames: s.frames,
                    markerlessFrames: s.markerlessFrames, tilelessFrames: s.tilelessFrames, missingMapFrames: s.missingMapFrames,
                    maxGapMs: s.maxGapMs, mapRetained: map === s.map,
                    detailPanelRetained: document.querySelector('[data-testid="restaurant-detail-panel"]') === s.panel,
                    loadedMapImages: map ? Array.from(map.querySelectorAll('img')).filter(i => i.complete && i.naturalWidth > 0).length : 0,
                    markerCount: document.querySelectorAll('.cluster-marker-container,[data-testid="marker"]').length,
                    mainCount: document.querySelectorAll('main#main-content').length,
                    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
            });
            if (sample === 0) {
                await page.screenshot({ path: new URL('mobile.png', output).pathname });
                files.push('mobile.png');
            }
            const finalSha = await page.evaluate(async () => (await (await fetch('/api/health')).json()).gitSha);
            assert.equal(finalSha, expectedSha);
            results.push({ sample, health, observation, errors, failedResources });
            console.log(JSON.stringify({ sample, newMaps: observation.newMaps, mapRetained: observation.mapRetained,
                tilelessFrames: observation.tilelessFrames, markerlessFrames: observation.markerlessFrames }));
        } finally { await context.close(); }
    }
    await writeFile(new URL('raw.json', output), JSON.stringify({ scope, capturedAt: new Date().toISOString(),
        environment: { node: process.version, chromium: browser.version(), authenticated: false }, expectedSha, results }, null, 2) + '\n');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const artifacts = {};
    for (const name of files) artifacts[name] = hash(await readFile(new URL(name, output)));
    artifacts['../live-readback.mjs'] = hash(await readFile(new URL('live-readback.mjs', root)));
    const map = JSON.stringify({ scope, expectedSha, artifacts }, null, 2) + '\n';
    await writeFile(new URL('artifact-map.json', output), map);
    console.log(JSON.stringify({ artifactMapSha256: hash(map), completed: results.length }));
} finally { await browser.close(); }
