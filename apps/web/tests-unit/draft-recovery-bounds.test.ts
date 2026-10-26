import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Keep the IDB mock out of the shared unit runner and its other store fixtures.
if (process.env.TZUDONG_DRAFT_RECOVERY_BOUNDS_WORKER === '1') {
    await import('./fixtures/draft-recovery-bounds-cases');
} else {
    test('draft recovery and submit bounds pass their twelve isolated store cases', () => {
        const result = spawnSync(process.execPath, ['test', import.meta.path], {
            env: { ...process.env, TZUDONG_DRAFT_RECOVERY_BOUNDS_WORKER: '1' },
            encoding: 'utf8', timeout: 30_000,
        });
        expect(result.status, result.stderr).toBe(0);
    }, 35_000);
}
