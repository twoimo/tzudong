import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(output, '../..');
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:18924';
if (new URL(baseUrl).hostname !== '127.0.0.1') throw new Error('Loopback native fixture required');
const files = ['components/map/OverseasMap.tsx', 'lib/overseas-map-loader.ts', 'lib/overseas-map-provider.ts', 'proxy.ts', 'scripts/prepare-maplibre-worker-assets.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(app, file))).digest('hex')]));
const sourceHashes = hashes();
const selectedCases = process.env.OVERSEAS_NATIVE_CASES?.split(',');
const resultName = process.env.OVERSEAS_NATIVE_OUTPUT ?? 'native-results.json';
if (!/^[a-z0-9-]+\.json$/.test(resultName)) throw new Error('Bounded result filename required');
const browser = await chromium.launch({ headless: true });
const results = [], failures = [];

function classify(text) {
    if (/Content Security|violates.*policy|Refused to/.test(text)) return 'csp_block';
    if (/OVERSEAS_MAP_[A-Z_]+/.test(text)) return text.match(/OVERSEAS_MAP_[A-Z_]+/)[0];
    if (/worker/i.test(text)) return 'worker_error';
    return 'browser_error';
}

async function scenario(input, check) {
    if (selectedCases && !selectedCases.includes(input.id)) return;
    const context = await browser.newContext({ viewport: { width: input.width, height: input.height ?? 951 }, isMobile: !!input.mobile, hasTouch: !!input.mobile, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [], resources = [], blocked = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    cdp.on('Network.loadingFailed', event => { if (event.blockedReason) blocked.push(event.blockedReason); });
    page.on('console', message => { if (message.type() === 'error') errors.push(classify(message.text())); });
    page.on('pageerror', error => errors.push(classify(error.message)));
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.hostname === 'tiles.openfreemap.org' || url.pathname.startsWith('/scripts/maplibre/')) {
            resources.push({ path: url.pathname, origin: url.origin, status: response.status(), mime: response.headers()['content-type'], cache: response.headers()['cache-control'] });
        }
    });
    try {
        await page.goto(baseUrl + (input.baseline ? '/?baseline=1' : '/'), { waitUntil: 'domcontentloaded' });
        const value = await check({ page, resources, errors, blocked });
        results.push({ input, ...value, errors, blocked, resources });
    } catch (error) {
        failures.push({ id: input.id, message: error.message });
        results.push({ input, errors, blocked, resources, failed: true });
    } finally {
        await context.close();
    }
}

const open = page => page.getByRole('button', { name: '해외 지도 열기', exact: true }).click();
const ready = page => page.locator('[data-overseas-map-status=ready]').waitFor({ timeout: 15000 });
const facts = page => page.evaluate(() => ({
    state: document.querySelector('[data-overseas-map-status]')?.getAttribute('data-overseas-map-status'),
    attribution: document.querySelector('.maplibregl-ctrl-attrib')?.textContent,
    attributionVisible: !!document.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect().height,
    loadingCover: !!document.querySelector('[aria-label="해외 지도 화면을 준비하고 있어요"]'),
    canvasCount: document.querySelectorAll('.maplibregl-canvas').length,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
}));

