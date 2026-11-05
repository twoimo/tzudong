import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dir, '../../..');
const workflows = ['security-audit.yml', 'web-admin-ci.yml', 'release-governance-ci.yml'];
const checkout = 'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd';

test('only the six full-history checkouts filter blobs while preserving exact source and credential boundaries', () => {
  let fullHistory = 0;
  for (const name of workflows) {
    const source = readFileSync(join(root, '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n');
    for (const step of source.split(/^ {6}- /m).slice(1)) {
      if (!step.includes('uses: actions/checkout@')) continue;
      expect(step).toContain(checkout);
      if (!/^ {10}fetch-depth: 0$/m.test(step)) {
        expect(step).not.toMatch(/^ {10}filter:/m);
        continue;
      }
      fullHistory++;
      expect(step).toMatch(/^ {10}filter: blob:none$/m);
      expect(step).toMatch(/^ {10}persist-credentials: false$/m);
      expect(step).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
      expect(step).not.toMatch(/^ {10}(sparse-checkout|fetch-tags):/m);
    }
  }
  expect(fullHistory).toBe(6);
});

test('file-only partial clone retains all ancestry/refs and current tree, then lazily reads a retained historical blob', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'ci-history-checkout-'));
  const producer = join(temporary, 'producer'), server = join(temporary, 'server.git'), consumer = join(temporary, 'consumer');
  const config = join(temporary, 'empty.gitconfig'); writeFileSync(config, ''); mkdirSync(producer);
  // No inherited Git directory, credential helper, config injection or external
  // protocol can redirect this fixture into the caller's repository/account.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(environment, { GIT_ALLOW_PROTOCOL: 'file', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Synthetic CI Fixture', GIT_COMMITTER_NAME: 'Synthetic CI Fixture',
    GIT_AUTHOR_EMAIL: 'synthetic@example.invalid', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid',
    GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z', LC_ALL: 'C' });
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, env: environment, encoding: 'utf8', timeout: 15000, maxBuffer: 2 ** 20 });
    if (result.error || result.status !== 0) throw new Error(`LOCAL_GIT_FIXTURE_FAILED:${args[0]}`);
    return result.stdout.trim();
  };
  const missing = () => git(consumer, 'rev-list', '--objects', '--all', '--missing=print').split('\n');
  const historical = 'Synthetic retained evidence, available only in the old tree.\n' + 'old-source\n'.repeat(4096);
  const current = 'Synthetic current source.\n';
  try {
    git(producer, 'init', '--initial-branch=main');
    writeFileSync(join(producer, 'retired.txt'), historical);
    writeFileSync(join(producer, 'current.txt'), 'Synthetic previous source.\n');
    git(producer, 'add', '.'); git(producer, 'commit', '-m', 'synthetic historical source');
    const retained = git(producer, 'rev-parse', 'HEAD');
    const oldBlob = git(producer, 'rev-parse', 'HEAD:retired.txt');
    git(producer, 'tag', 'retained-provenance');
    git(producer, 'branch', 'retained-evidence');
    rmSync(join(producer, 'retired.txt')); writeFileSync(join(producer, 'current.txt'), current);
    git(producer, 'add', '-A'); git(producer, 'commit', '-m', 'synthetic current source');
    const expectedHead = git(producer, 'rev-parse', 'HEAD'), expectedTree = git(producer, 'rev-parse', 'HEAD^{tree}');
    git(temporary, 'clone', '--bare', '--no-hardlinks', producer, server);
    git(server, 'config', 'uploadpack.allowFilter', 'true');
    git(server, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    // file:// invokes upload-pack; a plain local clone would ignore filtering.
    git(temporary, 'clone', '--filter=blob:none', '--no-checkout', '--no-single-branch', pathToFileURL(server).href, consumer);
    expect(git(consumer, 'config', 'remote.origin.promisor')).toBe('true');
    expect(git(consumer, 'config', 'remote.origin.partialclonefilter')).toBe('blob:none');
    expect(git(consumer, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(git(consumer, 'rev-list', '--all', '--parents').split('\n').sort())
      .toEqual(git(producer, 'rev-list', '--all', '--parents').split('\n').sort());
    expect(git(consumer, 'rev-parse', 'refs/remotes/origin/retained-evidence')).toBe(retained);
    expect(git(consumer, 'rev-parse', 'refs/tags/retained-provenance')).toBe(retained);
    git(consumer, 'merge-base', '--is-ancestor', retained, expectedHead);
    git(consumer, 'checkout', '--detach', expectedHead);
    expect(git(consumer, 'rev-parse', 'HEAD')).toBe(expectedHead);
    expect(git(consumer, 'rev-parse', 'HEAD^{tree}')).toBe(expectedTree);
    expect(readFileSync(join(consumer, 'current.txt'), 'utf8')).toBe(current);
    expect(git(consumer, 'status', '--porcelain')).toBe('');
    expect(missing()).toContain(`?${oldBlob}`);
    // Preserve the workflow's explicit retained-tag fetch and commit check.
    git(consumer, 'fetch', '--no-tags', 'origin', 'refs/tags/retained-provenance');
    git(consumer, 'cat-file', '-e', `${retained}^{commit}`);
    expect(missing()).toContain(`?${oldBlob}`);
    expect(git(consumer, 'show', `${retained}:retired.txt`)).toBe(historical.trim());
    expect(missing()).not.toContain(`?${oldBlob}`);
    expect(git(consumer, 'rev-parse', 'HEAD^{tree}')).toBe(expectedTree);
    expect(git(consumer, 'status', '--porcelain')).toBe('');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30000);
