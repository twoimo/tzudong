import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Anonymous, read-only observation. No cookies, headers, provider diagnostics,
// response bodies or query strings are retained. This is not a paired benchmark.
const [originValue, label] = process.argv.slice(2);
const origin = new URL(originValue);
if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search
    || origin.username || origin.password || !/^[a-z0-9-]+$/.test(label ?? '')) {
    throw new Error('Usage: node observe-public.mjs <origin> <unique-label>');
}
const root = new URL(`./${label}/`, import.meta.url);
await mkdir(root, { recursive: false });
const browser = await chromium.launch({ headless: true });
const observations = [];
try {
    for (const device of ['desktop', 'mobile']) {
        const context = await browser.newContext({
            viewport: device === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
            isMobile: device === 'mobile', hasTouch: device === 'mobile', locale: 'ko-KR',
        });
        await context.addInitScript(() => {
            const metrics = { lcpMs: null, layoutShiftSum: 0, longTaskCount: 0, longTaskMs: 0,
                firstGoogleMarkerMs: null, googleMarkerFrames: 0, zeroGoogleMarkerFramesAfterFirst: 0,
                observedFrames: 0, frameGapsOver50Ms: 0, maxFrameGapMs: 0 };
            globalThis.__renderObservation = metrics;
            for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
                try {
                    new PerformanceObserver((list) => {
                        for (const entry of list.getEntries()) {
                            if (type === 'largest-contentful-paint') metrics.lcpMs = entry.startTime;
                            if (type === 'layout-shift' && !entry.hadRecentInput) metrics.layoutShiftSum += entry.value;
                            if (type === 'longtask') { metrics.longTaskCount++; metrics.longTaskMs += entry.duration; }
                        }
                    }).observe({ type, buffered: true });
                } catch { /* Unsupported metrics stay unavailable, not fabricated. */ }
            }
            let last;
            const sample = (time) => {
                if (last !== undefined) {
                    const gap = time - last;
                    metrics.maxFrameGapMs = Math.max(metrics.maxFrameGapMs, gap);
                    if (gap > 50) metrics.frameGapsOver50Ms++;
                }
                last = time;
                metrics.observedFrames++;
                if (document.querySelector('.custom-marker')) {
                    if (metrics.firstGoogleMarkerMs === null) metrics.firstGoogleMarkerMs = time;
                    metrics.googleMarkerFrames++;
                } else if (metrics.firstGoogleMarkerMs !== null) metrics.zeroGoogleMarkerFramesAfterFirst++;
                if (!globalThis.__stopRenderObservation) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        for (const route of ['/', '/global-map']) {
            const page = await context.newPage();
            let consoleErrors = 0, pageErrors = 0, failedRequests = 0;
            const responseStatuses = {};
            page.on('console', (message) => { if (message.type() === 'error') consoleErrors++; });
            page.on('pageerror', () => pageErrors++);
            page.on('requestfailed', () => failedRequests++);
            page.on('response', (response) => {
                const status = response.status();
                responseStatuses[status] = (responseStatuses[status] ?? 0) + 1;
            });
            const response = await page.goto(new URL(route, origin).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Fixed observation window, not an inference that providers have settled.
            await page.waitForTimeout(8000);
            const metrics = await page.evaluate(() => {
                globalThis.__stopRenderObservation = true;
                const nav = performance.getEntriesByType('navigation')[0];
                const paint = performance.getEntriesByName('first-contentful-paint')[0];
                const resources = performance.getEntriesByType('resource');
                return { ...globalThis.__renderObservation, observedUntilMs: performance.now(),
                    ttfbMs: nav?.responseStart ?? null, domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
                    fcpMs: paint?.startTime ?? null, resources: resources.length,
                    reportedTransferBytes: resources.reduce((sum, item) => sum + item.transferSize, 0),
                    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
                    googleMarkerNodes: document.querySelectorAll('.custom-marker').length,
                    controls: [...document.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || button.textContent?.trim()).filter(Boolean).slice(0, 24),
                };
            });
            const name = `${device}-${route === '/' ? 'home' : 'global-map'}`;
            const image = await page.screenshot({ path: new URL(`${name}.png`, root).pathname });
            const observation = { device, route, status: response?.status() ?? null,
                consoleErrors, pageErrors, failedRequests, responseStatuses, ...metrics,
                screenshotSha256: createHash('sha256').update(image).digest('hex') };
            observations.push(observation);
            console.log(JSON.stringify(observation));
            await page.close();
        }
        await context.close();
    }
    await writeFile(new URL('observations.json', root), JSON.stringify({
        scope: 'Single anonymous live observation per route/device, fixed 8-second window after DOMContentLoaded. No page improvement, INP, field percentile, or flicker-elimination claim. Cross-origin transfer sizes may be unavailable.',
        origin: origin.origin, observedAt: new Date().toISOString(), chromium: browser.version(), observations,
    }, null, 2) + '\n', { flag: 'wx' });
} finally { await browser.close(); }
