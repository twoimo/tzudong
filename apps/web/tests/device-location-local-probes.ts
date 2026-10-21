import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(app, '../../docs/evidence/device-location-direct-20261021-v1');
mkdirSync(output, { recursive: true });
process.env.NIGHTLY_MODE = 'local';
process.env.NIGHTLY_LOCAL_ENV_ONLY = '1';
process.env.PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:18925';
const { loadLocalSupabaseEnvironment } = await import('../scripts/local-supabase-runtime.mjs');
process.env.NEXT_PUBLIC_SUPABASE_URL = loadLocalSupabaseEnvironment().supabaseOrigin;
const { installDeviceLocationMocks, openDeviceLocationPage, readDeviceLocationCounts } = await import('./device-location-helpers');
const baseline = process.argv.includes('--baseline');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const width of baseline ? [497] : [320, 497, 768, 1440]) {
        const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, viewport: { width, height: 951 }, isMobile: width < 1024, hasTouch: width < 1024 });
        const page = await context.newPage();
        const fixture = await installDeviceLocationMocks(page);
        let dialogs = 0;
        page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
        await openDeviceLocationPage(page);
        const button = page.getByRole('button', { name: '현재 위치 보기', exact: true });
        let disclosureFacts;
        if (!baseline) {
            const disclosure = page.locator('#' + await button.getAttribute('aria-describedby'));
            disclosureFacts = await disclosure.evaluate(element => {
                const rect = element.getBoundingClientRect();
                const controls = Array.from(document.querySelectorAll('[data-fixed-control-region="mobile-map-filters"] button, [aria-label="지도 필터 제어"] button'));
                return { visible: rect.width > 0 && rect.height > 0, withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, overlapsFilterButton: controls.some(control => { const other = control.getBoundingClientRect(); return Math.max(rect.left, other.left) < Math.min(rect.right, other.right) && Math.max(rect.top, other.top) < Math.min(rect.bottom, other.bottom); }), pageOverflow: document.documentElement.scrollWidth > innerWidth };
            });
            if (!disclosureFacts.visible || !disclosureFacts.withinViewport || disclosureFacts.overlapsFilterButton || disclosureFacts.pageOverflow) throw new Error(`Disclosure layout failed at ${width}: ${JSON.stringify(disclosureFacts)}`);
            await page.screenshot({ path: path.join(output, `inline-${width}.png`) });
        }
        await button.click();
        if (baseline) {
            await expect.poll(() => dialogs).toBe(1);
            if (dialogs !== 1 || (await readDeviceLocationCounts(page)).getCalls !== 0) throw new Error('Original confirmation not reproduced');
        } else {
            await page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true }).waitFor();
            if (dialogs !== 0 || (await readDeviceLocationCounts(page)).getCalls !== 1) throw new Error('Direct action failed');
        }
        results.push({ width, disclosureFacts, dialogs, readinessCalls: fixture.readinessCalls(), counts: await readDeviceLocationCounts(page) });
        await context.close();
    }
} finally { await browser.close(); }
const receipt = { observedAt: new Date().toISOString(), browser: browser.version(), scope: 'Actual built app; synthetic public city-centre position, local Naver/data fixtures; no real user GPS or browser permission grant', baseline, results };
writeFileSync(path.join(output, baseline ? 'baseline.json' : 'responsive.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
