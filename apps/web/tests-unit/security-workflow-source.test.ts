import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const workflowPath = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'security-audit.yml');
const source = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

function jobBlock(name: string) {
  const marker = `  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing job: ${name}`);
  const remainder = source.slice(start + marker.length);
  const nextJob = remainder.search(/^  [A-Za-z0-9_-]+:\s*$/m);
  return nextJob < 0 ? source.slice(start) : source.slice(start, start + marker.length + nextJob);
}

function stepRunBlock(jobName: string, stepName: string) {
  const lines = jobBlock(jobName).split('\n');
  const step = lines.indexOf(`      - name: ${stepName}`);
  if (step < 0 || lines[step + 1] !== '        run: |') {
    throw new Error(`missing literal run block: ${jobName}/${stepName}`);
  }

  const commands: string[] = [];
  for (const line of lines.slice(step + 2)) {
    if (line !== '' && !line.startsWith('          ')) break;
    commands.push(line.slice(10));
  }
  while (commands.at(-1) === '') commands.pop();
  if (commands.length === 0) throw new Error(`empty literal run block: ${jobName}/${stepName}`);
  return `${commands.join('\n')}\n`;
}

type AuditHarness = {
  attempts: string[];
  status: number | null;
  signal: NodeJS.Signals | null;
};

