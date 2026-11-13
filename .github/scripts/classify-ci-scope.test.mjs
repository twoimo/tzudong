import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyPaths as benchmarkPaths } from './classify-ci-benchmark.mjs';
import { classifyPaths, classifyEvent, classifyCheckout, SCOPE_FLAGS } from './classify-ci-scope.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const selected = (result) => SCOPE_FLAGS.filter((flag) => result[flag]);
const all = (result) => assert.deepEqual(selected(result), [...SCOPE_FLAGS]);
const event = (head = HEAD, base = BASE, branch = 'main') => ({ pull_request: { head: { sha: head }, base: { sha: base, ref: branch } } });
const script = fileURLToPath(new URL('./classify-ci-scope.mjs', import.meta.url));

function withRepository(run) {
  const root = mkdtempSync(join(tmpdir(), 'tzudong-ci-scope-'));
  const config = join(root, 'empty-config');
  writeFileSync(config, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Synthetic CI Scope', GIT_COMMITTER_NAME: 'Synthetic CI Scope',
    GIT_AUTHOR_EMAIL: 'scope@example.invalid', GIT_COMMITTER_EMAIL: 'scope@example.invalid',
    GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, text) => { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  const commit = (message) => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '--initial-branch=main');
    write('README.md', 'Synthetic source.\n');
    write('backend/supabase/migrations/protected.sql', 'select 1;\n');
    write('apps/web/package-lock.json', '{}\n');
    const base = commit('synthetic base');
    return run({ root, env, git, write, commit, base });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('only explicit documentation paths avoid the heavy lanes', () => {
  for (const file of ['README.md', 'README.ko.md', 'CHANGELOG.md', 'docs/architecture.md', 'docs/notes.txt', 'scripts/README.md']) {
    const result = classifyPaths([file]);
    assert.deepEqual(selected(result), []);
    assert.equal(result.reason, 'DOCUMENTATION_ONLY');
    assert.equal(result.fatal, false);
  }
  for (const file of ['README.mjs', 'docs/execute.py', 'docs/config.json', 'new-root/README.md', '.gitignore']) all(classifyPaths([file]));
  assert.deepEqual(selected(classifyPaths(['AGENTS.md'])), ['unit', 'admin']);
});

test('web runtime keeps production browser proof and removes only unrelated compatibility', () => {
  for (const file of ['apps/web/app/page.tsx', 'apps/web/components/ui/select.tsx', 'apps/web/app/global-map/page.tsx', 'apps/web/lib/supabase/server.ts', 'apps/web/tests/dependency-modernization.spec.ts']) {
    assert.deepEqual(selected(classifyPaths([file])), ['authority', 'unit', 'build', 'install', 'admin']);
  }
  const mixed = classifyPaths(['docs/architecture.md', 'apps/web/app/page.tsx', 'backend/supabase/migrations/change.sql']);
  assert.equal(mixed.reason, 'MIXED_CHANGE');
  assert.equal(mixed.install, true);
  assert.equal(mixed.compatibility, false);
});

test('backend, DB and governance retain source contracts and admin SQL probes', () => {
  for (const file of ['backend/supabase/migrations/change.sql', 'backend/supabase/scripts/local-stack.py', 'backend/pipeline_control/api.py', '.kiro/specs/evidence.json', '.agents/skills/ci/SKILL.md', '.github/workflows/security-audit.yml', '.github/dependabot.yml']) {
    assert.deepEqual(selected(classifyPaths([file])), ['unit', 'admin']);
  }
});

test('toolchain, executable tooling and policy inputs retain every lane', () => {
  const paths = [
    'apps/web/package.json', 'apps/web/package-lock.json', 'apps/web/bun.lock',
    'backend/package-lock.json', 'backend/pipeline-control/requirements.txt',
    'apps/web/tsconfig.json', 'apps/web/next.config.ts', 'apps/web/config/pins.json',
    'apps/web/scripts/collect-dependency-candidates.mjs', 'apps/web/scripts/start-standalone.mjs',
    'apps/web/tests-unit/cross-platform-web-tooling-source.test.ts',
    'apps/web/tests-unit/release-workflow-governance-source.test.ts',
    '.github/workflows/web-admin-ci.yml', '.github/scripts/classify-ci-scope.mjs',
    '.github/scripts/classify-ci-scope.test.mjs', '.github/scripts/verify-ci-results.mjs',
    '.github/scripts/verify-ci-results.test.mjs', '.github/scripts/classify-ci-benchmark.mjs',
  ];
  for (const path of paths) all(classifyPaths([path]));
  for (const path of [...paths, 'go.mod', 'unknown/new-file.bin']) {
    if (benchmarkPaths([path]).benchmark) {
      const result = classifyPaths([path]);
      assert.equal(result.authority, true);
      assert.equal(result.compatibility, true);
    }
  }
});

test('unavailable or malformed inventories cannot become documentation skips', () => {
  for (const paths of [undefined, [], 'README.md', [''], ['/README.md'], ['docs/../README.md'], ['docs\\guide.md'], ['docs//guide.md'], ['docs/./guide.md'], ['README.md\0secret'], [null], new Array(20_001).fill('README.md')]) all(classifyPaths(paths));
});

test('legacy installation, protected pushes, periodic and unknown events retain full coverage', () => {
  for (const branch of ['data', 'develop']) {
    const pr = classifyEvent({ eventName: 'pull_request', event: event(HEAD, BASE, branch), head: HEAD, changedPaths: ['README.md'] });
    all(pr); assert.equal(pr.reason, 'PROTECTED_PROMOTION');
  }
  for (const branch of ['main', 'data', 'develop']) {
    const legacy = event(); legacy.pull_request.head.ref = branch;
    const pr = classifyEvent({ eventName: 'pull_request', event: legacy, head: HEAD, changedPaths: ['README.md'] });
    all(pr); assert.equal(pr.reason, 'PROTECTED_PROMOTION');
    const push = classifyEvent({ eventName: 'push', event: { before: BASE, after: HEAD }, ref: 'refs/heads/' + branch, head: HEAD, changedPaths: ['README.md'] });
    all(push); assert.equal(push.reason, 'PROTECTED_PUSH');
  }
  for (const eventName of ['schedule', 'workflow_dispatch', 'unrecognised']) all(classifyEvent({ eventName, event: {}, head: HEAD, changedPaths: ['README.md'] }));
  all(classifyEvent({ eventName: 'pull_request', event: event(HEAD, BASE, 'unexpected'), head: HEAD, changedPaths: ['README.md'] }));
  all(classifyEvent({ eventName: 'push', event: { before: BASE, after: HEAD }, ref: 'refs/heads/unexpected', head: HEAD, changedPaths: ['README.md'] }));
});

test('source identity mismatch is fatal rather than a successful fallback', () => {
  for (const result of [
    classifyEvent({ eventName: 'pull_request', event: event(), head: BASE }),
    classifyEvent({ eventName: 'pull_request', event: event('bad'), head: HEAD }),
    classifyEvent({ eventName: 'push', event: { before: BASE, after: BASE }, head: HEAD }),
    classifyEvent({ eventName: 'schedule', event: {}, head: '0'.repeat(40) }),
  ]) { all(result); assert.equal(result.fatal, true); }
});

test('Git diff includes both names when SQL is renamed into documentation', () => withRepository(({ root, base, git, commit }) => {
  mkdirSync(join(root, 'docs'));
  renameSync(join(root, 'backend/supabase/migrations/protected.sql'), join(root, 'docs/moved.md'));
  const head = commit('rename protected input');
  assert.match(git('diff', '--summary', base, head), /rename/);
  const result = classifyCheckout({ root, eventName: 'pull_request', event: event(head, base), expectedHead: BASE });
  assert.deepEqual(selected(result), ['unit', 'admin']);
}));

test('Git diff keeps deleted dependency inputs and NUL-framed names', () => withRepository(({ root, base, write, commit }) => {
  rmSync(join(root, 'apps/web/package-lock.json'));
  write('docs/a document\nsecond line.md', 'Synthetic documentation.\n');
  const head = commit('remove dependency input');
  all(classifyCheckout({ root, eventName: 'pull_request', event: event(head, base), expectedHead: head }));
}));

test('main PR scope uses its merge base while the merged main tree gets full proof', () => withRepository(({ root, base, write, commit, git }) => {
  git('checkout', '-b', 'feature', base);
  write('docs/change.md', 'Synthetic PR document.\n');
  const head = commit('feature doc');
  git('checkout', 'main');
  write('apps/web/package-lock.json', '{"updated":true}\n');
  const updatedBase = commit('independent base dependency');
  git('checkout', 'feature');
  const pr = classifyCheckout({ root, eventName: 'pull_request', event: event(head, updatedBase), expectedHead: BASE });
  assert.equal(pr.reason, 'DOCUMENTATION_ONLY');
  const push = classifyCheckout({ root, eventName: 'push', event: { before: base, after: head }, ref: 'refs/heads/main', expectedHead: head });
  assert.equal(push.reason, 'PROTECTED_PUSH');
  all(push);
}));

test('missing Git history selects all lanes and actual checkout mismatch fails', () => withRepository(({ root, base, write, commit }) => {
  write('docs/change.md', 'Synthetic document.\n');
  const head = commit('feature doc');
  all(classifyCheckout({ root, eventName: 'pull_request', event: event(head, BASE) }));
  assert.equal(classifyCheckout({ root, eventName: 'pull_request', event: event(base, base) }).fatal, true);
  assert.equal(classifyCheckout({ root, eventName: 'schedule', event: {}, expectedHead: base }).fatal, true);
}));

test('CLI emits fixed boolean outputs and exits nonzero for source mismatch', () => withRepository(({ root, env, base, write, commit }) => {
  write('docs/change.md', 'Synthetic document.\n');
  const head = commit('feature doc');
  const eventPath = join(root, 'event.json');
  const outputPath = join(root, 'output.txt');
  writeFileSync(eventPath, JSON.stringify({ ...event(head, base), privatePayload: 'NEVER_PRINT_THIS_VALUE' }));
  const run = () => spawnSync(process.execPath, [script], { cwd: root, env: { ...env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath }, encoding: 'utf8' });
  const good = run();
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).reason, 'DOCUMENTATION_ONLY');
  assert.doesNotMatch(good.stdout + good.stderr, /NEVER_PRINT_THIS_VALUE|docs\/change/);
  const lines = readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 8);
  for (const flag of SCOPE_FLAGS) assert.ok(lines.includes(flag + '=false'));
  assert.ok(lines.includes('fatal=false'));
  writeFileSync(eventPath, JSON.stringify(event(base, base)));
  const bad = run();
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).reason, 'SOURCE_MISMATCH');
}));
