import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const appRoot = join(import.meta.dir, '..');
const wrapper = join(appRoot, 'scripts', 'clean-next.mjs');
const nodeExecutable = Bun.which('node') ?? 'node';
const nextCli = 'node_modules/next/dist/bin/next';
const cacheBytes = Buffer.from([0, 255, 17, 42, 10, 128, 64]);
const cacheFile = 'cache/webpack/fixture.pack';

// Run the real wrapper, then observe the filesystem from a real Node child.
// The fixture CLI does not create build output or imitate the cleanup logic.
const observer = `
const fs = require('node:fs');
const path = require('node:path');
const selected = process.env.TZUDONG_NEXT_DIST_DIR?.trim() || '.next';
const directory = path.join(process.cwd(), selected);
fs.writeFileSync('observed.json', JSON.stringify({
  selected,
  entries: fs.existsSync(directory) ? fs.readdirSync(directory).sort() : null,
  cache: fs.existsSync(path.join(directory, ${JSON.stringify(cacheFile)}))
    ? Array.from(fs.readFileSync(path.join(directory, ${JSON.stringify(cacheFile)}))) : null,
  processedEnv: process.env.__NEXT_PROCESSED_ENV || null,
  nightlyEnvFileOnly: process.env.NIGHTLY_ENV_FILE_ONLY || null,
}));
`;

type Observation = {
  selected: string;
  entries: string[] | null;
  cache: number[] | null;
  processedEnv: string | null;
  nightlyEnvFileOnly: string | null;
};

function write(file: string, content: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tzudong-clean-next-cache-'));
  const web = join(root, 'apps', 'web');
  write(join(web, nextCli), observer);
  write(join(web, 'scripts', 'observer.cjs'), observer);
  const seed = (name = '.next') => {
    const directory = join(web, name);
    write(join(directory, cacheFile), cacheBytes);
    write(join(directory, 'cache', 'fetch-cache', 'fixture.json'), '{"cached":true}\n');
    write(join(directory, 'cache', '.tsbuildinfo'), 'incremental-types-fixture');
    write(join(directory, 'server', 'pages', 'removed.js'), 'old-server-bundle');
    write(join(directory, 'static', 'old.css'), 'old-static-asset');
    write(join(directory, 'BUILD_ID'), 'old-build');
    write(join(directory, 'routes-manifest.json'), '{"routes":["/removed"]}\n');
    return directory;
  };
  return { root, web, seed };
}

type Fixture = ReturnType<typeof fixture>;

function withFixture(run: (item: Fixture) => void) {
  const item = fixture();
  try { run(item); }
  finally { rmSync(item.root, { recursive: true, force: true }); }
}

