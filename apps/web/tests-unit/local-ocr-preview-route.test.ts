import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('actual route validates auth, origin, policy, image and native result with isolated synthetic authentication', () => {
  const run = spawnSync(process.execPath, [resolve(import.meta.dir, 'fixtures/local-ocr-preview-route-worker.ts')], {
    cwd: resolve(import.meta.dir, '..'), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NODE_ENV: 'test', NEXT_PUBLIC_SITE_URL: 'http://localhost:18795' },
  });
  expect(run.status).toBe(0);
  const output = JSON.parse(run.stdout);
  expect(output.statuses.unauthenticated).toBe(401);
  expect(output.statuses.crossOrigin).toBe(403);
  expect(output.statuses.disabled).toBe(503);
  expect(output.cloudAvailable).toBe(false);
  if (process.platform === 'darwin') {
    expect(output.statuses.providerInjection).toBe(400);
    expect(output.statuses.invalidImage).toBe(422);
    expect(output.statuses.preview).toBe(200);
    expect(output.actualLocalVision).toBe(true);
  }
}, 35_000);
