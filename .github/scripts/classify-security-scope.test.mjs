import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyPaths, classifyEvent, classifyCheckout, compilePattern } from './classify-security-scope.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const pr = (sha = head, target = 'develop') => ({ pull_request: { head: { sha }, base: { sha: base, ref: target } } });

test('ordinary web and documentation changes do not start unrelated security jobs', () => {
  for (const paths of [['apps/web/components/Map.tsx'], ['README.md', 'docs/operations/example.md'], ['backend/data/example.json']]) {
    assert.deepEqual(classifyPaths(paths), { security: false, reason: 'SECURITY_INPUTS_UNCHANGED', fatal: false });
  }
});

test('retained critical inputs and the new gate select all security checks', () => {
  for (const path of [
    'apps/web/package-lock.json', 'apps/web/bun.lock', 'backend/test-requirements.txt',
    'backend/pipeline/requirements.txt', 'backend/pipeline-control/requirements.txt',
    'backend/supabase/migrations/20261112000000_change.sql',
    'backend/supabase/scripts/local-stack.py', 'backend/utils/privacy_log.py',
    'backend/pipeline_control/worker.py', 'backend/deploy/helm/tzudong-platform/values.yaml',
    '.github/workflows/web-admin-ci.yml', '.github/scripts/classify-ci-scope.mjs',
    '.github/scripts/classify-security-scope.mjs', '.github/scripts/verify-ci-results.mjs',
    '.github/ci-security-paths.json', '.github/scripts/test_ci_audit_budget.py',
    '.kiro/specs/crawler-pipeline-operational-readiness/platform-modernization-reconciliation.v1.json',
    'apps/web/app/api/admin/publish-jobs/route.ts', 'apps/web/scripts/collect-dependency-candidates.mjs',
  ]) assert.equal(classifyPaths([path]).security, true, path);
});

test('every retained trigger pattern has an executable representative', () => {
  const policy = JSON.parse(readFileSync(new URL('../ci-security-paths.json', import.meta.url), 'utf8'));
  for (const pattern of policy.paths) {
    const representative = pattern.replaceAll('**/', 'nested/').replaceAll('**', 'nested/value').replaceAll('*', 'probe').replaceAll('?', 'x');
    assert.equal(compilePattern(pattern).test(representative), true, pattern);
    assert.equal(classifyPaths([representative]).security, true, pattern);
  }
});

test('double-star slash also matches zero directories and single-star stays bounded', () => {
  assert.equal(compilePattern('backend/**/requirements*.txt').test('backend/requirements.txt'), true);
  assert.equal(compilePattern('backend/**/requirements*.txt').test('backend/a/b/requirements-ci.txt'), true);
  assert.equal(compilePattern('backend/*/requirements.txt').test('backend/a/b/requirements.txt'), false);
});

test('unavailable, malformed, unknown and mixed changes cannot produce a skip', () => {
  for (const paths of [undefined, [], Array(20_001).fill('README.md'), [null], ['../README.md'], ['/README.md'], ['a\\b'], ['a\nb'], ['package.json'], ['new-engine/build.sh'], ['README.md', 'backend/pipeline_control/worker.py']]) {
    assert.equal(classifyPaths(paths).security, true);
  }
  for (const policy of [null, {}, { schemaVersion: 1, paths: [] }, { schemaVersion: 1, paths: ['!backend/**'] }]) {
    assert.deepEqual(classifyPaths(['README.md'], policy), { security: true, reason: 'POLICY_INVALID', fatal: true });
  }
});

test('protected promotion, scheduled and manual events retain full security checks', () => {
  for (const target of ['data', 'main']) assert.equal(classifyEvent({ eventName: 'pull_request', event: pr(head, target), head, changedPaths: ['README.md'] }).security, true);
  for (const eventName of ['schedule', 'workflow_dispatch']) assert.equal(classifyEvent({ eventName, event: {}, head, changedPaths: ['README.md'] }).security, true);
  assert.equal(classifyEvent({ eventName: 'push', event: { before: base, after: head }, ref: 'refs/heads/main', head, changedPaths: ['README.md'] }).security, true);
});

test('wrong source is a fatal result', () => {
  assert.equal(classifyEvent({ eventName: 'pull_request', event: pr(), head: base, changedPaths: ['README.md'] }).fatal, true);
  assert.equal(classifyEvent({ eventName: 'push', event: { before: base, after: head }, ref: 'refs/heads/develop', head: base }).fatal, true);
  assert.equal(classifyEvent({ eventName: 'pull_request', event: pr(), head: '0'.repeat(40) }).fatal, true);
});

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'security-scope-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Scope Fixture');
    git(root, 'config', 'user.email', 'scope@example.invalid');
    mkdirSync(join(root, 'backend/pipeline_control'), { recursive: true });
    writeFileSync(join(root, 'backend/pipeline_control/worker.py'), 'pass\n');
    writeFileSync(join(root, 'README.md'), 'baseline\n');
    git(root, 'add', '.'); git(root, 'commit', '-qm', 'baseline');
    fn(root, git(root, 'rev-parse', 'HEAD'));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('exact-source Git diff classifies both sides of a rename away from a protected path', () => fixture((root, before) => {
  renameSync(join(root, 'backend/pipeline_control/worker.py'), join(root, 'notes.md'));
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'rename');
  const after = git(root, 'rev-parse', 'HEAD');
  const event = { pull_request: { head: { sha: after }, base: { sha: before, ref: 'develop' } } };
  assert.equal(classifyCheckout({ root, eventName: 'pull_request', event, ref: 'refs/pull/1/merge', expectedHead: 'c'.repeat(40) }).security, true);
}));

test('known doc diff skips and unavailable history expands safely', () => fixture((root, before) => {
  writeFileSync(join(root, 'README.md'), 'changed\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'docs');
  const after = git(root, 'rev-parse', 'HEAD');
  const event = { pull_request: { head: { sha: after }, base: { sha: before, ref: 'develop' } } };
  assert.equal(classifyCheckout({ root, eventName: 'pull_request', event }).security, false);
  event.pull_request.base.sha = 'f'.repeat(40);
  assert.equal(classifyCheckout({ root, eventName: 'pull_request', event }).security, true);
  assert.equal(classifyCheckout({ root, eventName: 'push', event: { before, after }, ref: 'refs/heads/develop', expectedHead: before }).fatal, true);
}));

test('CLI publishes bounded booleans/codes and exits nonzero on source mismatch', () => fixture((root, before) => {
  const eventPath = join(root, 'event.json');
  const outputPath = join(root, 'output');
  writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: 'c'.repeat(40) }, base: { sha: before, ref: 'develop' }, body: 'private diagnostic marker' } }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./classify-security-scope.mjs', import.meta.url))], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: outputPath },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes('private diagnostic marker'), false);
  assert.equal(readFileSync(outputPath, 'utf8'), 'security=true\nreason=SOURCE_MISMATCH\nfatal=true\n');
}));
