import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyPaths, classifyEvent, classifyCheckout } from './classify-ci-benchmark.mjs';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const pr = { pull_request: { head: { sha: head }, base: { sha: base, ref: 'develop' } } };
const feature = ['apps/web/components/admin/Table.tsx', 'apps/web/app/api/admin/items/route.ts', 'backend/utils/cache.py'];

test('ordinary app/backend changes preserve diagnostics without the benchmark', () => {
  assert.equal(classifyEvent({ eventName: 'pull_request', event: pr, head, changedPaths: feature }).benchmark, false);
  assert.equal(classifyEvent({ eventName: 'push', event: { before: base, after: head }, head, ref: 'refs/heads/develop', changedPaths: feature }).benchmark, false);
});

test('promotion, protected push, scheduled and manual runs always benchmark', () => {
  for (const ref of ['data', 'main']) {
    assert.equal(classifyEvent({ eventName: 'pull_request', event: { pull_request: { ...pr.pull_request, base: { sha: base, ref } } }, head, changedPaths: feature }).reason, 'PROTECTED_PROMOTION');
    assert.equal(classifyEvent({ eventName: 'push', event: { before: base, after: head }, ref: `refs/heads/${ref}`, head, changedPaths: feature }).reason, 'PROTECTED_PUSH');
  }
  for (const eventName of ['schedule', 'workflow_dispatch']) assert.equal(classifyEvent({ eventName, head, changedPaths: feature }).benchmark, true);
});

test('every dependency, toolchain, measurement and CI input requires full proof', () => {
  for (const file of ['.github/workflows/web-admin-ci.yml', '.github/scripts/classify-ci-benchmark.mjs', '.kiro/specs/receipt.json', 'apps/web/package.json', 'apps/web/package-lock.json', 'apps/web/bun.lock', 'apps/web/tsconfig.json', 'apps/web/tsconfig.compat.json', 'apps/web/next.config.ts', 'apps/web/scripts/run-typecheck.mjs', 'apps/web/config/pins.json', 'apps/web/vendor/typescript/a.js', 'apps/web/performance/ts7/report.json', 'apps/web/tests-unit/typecheck-benchmark-source.test.ts', 'backend/package-lock.json', 'backend/requirements.txt', 'go.mod', '.nvmrc']) {
    assert.equal(classifyPaths([...feature, file]).benchmark, true, file);
  }
});

test('uncertain and hostile inputs fail closed', () => {
  for (const paths of [undefined, [], ['new-build-root/runner.mjs'], ['/absolute'], ['apps/web/../package.json'], ['apps\\web\\x.ts'], [null], Array(20_001).fill(feature[0])]) assert.equal(classifyPaths(paths).benchmark, true);
  for (const eventName of ['pull_request_target', 'unknown']) assert.equal(classifyEvent({ eventName, head, event: pr, changedPaths: feature }).benchmark, true);
  assert.equal(classifyEvent({ eventName: 'pull_request', event: pr, head: base, changedPaths: feature }).benchmark, true);
  assert.equal(classifyEvent({ eventName: 'pull_request', event: pr, head: base, changedPaths: feature }).fatal, true);
  assert.equal(classifyEvent({ eventName: 'push', event: { before: base, after: base }, ref: 'refs/heads/develop', head, changedPaths: feature }).fatal, true);
  assert.equal(classifyEvent({ eventName: 'push', event: { before: '0'.repeat(40), after: head }, ref: 'refs/heads/develop', head, changedPaths: feature }).benchmark, true);
  assert.equal(classifyEvent({ eventName: 'pull_request', event: { pull_request: { ...pr.pull_request, base: { sha: '$(whoami)', ref: 'develop' } } }, head, changedPaths: feature }).benchmark, true);
});

test('real Git diff handles branches, deletion/rename, missing history and exact head', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const put = (file) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), 'fixture\n'); };
  const commit = () => { git('add', '.'); git('-c', 'user.name=CI Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-b', 'develop'); put('apps/web/tsconfig.json'); const baseSha = commit();
    put(process.platform === 'win32' ? 'apps/web/components/space name.tsx' : 'apps/web/components/line\nbreak.tsx'); const featureSha = commit();
    const makeEvent = (sha) => ({ pull_request: { head: { sha }, base: { sha: baseSha, ref: 'develop' } } });
    assert.equal(classifyCheckout({ root, eventName: 'pull_request', event: makeEvent(featureSha) }).benchmark, false);
    assert.equal(classifyCheckout({ root, eventName: 'push', ref: 'refs/heads/develop', event: { before: baseSha, after: featureSha } }).benchmark, false);
    assert.equal(classifyCheckout({ root, eventName: 'pull_request', event: makeEvent(baseSha) }).reason, 'SOURCE_MISMATCH');
    assert.equal(classifyCheckout({ root, eventName: 'workflow_dispatch', expectedHead: baseSha }).fatal, true);
    const eventPath = join(root, 'event.json');
    writeFileSync(eventPath, JSON.stringify(makeEvent(baseSha)));
    const mismatch = spawnSync(process.execPath, [fileURLToPath(new URL('./classify-ci-benchmark.mjs', import.meta.url))], { cwd: root, env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: '' }, encoding: 'utf8' });
    assert.equal(mismatch.status, 1);
    assert.deepEqual(JSON.parse(mismatch.stdout), { benchmark: true, reason: 'SOURCE_MISMATCH', fatal: true });
    renameSync(join(root, 'apps/web/tsconfig.json'), join(root, 'apps/web/components/config.txt')); const renamedSha = commit();
    assert.equal(classifyCheckout({ root, eventName: 'pull_request', event: makeEvent(renamedSha) }).benchmark, true);
    assert.equal(classifyCheckout({ root, eventName: 'pull_request', event: { pull_request: { head: { sha: renamedSha }, base: { sha: base, ref: 'develop' } } } }).reason, 'DIFF_UNAVAILABLE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI emits bounded decision outputs and defaults malformed events to full', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-event-'));
  try {
    const eventPath = join(root, 'event.json'); const outputPath = join(root, 'output');
    writeFileSync(eventPath, '{ invalid');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./classify-ci-benchmark.mjs', import.meta.url))], { env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { benchmark: true, reason: 'EVENT_UNAVAILABLE' });
    assert.equal(readFileSync(outputPath, 'utf8'), 'benchmark=true\nreason=EVENT_UNAVAILABLE\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
