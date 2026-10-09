import {defineConfig,devices} from '@playwright/test';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const out=dirname(fileURLToPath(import.meta.url));
export default defineConfig({testDir:resolve(out,'../../../tests'),testMatch:'share-read-fallback.spec.ts',workers:1,retries:0,reporter:[['line'],['json',{outputFile:resolve(out,'browser-results.json')}]],outputDir:resolve(out,'browser-output'),use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:19872',trace:'off',screenshot:'off',serviceWorkers:'block',reducedMotion:'reduce',launchOptions:{executablePath:'/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'}}});