function runAuditBlock(kind: 'npm' | 'python', script: string, failTarget = ''): AuditHarness {
  const root = mkdtempSync(join(tmpdir(), `tzudong-security-${kind}-`));
  const canonicalRoot = realpathSync(root);
  const bin = join(root, 'bin');
  const log = join(root, 'attempts.log');
  mkdirSync(bin);
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  mkdirSync(join(root, 'backend'), { recursive: true });

  const fakeNpm = `#!/bin/bash
set -u
project="\${PWD#"$AUDIT_TEST_ROOT"/}"
printf '%s|%s\\n' "$project" "$*" >> "$AUDIT_ATTEMPT_LOG"
if [[ "$project" == "$AUDIT_FAIL_TARGET" ]]; then exit 37; fi
exit 0
`;
  const fakePython = `#!/bin/bash
set -u
if [[ "$#" -ne 5 || "$1" != '-m' || "$2" != 'pip_audit' || "$3" != '-r' || "$5" != '--strict' ]]; then
  exit 98
fi
requirements="$4"
printf '%s|%s\\n' "$requirements" "$*" >> "$AUDIT_ATTEMPT_LOG"
if [[ "$requirements" == "$AUDIT_FAIL_TARGET" ]]; then exit 37; fi
exit 0
`;

  try {
    writeFileSync(join(bin, kind), kind === 'npm' ? fakeNpm : fakePython, { mode: 0o755 });
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        AUDIT_ATTEMPT_LOG: log,
        AUDIT_FAIL_TARGET: failTarget,
        AUDIT_TEST_ROOT: canonicalRoot,
      },
      timeout: 5_000,
    });
    const attempts = existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    return { attempts, status: result.status, signal: result.signal };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('security audit workflow source contract', () => {
  test('uses exact commit checkouts without persisted credentials', () => {
    expect(source).not.toMatch(/^permissions:\s*$/m);
    expect(source).not.toMatch(/^\s*pull_request_target\s*:/m);
    expect(source).toContain('group: security-audit-${{ github.ref }}');

    const uses = Array.from(
      source.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm),
      ([, value]) => value,
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const value of uses) {
      expect(value).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/);
    }

    const checkoutCount = uses.filter((value) => value.startsWith('actions/checkout@')).length;
    expect(checkoutCount).toBe(6);
    expect(source.match(/persist-credentials: false/g)).toHaveLength(checkoutCount);
    expect(source.match(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g)).toHaveLength(checkoutCount);
    expect(source.match(/fetch-depth: 0/g)).toHaveLength(1);
  });

  test('keeps every security job least-privilege and time-bounded', () => {
    for (const name of ['npm-audit', 'pip-audit', 'orchestration-readiness', 'rust-recovery', 'secret-pattern-scan', 'sbom']) {
      const block = jobBlock(name);
      expect(block).toMatch(/\n    timeout-minutes: [1-9][0-9]*\n/);
      expect(block).toContain('    permissions:\n      contents: read\n');
      expect(block).not.toMatch(/(?:id-token|attestations|packages|actions):\s*write/);
    }
  });

  test('runs current bounded audits and commit-bound SBOM evidence', () => {
    const npmAudit = jobBlock('npm-audit');
    expect(npmAudit).not.toContain('matrix:');
    expect(npmAudit).toContain("node-version: '24'");
    expect(npmAudit).toContain('npm install --global npm@11.6.2');
    expect(npmAudit).toContain('test "$(npm --version)" = "11.6.2"');
    expect(npmAudit).toContain('for project in apps/web backend; do');
    expect(npmAudit).toContain('cd "$project" &&');
    expect(npmAudit).toContain('npm audit --audit-level=moderate');
    for (const lockfile of ['apps/web/package-lock.json', 'backend/package-lock.json']) {
      expect(npmAudit.match(new RegExp(lockfile.replace('/', '\\/'), 'g'))).toHaveLength(1);
    }
    expect(npmAudit).toContain('status=0');
    expect(npmAudit).toContain('status=1');
    expect(npmAudit).toContain('exit "$status"');

    const pipAudit = jobBlock('pip-audit');
    expect(pipAudit).not.toContain('matrix:');
    expect(pipAudit).toContain("'pip-audit==2.10.1'");
    expect(pipAudit).toContain('if ! python -m pip_audit -r "$requirements" --strict; then');
    for (const requirements of [
      'backend/test-requirements.txt',
      'backend/pipeline/requirements.txt',
      'backend/restaurant-crawling/scripts/requirements.txt',
      'backend/supabase/scripts/g037-hosted-closure-requirements.txt',
      'backend/pipeline-control/requirements.txt',
    ]) expect(pipAudit.match(new RegExp(requirements.replaceAll('/', '\\/'), 'g'))).toHaveLength(1);
    expect(pipAudit).toContain('status=0');
    expect(pipAudit).toContain('status=1');
    expect(pipAudit).toContain('exit "$status"');

    const readiness = jobBlock('orchestration-readiness');
    expect(readiness).toContain('python-version: \'3.11\'');
    expect(readiness).toContain('python -m pip install --disable-pip-version-check -r backend/test-requirements.txt');
    expect(readiness).toContain('python backend/bin/check_crawler_orchestration_readiness.py --run-tests --json');
    expect(readiness).toContain('backend.utils.tests.test_operational_source_recovery');
    expect(readiness).toContain('backend.utils.tests.test_platform_modernization_reconciliation');
    expect(readiness).toContain('backend.bin.tests.test_check_local_runtime_unittest');
    expect(readiness).toContain('backend.bin.tests.test_schema_mirror_report_unittest');
    expect(readiness).toContain('backend.bin.tests.test_seed_fixture_guard_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_local_pipeline_composition_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_step_composition_pbt');
    expect(readiness).toContain('backend.pipeline_control.tests.test_es_index');
    expect(readiness).toContain("bun-version: '1.4.0'");
    expect(readiness).toContain('backend.bin.tests.test_tooling_gate_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_tooling_selection_unittest');
    expect(readiness).toContain('apps/web/tests-unit/dependency-freshness-workflow.test.ts');
    expect(readiness).toContain('apps/web/tests-unit/supabase-entrypoint-source.test.ts');
    expect(readiness).toContain('backend.pipeline_control.test_log_redaction_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_agent_boundary_pbt');
    expect(readiness).toContain('backend.utils.tests.test_publication_source_recovery');
    expect(readiness).toContain('backend.pipeline_control.test_publication_adapter_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_publish_apply_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_publish_batch_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_publish_codes_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_publish_hash_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_publish_idempotency_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_publish_payload_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_publish_readback_pbt');
    expect(readiness).toContain('backend.pipeline_control.tests.test_batch_upsert_publication_allowlist');
    expect(readiness).toContain('backend.supabase.tests.test_local_compose_inputs');
    expect(readiness).toContain('backend.utils.tests.test_phase_gate_source_recovery');
    expect(readiness).toContain('backend.bin.tests.test_phase_gate_unittest');
    expect(readiness).toContain('backend.bin.tests.test_run_p1_gate_unittest');
    expect(readiness).toContain('backend.bin.tests.test_run_p7_gate_unittest');
    expect(readiness).toContain('backend.pipeline_control.test_phase_partition_pbt');
    expect(readiness).toContain('backend.pipeline_control.test_rollback_plan_pbt');
    expect(readiness).toContain('bun test apps/web/tests-unit/publish-jobs-request-contract.test.ts');
    expect(readiness).toContain('backend.supabase.tests.test_hosted_db_access_decision_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_preflight_attempt_evidence_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_runtime_probe_attempt_evidence_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_credential_contract_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_preview_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v2_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v2_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_postcondition_diagnostic_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_postcondition_diagnostic_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_membership_diagnostic_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_membership_diagnostic_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_creator_membership_diagnostic_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_creator_membership_diagnostic_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v3_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v3_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v3_apply_request_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v3_apply_authorization_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_role_v3_apply_attempt_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_credential_custody_preview_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_credential_custody_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_readonly_password_assignment_request_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_direct_endpoint_network_preflight_attempt_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_direct_endpoint_network_preflight');
    expect(readiness).toContain('backend.supabase.tests.test_g037_direct_endpoint_host_evidence_request_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_alternative_preview_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_preview_approval_request_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_preview_approval_contract_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_preview_approval_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_metadata_request_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_metadata_attempt_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_metadata_receipt');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_control_map_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_control_map_v2_source');
    expect(readiness).toContain('backend.supabase.tests.test_g037_session_pooler_control_map_v3_source');
    expect(readiness).not.toMatch(/(?:secrets\.|TOKEN|PASSWORD|COOKIE)/);
    expect(jobBlock('secret-pattern-scan')).toContain('python3 scripts/security/scan_tracked_secrets.py');

    const sbom = jobBlock('sbom');
    expect(sbom).toContain('EVIDENCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}');
    expect(sbom).toContain('test "$(git rev-parse HEAD)" = "$EVIDENCE_SHA"');
    expect(sbom).toContain('npm sbom --prefix apps/web --package-lock-only --sbom-format cyclonedx');
    expect(sbom).toContain('npm sbom --prefix backend --package-lock-only --sbom-format cyclonedx');
    expect(sbom).toContain('sha256sum apps-web.cdx.json backend.cdx.json > SHA256SUMS');
    expect(sbom).toContain('if-no-files-found: error');
    expect(sbom).toContain('retention-days: 7');
    expect(sbom).not.toMatch(/(?:secrets\.|TOKEN|PASSWORD|COOKIE)/);
  });
});

