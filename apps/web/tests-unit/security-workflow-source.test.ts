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
    expect(checkoutCount).toBe(4);
    expect(source.match(/persist-credentials: false/g)).toHaveLength(checkoutCount);
    expect(source.match(/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/g)).toHaveLength(checkoutCount);
  });

  test('keeps every security job least-privilege and time-bounded', () => {
    for (const name of ['npm-audit', 'pip-audit', 'secret-pattern-scan', 'sbom']) {
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
