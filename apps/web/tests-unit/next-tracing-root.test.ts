import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(appRoot, '../..');

function readConfiguration(vercel: boolean, build: boolean) {
  const env: NodeJS.ProcessEnv = { ...process.env, VERCEL: vercel ? '1' : '0', ANALYZE: 'false' };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.TZUDONG_NEXT_DIST_DIR;
  const script = `
    import path from 'node:path';
    ${build ? "process.argv.push('build');" : ''}
    const { default: config } = await import('./next.config.mjs');
    const generatedPackage = path.join(process.cwd(), '.next/package.json');
    console.log(JSON.stringify({
      root: config.outputFileTracingRoot,
      output: config.output ?? null,
      adapterFile: path.relative(config.outputFileTracingRoot, generatedPackage),
    }));
  `;
  const result = spawnSync(process.execPath, ['--eval', script], {
    cwd: appRoot, env, encoding: 'utf8', timeout: 30_000,
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('Next adapter file paths in the monorepo', () => {
  test('Vercel resolves generated files to apps/web from the repository root', () => {
    const config = readConfiguration(true, true);
    expect(config.output).toBeNull();
    expect(path.resolve(repositoryRoot, config.adapterFile)).toBe(
      path.join(appRoot, '.next/package.json'),
    );
  });

  test('local development keeps app-scoped tracing without standalone output', () => {
    const config = readConfiguration(false, false);
    expect(config.root).toBe(path.resolve(appRoot));
    expect(config.output).toBeNull();
  });

  test('local production keeps the existing standalone repository layout', () => {
    const config = readConfiguration(false, true);
    expect(path.resolve(config.root)).toBe(repositoryRoot);
    expect(config.output).toBe('standalone');
  });
});
