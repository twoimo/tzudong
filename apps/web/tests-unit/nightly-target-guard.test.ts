import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const appRoot = resolve(import.meta.dir, '..');

// run-unit-tests.mjs discovers this Bun wrapper. The actual admission suite needs
// Node 24's experimental VM modules; never import the runner into Bun or silently
// skip the suite. Honor the existing Nightly supervisor binding, otherwise use
// the Node executable installed on PATH by the unit CI job.
test('Nightly target guard runs its offline whole-module suite under Node 24', () => {
  const selected = process.env.TZUDONG_NODE24_EXECUTABLE?.trim() || Bun.which('node');
  if (!selected || !isAbsolute(selected)) {
    throw new Error('NIGHTLY_TARGET_GUARD_NODE24_REQUIRED: bind TZUDONG_NODE24_EXECUTABLE to an absolute Node 24 path');
  }
  const executable = realpathSync(selected);
  const options = {
    cwd: appRoot,
    // No inherited credentials, env-file selectors or NODE_OPTIONS reach Node.
    env: {},
    encoding: 'utf8' as const,
    shell: false,
    maxBuffer: 1024 * 1024,
  };
  const version = spawnSync(executable, ['-p', 'process.versions.node'], {
    ...options, timeout: 3_000,
  });
  if (version.error || version.status !== 0 || !/^24\.\d+\.\d+\s*$/.test(version.stdout ?? '')) {
    throw new Error('NIGHTLY_TARGET_GUARD_NODE24_REQUIRED: selected executable must report Node 24');
  }
  const result = spawnSync(executable, [
    '--experimental-vm-modules', '--test', '--test-reporter=tap',
    'scripts/__tests__/nightly-target-guard.test.mjs',
  ], { ...options, timeout: 10_000 });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`NIGHTLY_TARGET_GUARD_OFFLINE_SUITE_FAILED\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  const output = result.stdout;
  const count = Number(output.match(/^# tests (\d+)$/m)?.[1]);
  expect(count).toBeGreaterThanOrEqual(49);
  expect(output).toMatch(new RegExp(`^# pass ${count}$`, 'm'));
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
  expect(output).toMatch(/^# cancelled 0$/m);
  for (const suite of ['unit', 'e2e', 'all']) {
    for (const failure of ['production-target', 'production-hostname', 'missing-nine']) {
      expect(output).toMatch(new RegExp(`^ok \\d+ - whole module ${suite}: ${failure}, validateOnly=false$`, 'm'));
    }
    for (const mutation of ['bypassed Hosted dispatcher', 'removed guard import']) {
      expect(output).toMatch(new RegExp(`^ok \\d+ - mutation self-check ${suite}: ${mutation} fails admission assertions$`, 'm'));
    }
  }
}, 15_000);
