import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  testDir: resolve(output, '../../tests'),
  testMatch: 'admin-console-module-hydration.spec.ts',
  metadata: { e2eAdminRouteBypassToken: process.env.E2E_ADMIN_ROUTE_BYPASS_TOKEN },
  workers: 1, retries: 0,
  reporter: [['line'], ['json', { outputFile: resolve(output, 'hydration-run.json') }]],
  outputDir: resolve(output, 'hydration-run-output'),
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:19872', viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'off', launchOptions: { executablePath: '/Users/twoimo/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } },
});
