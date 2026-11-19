import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Shared module mocks can replace the real browser client with partial exports.
// Keep the actual search query, React Query state, and transport checks together
// in a fresh process; never weaken them to match a preceding test's client mock.
if (process.env.TZUDONG_SEARCH_RECOVERY_WORKER === '1') {
  await import('./fixtures/restaurant-search-recovery-cases');
} else {
  test('restaurant search recovery passes its isolated real-client cases', () => {
    const result = spawnSync(process.execPath, ['test', import.meta.path], {
      env: { ...process.env, TZUDONG_SEARCH_RECOVERY_WORKER: '1' },
      encoding: 'utf8', timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
  }, 35_000);
}
