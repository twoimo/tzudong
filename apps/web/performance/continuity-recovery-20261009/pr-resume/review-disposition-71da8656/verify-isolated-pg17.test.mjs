import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-isolated-pg17.mjs');

function fixtureRun(value) {
  const root = mkdtempSync(resolve(os.tmpdir(), 'tzudong-pg17-contract-'));
  const path = resolve(root, 'fixture.json');
  writeFileSync(path, JSON.stringify(value));
  const run = spawnSync(process.execPath, [script, '--engine-contract-fixture', path], { encoding: 'utf8' });
  rmSync(root, { recursive: true, force: true });
  return { run, result: JSON.parse(run.stdout) };
}

const pg17 = {
  pgConfigVersion: 'pg_config (PostgreSQL) 17.6',
  initdbVersion: 'initdb (PostgreSQL) 17.6',
  pgCtlVersion: 'pg_ctl (PostgreSQL) 17.6',
  psqlVersion: 'psql (PostgreSQL) 17.6',
  serverVersionNum: '170006',
};

test('engine contract passes only with PostgreSQL 17 before and after startup', () => {
  const accepted = fixtureRun(pg17);
  assert.equal(accepted.run.status, 0);
  assert.equal(accepted.result.status, 'passed');
  assert.equal(accepted.result.engine, 'postgresql-17');
  assert.equal(accepted.result.engineVerification.preStartupPassed, true);
  assert.equal(accepted.result.engineVerification.postStartupPassed, true);

  const pre16 = fixtureRun({ ...pg17, pgConfigVersion: 'pg_config (PostgreSQL) 16.10' });
  assert.equal(pre16.run.status, 1);
  assert.equal(pre16.result.status, 'rejected');
  assert.equal(pre16.result.engine, null);
  assert.equal(pre16.result.failure.code, 'POSTGRES_MAJOR_UNSUPPORTED');

  const post16 = fixtureRun({ ...pg17, serverVersionNum: '160010' });
  assert.equal(post16.run.status, 1);
  assert.equal(post16.result.status, 'rejected');
  assert.equal(post16.result.engine, null);
  assert.equal(post16.result.failure.code, 'POSTGRES_SERVER_MAJOR_UNSUPPORTED');
});

test('PATH supplied PostgreSQL 16 is rejected before initdb startup', () => {
  const root = mkdtempSync(resolve(os.tmpdir(), 'tzudong-pg16-path-'));
  const bin = resolve(root, 'bin');
  const marker = resolve(root, 'initdb-started');
  mkdirSync(bin);
  const scripts = {
    pg_config: `#!/bin/sh\nif [ "$1" = "--bindir" ]; then echo "${bin}"; else echo "pg_config (PostgreSQL) 16.10"; fi\n`,
    initdb: `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "initdb (PostgreSQL) 16.10"; else touch "${marker}"; fi\n`,
    pg_ctl: '#!/bin/sh\necho "pg_ctl (PostgreSQL) 16.10"\n',
    psql: '#!/bin/sh\necho "psql (PostgreSQL) 16.10"\n',
  };
  for (const [name, source] of Object.entries(scripts)) {
    const path = resolve(bin, name);
    writeFileSync(path, source);
    chmodSync(path, 0o700);
  }
  const run = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const result = JSON.parse(run.stdout);
  assert.equal(run.status, 1);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.engine, null);
  assert.equal(result.failure.code, 'POSTGRES_MAJOR_UNSUPPORTED');
  assert.equal(result.cleanup.removed, true);
  assert.equal(existsSync(marker), false);
  rmSync(root, { recursive: true, force: true });
});
