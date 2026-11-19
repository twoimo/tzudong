import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Keep the IDB mock and frozen clock out of the shared unit runner.
if (process.env.TZUDONG_DRAFT_STORE_DIFFERENCES_WORKER === '1') {
    await import('./fixtures/draft-store-differences-cases');
} else {
    test('review, edit-request and submission draft stores keep their per-store contracts', () => {
        const result = spawnSync(process.execPath, ['test', import.meta.path], {
            env: { ...process.env, TZUDONG_DRAFT_STORE_DIFFERENCES_WORKER: '1' },
            encoding: 'utf8', timeout: 30_000,
        });
        expect(result.status, result.stderr).toBe(0);
    }, 35_000);
}
