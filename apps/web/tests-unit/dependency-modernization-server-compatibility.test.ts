import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const appRoot = join(import.meta.dir, '..');
const source = (relativePath: string) => readFileSync(join(appRoot, relativePath), 'utf8');
const packagePath = (name: string) => new RegExp(`(?:^|/)node_modules/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

type NpmLock = { packages: Record<string, unknown> };

describe('dependency modernization release authority', () => {
  test('the named dependency gate is the fail-closed candidate-bound release runner', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      engines: { node: string };
      packageManager: string;
      scripts: Record<string, string>;
    };
    const runner = source('scripts/run-dependency-modernization-browser.mjs');

    expect(packageJson.engines.node).toBe('24.x');
    expect(packageJson.packageManager).toBe('npm@11.6.2');
    expect(packageJson.scripts['test:dependency-modernization']).toBe('node scripts/run-dependency-modernization-browser.mjs --package-only');
    expect(packageJson.scripts['test:dependency-modernization:browser']).toBe('node scripts/run-dependency-modernization-browser.mjs');
    for (const token of [
      "TZUDONG_NODE24_EXECUTABLE?.trim() || process.execPath",
      "TZUDONG_NPM_11_EXECUTABLE?.trim()",
      "npmUsesExecutable ? [npmCli, args] : [nodeCli, [npmCli, ...args]]",
      "!isAbsolute(nodeCli) || !/^v24\\./.test(await capture(nodeCli, ['--version']",
      "!npmCli || !isAbsolute(npmCli)",
      "process.argv.slice(2).includes('--package-only')",
      "npmVersion !== '11.6.2'",
      "mkdtemp(join(tmpdir(), 'tzudong-dependency-proof-'))",
      "npmCommand(['ci', '--ignore-scripts', '--no-audit', '--fund=false'])",
      "node_modules', '.package-lock.json'",
      "npmCommand(['ls', 'lodash', 'sonner', '--all', '--json'])",
      "digest(copiedPackage) !== digest(packageSource)",
      "digest(copiedLock) !== digest(lockSource)",
      "Object.keys(removedGraph).sort().join(',') !== 'name,version'",
    ]) expect(runner).toContain(token);
  });

  test('the current npm lock has no root or nested lodash and sonner package paths', () => {
    const lock = JSON.parse(source('package-lock.json')) as NpmLock;
    for (const name of ['lodash', 'sonner']) {
      expect(Object.keys(lock.packages).filter((path) => packagePath(name).test(path))).toEqual([]);
    }
  });

  test('the standalone browser proof keeps the production build, CSS verifier, and real browser suite', () => {
    const runner = source('scripts/run-dependency-modernization-browser.mjs');
    for (const token of [
      "NEXT_PUBLIC_SUPABASE_URL: 'https://dependency-proof.supabase.co'",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: 'dependency-modernization-browser-proof-anon-key'",
      "if (!packageOnly)",
      "'node_modules/next/dist/bin/next', 'build', '--webpack'",
      "'scripts/verify-route-css-boundaries.mjs'",
      "'tests/dependency-modernization.spec.ts', '--project=chromium'",
    ]) expect(runner).toContain(token);
  });
  test('the built server, health probe, and isolated browser share the admitted origin', () => {
    const runner = source('scripts/run-dependency-modernization-browser.mjs');
    const browser = source('tests/dependency-modernization.spec.ts');
    expect(runner).toContain("process.env.TZUDONG_DEPENDENCY_PROOF_PORT?.trim() || '8080'");
    expect(runner).toContain('`http://localhost:${proofPort}`');
    expect(runner).toContain('`node scripts/start-standalone.mjs --port ${proofPort} --hostname localhost`');
    expect(runner).toContain('PLAYWRIGHT_BASE_URL: proofOrigin');
    expect(runner).toContain('PLAYWRIGHT_WEB_SERVER_URL: `${proofOrigin}/api/health`');
    expect(runner).toContain("PLAYWRIGHT_REUSE_EXISTING_SERVER: '0'");
    expect(browser).toContain('url.origin === admittedOrigin.origin');
    expect(browser).toContain("expect(admittedOrigin.hostname).toBe('localhost')");
  });

  test('invalid proof ports fail before package installation or server execution', () => {
    for (const port of ['0', '80', '65536', '8080;echo unsafe', 'https://example.com']) {
      const result = spawnSync(process.execPath, ['scripts/run-dependency-modernization-browser.mjs'], {
        cwd: appRoot,
        env: { ...process.env, TZUDONG_DEPENDENCY_PROOF_PORT: port },
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('DEPENDENCY_MODERNIZATION_PORT_INVALID');
      expect(result.stdout).toBe('');
    }
  });

  test('the dependency runner retains no raw child diagnostics or exception messages', () => {
    const runner = source('scripts/run-dependency-modernization-browser.mjs');

    expect(runner).toContain("import { logCliError } from './privacy-safe-cli-log.mjs';");
    expect(runner).toContain("stdio: 'ignore'");
    expect(runner).toContain("stdio: ['ignore', 'pipe', 'pipe']");
    expect(runner).toContain("child.stderr.on('data', () => {");
    expect(runner).toContain('DEPENDENCY_MODERNIZATION_PROOF_DIAGNOSTIC');
    expect(runner).toContain('DEPENDENCY_MODERNIZATION_UNEXPECTED_FAILURE');
    for (const unsafeSink of [
      "stdio: 'inherit'",
      'console.',
      'reject(error)',
      'error.message',
      'stderr ||',
    ]) expect(runner).not.toContain(unsafeSink);
  });
});
