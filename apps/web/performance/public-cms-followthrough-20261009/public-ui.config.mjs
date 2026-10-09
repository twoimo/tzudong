import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output = dirname(fileURLToPath(import.meta.url));
const runId = process.env.PUBLIC_UI_RUN_ID ?? 'public-ui';
export default defineConfig({
 testDir: resolve(output, '../../tests'), testMatch:'public-cms-readonly.spec.ts', workers:1, retries:0,
 reporter:[['line'],['json',{outputFile:resolve(output,`${runId}-run.json`)}]], outputDir:resolve(output,`${runId}-run-output`),
 use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:19872',serviceWorkers:'block',reducedMotion:'reduce',trace:'off',screenshot:'off',launchOptions:{executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'}},
});
