import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyPromotionPath } from './verify-promotion-path.mjs';

const repo = 'twoimo/tzudong';
const event = (base, head, source = repo) => ({ pull_request: {
  base: { ref: base, repo: { full_name: repo } },
  head: { ref: head, sha: 'a'.repeat(40), repo: { full_name: source } },
} });

test('allows a feature branch into develop and each serialized promotion', () => {
  for (const [base, head] of [['develop', 'codex/recovery'], ['data', 'develop'], ['main', 'data']]) {
    assert.equal(verifyPromotionPath(event(base, head), repo).passed, true);
  }
});
test('rejects shortcuts and reverse promotion', () => {
  for (const [base, head] of [['main', 'develop'], ['main', 'codex/recovery'], ['data', 'codex/recovery'], ['develop', 'main'], ['develop', 'data']]) {
    assert.equal(verifyPromotionPath(event(base, head), repo).passed, false);
  }
});
test('a fork cannot impersonate the data or develop promotion branch', () => {
  for (const [base, head] of [['data', 'develop'], ['main', 'data']]) {
    assert.equal(verifyPromotionPath(event(base, head, 'untrusted/tzudong'), repo).passed, false);
  }
});
test('feature contributions and unrelated development bases remain usable', () => {
  assert.equal(verifyPromotionPath(event('develop', 'fix/feature', 'contributor/tzudong'), repo).passed, true);
  assert.equal(verifyPromotionPath(event('refactor/sidebar', 'fix/feature'), repo).passed, true);
});
test('rejects another repository, absent PR, and malformed source identity', () => {
  assert.equal(verifyPromotionPath(event('main', 'data'), 'untrusted/tzudong').passed, false);
  assert.equal(verifyPromotionPath({}, repo).passed, false);
  const malformed = event('main', 'data');
  malformed.pull_request.head.sha = 'not-a-commit';
  assert.equal(verifyPromotionPath(malformed, repo).passed, false);
  malformed.pull_request.base.repo.full_name = 'untrusted/tzudong';
  assert.equal(verifyPromotionPath(malformed, repo).passed, false);
});
test('workflow emits the required check on every PR and on base edits, without secrets', () => {
  const workflow = readFileSync(new URL('../workflows/promotion-path.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Promotion Path/);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/);
  assert.doesNotMatch(workflow, /paths:|branches:|secrets\.|:\s*write\b/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.doesNotMatch(workflow, /refs\/pull|head\.sha|head\.ref/);
  assert.match(workflow, /8a3a3a65ea41d4a5f20f1111aac9e0c3f8583b25/);
  assert.doesNotMatch(workflow, /node --test/);
  assert.match(workflow, /node --input-type=module/);
  assert.match(workflow, /import \{ verifyPromotionPath \}/);
  assert.doesNotMatch(workflow, /GITHUB_EVENT_NAME:/);
});

test('bounded bootstrap runs reviewed develop policy while default main is still uninstalled', () => {
  const workflow = readFileSync(new URL('../workflows/promotion-path.yml', import.meta.url), 'utf8');
  const lists = [...workflow.matchAll(/contains\(fromJSON\('([^']+)'\), github\.event\.pull_request\.base\.sha\)/g)]
    .map((match) => JSON.parse(match[1]));
  assert.equal(lists.length, 2);
  const [bootstrapBases, anchorBases] = lists;
  const reviewedDevelop = 'f5ac706239c1aaf9c0c62ab1f6c539959c8cf70f';
  assert.deepEqual(bootstrapBases, [...anchorBases, reviewedDevelop]);
  assert.equal(anchorBases.length, 3);
  assert.equal(anchorBases.includes(reviewedDevelop), false);
  assert.equal(bootstrapBases.includes('a'.repeat(40)), false);
  assert.match(workflow, /\|\| github\.event\.pull_request\.base\.sha/);
});
