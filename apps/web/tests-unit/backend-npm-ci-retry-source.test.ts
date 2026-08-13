import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const workflowPath = join(repositoryRoot, '.github/workflows/web-admin-ci.yml');
const installerPath = join(repositoryRoot, '.github/scripts/install-backend-npm-dependencies.sh');
const workflowSource = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const installerSource = readFileSync(installerPath, 'utf8').replace(/\r\n/g, '\n');

type Scenario = {
  failureCount?: number;
  failureKind?: 'deterministic' | 'transient';
  npmVersion?: string;
};

function runScenario(scenario: Scenario = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'tzudong-backend-npm-retry-'));
  const binDir = join(fixtureRoot, 'bin');
  const callLog = join(fixtureRoot, 'calls.log');
  const countFile = join(fixtureRoot, 'count');
  const sleepLog = join(fixtureRoot, 'sleep.log');

  try {
    mkdirSync(binDir);
    const fakeNpm = join(binDir, 'npm');
    const fakeSleep = join(binDir, 'sleep');
    writeFileSync(fakeNpm, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == '--version' ]]; then
  printf 'version\\n' >> "$FAKE_CALL_LOG"
  printf '%s\\n' "$FAKE_NPM_VERSION"
  exit 0
fi
printf 'ci:%s\\n' "$*" >> "$FAKE_CALL_LOG"
if [[ "$*" != 'ci --prefix backend' ]]; then
  exit 97
fi
count=0
if [[ -s "$FAKE_COUNT_FILE" ]]; then
  read -r count < "$FAKE_COUNT_FILE"
fi
count=$((count + 1))
printf '%s\\n' "$count" > "$FAKE_COUNT_FILE"
if (( count <= FAKE_FAILURE_COUNT )); then
  if [[ "$FAKE_FAILURE_KIND" == 'transient' ]]; then
    echo 'npm error ECONNRESET: socket hang up' >&2
    exit 42
  fi
  echo 'npm error EUSAGE: package-lock mismatch' >&2
  exit 17
fi
echo 'installed'
`, 'utf8');
    writeFileSync(fakeSleep, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_SLEEP_LOG"
`, 'utf8');
    chmodSync(fakeNpm, 0o755);
    chmodSync(fakeSleep, 0o755);

    const result = spawnSync('bash', [installerPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixtureRoot,
        FAKE_CALL_LOG: callLog,
        FAKE_COUNT_FILE: countFile,
        FAKE_SLEEP_LOG: sleepLog,
        FAKE_FAILURE_COUNT: String(scenario.failureCount ?? 0),
        FAKE_FAILURE_KIND: scenario.failureKind ?? 'transient',
        FAKE_NPM_VERSION: scenario.npmVersion ?? '11.6.2',
      },
    });

    const lines = (path: string) => {
      try {
        return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    };
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls: lines(callLog),
      sleeps: lines(sleepLog),
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe('backend npm clean-install retry contract', () => {
  test('keeps the retry boundary scoped to the backend clean install', () => {
    expect(workflowSource).toContain('name: Install backend dependencies with bounded network retry');
    expect(workflowSource).toContain('run: bash ../../.github/scripts/install-backend-npm-dependencies.sh');
    expect(installerSource).toContain("readonly expected_npm_version='11.6.2'");
    expect(installerSource).toContain('readonly max_attempts=3');
    expect(installerSource).toContain('"$npm_bin" ci --prefix backend');
    expect(installerSource).toContain('backoff_seconds=$((attempt * 10))');
    expect(installerSource).not.toMatch(/--ignore-scripts|--no-package-lock|--package-lock-only|npm cache clean|rm -rf/);
  });

  test('runs once on success with the exact npm authority and clean-install arguments', () => {
    const result = runScenario();
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['version', 'ci:ci --prefix backend']);
    expect(result.sleeps).toEqual([]);
  });

  test('retries only transient network failures with bounded backoff', () => {
    const result = runScenario({ failureCount: 2, failureKind: 'transient' });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      'version', 'ci:ci --prefix backend',
      'version', 'ci:ci --prefix backend',
      'version', 'ci:ci --prefix backend',
    ]);
    expect(result.sleeps).toEqual(['10', '20']);
  });

  test('fails a deterministic install error immediately with its original status', () => {
    const result = runScenario({ failureCount: 3, failureKind: 'deterministic' });
    expect(result.status).toBe(17);
    expect(result.calls).toEqual(['version', 'ci:ci --prefix backend']);
    expect(result.sleeps).toEqual([]);
  });

  test('fails a persistent transient after exactly three attempts', () => {
    const result = runScenario({ failureCount: 9, failureKind: 'transient' });
    expect(result.status).toBe(42);
    expect(result.calls).toHaveLength(6);
    expect(result.calls.filter((line) => line === 'version')).toHaveLength(3);
    expect(result.calls.filter((line) => line === 'ci:ci --prefix backend')).toHaveLength(3);
    expect(result.sleeps).toEqual(['10', '20']);
  });

  test('fails before install when the npm authority drifts', () => {
    const result = runScenario({ npmVersion: '11.6.1' });
    expect(result.status).toBe(1);
    expect(result.calls).toEqual(['version']);
    expect(result.sleeps).toEqual([]);
    expect(result.stderr).toContain('expected npm 11.6.2, got 11.6.1');
  });
});
