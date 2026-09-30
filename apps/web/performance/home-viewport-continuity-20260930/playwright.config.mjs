import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '../../tests', testMatch: 'home-viewport-continuity.spec.ts', workers: 1, retries: 0,
    outputDir: './route-regression-results', reporter: [['list']],
    projects: [
        { name: 'candidate', use: { baseURL: 'http://localhost:3000' } },
    ],
});
