import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { collectCandidates, descriptor, lockfileChanges } from '../scripts/collect-dependency-candidates.mjs';
import { buildPreflightReceipt, buildRunReceipt } from '../scripts/verify-dependency-freshness.mjs';

const pr = { number: 42, user: { login: 'dependabot[bot]' },
  base: { ref: 'develop' }, head: { sha: 'a'.repeat(40) } };
const file = (name = 'next', version = '16.3.0') => ({
  filename: 'apps/web/package.json', status: 'modified',
  patch: `-    "${name}": "16.2.0",\n+    "${name}": "${version}",`,
});
describe('real dependency candidate ingestion', () => {
  test('PR preflight isolates other holds, missing metadata and aggregate limits', async () => {
    const current = descriptor(pr, [file('test-package', '16.2.1')]);
    const others = Array.from({ length: 6 }, (_, i) => ({
      ...descriptor({ ...pr, number: 50 + i, head: { sha: 'b'.repeat(40) } }, [file()]),
      metadataIncomplete: i === 0,
    }));
    expect(buildRunReceipt({ candidates: [current, ...others] }).candidates.every(
      (entry: {code: string | null}) => entry.code !== null)).toBe(true);
    expect(buildPreflightReceipt([current, ...others], pr.head.sha).candidates[0].code).toBeNull();
    expect(buildPreflightReceipt([current, ...others]).candidates).toHaveLength(7);
    expect(() => buildPreflightReceipt(others, pr.head.sha)).toThrow('checked_candidate_metadata_unavailable');
    expect(() => buildPreflightReceipt([current, current], pr.head.sha)).toThrow('checked_candidate_metadata_unavailable');
    const calls: string[] = [];
    const scoped = await collectCandidates(async (path: string) => {
      calls.push(path);
      return path.includes('/files') ? [file('test-package', '16.2.1')]
        : [pr, { ...pr, number: 99, head: { sha: 'b'.repeat(40) } }];
    }, pr.head.sha);
    expect(scoped).toHaveLength(1);
    expect(calls.some((path) => path.includes('/pulls/99/'))).toBe(false);
  });

  test('derives a lockfile-only transitive update from exact base/head Git blobs', async () => {
    const baseSha = 'b'.repeat(40);
    const lock = (version: string) => ({ lockfileVersion: 3, packages: {
      '': { name: 'fixture' },
      'node_modules/parent/node_modules/@scope/leaf': { version },
    } });
    const blob = (value: object) => {
      const bytes = Buffer.from(JSON.stringify(value));
      return { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length,
        sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    };
    const calls: string[] = [];
    const candidates = await collectCandidates(async (path: string) => {
      calls.push(path);
      if (path.includes('/contents/')) return blob(lock(path.endsWith(baseSha) ? '1.2.3' : '1.2.4'));
      if (path.includes('/files')) return [{ filename: 'apps/web/package-lock.json', status: 'modified' }];
      return [{ ...pr, base: { ...pr.base, sha: baseSha } }];
    });
    expect(candidates[0].unit).toBe('/apps/web');
    expect(candidates[0].metadataIncomplete).toBe(false);
    expect(candidates[0].packages).toEqual([{ name: '@scope/leaf', fromVersion: '1.2.3', toVersion: '1.2.4' }]);
    expect(buildRunReceipt({ candidates }).candidates[0].code).toBeNull();
    expect(calls.filter((path) => path.includes('/contents/'))).toEqual([
      `/contents/apps/web/package-lock.json?ref=${baseSha}`,
      `/contents/apps/web/package-lock.json?ref=${pr.head.sha}`,
    ]);
  });

  test('lockfile metadata cannot bypass holds or admit unbound and incomplete blobs', async () => {
    const lock = (version: string) => ({ lockfileVersion: 3, packages: { 'node_modules/next': { version } } });
    const file = { filename: 'apps/web/package-lock.json', status: 'modified' };
    const candidate = descriptor(pr, [file], { [file.filename]: { before: lock('16.2.1'), after: lock('16.3.0') } });
    expect(buildRunReceipt({ candidates: [candidate] }).candidates[0].code).toBe('dependency_hold_violation');
    expect(descriptor(pr, [file]).metadataIncomplete).toBe(true);
    expect(lockfileChanges(lock('16.2.1'), { lockfileVersion: 3, packages: {} }).incomplete).toBe(true);
    await expect(collectCandidates(async (path: string) => {
      if (path.includes('/contents/')) return { encoding: 'base64', content: 'e30=', size: 2, sha: '0'.repeat(40) };
      return path.includes('/files') ? [file] : [{ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } }];
    })).rejects.toThrow('candidate_metadata_unavailable');
  });

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
  test('real manifest version ranges cannot bypass held versions', () => {
    for (const version of ['^16.3.0', '~16.3.0', '>=16.3.0']) {
      expect(buildRunReceipt({ candidates: [descriptor(pr, [file('next', version)])] })
        .candidates[0].code).toBe('dependency_hold_violation');
    }
    const changed = { ...file(), patch: '-"eslint": "^9.0.0",\n+"eslint": "^10.0.0",' };
    expect(buildRunReceipt({ candidates: [descriptor(pr, [changed])] })
      .candidates[0].code).toBe('dependency_hold_violation');
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
