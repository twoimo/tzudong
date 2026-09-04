import { describe, expect, test } from 'bun:test';
import { collectCandidates, descriptor } from '../scripts/collect-dependency-candidates.mjs';
import { buildRunReceipt } from '../scripts/verify-dependency-freshness.mjs';

const pr = { number: 42, user: { login: 'dependabot[bot]' },
  base: { ref: 'develop' }, head: { sha: 'a'.repeat(40) } };
const file = (name = 'next', version = '16.3.0') => ({
  filename: 'apps/web/package.json', status: 'modified',
  patch: `-    "${name}": "16.2.0",\n+    "${name}": "${version}",`,
});
describe('real dependency candidate ingestion', () => {
  test('fetches Dependabot PR files and enforces hold and target on actual descriptors', async () => {
    const calls: string[] = [];
    const candidates = await collectCandidates(async (path: string) => {
      calls.push(path);
      return path.includes('/files') ? [file()] : [pr, { ...pr, user: { login: 'human' } }];
    });
    expect(calls).toHaveLength(2);
    const receipt = buildRunReceipt({ candidates });
    expect(receipt.units[0].candidateCount).toBe(1);
    expect(receipt.candidates[0].code).toBe('dependency_hold_violation');
    expect(buildRunReceipt({ candidates: [descriptor({ ...pr, base: { ref: 'main' } }, [file()])] })
      .candidates[0].code).toBe('target_branch_violation');
  });
  test('rejects pin changes, truncated metadata and excess open candidates', () => {
    expect(buildRunReceipt({ candidates: [descriptor(pr, [file('typescript', '16.2.1')])] })
      .candidates[0].code).toBe('pin_contract_violation');
    expect(buildRunReceipt({ candidates: [descriptor(pr, [{ ...file(), patch: undefined }])] })
      .candidates[0].code).toBe('dependency_check_failed');
    const candidates = Array.from({ length: 6 }, (_, i) => descriptor({ ...pr, number: i }, [file('test-package', '16.2.1')]));
    expect(buildRunReceipt({ candidates }).candidates.every((c: {code: string}) => c.code === 'dependency_check_failed')).toBe(true);
  });
  test('uses each ecosystem directory and refuses missing API pages', async () => {
    for (const [filename, patch, unit] of [
      ['backend/pipeline/requirements.txt', '-requests==2.32.0\n+requests==2.32.1', '/backend/pipeline'],
      ['backend/rust/Cargo.toml', '-serde = "1.0.0"\n+serde = "1.0.1"', '/backend/rust'],
      ['.github/workflows/ci.yml', '-uses: actions/checkout@old\n+uses: actions/checkout@new', '/'],
    ]) expect(descriptor(pr, [{ filename, status: 'modified', patch }]).unit).toBe(unit);
    await expect(collectCandidates(async () => ({ error: true }))).rejects.toThrow('candidate_metadata_unavailable');
  });
});