try {
    await scenario({ id: 'baseline-497', width: 497, mobile: true, baseline: true }, async ({ page, blocked, errors, resources }) => {
        await open(page);
        await page.getByTestId('map-container').waitFor();
        await page.getByRole('button', { name: '핀 준비 완료' }).click();
        await page.waitForTimeout(3000);
        const state = await facts(page);
        await page.screenshot({ path: path.join(output, resultName === 'native-results.json' ? 'baseline-497.png' : 'baseline-497-followup.png') });
        // Worker security failures may appear only on console rather than the
        // page target's Network.loadingFailed stream. Retain both evidence forms.
        if ((!blocked.includes('csp') && !errors.includes('csp_block')) || resources.some(resource => resource.path === '/styles/positron' && resource.status === 200)) throw new Error('Baseline did not reproduce the observed startup security failure');
        return { facts: state, observationMs: 3000, readiness: 'not_reached_with_observed_csp_failure', evidenceChannel: errors.includes('csp_block') ? 'browser_console' : 'page_network' };
    });

    const samples = [
        ...Array.from({ length: 5 }, (_, index) => ({ id: `mobile-497-${index + 1}`, width: 497, mobile: true })),
        { id: 'mobile-320', width: 320, mobile: true },
        { id: 'mobile-375', width: 375, mobile: true },
        { id: 'tablet-768', width: 768, height: 1024, mobile: true },
        { id: 'tablet-1024', width: 1024, height: 768, mobile: true },
        { id: 'desktop-1440', width: 1440, height: 900 },
    ];
    for (const input of samples) await scenario(input, async ({ page, resources, errors, blocked }) => {
        const start = performance.now();
        await open(page);
        await ready(page);
        const mapReadyMs = Math.round(performance.now() - start);
        const state = await facts(page);
        if (state.loadingCover || state.canvasCount !== 1 || state.pageOverflow || !state.attributionVisible || !/OpenStreetMap/.test(state.attribution) || !/OpenMapTiles/.test(state.attribution)) throw new Error('Map visibility/attribution invariant failed');
        if (!await page.getByText('맛집 핀을 불러오고 있어요', { exact: true }).isVisible()) throw new Error('Pending restaurant-query branch not exercised');
        if (errors.length || blocked.length) throw new Error('Candidate has browser/CSP errors');
        const worker = resources.find(resource => resource.path.endsWith('/maplibre-gl-worker.mjs'));
        const shared = resources.find(resource => resource.path.endsWith('/maplibre-gl-shared.mjs'));
        if (!worker || !shared || worker.status !== 200 || shared.status !== 200 || !worker.mime.includes('javascript')) throw new Error('Worker dependency closure did not load');
        await page.locator('[data-overseas-map-status]').screenshot({ path: path.join(output, input.id + '.png') });
        const canvas = await page.locator('.maplibregl-canvas').elementHandle();
        const styleCount = resources.filter(resource => resource.path === '/styles/positron').length;
        const workerCount = resources.filter(resource => resource.path.endsWith('/maplibre-gl-worker.mjs')).length;
        const countryTile = page.waitForResponse(response => response.url().includes('/11/') && /\/planet\/.*\.pbf/.test(response.url()), { timeout: 10000 });
        await page.getByRole('button', { name: '일본', exact: true }).click();
        await countryTile;
        if (!await canvas.evaluate(node => node.isConnected)) throw new Error('Country switch destroyed the map canvas');
        if (resources.filter(resource => resource.path === '/styles/positron').length !== styleCount || resources.filter(resource => resource.path.endsWith('/maplibre-gl-worker.mjs')).length !== workerCount) throw new Error('Country switch refetched startup resources');
        await page.getByRole('button', { name: '핀 준비 완료' }).click();
        await page.getByText('맛집 핀을 불러오고 있어요', { exact: true }).waitFor({ state: 'hidden' });
        return { mapReadyMs, facts: state, countryCanvasReused: true, mapVisibleWhilePinsPending: true, startupResourceReloadsOnCountrySwitch: 0, absoluteBudgetMs: 5000, withinAbsoluteBudget: mapReadyMs <= 5000 };
    });

    await scenario({ id: 'style-error-retry', width: 497, mobile: true }, async ({ page }) => {
        let attempts = 0;
        await page.route('https://tiles.openfreemap.org/styles/positron', route => ++attempts === 1 ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.continue());
        await open(page);
        await page.locator('[data-overseas-map-status=error]').waitFor();
        const oldCanvas = await page.locator('.maplibregl-canvas').elementHandle();
        await page.getByRole('button', { name: '일본', exact: true }).click();
        const countryTile = page.waitForResponse(response => /\/11\/180[23]\/80[9]\.pbf/.test(response.url()) || /\/11\/180[23]\/810\.pbf/.test(response.url()), { timeout: 15000 });
        await page.getByRole('button', { name: '다시 불러오기', exact: true }).tap();
        await ready(page);
        const countryTileResponse = await countryTile;
        if (await oldCanvas.evaluate(node => node.isConnected)) throw new Error('Retry retained the old canvas');
        const state = await facts(page);
        if (state.canvasCount !== 1 || attempts !== 2) throw new Error('Retry duplicated startup');
        return { facts: state, controlledStyleFailures: 1, retryAttempts: 1, oldCanvasRemoved: true, currentCountryPreserved: '일본(나고야)', countryTilePath: new URL(countryTileResponse.url()).pathname };
    });

    await scenario({ id: 'slow-style-late-success', width: 768, height: 1024, mobile: true }, async ({ page }) => {
        let release;
        const hold = new Promise(resolve => { release = resolve; });
        await page.route('https://tiles.openfreemap.org/styles/positron', async route => { await hold; await route.continue(); });
        await open(page);
        try {
            await page.locator('[data-overseas-map-status=slow]').waitFor({ timeout: 14000 });
            release();
            await ready(page);
        } finally { release(); }
        return { facts: await facts(page), slowNoticeObserved: true, originalRequestCompletedWithoutRetry: true };
    });

    await scenario({ id: 'intent-preload', width: 1440, height: 900 }, async ({ page, resources }) => {
        await page.getByRole('button', { name: '해외 지도 열기', exact: true }).focus();
        await page.waitForLoadState('networkidle');
        if (await page.locator('.maplibregl-canvas').count() || resources.length) throw new Error('Intent preparation mounted/fetched a map');
        await page.getByRole('button', { name: '해외 지도 열기', exact: true }).press('Enter');
        await ready(page);
        return { facts: await facts(page), hiddenMapBeforeActivation: false, providerResourcesBeforeActivation: 0 };
    });
} finally { await browser.close(); }

if (JSON.stringify(sourceHashes) !== JSON.stringify(hashes())) failures.push({ id: 'source-binding', message: 'Source changed during measurement' });
const mobileTimes = results.filter(result => /^mobile-497-\d$/.test(result.input.id) && result.mapReadyMs).map(result => result.mapReadyMs).sort((a, b) => a - b);
const median = values => values.length ? values[Math.floor(values.length / 2)] : null;
const center = median(mobileTimes);
const mad = center === null ? null : median(mobileTimes.map(value => Math.abs(value - center)).sort((a, b) => a - b));
const report = { observedAt: new Date().toISOString(), browser: browser.version(), sourceHashes, network: 'Real OpenFreeMap requests. New isolated context and disabled browser HTTP cache per case; CDN/OS/GPU-process caches and external network variance are not controlled.', scope: 'Pinned Next production fixture, real OverseasMap/MapLibre/CSP and original versus candidate source; only the restaurant query is a controlled empty pending fixture. Not production deployment, field latency or physical-device evidence.', budgets: { absoluteMs: 5000, absoluteNoiseFloorMs: 250, relativeBudget: null, reason: 'Baseline failed CSP/worker startup; no numeric speedup ratio can be inferred.' }, mobile497: { samples: mobileTimes.length, medianMs: center, rangeMs: mobileTimes.length ? [mobileTimes[0], mobileTimes.at(-1)] : [], madMs: mad }, failures, results };
writeFileSync(path.join(output, resultName), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: results.length, failures, mobile497: report.mobile497, outsideBudget: results.filter(result => result.withinAbsoluteBudget === false).map(result => result.input.id) }, null, 2));
if (failures.length) process.exitCode = 1;