describe('security audit workflow failure aggregation', () => {
  test('the literal npm audit block attempts both projects after first or last failure', () => {
    const script = stepRunBlock('npm-audit', 'Audit npm dependencies');
    const inputs = ['apps/web', 'backend'];
    const expected = inputs.map((input) => `${input}|audit --audit-level=moderate`);

    for (const failTarget of inputs) {
      const result = runAuditBlock('npm', script, failTarget);
      expect(result.signal).toBeNull();
      expect(result.attempts).toEqual(expected);
      expect(result.status).toBe(1);
    }

    const success = runAuditBlock('npm', script);
    expect(success.signal).toBeNull();
    expect(success.status).toBe(0);
    expect(success.attempts).toEqual(expected);
  });

  test('the literal pip audit block attempts all inputs after first, middle, or last failure', () => {
    const script = stepRunBlock('pip-audit', 'Audit Python requirements');
    const inputs = [
      'backend/test-requirements.txt',
      'backend/pipeline/requirements.txt',
      'backend/restaurant-crawling/scripts/requirements.txt',
      'backend/supabase/scripts/g037-hosted-closure-requirements.txt',
      'backend/pipeline-control/requirements.txt',
    ];
    const expected = inputs.map((input) => `${input}|-m pip_audit -r ${input} --strict`);

    for (const failTarget of [inputs[0], inputs[2], inputs[4]]) {
      const result = runAuditBlock('python', script, failTarget);
      expect(result.signal).toBeNull();
      expect(result.attempts).toEqual(expected);
      expect(result.status).toBe(1);
    }

    const success = runAuditBlock('python', script);
    expect(success.signal).toBeNull();
    expect(success.status).toBe(0);
    expect(success.attempts).toEqual(expected);
  });
});
