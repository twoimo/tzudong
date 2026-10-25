import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { collectCandidates, companionPatchMirrorsOnly, descriptor, lockfileChanges } from '../scripts/collect-dependency-candidates.mjs';
import { buildPreflightReceipt, buildRunReceipt } from '../scripts/verify-dependency-freshness.mjs';

const pr = { number: 42, user: { login: 'dependabot[bot]' },
  base: { ref: 'develop' }, head: { sha: 'a'.repeat(40) } };
const file = (name = 'next', version = '16.3.0', fromVersion = '16.2.0') => ({
  filename: 'apps/web/package.json', status: 'modified',
  patch: `-    "${name}": "${fromVersion}",\n+    "${name}": "${version}",`,
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

  test('derives a lockfile-only update from the merge base even after develop advances', async () => {
    const baseSha = 'b'.repeat(40);
    const mergeBase = 'c'.repeat(40);
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
      if (path.includes('/compare/')) return { base_commit: { sha: baseSha }, merge_base_commit: { sha: mergeBase } };
      if (path.includes('/contents/')) {
        // Updated develop has unrelated additions/held-package changes. Its
        // lockfile is not the old side of this PR's actual diff.
        if (path.endsWith(baseSha)) throw new Error('unrelated_base_lockfile_requested');
        return blob(lock(path.endsWith(mergeBase) ? '1.2.3' : '1.2.4'));
      }
      if (path.includes('/files')) return [{ filename: 'apps/web/package-lock.json', status: 'modified' }];
      return [{ ...pr, base: { ...pr.base, sha: baseSha } }];
    });
    expect(candidates[0].unit).toBe('/apps/web');
    expect(candidates[0].metadataIncomplete).toBe(false);
    expect(candidates[0].packages).toEqual([{ name: '@scope/leaf', fromVersion: '1.2.3', toVersion: '1.2.4' }]);
    expect(buildRunReceipt({ candidates }).candidates[0].code).toBeNull();
    expect(calls.filter((path) => path.includes('/contents/'))).toEqual([
      `/contents/apps/web/package-lock.json?ref=${mergeBase}`,
      `/contents/apps/web/package-lock.json?ref=${pr.head.sha}`,
    ]);
  });

  test('lockfile metadata cannot bypass holds or admit unbound and incomplete blobs', async () => {
    const lock = (version: string) => ({ lockfileVersion: 3, packages: { 'node_modules/typescript-eslint': { version } } });
    const file = { filename: 'apps/web/package-lock.json', status: 'modified' };
    const candidate = descriptor(pr, [file], { [file.filename]: { before: lock('8.63.0'), after: lock('8.64.0') } });
    expect(buildRunReceipt({ candidates: [candidate] }).candidates[0].code).toBe('dependency_hold_violation');
    expect(descriptor(pr, [file]).metadataIncomplete).toBe(true);
    expect(lockfileChanges(lock('8.63.0'), { lockfileVersion: 3, packages: {} }).incomplete).toBe(true);
    await expect(collectCandidates(async (path: string) => {
      if (path.includes('/compare/')) return { base_commit: { sha: 'b'.repeat(40) }, merge_base_commit: { sha: 'c'.repeat(40) } };
      if (path.includes('/contents/')) return { encoding: 'base64', content: 'e30=', size: 2, sha: '0'.repeat(40) };
      return path.includes('/files') ? [file] : [{ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } }];
    })).rejects.toThrow('candidate_metadata_unavailable');
  });

  test('missing or mismatched merge-base metadata cannot admit a lockfile candidate', async () => {
    for (const comparison of [{}, { base_commit: { sha: 'd'.repeat(40) }, merge_base_commit: { sha: 'c'.repeat(40) } },
      { base_commit: { sha: 'b'.repeat(40) }, merge_base_commit: { sha: 'invalid' } }]) {
      await expect(collectCandidates(async (path: string) => {
        if (path.includes('/compare/')) return comparison;
        if (path.includes('/files')) return [{ filename: 'apps/web/package-lock.json', status: 'modified' }];
        return [{ ...pr, base: { ...pr.base, sha: 'b'.repeat(40) } }];
      })).rejects.toThrow('candidate_metadata_unavailable');
    }
  });

  test('fetches Dependabot PR files and enforces hold and target on actual descriptors', async () => {
    const calls: string[] = [];
    const candidates = await collectCandidates(async (path: string) => {
      calls.push(path);
      return path.includes('/files') ? [file('typescript-eslint', '8.64.0', '8.63.0')] : [pr, { ...pr, user: { login: 'human' } }];
    });
    expect(calls).toHaveLength(2);
    const receipt = buildRunReceipt({ candidates });
    expect(receipt.units[0].candidateCount).toBe(1);
    expect(receipt.candidates[0].code).toBe('dependency_hold_violation');
    expect(buildRunReceipt({ candidates: [descriptor({ ...pr, base: { ref: 'main' } }, [file('typescript-eslint', '8.64.0', '8.63.0')])] })
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
    for (const version of ['^8.64.0', '~8.64.0', '>=8.64.0']) {
      expect(buildRunReceipt({ candidates: [descriptor(pr, [file('typescript-eslint', version, '8.63.0')])] })
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

describe('governed companion file narrow admission', () => {
  const COMPANION = 'apps/web/tests-unit/nightly-regression-workflow.test.ts';
  const manifest = () => ({
    filename: 'apps/web/package.json', status: 'modified',
    patch: '@@ -1,2 +1,2 @@\n-    "supabase": "^2.117.0",\n+    "supabase": "^2.121.0",\n-    "postcss": "^8.5.28",\n+    "postcss": "^8.5.31",',
  });
  const companion = (patch: string | undefined, status = 'modified') => ({
    filename: COMPANION, status, ...(patch === undefined ? {} : { patch }),
  });
  const goodPatch = '@@ -1206,4 +1206,4 @@\n context\n'
    + '-    expect(lock).toContain(\'"supabase": ["supabase@2.117.0"\');\n'
    + '+    expect(lock).toContain(\'"supabase": ["supabase@2.121.0"\');\n';
  const pairs = [{ name: 'supabase', fromVersion: '2.117.0', toVersion: '2.121.0' }];

  test('exact manifest mirror edits in the governed file are admitted', () => {
    const d = descriptor(pr, [manifest(), companion(goodPatch)]);
    expect(d.metadataIncomplete).toBe(false);
    expect(d.packages).toHaveLength(2);
    expect(companionPatchMirrorsOnly(goodPatch, pairs)).toBe(true);
  });

  test('every adversarial non-mirror companion patch fails closed', () => {
    const bad = [
      // version not part of the manifest bump
      goodPatch.replaceAll('2.121.0', '2.122.0'),
      // semantic edit inside a changed line
      goodPatch.replace('supabase@2.117.0', 'supabase-extra@2.117.0'),
      // pure addition
      goodPatch + '+    expect(true).toBe(true);\n',
      // deletion without replacement
      goodPatch.split('\n').filter((l: string) => !l.startsWith('-')).join('\n'),
      // cross-package version swap (line names supabase, carries another pair)
      goodPatch.replaceAll('2.117.0', '8.5.28').replaceAll('2.121.0', '8.5.31'),
      // one-sided change (from-version kept on the added line)
      goodPatch.replace('2.121.0', '2.117.0'),
      // changed line naming no bumped package
      goodPatch.replaceAll('supabase', 'unrelated'),
      // reordered lines inside a block
      '@@ -1,2 +1,2 @@\n-    a "supabase" 2.117.0\n-    b "supabase" 2.117.0\n+    b "supabase" 2.121.0\n+    a "supabase" 2.121.0\n',
      // multiline semantic change with versions mirrored
      '@@ -1,2 +1,2 @@\n-    expect(a).toContain("supabase 2.117.0")\n-    expect(b).toBe(true)\n+    expect(a).toContain("supabase 2.121.0")\n+    expect(b).toBe(false)\n',
      // malformed patch grammar
      'garbage line\n-    "supabase" 2.117.0\n+    "supabase" 2.121.0\n',
      // no hunk header
      '-    "supabase" 2.117.0\n+    "supabase" 2.121.0\n',
    ];
    for (const patch of bad) {
      expect(companionPatchMirrorsOnly(patch, pairs)).toBe(false);
      expect(descriptor(pr, [manifest(), companion(patch)]).metadataIncomplete).toBe(true);
    }
  });

  test('wrong path, wrong status and empty manifest changes fail closed', () => {
    const wrongPath = { filename: 'apps/web/tests-unit/other.test.ts', status: 'modified', patch: goodPatch };
    expect(descriptor(pr, [manifest(), wrongPath]).metadataIncomplete).toBe(true);
    expect(descriptor(pr, [manifest(), companion(goodPatch, 'added')]).metadataIncomplete).toBe(true);
    expect(descriptor(pr, [companion(goodPatch)]).metadataIncomplete).toBe(true);
    expect(companionPatchMirrorsOnly(goodPatch, [])).toBe(false);
    expect(companionPatchMirrorsOnly(undefined as never, pairs)).toBe(false);
  });

  test('same-version pairs stay identity-bound by package name', () => {
    const dup = [
      { name: 'alpha', fromVersion: '1.0.0', toVersion: '2.0.0' },
      { name: 'beta', fromVersion: '1.0.0', toVersion: '2.0.0' },
    ];
    expect(companionPatchMirrorsOnly(
      '@@ -1,1 +1,1 @@\n-    "alpha": "1.0.0"\n+    "alpha": "2.0.0"\n', dup)).toBe(true);
    // line carries the mirrored tokens but names neither package
    expect(companionPatchMirrorsOnly(
      '@@ -1,1 +1,1 @@\-    pin "1.0.0"\n+    pin "2.0.0"\n'.replace('\\-', '-'), dup)).toBe(false);
  });

  test('missing patch falls back to verified full contents; anything else fails closed', async () => {
    const baseSha = 'b'.repeat(40);
    const mergeBase = 'c'.repeat(40);
    const text = (version: string) => `line one\nexpect(lock).toContain("supabase: ${version}")\nline three\n`;
    const blobOf = (value: string) => {
      const bytes = Buffer.from(value);
      return { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length,
        sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    };
    const collect = async (after: string, corrupt = false) => collectCandidates(async (path: string) => {
      if (path.includes('/compare/')) return { base_commit: { sha: baseSha }, merge_base_commit: { sha: mergeBase } };
      if (path.includes('/contents/')) {
        if (corrupt) return { encoding: 'base64', content: 'e30=', size: 2, sha: '0'.repeat(40) };
        return blobOf(path.endsWith(mergeBase) ? text('2.117.0') : after);
      }
      if (path.includes('/files')) return [manifest(), companion(undefined)];
      return [{ ...pr, base: { ...pr.base, sha: baseSha } }];
    }, undefined as never);
    expect((await collect(text('2.121.0')))[0].metadataIncomplete).toBe(false);
    expect((await collect(text('2.121.0') + 'extra\n'))[0].metadataIncomplete).toBe(true);
    expect((await collect(text('2.121.0').replace('supabase', 'renamed')))[0].metadataIncomplete).toBe(true);
    await expect(collect(text('2.121.0'), true)).rejects.toThrow('candidate_metadata_unavailable');
  });
});
