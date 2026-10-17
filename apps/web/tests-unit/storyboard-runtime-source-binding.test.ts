import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

const {
  STORYBOARD_RUNTIME_SOURCE_PATHS,
  calculateStoryboardRuntimeSourceBinding,
} = await import('../lib/admin/storyboard/runtime-source-binding');
const { evaluateStoryboardRuntimePolicy } = await import('../lib/admin/storyboard/runtime-policy');

const repositoryRoot = resolve(import.meta.dir, '../../..');

function copiedSourceRoot() {
  const root = mkdtempSync(join(tmpdir(), 'storyboard-runtime-source-binding-'));
  for (const sourcePath of STORYBOARD_RUNTIME_SOURCE_PATHS) {
    const destination = join(root, sourcePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repositoryRoot, sourcePath), destination);
  }
  return root;
}

test('next config injects the deterministic digest of every declared production execution source', async () => {
  const first = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  const second = calculateStoryboardRuntimeSourceBinding({ repositoryRoot });
  expect(first).toEqual(second);
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(first.sources.map(({ path }) => path)).toEqual([...STORYBOARD_RUNTIME_SOURCE_PATHS]);
  for (const source of first.sources) {
    expect(source.sha256).toBe(createHash('sha256').update(readFileSync(join(repositoryRoot, source.path))).digest('hex'));
  }

  const { default: nextConfig, storyboardRuntimeSourceBinding } = await import('../next.config.mjs');
  expect(storyboardRuntimeSourceBinding).toEqual(first);
  expect(nextConfig.env.STORYBOARD_RUNTIME_SOURCE_BINDING_SHA256).toBe(first.sha256);
});

test('a fallback edit in the real worker path changes both source binding and canonical policy digest', () => {
  const root = copiedSourceRoot();
  try {
    const before = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
    const workerPath = join(root, 'apps/web/scripts/storyboard-gemini-worker.ts');
    writeFileSync(workerPath, `${readFileSync(workerPath, 'utf8')}\n// fixture: non-Gemini fallback branch\n`);
    const after = calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root });
    expect(after.sha256).not.toBe(before.sha256);
    expect(evaluateStoryboardRuntimePolicy(after.sha256).canonicalPolicySha256)
      .not.toBe(evaluateStoryboardRuntimePolicy(before.sha256).canonicalPolicySha256);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('fails closed if a declared execution source is missing', () => {
  const root = copiedSourceRoot();
  try {
    rmSync(join(root, STORYBOARD_RUNTIME_SOURCE_PATHS[0]));
    expect(() => calculateStoryboardRuntimeSourceBinding({ repositoryRoot: root })).toThrow();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
