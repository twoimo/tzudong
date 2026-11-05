import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
    testDir: '../..',
    testMatch: /insights-treemap-refetch-ui\.spec\.ts$/,
    reporter: 'line',
    outputDir: join(tmpdir(), 'tzudong-insights-treemap-playwright-results'),
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
});
