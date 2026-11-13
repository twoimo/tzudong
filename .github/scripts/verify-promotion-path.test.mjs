import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyPromotionPath } from './verify-promotion-path.mjs';

const repo = 'twoimo/tzudong';
const event = (base, head, source = repo) => ({ pull_request: {
  base: { ref: base, repo: { full_name: repo } },
  head: { ref: head, sha: 'a'.repeat(40), repo: { full_name: source } },
} });

test('allows feature and dependency PRs directly into protected main', () => {
  for (const head of ['codex/recovery', 'fix/map', 'dependabot/npm_and_yarn/web']) {
    assert.deepEqual(verifyPromotionPath(event('main', head), repo), { passed: true, code: 'PROMOTION_FEATURE_TO_MAIN' });
  }
});
test('retired code promotion cannot resume through a legacy release branch', () => {
  for (const [base, head] of [['main', 'develop'], ['main', 'data'], ['main', 'main'], ['data', 'develop'], ['data', 'codex/recovery'], ['develop', 'codex/recovery'], ['develop', 'main'], ['develop', 'data']]) {
    assert.equal(verifyPromotionPath(event(base, head), repo).passed, false);
  }
});
test('a fork cannot impersonate any retired release conduit', () => {
  for (const [base, head] of [['data', 'develop'], ['main', 'data'], ['main', 'develop'], ['main', 'main']]) {
    assert.equal(verifyPromotionPath(event(base, head, 'untrusted/tzudong'), repo).passed, false);
  }
});
test('feature contributions and unrelated development bases remain usable', () => {
  assert.equal(verifyPromotionPath(event('main', 'fix/feature', 'contributor/tzudong'), repo).passed, true);
  assert.equal(verifyPromotionPath(event('refactor/sidebar', 'fix/feature'), repo).passed, true);
});
test('rejects another repository, absent PR, and malformed source identity', () => {
  assert.equal(verifyPromotionPath(event('main', 'fix/map'), 'untrusted/tzudong').passed, false);
  assert.equal(verifyPromotionPath({}, repo).passed, false);
  const malformed = event('main', 'fix/map');
  malformed.pull_request.head.sha = 'not-a-commit';
  assert.equal(verifyPromotionPath(malformed, repo).passed, false);
  malformed.pull_request.base.repo.full_name = 'untrusted/tzudong';
  assert.equal(verifyPromotionPath(malformed, repo).passed, false);
  for (const invalid of ['', '0'.repeat(40), 'a'.repeat(39)]) {
    const source = event('main', 'fix/map');
    source.pull_request.head.sha = invalid;
    assert.equal(verifyPromotionPath(source, repo).passed, false);
  }
  const absentRepository = event('main', 'fix/map');
  delete absentRepository.pull_request.head.repo;
  assert.equal(verifyPromotionPath(absentRepository, repo).passed, false);
});
test('workflow emits the required check on every PR and on base edits, without secrets', () => {
  const workflow = readFileSync(new URL('../workflows/promotion-path.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Promotion Path/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/);
  assert.doesNotMatch(workflow, /paths:|branches:|secrets\.|:\s*write\b/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.doesNotMatch(workflow, /refs\/pull|head\.sha|head\.ref/);
  assert.doesNotMatch(workflow, /node --test/);
  assert.match(workflow, /node --input-type=module/);
  assert.match(workflow, /import \{ verifyPromotionPath \}/);
  assert.doesNotMatch(workflow, /GITHUB_EVENT_NAME:/);
});

test('the required policy has no PR-defined bootstrap or conditional job skip', () => {
  const workflow = readFileSync(new URL('../workflows/promotion-path.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^\s+pull_request:|^\s+if:/m);
  assert.doesNotMatch(workflow, /fromJSON|base\.sha|head\.sha|head\.ref|refs\/pull/);
  assert.match(workflow, /GITHUB_EVENT_NAME === 'pull_request_target'/);
  assert.equal((workflow.match(/ref: \$\{\{ github\.workflow_sha \}\}/g) ?? []).length, 1);
});
