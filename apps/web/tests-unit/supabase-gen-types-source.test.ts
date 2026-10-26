import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'bun:test';

const SOURCE = readFileSync(
  path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs'),
  'utf8',
);

test('classifyGenTypesFailure is module-scoped for the gen-types catch', () => {
  const fn = SOURCE.indexOf('function classifyGenTypesFailure(error)');
  const mainCall = SOURCE.indexOf('main().catch((error) => {');
  expect(fn).toBeGreaterThan(-1);
  expect(mainCall).toBeGreaterThan(fn);
  expect(SOURCE.includes('failure_class=${classifyGenTypesFailure(error)}')).toBe(true);
});

test('local typegen prefers loopback postgres-meta over a Docker pg-meta sidecar', () => {
  expect(SOURCE).toContain("parsed.hostname !== '127.0.0.1'");
  expect(SOURCE).toContain('/generators/typescript?included_schemas=');
  expect(SOURCE).toContain('family: 4');
  expect(SOURCE).not.toContain('host.docker.internal');
});

test('partial pg-meta output cannot overwrite the previous generated types', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tz-types-shape-'));
  const output = path.join(directory, 'database.types.ts');
  let body = '';
  const server = createServer((_request, response) => response.end(body));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture_address_missing');
    const run = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn('node', [path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs')], {
        cwd: directory, stdio: 'ignore', env: {
          PATH: process.env.PATH,
          SUPABASE_PG_META_URL: `http://127.0.0.1:${address.port}`,
          SUPABASE_TYPES_OUT_FILE: output,
        },
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    for (const partial of ['export type Json = string;', 'export type Database = {};', '']) {
      body = partial;
      writeFileSync(output, 'previous verified types\n');
      expect(await run()).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe('previous verified types\n');
    }
    body = 'export type Json = string;\nexport type Database = {};\n';
    expect(await run()).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('classifies a CLI SSL rejection without exposing diagnostics or replacing verified types', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tz-types-cli-ssl-'));
  const output = path.join(directory, 'database.types.ts');
  const cli = path.join(directory, 'supabase-fixture.mjs');
  const diagnostic = 'FIXTURE_PRIVATE_CLI_DIAGNOSTIC';
  writeFileSync(output, 'previous verified types\n');
  writeFileSync(cli, [
    '#!/usr/bin/env node',
    `process.stderr.write(${JSON.stringify(`The server does not support SSL connections. ${diagnostic}\n`)});`,
    'process.exit(1);',
  ].join('\n'));
  chmodSync(cli, 0o700);
  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn('node', [path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs')], {
        cwd: directory,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          PATH: process.env.PATH,
          SUPABASE_CLI: cli,
          SUPABASE_DB_URL: 'postgresql://postgres:fixture-password@127.0.0.1:5432/postgres',
          SUPABASE_TYPES_OUT_FILE: output,
        },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('failure_class=database_ssl_unsupported');
    expect(result.stderr).not.toContain(diagnostic);
    expect(result.stderr).not.toContain('fixture-password');
    expect(result.stderr).not.toContain('postgresql://');
    expect(readFileSync(output, 'utf8')).toBe('previous verified types\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('canonicalizes CLI line endings and trailing whitespace before writing types', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tz-types-cli-normalize-'));
  const output = path.join(directory, 'database.types.ts');
  const cli = path.join(directory, 'supabase-fixture.mjs');
  const generated = 'export type Json = string; \t\r\n \t\r\nexport type Database = {}; \t\r\n\t \r\n';
  writeFileSync(cli, [
    '#!/usr/bin/env node',
    `process.stdout.write(${JSON.stringify(generated)});`,
  ].join('\n'));
  chmodSync(cli, 0o700);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn('node', [path.resolve(import.meta.dir, '../scripts/supabase-gen-types.mjs')], {
        cwd: directory,
        stdio: 'ignore',
        env: {
          PATH: process.env.PATH,
          SUPABASE_CLI: cli,
          SUPABASE_DB_URL: 'postgresql://postgres:fixture-password@127.0.0.1:5432/postgres',
          SUPABASE_TYPES_OUT_FILE: output,
        },
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    expect(code).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('export type Json = string;\n\nexport type Database = {};\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
