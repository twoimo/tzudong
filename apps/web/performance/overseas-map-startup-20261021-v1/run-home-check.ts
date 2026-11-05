import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalSupabaseEnvironment } from '../../scripts/local-supabase-runtime.mjs';

const output = path.dirname(fileURLToPath(import.meta.url));
const local = loadLocalSupabaseEnvironment({ repositoryRoot: path.resolve(output, '../../../..') });
process.env.NIGHTLY_MODE = 'local';
process.env.NIGHTLY_LOCAL_ENV_ONLY = '1';
process.env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:18925';
process.env.NEXT_PUBLIC_SUPABASE_URL = local.supabaseOrigin;
const { installMobileHomeMapTestMocks } = await import('../../tests/mobile-home-map-helpers');
const browser = await chromium.launch({ headless: true });
const cases: object[] = [];
try {
    for (const width of [497, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 951 }, isMobile: width < 768, hasTouch: width < 768 });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(/hydrat|#418/.test(error.message) ? 'hydration_error' : 'page_error'));
        await installMobileHomeMapTestMocks(page);
        await page.route('**/__local/naver-maps.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.route(`${local.supabaseOrigin}/rest/v1/restaurants*`, route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
        await page.goto(process.env.PLAYWRIGHT_BASE_URL + '/', { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '해외 맛집 지도 보기', exact: true }).click();
        await page.locator('[data-overseas-map-status=ready]').waitFor({ timeout: 20000 });
        const facts = await page.evaluate(() => {
            const element = document.querySelector('.maplibregl-ctrl-attrib')!;
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(Math.min(innerWidth - 1, bounds.right - 5), bounds.top + Math.min(5, bounds.height / 2));
            return { canvasCount: document.querySelectorAll('.maplibregl-canvas').length, attribution: element.textContent, attributionVisible: bounds.height > 0 && bounds.bottom <= innerHeight && !!hit?.closest('.maplibregl-ctrl-attrib'), pageOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        await page.screenshot({ path: path.join(output, `home-${width}.png`) });
        if (facts.canvasCount !== 1 || !facts.attributionVisible || facts.pageOverflow || errors.length) throw new Error(`Home invariant failed at ${width}: ${JSON.stringify({ facts, errors })}`);
        await page.getByRole('button', { name: '국내 맛집 지도 보기', exact: true }).click();
        await page.locator('.maplibregl-canvas').waitFor({ state: 'detached' });
        cases.push({ width, facts, errors, domesticSwitchRemovesOverseasCanvas: true });
        await context.close();
    }
} finally { await browser.close(); }
const receipt = { observedAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual full application build and public home wiring; real MapLibre/OpenFreeMap; local Naver and empty restaurant data fixtures only', cases };
writeFileSync(path.join(output, 'home-results.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
