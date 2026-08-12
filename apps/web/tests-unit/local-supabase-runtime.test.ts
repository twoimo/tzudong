import { describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  __localSupabaseRuntimeForTests,
  buildLocalWebEnvironment,
  loadLocalWebInputEnvironment,
} from '../scripts/local-supabase-runtime.mjs';

describe('local Supabase runtime source contract', () => {
  test('derives a path-bound Compose project name', () => {
    expect(__localSupabaseRuntimeForTests.projectName('/fixture/repository')).toMatch(
      /^tzudong-local-[a-f0-9]{12}$/,
    );
    expect(__localSupabaseRuntimeForTests.projectName('/fixture/repository')).not.toBe(
      __localSupabaseRuntimeForTests.projectName('/fixture/other'),
    );
  });

  test('parses exact generated env lines and rejects duplicates or malformed keys', () => {
    const required = {
      PROJECT_NAME: 'tzudong-local-000000000000',
      LOCAL_STATE_ROOT: '/tmp/state',
      LOCAL_INPUT_ROOT: '/tmp/state/inputs',
      POSTGRES_PASSWORD: 'fixture-password',
      POSTGRES_HOST_PORT: '13432',
      POOLER_TENANT_ID: 'local',
      KONG_HTTP_PORT: '8000',
      SITE_URL: 'http://127.0.0.1:8080',
      ADDITIONAL_REDIRECT_URLS: 'http://127.0.0.1:8080',
      API_EXTERNAL_URL: 'http://127.0.0.1:8000',
      SUPABASE_PUBLIC_URL: 'http://127.0.0.1:8000',
      SUPABASE_DB_URL: 'postgresql://postgres:fixture@127.0.0.1:13432/postgres',
      ANON_KEY: 'fixture-anon',
      SERVICE_ROLE_KEY: 'fixture-service',
      STORAGE_SERVICE_KEY: 'fixture-storage',
      NIGHTLY_ADMIN_EMAIL: 'nightly-ci@local.invalid',
      NIGHTLY_ADMIN_PASSWORD: 'fixture-password-long',
      LOCAL_STACK_GENERATOR_VERSION: 'local-stack-v1',
    };
    const source = `${Object.entries(required).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
    expect(__localSupabaseRuntimeForTests.parseGeneratedEnvironment(Buffer.from(source))).toEqual(required);
    expect(() => __localSupabaseRuntimeForTests.parseGeneratedEnvironment(Buffer.from(`${source}ANON_KEY=duplicate\n`))).toThrow('env_shape');
    expect(() => __localSupabaseRuntimeForTests.parseGeneratedEnvironment(Buffer.from(source.replace('ANON_KEY=', 'bad-key=')))).toThrow('env_shape');
  });

  test('keeps local development isolated from ambient hosted credentials', () => {
    const runner = readFileSync(path.resolve(import.meta.dir, '../scripts/local-supabase-runtime.mjs'), 'utf8');
    const packageSource = readFileSync(path.resolve(import.meta.dir, '../package.json'), 'utf8');
    const nextConfig = readFileSync(path.resolve(import.meta.dir, '../next.config.mjs'), 'utf8');
    const localDevRunner = readFileSync(path.resolve(import.meta.dir, '../scripts/run-local-dev.mjs'), 'utf8');
    const gitignore = readFileSync(path.resolve(import.meta.dir, '../.gitignore'), 'utf8');
    const eslintConfig = readFileSync(path.resolve(import.meta.dir, '../eslint.config.mjs'), 'utf8');
    expect(packageSource).toContain('"dev": "node scripts/run-local-dev.mjs --port 8080"');
    expect(packageSource).toContain('"dev:local": "node scripts/run-local-dev.mjs --port 8080"');
    expect(packageSource).toContain('"dev:hosted": "node scripts/dev-prewarm.mjs --port 8080"');
    expect(packageSource).toContain('"supabase:gen-types:local": "node scripts/run-local-supabase-types.mjs"');
    expect(readFileSync(path.resolve(import.meta.dir, '../scripts/run-local-supabase-types.mjs'), 'utf8'))
      .toContain('databaseUrl.username = `${databaseUrl.username}.${local.values.POOLER_TENANT_ID}`');
    const environment = buildLocalWebEnvironment({
      supabaseOrigin: 'http://127.0.0.1:8000',
      stateRoot: '/local/state',
      values: { ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service', STORAGE_SERVICE_KEY: 'local-storage' },
    }, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://hosted.supabase.co',
      SUPABASE_ACCESS_TOKEN: 'hosted-token',
      SERVICE_ROLE_KEY: 'ambient-raw-service-role',
      STORAGE_SERVICE_KEY: 'ambient-raw-storage-owner',
      POSTGRES_URL: 'postgresql://hosted.invalid/database',
      PGHOST: 'hosted.invalid',
      PGPASSWORD: 'hosted-password',
      PGPASSFILE: '/hosted/pgpass',
      PGSERVICEFILE: '/hosted/pg-service',
      DIRECT_URL: 'postgresql://hosted.invalid/direct',
      PRISMA_DATABASE_URL: 'postgresql://hosted.invalid/prisma',
      YOUTUBE_API_KEY: 'hosted-youtube-token',
      INSIGHT_GITHUB_TOKEN: 'hosted-insight-token',
      GITHUB_OWNER: 'fixture-owner',
      GITHUB_REPO: 'fixture-repository',
      KEEP_ME: 'safe',
    });
    expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:8000');
    expect(environment.SUPABASE_ACCESS_TOKEN).toBeUndefined();
    expect(environment.SERVICE_ROLE_KEY).toBeUndefined();
    expect(environment.SUPABASE_STORAGE_SERVER_KEY).toBe('local-storage');
    expect(environment.STORAGE_SERVICE_KEY).toBeUndefined();
    expect(environment.POSTGRES_URL).toBeUndefined();
    expect(environment.PGHOST).toBeUndefined();
    expect(environment.PGPASSWORD).toBeUndefined();
    expect(environment.PGPASSFILE).toBeUndefined();
    expect(environment.PGSERVICEFILE).toBeUndefined();
    expect(environment.DIRECT_URL).toBeUndefined();
    expect(environment.PRISMA_DATABASE_URL).toBeUndefined();
    expect(environment.YOUTUBE_API_KEY).toBe('hosted-youtube-token');
    expect(environment.INSIGHT_GITHUB_TOKEN).toBe('hosted-insight-token');
    expect(environment.GITHUB_REPOSITORY).toBe('fixture-owner/fixture-repository');
    expect(environment.INSIGHT_GITHUB_REPOSITORY).toBe('fixture-owner/fixture-repository');
    expect(environment.INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED).toBe('1');
    expect(environment.INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED).toBe('1');
    expect(environment.INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED).toBe('1');
    expect(environment.KEEP_ME).toBe('safe');
    expect(runner).toContain("TZUDONG_LOCAL_SUPABASE_DEV: '1'");
    expect(runner).toContain("NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1'");
    expect(runner).toContain("NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js'");
    expect(runner).toContain("SUPABASE_SERVICE_ROLE_KEY: local.values.SERVICE_ROLE_KEY");
    expect(runner).toContain("SUPABASE_STORAGE_SERVER_KEY: local.values.STORAGE_SERVICE_KEY");
    expect(nextConfig).toContain("process.env.TZUDONG_LOCAL_SUPABASE_DEV === '1'");
    expect(nextConfig).toContain("process.env.NODE_ENV === 'development'");
    expect(localDevRunner).toContain('NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`');
    expect(localDevRunner).toContain('TZUDONG_NEXT_DIST_DIR: `.next-local-${port}`');
    expect(localDevRunner).toContain("__NEXT_PROCESSED_ENV: 'true'");
    expect(localDevRunner).not.toContain('process.kill(process.pid');
    expect(gitignore).toContain('/.next-*/');
    expect(eslintConfig).toContain("'.next-local-*/**'");
    expect(eslintConfig).toContain("'.next-nightly-*/**'");
  });

  test('rejects malformed GitHub repository inputs while keeping status fail closed', () => {
    const environment = buildLocalWebEnvironment({
      supabaseOrigin: 'http://127.0.0.1:8000',
      stateRoot: '/local/state',
      values: { ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' },
    }, {
      INSIGHT_GITHUB_REPOSITORY: 'invalid/repository/extra',
      GITHUB_REPOSITORY: 'invalid owner/repository',
      GITHUB_OWNER: '-invalid-owner',
      GITHUB_REPO: 'fixture',
      GITHUB_TOKEN: 'fixture-token',
    });

    expect(environment.GITHUB_REPOSITORY).toBeUndefined();
    expect(environment.INSIGHT_GITHUB_REPOSITORY).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBe('fixture-token');
    expect(environment.INSIGHT_GITHUB_ACTIONS_STATUS_ENABLED).toBe('1');
    expect(environment.INSIGHT_NIGHTLY_REGRESSION_STATUS_ENABLED).toBe('1');
  });

  test('loads non-database operator inputs into an isolated map before scrubbing', () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'tzudong-local-input-'));
    mkdirSync(path.join(fixtureRoot, 'apps', 'web'), { recursive: true });
    writeFileSync(
      path.join(fixtureRoot, '.env.local'),
      'INSIGHT_GITHUB_REPOSITORY=repo/fallback\nPGPASSFILE=/hosted/pgpass\nINSIGHT_SUPABASE_COUNTER_STATUS_ENABLED=0\n',
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(fixtureRoot, 'apps', 'web', '.env.local'),
      'INSIGHT_GITHUB_REPOSITORY=app/preferred\nINSIGHT_GITHUB_TOKEN=fixture-token\nDATABASE_URL=postgresql://hosted.invalid/db\n',
      { mode: 0o600 },
    );

    try {
      const loaded = loadLocalWebInputEnvironment({ repositoryRoot: fixtureRoot, inherited: {} });
      const environment = buildLocalWebEnvironment({
        supabaseOrigin: 'http://127.0.0.1:8000',
        stateRoot: '/local/state',
        values: { ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' },
      }, loaded);

      expect(environment.INSIGHT_GITHUB_REPOSITORY).toBe('app/preferred');
      expect(environment.INSIGHT_GITHUB_TOKEN).toBe('fixture-token');
      expect(environment.DATABASE_URL).toBeUndefined();
      expect(environment.PGPASSFILE).toBeUndefined();
      expect(environment.INSIGHT_SUPABASE_COUNTER_STATUS_ENABLED).toBe('1');
      expect(loaded.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
      expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:8000');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('accepts only an explicit owner-only absolute operator env path', () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'tzudong-operator-input-'));
    const operatorEnvFile = path.join(fixtureRoot, 'operator.env.local');
    mkdirSync(path.join(fixtureRoot, 'apps', 'web'), { recursive: true });
    writeFileSync(
      operatorEnvFile,
      'GITHUB_OWNER=fixture-owner\nGITHUB_REPO=fixture-repository\nGITHUB_TOKEN=fixture-token\nSUPABASE_SERVICE_ROLE_KEY=hosted-service\n',
      { mode: 0o700 },
    );

    try {
      const loaded = loadLocalWebInputEnvironment({
        repositoryRoot: fixtureRoot,
        inherited: {},
        operatorEnvFile,
      });
      const environment = buildLocalWebEnvironment({
        supabaseOrigin: 'http://127.0.0.1:8000',
        stateRoot: '/local/state',
        values: { ANON_KEY: 'local-anon', SERVICE_ROLE_KEY: 'local-service' },
      }, loaded);

      expect(environment.INSIGHT_GITHUB_REPOSITORY).toBe('fixture-owner/fixture-repository');
      expect(environment.GITHUB_TOKEN).toBe('fixture-token');
      expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBe('local-service');
      expect(() => loadLocalWebInputEnvironment({
        repositoryRoot: fixtureRoot,
        inherited: {},
        operatorEnvFile: 'operator.env.local',
      })).toThrow('operator_env_path');
      expect(() => loadLocalWebInputEnvironment({
        repositoryRoot: fixtureRoot,
        inherited: {},
        operatorEnvFile: path.join(fixtureRoot, 'missing.env.local'),
      })).toThrow('local_env_read');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('rejects group- or world-readable optional local env files', () => {
    if (process.platform === 'win32') return;
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'tzudong-local-input-mode-'));
    mkdirSync(path.join(fixtureRoot, 'apps', 'web'), { recursive: true });
    writeFileSync(path.join(fixtureRoot, '.env.local'), 'INSIGHT_GITHUB_REPOSITORY=repo/test\n', {
      mode: 0o644,
    });

    try {
      expect(() => loadLocalWebInputEnvironment({ repositoryRoot: fixtureRoot, inherited: {} }))
        .toThrow('local_env_shape');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('strict local clean wrapper skips repository dotenv and blocks Next dotenv reprocessing', () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'tzudong-local-env-'));
    const fixtureWeb = path.join(fixtureRoot, 'apps', 'web');
    const cleanNextPath = path.resolve(import.meta.dir, '../scripts/clean-next.mjs');
    mkdirSync(fixtureWeb, { recursive: true });
    writeFileSync(path.join(fixtureRoot, '.env.local'), 'REPO_DOTENV_SENTINEL=hosted\n');

    try {
      const probe = [
        "const isolated = process.env.REPO_DOTENV_SENTINEL === undefined",
        "  && process.env.__NEXT_PROCESSED_ENV === 'true'",
        "  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:8000';",
        "process.stdout.write(isolated ? 'isolated' : 'failed');",
      ].join('\n');
      const result = spawnSync(
        process.execPath,
        [cleanNextPath, '--skip-clean', '--', process.execPath, '--eval', probe],
        {
          cwd: fixtureWeb,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TZUDONG_LOCAL_SUPABASE_DEV: '1',
            NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:8000',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('isolated');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('clean wrapper forwards termination and exits with the signal status', async () => {
    const cleanNextPath = path.resolve(import.meta.dir, '../scripts/clean-next.mjs');
    const probe = [
      "process.stdout.write('ready\\n');",
      "process.on('SIGTERM', () => process.exit(0));",
      'setInterval(() => undefined, 1000);',
    ].join('\n');
    const wrapper = spawn(
      process.execPath,
      [cleanNextPath, '--skip-clean', '--', process.execPath, '--eval', probe],
      {
        cwd: path.resolve(import.meta.dir, '..'),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TZUDONG_LOCAL_SUPABASE_DEV: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wrapper readiness timeout')), 3_000);
        wrapper.once('error', reject);
        wrapper.stdout?.on('data', (chunk) => {
          if (!String(chunk).includes('ready')) return;
          clearTimeout(timer);
          resolve();
        });
      });
      wrapper.kill('SIGTERM');
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })),
      );
      expect(result).toEqual({ code: 143, signal: null });
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL');
    }
  });
});