function launch(
  item: Fixture,
  options: {
    env?: Record<string, string>;
    command?: string[];
    skipClean?: boolean;
  } = {},
) {
  const result = spawnSync(nodeExecutable, [
    wrapper,
    ...(options.skipClean ? ['--skip-clean'] : []),
    '--',
    ...(options.command ?? [nodeExecutable, nextCli, 'build', '--webpack']),
  ], {
    cwd: item.web,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      NODE_ENV: 'test',
      ...options.env,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const observed = JSON.parse(readFileSync(join(item.web, 'observed.json'), 'utf8')) as Observation;
  return { result, observed };
}

describe('clean-next Vercel incremental cache boundary', () => {
  test('preserves cache bytes before a Vercel Next build and removes all previous output', () => {
    withFixture((item) => {
      const directory = item.seed();
      const cached = join(directory, cacheFile);
      const before = statSync(cached);
      write(join(item.web, '.next-stale-fixture', 'server.js'), 'stale-output');

      const { result, observed } = launch(item, { env: { VERCEL: '1', NODE_ENV: 'production' } });

      expect(observed.entries).toEqual(['cache']);
      expect(observed.cache).toEqual([...cacheBytes]);
      expect(readFileSync(cached)).toEqual(cacheBytes);
      expect(statSync(cached).mtimeMs).toBe(before.mtimeMs);
      expect(readFileSync(join(directory, 'cache', 'fetch-cache', 'fixture.json'), 'utf8'))
        .toBe('{"cached":true}\n');
      expect(readFileSync(join(directory, 'cache', '.tsbuildinfo'), 'utf8'))
        .toBe('incremental-types-fixture');
      expect(existsSync(join(item.web, '.next-stale-fixture'))).toBe(false);
      expect(result.stdout).toContain('[clean-next] preserved Vercel build cache; removed previous build output');
    });
  });

  test('local Next builds still remove the entire selected directory', () => {
    withFixture((item) => {
      item.seed();
      const { result, observed } = launch(item);
      expect(observed.entries).toBeNull();
      expect(observed.cache).toBeNull();
      expect(result.stdout).not.toContain('preserved Vercel build cache');
    });
  });

  test('requires the exact Vercel opt-in value', () => {
    withFixture((item) => {
      item.seed();
      expect(launch(item, { env: { VERCEL: 'true' } }).observed.entries).toBeNull();
    });
  });

  test('a Next path passed to another script does not preserve cache', () => {
    withFixture((item) => {
      item.seed();
      const { observed } = launch(item, {
        env: { VERCEL: '1' },
        command: [nodeExecutable, 'scripts/observer.cjs', nextCli, 'build'],
      });
      expect(observed.entries).toBeNull();
    });
  });

  test('the Next subcommand must be build, not a later argument', () => {
    withFixture((item) => {
      item.seed();
      const { observed } = launch(item, {
        env: { VERCEL: '1' },
        command: [nodeExecutable, nextCli, 'info', 'build'],
      });
      expect(observed.entries).toBeNull();
    });
  });

  const nightlyCases: Array<[string, Record<string, string>]> = [
    ['local', { NIGHTLY_MODE: 'local', NIGHTLY_LOCAL_ENV_ONLY: '1', NIGHTLY_ENV_FILE_ONLY: '1' }],
    ['hosted', { NIGHTLY_MODE: 'hosted', NIGHTLY_ENV_FILE_ONLY: '1' }],
    ['env-file-only', { NIGHTLY_ENV_FILE_ONLY: '1' }],
  ];
  for (const [mode, environment] of nightlyCases) {
    test(`nightly ${mode} runs still fully clean even with VERCEL=1`, () => {
      withFixture((item) => {
        item.seed();
        const { result, observed } = launch(item, {
          env: { VERCEL: '1', NIGHTLY_ENV_PROVENANCE: 'synthetic-cache-fixture', ...environment },
        });
        expect(observed.entries).toBeNull();
        expect(observed.cache).toBeNull();
        expect(observed.processedEnv).toBe('true');
        expect(observed.nightlyEnvFileOnly).toBe('1');
        expect(result.stdout).not.toContain('preserved Vercel build cache');
      });
    });
  }

  test('cleans only the custom dist selection and its stale directories', () => {
    withFixture((item) => {
      const defaultDirectory = item.seed();
      const selected = '.next-cache-proof';
      item.seed(selected);
      write(join(item.web, `${selected}-stale-fixture`, 'server.js'), 'selected-stale');
      write(join(item.web, '.next-stale-other', 'server.js'), 'other-stale');

      const { observed } = launch(item, { env: { VERCEL: '1', TZUDONG_NEXT_DIST_DIR: selected } });

      expect(observed.selected).toBe(selected);
      expect(observed.entries).toEqual(['cache']);
      expect(observed.cache).toEqual([...cacheBytes]);
      expect(readFileSync(join(defaultDirectory, 'server', 'pages', 'removed.js'), 'utf8'))
        .toBe('old-server-bundle');
      expect(readFileSync(join(defaultDirectory, cacheFile))).toEqual(cacheBytes);
      expect(existsSync(join(item.web, `${selected}-stale-fixture`))).toBe(false);
      expect(readFileSync(join(item.web, '.next-stale-other', 'server.js'), 'utf8')).toBe('other-stale');
    });
  });

  test('--skip-clean leaves cache, build output, and stale directories intact', () => {
    withFixture((item) => {
      const directory = item.seed();
      write(join(item.web, '.next-stale-fixture', 'server.js'), 'stale-output');
      const { result, observed } = launch(item, { env: { VERCEL: '1' }, skipClean: true });

      expect(observed.entries).toEqual(['BUILD_ID', 'cache', 'routes-manifest.json', 'server', 'static']);
      expect(observed.cache).toEqual([...cacheBytes]);
      expect(readFileSync(join(directory, 'static', 'old.css'), 'utf8')).toBe('old-static-asset');
      expect(readFileSync(join(item.web, '.next-stale-fixture', 'server.js'), 'utf8')).toBe('stale-output');
      expect(result.stdout).not.toContain('preserved Vercel build cache');
    });
  });

  test('unlinks a selected .next symlink without traversing the external directory', () => {
    withFixture((item) => {
      const external = join(item.root, 'external-build');
      write(join(external, cacheFile), cacheBytes);
      write(join(external, 'server', 'keep.js'), 'external-server');
      const selected = join(item.web, '.next');
      symlinkSync(external, selected, process.platform === 'win32' ? 'junction' : 'dir');

      const { observed } = launch(item, { env: { VERCEL: '1' } });

      expect(observed.entries).toBeNull();
      expect(lstatSync(selected, { throwIfNoEntry: false })).toBeUndefined();
      expect(readFileSync(join(external, cacheFile))).toEqual(cacheBytes);
      expect(readFileSync(join(external, 'server', 'keep.js'), 'utf8')).toBe('external-server');
    });
  });

  test('unlinks a cache symlink while retaining its external target', () => {
    withFixture((item) => {
      const directory = item.seed();
      rmSync(join(directory, 'cache'), { recursive: true });
      const external = join(item.root, 'external-cache');
      write(join(external, 'keep.pack'), cacheBytes);
      symlinkSync(external, join(directory, 'cache'), process.platform === 'win32' ? 'junction' : 'dir');

      const { result, observed } = launch(item, { env: { VERCEL: '1' } });

      expect(observed.entries).toEqual([]);
      expect(observed.cache).toBeNull();
      expect(lstatSync(join(directory, 'cache'), { throwIfNoEntry: false })).toBeUndefined();
      expect(readFileSync(join(external, 'keep.pack'))).toEqual(cacheBytes);
      expect(result.stdout).not.toContain('preserved Vercel build cache');
    });
  });

  test('a regular file named cache is removed rather than preserved', () => {
    withFixture((item) => {
      const directory = item.seed();
      rmSync(join(directory, 'cache'), { recursive: true });
      writeFileSync(join(directory, 'cache'), 'not-a-cache-directory');
      const { observed } = launch(item, { env: { VERCEL: '1' } });
      expect(observed.entries).toEqual([]);
      expect(observed.cache).toBeNull();
    });
  });
});
