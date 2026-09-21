import { defineConfig } from '@playwright/test';

// The spec owns a disposable UI harness; no app server, login or real AI calls.
export default defineConfig({
  testDir: './tests',
  testMatch: 'local-storyboard-workspace-ui.spec.ts',
  outputDir: 'test-results/storyboard-ui',
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});
