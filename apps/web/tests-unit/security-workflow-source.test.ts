import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    expect(jobBlock('npm-audit')).toContain('npm audit --audit-level=moderate');
    expect(jobBlock('pip-audit')).toContain("'pip-audit==2.10.1'");
    expect(jobBlock('pip-audit')).toContain('python -m pip_audit -r "${{ matrix.requirements }}" --strict');
    expect(jobBlock('pip-audit')).toContain('backend/supabase/scripts/g037-hosted-closure-requirements.txt');
    expect(jobBlock('pip-audit')).toContain('backend/pipeline-control/requirements.txt');
    expect(jobBlock('pip-audit')).toContain('backend/test-requirements.txt');

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
