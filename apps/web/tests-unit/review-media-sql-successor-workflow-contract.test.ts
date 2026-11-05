import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const workflowPath = new URL(
  '../../../.github/workflows/review-media-sql-successor.yml',
  import.meta.url,
);
const workflow = readFileSync(workflowPath, 'utf8');
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryDirectories: string[] = [];

function stepSource(name: string): string {
  const marker = `      - name: ${name}\n`;
  const stepStart = workflow.indexOf(marker);
  expect(stepStart).toBeGreaterThanOrEqual(0);
  const nextStep = workflow.indexOf('\n      - name: ', stepStart + marker.length);
  return workflow.slice(stepStart, nextStep < 0 ? undefined : nextStep);
}

function stepRun(name: string): string {
  const step = stepSource(name);
  const runMarker = '\n        run: |\n';
  const runStart = step.indexOf(runMarker);
  expect(runStart).toBeGreaterThanOrEqual(0);
  return step
    .slice(runStart + runMarker.length)
    .split('\n')
    .map((line) => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n');
}

function runBash(script: string, cwd: string, environment: Record<string, string>) {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

function waitForProcess(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function createDetachedRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-successor-workflow-'));
  temporaryDirectories.push(directory);
  const commands = [
    ['init', '-q'],
    ['config', 'user.name', 'Workflow Contract'],
    ['config', 'user.email', 'workflow-contract@example.invalid'],
  ];
  for (const args of commands) {
    expect(spawnSync('git', args, { cwd: directory }).status).toBe(0);
  }
  writeFileSync(join(directory, 'source.txt'), 'protected main source\n');
  expect(spawnSync('git', ['add', 'source.txt'], { cwd: directory }).status).toBe(0);
  expect(spawnSync('git', ['commit', '-qm', 'source'], { cwd: directory }).status).toBe(0);
  expect(spawnSync('git', ['checkout', '--detach', '-q'], { cwd: directory }).status).toBe(0);
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: directory,
    encoding: 'utf8',
  }).stdout.trim();
  return { directory, revision };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe('review-media SQL successor manual workflow', () => {
  test('admits only an authenticated owner dispatch at exact detached protected main', () => {
    const verify = stepRun('Verify authenticated owner dispatch and detached source');
    const { directory, revision } = createDetachedRepository();
    const common = {
      APPLY_CONFIRMATION: '',
      EXPECTED_MODE: 'observe',
      EXPECTED_SOURCE_SHA: revision,
      GITHUB_ACTOR: 'twoimo',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REF_NAME: 'main',
      GITHUB_REF_PROTECTED: 'true',
      GITHUB_REPOSITORY: 'twoimo/tzudong',
      GITHUB_SHA: revision,
      LOCAL_VERCEL_BUNDLE_SHA256: 'a'.repeat(64),
      REPOSITORY_OWNER: 'twoimo',
      SENDER_LOGIN: 'twoimo',
      TRIGGERING_ACTOR: 'twoimo',
    };

    expect(runBash(verify, directory, common).status).toBe(0);
    expect(runBash(verify, directory, {
      ...common,
      EXPECTED_MODE: 'apply',
      APPLY_CONFIRMATION: `apply:${revision}:${common.LOCAL_VERCEL_BUNDLE_SHA256}`,
    }).status).toBe(0);
    expect(runBash(verify, directory, { ...common, GITHUB_ACTOR: 'other' }).status).not.toBe(0);
    expect(runBash(verify, directory, { ...common, EXPECTED_SOURCE_SHA: '0'.repeat(40) }).status).not.toBe(0);
    expect(runBash(verify, directory, { ...common, APPLY_CONFIRMATION: 'unexpected' }).status).not.toBe(0);
    expect(runBash(verify, directory, { ...common, EXPECTED_MODE: 'apply' }).status).not.toBe(0);
  }, 15_000);

  test('creates one bounded private input and leaves custody creation to the orchestrator', () => {
    const prepare = stepRun('Create private exclusive operating input and serialized runner');
    const runnerTemp = mkdtempSync(join(tmpdir(), 'tzudong-successor-runner-'));
    temporaryDirectories.push(runnerTemp);
    const output = join(runnerTemp, 'github-output');
    writeFileSync(output, '');
    const evidence = '{"kind":"sanitized-local-vercel-evidence"}\n';
    const evidenceSha256 = createHash('sha256').update(evidence).digest('hex');
    const result = runBash(prepare, runnerTemp, {
      GITHUB_OUTPUT: output,
      LOCAL_VERCEL_BUNDLE_SHA256: evidenceSha256,
      LOCAL_VERCEL_EVIDENCE: evidence,
      RUNNER_TEMP: runnerTemp,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    expect(readFileSync(outputs.operating_input, 'utf8')).toBe(evidence);
    expect(statSync(outputs.operating_input).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(outputs.operating_input)).mode & 0o777).toBe(0o700);
    expect(statSync(outputs.serialized_runner).mode & 0o777).toBe(0o700);
    expect(statSync(outputs.vercel_readback_adapter).mode & 0o777).toBe(0o700);
    expect(existsSync(outputs.custody_dir)).toBe(false);

    const oversizedOutput = join(runnerTemp, 'oversized-output');
    writeFileSync(oversizedOutput, '');
    expect(runBash(prepare, runnerTemp, {
      GITHUB_OUTPUT: oversizedOutput,
      LOCAL_VERCEL_BUNDLE_SHA256: evidenceSha256,
      LOCAL_VERCEL_EVIDENCE: 'x'.repeat(8193),
      RUNNER_TEMP: runnerTemp,
    }).status).not.toBe(0);
    expect(readFileSync(oversizedOutput, 'utf8')).toBe('');
  });

  test('preserves accepted dispatches and serializes their operating commands without cancellation', async () => {
    expect(workflow).toContain('permissions:\n  actions: read\n  contents: read');
    expect(workflow).toContain('group: review-media-sql-successor-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).not.toMatch(/^\s+queue:/m);
    expect(workflow).not.toMatch(/^\s+(?:id-token|attestations|packages|pull-requests|security-events):/m);
    expect(workflow).not.toContain('contents: write');
    expect(workflow).not.toContain('actions: write');

    const prepare = stepRun('Create private exclusive operating input and serialized runner');
    const runnerTemp = mkdtempSync(join(tmpdir(), 'tzudong-successor-serialization-'));
    temporaryDirectories.push(runnerTemp);
    const output = join(runnerTemp, 'github-output');
    const evidence = '{"kind":"sanitized-local-vercel-evidence"}\n';
    writeFileSync(output, '');
    expect(runBash(prepare, runnerTemp, {
      GITHUB_OUTPUT: output,
      LOCAL_VERCEL_BUNDLE_SHA256: createHash('sha256').update(evidence).digest('hex'),
      LOCAL_VERCEL_EVIDENCE: evidence,
      RUNNER_TEMP: runnerTemp,
    }).status).toBe(0);
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const fakeBin = join(runnerTemp, 'bin');
    expect(spawnSync('mkdir', ['-p', fakeBin]).status).toBe(0);
    writeFileSync(join(fakeBin, 'psql'), `#!/usr/bin/env bash
set -euo pipefail
while IFS= read -r line
do
  case "$line" in
    *pg_advisory_xact_lock*)
      until mkdir "$SERIALIZER_TEST_LOCK" 2>/dev/null; do sleep 0.01; done
      printf '\n'
      ;;
    '\\echo REVIEW_MEDIA_SQL_SUCCESSOR_LOCKED')
      printf '%s\\n' REVIEW_MEDIA_SQL_SUCCESSOR_LOCKED
      ;;
    'ROLLBACK;')
      rmdir "$SERIALIZER_TEST_LOCK"
      ;;
    '\\quit')
      exit 0
      ;;
  esac
done
`, { mode: 0o700 });
    writeFileSync(join(fakeBin, 'node'), `#!/usr/bin/env bash
set -euo pipefail
printf 'start:%s\\n' "$3" >> "$SERIALIZER_TEST_LOG"
sleep 0.1
printf 'end:%s\\n' "$3" >> "$SERIALIZER_TEST_LOG"
`, { mode: 0o700 });
    const serializationLog = join(runnerTemp, 'serialization.log');
    const commonEnvironment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SERIALIZER_TEST_LOCK: join(runnerTemp, 'database-lock'),
      SERIALIZER_TEST_LOG: serializationLog,
      EXPECTED_SOURCE_SHA: 'a'.repeat(40),
      SUPABASE_DB_URL: 'postgresql://workflow-contract.invalid/database',
    };
    const command = (mode: 'observe' | 'rehearse') => [
      'node',
      'apps/web/scripts/review-media-operating-orchestrator.mjs',
      '--mode', mode,
      '--input', outputs.operating_input,
      '--custody-dir', outputs.custody_dir,
    ];
    const first = spawn(outputs.serialized_runner, command('observe'), {
      cwd: runnerTemp,
      env: commonEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const second = spawn(outputs.serialized_runner, command('rehearse'), {
      cwd: runnerTemp,
      env: commonEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const results = await Promise.all([waitForProcess(first), waitForProcess(second)]);
    expect(results).toEqual([
      { code: 0, stdout: '', stderr: '' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const events = readFileSync(serializationLog, 'utf8').trim().split('\n');
    expect(events).toHaveLength(4);
    expect(events[0].startsWith('start:')).toBe(true);
    expect(events[1]).toBe(events[0].replace('start:', 'end:'));
    expect(events[2].startsWith('start:')).toBe(true);
    expect(events[3]).toBe(events[2].replace('start:', 'end:'));
    expect(statSync(join(dirname(outputs.operating_input), 'serializer.stderr')).mode & 0o777).toBe(0o600);
  });

  test('freshly observes every feature rollback callback and fails closed before feature DB entry', () => {
    const sourceRevision = 'a'.repeat(40);
    const policySha256 = 'e'.repeat(64);
    const canonical = (value: unknown): unknown => Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
        : value;
    const evidenceFor = (includePolicy: boolean) => `${JSON.stringify(canonical({
      adminRecordMutationsHold: {
        commit: sourceRevision,
        deploymentId: 'dpl_WorkflowContract',
      },
      kind: 'review-media-successor-vercel-operating-bundle',
      rollbackReadback: {
        deploymentId: 'dpl_WorkflowContract',
        deploymentUrl: 'https://tzudong-workflow-contract.vercel.app/',
        gitRef: 'main',
        gitSha: sourceRevision,
        observedAt: '2026-10-14T00:00:00.000Z',
        productionAliases: ['tzudong.app', 'www.tzudong.app'],
        projectId: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
        readyState: 'READY',
        repository: 'twoimo/tzudong',
        target: 'production',
        teamId: 'team_OUj64KeLxJI3PkEbOaFZnorA',
      },
      schemaVersion: 1,
      sourceRevision,
      ...(includePolicy ? {
        storyboardPolicy: {
          deployment: {
            branch: 'main',
            deploymentId: 'dpl_WorkflowContract',
            sourceCommit: sourceRevision,
          },
          policy: { canonicalPolicySha256: policySha256 },
          schemaVersion: 1,
        },
      } : {}),
    }))}\n`;

    const createScenario = ({
      failurePhase = '',
      includePolicy = true,
      tokenAvailable = true,
      vendorMode = 'match',
    }: {
      failurePhase?: string;
      includePolicy?: boolean;
      tokenAvailable?: boolean;
      vendorMode?: 'match' | 'unavailable' | 'wrong-alias' | 'wrong-identity';
    } = {}) => {
      const runnerTemp = mkdtempSync(join(tmpdir(), 'tzudong-successor-feature-chain-'));
      temporaryDirectories.push(runnerTemp);
      const output = join(runnerTemp, 'github-output');
      const evidence = evidenceFor(includePolicy);
      const evidenceSha256 = createHash('sha256').update(evidence).digest('hex');
      writeFileSync(output, '');
      const prepared = runBash(
        stepRun('Create private exclusive operating input and serialized runner'),
        runnerTemp,
        {
          GITHUB_OUTPUT: output,
          LOCAL_VERCEL_BUNDLE_SHA256: evidenceSha256,
          LOCAL_VERCEL_EVIDENCE: evidence,
          RUNNER_TEMP: runnerTemp,
        },
      );
      expect(prepared.status).toBe(0);
      const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
      const fakeBin = join(runnerTemp, 'bin');
      expect(spawnSync('mkdir', ['-p', fakeBin]).status).toBe(0);
      const baseDbLog = join(runnerTemp, 'base-db.log');
      const featureDbLog = join(runnerTemp, 'feature-db.log');
      const vendorLog = join(runnerTemp, 'vendor.log');
      writeFileSync(join(runnerTemp, 'vendor-mode'), `${vendorMode}\n`);
      writeFileSync(join(fakeBin, 'psql'), `#!/usr/bin/env bash
set -euo pipefail
while IFS= read -r line
do
  case "$line" in
    *pg_advisory_xact_lock*) printf '\n' ;;
    '\\echo REVIEW_MEDIA_SQL_SUCCESSOR_LOCKED') printf '%s\\n' REVIEW_MEDIA_SQL_SUCCESSOR_LOCKED ;;
    '\\quit') exit 0 ;;
  esac
done
`, { mode: 0o700 });
      writeFileSync(join(fakeBin, 'vercel'), `#!/usr/bin/env bash
set -euo pipefail
test "$#" = 7
test "$1" = api
test "$3" = --scope
test "$4" = team_OUj64KeLxJI3PkEbOaFZnorA
test "$5" = --raw
test "$6" = --non-interactive
test "$7" = --no-color
test "$VERCEL_ORG_ID" = team_OUj64KeLxJI3PkEbOaFZnorA
test "$VERCEL_PROJECT_ID" = prj_sau35J5uUtShIQ9OKofRtOVVnTSl
test "$VERCEL_TOKEN" = "$(printf '%020d' 0)"
test -z "\${SUPABASE_DB_URL:-}"
test -z "\${GITHUB_TOKEN:-}"
endpoint=$2
vendor_mode="$(cat "$HOME/vendor-mode")"
printf '%s\\n' "$endpoint" >> "$HOME/vendor.log"
if [[ "$vendor_mode" = unavailable ]]
then
  exit 1
fi
deployment_id=dpl_WorkflowContract
if [[ "$vendor_mode" = wrong-identity ]]
then
  deployment_id=dpl_WrongIdentity
fi
case "$endpoint" in
  /v13/deployments/*)
    printf '{"id":"%s","meta":{"githubCommitOrg":"twoimo","githubCommitRef":"main","githubCommitRepo":"tzudong","githubCommitSha":"${sourceRevision}"},"ownerId":"team_OUj64KeLxJI3PkEbOaFZnorA","projectId":"prj_sau35J5uUtShIQ9OKofRtOVVnTSl","readyState":"READY","target":"production","url":"tzudong-workflow-contract.vercel.app"}' "$deployment_id"
    ;;
  */aliases/tzudong.app*)
    alias=tzudong.app
    if [[ "$vendor_mode" = wrong-alias ]]; then alias=www.tzudong.app; fi
    printf '{"alias":"%s","deployment":{"id":"%s"},"deploymentId":"%s","projectId":"prj_sau35J5uUtShIQ9OKofRtOVVnTSl"}' "$alias" "$deployment_id" "$deployment_id"
    ;;
  */aliases/www.tzudong.app*)
    printf '{"alias":"www.tzudong.app","deployment":{"id":"%s"},"deploymentId":"%s","projectId":"prj_sau35J5uUtShIQ9OKofRtOVVnTSl"}' "$deployment_id" "$deployment_id"
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
      writeFileSync(join(fakeBin, 'node'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = --input-type=module ]]
then
  exec "$REAL_NODE" "$@"
fi
if [[ "$1" = "$VERCEL_CLI_PATH" ]]
then
  exec "$REAL_NODE" "$@"
fi
script=$1
mode=$3
if [[ "$script" = apps/web/scripts/review-media-operating-orchestrator.mjs ]]
then
  custody=$7
  mkdir "$custody"
  printf '%s\n' base >> "$BASE_DB_LOG"
  printf '{"code":"SUCCESSOR_COMMITTED","custodyDirectory":"%s","expiresAt":"2030-01-01T00:15:00.000Z","mode":"apply","sourceRevision":"%s","status":"committed"}\\n' "$custody" "$EXPECTED_SOURCE_SHA"
  exit 0
fi
if [[ "$script" != apps/web/scripts/review-media-feature-sql-successor.mjs ]]
then
  exit 2
fi
custody=$5
printf '%s\\n' "$mode" >> "$FEATURE_PHASE_LOG"
for endpoint in \\
  '/v13/deployments/dpl_WorkflowContract?teamId=team_OUj64KeLxJI3PkEbOaFZnorA' \\
  '/v4/aliases/tzudong.app?teamId=team_OUj64KeLxJI3PkEbOaFZnorA' \\
  '/v4/aliases/www.tzudong.app?teamId=team_OUj64KeLxJI3PkEbOaFZnorA'
do
  "$REAL_NODE" "$VERCEL_CLI_PATH" api "$endpoint" --scope team_OUj64KeLxJI3PkEbOaFZnorA --raw >/dev/null
done
printf 'db:%s\\n' "$mode" >> "$FEATURE_DB_LOG"
if [[ -n "$FAIL_FEATURE_PHASE" && "$mode" = "$FAIL_FEATURE_PHASE" ]]
then
  printf '%s\\n' raw-feature-diagnostic >&2
  exit 1
fi
case "$mode" in
  prepare-rehearsal)
    : > "$custody/feature-rehearsal-admission.json"
    printf '{"admissionPath":"%s/feature-rehearsal-admission.json","admissionSha256":"%s","expiresAt":"2030-01-01T00:15:00.000Z","journalPath":"%s/feature-rehearsal-journal.jsonl","mode":"rehearsal","receiptPath":"%s/feature-rehearsal-receipt.json","status":"prepared"}\\n' "$custody" "${'b'.repeat(64)}" "$custody" "$custody"
    ;;
  rehearsal)
    printf '{"attemptId":"feature-rehearsal","code":"FEATURE_SUCCESSOR_REHEARSAL_PASSED","receiptSha256":"%s","sourceRevision":"%s","status":"rolled_back"}\\n' "${'c'.repeat(64)}" "$EXPECTED_SOURCE_SHA"
    ;;
  prepare-apply)
    : > "$custody/feature-apply-admission.json"
    printf '{"admissionPath":"%s/feature-apply-admission.json","admissionSha256":"%s","expiresAt":"2030-01-01T00:15:00.000Z","journalPath":"%s/feature-apply-journal.jsonl","mode":"apply","status":"prepared"}\\n' "$custody" "${'d'.repeat(64)}" "$custody"
    ;;
  apply)
    printf '{"attemptId":"feature-apply","code":"FEATURE_SUCCESSOR_COMMITTED","sourceRevision":"%s","status":"committed","terminal":{}}\\n' "$EXPECTED_SOURCE_SHA"
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
      const phaseLog = join(runnerTemp, 'feature-phases.log');
      const result = spawnSync(outputs.serialized_runner, [
        'apply-chain', outputs.operating_input, outputs.custody_dir,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          BASE_DB_LOG: baseDbLog,
          EXPECTED_SOURCE_SHA: sourceRevision,
          FAIL_FEATURE_PHASE: failurePhase,
          FEATURE_DB_LOG: featureDbLog,
          FEATURE_PHASE_LOG: phaseLog,
          HOME: runnerTemp,
          LOCAL_VERCEL_BUNDLE_SHA256: evidenceSha256,
          PATH: `${fakeBin}:${process.env.PATH}`,
          REAL_NODE: spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim(),
          SUPABASE_DB_URL: 'postgresql://workflow-contract.invalid/database',
          VERCEL_CLI_PATH: outputs.vercel_readback_adapter,
          VERCEL_ORG_ID: 'team_OUj64KeLxJI3PkEbOaFZnorA',
          VERCEL_PROJECT_ID: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl',
          VERCEL_TOKEN: tokenAvailable ? '0'.repeat(20) : '',
          VERCEL_VENDOR_CLI_PATH: join(fakeBin, 'vercel'),
          GITHUB_ACTIONS: 'true',
        },
      });
      return {
        baseDbLog,
        evidence,
        featureDbLog,
        outputs,
        phaseLog,
        result,
        vendorLog,
      };
    };

    const success = createScenario();
    expect({
      phases: existsSync(success.phaseLog) ? readFileSync(success.phaseLog, 'utf8') : '',
      status: success.result.status,
      stderr: success.result.stderr,
      stdout: success.result.stdout,
    }).toEqual({
      phases: 'prepare-rehearsal\nrehearsal\nprepare-apply\napply\n',
      status: 0,
      stderr: '',
      stdout: '{"code":"SUCCESSOR_AND_FEATURE_COMMITTED","featureStatus":"committed","predecessorCode":"SUCCESSOR_COMMITTED","predecessorStatus":"committed","status":"committed"}\n',
    });
    expect(readFileSync(success.featureDbLog, 'utf8')).toBe(
      'db:prepare-rehearsal\ndb:rehearsal\ndb:prepare-apply\ndb:apply\n',
    );
    expect(readFileSync(success.vendorLog, 'utf8')).toBe(
      ('/v13/deployments/dpl_WorkflowContract?teamId=team_OUj64KeLxJI3PkEbOaFZnorA\n'
      + '/v4/aliases/tzudong.app?teamId=team_OUj64KeLxJI3PkEbOaFZnorA\n'
      + '/v4/aliases/www.tzudong.app?teamId=team_OUj64KeLxJI3PkEbOaFZnorA\n').repeat(5),
    );
    expect(readFileSync(success.baseDbLog, 'utf8')).toBe('base\n');
    expect(readFileSync(success.outputs.operating_input, 'utf8')).toBe(success.evidence);
    expect(statSync(join(dirname(success.outputs.operating_input), 'feature-apply.stdout.json')).mode & 0o777).toBe(0o600);

    const held = createScenario({ failurePhase: 'rehearsal' });
    expect(held.result.status).not.toBe(0);
    expect(held.result.stderr).toBe('');
    expect(held.result.stdout).toBe('{"code":"SUCCESSOR_COMMITTED_FEATURE_HELD","featureStatus":"held","predecessorCode":"SUCCESSOR_COMMITTED","predecessorStatus":"committed","status":"partial"}\n');
    expect(readFileSync(held.phaseLog, 'utf8')).toBe('prepare-rehearsal\nrehearsal\n');
    expect(readFileSync(join(dirname(held.outputs.operating_input), 'feature-rehearsal.stderr'), 'utf8')).toBe('raw-feature-diagnostic\n');

    for (const scenario of [
      { includePolicy: true, vendorMode: 'wrong-identity' as const },
      { includePolicy: true, vendorMode: 'wrong-alias' as const },
      { includePolicy: true, vendorMode: 'unavailable' as const },
      { includePolicy: false, vendorMode: 'match' as const },
    ]) {
      const rejected = createScenario(scenario);
      expect(rejected.result.status).not.toBe(0);
      expect(rejected.result.stderr).toBe('');
      expect(rejected.result.stdout).toBe(
        '{"code":"SUCCESSOR_VERCEL_READBACK_UNCONFIRMED","status":"failed"}\n',
      );
      expect(existsSync(rejected.baseDbLog)).toBe(false);
      expect(existsSync(rejected.featureDbLog)).toBe(false);
      expect(existsSync(rejected.phaseLog)).toBe(false);
      if (scenario.includePolicy) {
        const first = '/v13/deployments/dpl_WorkflowContract?teamId=team_OUj64KeLxJI3PkEbOaFZnorA\n';
        const alias = '/v4/aliases/tzudong.app?teamId=team_OUj64KeLxJI3PkEbOaFZnorA\n';
        expect(readFileSync(rejected.vendorLog, 'utf8')).toBe(
          scenario.vendorMode === 'wrong-alias' ? first + alias : first,
        );
      } else {
        expect(existsSync(rejected.vendorLog)).toBe(false);
      }
    }

    const missingToken = createScenario({ tokenAvailable: false });
    expect(missingToken.result.status).not.toBe(0);
    expect(missingToken.result.stderr).toBe('');
    expect(missingToken.result.stdout).toBe(
      '{"code":"SUCCESSOR_VERCEL_READBACK_UNCONFIRMED","status":"failed"}\n',
    );
    expect(existsSync(missingToken.baseDbLog)).toBe(false);
    expect(existsSync(missingToken.featureDbLog)).toBe(false);
    expect(existsSync(missingToken.vendorLog)).toBe(false);
  }, 30_000);

  test('uses pinned Node 24 and bounded PostgreSQL-backed operating paths', () => {
    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24');
    expect(workflow).toContain('actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd');
    expect(workflow).toContain('actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e');
    expect(workflow).toContain("node-version: '24.21.0'");
    expect(workflow).toContain("manifest.engines?.node !== '24.x'");
    expect(workflow).toContain("manifest.packageManager !== 'npm@11.6.2'");
    expect(workflow).toContain("VERCEL_CLI_VERSION: '56.5.0'");
    expect(workflow).toContain('npm install --global --no-audit --no-fund --ignore-scripts "vercel@$VERCEL_CLI_VERSION"');
    expect(workflow).toContain('test "$(vercel --version)" = "$VERCEL_CLI_VERSION"');
    expect(workflow).toContain('sudo apt-get -q install --no-install-recommends -y postgresql-client');
    expect(workflow).toContain('timeout --signal=TERM --kill-after=10s 840s');
    expect(workflow).toContain('timeout-minutes: 20');
  });

  test('keeps observe and rehearse on the eleven-stage CLI and adds the feature chain only to apply', () => {
    const invocations = [...workflow.matchAll(
      /"\$SERIALIZED_RUNNER"\n\s+node apps\/web\/scripts\/review-media-operating-orchestrator\.mjs\n\s+--mode (observe|rehearse)\n\s+--input "\$OPERATING_INPUT"\n\s+--custody-dir "\$PRIVATE_CUSTODY_DIR"/g,
    )].map((match) => match[1]);
    expect(invocations).toEqual(['observe', 'rehearse']);
    expect(stepSource('Observe held successor state')).not.toContain('review-media-feature-sql-successor.mjs');
    expect(stepSource('Rehearse held successor transaction')).not.toContain('review-media-feature-sql-successor.mjs');
    expect(stepSource('Apply explicitly confirmed successor transaction')).toContain(
      '"$SERIALIZED_RUNNER" \\\n            apply-chain "$OPERATING_INPUT" "$PRIVATE_CUSTODY_DIR"',
    );
    expect(workflow).toContain('for phase in prepare-rehearsal rehearsal prepare-apply apply');
    expect(workflow).toContain('apps/web/scripts/review-media-feature-sql-successor.mjs');
    expect(workflow).toContain('SUCCESSOR_COMMITTED_FEATURE_HELD');
    expect(workflow).toContain('SUCCESSOR_AND_FEATURE_COMMITTED');
    expect(workflow.match(/EXPECTED_SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/g)).toHaveLength(4);
    expect(workflow.match(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/g)).toHaveLength(3);
    expect(workflow.match(/OPERATOR_ACTOR: \$\{\{ github\.actor \}\}/g)).toHaveLength(3);
    expect(workflow.match(/OPERATOR_ACTOR_ID: \$\{\{ github\.actor_id \}\}/g)).toHaveLength(3);
    expect(workflow.match(/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/g)).toHaveLength(3);
    expect(workflow.match(/SERIALIZED_RUNNER: \$\{\{ steps\.custody\.outputs\.serialized_runner \}\}/g)).toHaveLength(3);
    expect(workflow.match(/VERCEL_CLI_PATH: \$\{\{ steps\.custody\.outputs\.vercel_readback_adapter \}\}/g)).toHaveLength(1);
    expect(workflow).toContain('LOCAL_VERCEL_BUNDLE_SHA256: ${{ inputs.local_vercel_bundle_sha256 }}');
    expect(workflow).toContain('const vendor = spawnSync(vendorCliPath');
    expect(workflow).toContain('return vendor.stdout');
    expect(workflow).not.toContain('process.stdout.write(JSON.stringify(result))');
    expect(workflow).toContain('result?.readyState !== readback.readyState');
    expect(workflow).toContain("CI: 'true'");
    expect(workflow).not.toContain('SUPABASE_DB_URL: process.env.SUPABASE_DB_URL');
    expect(workflow).not.toContain('GITHUB_TOKEN: process.env.GITHUB_TOKEN');
    expect(workflow).toContain("if ! node \"$VERCEL_CLI_PATH\" verify >/dev/null 2>&1");
    expect(workflow).toContain('SUCCESSOR_VERCEL_READBACK_UNCONFIRMED');
    expect(workflow).not.toContain('process.stdout.write(observer');
    expect(workflow.match(/secrets\.[A-Z0-9_]+/g)).toEqual([
      'secrets.SUPABASE_DB_URL',
      'secrets.SUPABASE_DB_URL',
      'secrets.SUPABASE_DB_URL',
      'secrets.VERCEL_TOKEN',
    ]);
    expect(workflow).toContain("VERCEL_ORG_ID: 'team_OUj64KeLxJI3PkEbOaFZnorA'");
    expect(workflow).toContain("VERCEL_PROJECT_ID: 'prj_sau35J5uUtShIQ9OKofRtOVVnTSl'");
    expect(workflow).toContain('VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}');
    expect(workflow).toContain('VERCEL_VENDOR_CLI_PATH: ${{ steps.vercel-cli.outputs.cli_path }}');
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).not.toContain('download-artifact');
  });
});
